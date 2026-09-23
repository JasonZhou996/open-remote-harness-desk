import assert from 'node:assert/strict';
import {launchOptions} from './browser-runtime.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch(launchOptions());
try{
  const page=await browser.newPage({viewport:{width:1280,height:850}}),errors=[],calls=[];
  const old={id:'old',status:'completed',items:[{id:'u0',type:'userMessage',content:[{type:'text',text:'较早的问题'}]},{id:'a0',type:'agentMessage',text:'较早的回答'}]};
  const recent={id:'recent',status:'completed',items:[{id:'u1',type:'userMessage',content:[{type:'text',text:'当前问题'}]},{id:'a1',type:'agentMessage',text:'## Markdown 标题\n\n当前回答'}]};
  const oldest={id:'oldest',status:'completed',items:[{id:'u-1',type:'userMessage',content:[{type:'text',text:'尚未加载的最早问题'}]}]};
  let threads=[{id:'menu-fixture',name:'菜单检查',cwd:'/tmp/menu-project',source:'local',pinned:false,status:{type:'idle'},turns:[old,recent],olderTurnsCursor:'older'}];
  page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>{if(window!==window.top)return;window.CodexBrowser={hide(){}};localStorage.setItem('codex-webui-locale','zh-CN');Object.defineProperty(navigator,'clipboard',{value:{writeText:async text=>window.copiedText=text},configurable:true});});
  await page.route('**/api/rpc',async route=>{
    const payload=route.request().postDataJSON(),{method,params}=payload;calls.push({method,params});let result;
    const thread=threads.find(t=>t.id===params.threadId);
    if(method==='thread/list')result={data:threads};
    else if(method==='thread/read'&&thread)result={thread};
    else if(method==='thread/turns/list'&&thread)result={data:[old,oldest],nextCursor:null};
    else if(method==='host/thread/live'&&thread)result={active:false,turn:recent};
    else if(method==='thread/name/set'&&thread){thread.name=params.name;result={};}
    else if(method==='host/thread/pin'&&thread){thread.pinned=params.pinned;result={};}
    else if(method==='thread/archive'&&thread){threads=threads.filter(t=>t.id!==thread.id);result={};}
    else if(method==='thread/fork'&&thread){const child={...thread,id:'fork-fixture',pinned:false};threads.push(child);result={thread:child};}
    else return route.continue();
    await route.fulfill({json:{type:'rpc/result',id:payload.id,result}});
  });
  const url=process.env.CODEX_WEBUI_TEST_URL||'http://127.0.0.1:8899';
  await page.goto(`${url}/?thread=menu-fixture`,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>globalThis.__codexWebuiDebug?.state?.active?.id==='menu-fixture');
  assert.ok(await page.locator('#threadPath').isHidden());
  const open=async()=>{await page.locator('#threadMenuButton').click();await page.locator('#threadMenu:popover-open').waitFor();};
  const action=name=>page.locator(`[data-thread-action="${name}"]`);
  await open();
  assert.deepEqual(await page.locator('#threadMenu > button').allTextContents(),['重命名','置顶','归档','分叉']);
  assert.equal(await page.locator('#threadMenu kbd').count(),0);
  await page.locator('#threadCopyButton').click();
  assert.deepEqual(await page.locator('#threadCopyMenu button').allTextContents(),['复制工作目录','复制深度链接','复制为 Markdown']);
  await page.screenshot({path:'/tmp/codex-thread-menu-desktop-20260921.png'});
  await action('copy-directory').click();await page.waitForFunction(()=>window.copiedText==='/tmp/menu-project');
  await page.evaluate(()=>{Object.defineProperty(navigator,'clipboard',{value:undefined,configurable:true});document.addEventListener('copy',()=>window.fallbackCopied=document.activeElement?.value,{once:true});});
  await open();await page.locator('#threadCopyButton').click();await action('copy-directory').click();await page.waitForFunction(()=>window.fallbackCopied==='/tmp/menu-project');
  await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{value:{writeText:async text=>window.copiedText=text},configurable:true}));
  await open();await page.locator('#threadCopyButton').click();await action('copy-link').click();
  await page.waitForFunction(()=>window.copiedText?.includes('?thread=menu-fixture'));
  const deepLink=await page.evaluate(()=>window.copiedText);assert.equal(new URL(deepLink).searchParams.get('thread'),'menu-fixture');
  await open();await page.locator('#threadCopyButton').click();await action('copy-markdown').click();
  await page.waitForFunction(()=>window.copiedText?.includes('较早的问题'));
  assert.match(await page.evaluate(()=>window.copiedText),/尚未加载的最早问题[\s\S]*较早的问题[\s\S]*较早的回答[\s\S]*当前问题[\s\S]*## Markdown 标题/);
  assert.equal(await page.evaluate(()=>window.copiedText.split('较早的问题').length-1),1,'desktop history overlapping older pages must not duplicate messages');
  await open();page.once('dialog',dialog=>dialog.accept('改名后的对话'));await action('rename').click();
  await page.waitForFunction(()=>document.querySelector('#threadTitle').textContent==='改名后的对话');
  await open();await action('pin').click();await page.waitForFunction(()=>globalThis.__codexWebuiDebug.state.active.pinned);
  assert.equal(await page.locator('.sidebar-section-label').first().textContent(),'置顶');
  await page.reload({waitUntil:'domcontentloaded'});await page.waitForFunction(()=>globalThis.__codexWebuiDebug?.state?.active?.pinned);
  await open();assert.equal(await page.locator('#threadPinLabel').textContent(),'取消置顶');await action('pin').click();
  await page.waitForFunction(()=>!globalThis.__codexWebuiDebug.state.active.pinned);
  await open();await action('fork').click();await page.waitForFunction(()=>globalThis.__codexWebuiDebug.state.active?.id==='fork-fixture');
  assert.equal(calls.find(call=>call.method==='thread/fork').params.deferGoalContinuation,true);
  await open();await action('archive').click();await page.waitForFunction(()=>!globalThis.__codexWebuiDebug.state.active);
  assert.ok(await page.locator('#threadMenuButton').isHidden());
  assert.equal(new URL(page.url()).searchParams.has('thread'),false);
  await page.goto(deepLink,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>globalThis.__codexWebuiDebug?.state?.active?.id==='menu-fixture');
  await page.setViewportSize({width:390,height:844});await open();
  await page.locator('#threadCopyButton').focus();await page.keyboard.press('ArrowRight');
  const menu=await page.locator('#threadMenu').boundingBox(),copy=await page.locator('#threadCopyMenu').boundingBox();
  assert.ok(menu.x>=0&&menu.x+menu.width<=390&&copy.x>=0&&copy.x+copy.width<=390);
  await page.screenshot({path:'/tmp/codex-thread-menu-mobile-20260921.png'});
  await page.keyboard.press('Escape');assert.ok(await page.locator('#threadCopyMenu').isHidden());
  await page.keyboard.press('Escape');assert.equal(await page.locator('#threadMenu:popover-open').count(),0);
  assert.deepEqual(errors,[]);
  console.log('PASS: exact menu, hidden path, rename, pin/reload/unpin, paginated Markdown, directory/link copy, deep link, fork/archive, mobile and keyboard');
}finally{await browser.close();}
