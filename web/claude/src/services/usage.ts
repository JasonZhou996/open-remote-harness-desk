// Shared cached usage; only the explicit refresh button contacts the CLI.
import { backend } from './backend';

export interface UsageInfo {
  plan: string;
  usage?: any;
  error?: string;
}

let cache: UsageInfo | null = null;
let loading: Promise<UsageInfo | null> | null = null;
let refreshing: Promise<UsageInfo | null> | null = null;
let lastFetch = 0;
const listeners = new Set<(info: UsageInfo | null) => void>();

function notify() {
  for (const listener of listeners) listener(cache);
}

function fetchOnce(force = false): Promise<UsageInfo | null> {
  if (cache) return Promise.resolve(cache);
  if (loading) return loading;
  lastFetch = Date.now();
  loading = backend
    .claudeUsage()
    .then(data => {
      cache = data;
      notify();
      return data;
    })
    .catch(() => null)
    .finally(() => {
      loading = null;
    });
  return loading;
}

/** Manual /usage: one dedicated CLI process, exactly like typing /usage in the CLI. */
export function refreshUsage(): Promise<UsageInfo | null> {
  if (refreshing) return refreshing;
  refreshing = backend
    .claudeUsageRefresh()
    .then(data => {
      cache = data;
      notify();
      return data;
    })
    .catch(() => null)
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

export function subscribeUsage(listener: (info: UsageInfo | null) => void): () => void {
  listeners.add(listener);
  listener(cache);
  void fetchOnce();
  return () => {
    listeners.delete(listener);
  };
}
