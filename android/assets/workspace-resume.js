function restoreWorkspace(saved, instance) {
  if (!/^\/(?:$|settings(?:\/|$)|zcode\/?$|claude\/app\/?$|remote\/v4\/?$)/.test(location.pathname)) return;
  const allowed = key => /^codex-webui-zcode-view:[A-Za-z0-9_-]{1,200}$/.test(key) || /^(?:codex-webui-(?:last-product|active-thread|project|expanded-project|workspace-view|zcode-layout|zcode-panels)|claude-(?:workspace-view|workspace-scroll|artifact-layout))$/.test(key);
  const set = Storage.prototype.setItem, remove = Storage.prototype.removeItem;
  const post = (key, value) => { if (allowed(key)) CodexWorkspaceState.postMessage(JSON.stringify({key, value})); };
  try {
    // The same script also runs after navigation and inside the ZCode frame.
    // Hydrate once per WebView, so subsequent navigation keeps newer writes.
    if (sessionStorage.getItem('codex-native-resume-instance') !== instance) {
      for (const [key, value] of Object.entries(saved)) {
        if (allowed(key)) value === null ? remove.call(localStorage, key) : set.call(localStorage, key, value);
      }
      set.call(sessionStorage, 'codex-native-resume-instance', instance);
    }
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      post(key, localStorage.getItem(key));
    }
    Storage.prototype.setItem = function(key, value) {
      set.call(this, key, value);
      if (this === localStorage) post(String(key), String(value));
    };
    Storage.prototype.removeItem = function(key) {
      remove.call(this, key);
      if (this === localStorage) post(String(key), null);
    };
  } catch { /* Storage disabled: leave the normal page usable. */ }
}
