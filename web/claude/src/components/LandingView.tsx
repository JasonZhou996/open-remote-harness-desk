import {t} from '../i18n';
import React,{useState,useRef,useEffect} from 'react';
import {PanelLeftOpen,Folder,Monitor,Check,ChevronDown} from 'lucide-react';
import {ClaudeStarburst} from './ClaudeIcons';
import {ChatInput} from './ChatInput';
import {useChat} from '../context/ChatContext';
import {useSettings} from '../context/SettingsContext';
import {useAuth} from '../context/AuthContext';
import {Statistics} from './WorkspaceTools';
import {SessionImport} from './SessionImport';
export const LandingView:React.FC<{isSidebarOpen?:boolean;onToggleSidebar?:()=>void}>=({isSidebarOpen,onToggleSidebar})=>{
  const {activeProject,setActiveProject,projects}=useChat();const {settings}=useSettings();const {user}=useAuth();
  const [projectOpen,setProjectOpen]=useState(false);
  const projectMenu=useRef<HTMLDivElement>(null),projectButton=useRef<HTMLButtonElement>(null);
  const english=settings.language==='en';
  useEffect(()=>{
    if(!projectOpen)return;
    const outside=(event:PointerEvent)=>{if(!projectMenu.current?.contains(event.target as Node))setProjectOpen(false);};
    const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'){setProjectOpen(false);projectButton.current?.focus();}};
    document.addEventListener('pointerdown',outside);document.addEventListener('keydown',escape);
    return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',escape);};
  },[projectOpen]);
  return <div className="flex-1 flex flex-col min-w-0 min-h-0 relative overflow-hidden bg-[var(--bg-primary)] text-[var(--text-primary)]">
    {!isSidebarOpen&&<button className="absolute z-10 top-3 left-3 workspace-icon bg-[var(--bg-primary)]" aria-label={t("Open sidebar")} onClick={onToggleSidebar}><PanelLeftOpen size={20}/></button>}
    <div className="flex-1 min-h-0 min-w-0 overflow-y-auto overflow-x-hidden overscroll-contain" role="region" aria-label={t("New chat overview")}>
    <div className="w-full max-w-5xl mx-auto flex flex-col px-4 sm:px-8 pb-6 pt-14 sm:pt-16 gap-6">
      <div className="flex items-center gap-2.5"><ClaudeStarburst size={28} color="#DA7756"/><h1 className="text-[22px] sm:text-2xl font-normal leading-snug">{user?.name ? t("What's next, {name}?", {name: user.name}) : t("What's next?")}</h1></div>
      <Statistics/>
    </div>
    </div>
      <div className="shrink-0 min-w-0 w-full max-w-5xl mx-auto bg-[var(--bg-primary)] px-4 sm:px-8 pt-3 pb-3" aria-label={t("New chat composer")}>
        <div className="flex items-center gap-2 mb-3 text-sm text-[var(--text-secondary)] claude-project-tools">
          <span className="inline-flex items-center gap-2 rounded-lg px-3 py-1.5 bg-[var(--bg-input)]"><Monitor size={16}/>{english?'Local':t("Local")}</span>
          <div ref={projectMenu} className="relative min-w-0 max-w-[70%]">
            <button ref={projectButton} aria-label={english?'Choose project':t("Choose project")} aria-expanded={projectOpen} aria-haspopup="menu" className="inline-flex items-center gap-2 rounded-lg px-3 py-1.5 bg-[var(--bg-input)] hover:bg-[var(--bg-card-hover)] max-w-full" onClick={()=>setProjectOpen(!projectOpen)}><Folder size={16} className="shrink-0"/><span className="truncate">{activeProject?.name || (english?'No folder':t("No project"))}</span><ChevronDown size={14} className="shrink-0"/></button>
            {projectOpen&&<div role="menu" aria-label={english?'Projects':t("Project")} className="native-panel absolute bottom-full left-0 mb-2 p-1 w-[300px] max-w-[calc(100vw-140px)] max-h-[50dvh] overflow-y-auto shadow-lg z-40">
              {[null,...projects].map(project=><button key={project?.id??'none'} role="menuitemradio" aria-checked={(activeProject?.id??null)===(project?.id??null)} className="nav-row" onClick={()=>{setActiveProject(project);setProjectOpen(false);projectButton.current?.focus();}}>
                <Folder size={16} className="shrink-0"/><span className="flex-1 min-w-0"><span className="block truncate">{project?.name || (english?'No folder':t("No project"))}</span>{project?.path&&<span className="block truncate text-xs text-[var(--text-muted)]" title={project.path}>{project.path}</span>}</span>{(activeProject?.id??null)===(project?.id??null)&&<Check size={16} className="shrink-0"/>}
              </button>)}
            </div>}
          </div>
          <SessionImport/>
        </div>
        <ChatInput fullWidth/>
      </div>
  </div>;
};
