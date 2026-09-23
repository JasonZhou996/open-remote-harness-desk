const XARNESS_CODEX_SECRET_KEY = /^(?:xarness_codex_control_token|xarness_codex_provider_)/i;

export function buildNonCodexProcessEnv(environment = process.env) {
  const next = { ...environment };
  for (const key of Object.keys(next)) {
    if (XARNESS_CODEX_SECRET_KEY.test(key)) delete next[key];
  }
  return next;
}
