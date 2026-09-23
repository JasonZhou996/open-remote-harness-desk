import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium} from 'playwright';
import {cacheableThread,mergeCachedHistory} from '../web/codex/conversation-cache.js';
import {createLatestRequestGate} from '../web/codex/ui-core.js';
import {runInNewContext} from 'node:vm';

const messages=Array.from({length:8},(_,i)=>({id:`user-${i}`,type:'userMessage',content:[{type:'text',text:`message ${i}`}]}));
const previous={id:'thread',name:'Cached task',cwd:'/workspace',turns:[{id:'old',items:messages},{id:'last',items:messages}],olderTurnsCursor:'even-older'};
const fresh={...previous,turns:[{id:'last',items:[...messages,{id:'reply',type:'agentMessage',text:'new reply'}]}],olderTurnsCursor:'old'};
const merged=mergeCachedHistory(previous,fresh);
assert.deepEqual(merged.turns.map(t=>t.id),['old','last']);
assert.equal(merged.turns[1].items.length,9);
assert.equal(merged.olderTurnsCursor,'even-older');
assert.deepEqual(mergeCachedHistory(previous,{...fresh,olderTurnsCursor:null}).turns,fresh.turns);
assert.equal(cacheableThread({...previous,desktopSettings:{permissions:'full'},queue:['stale'],canAcceptDirectInput:true}).desktopSettings,undefined);

const app=readFileSync(new URL('../web/codex/app.js',import.meta.url),'utf8');
const openThreadSource=app.slice(app.indexOf('async function openThread('),app.indexOf('\nfunction renderHeader('));
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}};
async function checkOpen(order){
  const disk=deferred(),network=deferred(),displayed=[],writes=[],state={active:null,threads:[{id:'thread'}],changes:new Map()};
  const context={state,threadOpenGate:createLatestRequestGate(),readCache:()=>disk.promise,readConversation:()=>network.promise,mergeCachedHistory,cacheableThread,
    writeCache:(key,value)=>writes.push(value),$:()=>({innerHTML:''}),
    displayConversation:(thread,cached)=>{displayed.push({thread,cached});state.active={...thread,cachePreview:cached,historyLoaded:true}},
  };
  for(const name of ['resetActiveThreadSync','setActiveTurnId','rememberActiveThread','clearConversationRuntime','resetReviewState','closeComposerAutocomplete','renderContextTray','renderContextUsage','renderHeader','renderThreads','scheduleActiveThreadSync','cacheNotice'])context[name]=()=>{};
  const saveSource=app.match(/^function saveConversationCache[^\n]+/m)[0];
  const open=runInNewContext(saveSource+'\n'+openThreadSource+'\nopenThread',context),pending=open('thread');
  runInNewContext('saveConversationCache()',context);
  assert.equal(writes.length,0,'loading metadata must not overwrite a cached conversation');
  if(order==='network-first'){
    network.resolve({thread:fresh});await pending;disk.resolve(previous);await new Promise(setImmediate);
    assert.equal(displayed.length,1);assert.equal(displayed[0].thread.turns[0].items.length,9);
  }else{
    disk.resolve(previous);await new Promise(setImmediate);
    assert.equal(displayed[0].cached,true);assert.equal(displayed[0].thread.turns[0].items.length,8);
    if(order==='switch'){context.threadOpenGate.next();state.active={id:'another'};network.resolve({thread:fresh});await pending;assert.equal(state.active.id,'another')}
    else if(order==='offline'){network.reject(new Error('offline'));await pending;assert.equal(displayed.length,1);assert.equal(state.active.turns[0].items.length,8)}
    else {network.resolve({thread:fresh});await pending;assert.equal(displayed.at(-1).thread.turns.length,2);assert.equal(displayed.at(-1).thread.turns[1].items.length,9)}
  }
}
for(const order of ['cache-first','network-first','switch','offline'])await checkOpen(order);
console.log('PASS: immediate cached history, fresh replacement, request ordering, task switching and offline retention');

// A standalone page, never the user's live Codex UI or account.
const module=readFileSync(new URL('../web/codex/conversation-cache.js',import.meta.url));
const server=createServer((req,res)=>{res.setHeader('content-type',req.url==='/cache.js'?'text/javascript':'text/html');res.end(req.url==='/cache.js'?module:'<!doctype html><title>Cache check</title>')});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const url=`http://127.0.0.1:${server.address().port}`,profile=mkdtempSync(join(tmpdir(),'conversation-cache-check-'));
let browser;
const launch=()=>chromium.launchPersistentContext(profile,{headless:true,executablePath:'/usr/bin/google-chrome'});
try{
  browser=await launch();let page=await browser.newPage();await page.goto(url);
  await page.evaluate(async thread=>{const c=await import('/cache.js');await c.writeCache('thread:thread',thread)},previous);
  await browser.close();browser=await launch();page=await browser.newPage();await page.goto(url);
  assert.deepEqual(await page.evaluate(async()=>{const c=await import('/cache.js');return c.readCache('thread:thread')}),previous);
  await page.evaluate(async thread=>{const c=await import('/cache.js');await c.writeCache('thread:thread',thread)},merged);
  assert.equal(await page.evaluate(async()=>{const c=await import('/cache.js');return (await c.readCache('thread:thread')).turns[1].items.length}),9);
  const other=await browser.newPage();await other.goto(url.replace('127.0.0.1','localhost'));
  assert.equal(await other.evaluate(async()=>{const c=await import('/cache.js');return c.readCache('thread:thread')}),null);
  await page.evaluate(async()=>{const c=await import('/cache.js');await c.clearCache();for(let i=0;i<35;i++)await c.writeCache(`t:${i}`,{id:i})});
  assert.equal(await page.evaluate(()=>new Promise(resolve=>{const request=indexedDB.open('codex-conversations',1);request.onsuccess=()=>{const count=request.result.transaction('entries').objectStore('entries').count();count.onsuccess=()=>resolve(count.result)}})),32);
  await page.evaluate(async()=>{const c=await import('/cache.js');await c.clearCache()});
  assert.equal(await page.evaluate(async()=>{const c=await import('/cache.js');return c.readCache('t:34')}),null);
  console.log('PASS: restart persistence, complete messages, fresh replacement, older pages, origin isolation, eviction and logout cleanup');
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));rmSync(profile,{recursive:true,force:true})}
