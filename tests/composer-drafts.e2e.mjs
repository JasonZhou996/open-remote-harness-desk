import assert from 'node:assert/strict';
import {launchOptions} from './browser-runtime.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch(launchOptions());
const thread=id=>({id,name:id,cwd:'/tmp',projectless:true,canAcceptDirectInput:true,turns:[]});
let releaseRead,releaseUpload,releaseSend;
const errors=[];
try{
  const page=await browser.newPage();page.setDefaultTimeout(5000);
  page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>{
    if(window!==window.top)return;
    window.CodexBrowser={hide(){}};
    window.EventSource=class{constructor(url){if(url==='/api/events')queueMicrotask(()=>this.onmessage?.({data:JSON.stringify({type:'bridge/status',status:'connected',instanceId:'drafts',issuedAt:Date.now()})}))}close(){}};
  });
  await page.route('http://tri-web.test/**',async route=>{
    const url=new URL(route.request().url());
    if(url.pathname==='/api/attachments'){
      await new Promise(resolve=>{releaseUpload=resolve});
      return route.fulfill({json:{path:'/tmp/draft.txt',filename:'draft.txt',kind:'file'}});
    }
    if(url.pathname==='/api/rpc'){
      const {id,method,params}=route.request().postDataJSON();let result={data:[]};
      if(method==='thread/list')result={data:['draft-a','draft-b'].map(thread),projects:[]};
      if(method==='thread/read'||method==='thread/resume'){
        if(method==='thread/read'&&params.threadId==='draft-b'&&!releaseRead)await new Promise(resolve=>{releaseRead=resolve});
        result={thread:thread(params.threadId)};
      }
      if(method==='host/thread/live')result={turn:null};
      if(method==='turn/start'){
        await new Promise(resolve=>{releaseSend=resolve});
        return route.fulfill({json:{type:'rpc/error',id,error:'draft check: rejected'}});
      }
      return route.fulfill({json:{type:'rpc/result',id,result}});
    }
    if(url.pathname.startsWith('/api/')&&url.pathname!=='/api/config')return route.fulfill({json:{}});
    const response=await page.request.get((process.env.CODEX_WEBUI_TEST_URL||'http://127.0.0.1:8899')+url.pathname+url.search);
    await route.fulfill({response});
  });
  const loaded=()=>page.waitForFunction(()=>globalThis.__codexWebuiDebug?.state.active?.historyLoaded&&!globalThis.__codexWebuiDebug.state.active.cachePreview);
  const select=async id=>{await page.locator(`.thread-item[data-id="${id}"]`).click();await page.waitForFunction(id=>globalThis.__codexWebuiDebug.state.active?.id===id,id)};
  const draft=()=>page.evaluate(()=>({text:document.querySelector('#prompt').value,files:globalThis.__codexWebuiDebug.state.composerMentions.map(item=>item.path)}));
  await page.goto('http://tri-web.test/?thread=draft-a',{waitUntil:'domcontentloaded'});await loaded();
  await page.locator('#prompt').fill('A 的草稿');
  const uploadRequested=page.waitForRequest('**/api/attachments?*');
  await page.locator('#attachmentInput').setInputFiles({name:'draft.txt',mimeType:'text/plain',buffer:Buffer.from('draft')});
  await uploadRequested;
  const readRequested=page.waitForRequest(request=>request.url().endsWith('/api/rpc')&&request.postDataJSON().method==='thread/read'&&request.postDataJSON().params.threadId==='draft-b');
  await select('draft-b');await readRequested;
  assert.deepEqual(await draft(),{text:'',files:[]});
  await page.locator('#prompt').fill('B 的草稿');
  const uploaded=page.waitForResponse('**/api/attachments?*');releaseUpload();await uploaded;
  releaseRead();await loaded();
  assert.deepEqual(await draft(),{text:'B 的草稿',files:[]},'late history and uploads must not overwrite B');
  await select('draft-a');await loaded();
  await page.waitForFunction(()=>globalThis.__codexWebuiDebug.state.composerMentions[0]?.source==='upload');
  assert.deepEqual(await draft(),{text:'A 的草稿',files:['/tmp/draft.txt']});
  await page.reload({waitUntil:'domcontentloaded'});await loaded();
  assert.deepEqual(await draft(),{text:'A 的草稿',files:['/tmp/draft.txt']},'reload restores text and attachments');
  const sendRequested=page.waitForRequest(request=>request.url().endsWith('/api/rpc')&&request.postDataJSON().method==='turn/start');
  await page.locator('#sendButton').click();await sendRequested;
  await select('draft-b');await loaded();
  releaseSend();
  await page.waitForFunction(()=>JSON.parse(localStorage.getItem('codex-webui-workspace-view')).drafts['draft-a']?.text==='A 的草稿');
  assert.deepEqual(await draft(),{text:'B 的草稿',files:[]},'late send failure belongs to A');
  await select('draft-a');await loaded();
  assert.deepEqual(await draft(),{text:'A 的草稿',files:['/tmp/draft.txt']});
  await page.locator('#prompt').fill('');
  await page.locator('.composer-context-chip button').click();
  await select('draft-b');await loaded();
  await select('draft-a');await loaded();
  assert.deepEqual(await draft(),{text:'',files:[]},'cleared drafts stay cleared');
  await page.evaluate(()=>globalThis.__codexWebuiDebug.startNewTask());
  assert.deepEqual(await draft(),{text:'',files:[]});
  await select('draft-b');await loaded();
  assert.deepEqual(await draft(),{text:'B 的草稿',files:[]},'new task preserves existing drafts');
  assert.deepEqual(errors,[]);
  console.log('PASS: per-conversation drafts survive switching/reload; delayed history, uploads and failed sends stay with their original conversation');
}finally{await browser.close()}
