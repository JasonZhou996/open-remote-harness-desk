/** Clipboard API on HTTPS; selection fallback for LAN HTTP and WebViews. */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* Fall back when the browser blocks the async API. */ }
  const active = document.activeElement as HTMLElement | null;
  const input = document.createElement('textarea');
  input.value = text;
  input.readOnly = true;
  input.style.cssText = 'position:fixed;left:0;top:0;opacity:0;pointer-events:none';
  document.body.appendChild(input);
  input.focus({preventScroll:true});
  input.select();
  try { return document.execCommand('copy'); }
  catch { return false; }
  finally { input.remove(); active?.focus({preventScroll:true}); }
}
