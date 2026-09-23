import {t} from '../i18n';
import React, {useEffect, useState} from 'react';
import {backend} from '../services/backend';
import {AccountUsage} from './AccountUsage';

export type ContextTokens = {used: number; total?: number; inputTokens: number; outputTokens: number; message?: string};

export function ContextUsage({sessionId, open, onToggle}: {sessionId: string | null; open: boolean; onToggle: () => void}) {
  const [usage, setUsage] = useState<ContextTokens | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true, revision = 0, request = 0, capacityKnown = false;
    setUsage(null); setError('');
    if (!sessionId) return;
    const read = async () => {
      const current = ++request, started = revision;
      try {
        const result = await backend.api<ContextTokens>(`/api/providers/sessions/${encodeURIComponent(sessionId)}/token-usage`);
        if (!alive || current !== request) return;
        capacityKnown = Boolean(result.total);
        setUsage(previous => started === revision || !previous ? result : {...result, ...previous, total: result.total});
        setError(result.message || '');
      } catch { if (alive && current === request) setError(t("Context usage is temporarily unavailable")); }
    };
    void read();
    const unsubscribe = backend.onFrame(frame => {
      if (frame.sessionId !== sessionId) return;
      if (frame.kind === 'status' && frame.text === 'token_budget' && Number.isFinite(frame.tokenBudget?.used)) {
        revision++;
        // Live budgets carry an old fixed capacity. Preserve the limit read from the native CLI.
        const {used, inputTokens, outputTokens} = frame.tokenBudget;
        setUsage(previous => ({used, inputTokens, outputTokens, total: previous?.total}));
        setError('');
        if (revision === 1 && !capacityKnown) void read();
      }
      if (frame.kind === 'complete') void read();
    });
    return () => { alive = false; unsubscribe(); };
  }, [sessionId]);
  const percent = usage?.total ? Math.max(0, Math.min(100, usage.used / usage.total * 100)) : undefined;
  const color = percent !== undefined && percent >= 90 ? '#d95555' : percent !== undefined && percent >= 50 ? '#d99a29' : '#4285d4';
  const label = percent === undefined ? (sessionId ? t("Context usage unavailable") : t("No conversation started")) : t("{value0}% of context used", {value0: Math.round(percent)});
  return <>
    <button type="button" className="workspace-icon !w-8 !h-8" aria-label={t("View plan usage")} aria-expanded={open} aria-haspopup="dialog" title={t("{value0} · View usage", {value0: label})} onClick={onToggle}>
      <svg width="20" height="20" viewBox="0 0 24 24" role="progressbar" aria-label={t("Context usage")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-valuetext={label}>
        <circle cx="12" cy="12" r="8.5" fill="none" stroke="var(--border-color)" strokeWidth="3"/>
        {percent !== undefined && <circle cx="12" cy="12" r="8.5" fill="none" stroke={color} strokeWidth="3" pathLength="100" strokeDasharray={`${percent} 100`} strokeLinecap="round" transform="rotate(-90 12 12)"/>}
      </svg>
    </button>
    {open && <div role="dialog" aria-label={t("Plan usage")} className="native-panel absolute bottom-full right-0 mb-2 p-4 w-[420px] max-w-[calc(100vw-40px)] max-h-[65dvh] overflow-y-auto shadow-lg z-50">
      <AccountUsage compact contextUsage={usage} contextError={error || (!sessionId ? t("No conversation started") : undefined)}/>
    </div>}
  </>;
}
