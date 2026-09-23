import assert from 'node:assert/strict';
import {launchOptions} from './browser-runtime.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const user=(id,text)=>({id,type:'userMessage',content:[{type:'text',text}]});
const message=(id,text,phase)=>({id,type:'agentMessage',text,...(phase?{phase}:{})});
const thought=id=>({id,type:'reasoning',summary:['Checking the next step'],status:'completed'});
const command=id=>({id,type:'commandExecution',command:'printf done',aggregatedOutput:'done',status:'completed'});
const items=[user('u1','原问题'),message('a1','第一段','commentary'),thought('r1'),message('a2','第二段'),command('tool1'),thought('rTool'),command('tool2'),user('u2','追加问题'),thought('r2'),message('a3','第三段','commentary'),user('u3','再次追加'),thought('r3'),{id:'item-answer',type:'agentMessage',phase:'final_answer',content:[{type:'output_text',text:'最后答案'}]}];
let turn={id:'timeline-turn',status:'inProgress',items:[]};
const thread=()=>({id:'timeline-test',name:'Timeline check',cwd:'/tmp',status:{type:turn.status==='inProgress'?'active':'idle'},turns:[turn]});
const browser=await chromium.launch(launchOptions());
try {
  const page=await browser.newPage({viewport:{width:1280,height:850}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{if(window!==window.top)return;window.CodexBrowser={hide(){}};localStorage.setItem('codex-webui-locale','en');window.EventSource=class {constructor(url){if(url==='/api/events')queueMicrotask(()=>this.onmessage?.({data:JSON.stringify({type:'bridge/status',status:'connected'})}))}close(){}}});
  if(process.env.CODEX_WEBUI_TEST_BUNDLE)await page.route('**/app.bundle.js*',route=>route.fulfill({path:process.env.CODEX_WEBUI_TEST_BUNDLE,contentType:'application/javascript'}));
  await page.route('**/api/rpc',async route=>{
    const {id,method}=route.request().postDataJSON();
    const result=method==='thread/read'?{thread:thread()}:method==='thread/list'?{data:[thread()],projects:[]}:method==='host/thread/live'?{active:turn.status==='inProgress',turn}:method==='thread/turns/list'?{data:[turn]}:{data:[]};
    await route.fulfill({json:{type:'rpc/result',id,result}});
  });
  await page.goto((process.env.CODEX_WEBUI_TEST_URL||'http://127.0.0.1:8899')+'/?thread=timeline-test',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>globalThis.__codexWebuiDebug?.state.active?.historyLoaded&&!globalThis.__codexWebuiDebug.state.active.cachePreview);
  const order=()=>page.evaluate(()=>{
    const result=[];
    for(const node of document.querySelectorAll('#conversation .user-message,#conversation .assistant-response>.message-text,#conversation .activity-item:not(.reasoning-activity)'))result.push(node.dataset.itemId||node.textContent.trim());
    return result;
  });
  const chronological=['原问题','第一段','第二段','tool1','tool2','追加问题','第三段','再次追加','最后答案'];
  // Delayed reasoning/tool events carry their desktop index, not arrival order.
  turn={...turn,items};
  await page.evaluate(items=>{
    const api=globalThis.__codexWebuiDebug;
    for(const i of [...items.keys()].filter(i=>items[i].type!=='reasoning').concat([...items.keys()].filter(i=>items[i].type==='reasoning'))){if(items[i].id==='item-answer')api.notify('item/agentMessage/delta',{turnId:'timeline-turn',itemId:'item-answer',delta:'最后'});api.notify('item/completed',{turnId:'timeline-turn',item:items[i],itemIndex:i})}
  },items);
  assert.deepEqual(await order(),chronological);
  assert.equal(await page.locator('.turn-final-slot .assistant-response').count(),0);
  assert.equal(await page.locator('.turn-work').evaluate(el=>el.open),true);
  await page.locator('.activity-group:not(.single) .activity-summary').click();
  await page.locator('[data-item-id="tool1"]').click();
  assert.equal(await page.locator('[data-item-id="tool1"]').getAttribute('aria-expanded'),'true');
  const processBlock=page.locator('.activity-group').filter({has:page.locator('[data-item-id="tool1"]')});
  assert.equal(await processBlock.locator('.activity-item:not(.reasoning-activity)').count(),2);
  await page.evaluate(()=>globalThis.__codexWebuiDebug.notify('item/started',{turnId:'timeline-turn',item:{id:'rTool',type:'reasoning',summary:['Thinking']}}));
  await processBlock.locator('.activity-summary').click();
  await page.evaluate(()=>globalThis.__codexWebuiDebug.notify('item/reasoning/summaryTextDelta',{turnId:'timeline-turn',itemId:'rTool',summaryIndex:0,delta:' more'}));
  assert.equal(await processBlock.locator('.activity-items').isVisible(),false,'running reasoning stays folded');
  await processBlock.locator('.activity-summary').click();
  // A partial snapshot must not discard earlier reasoning or newer followups.
  await page.evaluate(items=>globalThis.__codexWebuiDebug.syncTurnSnapshot({id:'timeline-turn',status:'inProgress',items:items.slice(0,6).filter(i=>i.id!=='r1')}),items);
  assert.deepEqual(await order(),chronological);
  assert.equal(await page.locator('[data-item-id="tool1"]').getAttribute('aria-expanded'),'true');
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>globalThis.__codexWebuiDebug?.state.active?.historyLoaded&&!globalThis.__codexWebuiDebug.state.active.cachePreview);
  assert.deepEqual(await order(),chronological,'running reload');
  await page.evaluate(()=>globalThis.__codexWebuiDebug.notify('item/completed',{turnId:'timeline-turn',item:{id:'msg_alias',type:'agentMessage',text:'最后答案',phase:'final_answer'}}));
  turn={...turn,status:'completed',durationMs:65000};
  await page.evaluate(turn=>globalThis.__codexWebuiDebug.notify('turn/completed',{turn}),turn);
  await page.evaluate(turn=>globalThis.__codexWebuiDebug.syncTurnSnapshot({...turn,status:'inProgress'}),turn);
  const completed=['原问题','追加问题','再次追加','第一段','第二段','tool1','tool2','第三段','最后答案'];
  assert.deepEqual(await order(),completed);
  assert.equal(await page.locator('.turn-work').evaluate(el=>el.open),false);
  assert.equal((await page.locator('.turn-final-slot').textContent()).trim(),'最后答案');
  assert.equal(await page.locator('.worked-for-divider').textContent(),'Worked for 1m 5s');
  assert.equal(await page.locator('.turn-event-stream').isVisible(),false);
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>globalThis.__codexWebuiDebug?.state.active?.historyLoaded&&!globalThis.__codexWebuiDebug.state.active.cachePreview);
  assert.deepEqual(await order(),completed,'completed reload');
  assert.equal(await page.locator('.turn-work').evaluate(el=>el.open),false);
  await page.locator('.worked-for-divider').click();
  assert.equal(await page.locator('.turn-event-stream').isVisible(),true);
  assert.equal(await page.locator('[data-item-id="tool1"]').getAttribute('aria-expanded'),'true');
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>globalThis.__codexWebuiDebug?.state.active?.historyLoaded&&!globalThis.__codexWebuiDebug.state.active.cachePreview);
  assert.deepEqual(await order(),completed,'expanded reload');
  assert.equal(await page.locator('.turn-work').evaluate(el=>el.open),true);
  await page.screenshot({path:'/tmp/codex-timeline-expanded.png'});
  await page.locator('.worked-for-divider').click();
  await page.screenshot({path:'/tmp/codex-timeline-collapsed.png'});
  assert.deepEqual(errors,[]);
  console.log('PASS: chronological live items, partial snapshots, completion collapse, final answer, and reload/expansion persistence');
} finally {await browser.close();}
