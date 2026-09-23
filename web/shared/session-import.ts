// @ts-expect-error The shared browser translation catalog is plain JavaScript.
import {englishUiError} from '../codex/i18n.js';
// @ts-expect-error The existing shared Lucide catalog is plain JavaScript.
import {codexIconSvg} from '../codex/codex-icons.js';
export type ImportJob = {id:string; target:'codex'|'claude'; sourceId:string; projectPath:string; title:string; status:'running'|'completed'|'failed'; stage:number; createdAt:number; targetId:string; error?:string};
const stages = ['Read', 'Convert', 'Write', 'Verify'];
type Translate = (message:string, values?:Record<string, string | number>)=>string;
const identity:Translate = (message, values={}) => message.replace(/\{(\w+)\}/g, (match, key) => key in values ? String(values[key]) : match);
let jobs: ImportJob[] = [], events: EventSource | null = null;
const listeners = new Set<(jobs:ImportJob[])=>void>();
async function api(path:string, body?:unknown) {
  const response = await fetch('/api/session-import/' + path, {method:body?'POST':'GET', headers:{'content-type':'application/json'}, ...(body?{body:JSON.stringify(body)}:{}), cache:'no-store'});
  const data = await response.json(); if (!response.ok) throw new Error(englishUiError(data.error) || "Import failed"); return data;
}
export function subscribeImports(listener:(jobs:ImportJob[])=>void) {
  listeners.add(listener); listener(jobs);
  if (!events) {
    events = new EventSource('/api/session-import/events');
    events.onmessage = event => {jobs = JSON.parse(event.data); listeners.forEach(fn => fn(jobs));};
  }
  return () => {listeners.delete(listener); if (!listeners.size) {events?.close(); events=null;}};
}
export function createRequestId() {
  const bytes=crypto.getRandomValues(new Uint8Array(16));bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;
  const hex=Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
export function startImport(target:string, projectPath:string, sourceId:string) {
  const requestId=createRequestId();
  return api('start', {target, projectPath, sourceId, requestId}) as Promise<ImportJob>;
}
export function dismissImport(id:string) {return api('dismiss', {id});}

function style() {
  if (document.getElementById('session-import-style')) return;
  const el = document.createElement('style'); el.id='session-import-style';
  el.textContent = `
    .session-import{color:var(--si-text);font-size:13px;line-height:1.5;min-width:0;box-sizing:border-box}
    .session-import [hidden]{display:none!important}
    .session-import button{font:inherit;cursor:pointer}
    .session-import button:disabled{opacity:.5;cursor:default}
    .session-import button:focus-visible{outline:2px solid var(--si-accent);outline-offset:2px}
    .session-import svg{width:16px;height:16px;flex:none;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
    .session-import-entry{margin-left:auto;flex-shrink:0}
    .session-import-trigger{display:flex;align-items:center;gap:7px;height:30px;padding:0 9px;color:var(--si-muted);background:transparent;border:0;border-radius:var(--si-item-radius);white-space:nowrap}
    .session-import-trigger:hover,.session-import-trigger[aria-expanded=true]{background:var(--si-hover);color:var(--si-text)}
    .session-import-trigger svg:last-child{width:12px;height:12px}
    .session-import-picker{position:fixed;inset:auto;margin:0;padding:6px;box-sizing:border-box;background:var(--si-panel);color:var(--si-text);border:1px solid var(--si-border);border-radius:var(--si-radius);box-shadow:var(--si-shadow);overflow:hidden}
    .session-import-picker::backdrop{background:transparent}
    .session-import-picker-heading{display:flex;align-items:center;gap:9px;padding:10px 10px 12px;font-weight:500}
    .session-import-picker-heading>svg{color:var(--si-accent)}
    .session-import-search{display:flex;align-items:center;gap:8px;margin:0 4px 6px;padding:8px 10px;border:1px solid var(--si-border);border-radius:var(--si-item-radius);background:var(--si-subtle);color:var(--si-muted)}
    .session-import-search:focus-within{border-color:var(--si-focus)}
    .session-import-search input{width:100%;min-width:0;padding:0;background:transparent;color:var(--si-text);border:0;outline:0;box-shadow:none;font:inherit}
    .session-import-search input::placeholder{color:var(--si-muted)}
    .session-import-list{max-height:min(280px,35dvh);overflow-y:auto;overscroll-behavior:contain}
    .session-import-option{display:flex;align-items:center;gap:10px;width:100%;min-height:42px;padding:9px 10px;border:0;border-radius:var(--si-item-radius);background:transparent;color:var(--si-text);text-align:left}
    .session-import-option:hover{background:var(--si-hover)}
    .session-import-option>svg{color:var(--si-muted)}
    .session-import-option>span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .session-import-option>svg:last-child{width:13px;height:13px;opacity:0}
    .session-import-option:hover>svg:last-child,.session-import-option:focus-visible>svg:last-child{opacity:1}
    .session-import-note{margin:0;padding:9px 10px 5px;font-size:12px;color:var(--si-muted)}
    .session-import-note:empty{display:none}
    .session-import-empty{padding:22px 12px;text-align:center;color:var(--si-muted);font-size:13px}
    .session-import-progress{width:100%;max-width:760px;margin:0 auto;padding:8px 0;align-self:flex-start}
    .session-import-card{padding:20px;border:1px solid var(--si-border);border-radius:var(--si-radius);background:var(--si-card)}
    .session-import-heading{display:flex;align-items:center;gap:12px}
    .session-import-mark{width:36px;height:36px;display:grid;place-items:center;flex:none;border-radius:10px;background:var(--si-subtle);color:var(--si-accent)}
    .session-import-mark svg{width:19px;height:19px}
    .session-import-heading h2{margin:0;color:var(--si-text);font-size:14px;line-height:22px;font-weight:500}
    .session-import-heading p{margin:2px 0 0;color:var(--si-muted);font-size:12px;line-height:18px}
    .session-import-source{display:flex;align-items:center;gap:8px;min-width:0;margin:18px 0;color:var(--si-muted);font-size:13px}
    .session-import-source>span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--si-text)}
    .session-import-steps{display:flex;gap:8px;list-style:none;padding:0;margin:0}
    .session-import-steps li{flex:1;min-width:0;position:relative;padding-top:12px;font-size:12px;color:var(--si-muted)}
    .session-import-steps li:before{content:'';position:absolute;top:0;left:0;right:0;height:3px;border-radius:2px;background:var(--si-track)}
    .session-import-steps li[data-done=true]:before{background:var(--si-accent)}
    .session-import-steps li[aria-current=step]{color:var(--si-text);font-weight:500}
    .session-import-steps li[aria-current=step]:before{background:var(--si-accent)}
    .session-import-progress[data-status=running] .session-import-steps li[aria-current=step]:before{animation:session-import-pulse 1.8s ease-in-out infinite}
    .session-import-status{display:flex;gap:7px;align-items:flex-start;margin:16px 0 0;color:var(--si-muted);font-size:12px;line-height:18px}
    .session-import-status svg{width:14px;height:14px;margin-top:2px}
    .session-import-progress[data-status=failed] .session-import-status{color:var(--si-error)}
    .session-import-actions{display:flex;gap:8px;margin-top:16px}
    .session-import-actions button{display:inline-flex;align-items:center;gap:6px;min-height:30px;padding:5px 11px;border-radius:var(--si-item-radius);border:1px solid var(--si-border);background:transparent;color:var(--si-text)}
    .session-import-actions button:hover{background:var(--si-hover)}
    .session-import-actions button:first-child{background:var(--si-button);color:var(--si-button-text);border-color:transparent}
    .session-import-actions button:first-child:hover{opacity:.85}
    @keyframes session-import-pulse{50%{opacity:.4}}
    @media(prefers-reduced-motion:reduce){.session-import-progress[data-status=running] .session-import-steps li[aria-current=step]:before{animation:none}}
    @media(max-width:480px){.session-import-card{padding:16px}.session-import-trigger{gap:5px;padding-inline:7px}.session-import-trigger svg:last-child{display:none}}
  `;
  document.head.append(el);
}
const icon = (name:string) => {const holder=document.createElement('span');holder.innerHTML=codexIconSvg(name);return holder.firstElementChild!;};
const button = (text:string, action:()=>void) => {const el=document.createElement('button');el.type='button';el.textContent=text;el.onclick=action;return el;};

export function renderImportPicker(host:HTMLElement, target:'codex'|'claude', projectPath:string, onStarted:(job:ImportJob)=>void, t:Translate=identity) {
  style(); let alive=true; host.replaceChildren(); host.className='session-import session-import-entry';host.hidden=!projectPath;
  if (!projectPath) return () => {alive=false;};
  const from=target==='codex'?'Claude Code':'Codex';
  const panel=document.createElement('div');panel.className='session-import-picker';panel.popover='auto';panel.setAttribute('role','dialog');panel.setAttribute('aria-label',t("Import a conversation from {value0}", {value0: from}));
  const trigger=button(t("Import conversation"), () => {if(panel.matches(':popover-open'))panel.hidePopover();else void show();});
  trigger.className='session-import-trigger';trigger.setAttribute('aria-label',t("Import a conversation from {value0}", {value0: from}));trigger.setAttribute('aria-haspopup','dialog');trigger.setAttribute('aria-expanded','false');trigger.prepend(icon('import'));trigger.append(icon('chevronDown'));
  host.append(trigger,panel);
  const position=()=>{const rect=trigger.getBoundingClientRect(),width=Math.min(360,innerWidth-24);panel.style.width=width+'px';panel.style.left=Math.max(12,Math.min(rect.right-width,innerWidth-width-12))+'px';panel.style.bottom=(innerHeight-rect.top+8)+'px';};
  panel.addEventListener('toggle',()=>trigger.setAttribute('aria-expanded',String(panel.matches(':popover-open'))));
  window.addEventListener('resize',position);
  async function show() {
    panel.replaceChildren();
    const heading=document.createElement('div');heading.className='session-import-picker-heading';heading.append(icon('import'),t("Import from {value0}", {value0: from}));
    const search=document.createElement('input');search.type='search';search.placeholder=t("Search conversations in this project");search.setAttribute('aria-label',search.placeholder);
    const field=document.createElement('label');field.className='session-import-search';field.append(icon('search'),search);
    const list=document.createElement('div');list.className='session-import-list';list.setAttribute('aria-live','polite');
    const empty=(text:string)=>{const el=document.createElement('div');el.className='session-import-empty';el.textContent=text;list.replaceChildren(el);};
    empty(t("Loading conversations…"));
    const notice=document.createElement('p');notice.className='session-import-note';notice.setAttribute('role','status');notice.textContent=t("Only conversations in the current project are shown");
    panel.append(heading,field,list,notice);position();panel.showPopover();search.focus();
    try {
      const rows=await api(`candidates?${new URLSearchParams({target,projectPath})}`);
      if(!alive||!search.isConnected)return;
      const render=()=>{list.replaceChildren();for(const row of rows.filter((r:{title:string})=>r.title.toLowerCase().includes(search.value.toLowerCase()))){
        const item=button('',async()=>{
          item.disabled=true;
          try {const job=await startImport(target,projectPath,row.id);if(alive)onStarted(job);}
          catch(error){if(alive){notice.textContent=t(englishUiError((error as Error).message));item.disabled=false;}}
        });
        item.className='session-import-option';item.dataset.i18nIgnore='';item.setAttribute('aria-label',row.title);item.title=row.title;
        const title=document.createElement('span');title.dataset.i18nIgnore='';title.textContent=row.title;item.append(icon('messageSquare'),title,icon('chevronRight'));list.append(item);
      }if(!list.children.length)empty(search.value?t("No matching conversations"):t("No conversations available to import into this project yet"));};
      search.oninput=render;render();
    }catch(error){if(alive&&search.isConnected)empty(t(englishUiError((error as Error).message)));}
  }
  return () => {alive=false;window.removeEventListener('resize',position);if(panel.matches(':popover-open'))panel.hidePopover();};
}
export function renderImportProgress(host:HTMLElement, job:ImportJob, onStarted:(job:ImportJob)=>void, onDismiss:()=>void, t:Translate=identity) {
  style();host.replaceChildren();host.className='session-import session-import-progress';host.dataset.status=job.status;
  const card=document.createElement('div');card.className='session-import-card';
  const heading=document.createElement('div');heading.className='session-import-heading';
  const mark=document.createElement('span');mark.className='session-import-mark';mark.append(icon(job.status==='completed'?'check':'import'));
  const copy=document.createElement('div'),title=document.createElement('h2'),origin=document.createElement('p');
  title.textContent=job.status==='failed'?t("Import incomplete"):job.status==='completed'?t("Conversation imported"):t("Importing conversation");
  origin.textContent=job.target==='codex'?'Claude Code → Codex':'Codex → Claude Code';copy.append(title,origin);heading.append(mark,copy);
  const source=document.createElement('div');source.className='session-import-source';const name=document.createElement('span');name.dataset.i18nIgnore='';name.textContent=job.title;name.title=job.title;source.append(icon('messageSquare'),name);
  const progress=document.createElement('ol');progress.className='session-import-steps';progress.setAttribute('aria-label',t("Import progress"));
  stages.forEach((name,index)=>{const step=document.createElement('li');step.textContent=t(name);step.dataset.done=String(index<job.stage);if(index===job.stage)step.setAttribute('aria-current','step');progress.append(step);});
  const status=document.createElement('p');status.className='session-import-status';status.setAttribute('role','status');
  if(job.status==='failed')status.append(icon('triangleAlert'));
  const statusText=document.createElement('span');statusText.textContent=job.status==='failed'?t(englishUiError(job.error || ''))||t("Please try again"):job.status==='completed'?t("History is ready. You can continue the conversation."):t("You can use other conversations while the import finishes in the background.");status.append(statusText);
  card.append(heading,source,progress,status);host.append(card);
  const actions=document.createElement('div');actions.className='session-import-actions';
  if(job.status==='completed'){actions.append(button(t("Open conversation"),()=>onStarted(job)));card.append(actions);}
  if(job.status==='failed') {
    const retry=button(t("Retry"),async()=>{retry.disabled=true;try{const next=await startImport(job.target,job.projectPath,job.sourceId);if(retry.isConnected)onStarted(next);await dismissImport(job.id);}catch(error){statusText.textContent=t(englishUiError((error as Error).message));retry.disabled=false;}});retry.prepend(icon('refreshCw'));
    const remove=button(t("Remove"),async()=>{remove.disabled=true;try{await dismissImport(job.id);if(remove.isConnected)onDismiss();}catch(error){statusText.textContent=t(englishUiError((error as Error).message));remove.disabled=false;}});actions.append(retry,remove);card.append(actions);
  }
}
