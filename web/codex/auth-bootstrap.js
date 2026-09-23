const revision=new URL(import.meta.url).searchParams.get('v')||'';
// Keep refreshing the login cookie, without blocking an already-authenticated page.
const authRequest=fetch('/api/auth/status',{cache:'no-store'}).then(response=>({response}),error=>({error}));
const [{codexInterfaceMark},{createDomI18n,createI18n},auth]=await Promise.all([
  import(`./codex-brand.js?v=${encodeURIComponent(revision)}`),
  import(`./i18n.js?v=${encodeURIComponent(revision)}`),
  document.documentElement.dataset.gatewayAuthenticated==='true' ? {status:{authenticated:true,assetVersion:revision}} : authRequest,
]);

const $=selector=>document.querySelector(selector);
const i18n=globalThis.__codexWebuiI18n||createI18n();
globalThis.__codexWebuiI18n=i18n;
globalThis.__codexWebuiDomI18n=globalThis.__codexWebuiDomI18n||createDomI18n(i18n);
const t=message=>i18n.t(message);

async function loadApp(assetVersion){
  if(location.pathname==='/'){
    const product=localStorage.getItem('codex-webui-last-product');
    if(product==='claude'||product==='zcode'){location.replace(product==='claude'?'/claude':'/zcode');return}
  }
  for(const href of ['/vendor/katex/katex.min.css','/vendor/xterm/xterm.css']){
    if(document.querySelector(`link[href="${href}"]`))continue;
    const link=document.createElement('link');link.rel='stylesheet';link.href=href;document.head.append(link);
  }
  await import(`/app.bundle.js?v=${encodeURIComponent(assetVersion || '')}`);
}

async function start(){
  let status;
  try{
    if(auth.error)throw auth.error;
    if(auth.status)status=auth.status;
    else{
      const response=auth.response;
      if(!response.ok)throw new Error(`Authentication status failed (${response.status})`);
      status=await response.json();
    }
  }catch(reason){console.error('[codex-webui] authentication status failed',reason);return}
  if(status.authenticated||(!status.setupRequired&&!status.passwordRequired)){await loadApp(status.assetVersion);return}
  const gate=$('#passwordGate'),app=$('#app'),input=$('#passwordInput'),confirmInput=$('#passwordConfirmInput'),form=$('#passwordLoginForm'),button=$('#passwordLoginButton'),error=$('#passwordError'),title=$('#passwordTitle');
  let mode=status.setupRequired?'setup':'login';
  $('#passwordCodexMark').innerHTML=codexInterfaceMark('password-codex-mark');
  const configure=()=>{
    const setup=mode==='setup';
    title.textContent=t(setup?'Set a LAN password':'Log in');
    gate.setAttribute('aria-label',t(setup?'Codex WebUI password setup':'Codex WebUI login'));
    input.placeholder=t(setup?'New password':'Password');
    input.autocomplete=setup?'new-password':'current-password';
    input.minLength=setup?12:0;
    input.maxLength=256;
    confirmInput.hidden=!setup;confirmInput.required=setup;confirmInput.value='';
    button.textContent=t(setup?'Set password':'Log in');
  };
  configure();gate.hidden=false;app.setAttribute('aria-hidden','true');app.inert=true;requestAnimationFrame(()=>input.focus());
  form.onsubmit=async event=>{
    event.preventDefault();error.hidden=true;
    if(mode==='setup'&&input.value.length<12){error.textContent=t('Password must be at least 12 characters');error.hidden=false;input.focus();return}
    if(mode==='setup'&&input.value!==confirmInput.value){error.textContent=t('Passwords do not match');error.hidden=false;confirmInput.select();return}
    const endpoint=mode==='setup'?'/api/auth/setup':'/api/auth/login';
    button.disabled=true;button.textContent=t(mode==='setup'?'Setting password…':'Logging in…');
    try{
      const response=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({password:input.value})});
      const data=await response.json().catch(()=>({}));
      if(!response.ok){
        if(mode==='setup'&&response.status===409){mode='login';input.value='';configure();throw new Error(t('A password was already set. Log in to continue.'));}
        throw new Error(data.error||t(mode==='setup'?'Unable to set the password':'Unable to log in'));
      }
      gate.hidden=true;app.removeAttribute('aria-hidden');app.inert=false;input.value='';confirmInput.value='';
      await loadApp(status.assetVersion);
    }catch(reason){error.textContent=reason instanceof Error?reason.message:String(reason);error.hidden=false;input.select()}
    finally{button.disabled=false;button.textContent=t(mode==='setup'?'Set password':'Log in')}
  };
}

start().catch(error=>console.error('[codex-webui] authentication bootstrap failed',error));
