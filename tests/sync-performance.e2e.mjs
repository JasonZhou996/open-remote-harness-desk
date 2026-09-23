import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
import {launchOptions} from './browser-runtime.mjs';
const gateway=readFileSync(new URL('../server/gateway/index.ts',import.meta.url),'utf8');
let snapshot={active:true,source:'desktop',turn:{id:'turn',items:[{id:'large',text:'x'.repeat(600000)}]},queue:[]};
const conditional=vm.runInNewContext(gateway.slice(gateway.indexOf('async function readLiveThread('),gateway.indexOf('async function readLiveThreadSnapshot(')).replace('threadId: unknown, knownRevision?: unknown','threadId, knownRevision')+'\nreadLiveThread',{createHash,readLiveThreadSnapshot:async()=>snapshot});
const first=await conditional('t'),same=await conditional('t',first.revision);
assert.equal(same.unchanged,true);assert(JSON.stringify(same).length<200);assert.equal(same.turn,undefined);
snapshot={...snapshot,queue:[{text:'followup'}]};
assert.equal((await conditional('t',first.revision)).unchanged,undefined,'queue and settings changes must not be skipped');
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const turn={id:'turn',status:'inProgress',items:[{id:'user',type:'userMessage',content:[{type:'text',text:'Performance check'}]},...Array.from({length:200},(_,i)=>({id:`tool-${i}`,type:'commandExecution',status:'completed',command:`echo ${i}`,aggregatedOutput:'output\n'.repeat(200)}))]};
const thread={id:'performance',name:'Performance',cwd:'/tmp',turns:[turn],status:{type:'active'}};
let unchanged=0,fallbackReads=0,revision='v1',raceNext=false,raced=false;
const liveRevisions=[];
const browser=await chromium.launch(launchOptions());
try{
 const page=await browser.newPage({viewport:{width:1280,height:850}});
 await page.addInitScript(()=>{
  if(window!==window.top)return;
  localStorage.setItem('codex-webui-locale','zh-CN');window.CodexBrowser={hide(){}};
  window.EventSource=class{constructor(url){if(url==='/api/events')queueMicrotask(()=>this.onmessage?.({data:JSON.stringify({type:'bridge/status',status:'connected',instanceId:'test',issuedAt:Date.now()})}))}close(){}};
 });
 await page.route('**/api/**',async route=>{
  const {pathname}=new URL(route.request().url());
  if(pathname==='/api/rpc'){
   const {id,method,params}=route.request().postDataJSON();
   const notModified=method==='host/thread/live'&&params.revision===revision;
   if(notModified)unchanged++;
   if(method==='host/thread/live')liveRevisions.push(params.revision);
   if(method==='thread/turns/list')fallbackReads++;
   const result=method==='thread/read'?{thread}:method==='thread/list'?{data:[{...thread,turns:[]}],projects:[]}:method==='host/thread/live'?{source:'desktop',active:true,revision,...(notModified?{unchanged:true}:{turn})}:{data:[]};
   if(method==='host/thread/live'&&raceNext){
    raceNext=false;
    await page.evaluate(()=>__codexWebuiDebug.notify('item/completed',{threadId:'performance',turnId:'turn',item:{id:'racing',type:'commandExecution',status:'completed',command:'echo racing'}}));
    raced=true;
   }
   return route.fulfill({json:{type:'rpc/result',id,result}});
  }
  if(!['GET','HEAD'].includes(route.request().method()))return route.abort();
  return route.fulfill({json:pathname==='/api/config'?{home:'/tmp',defaultCwd:'/tmp'}:{}});
 });
 await page.goto((process.env.CODEX_WEBUI_TEST_URL||'http://127.0.0.1:8899')+'/?thread=performance');
 await page.waitForFunction(()=>globalThis.__codexWebuiDebug?.state.active?.historyLoaded);
 const result=await page.evaluate(()=>{
  const api=__codexWebuiDebug,root=document.querySelector('#conversation'),rows=new Set(root.querySelectorAll('.activity-item')),observer=new MutationObserver(()=>{});
  observer.observe(root,{childList:true,subtree:true});
  const start=performance.now();
  api.notify('item/completed',{threadId:'performance',turnId:'turn',item:{id:'new',type:'commandExecution',status:'completed',command:'echo new',aggregatedOutput:'done'}});
  const elapsed=performance.now()-start,records=observer.takeRecords();observer.disconnect();
  return {elapsed,movedOldRows:records.flatMap(r=>[...r.addedNodes]).filter(n=>rows.has(n)).length,tools:root.querySelectorAll('.activity-item').length,latest:root.querySelector('.activity-summary-copy').textContent};
 });
 console.log(JSON.stringify(result));
 assert.equal(result.movedOldRows,0,'new activity must not detach and reinsert the existing tool history');
 assert.equal(result.tools,201);assert.match(result.latest,/new/);
 const unchangedDeadline=Date.now()+12000;
 while(!unchanged){assert(Date.now()<unchangedDeadline,'repeat live checks must send the last accepted revision');await page.waitForTimeout(20)}
 assert.equal(fallbackReads,0,'unchanged snapshots must not fetch full history');
 turn.items.push({id:'missed',type:'commandExecution',status:'completed',command:'echo recovered',aggregatedOutput:'done'});revision='v2';
 await page.evaluate(()=>__codexWebuiDebug.notify('thread/status/changed',{threadId:'performance',status:{type:'active'}}));
 await page.waitForFunction(()=>document.querySelector('[data-item-id="missed"]'));
 assert.equal(await page.locator('[data-item-id="new"]').count(),1,'recovery keeps newer pushed items absent from an older snapshot');
 raceNext=true;revision='v3';
 await page.evaluate(()=>__codexWebuiDebug.notify('thread/status/changed',{threadId:'performance',status:{type:'active'}}));
 // Allow the delayed response to settle, then request another repair.
 const raceDeadline=Date.now()+5000;
 while(!raced){assert(Date.now()<raceDeadline);await page.waitForTimeout(20)}
 await page.waitForTimeout(100);
 const calls=liveRevisions.length;
 await page.evaluate(()=>__codexWebuiDebug.notify('thread/status/changed',{threadId:'performance',status:{type:'active'}}));
 const deadline=Date.now()+5000;
 while(liveRevisions.length===calls){assert(Date.now()<deadline);await page.waitForTimeout(20)}
 assert.equal(liveRevisions.at(-1),'','a snapshot overtaken by live events must be rechecked, not marked fully synchronized');
 console.log('conditional snapshot, missed-event recovery and stable DOM OK');
}finally{await browser.close()}
