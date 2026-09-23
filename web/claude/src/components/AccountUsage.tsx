import {t, uiLocale} from '../i18n';
import React, {useEffect, useState} from 'react';
import {RefreshCw} from 'lucide-react';
import {useAuth} from '../context/AuthContext';
import {subscribeUsage, refreshUsage, UsageInfo} from '../services/usage';
import type {ContextTokens} from './ContextUsage';

const tokens = (value: number) => value >= 1_000_000 ? `${+(value / 1_000_000).toFixed(1)}M` : value >= 1000 ? `${+(value / 1000).toFixed(1)}k` : String(value);

export function AccountUsage({compact = false, contextUsage, contextError}: {compact?: boolean; contextUsage?: ContextTokens | null; contextError?: string}) {
  const {user} = useAuth();
  const [info, setInfo] = useState<UsageInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => subscribeUsage(setInfo), []);
  return <div className="space-y-4 text-sm">
    {contextUsage !== undefined && <details className="border-b border-[var(--border-color)] pb-4" aria-label={t("Context window")}>
      <summary className="cursor-pointer list-none text-[var(--text-secondary)]">
        <div className="flex flex-wrap justify-between gap-2"><span>{t("Context window")}</span><span>{contextUsage?.total ? `${tokens(contextUsage.used)} / ${tokens(contextUsage.total)} (${Math.round(contextUsage.used / contextUsage.total * 100)}%)` : contextUsage?.used ? t("{value0} / limit unavailable", {value0: tokens(contextUsage.used)}) : contextError || t("Loading…")} <span aria-hidden="true">›</span></span></div>
        <div className="flex h-1 rounded-full overflow-hidden bg-[var(--border-color)] mt-3" aria-hidden="true">
          <div className="h-full shrink-0 bg-[#4285d4]" style={{width: `${contextUsage?.total ? Math.min(100, contextUsage.inputTokens / contextUsage.total * 100) : 0}%`}}/>
          <div className="h-full shrink-0 bg-[#d97757]" style={{width: `${contextUsage?.total ? Math.min(100, contextUsage.outputTokens / contextUsage.total * 100) : 0}%`}}/>
        </div>
      </summary>
      <div className="pt-3 space-y-1 text-xs text-[var(--text-secondary)]">
        {contextUsage && <><p>{t("Input (including cache):")}{contextUsage.inputTokens.toLocaleString()} tokens</p><p>{t("Output:")}{contextUsage.outputTokens.toLocaleString()} tokens</p></>}
        {contextError && <p role="status">{contextError}</p>}
      </div>
    </details>}
    {!compact && <div><h3 className="font-medium">{user?.name || 'Claude Code'}</h3><p className="text-[var(--text-secondary)]">{user?.email}</p></div>}
    <div className="flex items-center justify-between gap-2 border-b border-[var(--border-color)] pb-3">
      <span className="text-[var(--text-secondary)]">{t("Plan usage ·")} {info?.plan || t("Unavailable")}</span>
      <button type="button" aria-label={t("Refresh usage")} disabled={busy} className="workspace-icon !w-8 !h-8" title={t("Refresh usage")} onClick={async () => {
        setBusy(true); setError('');
        const result = await refreshUsage();
        if (!result) setError(t("Refresh failed. Please try again."));
        setBusy(false);
      }}><RefreshCw size={15} className={busy ? 'animate-spin' : ''}/></button>
    </div>
    {([['five_hour', t("5-hour window")], ['seven_day', t("Weekly window")]] as const).map(([key, label]) => {
      const win = info?.usage?.[key];
      const available = Number.isFinite(win?.utilization);
      const used = available ? Math.max(0, Math.min(100, win.utilization)) : 0;
      return <div key={key}>
        <div className="flex justify-between gap-2 mb-2"><span>{label}</span><span className="text-[var(--text-secondary)]">{available ? t("{value0}% used", {value0: Math.round(used)}) : t("Unavailable. Please refresh.")}</span></div>
        <div className="h-1 rounded-full bg-[var(--border-color)]" role="progressbar" aria-label={label} aria-valuenow={available ? used : undefined} aria-valuetext={available ? undefined : t("Unavailable")}><div className="h-full rounded-full bg-[#4285d4]" style={{width: `${used}%`}}/></div>
        {win?.resets_at && <p className="text-xs text-[var(--text-secondary)] mt-2">{new Date(win.resets_at).toLocaleString(uiLocale())}  {t("Resets")}</p>}
      </div>;
    })}
    {busy && <p role="status" className="text-xs text-[var(--text-secondary)]">{t("Loading usage…")}</p>}
    {(error || info?.error) && <p role="alert" className="text-sm text-red-500 break-words">{error || info?.error}</p>}
  </div>;
}
