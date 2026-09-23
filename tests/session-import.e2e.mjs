import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
import {launchOptions} from './browser-runtime.mjs';
const browser=await chromium.launch(launchOptions()),base=process.env.CODEX_WEBUI_URL||'http://127.0.0.1:8899';
const projectPath='/home/user/project',projectId='import-project',other='11111111-1111-4111-8111-111111111111';
const sourceId='22222222-2222-4222-8222-222222222222';
try{for(const target of ['codex','claude']){
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];let sends=0;
  const capture=async(view)=>{for(const theme of ['light','dark']){
    await page.evaluate(({target,theme})=>{document.documentElement.dataset.theme=theme;if(target==='claude')document.documentElement.classList.toggle('light',theme==='light');},{target,theme});
    await page.waitForTimeout(350);
    await page.screenshot({path:`/tmp/tri-import-${target}-${view}-${theme}.png`});
  }};
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(({target,projectPath,projectId})=>{
    if(window!==window.top)return;
    if(target==='codex'){window.CodexBrowser={hide(){}};localStorage.setItem('codex-webui-project',projectPath);}
    else if(!localStorage.getItem('claude-workspace-view'))localStorage.setItem('claude-workspace-view',JSON.stringify({page:'chat',projectId}));
    const Original=window.EventSource;
    window.__importStreams=[];window.__jobs=[];
    window.__importEmit=jobs=>{window.__jobs=jobs;sessionStorage.setItem('import-test-jobs',JSON.stringify(jobs));window.__importStreams.forEach(e=>e.onmessage?.({data:JSON.stringify(jobs)}));};
    window.EventSource=class extends EventTarget{
      constructor(url){super();if(!url.includes('session-import'))return new Original(url);window.__importStreams.push(this);setTimeout(()=>this.onmessage?.({data:sessionStorage.getItem('import-test-jobs')||'[]'}),0);}
      close(){window.__importStreams=window.__importStreams.filter(e=>e!==this);}
    };
  },{target,projectPath,projectId});
  const job={id:'import-33333333-3333-4333-8333-333333333333',target,sourceId,projectPath,title:'导入验证会话',status:'running',stage:0,createdAt:Date.now(),targetId:'44444444-4444-4444-8444-444444444444'};
  await page.route('**/api/session-import/candidates?*',route=>{assert.equal(new URL(route.request().url()).searchParams.get('projectPath'),projectPath);return route.fulfill({json:[{id:sourceId,title:'可导入来源'}]});});
  await page.route('**/api/session-import/start',async route=>{await route.fulfill({json:job});await page.evaluate(j=>window.__importEmit([j]),job);});
  if(target==='codex'){
    const thread={id:other,name:'其他对话',cwd:projectPath,projectId,canAcceptDirectInput:true,status:{type:'idle'},turns:[{id:'t',status:'completed',items:[{id:'a',type:'agentMessage',text:'原有回答'}]}]};
    const existing=[thread,...Array.from({length:5},(_,i)=>({...thread,id:'existing-'+i,name:'已有会话 '+i}))];
    await page.route('**/api/rpc',async route=>{
      const d=route.request().postDataJSON();let result;
      if(d.method==='thread/list')result={data:existing,projects:[{id:projectId,name:'项目',roots:[projectPath],threadIds:existing.map(t=>t.id)}]};
      else if(d.params?.threadId===other){
        if(d.method==='turn/start'){sends++;result={turn:{id:'new',status:'inProgress',items:[]}};await page.evaluate(({other})=>window.__codexWebuiDebug.notify('item/completed',{threadId:other,turnId:'new',item:{id:'reply',type:'agentMessage',text:'其他对话正常回答'}}),{other});}
        else if(d.method==='thread/read'||d.method==='thread/resume')result={thread};
        else if(d.method==='thread/turns/list')result={data:thread.turns};
        else result={active:false,turn:null};
      }else return route.continue();
      await route.fulfill({json:{type:'rpc/result',id:d.id,result}});
    });
  }else{
    await page.route('**/claude/app/api/projects',route=>route.fulfill({json:[{projectId,displayName:'项目',fullPath:projectPath}]}));
    await page.route('**/claude/app/api/providers/sessions/recent?*',route=>route.fulfill({json:{data:{conversations:[{sessionId:other,sessionTitle:'其他对话',projectId}]}}}));
    await page.route(`**/claude/app/api/providers/sessions/${other}/messages`,route=>route.fulfill({json:{data:{messages:[{id:'original',kind:'text',role:'assistant',content:'原有回答'}]}}}));
    await page.route(`**/claude/app/api/providers/sessions/${other}/permission-mode`,route=>route.fulfill({json:{data:{mode:'default'}}}));
    await page.route(`**/claude/app/api/providers/claude/sessions/${other}/active-model?*`,route=>route.fulfill({json:{data:{model:'default'}}}));
    await page.routeWebSocket('**/claude/app/ws*',ws=>{ws.onMessage(raw=>{const d=JSON.parse(raw);if(d.type==='chat.send'){sends++;ws.send(JSON.stringify({kind:'text',sessionId:d.sessionId,content:'其他对话正常回答',role:'assistant'}));ws.send(JSON.stringify({kind:'complete',sessionId:d.sessionId}));}});});
  }
  await page.goto(base+(target==='codex'?'/':'/claude/app/'),{waitUntil:'domcontentloaded'});
  await page.getByRole('button',{name:`从 ${target==='codex'?'Claude Code':'Codex'} 导入对话`,exact:true}).click({timeout:30000});
  await page.getByRole('button',{name:'可导入来源',exact:true}).waitFor();
  const picker=page.locator('.session-import-picker');
  assert.equal(await picker.evaluate(el=>el.matches(':popover-open')),true);
  const bounds=await picker.boundingBox();assert.ok(bounds.x>=0&&bounds.y>=0&&bounds.x+bounds.width<=1440);
  await capture('picker');
  await page.setViewportSize({width:390,height:844});
  const mobilePicker=await picker.boundingBox();assert.ok(mobilePicker.x>=0&&mobilePicker.y>=0&&mobilePicker.x+mobilePicker.width<=390);
  await page.screenshot({path:`/tmp/tri-import-${target}-picker-mobile.png`});
  await page.setViewportSize({width:1440,height:1000});
  await page.keyboard.press('Escape');assert.equal(await picker.isVisible(),false);
  await page.getByRole('button',{name:`从 ${target==='codex'?'Claude Code':'Codex'} 导入对话`,exact:true}).click();
  await page.getByRole('button',{name:'可导入来源',exact:true}).click();
  await page.locator('.session-import-progress').waitFor();
  if(target==='codex')assert.equal(await page.locator(`[data-id="${job.id}"]`).isVisible(),true,'import stays visible in a project with more than five chats');
  if(target==='claude')assert.equal(await page.locator('header').getByText(job.title,{exact:true}).count(),1);
  for(let stage=0;stage<4;stage++){await page.evaluate(j=>window.__importEmit([j]),{...job,stage});assert.equal(await page.locator('.session-import-steps [aria-current="step"]').textContent(),['读取','转换','写入','校验'][stage]);}
  await capture('progress');
  // An existing conversation remains interactive while this import is active.
  if(target==='codex')await page.locator(`[data-id="${other}"]`).click();
  else await page.getByText('其他对话',{exact:true}).click();
  const input=target==='codex'?page.locator('#prompt'):page.locator('textarea').first();
  await input.fill('检查其他对话');
  if(target==='codex')await page.locator('#composer').evaluate(el=>el.requestSubmit());else await input.press('Enter');
  await page.getByText('其他对话正常回答',{exact:true}).waitFor();assert.equal(sends,1);
  await page.evaluate(j=>window.__importEmit([j]),{...job,status:'failed',error:'测试错误',stage:3});
  assert.equal(await page.locator('.session-import-progress').count(),0,'background status does not steal focus');
  await page.getByText(job.title,{exact:true}).first().click();
  await page.getByRole('button',{name:'重试',exact:true}).waitFor();
  for(const theme of ['light','dark']){
    await page.evaluate(({target,theme})=>{document.documentElement.dataset.theme=theme;if(target==='claude'){document.documentElement.classList.toggle('light',theme==='light');}}, {target,theme});
    await page.waitForTimeout(300); // Let the existing theme transition finish before capturing.
    await page.screenshot({path:`/tmp/tri-import-${target}-${theme}.png`});
  }
  await page.reload({waitUntil:'domcontentloaded'});await page.getByRole('button',{name:'重试',exact:true}).waitFor();
  await page.setViewportSize({width:390,height:844});assert.equal(await page.locator('.session-import-steps li').count(),4);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  assert.deepEqual(errors,[]);console.log(`PASS ${target}: picker, four stages, other chat send/reply, focus, refresh, mobile`);await page.close();
}}finally{await browser.close();}
