import { chromium } from 'playwright';
import { launchOptions } from './browser-runtime.mjs';

const browser=await chromium.launch(launchOptions());
const page=await browser.newPage({viewport:{width:1280,height:800},colorScheme:'dark'});
const errors=[];
page.on('pageerror',error=>errors.push(error.message));
page.on('console',message=>{if(message.type()==='error'&&!message.text().includes('404'))errors.push(message.text())});
await page.goto(process.env.CODEX_WEBUI_TEST_URL||'http://127.0.0.1:8899',{waitUntil:'networkidle'});
await page.waitForFunction(()=>globalThis.__codexWebuiDebug);

const reasoning=await page.evaluate(()=>{
  const api=globalThis.__codexWebuiDebug,{state}=api;
  const reset=()=>{for(const animation of state.motion.values())animation?.destroy?.();for(const key of ['items','turns','activities','activityItems','dividers','motion'])state[key].clear();document.querySelector('#conversation').replaceChildren()};
  reset();state.active={id:'reasoning-thread',cwd:'/tmp',source:'local'};
  api.notify('item/reasoning/summaryPartAdded',{threadId:'reasoning-thread',turnId:'reasoning-turn',itemId:'reasoning-item',summaryIndex:0});
  const read=()=>{const label=document.querySelector('.activity-summary-copy');return{text:label?.textContent,visible:!!label&&getComputedStyle(label).display!=='none',shimmer:label?.classList.contains('loading-shimmer')}};
  const started=read();
  api.notify('item/reasoning/summaryTextDelta',{threadId:'reasoning-thread',turnId:'reasoning-turn',itemId:'reasoning-item',summaryIndex:0,delta:'Inspecting the source'});
  const streaming=read();
  api.notify('item/completed',{threadId:'reasoning-thread',turnId:'reasoning-turn',item:{id:'reasoning-item',type:'reasoning',summary:['Inspecting the source']}});
  const completed={present:!!document.querySelector('[data-item-id="reasoning-item"]')};
  return{started,streaming,completed};
});

const groupPersistence=await page.evaluate(()=>{
  const api=globalThis.__codexWebuiDebug,{state}=api;
  const reset=()=>{for(const animation of state.motion.values())animation?.destroy?.();for(const key of ['items','turns','activities','activityItems','dividers','motion'])state[key].clear();document.querySelector('#conversation').replaceChildren()};
  const replay=()=>{api.notify('item/completed',{threadId:'persist-thread',turnId:'persist-turn',item:{id:'persist-command-1',type:'commandExecution',command:'bun test',aggregatedOutput:'ok'}});api.notify('item/completed',{threadId:'persist-thread',turnId:'persist-turn',item:{id:'persist-command-2',type:'commandExecution',command:'bun run check',aggregatedOutput:'ok'}})};
  reset();state.active={id:'persist-thread',cwd:'/tmp',source:'local'};replay();
  const firstGroup=document.querySelector('[data-agent-activity-group]'),summary=firstGroup?.querySelector('.activity-summary');summary?.click();
  const storageKey=Object.keys(localStorage).find(key=>key.startsWith('codex-webui-activity-group:persist-thread:persist-turn:persist-command-1'));
  const firstOpen=summary?.classList.contains('open')&&firstGroup?.querySelector('.activity-items')?.classList.contains('open');
  reset();replay();
  const restoredGroup=document.querySelector('[data-agent-activity-group]'),restoredSummary=restoredGroup?.querySelector('.activity-summary');
  return{firstOpen,storageValue:storageKey?localStorage.getItem(storageKey):null,restoredOpen:restoredSummary?.classList.contains('open')&&restoredGroup?.querySelector('.activity-items')?.classList.contains('open')};
});

const reloadPersistenceBefore=await page.evaluate(()=>{
  const api=globalThis.__codexWebuiDebug,{state}=api;
  const reset=()=>{for(const animation of state.motion.values())animation?.destroy?.();for(const key of ['items','turns','activities','activityItems','dividers','motion'])state[key].clear();document.querySelector('#conversation').replaceChildren()};
  const replay=()=>{api.notify('item/completed',{threadId:'reload-persist-thread',turnId:'reload-persist-turn',item:{id:'reload-command-1',type:'commandExecution',command:'bun test',aggregatedOutput:'tests passed'}});api.notify('item/completed',{threadId:'reload-persist-thread',turnId:'reload-persist-turn',item:{id:'reload-command-2',type:'commandExecution',command:'bun run check',aggregatedOutput:'build passed'}})};
  reset();state.active={id:'reload-persist-thread',cwd:'/tmp',source:'local'};replay();
  const group=document.querySelector('[data-agent-activity-group]'),summary=group?.querySelector('.activity-summary'),row=group?.querySelector('[data-item-id="reload-command-1"]');summary?.click();row?.click();api.setSidebarOpen(false);
  const groupKey=Object.keys(localStorage).find(key=>key.startsWith('codex-webui-activity-group:reload-persist-thread:reload-persist-turn:reload-command-1'));
  const itemKey='codex-webui-activity-item:reload-persist-thread:reload-persist-turn:reload-command-1';
  return{groupOpen:summary?.classList.contains('open'),itemExpanded:row?.getAttribute('aria-expanded'),groupStored:groupKey?localStorage.getItem(groupKey):null,itemStored:localStorage.getItem(itemKey),sidebarHidden:document.body.classList.contains('sidebar-hidden')};
});

