import assert from 'node:assert/strict';
import {launchOptions} from './browser-runtime.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch(launchOptions());
const userText='发送按钮检查';
let active=false,id='send-check';
const thread=()=>({id,name:'Send check',cwd:'/tmp',canAcceptDirectInput:true,turns:active?[{id:'running',status:'inProgress',items:[]}]:[]});
const writes=[],errors=[];
try{
  const page=await browser.newPage();page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>{
    if(window!==window.top)return;
    window.CodexBrowser={hide(){}};
    window.EventSource=class{constructor(url){if(url==='/api/events')queueMicrotask(()=>this.onmessage?.({data:JSON.stringify({type:'bridge/status',status:'connected',instanceId:'instance',issuedAt:Date.now()})}))}close(){}};
  });
  await page.route('http://tri-web.test/**',async route=>{
    const url=new URL(route.request().url());
    if(url.pathname==='/api/rpc'){
      const request=route.request().postDataJSON(),{method}=request;
      let result={data:[]};
      if(method==='thread/read'||method==='thread/resume')result={thread:thread()};
      if(method==='thread/list')result={data:[thread()],projects:[]};
      if(method==='host/thread/live')result={turn:thread().turns.at(-1)||null};
      if(method==='thread/start'){writes.push(request);id='created-thread';result={thread:thread()}}
      if(method==='turn/start'){writes.push(request);result={turn:{id:'running',status:'inProgress',items:[]}}}
      if(method==='host/thread/queue'){writes.push(request);result={messages:[]}}
      return route.fulfill({json:{type:'rpc/result',id:request.id,result}});
    }
    if(url.pathname.startsWith('/api/')&&url.pathname!=='/api/config')return route.fulfill({json:{}});
    const response=await page.request.get((process.env.CODEX_WEBUI_TEST_URL||'http://127.0.0.1:8899')+url.pathname+url.search);
    await route.fulfill({response});
  });
  await page.goto('http://tri-web.test/?thread=send-check',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>globalThis.__codexWebuiDebug?.state.active?.historyLoaded&&!globalThis.__codexWebuiDebug.state.active.cachePreview);
  assert.deepEqual(await page.evaluate(()=>({secure:isSecureContext,uuid:typeof crypto.randomUUID})),{secure:false,uuid:'undefined'});
  const send=async expected=>{
    const before=writes.length;
    await page.locator('#prompt').fill(userText);await page.locator('#sendButton').click();
    const deadline=Date.now()+3000;while((writes.length===before||writes.at(-1)?.method!==expected)&&!errors.length&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,20));
    assert.deepEqual(errors,[],'clicking send must not throw in an HTTP/non-secure browser context');
    assert.equal(writes.at(-1)?.method,expected);
    assert.equal(writes.at(-1)?.params.input[0].text,userText);
    assert.match(writes.at(-1)?.operation.id,/^[0-9a-f-]+:send$/);
    await page.waitForFunction(()=>document.querySelector('#prompt').value==='');
  };
  await send('turn/start');
  active=true;
  await page.evaluate(()=>globalThis.__codexWebuiDebug.syncTurnSnapshot({id:'running',status:'inProgress',items:[]}));
  await send('host/thread/queue');
  active=false;
  await page.evaluate(()=>globalThis.__codexWebuiDebug.startNewTask());
  await send('turn/start');
  assert(writes.some(request=>request.method==='thread/start'));
  assert.equal(writes.at(-1).params.threadId,'created-thread');
  await page.unrouteAll({behavior:'ignoreErrors'});
  console.log('PASS: existing, running, and new conversations send from a real non-secure browser origin without randomUUID');
}finally{await browser.close()}
