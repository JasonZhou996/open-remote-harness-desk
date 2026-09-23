import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {chromium} from 'playwright';
const root=new URL('../web/codex/',import.meta.url),html=readFileSync(new URL('index.html',root),'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,'').replace(/<link\b[^>]*>/g,''),css=readFileSync(new URL('style.css',root),'utf8'),app=readFileSync(new URL('app.js',root),'utf8');
const section=(a,b)=>app.slice(app.indexOf(a),app.indexOf(b,app.indexOf(a)));
const browser=await chromium.launch({headless:true,executablePath:'/usr/bin/google-chrome'});
try{
 for(const [width,mobile,theme] of [[390,true,'light'],[674,true,'dark'],[840,true,'light'],[1440,false,'dark']]){
  const page=await browser.newPage({viewport:{width,height:850},colorScheme:theme});
  await page.setContent(html);await page.addStyleTag({content:css});await page.evaluate(m=>document.documentElement.classList.toggle('mobile-device',m),mobile);
  await page.addScriptTag({content:`const $=s=>document.querySelector(s);let sidePanelReturnFocus=null,summaryPanelReturnFocus=null,sidebarLayoutMobile=null;function setSidePanelView(){}function syncSummaryPanel(){}function renderChanges(){}\n`+
   app.match(/function mobileSidebarEnabled\([^\n]+/)[0]+'\n'+section('let rightPanelWidth=', 'function setBrowserStatus(')+section('function setSidePanelOpen(', 'function closeImageViewer(')+
   app.split('\n').filter(l=>l.startsWith("$('#panelBackdrop').onclick=")||l.startsWith("document.querySelector('.conversation-shell').addEventListener('pointerdown'")).join('\n')+'\nbindPanelResizers();'});
  await page.evaluate(()=>{setSidebarOpen(false);setSidePanelOpen(true,false)});
  const geometry=await page.evaluate(()=>({panel:$('#sidePanel').getBoundingClientRect().toJSON(),main:$('.conversation-shell').getBoundingClientRect().toJSON(),overlay:overlayPanelsEnabled()}));
  if(width<600){assert.equal(geometry.overlay,true);assert.ok(geometry.panel.x>=47);await page.mouse.click(10,300);assert.equal(await page.locator('#sidePanel').isHidden(),true)}
  else{
   assert.equal(geometry.overlay,false);assert.ok(geometry.main.width>=359);
   await page.mouse.click(geometry.main.x+20,300);assert.equal(await page.locator('#sidePanel').isVisible(),true);
   const handle=await page.locator('#sidePanel .panel-resizer').boundingBox();
   await page.mouse.move(handle.x+4,handle.y+100);await page.mouse.down();await page.mouse.move(104,handle.y+100,{steps:10});await page.mouse.up();
   const grown=await page.evaluate(()=>({panel:$('#sidePanel').getBoundingClientRect().toJSON(),main:$('.conversation-shell').getBoundingClientRect().toJSON(),overlay:overlayPanelsEnabled()}));
   assert.equal(grown.overlay,true);assert.ok(Math.abs(grown.main.width-360)<2);assert.ok(grown.panel.x<grown.main.right);assert.ok(grown.panel.width>geometry.panel.width);
  }
  await page.evaluate(()=>{setSidePanelOpen(false);setSummaryPanelOpen(true);const content=$('.summary-panel-scroll');content.innerHTML='<div style="height:2400px">scroll content</div>';content.scrollTop=500});
  assert.equal(await page.locator('.summary-panel-scroll').evaluate(e=>e.scrollTop),500);
  await page.evaluate(()=>{setSummaryPanelOpen(false);setSidePanelOpen(true,false);const body=$('#sidePanelLauncher');body.innerHTML='<div style="height:2400px">scroll content</div>';body.scrollTop=500});
  assert.equal(await page.locator('#sidePanelLauncher').evaluate(e=>e.scrollTop),500);
  await page.evaluate(()=>setSidePanelOpen(false));
  if(mobile){await page.evaluate(()=>setSidebarOpen(true));await page.waitForTimeout(250);await page.mouse.click(width-12,300);assert.equal(await page.locator('#sidebar').evaluate(e=>e.classList.contains('mobile-open')),false)}
  await page.addScriptTag({content:`const state={config:{defaultCwd:'/tmp'}};function currentComposerCwd(){return '/tmp'}function handlePromptInput(){}function syncComposerSubmitState(){}function closeComposerAutocomplete(){}function uploadAttachments(){}async function rpc(){return {data:[{skills:[{name:'sample',description:'Skill description',path:'/tmp/sample/SKILL.md',enabled:true}]}]}}\n`+section('function closeAttachmentMenu()', 'let attachmentsUploading=')+section(`document.querySelector('[data-composer-control="add"]').onclick=`,`document.querySelector('[data-composer-control="dictation"]').onclick=`)});
  await page.locator('[data-composer-control="add"]').click();
  const menu=await page.locator('#attachmentMenu').boundingBox(),composer=await page.locator('#composer').boundingBox();assert.ok(menu.y+menu.height<=composer.y);assert.ok(Math.abs(menu.width-composer.width)<4);
  assert.equal(await page.locator('#attachGoalButton').count(),0);
  const colors=await page.locator('#attachmentMenu').evaluate(e=>({bg:getComputedStyle(e).backgroundColor,fg:getComputedStyle(e).color}));assert.notEqual(colors.bg,colors.fg);console.log(width,theme,colors);
  await page.locator('#attachFileButton').click();const chooserReady=page.waitForEvent('filechooser');await page.locator('#uploadFileButton').click();assert.equal(await (await chooserReady).element().getAttribute('accept'),'*/*');
  await page.locator('[data-composer-control="add"]').click();await page.locator('#attachFileButton').click();const folderReady=page.waitForEvent('filechooser');await page.locator('#uploadFolderButton').click();assert.equal(await (await folderReady).element().getAttribute('webkitdirectory'),'');
  await page.locator('[data-composer-control="add"]').click();await page.locator('#skillChoices button').click();assert.match(await page.locator('#prompt').inputValue(),/sample.*SKILL.md/);
  await page.addScriptTag({content:`Object.defineProperty(window,'localStorage',{value:{setItem(){}}});const sentSettings=[];function sendDesktopSettings(value){sentSettings.push(value)}function toast(){}function escapeHtml(s){return String(s)}function codexIcon(){return '<span></span>'}function reasoningLabel(v){return v}function modelDisplay(m){return m.displayName}function selectedModel(){return {displayName:'GPT-6 Astra',defaultReasoningEffort:'high'}}\n`+section('function renderModelMenuMain()', 'const permissionModes=')});
  await page.evaluate(()=>{state.selectedModel='gpt-6-astra';$('#modelLabel').textContent='GPT-6 Astra';$('#modeButton .control-label').textContent='完全访问';$('#effortSelect').innerHTML=['low','medium','high','xhigh','max','ultra'].map(v=>`<option value="${v}" ${v==='high'?'selected':''}>${v}</option>`).join('');openModelMenu()});
  assert.equal(await page.locator('#effortRange').inputValue(),'2');
  await page.locator('#effortRange').focus();await page.keyboard.press('End');
  assert.equal(await page.locator('#effortLabel').textContent(),'ultra');
  assert.equal(await page.evaluate(()=>sentSettings.at(-1).effort),'ultra');
  const effortBounds=await page.locator('#modelMenu').boundingBox();assert.ok(effortBounds.x>=0);assert.ok(effortBounds.x+effortBounds.width<=width+1);
  await page.locator('#resetEffort').click();assert.equal(await page.locator('#effortRange').inputValue(),'2');
  await page.screenshot({path:`/tmp/webui-composer-${width}.png`});
  await page.close();
 }
 console.log('Offline layout: drag dock-to-overlay at 360px main minimum, scroll, dismiss, themed anchored menu, file/folder chooser and Skill passed.');
}finally{await browser.close()}
