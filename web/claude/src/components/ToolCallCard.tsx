import React, { useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Wrench,
  Terminal,
  FileText,
  Search,
  PenLine,
  Globe,
  AlertCircle,
  Check
} from 'lucide-react';
import type { Message } from '../types';
import { t } from '../i18n';

/** Pick the one input field worth showing on the collapsed card. */
function summarizeInput(input: unknown): { label: string; icon: React.ReactNode } {
  const i = (input ?? {}) as Record<string, any>;
  if (typeof i.file_path === 'string') return { label: i.file_path, icon: <FileText className="w-3.5 h-3.5 shrink-0" /> };
  if (typeof i.path === 'string') return { label: i.path, icon: <FileText className="w-3.5 h-3.5 shrink-0" /> };
  if (typeof i.command === 'string') return { label: i.command, icon: <Terminal className="w-3.5 h-3.5 shrink-0" /> };
  if (typeof i.pattern === 'string') return { label: i.pattern, icon: <Search className="w-3.5 h-3.5 shrink-0" /> };
  if (typeof i.url === 'string') return { label: i.url, icon: <Globe className="w-3.5 h-3.5 shrink-0" /> };
  if (typeof i.description === 'string') return { label: i.description, icon: <Wrench className="w-3.5 h-3.5 shrink-0" /> };
  const keys = Object.keys(i);
  if (keys.length > 0) {
    const first = i[keys[0]];
    const text = typeof first === 'string' ? first : JSON.stringify(first);
    return { label: `${keys[0]}: ${text}`.slice(0, 80), icon: <Wrench className="w-3.5 h-3.5 shrink-0" /> };
  }
  return { label: t("(no arguments)"), icon: <Wrench className="w-3.5 h-3.5 shrink-0" /> };
}

function pretty(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/** The Artifact tool: favicon + description + published URL in the result. */
function ArtifactFace({ message }: { message: Message }) {
  const input = (message.toolUse?.input ?? {}) as Record<string, any>;
  const resultText = message.toolResult?.content ?? '';
  const urlMatch = resultText.match(/https?:\/\/\S+/);
  return (
    <div className="flex items-start gap-3 px-3 py-2.5">
      <span className="text-xl leading-none mt-0.5">{input.favicon || '📄'}</span>
      <div className="min-w-0 flex-1">
        <div className="text-sm text-[var(--text-primary)] truncate">
          {input.description || 'Artifact'}
        </div>
        {input.file_path && (
          <div className="text-xs text-[var(--text-secondary)] font-mono truncate mt-0.5">{input.file_path}</div>
        )}
        {urlMatch && (
          <a
            href={urlMatch[0]}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs text-[#DA7756] hover:text-[#C86545] mt-1"
          >
            <Globe className="w-3 h-3" />  {t("Launch")}
          </a>
        )}
      </div>
    </div>
  );
}

export const ToolCallCard: React.FC<{ message: Message }> = ({ message }) => {
  const [open, setOpen] = useState(false);
  const tool = message.toolUse!;
  const result = message.toolResult;
  const running = !result;
  const errored = result?.isError === true;
  const { label, icon } = summarizeInput(tool.input);
  const isArtifact = tool.toolName === 'Artifact';

  return (
    <div className="w-full max-w-3xl mx-auto py-1 px-3 sm:px-6 group">
      <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-card-hover)] overflow-hidden">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left hover:bg-[var(--bg-card-hover)] transition-colors"
        >
          <span className="text-[var(--text-secondary)] shrink-0">
            {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          </span>
          <span className="shrink-0 text-[#DA7756]">{icon}</span>
          <span className="text-xs font-mono text-[var(--text-primary)] shrink-0">{tool.toolName}</span>
          <span className="text-xs text-[var(--text-secondary)] truncate flex-1">{label}</span>
          <span className="shrink-0">
            {running ? (
              <span className="inline-block w-2 h-2 rounded-full bg-[#DA7756] animate-pulse" title={t("Running")} />
            ) : errored ? (
              <AlertCircle className="w-3.5 h-3.5 text-red-400" />
            ) : (
              <Check className="w-3.5 h-3.5 text-[var(--text-secondary)]" />
            )}
          </span>
        </button>

        {isArtifact && !open && <ArtifactFace message={message} />}

        {open && (
          <div className="border-t border-[var(--border-color)] px-3 py-2.5 space-y-2">
            {isArtifact && <ArtifactFace message={message} />}
            <div>
              <div className="text-[10px] uppercase tracking-wide text-[var(--text-secondary)] mb-1">{t("Input")}</div>
              <pre className="text-xs font-mono text-[var(--text-primary)] whitespace-pre-wrap break-all max-h-48 overflow-auto bg-[var(--bg-primary)] rounded-lg p-2 border border-[var(--border-color)]">
                {pretty(tool.input)}
              </pre>
            </div>
            {result && (
              <div>
                <div className="text-[10px] uppercase tracking-wide text-[var(--text-secondary)] mb-1">
                  {errored ? t("Error") : t("Result")}
                </div>
                <pre
                  className={`text-xs font-mono whitespace-pre-wrap break-all max-h-64 overflow-auto bg-[var(--bg-primary)] rounded-lg p-2 border ${
                    errored ? 'border-red-900/60 text-red-300' : 'border-[var(--border-color)] text-[var(--text-secondary)]'
                  }`}
                >
                  {pretty(result.content ?? (errored ? t("(failed)") : t("(empty)")))}
                </pre>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
