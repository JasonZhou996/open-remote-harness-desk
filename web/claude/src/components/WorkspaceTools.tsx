import {t, uiLocale} from '../i18n';
import React, { useEffect, useState } from 'react';
import { ArrowUpRight, Clock, Plus, RefreshCw, X } from 'lucide-react';
import { backend } from '../services/backend';
import { useChat } from '../context/ChatContext';
import { useSettings } from '../context/SettingsContext';

type StatisticsData = {
  sessions: number;
  messages: number;
  activeDays: number;
  models: Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }>;
  daily: Record<string, number>;
  source: string;
  updatedAt: string;
};

export function Statistics() {
  const [days, setDays] = useState('0');
  const [tab, setTab] = useState('overview');
  const [data, setData] = useState<StatisticsData | null>(null);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let alive = true;
    setData(null);
    setError('');
    backend.api(`/api/providers/claude/statistics?days=${days}`)
      .then(r => { if (alive) setData(r); })
      .catch(e => { if (alive) setError(e.message); });
    return () => { alive = false; };
  }, [days, revision]);
  const total = data ? Object.values(data.models).reduce((sum, v) => sum + v.input + v.output + v.cacheRead + v.cacheWrite, 0) : 0;
  const span = days === '0' ? 182 : Number(days);
  const dates = Array.from({ length: span }, (_, i) => {
    const date = new Date(data?.updatedAt || Date.now());
    date.setUTCDate(date.getUTCDate() - span + 1 + i);
    return date.toISOString().slice(0, 10);
  });
  const peak = Math.max(1, ...dates.map(date => data?.daily[date] || 0));

  return <section aria-label={t("Usage statistics")} className="w-full max-w-[480px] text-sm [&_.workspace-tab]:px-2 [&_.workspace-tab]:py-1 [&_.workspace-tab]:text-xs [&_.workspace-icon]:w-7 [&_.workspace-icon]:h-7">
      <div className="rounded-xl bg-[var(--bg-input)] p-3">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
          <div className="flex gap-1" aria-label={t("Statistics view")}>
            <button className="workspace-tab" aria-pressed={tab === 'overview'} onClick={() => setTab('overview')}>{t("Overview")}</button>
            <button className="workspace-tab" aria-pressed={tab === 'models'} onClick={() => setTab('models')}>{t("Model")}</button>
          </div>
          <div className="flex items-center gap-1" aria-label={t("Statistics period")}>
            {[['0', t("All time")], ['30', t("30 days")], ['7', t("7 days")]].map(([value, label]) =>
              <button className="workspace-tab" key={value} aria-pressed={days === value} onClick={() => setDays(value)}>{label}</button>
            )}
            <button className="workspace-icon" aria-label={t("Refresh statistics")} title={t("Refresh statistics")} onClick={() => setRevision(r => r + 1)}><RefreshCw size={17} /></button>
          </div>
        </div>
        {error && <p role="alert" className="text-sm text-red-500 py-4">{error}</p>}
        {!data && !error && <p role="status" className="py-8 text-center text-sm text-[var(--text-secondary)]">{t("Loading local session history…")}</p>}
        {data && (tab === 'overview' ? <>
          <div className="grid grid-cols-2 min-[400px]:grid-cols-4 gap-1.5">
            {([[t("Sessions"), data.sessions], [t("Messages"), data.messages], [t("Total tokens"), total], [t("Active days"), data.activeDays]] as const).map(([label, value]) =>
              <div className="rounded-lg bg-[var(--bg-card-hover)] px-2 py-1.5 min-w-0" key={label}>
                <div className="text-xs text-[var(--text-secondary)]">{label}</div>
                <div className="text-sm font-medium tabular-nums mt-0.5 break-all" title={value.toLocaleString()}>{Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(value)}</div>
              </div>
            )}
          </div>
          <div className="flex items-center justify-between text-xs text-[var(--text-secondary)] mt-3 mb-1.5">
            <span>{days === '0' ? t("Activity over the last 26 weeks") : t("Activity over the last {value0} days", {value0: days})}</span><span>{t("Daily messages · UTC")}</span>
          </div>
          <div className="grid grid-rows-7 grid-flow-col auto-cols-fr gap-[3px]" style={{maxWidth: Math.ceil(span / 7) * 15 - 3}} role="img" aria-label={t("Daily messages; darker colors indicate more messages")}>
            {dates.map(date => {
              const count = data.daily[date] || 0;
              return <span key={date} title={t("{value0} · {value1} messages", {value0: date, value1: count})} className="h-2.5 sm:h-3 rounded-[2px]"
                style={{ backgroundColor: count ? `rgba(90, 145, 220, ${0.3 + count / peak * 0.7})` : 'var(--border-color)' }} />;
            })}
          </div>
        </> : <div className="overflow-x-auto">
          {Object.keys(data.models).length ? <table className="w-full text-xs text-left whitespace-nowrap">
            <thead><tr className="text-[var(--text-secondary)]">{[t("Model"), t("Input"), t("Output"), t("Cache reads"), t("Cache writes")].map(label => <th key={label} className="font-normal pb-2 pr-3">{label}</th>)}</tr></thead>
            <tbody>{Object.entries(data.models).map(([name, v]) => <tr key={name} className="border-t border-[var(--border-color)]">
              <td className="py-2 pr-3">{name}</td>
              {[v.input, v.output, v.cacheRead, v.cacheWrite].map((n, i) => <td className="pr-3 tabular-nums" key={i}>{n.toLocaleString()}</td>)}
            </tr>)}</tbody>
          </table> : <p className="py-6 text-center text-sm text-[var(--text-secondary)]">{t("No model usage recorded for this period.")}</p>}
        </div>)}
      </div>
  </section>;
}

