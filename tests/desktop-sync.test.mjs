import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DesktopSync,desktopThread} from '../server/codex/desktop-sync.mjs';
const state = (status='inProgress',model='gpt-6-astra') => ({id:'thread',cwd:'C:/project',latestThreadSettings:{model,effort:'high'},turns:[{turnId:'turn',status,turnStartedAtMs:1000,items:[]}]});
const snapshot = (owner,status='inProgress',model) => ({method:'thread-stream-state-changed',sourceClientId:owner,params:{conversationId:'thread',change:{type:'snapshot',revision:1,conversationState:state(status,model)}}});

test('a new desktop owner can replace the old snapshot and publish completion',async()=>{
  const events=[],sent=[],sync=new DesktopSync(event=>events.push(event));
  sync.bridge.write=message=>sent.push(message);
  sync.bridge.socket={writable:true};
  sync.followed.set('thread',{owner:'old',revision:1,state:state(),ownerCheckedAt:Date.now()});
  sync.receive({method:'thread-stream-following-status-requested',sourceClientId:'new',params:{conversationId:'thread'}});
  assert.equal(sent.at(-1).targetClientIds[0],'new');
  sync.receive(snapshot('old'));
  assert.equal(sync.followed.get('thread').revision,null);
  sync.receive(snapshot('new','completed','gpt-6-sol'));
  const live=await sync.observe('thread');
  assert.equal(live.status.type,'idle'); assert.equal(live.model,'gpt-6-sol');
  assert(events.some(event=>event.method==='turn/completed'));
});
test('a vanished owner does not leave a task permanently running',async()=>{
  const sync=new DesktopSync(()=>{});
  sync.bridge.socket={writable:true}; sync.bridge.owner=async()=>null;
  sync.followed.set('thread',{owner:'old',revision:1,state:state(),ownerCheckedAt:0});
  assert.equal(await sync.observe('thread'),null); assert.equal(sync.followed.has('thread'),false);
});
test('disconnect invalidates the cached revision and forces a fresh subscription',async()=>{
  const sync=new DesktopSync(()=>{});
  sync.bridge.socket={writable:true}; sync.bridge.owner=async()=>'new';
  sync.followed.set('thread',{owner:'old',revision:1,state:state(),ownerCheckedAt:Date.now()});
  sync.bridge.onDisconnect(); assert.equal(sync.followed.get('thread').revision,null);
  sync.bridge.write=()=>queueMicrotask(()=>sync.receive(snapshot('new','completed')));
  assert.equal((await sync.observe('thread')).activeTurnId,null);
});

test('native thinking follows the latest assistant activity and ignores user follow-ups',()=>{
  const native=state();
  native.turns[0].items=[
    {id:'thought-1',type:'reasoning',summary:[]},
    {id:'tool',type:'mcpToolCall',tool:'js',status:'completed'},
    {id:'thought-2',type:'reasoning',summary:['Checking the page']},
    {id:'user',type:'userMessage',content:[{type:'text',text:'Continue'}]},
    {id:'user',type:'steered'},
  ];
  let turn=desktopThread(native).turns[0];
  assert.equal(turn.items[0].status,'completed');
  assert.equal(turn.items[2].status,'inProgress');
  assert.equal(turn.items.filter(item=>item.id==='user').length,1);
  assert.equal(turn.items.at(-1).type,'userMessage');
  assert.equal(native.turns[0].items[2].status,undefined);
  native.turns[0].status='completed';
  turn=desktopThread(native).turns[0];
  assert.equal(turn.items[2].status,'completed');
});

test('thinking completion is emitted when the next tool starts',()=>{
  const events=[],sync=new DesktopSync(event=>events.push(event)),native=state();
  native.turns[0].items=[{id:'thinking',type:'reasoning',summary:[]}];
  sync.publish('thread',desktopThread(native));
  assert(events.some(event=>event.method==='item/started'&&event.params.item.id==='thinking'));
  events.length=0;
  native.turns[0].items.push({id:'tool',type:'mcpToolCall',tool:'js',status:'inProgress'});
  sync.publish('thread',desktopThread(native));
  assert.deepEqual(events.map(event=>[event.method,event.params.item?.id]),[
    ['item/completed','thinking'],['item/started','tool'],
  ]);
});

test('canonical history keeps accepted user input once and preserves explicit activity status',()=>{
  const thread=desktopThread({id:'thread',turnHistory:{kind:'canonical',history:{entitiesByKey:{turn:{
    turnId:'turn',status:'inProgress',items:[
      {id:'pending',type:'steeringUserMessage',serverUserMessageId:'accepted',clientUserMessageId:'client',input:[{type:'text',text:'Continue'}]},
      {id:'accepted',type:'userMessage',content:[{type:'text',text:'Continue'}]},
      {id:'accepted',type:'steered'},
      {id:'reasoning',type:'reasoning',status:'completed',summary:[]},
    ],
  }}}}});
  assert.deepEqual(thread.turns[0].items.map(item=>[item.id,item.type,item.status]),[
    ['accepted','userMessage',undefined],['reasoning','reasoning','completed'],
  ]);
});
