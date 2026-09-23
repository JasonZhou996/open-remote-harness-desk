import {t} from '../i18n';
import React, {useEffect,useState} from 'react';
import {backend, Instructions} from '../services/backend';

export function NativeInstructions({projectId}:{projectId?:string}) {
  const [doc,setDoc] = useState<Instructions|null>(null);
  const [content,setContent] = useState('');
  const [error,setError] = useState('');
  const [busy,setBusy] = useState(false);
  const [saved,setSaved] = useState(false);
  const load = async () => {setError('');setBusy(true);try {const result=await backend.instructions(projectId);setDoc(result);setContent(result.content);}catch(e:any){setError(e.message);}finally{setBusy(false);}};
  useEffect(() => {let alive=true;setDoc(null);setError('');backend.instructions(projectId).then(value=>{if(alive){setDoc(value);setContent(value.content);}}).catch(e=>{if(alive)setError(e.message);});return()=>{alive=false;};},[projectId]);
  return <div className="space-y-3 min-w-0">
    <p className="text-sm text-[var(--text-secondary)] break-all">{doc?.path || t("Loading CLAUDE.md…")}</p>
    <textarea aria-label={t("Instructions for Claude")} className="native-input min-h-[240px] font-mono text-sm resize-y" disabled={!doc || busy} value={content} onChange={e=>{setContent(e.target.value);setSaved(false);}}/>
    <div className="flex gap-2"><button className="native-button" disabled={!doc||busy} onClick={async()=>{if(!doc)return;setBusy(true);setError('');try {setDoc(await backend.saveInstructions({...doc,content},projectId));setSaved(true);}catch(e:any){setError(e.message);}finally{setBusy(false);}}}>{busy?t("Processing..."):t("Save")}</button><button className="native-button" disabled={busy} onClick={()=>{if(!doc||doc.content===content||confirm(t("Discard unsaved changes and reload?")))void load();}}>{t("Reload")}</button>{saved&&<span className="text-sm self-center">{t("Saved")}</span>}</div>
    {error&&<p role="alert" className="text-sm text-red-500">{error}</p>}
  </div>;
}
