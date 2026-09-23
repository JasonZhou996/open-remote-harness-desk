import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {launchOptions} from './browser-runtime.mjs';
import {rpcErrorPayload} from '../web/codex/bridge-errors.js';
import {DesktopSync} from '../server/codex/desktop-sync.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
async function until(predicate){const deadline=Date.now()+15000;while(!predicate()){assert(Date.now()<deadline,'State recovery timed out');await new Promise(resolve=>setTimeout(resolve,20))}}

// Exercise the actual gateway dispatch with a stub downstream, without creating a real task.
const gateway=readFileSync(new URL('../server/gateway/index.ts',import.meta.url),'utf8');
let sent=0,closed=0;
const healthy={readyState:1,bufferedAmount:0,send(){sent++}},slow={readyState:1,bufferedAmount:5*1024*1024,terminate(){closed++}};
const broadcast=vm.runInNewContext(new Bun.Transpiler({loader:'ts'}).transformSync(gateway.slice(gateway.indexOf('function broadcast('),gateway.indexOf('// Built-in app-server section')))+'\nbroadcast',{clients:new Set([healthy,slow]),sseClients:new Set(),WebSocket:{OPEN:1}});
broadcast({type:'notification'});assert.equal(sent,1);assert.equal(closed,1);
const dispatchSource=gateway.slice(gateway.indexOf('const bridgeInstanceId ='),gateway.indexOf('\nasync function handleClient'));
let writes=0,releaseWrite;
const dispatch=vm.runInNewContext(new Bun.Transpiler({loader:'ts'}).transformSync(dispatchSource)+'\ndispatchBrowserMessage',{
  randomUUID:()=> 'instance',isAllowedBrowserRpcMethod:()=>true,readLiveThread:()=>null,
  browserRequest:()=>{writes++;return new Promise(resolve=>{releaseWrite=resolve})},recordThreadPathsFromRpc:()=>{},recordReviewDiffsFromRpc:()=>{},rpcErrorPayload,
});
const request={type:'rpc',id:1,method:'turn/start',params:{threadId:'test',input:[]},operation:{id:'submission',instanceId:'instance',issuedAt:Date.now()}};
const first=dispatch(request),retry=dispatch({...request,id:2});
await Promise.resolve();assert.equal(writes,1);releaseWrite({turn:{id:'accepted'}});
assert.equal((await first).result.turn.id,'accepted');assert.equal((await retry).id,2);
assert.equal((await dispatch({...request,operation:{...request.operation,instanceId:'previous'}})).code,'request_outcome_unknown');
assert.equal(writes,1);

const sync=new DesktopSync(()=>{});let subscriptions=0;
sync.bridge.write=()=>subscriptions++;
sync.followed.set('test',{owner:'owner',revision:10,state:{id:'test',turns:[]},ownerCheckedAt:Date.now()});
const receive=change=>sync.receive({method:'thread-stream-state-changed',sourceClientId:'owner',params:{conversationId:'test',change}});
receive({type:'snapshot',revision:9,conversationState:{id:'test',title:'stale',turns:[]}});
assert.equal(sync.followed.get('test').revision,10);
receive({type:'patches',baseRevision:11,revision:12,patches:[]});
assert.equal(sync.followed.get('test').revision,null);assert.equal(subscriptions,1);
receive({type:'snapshot',revision:12,conversationState:{id:'test',turns:[]}});
assert.equal(sync.followed.get('test').revision,12);

