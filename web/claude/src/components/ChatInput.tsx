import {t} from '../i18n';
import React,{useState,useRef,useEffect} from 'react';
import {Plus,CornerDownLeft,Square,Check,X,FileText,Image,Paperclip} from 'lucide-react';
import {useChat} from '../context/ChatContext';
import {useSettings} from '../context/SettingsContext';
import {Attachment} from '../types';
import {backend} from '../services/backend';
import {attachmentImageUrl} from '../services/attachments';
import {AttachmentImage} from './AttachmentImage';
import {ModelSelectorDropdown} from './ModelSelectorDropdown';
import {ContextUsage} from './ContextUsage';
import {ClaudeMascot} from './ClaudeMascot';

interface ChatInputProps {compact?:boolean;fullWidth?:boolean;forcePlaceholder?:string;hideQuickAnswer?:boolean}
const permissionModes = [
  {value:'auto',label:'Auto',description:'Claude handles permission decisions'},
  {value:'default',label:'Manual',description:'Always ask before making changes'},
  {value:'acceptEdits',label:'Accept edits',description:'Automatically accept all file edits'},
  {value:'plan',label:'Plan',description:'Create a plan before making changes'},
  {value:'bypassPermissions',label:'Bypass permissions',description:'Accepts all permissions'},
];
function attachmentsForQueue(row:any):Attachment[]{
  try{const options=typeof row.options==='string'?JSON.parse(row.options):row.options;return (options?.attachments || []).map((a:any)=>({id:a.path,path:a.path,name:a.name,type:a.mimeType || 'application/octet-stream',size:a.size}));}catch{return [];}
}
export const ChatInput:React.FC<ChatInputProps> = ({forcePlaceholder,fullWidth}) => {
  const {sendMessage,isStreaming,stopGeneration,catalog,catalogError,activeConversationId,newConversationKey,activeProject,selectedModel,permissionMode,setPermissionMode,permissionPending,permissionError,setActivePageView,createNewConversation,recalledDraft,clearRecalledDraft} = useChat();
  const {settings,setIsSettingsOpen} = useSettings();
  const [input,setInput]=useState('');const [attachments,setAttachments]=useState<Attachment[]>([]);
  const [error,setError]=useState('');const [busy,setBusy]=useState(false);const [add,setAdd]=useState(false);
  const [commandIndex,setCommandIndex]=useState(0);const [hideCommands,setHideCommands]=useState(false);
  const [usageOpen,setUsageOpen]=useState(false);const usageRef=useRef<HTMLDivElement>(null);
  const [permissionOpen,setPermissionOpen]=useState(false);
  const permissionButton=useRef<HTMLButtonElement>(null);const permissionMenu=useRef<HTMLDivElement>(null);
  const [queued,setQueued]=useState<any[]>([]);const [editing,setEditing]=useState<string|null>(null);
  const root=useRef<HTMLDivElement>(null);const textarea=useRef<HTMLTextAreaElement>(null);const files=useRef<HTMLInputElement>(null);const images=useRef<HTMLInputElement>(null);
  const english=settings.language==='en';
  const query=/^\/([^\s]*)$/.exec(input);
  const commands=!hideCommands&&query ? (catalog?.commands || []).filter(c=>c.name.toLowerCase().includes(query[1].toLowerCase())) : [];
  const draftScope=activeConversationId || `project:${activeProject?.id || 'none'}${newConversationKey ? ':'+newConversationKey : ''}`;
  const drafts=useRef(new Map<string,{text:string;attachments:Attachment[]}>());
  const previousScope=useRef<string|null>(null);
  const draftSnapshot=useRef({scope:draftScope,text:input,attachments});
  draftSnapshot.current={scope:draftScope,text:input,attachments};
  useEffect(()=>{
    if(previousScope.current===null){try{drafts.current=new Map(JSON.parse(sessionStorage.getItem('claude-composer-drafts')||'[]'));}catch{/* unavailable storage */}}
    if(previousScope.current!==draftScope){if(previousScope.current)drafts.current.set(previousScope.current,{text:input,attachments});const draft=drafts.current.get(draftScope);setInput(draft?.text || '');setAttachments(draft?.attachments || []);setEditing(null);setQueued([]);previousScope.current=draftScope;}
  },[draftScope]);
  useEffect(()=>{
    if(!recalledDraft || recalledDraft.sessionId!==activeConversationId)return;
    setInput(value=>value ? `${value}\n${recalledDraft.text}` : recalledDraft.text);
    setAttachments(value=>[...value,...recalledDraft.attachments]);
    setEditing(null);clearRecalledDraft();textarea.current?.focus({preventScroll:true});
  },[recalledDraft,activeConversationId]);
  useEffect(()=>{
    const save=()=>{const {scope,text,attachments}=draftSnapshot.current;drafts.current.set(scope,{text,attachments});try{sessionStorage.setItem('claude-composer-drafts',JSON.stringify([...drafts.current]));}catch{/* storage quota */}};
    window.addEventListener('pagehide',save);return()=>{save();window.removeEventListener('pagehide',save);};
  },[]);
  const refreshQueue=async()=>{if(!activeConversationId){setQueued([]);return;}try{const r=await backend.api('/api/scheduled-messages?kind=queue');setQueued(r.items.filter((x:any)=>x.session_id===activeConversationId && x.status==='pending'));}catch(e:any){setError(e.message);}};
  useEffect(()=>{void refreshQueue();},[activeConversationId,isStreaming]);
  useEffect(()=>{const el=textarea.current;if(el){el.style.height='auto';el.style.height=`${Math.min(el.scrollHeight,240)}px`;}},[input]);
  useEffect(()=>{setCommandIndex(0);setHideCommands(false);},[input]);
  useEffect(()=>{
    const close=(e:PointerEvent)=>{if(!root.current?.contains(e.target as Node)){setAdd(false);setHideCommands(true);}if(!usageRef.current?.contains(e.target as Node))setUsageOpen(false);if(!permissionMenu.current?.contains(e.target as Node)&&!permissionButton.current?.contains(e.target as Node))setPermissionOpen(false);};
    const escape=(e:KeyboardEvent)=>{if(e.key==='Escape'){setUsageOpen(false);if(permissionMenu.current){setPermissionOpen(false);permissionButton.current?.focus({preventScroll:true});}}};
    document.addEventListener('pointerdown',close);document.addEventListener('keydown',escape);
    return()=>{document.removeEventListener('pointerdown',close);document.removeEventListener('keydown',escape);};
  },[]);
  useEffect(()=>{if(permissionOpen)permissionMenu.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus({preventScroll:true});},[permissionOpen]);
  const choosePermission=async(mode:string)=>{setPermissionOpen(false);permissionButton.current?.focus({preventScroll:true});await setPermissionMode(mode);};
  const upload=async(list:FileList|File[]|null)=>{
    if(!list?.length||busy||editing)return;setBusy(true);setError('');
    try{const response=await backend.upload(Array.from(list));const uploaded=response.attachments.map(a=>({id:a.path,name:a.name,type:a.mimeType,size:a.size,path:a.path}));if(draftSnapshot.current.scope===draftScope)setAttachments(prev=>[...prev,...uploaded]);else{const draft=drafts.current.get(draftScope);drafts.current.set(draftScope,{text:draft?.text||'',attachments:[...(draft?.attachments||[]),...uploaded]});}}
    catch(e:any){setError(e.message);}finally{setBusy(false);if(files.current)files.current.value='';if(images.current)images.current.value='';}
  };
  const choose=(name:string)=>{
    if(name==='model'||name==='effort'){setInput('');window.dispatchEvent(new CustomEvent('claude-model-menu',{detail:name}));return;}
    if(name==='usage'){setInput('');setUsageOpen(true);return;}
    const settingsCommands:Record<string,string>={mcp:'extensions',config:'general'};
    if(settingsCommands[name]){setInput('');setIsSettingsOpen(true);window.dispatchEvent(new CustomEvent('claude-settings-tab',{detail:settingsCommands[name]}));return;}
    if(name==='schedule'){setInput('');setActivePageView('routines');return;}
    if(name==='clear'){setInput('');createNewConversation(activeProject?.id);return;}
    setInput('/'+name+' ');setHideCommands(true);textarea.current?.focus();
  };
  const submit=async()=>{
    if(busy||permissionPending||permissionError||(!input.trim()&&!attachments.length))return;
    const command=/^\/(usage|mcp|config|schedule|clear|model|effort)\s*$/.exec(input);
    if(command){choose(command[1]);return;}
    setBusy(true);setError('');
    try{
      if(editing){await backend.api(`/api/scheduled-messages/${editing}`,{method:'PATCH',body:JSON.stringify({content:input})});setEditing(null);await refreshQueue();}
      else if(isStreaming&&activeConversationId){await backend.api('/api/scheduled-messages',{method:'POST',body:JSON.stringify({kind:'queue',sessionId:activeConversationId,content:input.trim() || t("Please see the attachments."),scheduledFor:new Date().toISOString(),options:{model:selectedModel,effort:settings.thinkingEffort,permissionMode,attachments:attachments.map(a=>({path:a.path,name:a.name,mimeType:a.type,size:a.size}))}})});await refreshQueue();}
      else await sendMessage(input,attachments,false);
      if(draftSnapshot.current.scope===draftScope){setInput(current=>current===input?'':current);setAttachments(current=>current===attachments?[]:current);}
    }catch(e:any){setError(e.message);}finally{setBusy(false);}
  };
  const sendQueuedNow=async(row:any)=>{
    if(busy||editing||permissionPending||permissionError)return;
    setBusy(true);setError('');
    let cancelled=false, queuedAttachments:Attachment[]=[];
    try{
      const options=typeof row.options==='string'?JSON.parse(row.options):row.options || {};
      queuedAttachments=(options.attachments || []).map((a:any)=>({id:a.path,path:a.path,name:a.name,type:a.mimeType,size:a.size}));
      // Remove the scheduled copy before Stop can make the session available to it.
      ({cancelled}=await backend.api(`/api/scheduled-messages/${row.id}`,{method:'DELETE'}));
      if(!cancelled)throw new Error(t("This message has left the queue. Refresh to view it."));
      setQueued(rows=>rows.filter(item=>item.id!==row.id));
      await sendMessage(row.content,queuedAttachments,true);
    }catch(e:any){
      if(cancelled){
        if(draftSnapshot.current.scope===draftScope){setInput(value=>value?`${value}\n${row.content}`:row.content);setAttachments(value=>[...value,...queuedAttachments]);}
        else{const draft=drafts.current.get(draftScope);drafts.current.set(draftScope,{text:draft?.text?`${draft.text}\n${row.content}`:row.content,attachments:[...(draft?.attachments || []),...queuedAttachments]});}
      }
      setError(e.message);
    }finally{setBusy(false);}
  };
  return <div className={`claude-chat-input w-full ${fullWidth?'':'max-w-5xl mx-auto'} relative text-[var(--text-primary)]`} ref={root}
    onDragOver={e=>{if(e.dataTransfer.types.includes('Files'))e.preventDefault();}}
    onDrop={e=>{if(e.dataTransfer.files.length){e.preventDefault();void upload(e.dataTransfer.files);}}}>
    {queued.map(row=><div key={row.id} className="native-panel p-2 mb-2 flex items-center gap-1 text-sm"><div className="min-w-0 flex-1"><span className="block truncate" title={row.content}>{row.content}</span>{attachmentsForQueue(row).map(a=>attachmentImageUrl(a)?<AttachmentImage key={a.id} attachment={a} compact/>:<span key={a.id} className="block truncate text-xs">{a.name}</span>)}</div><div className="flex shrink-0 gap-1 whitespace-nowrap"><button className="native-button !px-2" disabled={busy||!!editing||permissionPending||!!permissionError} onClick={()=>void sendQueuedNow(row)}>{t("Send now")}</button><button className="native-button !px-2" disabled={busy} onClick={()=>{setInput(row.content);setEditing(row.id);textarea.current?.focus();}}>{t("Edit")}</button><button className="native-button !px-2" disabled={busy} onClick={async()=>{try{await backend.api(`/api/scheduled-messages/${row.id}`,{method:'DELETE'});if(editing===row.id){setEditing(null);setInput('');}await refreshQueue();}catch(e:any){setError(e.message);}}}>{t("Delete")}</button></div></div>)}
    {query&&!hideCommands&&<div className="native-panel absolute bottom-full left-0 mb-1 p-1 w-[340px] max-w-full max-h-[min(520px,55dvh)] overflow-y-auto z-30 shadow-lg" role="listbox" aria-label={t("Claude Code commands")}>
      {catalogError ? <p className="p-3 text-sm">{catalogError}</p>:!catalog?<p className="p-3">{t("Loading commands…")}</p>:!commands.length?<p className="p-3">{t("No matching commands")}</p>:commands.map((c,i)=><button key={c.name} role="option" aria-selected={i===commandIndex} className="nav-row text-sm !py-1.5" title={c.description} style={i===commandIndex?{background:'var(--bg-card-hover)'}:{}} onClick={()=>choose(c.name)}><span className="truncate">{c.name}</span></button>)}
    </div>}
    <div className="relative rounded-[18px] border border-[var(--border-color)] bg-[var(--bg-input)] p-3 sm:px-4 focus-within:border-[var(--text-muted)] transition-colors">
      {!queued.length&&<ClaudeMascot label={english?'Replay Claude animation':t("Replay Claude animation")}/>}
      {attachments.length>0&&<div className="flex gap-2 flex-wrap mb-2">{attachments.map(a=>attachmentImageUrl(a)?<AttachmentImage key={a.id} attachment={a} compact onRemove={()=>setAttachments(v=>v.filter(x=>x.id!==a.id))}/>:<div key={a.id} className="native-panel flex items-center gap-2 p-2 max-w-full text-sm"><FileText size={16}/><span className="truncate">{a.name}</span><button aria-label={t("Remove attachment")} onClick={()=>setAttachments(v=>v.filter(x=>x.id!==a.id))}><X size={15}/></button></div>)}</div>}
      <div className="flex items-end gap-2"><textarea ref={textarea} aria-label={t("Messages")} rows={1} value={input} onChange={e=>setInput(e.target.value)} onPaste={e=>{if(e.clipboardData.files.length){e.preventDefault();void upload(e.clipboardData.files);}}} onKeyDown={e=>{
        if(e.nativeEvent.isComposing)return;
        if(commands.length&&e.key==='ArrowDown'){e.preventDefault();setCommandIndex(i=>(i+1)%commands.length);}
        else if(commands.length&&e.key==='ArrowUp'){e.preventDefault();setCommandIndex(i=>(i+commands.length-1)%commands.length);}
        else if(commands.length&&(e.key==='Enter'||e.key==='Tab')){e.preventDefault();choose(commands[commandIndex]?.name||commands[0].name);}
        else if(e.key==='Escape'){setHideCommands(true);setAdd(false);}
        else if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();void submit();}
      }} className="block flex-1 min-w-0 min-h-[30px] py-1 resize-none bg-transparent outline-none text-base leading-6 max-h-[240px] placeholder:text-[var(--text-muted)]" placeholder={forcePlaceholder || (english?'Describe a task or ask a question':t("Describe a task or ask a question"))}/>
        {isStreaming&&<button disabled={busy} className="workspace-icon !w-8 !h-8 disabled:opacity-30" aria-label={t("Stop generating")} onClick={async()=>{setBusy(true);setError('');try{await stopGeneration();}catch(e:any){setError(e.message);}finally{setBusy(false);}}}><Square size={15}/></button>}
        <button aria-label={editing?t("Save queued message"):isStreaming?t("Queue message"):t("Send message")} disabled={busy||permissionPending||!!permissionError||(!input.trim()&&!attachments.length)} className="workspace-icon !w-8 !h-8 disabled:opacity-30" onClick={()=>void submit()}><CornerDownLeft size={20}/></button>
      </div>
      {(error||permissionError)&&<p role="alert" className="text-red-500 text-sm my-2 break-words">{error||permissionError}</p>}
    </div>
      <div className="claude-composer-tools relative flex flex-nowrap items-center justify-between gap-0.5 pt-2" aria-label={t("Chat toolbar")}>
        <div className="flex items-center gap-0.5 shrink-0">
        <div className="relative"><button className="workspace-icon !w-8 !h-8" aria-label={t("Add")} aria-expanded={add} disabled={Boolean(editing)} onClick={()=>setAdd(!add)}><Plus size={19}/></button>
          {add&&<div className="native-panel absolute bottom-full left-0 mb-2 p-1 min-w-[210px] shadow-md z-30"><button className="nav-row" onClick={()=>{files.current?.click();setAdd(false);}}><Paperclip size={16}/>{t("Files")}</button><button className="nav-row" onClick={()=>{images.current?.click();setAdd(false);}}><Image size={16}/>{t("Image")}</button><button className="nav-row" onClick={()=>{setInput('/');setAdd(false);textarea.current?.focus();}}>  {t("/ Skills and commands")}</button></div>}
        </div>
        <button ref={permissionButton} type="button" aria-label={t("Permission mode")} aria-haspopup="menu" aria-expanded={permissionOpen} title={permissionMode} disabled={permissionPending} aria-busy={permissionPending} className="composer-control shrink-0 whitespace-nowrap rounded-md px-2 py-1 text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-card-hover)] disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent-coral)]" onClick={()=>{setPermissionOpen(!permissionOpen);setAdd(false);setHideCommands(true);setUsageOpen(false);}}>
          {permissionModes.find(mode=>mode.value===permissionMode)?.label || permissionMode}
        </button>
        </div>
        {permissionOpen&&<div ref={permissionMenu} role="menu" aria-label="Mode" className="native-panel absolute bottom-full left-0 mb-2 p-1 w-[360px] max-w-full max-h-[65dvh] overflow-y-auto shadow-lg z-50" onKeyDown={e=>{
          const rows=Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'));
          const index=rows.indexOf(document.activeElement as HTMLButtonElement);
          if(['ArrowDown','ArrowUp','Home','End'].includes(e.key)){e.preventDefault();const next=e.key==='Home'?0:e.key==='End'?rows.length-1:(index+(e.key==='ArrowDown'?1:-1)+rows.length)%rows.length;rows[next]?.focus();}
          else if(/^[1-5]$/.test(e.key)){e.preventDefault();rows[Number(e.key)-1]?.click();}
          else if(e.key==='Tab')setPermissionOpen(false);
        }}>
          <div className="px-2.5 py-1 text-sm text-[var(--text-secondary)]">Mode</div>
          {permissionModes.map((mode,index)=><button key={mode.value} type="button" role="menuitemradio" aria-checked={mode.value===permissionMode} disabled={permissionPending} className="nav-row !gap-2 !py-1.5 text-sm focus-visible:outline-none focus-visible:bg-[var(--bg-card-hover)]" onClick={()=>void choosePermission(mode.value)}>
            <span className="flex-1 min-w-0"><span className="block leading-6">{mode.label}</span><span className="block text-xs leading-5 text-[var(--text-secondary)]">{mode.description}</span></span>
            <span className="w-4 shrink-0">{mode.value===permissionMode&&<Check size={16} className="text-[#4285d4]"/>}</span><span className="w-3 text-right text-[var(--text-secondary)]" aria-hidden="true">{index+1}</span>
          </button>)}
        </div>}
        <div className="flex items-center gap-0.5 ml-auto min-w-0 max-w-full"><ModelSelectorDropdown/><div className="relative shrink-0" ref={usageRef}>
          <ContextUsage sessionId={activeConversationId} open={usageOpen} onToggle={()=>{setUsageOpen(!usageOpen);setHideCommands(true);}}/>
        </div></div>
      </div>
    <input type="file" multiple ref={files} className="hidden" onChange={e=>void upload(e.target.files)}/><input type="file" multiple accept="image/*" ref={images} className="hidden" onChange={e=>void upload(e.target.files)}/>
  </div>;
};
