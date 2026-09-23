// Follow the existing theme attributes; no separate preference or polling.
(() => {
  if (window !== window.top) return;
  const root = document.documentElement;
  const system = matchMedia('(prefers-color-scheme: dark)');
  const update = () => {
    const theme = root.dataset.theme || (root.classList.contains('dark') ? 'dark' : root.classList.contains('light') ? 'light' : 'system');
    const dark = theme === 'dark' || (theme === 'system' && system.matches);
    const style = getComputedStyle(root);
    const color = style.getPropertyValue('--app-main').trim() || style.getPropertyValue('--bg-primary').trim() || (dark ? '#181818' : '#ffffff');
    for (const [name, content] of [['theme-color', color], ['apple-mobile-web-app-status-bar-style', dark ? 'black' : 'default']]) {
      let meta = document.querySelector(`meta[name="${name}"]`);
      if (!meta) { meta = document.createElement('meta'); meta.name = name; document.head.append(meta); }
      meta.content = content;
    }
    root.style.colorScheme = dark ? 'dark' : 'light';
    window.CodexBrowser?.setTheme?.(dark, color);
  };
  new MutationObserver(update).observe(root, {attributes: true, attributeFilter: ['class', 'data-theme']});
  system.addEventListener('change', update);
  update();
})();