const user=(id,text)=>({id,type:'userMessage',content:[{type:'text',text}]});
const thought=(id,text,status='completed')=>({id,type:'reasoning',summary:[text],status});
const tool=(id,status='completed')=>({id,type:'commandExecution',command:`echo ${id}`,status,aggregatedOutput:status==='completed'?'done':''});
let turns=[{id:'turn',status:'inProgress',items:[user('u','开始'),thought('old','OLD_THOUGHT'),tool('one'),tool('two','inProgress'),thought('latest','Checking connection','inProgress')]}];
const thread=()=>({id:'sync-check',name:'Sync check',cwd:'/tmp',status:{type:turns.at(-1).status==='inProgress'?'active':'idle'},turns});
let holdLive=false,releaseLive,liveCalls=0,dropLive=false,queueAttempts=[],lostQueue=true;
const browser=await chromium.launch(launchOptions());
try{
  const page=await browser.newPage({viewport:{width:1280,height:850}}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>{
    if(window!==window.top)return;
    window.CodexBrowser={hide(){}};localStorage.setItem('codex-webui-locale','en');
    window.EventSource=class{constructor(url){if(url==='/api/events'){window.bridge=this;queueMicrotask(()=>this.onmessage?.({data:JSON.stringify({type:'bridge/status',status:'connected',instanceId:'instance',issuedAt:Date.now()})}))}}close(){}};
    const timeout=AbortSignal.timeout.bind(AbortSignal);
    AbortSignal.timeout=ms=>timeout(window.shortDeadline&&ms===35000?100:ms);
  });
  await page.route('**/api/rpc',async route=>{
    const {id,method,operation}=route.request().postDataJSON();
    let result=method==='thread/read'?{thread:structuredClone(thread())}:method==='thread/list'?{data:[thread()],projects:[]}:method==='host/thread/live'?{turn:structuredClone(turns.at(-1))}:method==='thread/turns/list'?{data:[turns.at(-1)]}:{data:[]};
    if(method==='host/thread/live'){
      liveCalls++;
      if(dropLive){dropLive=false;return}
      if(holdLive){holdLive=false;await new Promise(resolve=>{releaseLive=resolve})}
    }
    if(method==='host/thread/queue'){
      queueAttempts.push(operation.id);result={messages:[]};
      if(lostQueue){lostQueue=false;await route.abort();return}
    }
    await route.fulfill({json:{type:'rpc/result',id,result}}).catch(()=>{});
  });
  await page.goto((process.env.CODEX_WEBUI_TEST_URL||'http://127.0.0.1:8899')+'/?thread=sync-check',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>globalThis.__codexWebuiDebug?.state.active?.historyLoaded&&!globalThis.__codexWebuiDebug.state.active.cachePreview);
  const group=page.locator('.activity-group').first();
  assert.equal(await group.locator('.activity-summary-copy').textContent(),'Checking connection');
  assert.equal(await group.locator('.activity-items').isVisible(),false);
  await group.locator('.activity-summary').click();
  assert.equal(await group.locator('.activity-item:visible').count(),2);
  assert.equal(await page.getByText('OLD_THOUGHT',{exact:true}).count(),0);
  assert.equal(await group.locator('.reasoning-output').innerText(),'');
  await page.evaluate(()=>{
    const api=globalThis.__codexWebuiDebug;
    api.notify('item/reasoning/summaryTextDelta',{threadId:'sync-check',turnId:'turn',itemId:'latest',summaryIndex:1,delta:'**'});
  });
  assert.equal(await group.locator('.activity-summary-copy').textContent(),'Checking connection','empty heading delimiters must not reset the summary');
  await page.evaluate(()=>{
    const api=globalThis.__codexWebuiDebug;
    api.notify('item/completed',{threadId:'sync-check',turnId:'turn',item:{id:'followup',type:'userMessage',content:[{type:'text',text:'追加问题气泡'}]}});
    api.notify('item/started',{threadId:'sync-check',turnId:'turn',item:{id:'next-thought',type:'reasoning',summary:[]}});
  });
  assert.equal(await page.locator('.activity-summary-copy').last().textContent(),'Checking connection','new empty reasoning keeps the latest available summary');
  const alignment=await page.getByText('追加问题气泡',{exact:true}).evaluate(node=>({bubble:node.getBoundingClientRect().right,stream:node.closest('.turn-event-stream').getBoundingClientRect().right}));
  assert(Math.abs(alignment.bubble-alignment.stream)<2,'follow-up bubble must align to the right edge');
  holdLive=true;
  await until(()=>releaseLive);
  turns[0].items[3]=tool('two');
  await page.evaluate(item=>globalThis.__codexWebuiDebug.notify('item/completed',{threadId:'sync-check',turnId:'turn',item}),tool('two'));
  releaseLive();
  await page.waitForTimeout(150);
  assert.equal(await page.locator('[data-item-id="two"]').evaluate(el=>el.classList.contains('active')),false,'late snapshot must not restart a completed tool');
  assert.equal(await group.locator('.activity-items').isVisible(),true,'updates preserve expansion');
  // Recover every missed turn, not just the last turn, when an established SSE stream reconnects.
  turns[0].status='completed';turns[0].items[4].status='completed';
  turns.push({id:'missed',status:'completed',items:[user('missed-user','离线期间的中间消息')]},{id:'newest',status:'inProgress',items:[user('new-user','最新消息')]});
  await page.evaluate(()=>{window.bridge.onerror();window.bridge.onmessage({data:JSON.stringify({type:'bridge/status',status:'connected',instanceId:'instance',issuedAt:Date.now()})})});
  await page.getByText('离线期间的中间消息',{exact:true}).waitFor();
  await page.getByText('最新消息',{exact:true}).waitFor();
  assert.equal(await page.locator('.reasoning-activity').count(),0);
  // A read that never returns must release the active sync request and allow the next read.
  const before=liveCalls;dropLive=true;await page.evaluate(()=>{window.shortDeadline=true});
  await until(()=>liveCalls>=before+2);
  await page.evaluate(()=>{window.shortDeadline=false});
  // Losing a write response and clicking send again uses the same accepted operation.
  await page.locator('#prompt').fill('不要重复发送');await page.locator('#sendButton').click();
  await page.waitForFunction(()=>document.querySelector('#prompt').value==='不要重复发送');
  await page.locator('#sendButton').click();
  await page.waitForFunction(()=>document.querySelector('#prompt').value==='');
  await until(()=>queueAttempts.length>=2);
  assert.equal(queueAttempts[0],queueAttempts[1]);
  await page.screenshot({path:'/tmp/tri-web-sync-check.png'});
  assert.deepEqual(errors,[]);
  const wsPage=await browser.newPage();
  await wsPage.addInitScript(()=>{
    if(window!==window.top)return;
    const schedule=window.setTimeout.bind(window);window.setTimeout=(fn,ms,...args)=>schedule(fn,ms===35000?100:ms,...args);
    const NativeWebSocket=window.WebSocket;
    window.WebSocket=class extends EventTarget{
      static OPEN=1;static CONNECTING=0;static CLOSED=3;
      constructor(url){super();if(!String(url).endsWith('/ws'))return new NativeWebSocket(url);this.readyState=1;queueMicrotask(()=>this.onmessage?.({data:JSON.stringify({type:'bridge/status',status:'connected'})}))}
      send(){}close(){this.readyState=3}
    };
  });
  await wsPage.goto((process.env.CODEX_WEBUI_TEST_URL||'http://127.0.0.1:8899')+'/',{waitUntil:'domcontentloaded'});
  await wsPage.waitForFunction(()=>globalThis.__codexWebuiDebug?.state.transport==='sse'&&globalThis.__codexWebuiDebug.state.pending.size===0);
  await wsPage.close();
  console.log('PASS: latest-only status, tool history, stale-read protection, SSE history recovery, HTTP timeout recovery, write receipt deduplication, desktop revision gaps');
}finally{await browser.close()}
