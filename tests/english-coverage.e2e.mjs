import assert from 'node:assert/strict';
import {launchOptions,artifact} from './browser-runtime.mjs';
import {writeFile,mkdir} from 'node:fs/promises';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const dir=artifact('english-coverage');await mkdir(dir,{recursive:true});
const browser=await chromium.launch(launchOptions()),report={codex:[],claude:[],errors:[]};
const capture=async(page,product,name)=>{
 await page.evaluate(()=>new Promise(requestAnimationFrame));
 const result=await page.evaluate(()=>{
  const han=/[\u3400-\u9fff]/,text=new Set,attrs=new Set;
  const visible=el=>el&&el.checkVisibility({checkOpacity:true,checkVisibilityCSS:true})&&!el.closest('script,style,textarea');
  const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);
  while(walker.nextNode()){const node=walker.currentNode,value=node.textContent.trim();if(value!=='简体中文'&&han.test(value)&&visible(node.parentElement))text.add(value)}
  for(const el of [...document.querySelectorAll('[aria-label],[title],[placeholder],[aria-valuetext]'),...document.querySelector('product-switcher')?.shadowRoot?.querySelectorAll('[aria-label]')||[]])if(visible(el))for(const key of ['aria-label','title','placeholder','aria-valuetext']){const value=el.getAttribute(key);if(value&&han.test(value))attrs.add(`${key}: ${value}`)}
  return {lang:document.documentElement.lang,text:[...text],attributes:[...attrs]};
 });
 report[product].push({screen:name,...result});assert.deepEqual(result.text,[],product+' '+name+' text');assert.deepEqual(result.attributes,[],product+' '+name+' attributes');console.log(product,name,JSON.stringify({text:result.text,attributes:result.attributes.slice(0,14)}));
};
try{
 for(const product of ['codex','claude']){
  const page=await browser.newPage({viewport:{width:1440,height:960},locale:'zh-CN'});page.setDefaultTimeout(6000);
  page.on('pageerror',e=>report.errors.push({product,error:e.message}));
  await page.addInitScript(()=>{
   if(window!==window.top)return;
   localStorage.setItem('codex-webui-locale','en');localStorage.setItem('claude_settings_v3',JSON.stringify({language:'en',theme:'light'}));
   window.CodexBrowser={hide(){}};
   window.EventSource=class{constructor(url){if(url==='/api/events')queueMicrotask(()=>this.onmessage?.({data:JSON.stringify({type:'bridge/status',status:'connected',instanceId:'audit',issuedAt:Date.now()})}))}close(){}};
   window.WebSocket=class{static OPEN=1;static CONNECTING=0;readyState=1;constructor(){queueMicrotask(()=>this.onopen?.())}send(){}close(){}addEventListener(){}removeEventListener(){}};
  });
  await page.route('**/api/**',async route=>{
   const url=new URL(route.request().url()),path=url.pathname;
   if(path.startsWith('/api/browser/local/'))return route.fulfill({status:502,contentType:'text/html',body:'<meta name="codex-browser-error" content="无法连接网站，请检查网址或稍后重试。"><p>无法连接网站，请检查网址或稍后重试。</p>'});
   if(path==='/api/rpc'){
    const {id,method}=route.request().postDataJSON();let result={data:[]};
    if(method==='model/list')result={data:[{id:'gpt-test',model:'gpt-test',displayName:'Test model',defaultReasoningEffort:'high',supportedReasoningEfforts:[{reasoningEffort:'low'},{reasoningEffort:'high'}]}]};
    if(method==='thread/list')result={data:[{id:'audit',name:'Audit conversation',projectless:true,cwd:'/tmp',turns:[]}],projects:[]};
    if(method==='thread/read')result={thread:{id:'audit',name:'Audit conversation',projectless:true,cwd:'/tmp',turns:[]}};
    return route.fulfill({json:{type:'rpc/result',id,result}});
   }
   if(!['GET','HEAD'].includes(route.request().method()))return route.abort();
   let result={};
   if(path==='/api/session-import/candidates')result=[];
   if(path==='/api/account')result={type:'chatgpt',displayName:'Audit user',planType:'pro'};
   if(path==='/api/account/usage')result={rateLimits:{primary:{windowDurationMins:300,usedPercent:20},secondary:{windowDurationMins:10080,usedPercent:10}}};
   if(path==='/api/config')result={home:'/tmp',defaultCwd:'/tmp'};
   if(path.endsWith('/api/projects'))result={projects:[]};
   if(path.includes('/sessions/recent'))result={conversations:[],total:0,hasMore:false};
   if(path.endsWith('/sessions/running'))result={sessions:[]};
   if(path.endsWith('/claude/workspace'))result={cwd:'/tmp',models:[{value:'default',resolvedModel:'sonnet',displayName:'Sonnet',description:'Sonnet',supportsEffort:true,supportedEffortLevels:['low','medium','high']}],commands:[],outputStyles:[]};
   if(path.endsWith('/claude/usage'))result={plan:'pro',usage:{five_hour:{utilization:20},seven_day:{utilization:30}}};
   if(path.endsWith('/scheduled-messages'))result={items:[]};
   if(path.endsWith('/claude/instructions'))result={path:'/tmp/CLAUDE.md',content:'',revision:'audit'};
   if(path.endsWith('/claude/statistics'))result={sessions:0,messages:0,activeDays:0,models:{},daily:{},updatedAt:new Date().toISOString()};
   if(path.endsWith('/claude/memory'))result={directory:'/tmp',files:[]};
   if(path.endsWith('/mcp/servers'))result={scopes:{user:[]}};
   return route.fulfill({json:result});
  });
  await page.goto((process.env.CODEX_WEBUI_URL||'http://127.0.0.1:8899')+(product==='claude'?'/claude/app/':'/?thread=audit'),{waitUntil:'domcontentloaded'});
  if(product==='codex'){
   await page.waitForFunction(()=>globalThis.__codexWebuiDebug?.state.active?.historyLoaded);
   await capture(page,product,'chat');
   await page.locator('[data-composer-control="add"]').click();await capture(page,product,'attachments');
   await page.locator('#attachFileButton').click();await capture(page,product,'upload');
   await page.keyboard.press('Escape');
   await page.locator('#threadMenuButton').click();await capture(page,product,'conversation-menu');await page.keyboard.press('Escape');
   await page.locator('#modeButton').click();await capture(page,product,'permissions');await page.keyboard.press('Escape');
   await page.locator('#modelButton').click();await capture(page,product,'effort');
   await page.locator('#modelSubmenuButton').click();await capture(page,product,'models');await page.keyboard.press('Escape');
   await page.locator('#accountButton').click();await page.locator('#accountUsage').click();await capture(page,product,'usage');await page.keyboard.press('Escape');
   for(const panel of ['Side','Summary','Bottom']){await page.locator('#toggle'+panel+'Panel').click();await capture(page,product,panel+'-panel');await page.locator('#toggle'+panel+'Panel').click();}
   for(const section of await page.locator('[data-settings-page]').evaluateAll(nodes=>nodes.map(n=>n.dataset.settingsPage))){
    await page.evaluate(section=>globalThis.__codexWebuiDebug.openSettings(section),section);await capture(page,product,'settings-'+section);
   }
   await page.evaluate(()=>globalThis.__codexWebuiDebug.openSettings('general-settings'));
   await page.locator('#languageSelect').selectOption('zh-CN');
   assert.equal(await page.locator('#languageSelect option[value="zh-CN"]').textContent(),'简体中文');
   await page.locator('#languageSelect').selectOption('en');await capture(page,product,'language-roundtrip');
   await page.evaluate(()=>globalThis.__codexWebuiDebug.closeSettings());
   await page.locator('#newTask').click();await capture(page,product,'new-chat');
   await page.evaluate(()=>{delete window.CodexBrowser;});
   await page.locator('#toggleSidePanel').click();await page.locator('[data-side-panel-action="browser"]').click();
   await page.evaluate(()=>globalThis.__codexWebuiDebug.navigateBrowser('https://example.test'));
   await page.locator('#browserNoticeDescription').filter({hasText:'Could not connect'}).waitFor();await capture(page,product,'browser-error');
   const errorCopy=page.frameLocator('#browserFrame').locator('p');
   assert.match(await errorCopy.textContent(),/^Could not connect/);
   await page.evaluate(()=>globalThis.__codexWebuiI18n.setPreference('zh-CN'));assert.match(await errorCopy.textContent(),/无法连接/);
   await page.evaluate(()=>globalThis.__codexWebuiI18n.setPreference('en'));assert.match(await errorCopy.textContent(),/^Could not connect/);
  }else{
   await page.locator('textarea[aria-label="Messages"]').waitFor();await capture(page,product,'chat');
   await page.getByRole('button',{name:'Add',exact:true}).click();await capture(page,product,'attachments');await page.keyboard.press('Escape');
   for(const label of ['Permission mode','Select model','Reasoning','View plan usage']){
    await page.getByRole('button',{name:label,exact:true}).click();await capture(page,product,label);await page.keyboard.press('Escape');
   }
   await page.locator('textarea[aria-label="Messages"]').fill('/');await capture(page,product,'commands');await page.locator('textarea[aria-label="Messages"]').fill('');
   await page.getByRole('button',{name:'Projects',exact:true}).first().click();await capture(page,product,'projects');
   await page.getByRole('button',{name:'Add project',exact:true}).click();await capture(page,product,'add-project');
   await page.getByRole('button',{name:'Scheduled tasks',exact:true}).click();
   await page.getByRole('button',{name:'New task',exact:true}).click();await capture(page,product,'scheduled');
   await page.getByRole('button',{name:'Settings',exact:true}).click();
   for(const tab of ['Appearance & language','Account & usage','Instructions for Claude','Memory','Skills & MCP']){
    await page.getByRole('button',{name:tab,exact:true}).click();
    if(tab==='Instructions for Claude')await page.getByRole('button',{name:'Save',exact:true}).waitFor();
    if(tab==='Memory')await page.getByText('No Claude Code auto-memory files in this working directory yet.',{exact:true}).waitFor();
    await capture(page,product,tab.split(' ')[0].toLowerCase());
   }
   await page.getByRole('button',{name:'Appearance & language',exact:true}).click();
   await page.locator('select:has(option[value="zh"])').selectOption('zh');
   await page.locator('select:has(option[value="zh"])').selectOption('en');await capture(page,product,'language-roundtrip');
   await page.getByRole('button',{name:'Close settings',exact:true}).click();await capture(page,product,'after-language-switch');
  }
  await page.unrouteAll({behavior:'ignoreErrors'});await page.close();
 }
 assert.deepEqual(report.errors,[]);console.log('PASS: '+(report.codex.length+report.claude.length)+' English DOM states, no untranslated UI text or attributes');
}finally{await writeFile(`${dir}/report.json`,JSON.stringify(report,null,2));await browser.close()}