export function Routines() {
  const { conversations, activeConversationId, projects, selectedModel, permissionMode, catalog, catalogError, refreshSidebar, selectConversation } = useChat();
  const { settings } = useSettings();
  const [model, setModel] = useState(selectedModel);
  const [permission, setPermission] = useState(permissionMode);
  const [items, setItems] = useState<any[]>([]);
  const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState(activeConversationId || '');
  const [project, setProject] = useState('');
  const [text, setText] = useState('');
  const [when, setWhen] = useState('');
  const [repeat, setRepeat] = useState('0');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const load = async () => {
    setLoading(true); setError('');
    try { setItems((await backend.api('/api/scheduled-messages?kind=schedule')).items); }
    catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);
  const statuses: Record<string, string> = { pending: t("Pending"), running: t("Running"), sent: t("Completed"), failed: t("Failed"), cancelled: t("Cancelled") };
  const permissions: Record<string, string> = { auto: t("Auto (automatic approval)"), default: t("Ask for approval"), acceptEdits: t("Auto-edit"), plan: t("Plan mode"), bypassPermissions: t("Full access") };
  const taskModel = catalog?.models.find(m => m.value === model || m.resolvedModel === model);

  return <main className="workspace-page">
    <div className="max-w-5xl mx-auto">
      <h1 className="workspace-title mb-6">{t("Scheduled tasks")}</h1>
      <div className="flex items-center justify-between gap-3 mb-6">
        <span className="workspace-tab bg-[var(--bg-card-hover)] !text-[var(--text-primary)]">{t("My tasks")}</span>
        <div className="flex items-center gap-2">
          <button className="workspace-icon" aria-label={t("Refresh tasks")} title={t("Refresh tasks")} disabled={loading} onClick={() => void load()}><RefreshCw size={18} className={loading ? 'animate-spin' : ''} /></button>
          <button className="workspace-primary" aria-expanded={creating} onClick={() => setCreating(!creating)}><Plus size={16} />{t("New task")}</button>
        </div>
      </div>
      {creating && <form className="border border-[var(--border-color)] rounded-xl p-5 sm:p-6 mb-6 space-y-5" onSubmit={async e => {
        e.preventDefault(); setBusy(true); setError('');
        try {
          let id = session;
          if (!id) {
            const p = projects.find(x => x.id === project);
            const created = await backend.createSession(p?.path || catalog?.cwd || (await backend.workspace()).cwd, text);
            id = created.sessionId; setSession(id); await refreshSidebar();
          }
          await backend.api('/api/scheduled-messages', { method: 'POST', body: JSON.stringify({ kind: 'schedule', sessionId: id, content: text, scheduledFor: new Date(when).toISOString(), repeatHours: Number(repeat), options: { model, effort: taskModel?.supportsEffort && taskModel.supportedEffortLevels?.includes(settings.thinkingEffort) ? settings.thinkingEffort : undefined, permissionMode: permission } }) });
          setText(''); setCreating(false); await load();
        } catch (e: any) { setError(e.message); }
        finally { setBusy(false); }
      }}>
        <div className="flex items-center justify-between"><h2 className="font-sans text-base font-medium">{t("New scheduled task")}</h2><button type="button" aria-label={t("Close task form")} className="workspace-icon" onClick={() => setCreating(false)}><X size={18} /></button></div>
        <div className="grid sm:grid-cols-2 gap-4">
          <label className="block text-sm">{t("Chats")}<select className="native-input mt-2" value={session} onChange={e => setSession(e.target.value)}><option value="">{t("New task conversation")}</option>{conversations.map(c => <option value={c.id} key={c.id}>{c.title}</option>)}</select></label>
          {!session && <label className="block text-sm">{t("Project")}<select className="native-input mt-2" value={project} onChange={e => setProject(e.target.value)}><option value="">{t("No project")}</option>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>}
        </div>
        <label className="block text-sm">{t("Task prompt")}<textarea required className="native-input mt-2 min-h-28 resize-y" placeholder={t("What should Claude do?")} value={text} onChange={e => setText(e.target.value)} /></label>
        <div className="grid sm:grid-cols-2 gap-4">
          <label className="text-sm">{t("Model")}<select aria-label={t("Task model")} className="native-input mt-2" value={model} onChange={e => setModel(e.target.value)} disabled={busy}>
            {!catalog?.models.some(m => m.value === model) && <option value={model}>{model}</option>}
            {catalog?.models.map(m => <option value={m.value} key={m.value}>{m.value === 'default' ? t("Default · ") : ''}{m.description || m.displayName}</option>)}
          </select></label>
          <label className="text-sm">{t("Permissions")}<select aria-label={t("Task permissions")} className="native-input mt-2" value={permission} onChange={e => setPermission(e.target.value)} disabled={busy}>{Object.entries(permissions).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
        </div>
        {catalogError && <p role="alert" className="text-sm text-red-500">{catalogError}</p>}
        <div className="grid sm:grid-cols-2 gap-4">
          <label className="text-sm">{t("First run (local time)")}<input required type="datetime-local" className="native-input mt-2" value={when} onChange={e => setWhen(e.target.value)} /></label>
          <label className="text-sm">{t("Repeat")}<select className="native-input mt-2" value={repeat} onChange={e => setRepeat(e.target.value)}><option value="0">{t("Once")}</option><option value="24">{t("24 hours after completion")}</option><option value="168">{t("7 days after completion")}</option></select></label>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-4 border-t border-[var(--border-color)] pt-4">
          <p className="text-xs text-[var(--text-secondary)] break-words">{taskModel?.displayName || model} · {permissions[permission]}</p>
          <button className="workspace-primary" disabled={busy}>{busy ? t("Saving…") : t("Create task")}</button>
        </div>
      </form>}
      {error && <p role="alert" className="text-sm text-red-500 mb-5">{error}</p>}
      {!items.length && !creating && !error && <div className="flex flex-col items-center justify-center text-center py-12 sm:py-16">
        <svg viewBox="0 0 128 148" width="108" height="125" fill="none" className="text-[var(--text-primary)] mb-8" aria-hidden="true">
          <g stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" opacity=".85">
            <path d="M51 26l.4-9.2m20.7 9.5-.3-9.5M44 16.5l-.5-8.2q0-3 3.4-3l28.5.8q3 .1 2.8 3.4l-.4 8.2-12.6-.5-.2 9" />
            <path d="m96 34 6-6.6q1.9-1.9 3.6.1l7 7q1.9 2-.1 3.8l-6.4 6.2" />
            <path d="M63 27C91 26 116 49 116.5 78.5c.7 30.9-20.7 57.2-51.6 58.5C35 138.3 12 116 11.5 84.5 11 54.4 32.7 28 63 27Z" fill="var(--bg-card-hover)" />
            <path d="m62.3 44 .8 39.9q0 2.3 2.3 1.2L92 67.5" />
          </g>
        </svg>
        <p className="text-[var(--text-secondary)]">{loading ? t("Loading scheduled tasks…") : t("No scheduled tasks yet")}</p>
        {!loading && <p className="text-sm text-[var(--text-muted)] mt-2">{t("Schedule a time for Claude to continue working for you.")}</p>}
      </div>}
      <div className="divide-y divide-[var(--border-color)]">
        {items.map(row => <div key={row.id} className="flex items-start gap-4 py-5">
          <div className="rounded-xl bg-[var(--bg-input)] p-3 shrink-0"><Clock size={21} strokeWidth={1.5} className="text-[var(--text-secondary)]" /></div>
          <div className="flex-1 min-w-0">
            <button className="group flex items-start gap-2 text-left max-w-full hover:underline underline-offset-4" onClick={() => selectConversation(row.session_id)}><span className="break-words min-w-0">{row.content}</span><ArrowUpRight size={16} className="shrink-0 mt-1 text-[var(--text-muted)]" /></button>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--text-secondary)] mt-2"><time dateTime={row.scheduled_for}>{new Date(row.scheduled_for).toLocaleString(uiLocale())}</time><span>{statuses[row.status] || row.status}</span></div>
            {row.failure_reason && <p className="text-sm text-red-500 mt-2 break-words">{row.failure_reason}</p>}
            {['pending', 'running', 'failed'].includes(row.status) && <button className="text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] underline underline-offset-4 mt-3" onClick={async () => {
              try { await backend.api(`/api/scheduled-messages/${row.id}`, { method: 'DELETE' }); await load(); }
              catch (e: any) { setError(e.message); }
            }}>{row.status === 'running' ? t("Cancel future runs") : t("Cancel task")}</button>}
          </div>
        </div>)}
      </div>
    </div>
  </main>;
}
