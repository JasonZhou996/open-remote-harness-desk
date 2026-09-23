import {t} from '../i18n';
import React,{useState,useEffect} from 'react';
import {X,ArrowLeft,ChevronRight} from 'lucide-react';
import {useSettings} from '../context/SettingsContext';
import {useChat} from '../context/ChatContext';
import {backend} from '../services/backend';
import {AccountUsage} from './AccountUsage';
import {NativeInstructions} from './NativeInstructions';

type Tab='general'|'account'|'instructions'|'memory'|'extensions';
const tabs:Tab[]=['general','account','instructions','memory','extensions'];
function NativeMemory(){
  const {activeProject,projects}=useChat();const [projectId,setProjectId]=useState(activeProject?.id || '');const [data,setData]=useState<any>(null);const [error,setError]=useState('');
  useEffect(()=>{let alive=true;setData(null);setError('');backend.api(`/api/providers/claude/memory${projectId?'?projectId='+encodeURIComponent(projectId):''}`).then(r=>{if(alive)setData(r);}).catch(e=>{if(alive)setError(e.message);});return()=>{alive=false;};},[projectId]);
  return <div className="space-y-4"><select aria-label={t("Memory project")} className="native-input" value={projectId} onChange={e=>setProjectId(e.target.value)}><option value="">{t("No project")}</option>{projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select>{error&&<p role="alert">{error}</p>}{data?<><p className="text-sm break-all text-[var(--text-secondary)]">{data.directory}</p>{!data.files.length&&<p>{t("No Claude Code auto-memory files in this working directory yet.")}</p>}{data.files.map((f:any)=><details className="native-panel p-3" key={f.name}><summary className="cursor-pointer">{f.name}</summary><pre className="whitespace-pre-wrap break-words text-sm mt-3 font-mono">{f.content}</pre></details>)}</>:!error&&<p>{t("Loading…")}</p>}</div>;
}
function NativeExtensions(){
  const {catalog,activeProject,catalogError}=useChat();const [mcp,setMcp]=useState<any>(null);const [error,setError]=useState('');
  useEffect(()=>{let alive=true;backend.api(`/api/providers/claude/mcp/servers${activeProject?.path?'?workspacePath='+encodeURIComponent(activeProject.path):''}`).then(r=>{if(alive)setMcp(r);}).catch(e=>{if(alive)setError(e.message);});return()=>{alive=false;};},[activeProject?.path]);
  return <div className="space-y-4"><p className="text-sm text-[var(--text-secondary)]">{t("Claude Code skills and MCP settings for this working directory. Type / in the composer to use a skill.")}</p><h3 className="font-semibold">{t("Skills and plugin commands")}</h3>{catalogError&&<p role="alert">{catalogError}</p>}{catalog?.commands.filter(c=>!c.builtin).map(c=><div className="native-panel p-3" key={c.name}><p className="font-medium break-words">/{c.name}</p><p className="text-sm text-[var(--text-secondary)]">{c.description}</p></div>)}<h3 className="font-semibold">MCP</h3>{error&&<p role="alert">{error}</p>}{mcp?Object.entries(mcp.scopes || {}).map(([scope,servers])=><div key={scope}><h4 className="text-sm text-[var(--text-secondary)]">{scope}</h4>{Array.isArray(servers)&&servers.length?servers.map((s:any,i:number)=><div className="native-panel p-3 mt-2" key={s.name||i}>{s.name}<span className="text-sm text-[var(--text-secondary)] ml-2">{s.transport || s.type}</span></div>):<p className="text-sm my-2">{t("Not configured")}</p>}</div>):!error&&<p>{t("Loading…")}</p>}</div>;
}
export const CustomizeModal:React.FC=()=>{
  const {isSettingsOpen,setIsSettingsOpen,settings,updateSettings}=useSettings();
  const [tab,setTab]=useState<Tab>('general');const [detail,setDetail]=useState(false);
  const en=settings.language==='en';const names:Record<Tab,string>=en?{general:'Appearance & language',account:'Account & usage',instructions:'Instructions for Claude',memory:'Memory',extensions:'Skills & MCP'}:{general:t("Appearance & language"),account:t("Account & usage"),instructions:t("Instructions for Claude"),memory:t("Memory"),extensions:t("Skills & MCP")};
  useEffect(()=>{if(!isSettingsOpen)setDetail(false);},[isSettingsOpen]);
  useEffect(()=>{const handle=(e:Event)=>{const value=(e as CustomEvent).detail;if(tabs.includes(value)){setTab(value);setDetail(true);}};window.addEventListener('claude-settings-tab',handle);return()=>window.removeEventListener('claude-settings-tab',handle);},[]);
  useEffect(()=>{const key=(e:KeyboardEvent)=>{if(e.key==='Escape')setIsSettingsOpen(false);};if(isSettingsOpen)window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);},[isSettingsOpen]);
  if(!isSettingsOpen)return null;
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 sm:p-5" role="dialog" aria-modal="true" aria-label={en?'Settings':t("Settings")} onClick={()=>setIsSettingsOpen(false)}><div className="native-panel w-full max-w-4xl h-[100dvh] sm:h-[min(720px,90dvh)] flex flex-col overflow-hidden !rounded-none sm:!rounded-2xl" onClick={e=>e.stopPropagation()}>
    <header className="shrink-0 flex items-center gap-3 p-4 border-b border-[var(--border-color)]">{detail&&<button aria-label={t("Back to settings categories")} className="md:hidden native-button" onClick={()=>setDetail(false)}><ArrowLeft size={18}/></button>}<h2 className="flex-1 font-semibold">{detail?names[tab]:en?'Settings':t("Settings")}</h2><button aria-label={t("Close settings")} className="native-button" onClick={()=>setIsSettingsOpen(false)}><X size={20}/></button></header>
    <div className="flex min-h-0 flex-1"><nav aria-label={t("Settings categories")} className={`${detail?'hidden md:block':'block'} w-full md:w-56 shrink-0 p-3 overflow-y-auto md:border-r border-[var(--border-color)]`}>{tabs.map(value=><button className="nav-row" aria-current={tab===value?'page':undefined} key={value} onClick={()=>{setTab(value);setDetail(true);}}><span className="flex-1">{names[value]}</span><ChevronRight size={16} className="md:hidden"/></button>)}</nav>
      <section className={`${detail?'block':'hidden md:block'} min-w-0 flex-1 p-5 sm:p-7 overflow-y-auto`}>
        <h2 className="hidden md:block text-xl font-semibold mb-6">{names[tab]}</h2>
        {tab==='general'&&<div className="space-y-6"><label className="block">{en?'Theme':t("Theme")}<select className="native-input mt-2" value={settings.theme} onChange={e=>updateSettings({theme:e.target.value as any})}><option value="system">{en?'System':t("System default")}</option><option value="light">{en?'Light':t("Light")}</option><option value="dark">{en?'Dark':t("Dark")}</option></select></label><label className="block">{en?'Language':t("Language")}<select className="native-input mt-2" value={en?'en':'zh'} onChange={e=>updateSettings({language:e.target.value})}><option value="zh">简体中文</option><option value="en">English</option></select></label></div>}
        {tab==='account'&&<AccountUsage/>}{tab==='instructions'&&<NativeInstructions/>}{tab==='memory'&&<NativeMemory/>}{tab==='extensions'&&<NativeExtensions/>}
      </section>
    </div>
  </div></div>;
};
