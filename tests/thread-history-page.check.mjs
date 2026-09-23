import assert from 'node:assert/strict';
import {readThreadPage,mergeConversationTurns,readConversationTurns} from '../server/codex/thread-history.js';
import {desktopThread} from '../server/codex/desktop-sync.mjs';
// A steered marker acknowledges delivery; it is not the user's message body.
const input=[{type:'text',text:'inserted while running'},{type:'localImage',path:'/tmp/attachment.png'}];
const steering={id:'local',type:'steeringUserMessage',serverUserMessageId:'accepted',clientUserMessageId:'client',input};
const normalized=desktopThread({id:'t',turns:[{turnId:'turn',items:[steering,{id:'accepted',type:'steered'}]}]});
assert.deepEqual(normalized.turns[0].items.filter(i=>i.type==='userMessage').map(i=>i.content),[input]);
const persisted=desktopThread({id:'t',turns:[{turnId:'turn',items:[steering,{id:'accepted',type:'userMessage',content:input}]}]});
assert.equal(persisted.turns[0].items.filter(i=>i.type==='userMessage').length,1);
const users=Array.from({length:8},(_,i)=>({id:`user-${i}`,type:'userMessage',content:[{type:'text',text:`message ${i}`}]}));
const calls=[];
const result=await readThreadPage(async(method,params)=>{
  calls.push([method,params]);
  return method==='thread/read'?{thread:{id:'t',name:'kept'}}:{data:[{id:'new',items:[...users,{id:'tool',type:'commandExecution',aggregatedOutput:'large output'},{id:'reply',type:'agentMessage',text:'reply'}]},{id:'old',items:[]}],nextCursor:'older'};
},'t');
assert.equal(calls[0][1].includeTurns,false);
assert.equal(calls[1][1].limit,20);
assert.equal(calls[1][1].itemsView,'full');
assert.deepEqual(result.thread.turns[1].items.filter(i=>i.type==='userMessage'),users);
assert.equal(result.thread.turns[1].items.some(i=>i.type==='commandExecution'),true);
assert.deepEqual(result.thread.turns.map(t=>t.id),['old','new']);
assert.equal(result.thread.olderTurnsCursor,'older');
assert.equal(result.thread.name,'kept');
const merged=mergeConversationTurns(
 [{id:'old',startedAt:1,items:users}],
 [{id:'old',createdAt:1000,items:users.slice(0,1)},{id:'middle',createdAt:2000,items:[{id:'mid',type:'userMessage',content:input}]},{id:'new',createdAt:3000,items:normalized.turns[0].items}],
);
assert.deepEqual(merged.map(t=>t.id),['old','middle','new']);
assert.equal(merged[0].items.length,8);
assert.equal(merged[2].items.filter(i=>i.type==='userMessage').length,1);
const paged=mergeConversationTurns([{id:'recent',startedAt:2,items:[]}],[
 {id:'earlier',createdAt:1000,items:users},
 {id:'recent',createdAt:2000,items:users},
 {id:'live',createdAt:3000,status:'inProgress',items:users},
],true);
assert.deepEqual(paged.map(turn=>turn.id),['recent','live'],'desktop snapshots must not refill older history outside the page');
assert.equal(paged[0].items.length,8);
const older=await readConversationTurns(async(method,params)=>{
 assert.equal(params.cursor,'older');assert.equal(params.itemsView,'full');
 return {data:[{id:'prior',items:users}],nextCursor:'earlier'};
},{threadId:'t',cursor:'older',itemsView:'summary'});
assert.equal(older.data[0].items.length,8);
assert.equal(older.nextCursor,'earlier');
console.log('paged history OK');

import {mkdtempSync,writeFileSync,appendFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {rolloutActivity} from '../server/codex/live-session-service.js';
const dir=mkdtempSync(join(tmpdir(),'webui-activity-')),file=join(dir,'rollout');
try {
  const event=type=>JSON.stringify({type:'event_msg',payload:{type}})+'\n';
  writeFileSync(file,event('task_started'));
  assert.equal(rolloutActivity(file),true);
  appendFileSync(file,event('task_complete'));
  assert.equal(rolloutActivity(file),false);
  appendFileSync(file,event('task_started')+event('turn_aborted'));
  assert.equal(rolloutActivity(file),false);
} finally {rmSync(dir,{recursive:true});}
console.log('running indicator source OK');

import {mergeTurnItems} from '../web/shared/turn-items.js';
import {parseRollout} from '../server/codex/live-session-service.js';
const items=ids=>ids.split(',').map(id=>({id}));
assert.deepEqual(mergeTurnItems(items('user,text,final,tool'),items('user,text,tool,final')).map(i=>i.id),['user','text','tool','final']);
assert.deepEqual(mergeTurnItems(items('user,thought,text,tool,followup'),items('user,text,tool')).map(i=>i.id),['user','thought','text','tool','followup']);
const rollout=[{type:'event_msg',payload:{type:'task_started',turn_id:'stable'}},
  ...['first','second'].flatMap(text=>[
    {type:'response_item',payload:{type:'message',role:'assistant',content:[{text}]}},
    {type:'response_item',payload:{type:'reasoning',summary:[{text}]}}
  ])].map(event=>JSON.stringify(event)).join('\n');
const replay=parseRollout(rollout).turn.items;
assert.equal(new Set(replay.map(i=>i.id)).size,4);
assert.deepEqual(parseRollout(rollout).turn.items,replay);
console.log('timeline order and replay identity OK');