await page.reload({waitUntil:'networkidle'});
await page.waitForFunction(()=>globalThis.__codexWebuiDebug);
const reloadPersistenceAfter=await page.evaluate(()=>{
  const api=globalThis.__codexWebuiDebug,{state}=api;
  for(const animation of state.motion.values())animation?.destroy?.();for(const key of ['items','turns','activities','activityItems','dividers','motion'])state[key].clear();document.querySelector('#conversation').replaceChildren();
  state.active={id:'reload-persist-thread',cwd:'/tmp',source:'local'};
  api.notify('item/completed',{threadId:'reload-persist-thread',turnId:'reload-persist-turn',item:{id:'reload-command-1',type:'commandExecution',command:'bun test',aggregatedOutput:'tests passed'}});
  api.notify('item/completed',{threadId:'reload-persist-thread',turnId:'reload-persist-turn',item:{id:'reload-command-2',type:'commandExecution',command:'bun run check',aggregatedOutput:'build passed'}});
  const group=document.querySelector('[data-agent-activity-group]'),summary=group?.querySelector('.activity-summary'),row=group?.querySelector('[data-item-id="reload-command-1"]'),output=row?.nextElementSibling;
  return{groupOpen:summary?.classList.contains('open')&&group?.querySelector('.activity-items')?.classList.contains('open'),itemExpanded:row?.getAttribute('aria-expanded'),outputVisible:output&&getComputedStyle(output).display!=='none',sidebarOpen:!document.body.classList.contains('sidebar-hidden'),sidebarShadow:getComputedStyle(document.querySelector('#sidebar')).boxShadow};
});
await page.screenshot({path:'/tmp/codex-webui-reload-state.png',fullPage:false});

const threadRestore=await page.evaluate(async()=>{
  const api=globalThis.__codexWebuiDebug,{state}=api,now=Date.now()/1000,cwd=state.config.defaultCwd;
  localStorage.setItem('codex-webui-active-thread','remembered-thread');state.active=null;state.threads=[];
  state.transport='ws';state.ws={readyState:WebSocket.OPEN,send(raw){const request=JSON.parse(raw);queueMicrotask(()=>{const pending=state.pending.get(request.id);if(!pending)return;state.pending.delete(request.id);if(request.method==='model/list')pending.resolve({data:[]});else if(request.method==='thread/list')pending.resolve({data:[{id:'remembered-thread',name:'Remembered task',cwd,source:'local',recencyAt:now,updatedAt:now}]});else if(request.method==='thread/read')pending.resolve({thread:{id:'remembered-thread',name:'Remembered task',cwd,source:'local',turns:[]}});else pending.reject(new Error(`Unexpected RPC ${request.method}`))})}};
  await api.loadInitial();
  return{activeId:state.active?.id,storedId:localStorage.getItem('codex-webui-active-thread'),heading:document.querySelector('#threadTitle')?.textContent?.trim(),selected:document.querySelector('.thread-item.active')?.dataset.id};
});

const sidebar=await page.evaluate(()=>{
  const api=globalThis.__codexWebuiDebug,node=document.querySelector('#sidebar'),button=document.querySelector('#toggleSidebar');api.setSidebarOpen(true);const open={hidden:document.body.classList.contains('sidebar-hidden'),width:node.getBoundingClientRect().width,pressed:button.getAttribute('aria-pressed')};api.setSidebarOpen(false);const closed={hidden:document.body.classList.contains('sidebar-hidden'),width:node.getBoundingClientRect().width,shadow:getComputedStyle(node).boxShadow,pressed:button.getAttribute('aria-pressed')};api.setSidebarOpen(true);return{open,closed};
});

console.log(JSON.stringify({reasoning,groupPersistence,reloadPersistenceBefore,reloadPersistenceAfter,threadRestore,sidebar,errors},null,2));
await browser.close();

if(reasoning.started.text!=='Thinking'||!reasoning.started.visible||!reasoning.started.shimmer)throw new Error(`Thinking status missing: ${JSON.stringify(reasoning)}`);
if(reasoning.streaming.text!=='Inspecting the source'||!reasoning.streaming.shimmer)throw new Error(`Latest reasoning must update the status: ${JSON.stringify(reasoning)}`);
if(reasoning.completed.present)throw new Error('Finished reasoning must not remain in tool history');
if(!groupPersistence.firstOpen||groupPersistence.storageValue!=='open'||!groupPersistence.restoredOpen)throw new Error(`Activity group expansion must survive reconstruction: ${JSON.stringify(groupPersistence)}`);
if(!reloadPersistenceBefore.groupOpen||reloadPersistenceBefore.itemExpanded!=='true'||reloadPersistenceBefore.groupStored!=='open'||reloadPersistenceBefore.itemStored!=='open'||!reloadPersistenceBefore.sidebarHidden)throw new Error(`Activity expansion must persist before reload: ${JSON.stringify(reloadPersistenceBefore)}`);
if(!reloadPersistenceAfter.groupOpen||reloadPersistenceAfter.itemExpanded!=='true'||!reloadPersistenceAfter.outputVisible||!reloadPersistenceAfter.sidebarOpen||reloadPersistenceAfter.sidebarShadow!=='none')throw new Error(`Activity expansion and default sidebar state must survive a real reload: ${JSON.stringify(reloadPersistenceAfter)}`);
if(threadRestore.activeId!=='remembered-thread'||threadRestore.storedId!=='remembered-thread'||threadRestore.heading!=='Remembered task'||threadRestore.selected!=='remembered-thread')throw new Error(`The selected thread must restore on bootstrap: ${JSON.stringify(threadRestore)}`);
if(sidebar.open.hidden||sidebar.open.width<250||sidebar.open.pressed!=='true'||!sidebar.closed.hidden||sidebar.closed.width!==0||sidebar.closed.shadow!=='none'||sidebar.closed.pressed!=='false')throw new Error(`Desktop sidebar state or collapsed shadow is incorrect: ${JSON.stringify(sidebar)}`);
if(errors.length)throw new Error(`Browser errors: ${errors.join('; ')}`);
