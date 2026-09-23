// Shared by the Codex/ZCode shell and Claude sidebar; native popover handles light dismissal.
if (typeof window !== 'undefined' && !window.customElements.get('product-switcher')) {
  window.customElements.define('product-switcher', class extends window.HTMLElement {
    connectedCallback() {
      const root = this.shadowRoot || this.attachShadow({mode:'open'});
      const products = [['codex','Codex','/'],['zcode','ZCode','/zcode'],['claude','Claude','/claude']];
      const current = products.find(([id]) => id === this.getAttribute('product')) || products[0];
      root.innerHTML = `<style>
        :host{display:inline-block;max-width:100%;--text:var(--app-text,var(--text-primary,#202020));--muted:var(--app-text-tertiary,var(--text-muted,#888));--panel:var(--app-panel,var(--bg-card,#fff));--hover:var(--app-hover,var(--bg-card-hover,#f2f2f2));--border:var(--app-border-default,var(--border-color,#e5e5e5));font-family:"OpenAI Sans",-apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans SC",sans-serif;color:var(--text)}
        *{box-sizing:border-box}button{font:inherit;color:inherit;cursor:pointer;border:0;background:none}
        #trigger{display:flex;align-items:center;gap:8px;max-width:100%;height:36px;padding:0 9px;border-radius:10px;font-size:18px;font-weight:600;line-height:24px;transition:background .12s}
        #trigger:hover,#trigger[aria-expanded=true]{background:var(--hover)}
        #trigger svg{width:14px;height:14px;color:var(--muted);transition:transform .12s}
        #trigger[aria-expanded=true] svg{transform:rotate(180deg)}
        button:focus-visible{outline:2px solid var(--app-link,var(--accent-coral,#608de5));outline-offset:2px}
        #menu{position:fixed;inset:auto;margin:0;width:208px;max-width:calc(100vw - 16px);padding:6px;border:1px solid var(--border);border-radius:14px;background:var(--panel);color:var(--text);box-shadow:0 12px 36px #0002,0 2px 8px #0001;font:14px/20px "OpenAI Sans",-apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans SC",sans-serif}
        #menu:popover-open{display:grid;gap:2px}
        #menu button{display:flex;align-items:center;gap:12px;width:100%;min-height:40px;padding:9px 12px;border-radius:8px;text-align:left;outline-offset:-2px}
        #menu button:hover,#menu button:focus-visible{background:var(--hover)}
        #menu button[aria-checked=true]{background:var(--hover);font-weight:600}
        #menu svg{margin-left:auto;width:16px;height:16px;visibility:hidden}
        #menu button[aria-checked=true] svg{visibility:visible}
        @media(prefers-reduced-motion:reduce){#trigger,#trigger svg{transition:none}}
      </style>
      <button id="trigger" type="button" popovertarget="menu" aria-label="Switch app" aria-haspopup="menu" aria-controls="menu" aria-expanded="false"><span>${current[1]}</span><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="m4 6 4 4 4-4" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
      <div id="menu" popover role="menu" aria-label="Switch app">${products.map(([id,name])=>`<button type="button" role="menuitemradio" aria-checked="${id===current[0]}" data-product="${id}"><span>${name}</span><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="m3 8 3 3 7-7" stroke-linecap="round" stroke-linejoin="round"/></svg></button>`).join('')}</div>`;
      const trigger = root.getElementById('trigger'), menu = root.getElementById('menu');
      const rows = [...menu.querySelectorAll('button')];
      const localize = () => {
        const label = /^zh/i.test(document.documentElement.lang) ? '切换应用' : 'Switch app';
        trigger.setAttribute('aria-label', label);menu.setAttribute('aria-label', label);
      };
      this.localeObserver = new MutationObserver(localize);
      this.localeObserver.observe(document.documentElement, {attributes:true, attributeFilter:['lang']});
      localize();
      this.close = () => { if(menu.matches(':popover-open')) menu.hidePopover(); };
      menu.addEventListener('beforetoggle', event => {
        trigger.setAttribute('aria-expanded',String(event.newState==='open'));
        if(event.newState!=='open')return;
        const rect=trigger.getBoundingClientRect();
        menu.style.left=`${Math.max(8,Math.min(rect.left,innerWidth-216))}px`;
        menu.style.top=`${Math.max(8,Math.min(rect.bottom+6,innerHeight-144))}px`;
      });
      root.addEventListener('keydown', event => {
        if(event.key==='Escape'&&menu.matches(':popover-open')){event.preventDefault();event.stopPropagation();this.close();trigger.focus();return;}
        if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key))return;
        event.preventDefault();event.stopPropagation();
        if(!menu.matches(':popover-open'))menu.showPopover();
        const index=rows.indexOf(root.activeElement);
        rows[event.key==='Home'?0:event.key==='End'?rows.length-1:index<0?(event.key==='ArrowDown'?0:rows.length-1):(index+(event.key==='ArrowDown'?1:-1)+rows.length)%rows.length].focus();
      });
      rows.forEach((row,index) => row.onclick=() => {
        this.close();trigger.focus();
        if(products[index][0]===current[0])return;
        window.dispatchEvent(new Event('workspace-save'));
        localStorage.setItem('codex-webui-last-product',products[index][0]);
        location.assign(products[index][2]);
      });
      for(const event of ['resize','blur'])window.addEventListener(event,this.close);
    }
    disconnectedCallback() { this.localeObserver?.disconnect(); for(const event of ['resize','blur'])window.removeEventListener(event,this.close); }
  });
}
