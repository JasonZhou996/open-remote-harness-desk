import {t} from '../i18n';
import React,{useState} from 'react';
import {ShieldAlert} from 'lucide-react';
import {Message} from '../types';
import {backend} from '../services/backend';
export const PermissionCard:React.FC<{message:Message}>=({message})=>{
  const perm=message.permission!;
  const [sent,setSent]=useState(false);const [error,setError]=useState('');
  const [answers,setAnswers]=useState<Record<string,string>>({});
  const questions=perm.toolName==='AskUserQuestion' ? ((perm.input as any)?.questions || []) : [];
  const pending=perm.state==='pending';
  const ready=questions.every((q:any)=>answers[q.question]?.trim());
  const respond=(allow:boolean)=>{try{backend.respondPermission(perm.requestId,allow,questions.length?{...(perm.input as any),answers}:undefined);setSent(true);}catch(e:any){setError(e.message);}};
  return <div className="max-w-3xl mx-auto py-2 px-3 sm:px-6"><div className="native-panel p-4 space-y-3"><div className="flex gap-2 items-center"><ShieldAlert size={18} className="text-[var(--accent-coral)]"/><span>{pending?perm.toolName:perm.state==='allowed'?t("Allowed"):perm.state==='denied'?t("Denied"):t("Cancelled")}</span></div>
    {questions.length?questions.map((q:any,i:number)=><fieldset key={i} disabled={!pending||sent} className="space-y-2"><legend className="text-sm mb-2">{q.question}</legend>{(q.options||[]).map((option:any)=><label className="native-panel flex gap-2 p-2 text-sm" key={option.label}><input type={q.multiSelect?'checkbox':'radio'} name={perm.requestId+'-'+i} checked={q.multiSelect?(answers[q.question]||'').split(', ').includes(option.label):answers[q.question]===option.label} onChange={e=>setAnswers(prev=>{const value=q.multiSelect?new Set((prev[q.question]||'').split(', ').filter(Boolean)):null;if(value){if(e.target.checked)value.add(option.label);else value.delete(option.label);}return {...prev,[q.question]:value?[...value].join(', '):option.label};})}/><span>{option.label}{option.description&&<small className="block text-[var(--text-secondary)]">{option.description}</small>}</span></label>)}<input className="native-input text-sm" aria-label={t("Custom answer")} placeholder={t("You can also enter your own answer")} value={answers[q.question]||''} onChange={e=>setAnswers(prev=>({...prev,[q.question]:e.target.value}))}/></fieldset>):<pre className="text-xs whitespace-pre-wrap break-words max-h-56 overflow-y-auto text-[var(--text-secondary)]">{JSON.stringify(perm.input,null,2)}</pre>}
    {pending&&<div className="flex gap-2"><button disabled={sent||!ready} className="native-button" onClick={()=>respond(true)}>{sent?t("Waiting for confirmation…"):questions.length?t("Submit answer"):t("Allow")}</button><button disabled={sent} className="native-button" onClick={()=>respond(false)}>{t("Deny")}</button></div>}{error&&<p role="alert" className="text-red-500 text-sm">{error}</p>}
  </div></div>;
};
