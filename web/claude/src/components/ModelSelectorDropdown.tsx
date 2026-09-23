import {t} from '../i18n';
import React, {useState, useEffect, useRef} from 'react';
import {Check, ChevronLeft, ChevronRight, Info, CircleHelp} from 'lucide-react';
import {useChat} from '../context/ChatContext';
import {useSettings} from '../context/SettingsContext';
import {NativeModel} from '../services/backend';
import {ThinkingEffort} from '../types';

// The native description includes the version; displayName can be only "Opus".
const modelName = (model: NativeModel) => model.description.split(' · ')[0] || model.resolvedModel || model.displayName;

export const ModelSelectorDropdown: React.FC = () => {
  const {catalog, catalogError, selectedModel, setSelectedModel} = useChat();
  const {settings, updateSettings} = useSettings();
  const [open, setOpen] = useState<'model'|'effort'|null>(null);
  const [more, setMore] = useState<'side'|'inside'|null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const current = catalog?.models.find(m => m.value === selectedModel) || catalog?.models.find(m => m.resolvedModel === selectedModel);
  const levels = current?.supportsEffort ? current.supportedEffortLevels || [] : [];
  const english = settings.language === 'en';
  const labels:Record<string,string> = english ? {low:'Low',medium:'Medium',high:'High',xhigh:'Extra high',max:'Max',ultracode:'Ultracode'} : {low:t("Low"),medium:t("Medium"),high:t("High"),xhigh:t("Extra High"),max:'Max',ultracode:'Ultracode'};
  const effortIndex = Math.max(0, levels.indexOf(settings.thinkingEffort));
  const ultra = settings.thinkingEffort === 'ultracode';
  // Show the named model once, with a badge when it is also the CLI default.
  const defaultModel = catalog?.models.find(model => model.value === 'default');
  const models = (catalog?.models || []).filter(model => model.value !== 'default' || !model.resolvedModel || !catalog?.models.some(other => other.value !== 'default' && other.resolvedModel === model.resolvedModel));
  const mainModels = models.filter(model => model.menuGroup !== 'more');
  const primary = mainModels.slice(0, 4), extra = [...mainModels.slice(4), ...models.filter(model => model.menuGroup === 'more')];
  const close = () => {setOpen(null);setMore(null);};
  const showMore = () => setMore((menuRef.current?.getBoundingClientRect().left || 0) >= 300 ? 'side' : 'inside');
  useEffect(() => {
    const show = (event:Event) => {setMore(null);setOpen((event as CustomEvent).detail === 'effort' ? 'effort' : 'model');};
    const outside = (event:PointerEvent) => {if(!ref.current?.contains(event.target as Node)) close();};
    const escape = (event:KeyboardEvent) => {if(event.key === 'Escape') close();};
    window.addEventListener('claude-model-menu',show);
    document.addEventListener('pointerdown',outside);
    document.addEventListener('keydown',escape);
    window.addEventListener('resize',close);
    return () => {window.removeEventListener('claude-model-menu',show);document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',escape);window.removeEventListener('resize',close);};
  }, []);
  const row = (model:NativeModel) => {
    const selected = model.value === selectedModel || (model.resolvedModel ? model.resolvedModel === current?.resolvedModel : model.value === current?.value);
    return <button key={model.value} type="button" role="menuitemradio" aria-checked={selected} className="nav-row !gap-2 !px-2.5 !py-1.5 text-sm" title={`${model.resolvedModel || model.value}\n${model.description}`} onClick={() => {
      setSelectedModel(model.value);
      if(model.supportedEffortLevels?.length && !model.supportedEffortLevels.includes(settings.thinkingEffort)) updateSettings({thinkingEffort:(model.supportedEffortLevels.includes('high') ? 'high' : model.supportedEffortLevels[0]) as ThinkingEffort});
      close();
    }}>
      <span className="min-w-0 [overflow-wrap:anywhere]">{modelName(model)}</span>
      {(model.value === 'default' || (model.resolvedModel && model.resolvedModel === defaultModel?.resolvedModel)) && <small className="rounded bg-[var(--bg-card-hover)] px-1 text-[var(--text-secondary)]">{english ? 'Default' : t("Default")}</small>}
      {model.description.includes('Requires usage credits') && <small className="flex items-center gap-1 rounded bg-[var(--bg-card-hover)] px-1 text-[var(--text-secondary)]"><Info size={11}/>{english ? 'Usage credits' : t("Uses plan quota")}</small>}
      <span className="flex-1"/>{selected && <Check size={15} className="shrink-0 text-[#4285d4]"/>}
    </button>;
  };
  return <div className="relative flex items-center gap-0.5 min-w-0" ref={ref}>
    <button type="button" className="composer-control rounded-md px-2 py-1 text-sm shrink-0 whitespace-nowrap hover:bg-[var(--bg-card-hover)]" aria-label={t("Select model")} aria-haspopup="menu" aria-expanded={open==='model'} onClick={() => {setMore(null);setOpen(open==='model'?null:'model');}} title={current?.resolvedModel || selectedModel}>
      <span className="block">{current ? modelName(current) : selectedModel === 'default' ? 'Claude Code' : selectedModel}</span>
    </button>
    {levels.length>0&&<button type="button" className="composer-control rounded-md px-2 py-1 text-sm shrink-0 whitespace-nowrap hover:bg-[var(--bg-card-hover)]" aria-label={t("Reasoning")} aria-haspopup="dialog" aria-expanded={open==='effort'} onClick={()=>{setMore(null);setOpen(open==='effort'?null:'effort');}}>{labels[settings.thinkingEffort] || settings.thinkingEffort}</button>}
    {open && <div ref={menuRef} className={`native-panel absolute bottom-full right-0 mb-2 ${open==='model'?'p-1 w-[288px]':'p-4 w-[320px]'} max-w-[calc(100vw-40px)] z-50 shadow-lg`}>
      <div role={open==='model'?'menu':'dialog'} aria-label={open==='model'?t("Model"):t("Reasoning")} className="max-h-[60dvh] overflow-y-auto">
        {open==='model' ? (catalogError ? <p role="alert" className="p-2 text-sm">{catalogError}</p> : !catalog ? <p className="p-2 text-sm">{t("Loading Claude Code…")}</p> : more==='inside' ? <>
          <button type="button" role="menuitem" className="nav-row !py-1.5 text-sm" onClick={()=>setMore(null)}><ChevronLeft size={14}/>{english?'Back':t("Back to models")}</button>{extra.map(row)}
        </> : <>
          {primary.map(row)}
          {extra.length>0&&<div className="border-t border-[var(--border-color)] mt-1 pt-1"><button type="button" role="menuitem" aria-haspopup="menu" aria-expanded={Boolean(more)} className="nav-row !gap-2 !px-2.5 !py-1.5 text-sm" onClick={()=>more?setMore(null):showMore()} onPointerEnter={e=>{if(e.pointerType==='mouse')showMore();}} onKeyDown={e=>{if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();showMore();}}}><span className="flex-1">{english?'More models':t("More models")}</span><ChevronRight size={15}/></button></div>}
        </>) : levels.length ? <>
          <div className="flex items-center gap-2 text-sm"><span className="text-[var(--text-secondary)]">{english?'Effort':t("Thinking depth")}</span><span aria-live="polite" className={ultra?'text-[#a99aef]':''}>{labels[settings.thinkingEffort] || settings.thinkingEffort}</span><span className="ml-auto text-[var(--text-secondary)]" title={english?'Higher effort gives Claude more time to reason. Ultracode enables workflow orchestration.':t("Higher levels allow more thinking time; Ultracode also enables workflow orchestration.")}><CircleHelp size={15}/></span></div>
          <div className="flex justify-between text-sm text-[var(--text-secondary)] mt-7 mb-3"><span>{english?'Faster':t("Faster")}</span><span>{english?'Smarter':t("Deeper")}</span></div>
          <div className={`claude-effort-track ${ultra?'is-ultra':''}`} style={{'--effort-position':`${levels.length>1?effortIndex/(levels.length-1)*100:0}%`} as React.CSSProperties}>
            <div className="claude-effort-fill"/>
            <div className="claude-effort-dots" aria-hidden="true">{levels.map(level=><span key={level}/>)}</div>
            <input type="range" aria-label={t("Thinking depth")} aria-valuetext={labels[settings.thinkingEffort] || settings.thinkingEffort} min={0} max={levels.length-1} step={1} value={effortIndex} onChange={event=>updateSettings({thinkingEffort:levels[Number(event.target.value)] as ThinkingEffort})}/>
          </div>
        </> : <p className="p-3 text-sm text-[var(--text-secondary)]">{t("This model does not offer thinking effort options.")}</p>}
      </div>
      {more==='side'&&<div role="menu" aria-label={t("More models")} className="native-panel absolute right-full bottom-0 mr-1 w-[288px] p-1 max-h-[60dvh] overflow-y-auto shadow-lg">{extra.map(row)}</div>}
    </div>}
  </div>;
};
