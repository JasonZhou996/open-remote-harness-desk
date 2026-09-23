import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH||'/usr/bin/google-chrome'});
const nativeScript=readFileSync('android/assets/workspace-resume.js','utf8');
const bundle=process.env.CODEX_RESUME_BUNDLE;
let nativeState={};const errors=[];
const thread={id:'resume-fixture',name:'Workspace restoration check',cwd:'/home/user/project',turns:[{id:'turn',status:'completed',items:[{id:'answer',type:'agentMessage',phase:'final_answer',text:Array.from({length:70},(_,i)=>`Line ${i}: saved conversation position.`).join('\n\n')}]}]};
async function open(base){
  const context=await browser.newContext({viewport:{width:840,height:900}});
  await context.exposeBinding('saveNativeWorkspace',(_,body)=>{const {key,value}=JSON.parse(body);nativeState[key]=value;});
  await context.addInitScript(`window.CodexWorkspaceState={postMessage:body=>window.saveNativeWorkspace(body)};(${nativeScript})(${JSON.stringify(nativeState)},'new-webview');`);
  if(bundle)await context.route('**/app.bundle.js*',route=>route.fulfill({path:bundle,contentType:'application/javascript'}));
  await context.routeWebSocket('**/ws',socket=>{
    socket.onMessage(raw=>{const m=JSON.parse(raw);let result={};
      if(m.method==='thread/read')result={thread};
      else if(m.method==='thread/list')result={data:[thread]};
      else if(m.method==='model/list'||m.method==='permissionProfile/list')result={data:[]};
      socket.send(JSON.stringify({type:'rpc/result',id:m.id,result}));
    });
    socket.send(JSON.stringify({type:'bridge/status',status:'connected'}));
  });
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base);
  await page.waitForFunction(()=>window.__codexWebuiDebug?.state.connected);
  return{page,context};
}
try{
  let {page,context}=await open('http://127.0.0.1:8899');
  await page.evaluate(()=>window.__codexWebuiDebug.openThread('resume-fixture'));
  await page.waitForSelector('[data-turn-id="turn"]');
  await page.evaluate(()=>{
    const a=document.createElement('a');a.href='#';a.dataset.fileReference='/home/user/project/README.md';document.body.append(a);a.click();a.remove();
  });
  await page.waitForFunction(()=>document.querySelector('#filePanelBody').textContent.includes('8899'));
  await page.locator('#prompt').fill('unsent draft');
  await page.evaluate(()=>{const el=document.querySelector('#conversation');el.scrollTop=230;el.dispatchEvent(new Event('scroll'));window.dispatchEvent(new Event('workspace-save'));});
  await page.waitForFunction(()=>JSON.parse(localStorage.getItem('codex-webui-workspace-view')).scrollTop===230);
  await context.close();
  assert.equal(JSON.parse(nativeState['codex-webui-workspace-view']).file.kind,'file');
  ({page,context}=await open('http://localhost:8899'));
  await page.waitForSelector('[data-turn-id="turn"]');
  await page.waitForFunction(()=>document.querySelector('#filePanelBody').textContent.includes('8899'));
  assert.equal(await page.locator('#prompt').inputValue(),'unsent draft');
  assert.equal(await page.locator('#sidePanel').evaluate(el=>el.hidden),false);
  assert.equal(await page.locator('#conversation').evaluate(el=>el.scrollTop),230);
  await page.locator('#closeSidePanel').click();
  await page.evaluate(()=>window.__codexWebuiDebug.startNewTask());
  await page.evaluate(()=>window.dispatchEvent(new Event('workspace-save')));
  await context.close();
  ({page,context}=await open('http://127.0.0.1:8899'));
  assert.equal(await page.evaluate(()=>window.__codexWebuiDebug.state.active),null);
  assert.equal(await page.locator('#sidePanel').evaluate(el=>el.hidden),true);
  await context.close();
  assert.deepEqual(errors,[]);
  console.log('PASS: new WebView and different origin restore thread, scroll, file preview and draft; new chat and closed pane remain closed');
}finally{await browser.close();}
