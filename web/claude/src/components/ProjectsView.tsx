import {t} from '../i18n';
import React,{useState} from 'react';
import {Folder,Plus,ArrowLeft,MessageSquare,Pencil,ChevronRight,Trash2} from 'lucide-react';
import {useChat} from '../context/ChatContext';
import {backend} from '../services/backend';
import {NativeInstructions} from './NativeInstructions';
import {ChatInput} from './ChatInput';

export const ProjectsView:React.FC = () => {
  const {projects,setProjects,activeProject,setActiveProject,refreshSidebar,conversations,selectConversation,createNewConversation,setActiveConversationId} = useChat();
  const [creating,setCreating]=useState(false);
  const [name,setName]=useState('');const [path,setPath]=useState('');
  const [error,setError]=useState('');const [busy,setBusy]=useState(false);
  const [tab,setTab]=useState<'chats'|'instructions'>('chats');
  const [deleting,setDeleting]=useState(false);
  const project=projects.find(p=>p.id===activeProject?.id) || activeProject;
  return <main className="workspace-page"><div className="max-w-5xl mx-auto space-y-4">
    {project ? <>
      <button className="inline-flex items-center gap-2 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]" onClick={()=>{setActiveProject(null);setError('');setDeleting(false);}}><ArrowLeft size={16}/>{t("All projects")}</button>
      <div className="flex items-center gap-3"><h1 className="workspace-title break-words min-w-0">{project.name}</h1><button aria-label={t("Rename project")} className="workspace-icon" onClick={async()=>{const next=prompt(t("Project Name"),project.name);if(!next?.trim())return;try{await backend.api(`/api/projects/${encodeURIComponent(project.id)}/rename`,{method:'PUT',body:JSON.stringify({displayName:next.trim()})});await refreshSidebar();}catch(e:any){setError(e.message);}}}><Pencil size={16}/></button></div>
      <p className="text-sm text-[var(--text-secondary)] break-all">{project.path}</p>
      <button className="workspace-tab inline-flex items-center gap-2" aria-expanded={deleting} onClick={()=>setDeleting(!deleting)}><Trash2 size={16}/>{t("Delete project")}</button>
      {deleting&&<div className="native-panel p-4 space-y-3" role="alertdialog" aria-label={t("Delete project")}><p className="text-sm">{t('Remove “{name}” from the project list. Files and existing conversations will be kept.', {name: project.name})}</p><div className="flex gap-2 justify-end"><button disabled={busy} className="workspace-tab" onClick={()=>setDeleting(false)}>{t("Cancel")}</button><button disabled={busy} className="workspace-primary" onClick={async()=>{setBusy(true);setError('');try{await backend.api(`/api/projects/${encodeURIComponent(project.id)}`,{method:'DELETE'});setProjects(items=>items.filter(p=>p.id!==project.id));setActiveProject(null);setDeleting(false);await refreshSidebar();}catch(e:any){setError(e.message);}finally{setBusy(false);}}}>{busy?t("Deleting…"):t("Confirm deletion")}</button></div></div>}
      <div className="flex flex-wrap gap-2 border-b border-[var(--border-color)] pb-4"><button className="workspace-tab" aria-pressed={tab==='chats'} onClick={()=>setTab('chats')}>{t("Chats")}</button><button className="workspace-tab" aria-pressed={tab==='instructions'} onClick={()=>setTab('instructions')}>{t("Project instructions")}</button><button className="workspace-primary ml-auto" onClick={()=>createNewConversation(project.id)}><Plus size={16}/>{t("New chat")}</button></div>
      {tab==='instructions'?<NativeInstructions key={project.id} projectId={project.id}/>:<>
        <ChatInput fullWidth forcePlaceholder={t("Start a new chat in {value0}…", {value0: project.name})}/>
        <div className="divide-y divide-[var(--border-color)]">{conversations.filter(c=>c.projectId===project.id).map(c=><button className="w-full flex items-center gap-3 py-3 px-2 text-left hover:bg-[var(--bg-card-hover)] rounded-lg" key={c.id} onClick={()=>selectConversation(c.id)}><MessageSquare size={17} className="shrink-0 text-[var(--text-secondary)]"/><span className="truncate flex-1">{c.title}</span><ChevronRight size={16} className="shrink-0 text-[var(--text-muted)]"/></button>)}</div>
      </>}
    </>:<>
      <div className="flex flex-wrap gap-4 items-center justify-between"><h1 className="workspace-title">{t("Project")}</h1><button className="workspace-primary" aria-expanded={creating} onClick={()=>setCreating(!creating)}><Plus size={16}/>{t("Add project")}</button></div>
      {creating&&<form className="border border-[var(--border-color)] rounded-xl p-5 space-y-4" onSubmit={async e=>{e.preventDefault();setBusy(true);setError('');try{await backend.api('/api/projects/create-project',{method:'POST',body:JSON.stringify({path,customName:name})});await refreshSidebar();setCreating(false);setName('');setPath('');}catch(e:any){setError(e.message);}finally{setBusy(false);}}}>
        <label className="block text-sm">{t("Project Name")}<input required className="native-input mt-1" value={name} onChange={e=>setName(e.target.value)}/></label>
        <label className="block text-sm">{t("Ubuntu working directory")}<input required className="native-input mt-1" placeholder={t("/home/user/project")} value={path} onChange={e=>setPath(e.target.value)}/></label>
        <div className="flex gap-3 justify-end"><button type="button" className="workspace-tab" onClick={()=>setCreating(false)}>{t("Cancel")}</button><button disabled={busy} className="workspace-primary">{busy?t("Adding…"):t("Add project")}</button></div>
      </form>}
      <p className="text-sm text-[var(--text-secondary)]">{t("Organize chats by project and give Claude instructions for each project.")}</p>
      <div className="divide-y divide-[var(--border-color)]">{projects.map(p=><button className="w-full flex items-center gap-3 py-3 px-2 text-left hover:bg-[var(--bg-card-hover)] rounded-lg min-w-0" key={p.id} onClick={()=>{setActiveConversationId(null);setActiveProject(p);}}><span className="p-2 bg-[var(--bg-input)] rounded-xl shrink-0"><Folder size={18} strokeWidth={1.5}/></span><span className="flex-1 min-w-0"><span className="block text-sm font-medium truncate">{p.name}</span><span className="block text-xs text-[var(--text-secondary)] truncate mt-1">{p.path}</span></span><ChevronRight size={18} className="shrink-0 text-[var(--text-secondary)]"/></button>)}</div>
    </>}
    {error&&<p role="alert" className="text-red-500">{error}</p>}
  </div></main>;
};
