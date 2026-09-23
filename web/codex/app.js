import {englishUiError} from './i18n.js';
import {mergeTurnItem,mergeTurnItems} from '../shared/turn-items.js';
import {createRequestId, subscribeImports, renderImportPicker, renderImportProgress} from '../shared/session-import.ts';
import { DEFAULT_TURN_PAGE_SIZE, applyComposerSuggestion, createLatestRequestGate, createTurnWindow, filterAppModels, getComposerAutocomplete, resolveComposerPlaceholder, selectModelState } from './ui-core.js';
import { userMessageText, agentMessageText, renderAssistantMarkdown, renderItemImages, localDownloadUrl, localImageUrl } from './rendering.js';
import { codexIcon, hydrateCodexIcons } from './codex-icons.js';
import { codexInterfaceMark } from './codex-brand.js';
import './product-switcher.js';
import { createDomI18n, createI18n } from './i18n.js';
import { buildApprovalModel, createReviewPreferences, parseUnifiedDiff, permissionRows, reasoningSummaryText, shouldShowActivity, splitDiffHunk, summarizeActivity, unifiedDiffFromFileChanges } from './codex-surfaces.js';
import { browserFrameUrl, browserSandbox, normalizeBrowserUrl } from './browser-panel.js';
import { THREAD_NOT_FOUND, bridgeErrorCode, createBridgeError, threadInputErrorMessage } from './bridge-errors.js';
import { readCache, writeCache, clearCache, cacheableThread, mergeCachedHistory } from './conversation-cache.js';
import { asyncQuestions, createQuestionCard, parseQuestionReply, questionReply } from './user-input.js';
import lottie from 'lottie-web/build/player/lottie_light.js';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
globalThis.__renderAssistantMarkdown = renderAssistantMarkdown;
const $ = (s) => document.querySelector(s);
const i18n=globalThis.__codexWebuiI18n||createI18n();
globalThis.__codexWebuiI18n=i18n;
globalThis.__codexWebuiDomI18n=globalThis.__codexWebuiDomI18n||createDomI18n(i18n);
const t=message=>i18n.t(message);
const state = { ws:null, events:null, transport:'connecting', wsFallbackTimer:null, rpcId:1, pending:new Map(), threads:[], active:null, models:[], selectedModel:'', workspaceContext:null, projectless:false, composerMode:'local', planMode:false, permissionMode:localStorage.getItem('codex-webui-permission-mode')||'default', permissionProfiles:[], permissionVisibility:{autoReview:true,fullAccess:localStorage.getItem('codex-webui-permission-full-access')!=='false'}, goalMode:false, backgroundAgentsVisible:false, cloudStartingState:null, placeholderText:null, composerMentions:[], turnWindow:null, tokenUsage:new Map(), items:new Map(), itemSignatures:new Map(), turns:new Map(), activities:new Map(), activityItems:new Map(), sideTasks:new Map(), dividers:new Map(), changes:new Map(), requestCards:new Map(), motion:new Map(), turnDiffs:new Map(), activeReview:null, account:null, connected:false, config:{home:'',defaultCwd:''} };
const WORKSPACE_VIEW_KEY='codex-webui-workspace-view';
let savedWorkspaceView=null,pendingWorkspaceView=null,workspaceViewReady=false;
try{savedWorkspaceView=JSON.parse(localStorage.getItem(WORKSPACE_VIEW_KEY)||'null');pendingWorkspaceView=savedWorkspaceView;}catch{}
const composerDrafts=new Map(Object.entries(savedWorkspaceView?.drafts||{}));
if(!savedWorkspaceView?.drafts&&typeof savedWorkspaceView?.draft==='string')composerDrafts.set(savedWorkspaceView.threadId||'new',{text:savedWorkspaceView.draft,mentions:[]});
let composerDraftKey=null,composerDraftGeneration=0;
function saveComposerDraft(){
  if(composerDraftKey===null)return;
  const draft={text:$('#prompt').value,mentions:state.composerMentions};
  if(draft.text||draft.mentions.length)composerDrafts.set(composerDraftKey,draft);else composerDrafts.delete(composerDraftKey);
  return draft;
}
function switchComposerDraft(threadId,reset=false){
  const key=threadId||'new';if(key===composerDraftKey&&!reset)return;
  saveComposerDraft();composerDraftKey=key;composerDraftGeneration++;
  if(reset)composerDrafts.delete(key);
  const draft=composerDrafts.get(key);
  $('#prompt').value=draft?.text||'';state.composerMentions=draft?.mentions||[];
  renderContextTray();resizePrompt();
}
function restoreFailedDraft(key,text,mentions){
  if(key===composerDraftKey)saveComposerDraft();
  const draft=composerDrafts.get(key)||{text:'',mentions:[]};
  if(draft.text!==text)draft.text=[text,draft.text].filter(Boolean).join('\n\n');
  draft.mentions=[...new Map([...mentions,...draft.mentions].map(mention=>[mention.id,mention])).values()];
  composerDrafts.set(key,draft);
  if(key===composerDraftKey){$('#prompt').value=draft.text;state.composerMentions=draft.mentions;renderContextTray();resizePrompt()}
  saveWorkspaceView();
}
let importJobs=[], disposeImportPicker=()=>{};
let folderBrowse={path:'~',parent:null,selected:null};
const reviewPreferences=createReviewPreferences(JSON.parse(localStorage.getItem('codex-webui-review-preferences')||'{}'));
let reviewPatchState='undo';
let sidePanelReturnFocus=null,summaryPanelReturnFocus=null,imageViewerReturnFocus=null;
let bottomPanelLastView=null;
let sidebarLayoutMobile=null;
let pendingFullAccessAction='select';
let settingsMobileLayout=matchMedia('(max-width:480px)').matches;
const createTerminalState=(hostId,panelId)=>({hostId,panelId,term:null,fit:null,ws:null,resizeObserver:null,reconnectTimer:null});
const terminalStates={bottom:createTerminalState('terminalHost','bottomPanel'),side:createTerminalState('sideTerminalHost','sidePanel')};
const systemTheme=matchMedia('(prefers-color-scheme:dark)');
function themePreference(){const value=localStorage.getItem(THEME_STORAGE_KEY);return value==='light'||value==='dark'?value:'system'}
function isDarkTheme(){const preference=themePreference();return preference==='dark'||(preference==='system'&&systemTheme.matches)}
function terminalTheme(){return isDarkTheme()?{background:'#181818',foreground:'#f2f2f2',cursor:'#f2f2f2',selectionBackground:'#3b4a5a'}:{background:'#ffffff',foreground:'#0d0d0d',cursor:'#0d0d0d',selectionBackground:'#c8dcf4'}}
function applyTheme(value,{persist=true}={}){
  const preference=value==='light'||value==='dark'?value:'system';
  if(persist){if(preference==='system')localStorage.removeItem(THEME_STORAGE_KEY);else localStorage.setItem(THEME_STORAGE_KEY,preference)}
  if(preference==='system')delete document.documentElement.dataset.theme;else document.documentElement.dataset.theme=preference;
  const select=$('#themeSelect');if(select)select.value=preference;
  for(const terminalState of Object.values(terminalStates))if(terminalState.term)terminalState.term.options.theme=terminalTheme();
  const zcodeShell=$('#zcodeShell'),zcodeFrame=$('#zcodeFrame');if(zcodeFrame&&zcodeShell&&!zcodeShell.hidden)zcodeFrame.src=`/zcode/client?theme=${isDarkTheme()?'dark':'light'}`;
}
const browserState={history:[],index:-1,loadTimer:null,loadRequest:0};
const accountRequestGate=createLatestRequestGate();
const workspaceContextRequestGate=createLatestRequestGate();
const permissionProfileRequestGate=createLatestRequestGate();
const autocompleteState={match:null,items:[],selected:0,requestId:0,message:''};
const ACTIVE_THREAD_STORAGE_KEY='codex-webui-active-thread';
const THEME_STORAGE_KEY='codex-webui-theme';
const ACTIVE_THREAD_SYNC_ACTIVE_MS=800,ACTIVE_THREAD_SYNC_IDLE_MS=2400;
let activeThreadSyncTimer=null,activeThreadSyncGeneration=0,activeThreadSyncInFlight=false,activeThreadSyncSignature='',activeThreadSyncRevision='',threadListInFlight=false,threadListRefreshQueued=false,threadListSignature='';

const icons = {
  chevron:codexIcon('chevronRight','activity-chevron'),
  terminal:codexIcon('terminal'),
  file:codexIcon('file'),
  search:codexIcon('search'),
  tool:codexIcon('wrench'),
  check:codexIcon('check'),
};
hydrateCodexIcons();
$('#windowCodexMark').innerHTML=codexInterfaceMark('window-codex-mark');
$('#emptyCodexMark').innerHTML=codexInterfaceMark('empty-codex-mark');

const WS_CONNECT_TIMEOUT_MS=5000,BRIDGE_REQUEST_TIMEOUT_MS=35000;
let bridgeWatchdog,activeThreadEventRevision=0,settingsEventRevision=0,queueEventRevision=0,historySyncNeeded=false;
function watchBridge(){clearTimeout(bridgeWatchdog);bridgeWatchdog=setTimeout(()=>{if(state.transport==='ws')fallbackToSse(state.ws);else{state.events?.close();state.events=null;connectSse()}},45000)}
function transportSwitchError(){const error=new Error('Bridge transport changed');error.silentTransportSwitch=true;error.retryable=true;return error}
function clearWsFallbackTimer(){clearTimeout(state.wsFallbackTimer);state.wsFallbackTimer=null}
function rejectWebSocketPending(){for(const pending of state.pending.values())pending.reject(transportSwitchError());state.pending.clear()}
async function postBridge(path,payload){
  try{const response=await fetch(path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload),cache:'no-store',signal:AbortSignal.timeout(BRIDGE_REQUEST_TIMEOUT_MS)}),data=await response.json();if(!response.ok){const error=createBridgeError(englishUiError(data.error)||'Codex bridge request failed',data.code);error.retryable=response.status>=500;throw error}return data}
  catch(error){if(typeof error.code!=='string'||error.retryable)throw Object.assign(new Error("Connection interrupted or request timed out. Resyncing.",{cause:error}),{retryable:true});throw error}
}
function connectSse(){
  if(state.events)return;
  state.transport='sse';state.connected=false;watchBridge();setStatus('connecting','Connecting to Codex');
  const events=new EventSource('/api/events');state.events=events;
  events.onmessage=event=>{try{handle(JSON.parse(event.data))}catch{}};
  events.onerror=()=>{if(state.events!==events)return;state.connected=false;historySyncNeeded=true;resetActiveThreadSync();setStatus('connecting','Connecting to Codex')};
}
function fallbackToSse(ws){
  if(state.transport==='sse'||(ws&&state.ws!==ws))return;
  clearWsFallbackTimer();rejectWebSocketPending();state.connected=false;historySyncNeeded=true;resetActiveThreadSync();
  if(ws){ws.onopen=ws.onmessage=ws.onerror=ws.onclose=null;try{ws.close()}catch{}}
  state.ws=null;connectSse();
}
function connect(){
  if(state.transport==='sse'||state.ws)return;
  if(globalThis.CodexBrowser){connectSse();return}
  const proto=location.protocol==='https:'?'wss:':'ws:';
  let ws;
  try{ws=new WebSocket(`${proto}//${location.host}/ws`)}catch{fallbackToSse();return}
  state.transport='ws';state.ws=ws;
  const fallback=()=>fallbackToSse(ws);
  state.wsFallbackTimer=setTimeout(fallback,WS_CONNECT_TIMEOUT_MS);
  ws.onopen=()=>{if(state.ws===ws)setStatus('connecting','Connecting to Codex')};
  ws.onmessage=(event)=>{if(state.ws!==ws)return;try{const message=JSON.parse(event.data);clearWsFallbackTimer();handle(message)}catch{fallback()}};
  ws.onerror=fallback;ws.onclose=fallback;
}
function rpc(method,params={},operation){
  const id=state.rpcId++;
  if(state.transport==='sse')return postBridge('/api/rpc',{id,method,params,operation}).then(message=>{if(message.type!=='rpc/result')throw createBridgeError(englishUiError(message.error)||'Codex bridge request failed',message.code);return message.result});
  if(state.ws?.readyState===WebSocket.OPEN){
    const ws=state.ws;
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{const error=new Error("Request timed out. Resyncing.");error.retryable=true;state.pending.delete(id);reject(error);fallbackToSse(ws)},BRIDGE_REQUEST_TIMEOUT_MS);
      state.pending.set(id,{resolve:result=>{clearTimeout(timer);resolve(result)},reject:error=>{clearTimeout(timer);reject(error)}});
      try{ws.send(JSON.stringify({type:'rpc',id,method,params,operation}))}catch{fallbackToSse(ws)}
    });
  }
  return Promise.reject(transportSwitchError());
}
function respondToCodex(requestId,result,error){
  if(state.transport==='sse')return postBridge('/api/codex/respond',{requestId,result,error});
  if(state.ws?.readyState===WebSocket.OPEN){try{state.ws.send(JSON.stringify(error?{type:'codex/error',requestId,error}:{type:'codex/response',requestId,result}));return Promise.resolve()}catch{fallbackToSse(state.ws);return Promise.reject(transportSwitchError())}}
  return Promise.reject(transportSwitchError());
}
function handle(message){
  watchBridge();
  if(Number.isFinite(message.issuedAt))state.bridgeIssuedAt=message.issuedAt;
  if(message.type==='bridge/status'){
    state.bridgeInstanceId=message.instanceId;
    if(message.status==='connected'){const shouldLoad=!state.connected;state.connected=true;setStatus('connected','Codex connected');if(shouldLoad)loadInitial()}
    else{state.connected=false;setStatus('connecting','Connecting to Codex')}
    return;
  }
  if(message.type==='rpc/result'||message.type==='rpc/error'){
    const p=state.pending.get(message.id);if(!p)return;state.pending.delete(message.id);
    message.type==='rpc/result'?p.resolve(message.result):p.reject(createBridgeError(englishUiError(message.error),message.code));return;
  }
  if(message.type==='host/thread-list-invalidated'){refreshThreadsSoon();return}
  if(message.type==='codex/notification') onNotification(message.payload.method,message.payload.params||{});
  if(message.type==='codex/request') onServerRequest(message.payload);
}
function setStatus(kind,text){
  $('#statusDot').className='status-dot'+(kind==='connected'?' connected':kind==='error'?' error':'');
  $('#statusText').textContent=t(text||kind);
}
async function loadInitial(refreshAccount=false){
  loadAccount(refreshAccount);
  const rememberedThread=new URLSearchParams(location.search).get('thread')||localStorage.getItem(ACTIVE_THREAD_STORAGE_KEY);
  if(state.active){historySyncNeeded=true;scheduleActiveThreadSync(0)}else if(rememberedThread)void openThread(rememberedThread);
  const report=e=>{if(!e?.silentTransportSwitch)toast(e.message)};
  await Promise.allSettled([
    refreshThreadList(),
    rpc('model/list',{limit:50}).then(result=>{state.models=filterAppModels(result.data||[]);renderModels()}).catch(report),
    rpc('permissionProfile/list',{cwd:permissionProfileCwd(),limit:100}).then(result=>setPermissionProfiles(result.data||[])).catch(()=>setPermissionProfiles([]))
  ]);
}
async function loadAccount(refresh=false){
  const requestId=accountRequestGate.next();
  try{const response=await fetch(`/api/account${refresh?'?refresh=1':''}`,{cache:'no-store'}),account=await response.json();if(!response.ok)throw new Error(account.error||'Cannot load account');if(!accountRequestGate.isCurrent(requestId))return;state.account=account;renderAccount(account);void loadAccountUsage()}catch{if(accountRequestGate.isCurrent(requestId))renderAccount({displayName:null,avatarUrl:null,planType:null,initials:'?'})}
}
function renderAccount(account){
  state.account=account;
  const displayName=account?.displayName?.trim()||t('Settings'),initials=account?.initials?.trim()||'?',type=account?.type||'unknown',plan=account?.planType?`${account.planType.charAt(0).toUpperCase()}${account.planType.slice(1)} plan`:type==='apiKey'?t('API key mode'):type==='amazonBedrock'?'Amazon Bedrock':'';
  const profileMenuAvailable=type==='chatgpt';
  $('#accountName').textContent=displayName;$('#accountMenuName').textContent=displayName;$('#settingsAccountName').textContent=displayName;$('#accountFooterMeta').textContent='';$('#accountMenuSubtitle').textContent=plan;$('#settingsAccountMeta').textContent=plan||t('Codex account');
  $('#accountButton').setAttribute('aria-label',profileMenuAvailable?'Open profile menu':'Open settings');
  const avatarUrl=profileMenuAvailable&&typeof account?.avatarUrl==='string'&&account.avatarUrl.startsWith('/api/account/avatar')?account.avatarUrl:'',profileAvatars=[$('#accountMenuAvatar'),$('#settingsAccountAvatar')],footerAvatar=$('#accountAvatar'),profileAvatarClass=avatar=>`account-avatar${avatar.id==='accountMenuAvatar'?' account-menu-avatar':''}`;for(const avatar of profileAvatars){avatar.dataset.imageUrl=avatarUrl;avatar.className=`${profileAvatarClass(avatar)} account-initials`;avatar.textContent=initials}
  if(profileMenuAvailable){footerAvatar.dataset.imageUrl=avatarUrl;footerAvatar.className='account-avatar account-initials';footerAvatar.textContent=initials;profileAvatars.unshift(footerAvatar)}else{footerAvatar.dataset.imageUrl='';footerAvatar.className='account-avatar account-settings-icon';footerAvatar.innerHTML=codexIcon('wrench')}
  if(avatarUrl){const image=new Image;image.alt='';image.src=`${avatarUrl}?v=${Date.now()}`;image.onload=()=>{for(const avatar of profileAvatars){if(avatar.dataset.imageUrl!==avatarUrl)continue;avatar.className=profileAvatarClass(avatar);avatar.replaceChildren(image.cloneNode())}};image.onerror=()=>{for(const avatar of profileAvatars){if(avatar.dataset.imageUrl!==avatarUrl)continue;avatar.className=`${profileAvatarClass(avatar)} account-initials`;avatar.textContent=initials}}}
  if(!profileMenuAvailable)toggleAccountMenu(false);
  const apiMode=!profileMenuAvailable;$('#accountProfile').hidden=apiMode;$('#accountUsage').hidden=apiMode;$('#accountLogout').hidden=apiMode;
  const accountSettingsPage=$('[data-settings-page="profile"]');if(accountSettingsPage){accountSettingsPage.dataset.settingsAvailable=String(!apiMode);if(apiMode&&accountSettingsPage.classList.contains('active'))setSettingsPage('general-settings');filterSettingsNavigation($('#settingsSearch')?.value||'')}
  syncPermissionSettings();syncPermissionControl();
}
let accountUsagePending=null;
function loadAccountUsage(){
  if(accountUsagePending)return accountUsagePending;
  accountUsagePending=refreshAccountUsage().finally(()=>{accountUsagePending=null});
  return accountUsagePending;
}
async function refreshAccountUsage(){
  const summary=$('#accountUsageRemaining'),details=$('#accountUsageDetails');
  try{
    const response=await fetch('/api/account/usage',{cache:'no-store'});if(!response.ok){const body=await response.json();throw new Error(body.error||`Usage API HTTP ${response.status}`)}
    const data=await response.json(),buckets=data.rateLimitsByLimitId?Object.entries(data.rateLimitsByLimitId):[['codex',data.rateLimits]];
    details.replaceChildren();let weekly=null;
    for(const [id,bucket] of buckets){if(!bucket)continue;for(const window of [bucket.primary,bucket.secondary]){
      if(!window||!Number.isFinite(window.usedPercent))continue;
      const remaining=Math.max(0,Math.min(100,100-window.usedPercent)),minutes=window.windowDurationMins;
      const label=minutes===10080?"Weekly quota":minutes===300?"5-hour quota":minutes?`${minutes/60}-hour quota`:"Quota";
      const row=document.createElement('div');row.className='account-usage-row';
      row.textContent=`${buckets.length>1?(bucket.limitName||id)+' · ':''}${label}: ${Math.round(remaining)}% remaining`;
      if(window.resetsAt){const reset=document.createElement('small');reset.textContent=`Resets ${new Date(window.resetsAt*1000).toLocaleString(i18n.locale)}`;row.append(reset)}
      details.append(row);if(minutes===10080&&(weekly===null||id==='codex'))weekly=remaining;
    }}
    summary.textContent=weekly===null?"View usage":`${Math.round(weekly)}% weekly quota remaining`;
    if(!details.children.length)details.textContent="No usage data yet";if(data.stale){const note=document.createElement('small');note.textContent=`Last updated: ${new Date(data.fetchedAt).toLocaleTimeString(i18n.locale)}`;details.append(note)}summary.dataset.loaded='true';
  }catch(error){console.error('Account usage:',error);if(!summary.dataset.loaded){summary.textContent="Click to retry";details.textContent=error.message;}}
}
function toggleAccountMenu(force){const menu=$('#accountMenu'),open=force??menu.hidden;menu.hidden=!open;$('#accountButton').setAttribute('aria-expanded',String(open));if(open)void loadAccountUsage()}
const settingsPageAliases={general:'general-settings',account:'profile',keyboard:'keyboard-shortcuts'};
const settingsPages={
  'general-settings':{title:'General'},appearance:{title:'Appearance'},agent:{title:'Configuration'},profile:{title:'Profile'},'keyboard-shortcuts':{title:'Keyboard shortcuts'},
  'plugins-settings':{title:'Plugins',rows:[['Installed plugins','None'],['Plugin sources','Not configured']]},'skills-settings':{title:'Skills',rows:[['Installed skills','Not configured']]},'browser-use':{title:'Browser',rows:[['Browser access','Not configured'],['Network access','Inherited from permissions']]},'computer-use':{title:'Computer use',rows:[['Computer use','Not configured']]},
  connections:{title:'Connections',rows:[['Connected services','None']]},'cloud-settings':{title:'Cloud preferences',rows:[['Diff view','Unified'],['Branch format','Default']]},'cloud-environments':{title:'Cloud environments',rows:[['Environments','None']]},'code-review':{title:'Code review',rows:[['Review instructions','Not configured']]},'git-settings':{title:'Git',rows:[['Git integration','System default']]},'hooks-settings':{title:'Hooks',rows:[['Configured hooks','None']]},worktrees:{title:'Worktrees',rows:[['Worktree behavior','Default']]},'data-controls':{title:'Archived chats',rows:[['Archived chats','None']]},
};
function normalizeSettingsPage(page='general-settings'){const candidate=settingsPageAliases[page]||page;return settingsPages[candidate]?candidate:'general-settings'}
function settingsRoutePage(pathname=location.pathname){const match=pathname.match(/^\/settings(?:\/([^/]+))?\/?$/);return match?normalizeSettingsPage(match[1]||'general-settings'):null}
function settingsPlaceholderRows(page){if(page==='agent')return[['Model',modelDisplay(selectedModel())],['Reasoning effort',reasoningLabel($('#effortSelect').value)],['Approval',selectedPermission().label],['Web search','Automatic']];return settingsPages[page]?.rows||[]}
function renderSettingsPlaceholder(page){const definition=settingsPages[page],title=$('#settingsPlaceholderTitle'),description=$('#settingsPlaceholderDescription'),rows=$('#settingsPlaceholderRows');title.textContent=t(definition.title);description.hidden=true;description.textContent='';rows.replaceChildren();for(const [label,value] of settingsPlaceholderRows(page)){const row=document.createElement('div');row.className='settings-row settings-readonly-row';const copy=document.createElement('span'),strong=document.createElement('strong'),status=document.createElement('span');strong.textContent=t(label);copy.append(strong);status.textContent=t(value);row.append(copy,status);rows.append(row)}}
function setSettingsPage(page='general-settings',{updateRoute=true}={}){const selected=normalizeSettingsPage(page),contentPage=['general-settings','appearance','profile','keyboard-shortcuts'].includes(selected)?selected:'placeholder';for(const button of document.querySelectorAll('[data-settings-page]'))button.classList.toggle('active',button.dataset.settingsPage===selected);for(const content of document.querySelectorAll('[data-settings-content]'))content.hidden=content.dataset.settingsContent!==contentPage;if(contentPage==='placeholder')renderSettingsPlaceholder(selected);$('#settingsPageTitle').textContent=t(settingsPages[selected].title);$('#settingsContent')?.scrollTo({top:0});if(matchMedia('(max-width:480px)').matches){const dialog=$('#settingsDialog');dialog.dataset.mobilePage='true';if(dialog.open)document.querySelector('.settings-page:not([hidden]) .settings-mobile-back')?.focus()}if(updateRoute&&settingsRoutePage())history.replaceState({...history.state,codexWebuiSettings:true},'',`/settings/${selected}`)}
function filterSettingsNavigation(query=''){const normalized=query.trim().toLocaleLowerCase(),clear=$('#clearSettingsSearch');let visible=0;if(clear)clear.hidden=!normalized;for(const group of document.querySelectorAll('[data-settings-group]')){let groupVisible=0;for(const button of group.querySelectorAll('[data-settings-page]')){const available=button.dataset.settingsAvailable!=='false',matches=!normalized||button.textContent.toLocaleLowerCase().includes(normalized);button.hidden=!available||!matches;if(!button.hidden){groupVisible++;visible++}}group.hidden=groupVisible===0}$('#settingsNavEmpty').hidden=visible!==0}
function clearSettingsSearch(){const input=$('#settingsSearch');input.value='';filterSettingsNavigation();input.focus()}
function showSettingsMobileNavigation(){const dialog=$('#settingsDialog');dialog.dataset.mobilePage='false';requestAnimationFrame(()=>$('#settingsSearch').focus())}
function syncSettingsResponsiveLayout(){const mobile=matchMedia('(max-width:480px)').matches;if(mobile===settingsMobileLayout)return;settingsMobileLayout=mobile;const dialog=$('#settingsDialog');if(dialog.open)dialog.dataset.mobilePage=String(mobile)}
function hideSettings(){const dialog=$('#settingsDialog');if(dialog.open)dialog.close();document.body.classList.remove('settings-open')}
function closeSettings(){if(settingsRoutePage()){if(typeof history.state?.codexSettingsReturnPath==='string'){history.back();return}history.replaceState({},'','/');hideSettings();return}hideSettings()}
$('#closeSettingsNav').onclick=closeSettings;$('#settingsMobileBack').onclick=showSettingsMobileNavigation;for(const button of document.querySelectorAll('.settings-page .settings-mobile-back'))button.onclick=showSettingsMobileNavigation;$('#settingsSearch').oninput=event=>filterSettingsNavigation(event.currentTarget.value);$('#clearSettingsSearch').onclick=clearSettingsSearch;$('#settingsSearch').onkeydown=event=>{if(event.key==='Escape'&&event.currentTarget.value){event.preventDefault();clearSettingsSearch()}};addEventListener('resize',syncSettingsResponsiveLayout);addEventListener('popstate',()=>{const page=settingsRoutePage();if(page){showSettings(page,{updateRoute:false});return}hideSettings()});
function showSettings(page='general-settings',{updateRoute=true}={}){if(mobileSidebarEnabled())setSidebarOpen(false);toggleAccountMenu(false);syncPermissionSettings();$('#settingsPermissionValue').textContent=t(selectedPermission().label);$('#settingsProjectValue').textContent=state.projectless?t('No project'):shortPath(state.active?.cwd||$('#projectPath').textContent);$('#settingsSearch').value='';filterSettingsNavigation();setSettingsPage(page,{updateRoute});const dialog=$('#settingsDialog'),mobile=matchMedia('(max-width:480px)').matches;settingsMobileLayout=mobile;dialog.dataset.mobilePage=String(mobile);if(!dialog.open)dialog.show();document.body.classList.add('settings-open');requestAnimationFrame(()=>{const target=mobile?document.querySelector('.settings-page:not([hidden]) .settings-mobile-back'):document.querySelector('.settings-nav-back');target?.focus()})}
function openSettings(page='general-settings'){const selected=normalizeSettingsPage(page),current=settingsRoutePage();if(!current){history.pushState({codexWebuiSettings:true,codexSettingsReturnPath:location.pathname+location.search+location.hash},'',`/settings/${selected}`)}else if(current!==selected){history.replaceState({...history.state,codexWebuiSettings:true},'',`/settings/${selected}`)}showSettings(selected,{updateRoute:false})}
const reasoningLabels={none:'None',minimal:'Minimal',low:'Low',medium:'Medium',high:'High',xhigh:'Extra High',max:'Max',ultra:'Ultra'};
function reasoningLabel(value){return t(reasoningLabels[value]||String(value||'Medium'))}
function modelDisplay(model,stripPrefix=false){const value=String(model?.displayName||model?.model||state.selectedModel||'Select model').trim();if(!stripPrefix)return value;return value.replace(/^GPT-/i,'').trim()||value}
function selectedModel(){return state.models.find(x=>x.model===state.selectedModel)}
function renderModels(){
  if(state.active?.desktopSettings){applyDesktopSettings(state.active,state.active.id);return;}
  const saved=localStorage.getItem('codex-webui-model'),selection=selectModelState(state.models,saved);state.selectedModel=selection.model;
  updateEfforts(selection.effort);syncModelLabel();renderModelMenuMain();
}
function chooseModel(model,keepOpen=false){const previous=$('#effortSelect').value;state.selectedModel=model;localStorage.setItem('codex-webui-model',model);updateEfforts(previous);syncModelLabel();if(keepOpen)renderModelMenuMain();else closeModelMenu();toast(`Model: ${modelDisplay(selectedModel())}`);void sendDesktopSettings({model,effort:$('#effortSelect').value||null})}
function syncModelLabel(){const model=selectedModel();$('#modelLabel').textContent=modelDisplay(model);$('#effortLabel').textContent=reasoningLabel($('#effortSelect').value)}
function updateEfforts(preferred){
  const model=selectedModel(),effort=$('#effortSelect');effort.innerHTML='';
  const supported=model?.supportedReasoningEfforts||[{reasoningEffort:'medium'}],values=supported.map(item=>item.reasoningEffort).filter(Boolean),saved=localStorage.getItem(`codex-webui-effort:${state.selectedModel}`),selected=[preferred,saved,model?.defaultReasoningEffort,values[0],'medium'].find(value=>values.includes(value))||'medium';
  for(const value of values.length?values:['medium']){const option=document.createElement('option');option.value=value;option.textContent=value;option.selected=value===selected;effort.append(option)}
  $('#effortLabel').textContent=reasoningLabel(effort.value);
}
function contextUsageValue(tokenUsage){const contextWindow=Number(tokenUsage?.modelContextWindow),totalTokens=Number(tokenUsage?.last?.totalTokens);if(!Number.isFinite(contextWindow)||contextWindow<=0||!Number.isFinite(totalTokens)||totalTokens<0)return null;const usedTokens=Math.min(totalTokens,contextWindow),percent=usedTokens/contextWindow*100;return Number.isFinite(percent)?{percent,usedTokens,contextWindow,remainingTokens:Math.max(contextWindow-usedTokens,0)}:null}
function renderContextUsage(){const indicator=$('#contextUsage'),usage=state.active?.id?contextUsageValue(state.tokenUsage.get(state.active.id)):null;if(!indicator)return;if(!usage){indicator.hidden=true;indicator.removeAttribute('data-tooltip');return}const percent=Math.max(0,Math.min(usage.percent,100)),rounded=Math.round(percent),remaining=Math.max(0,100-rounded),usedThousands=Math.round(usage.usedTokens/1000),windowThousands=Math.round(usage.contextWindow/1000),status=rounded>=50?`${rounded}% full`:`${rounded}% used (${remaining}% left)`;indicator.hidden=false;indicator.style.setProperty('--context-percent',String(percent));indicator.setAttribute('aria-label',`Context usage: ${rounded}%`);indicator.dataset.tooltip=`Context window:\n${status}\n${usedThousands}k / ${windowThousands}k tokens used`}
function menuTitle(text,back=false){return `<div class="model-menu-title-row">${back?`<button type="button" class="model-menu-back" id="modelMenuBack" aria-label="Back">${codexIcon('chevronLeft')}</button>`:''}<div class="model-menu-title">${escapeHtml(text)}</div></div>`}
function renderModelMenuMain(){
  const menu=$('#modelMenu'),model=selectedModel(),effort=$('#effortSelect'),options=[...effort.options],index=Math.max(0,options.findIndex(option=>option.selected));
  menu.innerHTML=`<div class="effort-card"><div class="effort-card-head"><span class="effort-bolt" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round"><path d="M13.5 2.5 4.5 13h6l-1 8.5L19.5 10h-6l1-7.5Z"/></svg></span><button type="button" id="modelSubmenuButton" class="effort-heading"><strong id="effortHeading"></strong><span>${escapeHtml(modelDisplay(model))}</span></button><button type="button" id="resetEffort" aria-label="Reset thinking effort">${codexIcon('undo')}</button></div><div class="effort-track"><input id="effortRange" type="range" min="0" max="${Math.max(0,options.length-1)}" step="1" value="${index}" aria-label="Reasoning" ${options.length<2?'disabled':''}><div class="effort-stops" aria-hidden="true">${options.map(()=>'<i></i>').join('')}</div></div></div>`;
  const slider=$('#effortRange'),paint=()=>{const option=options[Number(slider.value)],value=option?.value||'';$('#effortHeading').textContent=(value?reasoningLabel(value):"Default")+' ›';slider.setAttribute('aria-valuetext',value?reasoningLabel(value):"Default");menu.dataset.effort=value;menu.style.setProperty('--effort-fill',(options.length>1?Number(slider.value)/(options.length-1)*100:0)+'%')};
  paint();slider.oninput=paint;slider.onchange=()=>chooseEffort(options[Number(slider.value)].value,true);
  $('#modelSubmenuButton').onclick=renderModelSubmenu;
  $('#resetEffort').onclick=()=>chooseEffort(model?.defaultReasoningEffort||options[0]?.value,true);
}
function renderModelSubmenu(){const menu=$('#modelMenu');menu.innerHTML=`<div class="model-menu-view model-menu-view-models">${menuTitle("Select model",true)}<div class="model-menu-list model-list"></div></div>`;menu.querySelector('#modelMenuBack').onclick=renderModelMenuMain;const list=menu.querySelector('.model-list');for(const model of state.models){const button=document.createElement('button');button.type='button';button.className='model-option';button.role='menuitemradio';button.dataset.model=model.model;button.setAttribute('aria-checked',String(model.model===state.selectedModel));button.innerHTML=`<span class="model-option-copy"><strong>${escapeHtml(modelDisplay(model))}</strong>${model.description?`<small>${escapeHtml(model.description)}</small>`:''}</span><span class="model-check">${model.model===state.selectedModel?codexIcon('check'):''}</span>`;button.onclick=()=>chooseModel(model.model);list.append(button)}}
function chooseEffort(value,keepOpen=false){const effort=$('#effortSelect');if(![...effort.options].some(option=>option.value===value))return;effort.value=value;$('#effortLabel').textContent=reasoningLabel(value);localStorage.setItem(`codex-webui-effort:${state.selectedModel}`,value);if(keepOpen)renderModelMenuMain();else closeModelMenu();toast(`Reasoning: ${reasoningLabel(value)}`);void sendDesktopSettings({model:state.selectedModel,effort:value||null})}
function openModelMenu(view='main'){if(view==='models')renderModelSubmenu();else renderModelMenuMain();$('#modelMenu').hidden=false;$('#modelButton').setAttribute('aria-expanded','true')}
function toggleModelMenu(){const menu=$('#modelMenu');if(menu.hidden)openModelMenu();else closeModelMenu()}
function closeModelMenu(){const menu=$('#modelMenu');menu.hidden=true;$('#modelButton').setAttribute('aria-expanded','false')}
const permissionModes={
  default:{kind:'legacy',label:'Ask for approval',description:'Always ask for permission before editing external files or using the internet',icon:'shield',approvalPolicy:'on-request',approvalsReviewer:'user',sandbox:'workspace-write'},
  'guardian-approvals':{kind:'legacy',label:'Approve for me',description:'Only ask for actions detected as potentially unsafe',icon:'shield',approvalPolicy:'on-request',approvalsReviewer:'auto_review',sandbox:'workspace-write'},
  'full-access':{kind:'legacy',label:'Full access',description:'Unrestricted access to the internet and any file on your computer',icon:'terminal',approvalPolicy:'never',approvalsReviewer:'user',sandbox:'danger-full-access'},
};
const PERMISSION_PROFILE_PREFIX='profile:';
const RESERVED_PERMISSION_PROFILE_IDS=new Set(['default','guardian-approvals','full-access','custom']);
function permissionProfileCwd(){if(state.projectless)return null;const path=state.active?.cwd||state.workspaceContext?.cwd||localStorage.getItem('codex-webui-project')||state.config.defaultCwd||null;return typeof path==='string'&&path.startsWith('~')?state.config.home+path.slice(1):path}
function permissionProfileId(mode=state.permissionMode){return String(mode||'').startsWith(PERMISSION_PROFILE_PREFIX)?String(mode).slice(PERMISSION_PROFILE_PREFIX.length):null}
function autoReviewSupported(){return state.account?.type==='chatgpt'}
function permissionModeDefinition(mode=state.permissionMode){if(permissionModes[mode])return{mode,...permissionModes[mode]};const profileId=permissionProfileId(mode),profile=profileId&&state.permissionProfiles.find(item=>item.id===profileId);return profile?{kind:'profile',mode,profileId,label:profile.id,description:profile.description||'Custom permission profile',icon:'file',allowed:profile.allowed!==false}:null}
function permissionModeAvailable(mode=state.permissionMode){const selected=permissionModeDefinition(mode);if(!selected||selected.allowed===false)return false;if(mode==='guardian-approvals')return autoReviewSupported();if(mode==='full-access')return state.permissionVisibility.fullAccess;return true}
function normalizePermissionMode(){if(permissionModeAvailable())return;state.permissionMode='default';localStorage.setItem('codex-webui-permission-mode','default')}
function desktopPermission(settings){
  const sandbox=settings.sandboxPolicy?.type,reviewer=settings.approvalsReviewer,profile=settings.activePermissionProfile?.id;
  if(sandbox==='dangerFullAccess')return{mode:'full-access',...permissionModes['full-access']};
  if(profile&&!profile.startsWith(':'))return{mode:'desktop',label:profile};
  if(reviewer==='guardian_subagent'||reviewer==='auto_review')return{mode:'guardian-approvals',...permissionModes['guardian-approvals']};
  if(sandbox==='readOnly')return{mode:'desktop',label:"Read-only"};
  return{mode:'default',...permissionModes.default};
}
function applyDesktopSettings(thread,threadId){
  if(!thread?.desktopSettings||threadId!==state.active?.id)return;
  Object.assign(state.active,{model:thread.model,modelReasoningEffort:thread.modelReasoningEffort,desktopSettings:thread.desktopSettings});
  if(thread.model)state.selectedModel=thread.model;
  const effort=thread.modelReasoningEffort;
  updateEfforts(effort);const select=$('#effortSelect'),value=effort??'';
  if(![...select.options].some(option=>option.value===value)){const option=document.createElement('option');option.value=value;option.textContent=value||"Default";select.append(option)}
  select.value=value;syncModelLabel();if(effort==null)$('#effortLabel').textContent="Default";
  const permission=desktopPermission(thread.desktopSettings);state.permissionMode=permission.mode;if(permission.mode==='full-access')state.permissionVisibility.fullAccess=true;
  syncPermissionControl();
}
async function sendDesktopSettings(settings){
  if(!state.active?.desktopSettings)return;
  try{await rpc('host/thread/settings',{threadId:state.active.id,settings});scheduleActiveThreadSync(0)}catch(error){toast(error.message,5000);applyDesktopSettings(state.active,state.active.id)}
}
function selectedPermission(){if(state.active?.desktopSettings)return desktopPermission(state.active.desktopSettings);normalizePermissionMode();return permissionModeDefinition()||{mode:'default',...permissionModes.default}}
function setPermissionProfiles(profiles=[]){const seen=new Set;state.permissionProfiles=(Array.isArray(profiles)?profiles:[]).flatMap(profile=>{if(!profile||typeof profile.id!=='string')return[];const id=profile.id.trim(),key=id.toLocaleLowerCase();if(!id||id.startsWith(':')||RESERVED_PERMISSION_PROFILE_IDS.has(key)||seen.has(key))return[];seen.add(key);return[{id,description:typeof profile.description==='string'?profile.description:'',allowed:profile.allowed!==false}]});normalizePermissionMode();syncPermissionControl()}
async function loadPermissionProfiles(){if(!state.connected)return;const requestId=permissionProfileRequestGate.next();try{const result=await rpc('permissionProfile/list',{cwd:permissionProfileCwd(),limit:100});if(permissionProfileRequestGate.isCurrent(requestId))setPermissionProfiles(result.data||[])}catch{if(permissionProfileRequestGate.isCurrent(requestId))setPermissionProfiles([])}}
function permissionThreadPolicy(){const selected=selectedPermission();if(selected.kind==='profile')return{permissions:selected.profileId};return{approvalPolicy:selected.approvalPolicy,approvalsReviewer:selected.approvalsReviewer,sandbox:selected.sandbox}}
function permissionTurnPolicy(cwd){const selected=selectedPermission();if(selected.kind==='profile')return{permissions:selected.profileId,approvalPolicy:null,approvalsReviewer:null};const sandboxPolicy=selected.sandbox==='danger-full-access'?{type:'dangerFullAccess'}:{type:'workspaceWrite',writableRoots:cwd?[cwd]:[],networkAccess:false,excludeTmpdirEnvVar:false,excludeSlashTmp:false};return{permissions:null,approvalPolicy:selected.approvalPolicy,approvalsReviewer:selected.approvalsReviewer,sandboxPolicy}}
function renderPermissionMenu(){const list=$('#permissionOptions');if(!list)return;list.innerHTML='';const modes=['default'];if(autoReviewSupported())modes.push('guardian-approvals');if(state.permissionVisibility.fullAccess)modes.push('full-access');for(const profile of state.permissionProfiles)modes.push(`${PERMISSION_PROFILE_PREFIX}${profile.id}`);for(const mode of modes){const option=permissionModeDefinition(mode);if(!option)continue;const checked=mode===state.permissionMode,button=document.createElement('button');button.type='button';button.className='permission-option';button.dataset.permissionMode=mode;button.role='menuitemradio';button.disabled=option.allowed===false;button.setAttribute('aria-checked',String(checked));const description=option.allowed===false?'Not allowed by managed settings':option.description;button.innerHTML=`<span class="permission-option-icon">${codexIcon(option.icon)}</span><span class="permission-option-copy"><strong>${escapeHtml(option.optionLabel||option.label)}</strong><small>${escapeHtml(description)}</small></span><span class="permission-option-check">${checked?codexIcon('check'):''}</span>`;button.onclick=()=>choosePermissionMode(mode);list.append(button)}}
function syncPermissionSettings(){const autoRow=$('#settingsAutoReviewRow'),autoToggle=$('#settingsAutoReviewToggle'),fullToggle=$('#settingsFullAccessToggle');if(autoRow)autoRow.hidden=true;if(autoToggle)autoToggle.checked=autoReviewSupported();if(fullToggle)fullToggle.checked=state.permissionVisibility.fullAccess}
function syncPermissionControl(){normalizePermissionMode();const selected=selectedPermission();$('#modeButton').dataset.permission=state.permissionMode;$('#modeButton .control-label').textContent=t(state.planMode?'Plan mode':selected.label);$('#modeButton').classList.toggle('active',state.planMode||state.permissionMode!=='default');if($('#settingsPermissionValue'))$('#settingsPermissionValue').textContent=t(selected.label);syncPermissionSettings();renderPermissionMenu()}
function setPermissionMode(mode){if(!permissionModeAvailable(mode))return;const selected=permissionModeDefinition(mode);if(state.active?.desktopSettings){const settings=selected.kind==='profile'?{permissions:selected.profileId}:{permissions:null,approvalPolicy:selected.approvalPolicy,approvalsReviewer:selected.approvalsReviewer==='auto_review'?'guardian_subagent':selected.approvalsReviewer,sandboxPolicy:selected.sandbox==='danger-full-access'?{type:'dangerFullAccess'}:{type:'workspaceWrite',writableRoots:[state.active.cwd],networkAccess:false,excludeTmpdirEnvVar:false,excludeSlashTmp:false}};void sendDesktopSettings(settings);closePermissionMenu();return;}state.permissionMode=mode;localStorage.setItem('codex-webui-permission-mode',mode);syncPermissionControl();closePermissionMenu();toast(selected.label)}
function setPermissionVisibility(kind,enabled){state.permissionVisibility[kind]=Boolean(enabled);localStorage.setItem(kind==='autoReview'?'codex-webui-permission-auto-review':'codex-webui-permission-full-access',String(Boolean(enabled)));normalizePermissionMode();syncPermissionControl()}
function openPermissionMenu(){closeModelMenu();syncPermissionControl();$('#permissionMenu').hidden=false;$('#modeButton').setAttribute('aria-expanded','true')}
function closePermissionMenu(){const menu=$('#permissionMenu');menu.hidden=true;$('#modeButton').setAttribute('aria-expanded','false')}
function togglePermissionMenu(){if($('#permissionMenu').hidden)openPermissionMenu();else closePermissionMenu()}
function choosePermissionMode(mode){closePermissionMenu();if(mode==='full-access'&&state.permissionMode!=='full-access'){pendingFullAccessAction='select';const dialog=$('#fullAccessDialog');if(!dialog.open)dialog.showModal();return}setPermissionMode(mode)}
async function loadFolders(path=folderBrowse.path){const list=$('#folderList');list.innerHTML='<div class="list-state">Loading folders…</div>';try{const response=await fetch(`/api/folders?path=${encodeURIComponent(path)}`),data=await response.json();if(!response.ok)throw new Error(englishUiError(data.error)||'Cannot browse folder');folderBrowse={path:data.path,parent:data.parent,selected:data.path};$('#folderPathInput').value=data.path;$('#folderSelection').textContent=data.path;$('#folderConfirm').disabled=false;$('#folderUp').disabled=!data.parent;list.innerHTML='';for(const folder of data.folders){const b=document.createElement('button');b.type='button';b.className='folder-item';b.innerHTML=`${icons.file}<span>${escapeHtml(folder.name)}</span>`;b.ondblclick=()=>loadFolders(folder.path);b.onclick=()=>{folderBrowse.selected=folder.path;$('#folderSelection').textContent=folder.path;$('#folderConfirm').disabled=false;list.querySelectorAll('.folder-item').forEach(x=>x.classList.remove('selected'));b.classList.add('selected')};list.append(b)}if(!data.folders.length)list.innerHTML='<div class="list-state">No subfolders</div>'}catch(e){list.innerHTML=`<div class="list-state">${escapeHtml(e.message)}</div>`}}
function openFolderPicker(){const dialog=$('#folderDialog');folderBrowse.selected=null;dialog.showModal();loadFolders(state.projectless?(state.config.defaultCwd||'~/projects'):($('#projectPath').textContent||'~/projects'));$('#projectlessOption').classList.toggle('selected',state.projectless)}
async function syncWorkspaceContext(path){const requestId=workspaceContextRequestGate.next();try{const response=await fetch(`/api/workspace/context?cwd=${encodeURIComponent(path)}`,{cache:'no-store'}),context=await response.json();if(!response.ok)throw new Error(context.error||'Workspace context unavailable');if(!workspaceContextRequestGate.isCurrent(requestId)||state.projectless)return;state.workspaceContext=context;if(!state.active)showEmpty()}catch{if(workspaceContextRequestGate.isCurrent(requestId)&&!state.projectless){state.workspaceContext={cwd:path,project:path.split('/').filter(Boolean).at(-1)||path,environment:'Local',branch:'No branch'};if(!state.active)showEmpty()}}}
function syncProjectControl(){const hidden=Boolean(state.active);$('#composerProjectBar').hidden=hidden;$('#composerProjectButton').hidden=hidden;$('#composerProjectLabel').textContent=state.projectless?t('Choose project'):($('#projectName').textContent||'Project');$('#composerProjectRemove').hidden=state.projectless;$('#composerProjectIcon').hidden=!state.projectless;setComposerProjectMenu(false);if(!hidden)$('#threadPath').textContent=state.projectless?'':$('#projectPath').textContent}
function renderComposerProjects(){
  const query=$('#composerProjectSearch').value.trim().toLowerCase(),list=$('#composerProjectChoices'),paths=new Set(state.projects?state.projects.map(project=>project.roots[0]).filter(Boolean):state.threads.map(sidebarProjectKey).filter(path=>path!=='__tasks__'));
  if(!state.projects&&state.workspaceContext?.cwd)paths.add(state.workspaceContext.cwd);
  list.replaceChildren();
  for(const path of paths){const project=state.projects?.find(project=>project.roots.includes(path)),name=project?.name||sidebarProjectName(path);if(query&&!`${name} ${project?.roots.join(' ')||path}`.toLowerCase().includes(query))continue;const button=document.createElement('button');button.type='button';button.dataset.projectPath=path;button.title=shortPath(path);button.innerHTML=`${codexIcon('folderOpen')}<span data-i18n-ignore>${escapeHtml(name)}</span>`;button.onclick=()=>{setWorkspace(path);$('#prompt').focus()};list.append(button)}
  if(!list.children.length){const empty=document.createElement('div');empty.className='list-state';empty.textContent=t('No matching projects');list.append(empty)}
}
function setComposerProjectMenu(open){$('#composerProjectMenu').hidden=!open;$('#composerProjectButton').setAttribute('aria-expanded',String(open));if(open){$('#composerProjectSearch').value='';renderComposerProjects();$('#composerProjectSearch').focus()}}
function refreshComposerPlaceholder(){const followUpType=state.active?(state.active.source==='cloud'?'cloud':'local'):undefined;$('#prompt').placeholder=resolveComposerPlaceholder({followUpType,composerMode:state.composerMode,cloudStartingState:state.cloudStartingState,isBackgroundSubagentsPanelVisible:state.backgroundAgentsVisible,isGoalModeActive:state.goalMode,isPlanModeActive:state.planMode,placeholderText:state.placeholderText,isHome:!state.active})}
function setWorkspace(path){const resolved=path.replace(/^~/,state.config.home),name=sidebarProjectName(resolved);workspaceContextRequestGate.next();state.projectless=false;state.workspaceContext={cwd:resolved,project:name,environment:'Local',branch:null};$('#projectPath').textContent=shortPath(path);$('#projectName').textContent=name;localStorage.setItem('codex-webui-project',path);syncProjectControl();if(!state.active)showEmpty();if(!$('#summaryPanel').hidden)syncSummaryPanel();syncWorkspaceContext(resolved);if(state.connected)loadPermissionProfiles()}
function setProjectless(){workspaceContextRequestGate.next();state.projectless=true;state.workspaceContext=null;$('#projectPath').textContent='~';$('#projectName').textContent=t('Tasks');localStorage.setItem('codex-webui-project','~');syncProjectControl();if(!state.active){$('#threadPath').textContent='';showEmpty()}if(!$('#summaryPanel').hidden)syncSummaryPanel();if(state.connected)loadPermissionProfiles()}
function resetReviewState(){state.turnDiffs.clear();state.activeReview=null;reviewPatchState='undo';$('#reviewTab').hidden=true;if(!$('#reviewPanelContent').hidden)setSidePanelView('launcher','New tab');renderChanges()}
function clearConversationRuntime(){for(const animation of state.motion.values())animation?.destroy?.();state.items.clear();state.itemSignatures.clear();state.turns.clear();state.activities.clear();state.activityItems.clear();state.sideTasks.clear();state.dividers.clear();state.motion.clear();renderSideTasks()}
function rememberActiveThread(id){if(id)localStorage.setItem(ACTIVE_THREAD_STORAGE_KEY,String(id));else localStorage.removeItem(ACTIVE_THREAD_STORAGE_KEY);const url=new URL(location.href);if(id)url.searchParams.set('thread',id);else url.searchParams.delete('thread');history.replaceState(history.state,'',url)}
function startNewTask(){switchComposerDraft(null,true);disposeImportPicker();$('#composer').hidden=false;if(mobileSidebarEnabled())setSidebarOpen(false);threadOpenGate.next();saveConversationCache();resetActiveThreadSync();setActiveTurnId('');rememberActiveThread(null);state.active=null;state.turnWindow=null;clearConversationRuntime();state.changes.clear();resetReviewState();closeComposerAutocomplete();$('#threadTitle').textContent=t('New task');$('#threadPath').textContent=state.projectless?'':$('#projectPath').textContent;$('#prompt').value='';setPlanMode(false);syncProjectControl();renderContextTray();renderContextUsage();resizePrompt();if(!$('#summaryPanel').hidden)syncSummaryPanel();showEmpty();scrollOpenedThreadToBottom();renderThreads();$('#prompt').focus()}
function useSelectedFolder(){if(!folderBrowse.selected)return;setWorkspace(folderBrowse.selected);$('#folderDialog').close();if(state.active)startNewTask();else $('#prompt').focus()}
function useProjectless(){setProjectless();$('#folderDialog').close();startNewTask()}
function titleOf(t){return (t.name||t.preview||'Untitled task').replace(/\s+/g,' ').trim().slice(0,110)}
async function copyThreadText(text){
  try{if(navigator.clipboard){await navigator.clipboard.writeText(text);return}}catch{}
  const previous=document.activeElement,input=document.createElement('textarea');input.value=text;input.style.cssText='position:fixed;left:-9999px';document.body.append(input);input.select();
  try{if(!document.execCommand('copy'))throw new Error(t('Could not copy to clipboard'))}finally{input.remove();previous?.focus()}
}
async function threadMarkdown(thread){
  const result=await readConversation(thread.id),turns=[...result.thread.turns];let cursor=result.thread.olderTurnsCursor;
  while(cursor){const page=await rpc('thread/turns/list',{threadId:thread.id,cursor,limit:100,sortDirection:'desc',itemsView:'summary'}),known=new Set(turns.map(turn=>turn.id));turns.unshift(...[...page.data].reverse().filter(turn=>!known.has(turn.id)));cursor=page.nextCursor}
  const parts=[`# ${thread.name||titleOf(thread)}`];
  for(const turn of turns)for(const item of turn.items||[]){const user=item.type==='userMessage';if(!user&&item.type!=='agentMessage')continue;const text=user?userMessageText(item.content):agentMessageText(item);if(text)parts.push(`## ${user?t('User'):'Codex'}\n\n${text}`)}
  return parts.join('\n\n')+'\n';
}
function syncThreadMenu(){const active=Boolean(state.active&&!state.active.importJob);$('#threadMenuButton').hidden=!active;if(!active&&$('#threadMenu').matches(':popover-open'))$('#threadMenu').hidePopover()}
function showThreadCopyMenu(open){$('#threadCopyMenu').hidden=!open;$('#threadCopyButton').setAttribute('aria-expanded',String(open))}
async function runThreadAction(action){
  const thread=state.active,button=$('#threadMenuButton');if(!thread||button.disabled)return;
  $('#threadMenu').hidePopover();button.disabled=true;
  try{
    if(action==='rename'){
      const name=prompt(t('Rename conversation'),thread.name||titleOf(thread));if(!name?.trim())return;
      await rpc('thread/name/set',{threadId:thread.id,name:name.trim()});
      for(const item of state.threads)if(item.id===thread.id)item.name=name.trim();
      if(state.active?.id===thread.id){state.active.name=name.trim();renderHeader();saveConversationCache()}renderThreads();
    }else if(action==='pin'){
      const pinned=!thread.pinned;await rpc('host/thread/pin',{threadId:thread.id,pinned});
      if(state.active?.id===thread.id)state.active.pinned=pinned;for(const item of state.threads)if(item.id===thread.id)item.pinned=pinned;renderThreads();refreshThreadsSoon();
    }else if(action==='archive'){
      await rpc('thread/archive',{threadId:thread.id});state.threads=state.threads.filter(item=>item.id!==thread.id);if(state.active?.id===thread.id)startNewTask();renderThreads();refreshThreadsSoon();
    }else if(action==='fork'){
      const last=thread.turns?.at(-1),completed=thread.turns?.findLast(turn=>turn.status!=='inProgress');
      const boundary=last?.status==='inProgress'?(completed?{lastTurnId:completed.id}:{beforeTurnId:last.id}):{};
      const result=await rpc('thread/fork',{threadId:thread.id,excludeTurns:true,deferGoalContinuation:true,...boundary});await openThread(result.thread.id,result.thread);refreshThreadsSoon();
    }else{
      const text=action==='copy-directory'?thread.cwd:action==='copy-link'?`${location.origin}/?thread=${encodeURIComponent(thread.id)}`:await threadMarkdown(thread);
      await copyThreadText(text||'');toast(t('Copied'));
    }
  }catch(error){toast(error.message,5000)}finally{button.disabled=false}
}
function shortPath(path=''){const home=state.config.home;return home&&path.startsWith(home)?'~'+path.slice(home.length):path}
function sidebarProjectKey(thread={}){if(thread.projectId)return thread.projectId;return thread.projectless||!thread.cwd?'__tasks__':String(thread.cwd).replace(/\/+$/,'')}
function sidebarProjectName(key){const project=state.projects?.find(project=>project.id===key||project.roots.includes(key));if(project)return project.name;if(key==='__tasks__')return'Tasks';if(key===state.config.home)return'Home';return key.split('/').filter(Boolean).at(-1)||key}
let expandedSidebarProject=localStorage.getItem('codex-webui-expanded-project')||'';
const fullyExpandedSidebarProjects=new Set;
function renderThreads(){
  syncThreadMenu();
  const threads=[...importJobs.filter(job=>job.target==='codex'&&job.status!=='completed').map(importThread),...state.threads.filter(thread=>!importJobs.some(job=>job.target==='codex'&&job.status!=='completed'&&job.targetId===thread.id))];
  const list=$('#threadList'),q=$('#threadSearch').value.trim().toLowerCase(),matches=thread=>!q||titleOf(thread).toLowerCase().includes(q)||thread.cwd?.toLowerCase().includes(q),projects=new Map;list.innerHTML='';
  for(const project of state.projects||[])projects.set(project.id,{...project,key:project.id,threads:[],recency:0});
  const pinned=threads.filter(thread=>thread.pinned&&matches(thread));if(pinned.length){const label=document.createElement('div');label.className='sidebar-section-label';label.textContent=t('Pinned');list.append(label);for(const thread of pinned)list.append(sidebarThreadButton(thread))}
  for(const thread of threads){const key=sidebarProjectKey(thread);if(key==='__tasks__'||thread.pinned)continue;const project=projects.get(key)||{key,threads:[],recency:0};project.threads.push(thread);project.recency=Math.max(project.recency,Number(thread.recencyAt||thread.updatedAt)||0);projects.set(key,project)}
  const visibleProjects=[...projects.values()].filter(project=>!q||sidebarProjectName(project.key).toLowerCase().includes(q)||(project.roots||[project.key]).some(path=>path.toLowerCase().includes(q))||project.threads.some(matches));if(!state.projects)visibleProjects.sort((a,b)=>b.recency-a.recency);
  if(visibleProjects.length){const label=document.createElement('div');label.className='sidebar-section-label';label.textContent="Projects";list.append(label);for(const project of visibleProjects){const open=expandedSidebarProject===project.key||Boolean(q&&project.threads.some(matches)),button=document.createElement('button');button.type='button';button.className='sidebar-project-row';button.dataset.projectId=project.key;button.title=(project.roots||[project.key]).map(shortPath).join('\n');button.setAttribute('aria-expanded',String(open));button.innerHTML=`${codexIcon('folderOpen')}<span data-i18n-ignore>${escapeHtml(sidebarProjectName(project.key))}</span>`;button.onclick=()=>{expandedSidebarProject=open?'':project.key;localStorage.setItem('codex-webui-expanded-project',expandedSidebarProject);renderThreads()};list.append(button);if(!open)continue;const rank=thread=>{if(thread.importJob)return -1;const index=(project.threadIds||[]).indexOf(thread.id);return index<0?Infinity:index},projectThreads=project.threads.filter(matches).sort((a,b)=>rank(a)-rank(b)||(Number(b.recencyAt||b.updatedAt)||0)-(Number(a.recencyAt||a.updatedAt)||0)),showAll=q||fullyExpandedSidebarProjects.has(project.key);for(const thread of(showAll?projectThreads:projectThreads.slice(0,5)))list.append(sidebarThreadButton(thread,'project-thread-item'));if(!q&&projectThreads.length>5){const more=document.createElement('button');more.type='button';more.className='sidebar-project-more';more.textContent=showAll?"Collapse":"Expand";more.onclick=()=>{if(showAll)fullyExpandedSidebarProjects.delete(project.key);else fullyExpandedSidebarProjects.add(project.key);renderThreads()};list.append(more)}}}
  const recent=threads.filter(thread=>!thread.pinned&&sidebarProjectKey(thread)==='__tasks__'&&matches(thread)).sort((a,b)=>(Number(b.recencyAt||b.updatedAt)||0)-(Number(a.recencyAt||a.updatedAt)||0));
  if(recent.length){const label=document.createElement('div');label.className='sidebar-section-label recent';label.textContent="Recents";list.append(label);for(const thread of recent)list.append(sidebarThreadButton(thread))}
  if(!list.children.length)list.innerHTML='<div class="list-state">No matching tasks</div>';
}
function sidebarThreadButton(thread,className=''){const button=document.createElement('button');button.type='button';button.className=`thread-item${className?' '+className:''}${state.active?.id===thread.id?' active':''}`;button.dataset.id=thread.id;button.title=[titleOf(thread),shortPath(thread.cwd)].filter(Boolean).join(' — ');button.innerHTML=`<span class="thread-name">${escapeHtml(titleOf(thread))}</span>${thread.status?.type==='active'?'<span class="thread-running" role="status" aria-label="Running" title="Running"></span>':''}`;button.onclick=()=>{if(mobileSidebarEnabled())setSidebarOpen(false);openThread(thread.id)};return button}
function protectTurnSnapshot(turn,revision){
  const timeline=state.turns.get(turn.id);if(!timeline)return turn;
  const current=[...timeline.timelineItems.values()],versions=timeline.liveItemRevisions;
  const items=mergeTurnItems(current,turn.items).map(item=>{
    const previous=timeline.timelineItems.get(item.id),version=versions?.get(item.id);
    return previous&&(version>revision||(version&&previous.status&&previous.status!=='inProgress'&&item.status==='inProgress'))?previous:item;
  });
  const keepStatus=timeline.liveStatusRevision>revision||(timeline.liveStatusRevision&&timeline.dataset.status!=='inProgress'&&turn.status==='inProgress');
  return {...turn,...(keepStatus?{status:timeline.dataset.status}:{}),items};
}
async function readConversation(threadId){
  const revision=activeThreadEventRevision,result=await rpc('thread/read',{threadId,includeTurns:true});
  if(state.active?.id!==threadId)return result;
  const turns=(result.thread.turns||[]).map(turn=>protectTurnSnapshot(turn,revision)),known=new Set(turns.map(turn=>turn.id));
  for(const timeline of state.turns.values())if(timeline.liveRevision>revision&&!known.has(timeline.dataset.turnId))turns.push({id:timeline.dataset.turnId,status:timeline.dataset.status,items:[...timeline.timelineItems.values()]});
  result.thread.turns=turns;
  if(settingsEventRevision>revision)for(const key of ['model','modelReasoningEffort','desktopSettings'])result.thread[key]=state.active[key];
  if(queueEventRevision>revision)result.thread.queue=state.active.queue;
  return result;
}
const threadOpenGate=createLatestRequestGate();
let conversationCacheTimer;
function saveConversationCache(thread=state.active){if(thread?.id&&Array.isArray(thread.turns)&&thread.historyLoaded!==false)void writeCache(`thread:${thread.id}`,cacheableThread(thread))}
function scheduleConversationCache(){if(!conversationCacheTimer)conversationCacheTimer=setTimeout(()=>{conversationCacheTimer=null;saveConversationCache()},1500)}
function displayConversation(thread,cached=false,preserveScroll=false){
  const root=$('#conversation'),top=root.scrollTop,window=state.turnWindow;
  const resume=pendingWorkspaceView?.threadId===thread.id?pendingWorkspaceView:null;
  switchComposerDraft(thread.id);
  resetActiveThreadSync();if(!preserveScroll)setActiveTurnId('');state.active={...thread,cachePreview:cached,historyLoaded:true};rememberActiveThread(thread.id);
  state.turnWindow=preserveScroll?window:null;clearConversationRuntime();state.changes.clear();resetReviewState();closeComposerAutocomplete();
  if(resume){state.turnWindow=resume.turnWindow;conversationFollowsBottom=resume.follow!==false;}
  renderContextTray();renderContextUsage();renderHeader();renderThreads();
  $('#conversation').innerHTML='';
  if(thread.turns?.length)renderThread(state.active,0,preserveScroll);
  else $('#conversation').innerHTML='<div class="list-state conversation-loading">No conversation history loaded. Send a message to continue.</div>';
  if(!cached){setActiveTurnId('');if(thread.turns?.length)syncTurnRuntime(thread.turns.at(-1))}
  if(cached)cacheNotice("Showing cached messages. Syncing latest messages…");
  if(resume){
    pendingWorkspaceView=null;
    root.scrollTop=resume.follow===false?Number(resume.scrollTop)||0:root.scrollHeight;
    conversationScrollTop=root.scrollTop;updateScrollToBottomButton();
    if(resume.follow!==false)scrollOpenedThreadToBottom();
  }else if(preserveScroll){root.scrollTop=top;conversationScrollTop=root.scrollTop;scrollBottom();}else scrollOpenedThreadToBottom();
}
function cacheNotice(text,retry){
  let notice=$('#conversationCacheStatus');
  if(!notice){notice=document.createElement('div');notice.id='conversationCacheStatus';notice.className='list-state';$('#conversation').prepend(notice)}
  notice.textContent=text;
  if(retry){const button=document.createElement('button');button.className='load-older';button.textContent=t('Retry');button.onclick=retry;notice.append(button)}
}
async function restoreConversationCache(){
  const remembered=new URLSearchParams(location.search).get('thread')||localStorage.getItem(ACTIVE_THREAD_STORAGE_KEY);
  const [threads,thread,projects]=await Promise.all([readCache('threads'),remembered?readCache(`thread:${remembered}`):null,readCache('projects')]);
  if(state.active||state.threads.length)return;
  if(Array.isArray(projects))state.projects=projects;
  if(Array.isArray(threads)){state.threads=threads;renderThreads()}
  if(thread&&(new URLSearchParams(location.search).get('thread')||localStorage.getItem(ACTIVE_THREAD_STORAGE_KEY))===remembered)displayConversation(thread,true);
}
async function openThread(id,fallbackSummary=null){
  disposeImportPicker();
  if(id.startsWith('import-')){const job=importJobs.find(job=>job.id===id);if(job){if(job.status==='completed')return openThread(job.targetId);showImport(job);}else{threadOpenGate.next();resetActiveThreadSync();switchComposerDraft(id);state.active={id,importJob:true,importAwait:true};rememberActiveThread(id);$('#composer').hidden=true;$('#conversation').textContent="Loading import status…";}return true;}
  $('#composer').hidden=false;
  const openRequest=threadOpenGate.next();
  const listedSummary=state.threads.find(x=>x.id===id),summary=listedSummary||fallbackSummary,deferTransition=Boolean(fallbackSummary&&!listedSummary);
  saveConversationCache();
  let cachedShown=state.active?.id===id&&Boolean(state.active.turns?.length),settled=false,cachedThread=cachedShown?state.active:null;
  if(!deferTransition&&!cachedShown){switchComposerDraft(id);resetActiveThreadSync();setActiveTurnId('');rememberActiveThread(id);state.active={...(summary||{id}),cachePreview:true,historyLoaded:false};state.turnWindow=null;clearConversationRuntime();state.changes.clear();resetReviewState();closeComposerAutocomplete();renderContextTray();renderContextUsage();renderHeader();renderThreads();$('#conversation').innerHTML='<div class="list-state conversation-loading">Loading conversation…</div>'}
  const cached=readCache(`thread:${id}`).then(thread=>{
    if(thread&&!settled&&threadOpenGate.isCurrent(openRequest)){cachedThread=thread;if(!cachedShown){displayConversation({...summary,...thread},true);cachedShown=true}}
  });
  try{
    const result=await readConversation(id);settled=true;
    if(!threadOpenGate.isCurrent(openRequest))return false;
    const thread=mergeCachedHistory(state.active?.id===id?state.active:cachedThread,{...(summary||{}),...result.thread});
    displayConversation(thread,false,cachedShown);saveConversationCache();scheduleActiveThreadSync(0);return true;
  }catch(e){
    await cached;settled=true;
    if(!threadOpenGate.isCurrent(openRequest))return false;
    if(cachedShown){cacheNotice("Showing cached messages. Could not sync the latest messages.",()=>openThread(id,fallbackSummary));scheduleActiveThreadSync(0);return false}
    if(deferTransition){toast(e?.message||'Could not load side task');return false}
    if(state.active&&state.active.id!==id)return false;
    const root=$('#conversation');root.innerHTML='';const notice=document.createElement('div');notice.className='list-state';notice.textContent=e.message;const retry=document.createElement('button');retry.className='load-older';retry.textContent=t('Retry');retry.onclick=()=>openThread(id,fallbackSummary);root.append(notice,retry);return false;
  }
}

function importThread(job){const project=state.projects?.find(p=>p.roots.includes(job.projectPath));return {id:job.id,name:job.title,cwd:job.projectPath,projectId:project?.id,projectName:project?.name,projectless:false,importJob:true,historyLoaded:false,updatedAt:job.createdAt/1000,status:{type:job.status==='running'?'active':'idle'}};}
function showImport(job){
  switchComposerDraft(job.id);disposeImportPicker();threadOpenGate.next();saveConversationCache();resetActiveThreadSync();setActiveTurnId('');state.active=importThread(job);rememberActiveThread(job.id);clearConversationRuntime();
  expandedSidebarProject=state.active.projectId||job.projectPath;renderHeader();renderThreads();$('#composer').hidden=true;$('#composerProjectBar').hidden=true;
  const host=document.createElement('div');$('#conversation').replaceChildren(host);
  renderImportProgress(host,job,next=>{importJobs=[next,...importJobs.filter(item=>item.id!==next.id)];showImport(next)},()=>startNewTask());
}
function receiveImports(jobs){
  importJobs=jobs;const selected=jobs.find(job=>job.id===state.active?.id&&job.target==='codex');
  if(selected?.status==='completed'){refreshThreadsSoon();void openThread(selected.targetId,{id:selected.targetId,cwd:selected.projectPath,name:selected.title});}
  else if(selected&&state.active?.importAwait){showImport(selected);}
  else if(selected){const host=document.createElement('div');$('#conversation').replaceChildren(host);renderImportProgress(host,selected,next=>{importJobs=[next,...importJobs.filter(item=>item.id!==next.id)];showImport(next)},()=>startNewTask());}
  renderThreads();if(jobs.some(job=>job.target==='codex'&&job.status==='completed'))refreshThreadsSoon();
  const remembered=new URLSearchParams(location.search).get('thread')||localStorage.getItem(ACTIVE_THREAD_STORAGE_KEY);if(!state.active&&remembered?.startsWith('import-'))void openThread(remembered);
}
function renderHeader(){const t=state.active;if(!t)return;if(t.importJob){$('#threadTitle').textContent=t.name;$('#threadPath').textContent='';return;}syncProjectControl();if(t.cachePreview){$('#threadTitle').textContent=titleOf(t);$('#threadPath').textContent=t.projectless?'':shortPath(t.cwd);$('#threadSource').textContent=t.source||'local';return}applyDesktopSettings(t,t.id);renderQueuedMessages(t.queue||[]);$('#threadTitle').textContent=titleOf(t);if(t.projectless){state.projectless=true;state.workspaceContext=null;$('#projectName').textContent='Tasks';$('#projectPath').textContent='~';$('#threadPath').textContent=''}else{$('#threadPath').textContent=shortPath(t.cwd);setWorkspace(t.cwd||state.config.home);if(t.projectName)$('#projectName').textContent=t.projectName}syncProjectControl();refreshComposerPlaceholder();$('#threadSource').textContent=t.source||'local'}
function renderThread(thread,loadMore=0,keepScroll=false){const root=$('#conversation'),turns=thread.turns||[];state.turnWindow=createTurnWindow(turns,DEFAULT_TURN_PAGE_SIZE,state.turnWindow?.threadId===thread.id?state.turnWindow.start:undefined,loadMore);state.turnWindow.threadId=thread.id;clearConversationRuntime();root.innerHTML='';if(state.turnWindow.hiddenCount){const more=document.createElement('button');more.className='load-older';more.textContent=`Load earlier messages (${state.turnWindow.hiddenCount})`;more.onclick=()=>renderThread(thread,DEFAULT_TURN_PAGE_SIZE);root.append(more)}else if(thread.olderTurnsCursor){const more=document.createElement('button');more.className='load-older';more.textContent=t('Load earlier messages');more.onclick=async()=>{more.disabled=true;try{const page=await rpc('thread/turns/list',{threadId:thread.id,cursor:thread.olderTurnsCursor,limit:DEFAULT_TURN_PAGE_SIZE,sortDirection:'desc',itemsView:'summary'});if(state.active?.id!==thread.id)return;const known=new Set(thread.turns.map(turn=>turn.id));thread.turns=[...page.data].reverse().filter(turn=>!known.has(turn.id)).concat(thread.turns);thread.olderTurnsCursor=page.nextCursor??null;saveConversationCache(thread);const height=root.scrollHeight,top=root.scrollTop;renderThread(thread,DEFAULT_TURN_PAGE_SIZE);root.scrollTop=top+root.scrollHeight-height}catch(error){toast(error.message);more.disabled=false}};root.append(more)}for(const turn of state.turnWindow.visible)renderTurn(turn,root);if(!root.children.length)showEmpty();else if(!loadMore&&!keepScroll)scrollBottom()}
function showEmpty(){const root=$('#conversation'),project=state.projectless?null:(state.workspaceContext?.project||$('#projectName').textContent?.trim());root.innerHTML=`<div class="empty-state" id="emptyState">${codexInterfaceMark('empty-codex-mark')}<h1>${project?`What can I help with in ${escapeHtml(project)}?`:'What can I help?'}</h1></div>`;disposeImportPicker();const picker=$('#composerImport');disposeImportPicker=renderImportPicker(picker,'codex',state.projectless||state.active?'':currentComposerCwd(),job=>{importJobs=[job,...importJobs.filter(item=>item.id!==job.id)];showImport(job)});}
function ensureTurnTimeline(turnId,root=$('#conversation')){
  let turn=state.turns.get(turnId);if(turn?.isConnected)return turn;
  turn=document.createElement('article');turn.className='turn assistant-turn native-turn-timeline';turn.dataset.turnId=turnId;
  turn.timelineItems=new Map();turn.dataset.status='inProgress';
  turn.innerHTML='<div class="assistant-body"><details class="turn-work" open><summary class="worked-for-divider" data-worked-for-divider hidden><span>Worked</span><div></div></summary><div class="turn-event-stream"></div></details></div><div class="turn-final-slot"></div>';
  const work=turn.querySelector('.turn-work');
  work.ontoggle=()=>{if(turn.dataset.status!=='inProgress'&&state.active?.id)localStorage.setItem(`codex-webui-turn-work:${state.active.id}:${turnId}`,work.open?'open':'closed')};
  root.append(turn);state.turns.set(turnId,turn);state.dividers.set(turnId,turn.querySelector('[data-worked-for-divider]'));return turn;
}
function orderNodes(parent,nodes){let next=parent.firstElementChild;for(const node of nodes){if(node===next)next=next.nextElementSibling;else parent.insertBefore(node,next)}}
function layoutTurnTimeline(turn){
  if(!turn)return;
  const entries=[...turn.timelineItems.values()],done=turn.dataset.status!=='inProgress',stream=turn.querySelector('.turn-event-stream'),slot=turn.querySelector('.turn-final-slot');
  const rows=new Map([...turn.querySelectorAll('.activity-item')].map(row=>[row.dataset.itemId,row]));
  const groups=new Map([...turn.querySelectorAll('[data-agent-activity-group]')].map(group=>[group.dataset.activityGroupAnchor,group]));
  const latestReasoning=entries.findLast(item=>item.type==='reasoning');
  const last=done?entries.findLast(item=>item.type==='agentMessage'&&item.phase!=='commentary'&&!asyncQuestions(item).length):null;
  const final=last&&state.items.get(last.id),nodes=[],users=[],seen=new Set(),usedGroups=new Map();let group=null;
  for(const item of entries){
    const row=rows.get(String(item.id));
    if(row&&item.type==='reasoning'&&(done||item!==latestReasoning)){row.nextElementSibling?.remove();row.remove();state.activityItems.get(turn.dataset.turnId)?.delete(String(item.id));continue}
    if(row){
      const standalone=item.type==='imageView';
      if(!group||standalone||group.dataset.standalone==='true'){
        group=groups.get(String(item.id));
        if(!group){group=createActivityGroup(turn.dataset.turnId,item.id,standalone);stream.append(group)}
        usedGroups.set(group,[]);nodes.push(group);
      }
      usedGroups.get(group).push(row,row.nextElementSibling);
      continue;
    }
    const node=state.items.get(item.id);if(!node||seen.has(node))continue;seen.add(node);group=null;
    if(item.type==='userMessage'&&(done||nodes.length===0)){users.push(node);continue}
    if(node===final)continue;
    delete node.dataset.localConversationFinalAssistant;nodes.push(node);
  }
  for(const old of groups.values())if(!usedGroups.has(old))old.remove();
  let next=turn;for(const node of users.toReversed()){if(node.nextElementSibling!==next)turn.parentElement.insertBefore(node,next);next=node}
  orderNodes(stream,nodes);
  if(final){final.dataset.localConversationFinalAssistant='';if(final.parentElement!==slot)slot.append(final)}
  for(const [activity,rows] of usedGroups){orderNodes(activity.querySelector('.activity-items'),rows);updateActivitySummary(activity)}
  syncWorkedForDivider(turn.dataset.turnId);
}
function formatWorkedDuration(durationMs){if(!Number.isFinite(durationMs)||durationMs<1000)return null;const seconds=Math.max(1,Math.round(durationMs/1000));if(seconds<60)return`${seconds}s`;const minutes=Math.floor(seconds/60),rest=seconds%60;return rest?`${minutes}m ${rest}s`:`${minutes}m`}
function turnDurationMs(turn={}){if(Number.isFinite(turn.durationMs))return turn.durationMs;if(Number.isFinite(turn.startedAt)&&Number.isFinite(turn.completedAt))return Math.max(0,(turn.completedAt-turn.startedAt)*1000);if(Number.isFinite(turn.startedAtMs)&&Number.isFinite(turn.completedAtMs))return Math.max(0,turn.completedAtMs-turn.startedAtMs);return undefined}
function syncWorkedForDivider(turnId,durationMs){
  const turn=state.turns.get(turnId),divider=state.dividers.get(turnId);if(!turn||!divider)return;
  if(Number.isFinite(durationMs))turn.dataset.durationMs=String(durationMs);
  const done=turn.dataset.status!=='inProgress',work=turn.querySelector('.turn-work'),hasWork=turn.querySelector('.turn-event-stream').children.length>0;
  divider.hidden=!(done&&hasWork);work.hidden=!hasWork;
  const duration=formatWorkedDuration(Number(turn.dataset.durationMs));divider.querySelector('span').textContent=t(duration?`Worked for ${duration}`:'Worked');
  if(work.dataset.turnStatus!==turn.dataset.status){
    work.dataset.turnStatus=turn.dataset.status;
    work.open=!done||localStorage.getItem(`codex-webui-turn-work:${state.active?.id}:${turnId}`)==='open';
  }
}
function renderTurn(turn,root=$('#conversation')){
  const timeline=ensureTurnTimeline(turn.id,root);timeline.dataset.status=turn.status||'completed';
  timeline.timelineItems=new Map(mergeTurnItems([...timeline.timelineItems.values()],turn.items).map(item=>[item.id,item]));
  for(const item of turn.items||[])upsertItem(item,turn.id,root,false);
  layoutTurnTimeline(timeline);syncWorkedForDivider(turn.id,turnDurationMs(turn));
}
function textFromInput(content=[]){return userMessageText(content)}
function claimRolloutUser(item,turnId){
  const clientId=item.clientId||item.clientUserMessageId;
  if(clientId)for(const node of state.items.values()){if(node.dataset.userTurnId===turnId&&node.dataset.clientUserMessageId===clientId){state.items.set(item.id,node);return node}}
  const text=textFromInput(item.content),host=String(item.id).startsWith('host-user-');
  for(const [id,node] of state.items){
    if(host===String(id).startsWith('host-user-')||node.dataset.userTurnId!==turnId)continue;
    if(node.querySelector('.user-message')?.textContent===text){state.items.set(item.id,node);return node}
  }
  return null;
}
function claimOptimisticUser(item,root){if(String(item.id).startsWith('local-'))return null;const text=textFromInput(item.content),candidates=[...root.querySelectorAll('.user-turn[data-optimistic-user="true"]')];const el=candidates.find(node=>node.querySelector('.user-message')?.textContent===text);if(!el)return null;for(const[id,node]of state.items)if(node===el)state.items.delete(id);delete el.dataset.optimisticUser;state.items.set(item.id,el);return el}
function agentMessageIdFamily(id){const value=String(id||'');return /^item[-_]/.test(value)?'app':/^(?:msg_|host-message-)/.test(value)?'rollout':''}
function claimEquivalentAgentMessage(item,turnId){const family=agentMessageIdFamily(item.id);if(!family)return null;const text=agentMessageText(item,''),commentary=item.phase==='commentary';for(const[id,node]of state.items){if(agentMessageIdFamily(id)===family||node.closest('[data-turn-id]')?.dataset.turnId!==turnId)continue;const body=node.querySelector('.message-text'),existingCommentary=node.dataset.localConversationCommentary!==undefined;if(existingCommentary===commentary&&body?.dataset.raw===text){state.items.set(item.id,node);return node}}return null}
function placeAgentMessage(el,item,timeline){
  const commentary=item.phase==='commentary';el.className=commentary?'assistant-response assistant-commentary':'assistant-response';
  if(commentary)el.dataset.localConversationCommentary='';else delete el.dataset.localConversationCommentary;
  if(!el.parentElement)timeline.querySelector('.turn-event-stream').append(el);
}
function imageCwd(item={}){return item.cwd||state.active?.cwd||state.config.defaultCwd||'.'}
function sideTaskStatus(item,threadId){const agent=item.agentsStates?.[threadId];if(agent?.status)return agent.status;if(item.type==='subAgentActivity')return item.kind==='interrupted'?'interrupted':'running';return item.status==='failed'?'errored':item.status==='completed'?'completed':'running'}
function updateSideTasks(item){if(item.type==='collabAgentToolCall'){for(const threadId of item.receiverThreadIds||[]){const previous=state.sideTasks.get(threadId)||{};state.sideTasks.set(threadId,{...previous,threadId,prompt:item.prompt||previous.prompt||'',model:item.model||previous.model||'',reasoningEffort:item.reasoningEffort||previous.reasoningEffort||'',status:sideTaskStatus(item,threadId),message:item.agentsStates?.[threadId]?.message||previous.message||''})}}else if(item.type==='subAgentActivity'){const previous=state.sideTasks.get(item.agentThreadId)||{};state.sideTasks.set(item.agentThreadId,{...previous,threadId:item.agentThreadId,agentPath:item.agentPath||previous.agentPath||'',status:sideTaskStatus(item,item.agentThreadId)})}renderSideTasks()}
function renderSideTasks(){const list=$('#sideTaskList');if(!list)return;list.innerHTML='';for(const task of state.sideTasks.values()){const button=document.createElement('button');button.type='button';button.className='side-task-card';button.dataset.threadId=task.threadId;button.innerHTML=`${codexIcon('messageSquare')}<span class="side-task-copy"><strong>${escapeHtml(task.agentPath||task.model||'Side task')}</strong><small>${escapeHtml(task.message||task.prompt||task.threadId)}</small></span><span class="side-task-status ${escapeHtml(task.status||'running')}">${escapeHtml(task.status||'running')}</span>`;button.onclick=async()=>{button.disabled=true;button.setAttribute('aria-busy','true');await openThread(task.threadId,{id:task.threadId,name:task.agentPath||task.model||'Side task',preview:task.prompt||task.message||'',cwd:state.active?.cwd||state.config.defaultCwd,source:'local',sideTask:true});if(button.isConnected){button.disabled=false;button.removeAttribute('aria-busy')}};list.append(button)}if(!state.sideTasks.size)list.innerHTML='<div class="side-task-empty">Side tasks started by this chat will appear here.</div>';const summary=$('#summarySideTasks');if(summary)summary.textContent=state.sideTasks.size?`${state.sideTasks.size} side task${state.sideTasks.size===1?'':'s'}`:'No side tasks'}
function upsertItem(item,turnId,root=$('#conversation'),live=true,itemIndex){
  const timeline=turnId==='optimistic'?null:ensureTurnTimeline(turnId,root);
  if(item.type==='reasoning'&&timeline?.dataset.status!=='inProgress')item={...item,status:'completed'};
  if(timeline){
    const previous=timeline.timelineItems.get(item.id);item=mergeTurnItem(previous,item);timeline.timelineItems.set(item.id,item);
    if(Number.isInteger(itemIndex)){const ordered=[...timeline.timelineItems.values()].filter(entry=>entry.id!==item.id);ordered.splice(itemIndex,0,item);timeline.timelineItems=new Map(ordered.map(entry=>[entry.id,entry]))}
  }
  if(live)state.itemSignatures.delete(item.id);else{const signature=JSON.stringify(item);if(state.itemSignatures.get(item.id)===signature)return;state.itemSignatures.set(item.id,signature)}
  if(!shouldShowActivity(item)){
    const id=activityItemId(item),row=timeline?.querySelector(`.activity-item[data-item-id="${CSS.escape(id)}"]`);
    if(row){state.motion.get(row)?.destroy();state.motion.delete(row);row.nextElementSibling?.remove();row.remove()}
    state.activityItems.get(turnId)?.delete(id);
    if(live){layoutTurnTimeline(timeline);scrollBottom()}
    return;
  }
  root.querySelector('#emptyState')?.remove();
  if(item.type==='userInputResponse'||asyncQuestions(item).length){renderUserQuestionItem(item,turnId,root);if(live){layoutTurnTimeline(timeline);scrollBottom()}return;}
  if(item.type==='userMessage')applyQuestionAnswers(item.content);
  let el=state.items.get(item.id);if(!el&&item.type==='userMessage')el=claimOptimisticUser(item,root)||claimRolloutUser(item,turnId);if(!el&&item.type==='agentMessage')el=claimEquivalentAgentMessage(item,turnId);if(!el){
    if(item.type==='userMessage'){el=document.createElement('article');el.className='turn user-turn';if(String(item.id).startsWith('local-'))el.dataset.optimisticUser='true';el.innerHTML='<div class="user-message"></div>';const timeline=state.turns.get(turnId);timeline?.isConnected?root.insertBefore(el,timeline):root.append(el)}
    else if(item.type==='agentMessage'){const timeline=ensureTurnTimeline(turnId,root);el=document.createElement('div');el.innerHTML='<div class="message-text"></div>';placeAgentMessage(el,item,timeline)}
    else if(item.type==='imageGeneration'){const timeline=ensureTurnTimeline(turnId,root);el=document.createElement('div');el.className='assistant-generated-image';timeline.querySelector('.turn-event-stream').append(el)}
    else if(item.type==='contextCompaction'){const timeline=ensureTurnTimeline(turnId,root);el=document.createElement('div');el.className='context-compaction';el.dataset.itemId=item.id;el.setAttribute('role','status');el.innerHTML=`${codexIcon('list')}<span class="compaction-label"></span>`;timeline.querySelector('.turn-event-stream').append(el)}
    else if(['commandExecution','fileChange','mcpToolCall','dynamicToolCall','collabAgentToolCall','subAgentActivity','webSearch','reasoning','plan','imageView'].includes(item.type)){const id=activityItemId(item);el=ensureActivity(turnId,root,id,item.type==='imageView');addActivity(item,el,id)}
    else return;
    if(item.type==='userMessage'||item.type==='agentMessage'||item.type==='imageGeneration'||item.type==='contextCompaction')state.items.set(item.id,el);
  }
  if(item.type==='userMessage'){el.dataset.userTurnId=turnId;if(item.clientId||item.clientUserMessageId)el.dataset.clientUserMessageId=item.clientId||item.clientUserMessageId;el.querySelector('.user-message').innerHTML=escapeHtml(textFromInput(item.content))+renderItemImages(item,{cwd:imageCwd(),className:'message-image-grid'});}
  if(item.type==='agentMessage'){const timeline=ensureTurnTimeline(turnId,root),body=el.querySelector('.message-text'),text=agentMessageText(item,body.dataset.raw??''),cwd=imageCwd(item);placeAgentMessage(el,item,timeline);body.dataset.raw=text;body.innerHTML=renderAssistantMarkdown(text,{cwd})+renderItemImages(item,{cwd,className:'message-image-grid structured-message-images',excludeText:text});syncWorkedForDivider(turnId)}
  if(item.type==='imageGeneration'){const html=renderItemImages(item,{cwd:imageCwd(item),className:'generated-image-grid'});el.innerHTML=html||`<div class="generated-image-pending ${item.status==='inProgress'?'loading-shimmer':''}">${item.status==='failed'?'Image generation failed':'Generating image'}</div>`}
  if(item.type==='contextCompaction'){
    const completed=item.completed??item.status==='completed',active=!completed&&(item.status==='inProgress'||item.completed===false&&!item.status),automatic=item.source==='automatic';
    const label=completed?(automatic?'Context automatically compacted':'Context compacted'):active?(automatic?'Automatically compacting context':'Compacting context'):item.status==='failed'?'Context compaction failed':'Context compaction interrupted';
    el.querySelector('.compaction-label').textContent=t(label);el.querySelector('.compaction-label').classList.toggle('loading-shimmer',active);el.setAttribute('aria-busy',String(active));
  }
  if(item.type==='fileChange'){for(const ch of item.changes||[]){const path=ch.path||ch.filePath||'Changed file';state.changes.set(path,ch)}syncTurnReviewFromItems(turnId);renderChanges()}
  if(item.type==='collabAgentToolCall'||item.type==='subAgentActivity')updateSideTasks(item)
  if(live){layoutTurnTimeline(timeline);scrollBottom()}
}
function activityGroupExpansionKey(activity){const threadId=state.active?.id,turnId=activity.closest('[data-turn-id]')?.dataset.turnId,anchor=activity.dataset.activityGroupAnchor;return threadId&&turnId&&anchor?`codex-webui-activity-group:${threadId}:${turnId}:${anchor}`:null}
function savedActivityGroupExpansion(activity){const key=activityGroupExpansionKey(activity),saved=key&&localStorage.getItem(key);return saved==='open'?true:saved==='closed'?false:null}
function setActivityGroupOpen(activity,open,persist=false){const button=activity.querySelector('.activity-summary'),items=activity.querySelector('.activity-items');button.classList.toggle('open',open);button.setAttribute('aria-expanded',String(open));items.classList.toggle('open',open);if(persist&&!activity.classList.contains('single')){const key=activityGroupExpansionKey(activity);if(key)localStorage.setItem(key,open?'open':'closed')}}
function createActivityGroup(turnId,itemId,standalone=false){
  const activity=document.createElement('div');activity.className='activity-group active';activity.dataset.agentActivityGroup='';activity.dataset.activityGroupAnchor=String(itemId||'activity');
  if(standalone)activity.dataset.standalone='true';
  activity.innerHTML=`<button class="activity-summary open"><span class="activity-summary-icon" aria-hidden="true"></span><span class="activity-summary-copy loading-shimmer">Working</span>${icons.chevron}</button><div class="activity-items open"></div>`;
  activity.querySelector('.activity-summary').onclick=()=>setActivityGroupOpen(activity,!activity.querySelector('.activity-summary').classList.contains('open'),true);
  return activity;
}
function ensureActivity(turnId,root,itemId,standalone=false){
  const turn=ensureTurnTimeline(turnId,root),stream=turn.querySelector('.turn-event-stream'),existing=itemId?turn.querySelector(`[data-item-id="${CSS.escape(String(itemId))}"]`)?.closest('[data-agent-activity-group]'):null;
  if(existing)return existing;
  let activity=standalone?null:state.activities.get(turnId);
  if(!activity?.isConnected||activity.parentElement!==stream||stream.lastElementChild!==activity||activity.dataset.standalone==='true'){
    activity=createActivityGroup(turnId,itemId,standalone);stream.append(activity);state.activities.set(turnId,activity);
  }
  if(!state.activityItems.has(turnId))state.activityItems.set(turnId,new Map);return activity;
}
function joinActivityText(value){if(typeof value==='string')return value;if(Array.isArray(value))return value.filter(part=>typeof part==='string').join('\n');return''}
function activityOutput(item){if(item.type==='reasoning')return reasoningSummaryText(item);const output=item.aggregatedOutput??item.output?.aggregatedOutput??item.output;if(typeof output==='string')return output;if(Array.isArray(output))return output.join('\n');return joinActivityText(item.content)||(item.result?JSON.stringify(item.result,null,2):'')}
function commandText(item){return item.command||(item.commandActions||[]).map(action=>action?.command).filter(Boolean).join('\n')||''}
function commandExitCode(item){return item.exitCode??item.output?.exitCode}
function commandFooter(item,data){if(data.active)return{label:'',icon:''};if(item.executionStatus==='interrupted'||item.status==='interrupted'||item.status==='cancelled')return{label:'Stopped',icon:''};const exitCode=commandExitCode(item);if(data.tone==='error')return{label:exitCode==null?'Failed':`Exit code ${exitCode}`,icon:''};return{label:'Success',icon:icons.check}}
function renderCommandShell(out,item,data){if(out.dataset.outputKind!=='command'){out.dataset.outputKind='command';out.className='activity-output command-shell-wrap';out.innerHTML='<div class="command-shell"><div class="command-shell-body"><div class="command-shell-command"><span aria-hidden="true">$</span><code></code></div><div class="command-shell-output"><pre></pre></div></div><div class="command-shell-footer"></div></div>'}const output=activityOutput(item),pre=out.querySelector('.command-shell-output pre'),footer=commandFooter(item,data);out.querySelector('.command-shell-command code').textContent=commandText(item);pre.textContent=output||(data.active?'':'No output');pre.classList.toggle('empty',!output);out.querySelector('.command-shell-footer').innerHTML=`${footer.icon}<span>${footer.label}</span>`}
function inlineFileChangeDiff(change){const raw=unifiedDiffFromFileChanges([change]),review=parseUnifiedDiff(raw);if(!review.hasChanges){const diff=change.diff||change.unified_diff||'';return diff?`<pre>${escapeHtml(diff)}</pre>`:''}return `<div class="file-change-inline-diff">${review.files.flatMap(file=>file.hunks.map(hunk=>`<div class="file-change-inline-hunk"><div class="review-hunk-head">${escapeHtml(hunk.header)}</div><div class="review-lines">${hunk.lines.map(reviewLineHtml).join('')}</div></div>`)).join('')}</div>`}
function renderFileChangeOutput(out,item,data){out.dataset.outputKind='file-change';out.className='activity-output file-change-output';const changes=item.changes||[],legacy=activityOutput(item);if(!changes.length){out.innerHTML=`<div class="file-change-progress ${data.active?'loading-shimmer':''}">${escapeHtml(legacy||(data.active?'Waiting for patch details…':'No patch details'))}</div>`;return}out.innerHTML=changes.map(change=>{const path=change.path||change.filePath||'Changed file',kind=typeof change.kind==='string'?change.kind:change.kind?.type||'update';return `<section class="file-change-output-item"><div class="file-change-output-head">${codexIcon('fileDiff')}<span>${escapeHtml(shortPath(path))}</span><small>${escapeHtml(kind)}</small></div>${inlineFileChangeDiff(change)}</section>`}).join('')}
function isExplorationActivity(item,data=summarizeActivity(item)){return item.type==='commandExecution'&&['read','search','list'].includes(data.category)}
function renderActivityOutput(out,item,data){if(item.type==='imageView'){out.dataset.outputKind='image';out.className='activity-output activity-image-output';out.innerHTML=renderItemImages(item,{cwd:imageCwd(item),className:'activity-image-grid'})||'<div class="message-image-unavailable" data-i18n-ui>Image unavailable</div>';return}if(item.type==='commandExecution'&&data.category==='command'){renderCommandShell(out,item,data);return}if(item.type==='fileChange'){renderFileChangeOutput(out,item,data);return}if(item.type==='reasoning'){out.className='activity-output reasoning-output';out.replaceChildren();return}out.dataset.outputKind='plain';out.className='activity-output';out.textContent=isExplorationActivity(item,data)?'':activityOutput(item)||''}
function activityItemExpansionKey(row){const threadId=state.active?.id,turnId=row.closest('[data-turn-id]')?.dataset.turnId,itemId=row.dataset.itemId;return threadId&&turnId&&itemId?`codex-webui-activity-item:${threadId}:${turnId}:${itemId}`:null}
function savedActivityItemExpansion(row){const key=activityItemExpansionKey(row),saved=key&&localStorage.getItem(key);return saved==='open'?true:saved==='closed'?false:null}
function setActivityExpanded(row,expanded,persist=false){row.classList.toggle('expanded',expanded);row.setAttribute('aria-expanded',String(expanded));if(persist){const key=activityItemExpansionKey(row);if(key)localStorage.setItem(key,expanded?'open':'closed')}}
function motionIcon(name){return `<span class="activity-motion" data-animation="${name}"></span>`}
async function mountMotion(row,name){const holder=row.querySelector('.activity-motion');if(!holder)return;state.motion.get(row)?.destroy();try{const animationData=await fetch(`/assets/codex-motion/${name}.json`).then(r=>r.json());if(!holder.isConnected)return;const animation=lottie.loadAnimation({container:holder,renderer:'svg',loop:true,autoplay:true,animationData,rendererSettings:{preserveAspectRatio:'xMidYMid meet'}});state.motion.set(row,animation)}catch{holder.innerHTML=codexIcon('loaderCircle','motion-fallback')}}
function activityIconName(item,data=summarizeActivity(item)){if(item.type==='reasoning')return null;if(data.tone==='error')return'triangleAlert';if(item.type==='fileChange')return'fileDiff';if(data.category==='image')return'image';if(data.category==='read')return'file';if(data.category==='search'||item.type==='webSearch')return'search';if(data.category==='list')return'list';if(data.category==='command')return'terminal';return'wrench'}
function stopMotion(row,tone){const animation=state.motion.get(row);animation?.destroy();state.motion.delete(row);const holder=row.querySelector('.activity-motion'),turnId=row.closest('[data-turn-id]')?.dataset.turnId,item=state.activityItems.get(turnId)?.get(row.dataset.itemId),data=item?summarizeActivity(item):{tone};if(!holder)return;const icon=activityIconName(item||{},data);holder.innerHTML=icon?codexIcon(icon):''}
function activityItemId(item){return String(item.id||item.callId||item.requestId||`${item.type}-${Date.now()}`)}
function setActivitySummaryIcon(activity,item){const holder=activity.querySelector('.activity-summary-icon'),icon=item&&activityIconName(item);if(holder){holder.hidden=!icon;holder.innerHTML=icon?codexIcon(icon):''}}
function commandRowSummary(item,data,expanded){if(data.active)return data.label;const interrupted=item.executionStatus==='interrupted'||item.status==='interrupted'||item.status==='cancelled',command=commandText(item);if(expanded)return interrupted?'Stopped command':'Ran command';return`${interrupted?'Stopped':'Ran'}${command?` ${command}`:' command'}`}
function updateCommandRowSummary(row,item,data,expanded=row.classList.contains('expanded')){const summary=row.querySelector('.activity-name');if(summary)summary.textContent=commandRowSummary(item,data,expanded)}
function updateActivitySummary(activity){
  const turn=activity.closest('[data-turn-id]'),turnId=turn?.dataset.turnId,allItems=state.activityItems.get(turnId),items=[...activity.querySelectorAll('.activity-item')].map(row=>allItems?.get(row.dataset.itemId)).filter(Boolean),summary=activity.querySelector('.activity-summary-copy');
  if(!turn||!summary)return;
  const latest=items.at(-1),tools=items.filter(item=>item.type!=='reasoning'),standalone=activity.dataset.standalone==='true';
  activity.classList.toggle('single',standalone);
  const button=activity.querySelector('.activity-summary'),data=latest?summarizeActivity(latest):null;
  activity.hidden=!latest;
  if(data){
    setActivitySummaryIcon(activity,latest);
    let label=latest.type==='commandExecution'&&data.category==='command'?commandRowSummary(latest,data,false):[data.label,shortPath(data.detail||'')].filter(Boolean).join(' ');
    if(latest.type==='reasoning'&&label==='Thinking'){
      const preceding=[...turn.timelineItems.values()];
      const headings=preceding.slice(0,preceding.findIndex(item=>item.id===latest.id)+1).filter(item=>item.type==='reasoning').map(item=>summarizeActivity({...item,status:'inProgress'}).label);
      label=headings.findLast(text=>text!=='Thinking')||label;
    }
    if(summary.textContent!==label)summary.textContent=label;
    summary.classList.toggle('loading-shimmer',data.active);
    activity.classList.toggle('active',data.active);
  }
  button.disabled=!tools.length;
  button.querySelector('.activity-chevron').hidden=!tools.length;
  setActivityGroupOpen(activity,standalone||(tools.length>0&&(savedActivityGroupExpansion(activity)??false)));
  syncWorkedForDivider(turnId);
}
function addActivity(item,activity,id=activityItemId(item)){const data=summarizeActivity(item),turn=activity.closest('[data-turn-id]'),turnId=turn.dataset.turnId,items=state.activityItems.get(turnId)||new Map,box=activity.querySelector('.activity-items');items.set(id,item);state.activityItems.set(turnId,items);let row=box.querySelector(`[data-item-id="${CSS.escape(id)}"]`);if(!row){row=document.createElement('div');row.className='activity-item entering';row.dataset.itemId=id;box.append(row);const out=document.createElement('div');out.className='activity-output';box.append(out)}const imageView=item.type==='imageView',reasoning=item.type==='reasoning',command=item.type==='commandExecution'&&data.category==='command',fileChange=item.type==='fileChange',wasActive=row.dataset.activityWasActive==='true',savedExpanded=savedActivityItemExpansion(row),existingExpanded=row.dataset.expansionInitialized?row.classList.contains('expanded'):imageView,expanded=reasoning?(data.active||wasActive?false:(savedExpanded??existingExpanded)):(savedExpanded??existingExpanded);row.dataset.expansionInitialized='true';row.dataset.activityWasActive=String(data.active);row.className=`activity-item ${command?'command-activity ':''}${reasoning?'reasoning-activity ':''}${imageView?'image-activity ':''}${fileChange?'file-change-activity ':''}${data.active?'active':'settled'} ${data.tone}`;if(command){state.motion.get(row)?.destroy();state.motion.delete(row);row.innerHTML=`<span class="activity-command-icon">${icons.terminal}</span><div class="activity-copy"><div class="activity-name ${data.active?'loading-shimmer':''}">${escapeHtml(commandRowSummary(item,data,expanded))}</div></div><span class="activity-command-chevron">${icons.chevron}</span>`}else if(reasoning){state.motion.get(row)?.destroy();state.motion.delete(row);if(!row.querySelector('.activity-reasoning-chevron'))row.innerHTML=`<div class="activity-copy"><div class="activity-name"></div></div><span class="activity-reasoning-chevron">${icons.chevron}</span>`;const name=row.querySelector('.activity-name');name.textContent=data.label;name.classList.toggle('loading-shimmer',data.active)}else{const detail=shortPath(data.detail||'');row.innerHTML=`${motionIcon(data.animation)}<div class="activity-copy"><div class="activity-name ${data.active?'loading-shimmer':''}"><span class="activity-label">${escapeHtml(data.label)}</span>${detail?` <span class="activity-detail">${escapeHtml(detail)}</span>`:''}</div></div><span class="activity-result">${fileChange?icons.chevron:''}</span>`}const out=row.nextElementSibling;renderActivityOutput(out,item,data);const reasoningOutput=reasoning&&!!activityOutput(item),expandable=imageView||command||fileChange||(reasoning&&!data.active&&reasoningOutput)||(!reasoning&&!isExplorationActivity(item,data)&&!!activityOutput(item));if(expandable){row.setAttribute('role','button');row.tabIndex=0;setActivityExpanded(row,expanded)}else{row.removeAttribute('role');row.removeAttribute('aria-expanded');row.tabIndex=-1;row.classList.remove('expanded')}row.onclick=expandable?()=>{const next=!row.classList.contains('expanded');setActivityExpanded(row,next,true);if(command)updateCommandRowSummary(row,item,data,next)}:null;row.onkeydown=expandable?event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();row.click()}}:null;if(!command&&!reasoning){if(data.active)mountMotion(row,data.animation);else stopMotion(row,data.tone)}updateActivitySummary(activity)}
function diffForTurn(turnId){return state.turnDiffs.get(turnId)||null}
function recordTurnReview(turnId,raw,source='fileChange'){if(!turnId||!raw)return null;const existing=state.turnDiffs.get(turnId);if(source!=='native'&&existing?.source==='native')return existing;const review=parseUnifiedDiff(raw);if(!review.hasChanges)return null;review.turnId=turnId;review.raw=raw;review.source=source;state.turnDiffs.set(turnId,review);state.activeReview=review;$('#reviewTab').hidden=false;renderChanges();return review}
function syncTurnReviewFromItems(turnId){const items=state.activityItems.get(turnId),changes=items?[...items.values()].flatMap(item=>item?.type==='fileChange'&&Array.isArray(item.changes)?item.changes:[]):[],raw=unifiedDiffFromFileChanges(changes);if(raw)recordTurnReview(turnId,raw)}
function saveReviewPreferences(){localStorage.setItem('codex-webui-review-preferences',JSON.stringify(reviewPreferences))}
function reviewLineHtml(line){if(!line)return '<div class="review-line empty"><span class="review-sign"></span><code></code></div>';return `<div class="review-line ${line.type}"><span class="review-sign">${line.type==='add'?'+':line.type==='delete'?'−':' '}</span><code>${escapeHtml(line.text)}</code></div>`}
function reviewHunkHtml(hunk){if(reviewPreferences.mode==='split'){return `<div class="review-split-lines">${splitDiffHunk(hunk).map(row=>`<div class="review-split-row"><div class="review-side old">${reviewLineHtml(row.left)}</div><div class="review-side new">${reviewLineHtml(row.right)}</div></div>`).join('')}</div>`}return `<div class="review-lines">${hunk.lines.map(reviewLineHtml).join('')}</div>`}
function syncReviewControls(review){const has=!!review?.hasChanges;$('#reviewMode').disabled=!has;$('#reviewWrap').disabled=!has;$('#reviewExpand').disabled=!has;$('#reviewPatch').disabled=!has||!state.active?.id||!review?.turnId;$('#reviewMode').title=reviewPreferences.mode==='unified'?'Switch to split diff':'Switch to unified diff';$('#reviewWrap').title=reviewPreferences.wrap?'Disable word wrap':'Enable word wrap';$('#reviewExpand').title=reviewPreferences.expanded?'Collapse all diffs':'Expand all diffs';$('#reviewPatch').title=reviewPatchState==='undo'?'Undo changes':'Reapply changes';$('#reviewPatch').innerHTML=codexIcon(reviewPatchState==='undo'?'undo':'redo')}
function renderChanges(){const list=$('#changeList'),review=state.activeReview||[...state.turnDiffs.values()].at(-1)||null,reviewVisible=document.body.classList.contains('side-panel-open')&&!$('#reviewPanelContent').hidden;document.body.classList.toggle('review-split-open',reviewVisible&&reviewPreferences.mode==='split'&&!!review?.hasChanges&&innerWidth>1200);list.dataset.mode=reviewPreferences.mode;list.classList.toggle('wrap',reviewPreferences.wrap);if(review?.hasChanges){$('#changeCount').textContent=review.fileCount;$('#changeSummary').textContent=`${review.fileCount} changed file${review.fileCount===1?'':'s'}`;$('#reviewStats').innerHTML=`<span class="plus">+${review.linesAdded}</span><span class="minus">−${review.linesDeleted}</span>`;list.innerHTML='';for(const file of review.files){const section=document.createElement('section');section.className='review-file';section.dataset.path=file.path;section.innerHTML=`<button class="review-file-head" aria-expanded="${reviewPreferences.expanded}">${codexIcon('chevronDown','review-chevron')}<span class="review-file-name">${escapeHtml(shortPath(file.path))}</span><span class="review-file-stats"><span class="plus">+${file.linesAdded}</span><span class="minus">−${file.linesDeleted}</span></span></button><div class="review-hunks"${reviewPreferences.expanded?'':' hidden'}></div>`;const body=section.querySelector('.review-hunks');for(const hunk of file.hunks){const h=document.createElement('div');h.className='review-hunk';h.innerHTML=`<div class="review-hunk-head">${escapeHtml(hunk.header)}</div>${reviewHunkHtml(hunk)}`;body.append(h)}section.querySelector('.review-file-head').onclick=e=>{const open=e.currentTarget.getAttribute('aria-expanded')==='true';e.currentTarget.setAttribute('aria-expanded',String(!open));body.hidden=open};list.append(section)}syncReviewControls(review);return}$('#reviewStats').textContent='';$('#changeCount').textContent=state.changes.size;$('#changeSummary').textContent=state.changes.size?`${state.changes.size} changed file${state.changes.size===1?'':'s'}`:'No changes yet';list.innerHTML='';for(const [path,ch] of state.changes){const el=document.createElement('div');el.className='change-item';el.innerHTML=`<div class="change-path">${icons.file}<span>${escapeHtml(shortPath(path))}</span></div><div class="change-stats"><span class="plus">+${ch.additions||0}</span> <span class="minus">−${ch.deletions||0}</span></div>`;list.append(el)}if(!state.changes.size)list.innerHTML='<div class="panel-empty">Changes made by Codex will appear here.</div>';syncReviewControls(null)}
async function applyActiveReviewPatch(){const review=state.activeReview;if(!review?.turnId||!state.active?.id)return;const action=reviewPatchState,button=$('#reviewPatch');button.disabled=true;button.innerHTML=codexIcon('loaderCircle','review-loading');try{const response=await fetch('/api/review/patch',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({threadId:state.active.id,turnId:review.turnId,action})}),result=await response.json();if(!response.ok)throw new Error(result.error||'Review patch failed');reviewPatchState=action==='undo'?'reapply':'undo';toast(action==='undo'?'Changes reverted':'Changes reapplied')}catch(error){toast(error.message)}finally{syncReviewControls(review)}}
function applyTerminalInteraction(p){const itemId=String(p.itemId),current=state.activityItems.get(p.turnId)?.get(itemId);if(current?.type!=='commandExecution')return;let buffer=current.terminalInputBuffer||'',commands=[];for(const char of String(p.stdin||'')){if(char==='\r'||char==='\n'){const command=buffer.trim();if(command)commands.push(command);buffer='';continue}if(char==='\u0003'){buffer='';continue}if(char==='\b'||char==='\u007f'){buffer=buffer.slice(0,-1);continue}buffer+=char}const actions=[...(current.commandActions||[]),...commands.map(command=>({type:'unknown',command}))];upsertItem({...current,status:'inProgress',terminalInputBuffer:buffer,commandActions:actions},p.turnId)}

function onNotification(method,p){
  if(p.threadId&&p.threadId!==state.active?.id&&(method.startsWith('item/')||method.startsWith('turn/')))return;
  if(state.active&&((method.startsWith('item/')||method.startsWith('turn/'))||p.threadId===state.active.id)){
    const revision=++activeThreadEventRevision,turnId=p.turnId||p.turn?.id;
    if(turnId){const timeline=ensureTurnTimeline(turnId);timeline.liveRevision=revision;
      if(method==='turn/started'||method==='turn/completed')timeline.liveStatusRevision=revision;
      const ids=p.itemId?[p.itemId]:p.item?.id?[p.item.id]:(p.turn?.items||[]).map(item=>item.id);
      timeline.liveItemRevisions??=new Map();for(const id of ids)timeline.liveItemRevisions.set(id,revision);
    }
  }
  if(method==='host/thread/settings'){if(p.threadId===state.active?.id)settingsEventRevision=activeThreadEventRevision;applyDesktopSettings(p,p.threadId);return;}
  if(method==='host/thread/queue'){if(p.threadId===state.active?.id){queueEventRevision=activeThreadEventRevision;renderQueuedMessages(p.messages||[])}return;}
  if(method==='account/updated')loadAccount(true);
  else if(method==='thread/started'){state.threads.unshift(p.thread);renderThreads()}
  else if(method==='thread/name/updated'){const t=state.threads.find(x=>x.id===p.threadId);if(t)t.name=p.name;if(state.active?.id===p.threadId)state.active.name=p.name;renderThreads();renderHeader()}
  else if(method==='thread/closed'){if(p.threadId===state.active?.id)state.active.canAcceptDirectInput=false}
  else if(method==='turn/started'){if(p.turn?.id){const timeline=ensureTurnTimeline(p.turn.id);timeline.dataset.status='inProgress';layoutTurnTimeline(timeline)}if(!p.threadId||p.threadId===state.active?.id)setActiveTurnId(p.turn?.id||'');scheduleActiveThreadSync(0)}
  else if(method==='item/started')upsertItem({...p.item,status:'inProgress'},p.turnId,$('#conversation'),true,p.itemIndex);
  else if(method==='item/completed'){const status=['failed','declined','interrupted','cancelled','canceled'].includes(p.item?.status)?p.item.status:'completed';upsertItem({...p.item,status},p.turnId,$('#conversation'),true,p.itemIndex)}
  else if(method==='item/agentMessage/delta'){let el=state.items.get(p.itemId);if(!el){upsertItem({id:p.itemId,type:'agentMessage',text:''},p.turnId);el=state.items.get(p.itemId)}if(el.classList.contains('user-input-card'))return;const body=el.querySelector('.message-text');body.dataset.raw=(body.dataset.raw||'')+p.delta;const timeline=state.turns.get(p.turnId),item=timeline?.timelineItems.get(p.itemId);if(item)timeline.timelineItems.set(p.itemId,{...item,text:body.dataset.raw});body.innerHTML=renderAssistantMarkdown(body.dataset.raw,{cwd:imageCwd()});scrollBottom()}
  else if(method==='item/reasoning/summaryPartAdded')upsertReasoningDelta(p,null);
  else if(method==='item/reasoning/summaryTextDelta')upsertReasoningDelta(p,'summary');
  else if(method==='item/reasoning/textDelta')upsertReasoningDelta(p,'content');
  else if(method==='item/commandExecution/outputDelta'){const turn=state.turns.get(p.turnId),row=turn?.querySelector(`[data-item-id="${CSS.escape(p.itemId)}"]`),item=state.activityItems.get(p.turnId)?.get(String(p.itemId));if(item)item.aggregatedOutput=(item.aggregatedOutput||'')+(p.delta||'');if(row){const target=row.nextElementSibling.querySelector('.command-shell-output pre')||row.nextElementSibling;target.textContent=(target.classList.contains('empty')?'':target.textContent||'')+(p.delta||'');target.classList.remove('empty')}}
  else if(method==='item/commandExecution/terminalInteraction')applyTerminalInteraction(p)
  else if(method==='item/fileChange/outputDelta'){const itemId=String(p.itemId),current=state.activityItems.get(p.turnId)?.get(itemId),item=current?.type==='fileChange'?{...current,status:'inProgress'}:{id:itemId,type:'fileChange',status:'inProgress',changes:[]};item.aggregatedOutput=(item.aggregatedOutput||'')+(p.delta||'');upsertItem(item,p.turnId)}
  else if(method==='item/fileChange/patchUpdated'){const itemId=String(p.itemId),current=state.activityItems.get(p.turnId)?.get(itemId),item=current?.type==='fileChange'?{...current,status:'inProgress',changes:p.changes||[]}:{id:itemId,type:'fileChange',status:'inProgress',changes:p.changes||[]};upsertItem(item,p.turnId)}
  else if(method==='turn/diff/updated'){if(p.threadId&&state.active?.id&&p.threadId!==state.active.id)return;recordTurnReview(p.turnId,p.diff||'','native')}
  else if(method==='turn/completed'){if(!p.threadId||p.threadId===state.active?.id)resetActiveThreadSync();if((!p.threadId||p.threadId===state.active?.id)&&(!p.turn?.id||activeTurnId()===p.turn.id))setActiveTurnId('');if(p.turn?.id)syncTurnSnapshot({...p.turn,status:p.turn.status||'completed'});scheduleActiveThreadSync(0);refreshThreadsSoon()}
  else if(method==='thread/tokenUsage/updated'){const threadId=p.threadId||state.active?.id;if(threadId&&p.tokenUsage)state.tokenUsage.set(threadId,p.tokenUsage);if(threadId===state.active?.id)renderContextUsage()}
  else if(method==='thread/status/changed'){if(p.threadId===state.active?.id){state.active.status=p.status;scheduleActiveThreadSync(0)}refreshThreadsSoon()}
  else if(method==='error')toast(p.error?.message||p.message||'Codex error');
}
function applyQuestionAnswers(content){
  const answers=Object.fromEntries(parseQuestionReply(content).map(reply=>[reply.questionItemId,[reply.answer]]));
  if(Object.keys(answers).length)for(const card of $('#conversation').querySelectorAll('.user-input-card'))card.applyAnswers?.(answers);
}
function renderUserQuestionItem(item,turnId,root){
  const asynchronous=item.type==='agentMessage',questions=asynchronous?asyncQuestions(item):item.questions||[],threadId=state.active?.id;
  if(!questions.length||!threadId)return;
  let card=state.items.get(item.id);
  if(!card?.classList.contains('user-input-card')){
    card?.remove();
    card=createQuestionCard(questions,async answers=>{
      if(asynchronous){
        const input=[{type:'text',text:questionReply(questions,answers),text_elements:[]}];
        const live=await rpc('host/thread/live',{threadId});
        if(live.active&&live.turn?.id)await rpc('turn/steer',{threadId,expectedTurnId:live.turn.id,input});
        else await rpc('turn/start',{threadId,input});
      }else{
        await rpc('host/thread/user-input/answer',{threadId,requestId:item.requestId,response:{answers:Object.fromEntries(Object.entries(answers).map(([id,values])=>[id,{answers:values}]))}});
      }
      if(state.active?.id===threadId)scheduleActiveThreadSync(0);
    },{partial:asynchronous});
    card.dataset.questionItemId=String(item.id);
    ensureTurnTimeline(turnId,root).querySelector('.turn-event-stream').append(card);state.items.set(item.id,card);
  }
  if(!asynchronous&&item.completed)card.applyAnswers(Object.fromEntries(questions.map(q=>[q.id,item.answers?.[q.id]||[]])));
  if(asynchronous)for(const turn of state.active.turns||[])for(const message of turn.items||[])if(message.type==='userMessage')applyQuestionAnswers(message.content);
}
function upsertReasoningDelta(p,field){const itemId=String(p.itemId),items=state.activityItems.get(p.turnId),current=items?.get(itemId),item=current?.type==='reasoning'?{...current,status:'inProgress'}:{id:itemId,type:'reasoning',status:'inProgress',summary:[],content:[]};if(field){const index=field==='summary'?(p.summaryIndex??0):(p.contentIndex??0),parts=Array.isArray(item[field])?[...item[field]]:[];while(parts.length<=index)parts.push('');parts[index]=(parts[index]||'')+(p.delta||'');item[field]=parts}upsertItem(item,p.turnId);scrollBottom()}
function setApprovalWaiting(group,itemId,waiting){if(!group)return;const row=itemId?group.querySelector(`[data-item-id="${CSS.escape(itemId)}"]`):null,summary=group.querySelector('.activity-summary-copy');group.classList.toggle('waiting-approval',waiting);if(waiting){summary.textContent='Waiting for approval';summary.classList.remove('loading-shimmer');if(row){row.querySelector('.activity-name')?.classList.remove('loading-shimmer');state.motion.get(row)?.pause()}}else{if(row){row.querySelector('.activity-name')?.classList.add('loading-shimmer');state.motion.get(row)?.play()}updateActivitySummary(group)}}
function approvalIcon(kind){return kind==='network'?codexIcon('globe'):kind==='patch'?codexIcon('fileDiff'):kind==='permission'?codexIcon('shield'):codexIcon('terminal')}
function approvalBody(model,p){if(model.kind==='exec'||model.kind==='network')return `<div class="approval-command"><code>${escapeHtml(p.command||model.title)}</code></div>`;if(model.kind==='patch'){const review=diffForTurn(p.turnId);return review?.hasChanges?`<button type="button" class="approval-review-link">${codexIcon('fileDiff')}<span>Review ${review.fileCount} changed file${review.fileCount===1?'':'s'}</span><span class="plus">+${review.linesAdded}</span><span class="minus">−${review.linesDeleted}</span></button>`:''}return permissionRows(p.permissions).map(row=>`<div class="permission-row"><span>${escapeHtml(row.label)}</span><code>${escapeHtml(shortPath(row.value))}</code></div>`).join('')}
async function onServerRequest(req){const p=req.params||{};if(req.method==='item/tool/requestUserInput'){if(p.threadId!==state.active?.id)return;upsertItem({id:`user-input-response-${req.id}`,type:'userInputResponse',requestId:req.id,questions:p.questions,completed:false},p.turnId);return;}if(!['item/commandExecution/requestApproval','item/fileChange/requestApproval','item/permissions/requestApproval'].includes(req.method)){void respondToCodex(req.id,null,{code:-32601,message:'Unsupported request'}).catch(error=>{if(!error?.silentTransportSwitch)toast(error.message)});return}const group=ensureActivity(p.turnId||'approval',$('#conversation'),p.itemId),model=buildApprovalModel(req),card=document.createElement('section');card.className='approval-card';card.dataset.codexApprovalSurface='';card.innerHTML=`<div class="approval-content"><div class="approval-identity">${approvalIcon(model.kind)}<span>${escapeHtml(model.identity)}</span></div><div class="approval-title">${escapeHtml(model.title)}</div>${model.subtitle?`<div class="approval-subtitle">${escapeHtml(shortPath(model.subtitle))}</div>`:''}${model.reason?`<div class="approval-reason"><span>Reason</span><p>${escapeHtml(model.reason)}</p></div>`:''}</div><div class="approval-body">${approvalBody(model,p)}</div><form class="approval-actions">${model.leading?`<button type="button" class="approval-leading">${escapeHtml(model.leading.label)}</button>`:''}<div class="approval-actions-main"><button type="button" class="approval-deny">${escapeHtml(model.deny.label)}</button>${model.scoped?`<div class="approval-split"><button type="submit" class="approval-primary" autofocus>${escapeHtml(model.primary.label)}</button><button type="button" class="approval-menu-toggle" aria-label="Approval options" aria-expanded="false">${codexIcon('chevronDown')}</button><div class="approval-menu" hidden><button type="button" class="approval-scoped">${escapeHtml(model.scoped.label)}</button></div></div>`:`<button type="submit" class="approval-primary" autofocus>${escapeHtml(model.primary.label)}</button>`}</div></form>`;group.after(card);state.requestCards.set(req.id,card);setApprovalWaiting(group,p.itemId,true);const answer=(decision)=>{setApprovalWaiting(group,p.itemId,decision!==model.deny.decision);card.querySelectorAll('button').forEach(b=>b.disabled=true);respondToCodex(req.id,model.kind==='permission'?decision:{decision}).catch(error=>{if(!error?.silentTransportSwitch)toast(error.message)});card.remove();state.requestCards.delete(req.id)};card.querySelector('form').onsubmit=e=>{e.preventDefault();answer(model.primary.decision)};card.querySelector('.approval-deny').onclick=()=>answer(model.deny.decision);card.querySelector('.approval-scoped')?.addEventListener('click',()=>answer(model.scoped.decision));card.querySelector('.approval-leading')?.addEventListener('click',()=>answer(model.leading.decision));card.querySelector('.approval-review-link')?.addEventListener('click',()=>openReviewPanel(diffForTurn(p.turnId)));const menuToggle=card.querySelector('.approval-menu-toggle'),menu=card.querySelector('.approval-menu');menuToggle?.addEventListener('click',()=>{const open=menu.hidden;menu.hidden=!open;menuToggle.setAttribute('aria-expanded',String(open))});scrollBottom()}
const slashCommandCatalog=[
  {id:'model',title:'Model',description:'Choose model and reasoning effort',icon:'wrench'},
  {id:'plan',title:'Plan mode',description:'Turn plan mode on',icon:'list'},
  {id:'project',title:'Project',description:'Choose project for new tasks',icon:'folderOpen'},
  {id:'reasoning',title:'Reasoning',description:'Choose reasoning effort',icon:'wrench'},
  {id:'init',title:'Init',description:'Create an AGENTS.md file with instructions for Codex',icon:'file'},
  {id:'mcp',title:'MCP',description:'Show MCP server status',icon:'wrench'},
  {id:'compact',title:'Compact',description:"Compact this task's context",icon:'list',requiresThread:true},
  {id:'status',title:'Status',description:'Show task id, context usage, and rate limits',icon:'info',requiresThread:true},
];
function closeComposerAutocomplete(){const menu=$('#composerAutocomplete');autocompleteState.requestId++;menu.hidden=true;menu.replaceChildren();delete menu.dataset.type;autocompleteState.match=null;autocompleteState.items=[];autocompleteState.selected=0;autocompleteState.message=''}
function renderComposerAutocomplete(){const menu=$('#composerAutocomplete'),items=autocompleteState.items;menu.innerHTML='';menu.dataset.type=autocompleteState.match?.type||'';menu.setAttribute('aria-label',autocompleteState.match?.type==='slash'?'Slash command menu':'Mention menu');if(!items.length){const empty=document.createElement('div');empty.className='autocomplete-empty';empty.textContent=autocompleteState.message||(autocompleteState.match?.type==='mention'?'Type to search for files':'No commands');menu.append(empty)}else for(const[index,item]of items.entries()){const button=document.createElement('button');button.type='button';button.className='autocomplete-item'+(index===autocompleteState.selected?' selected':'');button.dataset.autocompleteId=item.id;button.role='option';button.setAttribute('aria-selected',String(index===autocompleteState.selected));button.innerHTML=`${codexIcon(item.icon||'file')}<span class="autocomplete-copy"><strong class="autocomplete-title">${escapeHtml(item.title)}</strong><small class="autocomplete-description">${escapeHtml(item.description)}</small></span>`;button.onpointerdown=event=>event.preventDefault();button.onclick=()=>selectComposerAutocomplete(index);menu.append(button)}menu.hidden=false}
function currentComposerCwd(){if(state.projectless&&!state.active)return'';const path=state.active?.cwd||$('#projectPath').textContent||state.config.defaultCwd;return path.startsWith('~')?state.config.home+path.slice(1):path}
async function searchMentionSuggestions(match){const query=match.query.trim(),requestId=++autocompleteState.requestId;if(!query){autocompleteState.items=[];autocompleteState.message=state.projectless&&!state.active?'Choose a project to mention files':'Type to search for files';renderComposerAutocomplete();return}const tasks=state.threads.filter(thread=>titleOf(thread).toLowerCase().includes(query.toLowerCase())).slice(0,5).map(thread=>({id:`task:${thread.id}`,source:'task',threadId:thread.id,title:titleOf(thread),description:`Task · ${shortPath(thread.cwd)}`,icon:'messageSquare'})),cwd=currentComposerCwd();if(!cwd){autocompleteState.items=[{id:'choose-project',source:'action',title:'Choose project',description:'Select a project to mention files',icon:'folderOpen'},...tasks];autocompleteState.selected=0;autocompleteState.message='';renderComposerAutocomplete();return}autocompleteState.items=[];autocompleteState.message='Searching files…';renderComposerAutocomplete();try{const response=await fetch(`/api/files/search?cwd=${encodeURIComponent(cwd)}&query=${encodeURIComponent(query)}`,{cache:'no-store'}),data=await response.json();if(!response.ok)throw new Error(englishUiError(data.error)||'File search unavailable');if(requestId!==autocompleteState.requestId||autocompleteState.match?.type!=='mention'||autocompleteState.match.query!==match.query)return;const files=(data.items||[]).map(item=>{const parts=item.path.split('/');return{id:`${item.kind}:${item.path}`,source:item.kind,path:item.path,title:parts.at(-1),description:parts.length>1?parts.slice(0,-1).join('/'):(item.kind==='folder'?'Folder':'File'),icon:item.kind==='folder'?'folderOpen':'file'}});autocompleteState.items=[...files,...tasks];autocompleteState.selected=0;autocompleteState.message=autocompleteState.items.length?'':'No files or tasks found';renderComposerAutocomplete()}catch(error){if(requestId!==autocompleteState.requestId)return;autocompleteState.items=tasks;autocompleteState.message=tasks.length?'':error.message;renderComposerAutocomplete()}}
function updateComposerAutocomplete(){const input=$('#prompt'),match=getComposerAutocomplete(input.value,input.selectionStart??input.value.length);if(!match){closeComposerAutocomplete();return}autocompleteState.match=match;autocompleteState.selected=0;if(match.type==='slash'){autocompleteState.requestId++;const query=match.query.trim().toLowerCase();autocompleteState.items=slashCommandCatalog.filter(item=>(!item.requiresThread||state.active)&&(item.id.includes(query)||item.title.toLowerCase().includes(query)));autocompleteState.message='';renderComposerAutocomplete();return}searchMentionSuggestions(match)}
function moveComposerAutocomplete(delta){if(!autocompleteState.items.length)return;autocompleteState.selected=(autocompleteState.selected+delta+autocompleteState.items.length)%autocompleteState.items.length;renderComposerAutocomplete()}
function setPlanMode(active){state.planMode=Boolean(active);refreshComposerPlaceholder();syncPermissionControl()}
function applyAutocompleteToken(match,replacement){const input=$('#prompt'),result=applyComposerSuggestion(input.value,match,replacement);input.value=result.text;input.setSelectionRange(result.cursor,result.cursor);resizePrompt()}
function renderContextTray(){const tray=$('#composerContextTray');tray.innerHTML='';for(const mention of state.composerMentions){const chip=document.createElement('div');chip.className='composer-context-chip';chip.dataset.contextId=mention.id;chip.innerHTML=`${codexIcon(mention.icon||'file')}<span>${escapeHtml(mention.title)}</span><button type="button" aria-label="Remove ${escapeHtml(mention.title)}">${codexIcon('x')}</button>`;if(mention.attachmentType==='image'&&(mention.previewUrl||mention.path)){chip.classList.add('composer-image-chip');const image=document.createElement('img');image.src=mention.previewUrl||localImageUrl(mention.path);image.alt=mention.title;chip.prepend(image)}chip.querySelector('button').onclick=()=>{state.composerMentions.splice(state.composerMentions.indexOf(mention),1);if(mention.previewUrl)URL.revokeObjectURL(mention.previewUrl);renderContextTray();syncComposerSubmitState()};tray.append(chip)}tray.hidden=!state.composerMentions.length}
function selectComposerAutocomplete(index=autocompleteState.selected){const item=autocompleteState.items[index],match=autocompleteState.match;if(!item||!match)return;const id=item.id;if(item.source==='action'&&id==='choose-project'){closeComposerAutocomplete();openFolderPicker()}else if(item.source==='file'||item.source==='folder'){applyAutocompleteToken(match,`@${item.path}`);if(!state.composerMentions.some(mention=>mention.id===item.id))state.composerMentions.push({...item});renderContextTray();closeComposerAutocomplete()}else if(item.source==='task'){applyAutocompleteToken(match,`@${item.title}`);if(!state.composerMentions.some(mention=>mention.id===item.id))state.composerMentions.push({...item});renderContextTray();closeComposerAutocomplete()}else{if(id==='init')applyAutocompleteToken(match,'/init');closeComposerAutocomplete();if(id==='plan'){setPlanMode(!state.planMode);$('#prompt').value='';resizePrompt()}else if(id==='model'){ $('#prompt').value='';resizePrompt();openModelMenu()}else if(id==='reasoning'){ $('#prompt').value='';resizePrompt();openModelMenu()}else if(id==='project'){ $('#prompt').value='';resizePrompt();openFolderPicker()}else if(id==='mcp'){ $('#prompt').value='';resizePrompt();toast('MCP status requires the native desktop status surface.')}else if(id==='compact'){ $('#prompt').value='';resizePrompt();toast('Compact requires the native desktop command bridge.')}else if(id==='status'){ $('#prompt').value='';resizePrompt();toast(state.active?.id?`Task ${state.active.id}`:'No active task')}}requestAnimationFrame(()=>$('#prompt').focus())}
function handlePromptInput(){resizePrompt();updateComposerAutocomplete()}
function handlePromptKeydown(event){const open=!$('#composerAutocomplete').hidden;if(open){if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();moveComposerAutocomplete(event.key==='ArrowDown'?1:-1);return}if((event.key==='Enter'&&!event.shiftKey)||event.key==='Tab'){event.preventDefault();selectComposerAutocomplete();return}if(event.key==='Escape'){event.preventDefault();closeComposerAutocomplete();return}}if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();$('#composer').requestSubmit()}}
async function resumeActiveThread(){if(!state.active)return null;const threadId=state.active.id,resumed=await rpc('thread/resume',{threadId});if(state.active?.id===threadId){state.active={...state.active,...resumed.thread};renderHeader()}return resumed}
function renderQueuedMessages(messages){
  if(state.active)state.active.queue=messages;
  const threadId=state.active?.id,list=$('#queuedMessages');
  const editing=new Map([...list.children].filter(row=>row.dataset.editing==='true'&&row.dataset.threadId===threadId).map(row=>[row.dataset.messageId,row]));
  const rows=[];list.hidden=!messages.length;
  for(const message of messages){
    if(editing.has(message.id)){rows.push(editing.get(message.id));continue;}
    const row=document.createElement('div');row.className='queued-message';row.dataset.messageId=message.id;row.dataset.threadId=threadId;
    const label=document.createElement('span');if(message.text)label.dataset.i18nIgnore='';label.textContent=message.text||"Image attachment";label.title=englishUiError(message.pausedReason)||message.text||"Image attachment";row.append(label);
    for(const [action,title] of [['edit',"Edit"],['steer',"Steer now"],['remove',"Delete"]]){
      const button=document.createElement('button');button.type='button';button.textContent=title;
      button.onclick=async()=>{
        if(action==='edit'){
          row.dataset.editing='true';row.classList.add('editing');row.replaceChildren();
          const input=document.createElement('textarea');input.value=message.text||'';input.rows=3;input.setAttribute('aria-label',"Edit queued message");row.append(input);
          const save=document.createElement('button'),cancel=document.createElement('button');save.type=cancel.type='button';save.textContent="Save";cancel.textContent="Cancel";row.append(save,cancel);
          cancel.onclick=()=>{row.dataset.editing='false';renderQueuedMessages(state.active?.queue||[])};
          save.onclick=async()=>{
            save.disabled=true;cancel.disabled=true;
            try{
              const result=await rpc('host/thread/queue',{threadId,action:'edit',id:message.id,text:input.value,expectedText:message.text||''});
              row.dataset.editing='false';if(threadId===state.active?.id)renderQueuedMessages(result.messages);
            }catch(error){toast(error.message,5000);save.disabled=false;cancel.disabled=false;}
          };
          input.focus();input.setSelectionRange(input.value.length,input.value.length);return;
        }
        button.disabled=true;
        try{const result=await rpc('host/thread/queue',{threadId,action,id:message.id});if(threadId===state.active?.id)renderQueuedMessages(result.messages)}
        catch(error){toast(error.message,5000);button.disabled=false}
      };
      row.append(button);
    }
    rows.push(row);
  }
  // Preserve the focused editor during live queue updates.
  for(const child of [...list.children])if(!rows.includes(child))child.remove();
  rows.forEach((row,index)=>{if(list.children[index]!==row)list.insertBefore(row,list.children[index]||null)});
}

function closeAttachmentMenu(){$('#attachmentMenu').hidden=true;document.querySelector('[data-composer-control="add"]').setAttribute('aria-expanded','false')}
let availableComposerSkills=[];
function insertComposerContent(text){
  const prompt=$('#prompt'),start=prompt.selectionStart??prompt.value.length,end=prompt.selectionEnd??start;
  prompt.setRangeText(text,start,end,'end');closeAttachmentMenu();prompt.focus();handlePromptInput();syncComposerSubmitState();
}
function renderSkillChoices(){
  const query=$('#skillFilter').value.trim().toLowerCase(),list=$('#skillChoices');list.replaceChildren();
  for(const skill of availableComposerSkills.filter(skill=>(skill.name+' '+(skill.description||'')).toLowerCase().includes(query))){
    const button=document.createElement('button');button.type='button';const name=document.createElement('span');name.className='skill-name';name.textContent=skill.name;button.title=skill.name+(skill.description?' — '+skill.description:'');const description=document.createElement('small');description.textContent=skill.description||'';button.append(name,description);
    button.onclick=()=>insertComposerContent(`[$${skill.name}](${encodeURI(skill.path).replaceAll('(', '%28').replaceAll(')', '%29')}) `);list.append(button);
  }
  if(!list.childElementCount)list.textContent="No matching skills";
}
async function openComposerSkills(){
  $('#skillPicker').hidden=false;$('#skillChoices').textContent="Loading installed skills…";
  try{
    const cwd=currentComposerCwd()||state.config.defaultCwd,result=await rpc('skills/list',{cwds:[cwd]});
    availableComposerSkills=(result.data||[]).flatMap(entry=>entry.skills||[]).filter(skill=>skill.enabled!==false);
    renderSkillChoices();
  }catch(error){$('#skillChoices').textContent=error.message}
}
let attachmentsUploading=false;
function composerInput(text, mentions){
  const uploads=mentions.filter(item=>item.source==='upload');
  const files=uploads.filter(item=>item.attachmentType!=='image');
  const message=[text,files.length?"Attached files (uploaded by the user):\n"+files.map(file=>`${file.title}: ${file.path}`).join('\n'):''].filter(Boolean).join('\n\n');
  return [...(message?[{type:'text',text:message}]:[]),...uploads.filter(item=>item.attachmentType==='image').map(item=>({type:'localImage',path:item.path}))];
}
async function uploadAttachments(fileList){
  const files=[...fileList];if(!files.length)return;if(attachmentsUploading){toast("Attachments are uploading. Please wait before adding more.");return;}
  const mentions=state.composerMentions,button=document.querySelector('[data-composer-control="add"]');
  const refresh=()=>{if(state.composerMentions===mentions){renderContextTray();syncComposerSubmitState()}saveWorkspaceView()};
  attachmentsUploading=true;button.disabled=true;
  for(const file of files){
    if(file.size>25*1024*1024){toast(`${file.name} exceeds 25 MB`,5000);continue}
    const image=file.type.startsWith('image/')||/\.(?:avif|gif|jpe?g|png|webp)$/i.test(file.name);let previewUrl='';if(image)try{previewUrl=URL.createObjectURL(file)}catch{}
    const mention={id:`uploading-${Date.now()}-${Math.random()}`,title:file.webkitRelativePath||file.name,path:'',source:'uploading',attachmentType:image?'image':'file',icon:image?'image':'file',previewUrl};mentions.push(mention);refresh();
    try{
    button.title=`Uploading ${file.name}`;
    const response=await fetch(`/api/attachments?name=${encodeURIComponent(file.name)}`,{method:'POST',headers:{'content-type':'application/octet-stream'},body:file});
    const data=await response.json();if(!response.ok)throw new Error(englishUiError(data.error)||"Upload failed");
    mention.id=data.path;mention.title=file.webkitRelativePath||data.filename;mention.path=data.path;mention.source='upload';mention.attachmentType=data.kind;mention.icon=data.kind==='image'?'image':'file';const preview=mention.previewUrl;delete mention.previewUrl;refresh();if(preview)URL.revokeObjectURL(preview);
    }catch(error){const index=mentions.indexOf(mention);if(index>=0)mentions.splice(index,1);if(mention.previewUrl)URL.revokeObjectURL(mention.previewUrl);refresh();toast(error.message,5000)}
  }
  attachmentsUploading=false;button.disabled=false;button.title="Add files or photos";
}
let submittingPrompt=false;const pendingSubmissions=new Map();
async function submitPrompt(event){
  event.preventDefault();if(state.active?.importJob||submittingPrompt)return;
  if(attachmentsUploading){toast("Attachments are uploading");return}
  closeComposerAutocomplete();closePermissionMenu();
  const input=$('#prompt'),text=input.value.trim(),turnId=activeTurnId(),mentions=state.composerMentions,inputItems=composerInput(text,mentions);
  if(!text&&!mentions.some(item=>item.source==='upload')){if(turnId&&state.active)await rpc('turn/interrupt',{threadId:state.active.id,turnId});return}
  if(!state.bridgeInstanceId){toast("Connection is not ready. Please try sending shortly.");return}
  const signature=JSON.stringify(inputItems),threadId=state.active?.id||null;
  let optimisticId,draftKey=composerDraftKey;const draftGeneration=composerDraftGeneration,draftText=input.value;submittingPrompt=true;
  try{
    const pendingSubmission=pendingSubmissions.get(draftKey);
    const submission=pendingSubmission?.signature===signature&&pendingSubmission.threadId===threadId?pendingSubmission:{id:createRequestId(),instanceId:state.bridgeInstanceId,issuedAt:state.bridgeIssuedAt,signature,threadId};
    pendingSubmissions.set(draftKey,submission);submission.attempts=(submission.attempts||0)+1;const queueRevision=queueEventRevision;
    const send=(stage,method,params)=>rpc(method,params,{id:`${submission.id}:${stage}`,instanceId:submission.instanceId,issuedAt:submission.issuedAt});
    input.value='';state.composerMentions=[];renderContextTray();resizePrompt();saveComposerDraft();
    // Retry the original operation even if its first attempt already changed the running state.
    if(submission.method||turnId){
      submission.method??='host/thread/queue';submission.params??={threadId,action:'add',id:submission.id,input:inputItems};
      const result=await send('send',submission.method,submission.params);
      if(submission.method==='host/thread/queue'&&state.active?.id===threadId&&queueRevision===queueEventRevision&&submission.attempts===1)renderQueuedMessages(result.messages);
    }else{
      if(!state.active){
        const startingProjectless=state.projectless,cwd=$('#projectPath').textContent.replace(/^~/,state.config.home);
        submission.startParams??={cwd,model:state.selectedModel,...permissionThreadPolicy(),sessionStartSource:'startup'};
        const res=await send('thread','thread/start',submission.startParams);
        pendingSubmissions.delete(draftKey);draftKey=res.thread.id;submission.threadId=res.thread.id;pendingSubmissions.set(draftKey,submission);
        if(state.active||composerDraftGeneration!==draftGeneration)throw new Error("Conversation changed. Confirm sending in the original conversation.");
        const draft=saveComposerDraft();composerDrafts.delete(composerDraftKey);composerDraftKey=draftKey;if(draft)composerDrafts.set(draftKey,draft);
        state.active={...res.thread,projectless:startingProjectless};submission.threadId=res.thread.id;rememberActiveThread(state.active.id);state.threads.unshift(state.active);renderContextUsage();renderHeader();renderThreads();$('#conversation').innerHTML='';
      }else if(state.active.canAcceptDirectInput!==true)await resumeActiveThread();
      if(state.active?.id!==submission.threadId)throw new Error("Conversation changed. Confirm sending in the original conversation.");
      const optimistic={id:`local-${submission.id}`,type:'userMessage',content:inputItems};optimisticId=optimistic.id;upsertItem(optimistic,'optimistic');
      submission.method='turn/start';submission.params={threadId:state.active.id,input:inputItems,model:state.selectedModel,effort:$('#effortSelect').value,cwd:state.active.cwd,...permissionTurnPolicy(state.active.cwd)};
      await send('send',submission.method,submission.params);
    }
    pendingSubmissions.delete(draftKey);
  }catch(error){
    if(optimisticId){state.items.get(optimisticId)?.remove();state.items.delete(optimisticId)}
    restoreFailedDraft(draftKey,draftText,mentions);
    if(!error.retryable&&error.code!=='request_outcome_unknown')pendingSubmissions.delete(draftKey);else historySyncNeeded=true;
    toast(error.retryable?"Send receipt not received. Syncing; resending will check the same request.":t(threadInputErrorMessage(error)),5200);
  }finally{submittingPrompt=false;scheduleActiveThreadSync(0)}
}
function threadSummarySignature(threads,projects){return JSON.stringify([projects,threads.map(thread=>[thread.id,thread.name,thread.preview,thread.cwd,thread.projectId,thread.projectName,thread.projectPath,thread.updatedAt,thread.recencyAt,thread.status,thread.projectless,thread.pinned])])}
function applyThreadSummaries(threads,projects=state.projects){const nextSignature=threadSummarySignature(threads,projects),changed=nextSignature!==threadListSignature;threadListSignature=nextSignature;state.projects=projects;state.threads=threads;const summary=state.active&&threads.find(thread=>thread.id===state.active.id);if(summary){const turns=state.active.turns,wasActive=state.active.status?.type==='active';state.active={...state.active,...summary,turns};if(!wasActive&&summary.status?.type==='active')scheduleActiveThreadSync(0)}if(changed){const expanded=projects?.find(project=>project.roots.includes(expandedSidebarProject));if(expanded)expandedSidebarProject=expanded.id;renderThreads();if(summary)renderHeader();if(!$('#composerProjectMenu').hidden)renderComposerProjects();void writeCache('projects',projects);void writeCache('threads',threads.map(thread=>({...cacheableThread(thread),turns:undefined,olderTurnsCursor:undefined})))}}
function scheduleThreadListRefresh(){void refreshThreadList()}
async function refreshThreadList(){if(threadListInFlight){threadListRefreshQueued=true;return}threadListInFlight=true;threadListRefreshQueued=false;try{const result=await rpc('thread/list',{limit:50,sortKey:'recency_at',sortDirection:'desc'});if(!threadListRefreshQueued)applyThreadSummaries(result.data||[],result.projects)}catch{}finally{threadListInFlight=false;if(threadListRefreshQueued)void refreshThreadList()}}
function refreshThreadsSoon(){void refreshThreadList()}
function resetActiveThreadSync(){activeThreadSyncGeneration++;activeThreadSyncInFlight=null;clearTimeout(activeThreadSyncTimer);activeThreadSyncTimer=null;activeThreadSyncSignature='';activeThreadSyncRevision=''}
function scheduleActiveThreadSync(delay=ACTIVE_THREAD_SYNC_IDLE_MS){clearTimeout(activeThreadSyncTimer);if(!state.active)return;activeThreadSyncTimer=setTimeout(syncActiveThread,document.visibilityState==='hidden'?Math.max(delay,6000):delay)}
async function latestThreadTurn(threadId,generation,revision){
  const current=()=>threadId===state.active?.id&&generation===activeThreadSyncGeneration;
  const live=await rpc('host/thread/live',{threadId,revision:activeThreadSyncRevision});
  if(!current())return null;
  if(live?.unchanged)return live;
  if(revision===activeThreadEventRevision){
    for(const req of live?.userInputRequests||[])onServerRequest(req);
    if(live?.source==='desktop'){applyDesktopSettings(live.settings,threadId);renderQueuedMessages(live.queue||[])}
  }
  if(live?.turn)return {...live,turn:protectTurnSnapshot(live.turn,revision)};
  const result=await rpc('thread/turns/list',{threadId,limit:1,sortDirection:'desc',itemsView:'full'});
  return current()?{...live,turn:result.data?.[0]?protectTurnSnapshot(result.data[0],revision):null}:null;
}
function activeTurnId(){return $('#sendButton')?.dataset.turnId||''}
function syncComposerSubmitState(){const button=$('#sendButton');if(!button)return;const mode=activeTurnId()?($('#prompt').value.trim()||state.composerMentions.some(item=>item.source==='upload')?'queue':'stop'):'send',label=mode==='stop'?'Stop':mode==='queue'?"Add to queue":'Send message';button.dataset.submitMode=mode;button.classList.toggle('stop',mode==='stop');button.classList.toggle('steer',mode==='steer');button.innerHTML=codexIcon(mode==='stop'?'square':'arrowUp');button.title=t(label);button.setAttribute('aria-label',t(label))}
function setActiveTurnId(turnId=''){const button=$('#sendButton');if(!button)return;button.dataset.turnId=turnId||'';syncComposerSubmitState()}
function syncTurnRuntime(turn){const active=turn?.status==='inProgress';const summary=state.threads.find(thread=>thread.id===state.active?.id);if(summary&&(summary.status?.type==='active')!==active){summary.status={type:active?'active':'idle'};renderThreads();}if(active)setActiveTurnId(turn.id);else if(activeTurnId()===turn?.id)setActiveTurnId('')}
function syncTurnSnapshot(turn,threadId=state.active?.id,authoritative=false){if(!turn||!threadId||threadId!==state.active?.id)return false;const timeline=state.turns.get(turn.id);if(!authoritative&&turn.status==='inProgress'&&timeline&&timeline.dataset.status!=='inProgress')return false;const root=$('#conversation'),nearBottom=root.scrollHeight-root.scrollTop-root.clientHeight<80,turns=state.active.turns||[],index=turns.findIndex(existing=>existing.id===turn.id);turn={...turn,items:mergeTurnItems(timeline?[...timeline.timelineItems.values()]:turns[index]?.items,turn.items)};if(index<0)turns.push(turn);else turns[index]=turn;state.active.turns=turns;root.querySelectorAll('.conversation-loading').forEach(node=>node.remove());renderTurn(turn,root);syncTurnRuntime(turn);scheduleConversationCache();if(nearBottom)scrollBottom();return true}
async function syncActiveThread(){
  if(activeThreadSyncInFlight||!state.active||!state.connected){scheduleActiveThreadSync();return}
  const generation=activeThreadSyncGeneration,threadId=state.active.id,operation={};activeThreadSyncInFlight=operation;
  let nextDelay=ACTIVE_THREAD_SYNC_IDLE_MS;
  try{
    if(historySyncNeeded){if(await openThread(threadId)&&threadId===state.active?.id)historySyncNeeded=false;return}
    const revision=activeThreadEventRevision,live=await latestThreadTurn(threadId,generation,revision),turn=live?.turn;
    if(generation!==activeThreadSyncGeneration||threadId!==state.active?.id)return;
    if(turn){const signature=JSON.stringify(turn);if(signature!==activeThreadSyncSignature){syncTurnSnapshot(turn,threadId,true);activeThreadSyncSignature=signature}}
    activeThreadSyncRevision=revision===activeThreadEventRevision?live?.revision||'':'';
    // Desktop pushes changes immediately; this read only repairs missed events.
    nextDelay=live?.source==='desktop'?5000:(live?.active||turn?.status==='inProgress')?ACTIVE_THREAD_SYNC_ACTIVE_MS:ACTIVE_THREAD_SYNC_IDLE_MS;
  }catch{}finally{
    if(activeThreadSyncInFlight===operation)activeThreadSyncInFlight=null;
    if(threadId===state.active?.id&&!activeThreadSyncInFlight)scheduleActiveThreadSync(nextDelay);
  }
}
function resizePrompt(){const e=$('#prompt');e.style.height='auto';e.style.height=Math.min(190,e.scrollHeight)+'px';syncComposerSubmitState()}
let conversationFollowsBottom=true,conversationScrollTop=0,conversationTouchY=null;
function updateScrollToBottomButton(){
  const root=$('#conversation');
  $('#scrollToBottomButton').hidden=root.scrollHeight-root.scrollTop-root.clientHeight<80;
}
$('#scrollToBottomButton').onclick=scrollOpenedThreadToBottom;
new ResizeObserver(updateScrollToBottomButton).observe($('#conversation'));
$('#conversation').addEventListener('scroll',()=>{
  const root=$('#conversation'),top=root.scrollTop;
  if(top!==conversationScrollTop){conversationFollowsBottom=top>conversationScrollTop&&root.scrollHeight-top-root.clientHeight<80;conversationScrollTop=top;}
  updateScrollToBottomButton();
},{passive:true});
$('#conversation').addEventListener('wheel',event=>{if(event.deltaY<0)conversationFollowsBottom=false;},{passive:true});
$('#conversation').addEventListener('touchstart',event=>{conversationTouchY=event.touches[0]?.clientY??null;},{passive:true});
$('#conversation').addEventListener('touchmove',event=>{
  const y=event.touches[0]?.clientY;
  if(y!=null&&conversationTouchY!=null&&y>conversationTouchY)conversationFollowsBottom=false;
  conversationTouchY=y??null;
},{passive:true});
function scrollBottom(){
  updateScrollToBottomButton();
  if(!conversationFollowsBottom)return;
  const root=$('#conversation'),top=root.scrollTop,threadId=state.active?.id;
  requestAnimationFrame(()=>{
    if(!conversationFollowsBottom||state.active?.id!==threadId||root.scrollTop<top)return;
    root.scrollTop=root.scrollHeight;conversationScrollTop=root.scrollTop;
    updateScrollToBottomButton();
  });
}
function scrollOpenedThreadToBottom(){
  conversationFollowsBottom=true;conversationScrollTop=$('#conversation').scrollTop;
  const threadId=state.active?.id;
  scrollBottom();requestAnimationFrame(()=>{if(state.active?.id===threadId)scrollBottom();});
}
function formatAge(ts){const s=Math.max(0,Date.now()/1000-ts);if(s<60)return'now';if(s<3600)return Math.floor(s/60)+'m';if(s<86400)return Math.floor(s/3600)+'h';return new Date(ts*1000).toLocaleDateString(i18n.locale,{month:'short',day:'numeric'})}
function escapeHtml(v=''){return String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function toast(text,duration=2200){const e=$('#toast');e.textContent=englishUiError(text);e.classList.add('show');clearTimeout(toast.t);toast.t=setTimeout(()=>e.classList.remove('show'),duration)}
function syncSummaryPanel(){const workspace=state.projectless?'No project':($('#projectName').textContent||'Local workspace');$('#summaryWorkspace').textContent=workspace;$('#summaryBranch').textContent=state.projectless?'':state.active?.source==='remote'?'Remote workspace':'Local workspace'}
let rightPanelWidth=null;
function layoutRightPanels(){
  const open=!$('#sidePanel').hidden||!$('#summaryPanel').hidden;
  const left=mobileSidebarEnabled()||document.body.classList.contains('sidebar-hidden')?0:$('#sidebar').getBoundingClientRect().width;
  const available=innerWidth-left,width=Math.min(Math.max(240,rightPanelWidth??(available<600?340:Math.min(340,available*.38))),innerWidth-48);
  const reserved=open&&available>=600?Math.min(width,Math.max(0,available-360)):0;
  document.body.style.setProperty('--right-panel-w',reserved+'px');
  document.body.style.setProperty('--right-panel-size',width+'px');
  document.body.classList.toggle('right-panel-overlay',open&&width>reserved);
  $('#panelBackdrop').hidden=!(open&&width>reserved);
  for(const panel of [$('#sidePanel'),$('#summaryPanel')]){
    panel.setAttribute('aria-modal','false');
    const handle=panel.querySelector('.panel-resizer');handle.setAttribute('aria-valuenow',Math.round(width));handle.setAttribute('aria-valuemin','240');handle.setAttribute('aria-valuemax',innerWidth-48);
  }
  requestAnimationFrame(positionNativeBrowser);
}
function overlayPanelsEnabled(){return document.body.classList.contains('right-panel-overlay')}
function setOverlayBackgroundInert(){for(const selector of ['.topbar','.sidebar','.conversation-shell','.bottom-panel']){const node=$(selector);if(node)node.inert=false}layoutRightPanels()}
function focusPanel(){setOverlayBackgroundInert()}
function restorePanelFocus(panel,target){setOverlayBackgroundInert()}
function syncOverlayPanelMode(){setOverlayBackgroundInert();renderChanges()}
function bindPanelResizers(){
  for(const handle of document.querySelectorAll('.panel-resizer')){
    handle.onpointerdown=event=>{
      if(event.button!==0)return;event.preventDefault();handle.setPointerCapture(event.pointerId);
      const startX=event.clientX,startWidth=handle.parentElement.getBoundingClientRect().width;
      handle.onpointermove=move=>{if(!handle.hasPointerCapture(move.pointerId))return;rightPanelWidth=Math.min(innerWidth-48,Math.max(240,startWidth+startX-move.clientX));layoutRightPanels()};
      handle.onpointerup=handle.onpointercancel=up=>{if(handle.hasPointerCapture(up.pointerId))handle.releasePointerCapture(up.pointerId);handle.onpointermove=null};
    };
    handle.onkeydown=event=>{if(!['ArrowLeft','ArrowRight'].includes(event.key))return;event.preventDefault();rightPanelWidth=handle.parentElement.getBoundingClientRect().width+(event.key==='ArrowLeft'?20:-20);layoutRightPanels()};
  }
}
function setSidebarOpen(open){const sidebar=$('#sidebar'),mobile=mobileSidebarEnabled();document.body.classList.toggle('sidebar-hidden',!mobile&&!open);sidebar.classList.toggle('mobile-open',mobile&&open);const visible=mobile?sidebar.classList.contains('mobile-open'):!document.body.classList.contains('sidebar-hidden');$('#toggleSidebar').setAttribute('aria-expanded',String(visible));$('#toggleSidebar').setAttribute('aria-pressed',String(visible));layoutRightPanels()}
function syncSidebarLayout(){const mobile=mobileSidebarEnabled();if(mobile===sidebarLayoutMobile)return;sidebarLayoutMobile=mobile;setSidebarOpen(!mobile)}
function setBrowserStatus(text,tone='ready'){const status=$('#browserStatus');status.dataset.tone=tone;$('#browserStatusText').textContent=text}
const nativeBrowser=()=>globalThis.CodexBrowser||null;
function downloadLinkInAndroid(event){
  const link=event.target instanceof Element?event.target.closest('a[href]'):null,bridge=nativeBrowser();
  if(!link||typeof bridge?.download!=='function')return;
  const url=new URL(link.href,location.href);
  if(!link.hasAttribute('download')&&!link.hasAttribute('data-file-download')&&url.pathname!=='/api/files/download')return;
  if(!/^https?:$/.test(url.protocol))return;
  const filename=link.getAttribute('download')||url.searchParams.get('path')?.split(/[\\/]/).pop()||'';
  try{if(bridge.download(url.href,filename))event.preventDefault()}
  catch(error){event.preventDefault();toast("Could not open the save dialog:"+error.message,6000)}
}
document.addEventListener('click',downloadLinkInAndroid,true);
let nativeBrowserState={back:false,forward:false};
function positionNativeBrowser(){const bridge=nativeBrowser(),shell=$('#browserFrameShell');if(!bridge||$('#sidePanel').hidden||$('#browserPanel').hidden){bridge?.hide();return}const rect=shell.getBoundingClientRect(),scale=devicePixelRatio||1;bridge.resize(Math.round(rect.left*scale),Math.round(rect.top*scale),Math.round(rect.width*scale),Math.round(rect.height*scale))}
function updateBrowserControls(){const current=browserState.history[browserState.index]||'',native=Boolean(nativeBrowser());$('#browserBack').disabled=native?!nativeBrowserState.back:browserState.index<=0;$('#browserForward').disabled=native?!nativeBrowserState.forward:browserState.index<0||browserState.index>=browserState.history.length-1;$('#browserRefresh').disabled=!current;for(const link of [$('#browserOpenExternal'),$('#browserNoticeExternal')]){link.hidden=native||!current;if(current)link.href=browserFrameUrl(current)}}
function showBrowserNotice(title,description){$('#browserNoticeTitle').textContent=title;$('#browserNoticeDescription').textContent=englishUiError(description);$('#browserNotice').hidden=false;$('#browserLoading').hidden=true;$('#browserFrameShell').setAttribute('aria-busy','false');setBrowserStatus(title,'error')}
function localizeBrowserError(){
  try{const page=$('#browserFrame').contentDocument,source=page?.querySelector('meta[name="codex-browser-error"]')?.content;
    if(source){const message=englishUiError(source),copy=page.querySelector('p');if(copy)copy.textContent=t(message);page.documentElement.lang=i18n.locale;return message;}
  }catch{}return '';
}
function finishBrowserLoad(requestId){if(requestId!==browserState.loadRequest)return;clearTimeout(browserState.loadTimer);const error=localizeBrowserError();if(error){showBrowserNotice('Page could not be loaded',error);return}$('#browserLoading').hidden=true;$('#browserNotice').hidden=true;$('#browserFrameShell').setAttribute('aria-busy','false');setBrowserStatus('Loaded through Ubuntu','loaded')}
window.addEventListener('message',event=>{if(event.source===$('#browserFrame').contentWindow&&event.origin===location.origin&&event.data?.type==='codex-browser-ready')finishBrowserLoad(browserState.loadRequest)});
function navigateBrowser(value,{push=true}={}){const result=normalizeBrowserUrl(value);if(result.error){showBrowserNotice('Invalid address',result.error);$('#browserUrl').setAttribute('aria-invalid','true');return false}const url=result.url,frameUrl=browserFrameUrl(url);$('#browserUrl').removeAttribute('aria-invalid');$('#browserUrl').value=url;if(push&&browserState.history[browserState.index]!==url){browserState.history=browserState.history.slice(0,browserState.index+1);browserState.history.push(url);browserState.index=browserState.history.length-1}const requestId=++browserState.loadRequest,frame=$('#browserFrame'),bridge=nativeBrowser();clearTimeout(browserState.loadTimer);$('#browserEmpty').hidden=true;$('#browserNotice').hidden=true;$('#browserLoading').hidden=false;$('#browserFrameShell').setAttribute('aria-busy','true');setBrowserStatus('Loading through Ubuntu...','loading');updateBrowserControls();if(bridge){frame.hidden=true;requestAnimationFrame(()=>{positionNativeBrowser();bridge.show(url)});return true}frame.hidden=false;frame.setAttribute('sandbox',browserSandbox());frame.onload=()=>finishBrowserLoad(requestId);frame.onerror=()=>requestId===browserState.loadRequest&&showBrowserNotice('Page could not be loaded','Ubuntu could not load this address.');frame.src=frameUrl;browserState.loadTimer=setTimeout(()=>{if(requestId===browserState.loadRequest)showBrowserNotice('Page did not finish loading','The proxied page did not complete its request.')},15000);return true}
globalThis.__codexNativeBrowserState=(url,canGoBack,canGoForward,status,error='')=>{nativeBrowserState={back:Boolean(canGoBack),forward:Boolean(canGoForward)};if(url){$('#browserUrl').value=url;if(browserState.index>=0)browserState.history[browserState.index]=url}if(status==='loading'){$('#browserLoading').hidden=false;setBrowserStatus('Loading through Ubuntu...','loading')}else if(status==='error')showBrowserNotice('Page could not be loaded',error||'The page failed to load.');else{$('#browserLoading').hidden=true;$('#browserNotice').hidden=true;$('#browserFrameShell').setAttribute('aria-busy','false');setBrowserStatus('Loaded through Ubuntu','loaded')}updateBrowserControls()};
function moveBrowserHistory(delta){const next=browserState.index+delta;if(next<0||next>=browserState.history.length)return;browserState.index=next;navigateBrowser(browserState.history[next],{push:false});updateBrowserControls()}
function openBrowserPanel(){const tab=$('#utilityTab');tab.textContent='Browser';tab.dataset.sidePanelTab='browser';tab.hidden=false;setSidePanelOpen(true,false);setSidePanelView('browser','Browser');updateBrowserControls();if(browserState.index<0&&!overlayPanelsEnabled())requestAnimationFrame(()=>$('#browserUrl').focus())}
function setSidePanelView(view,title){const launcher=view==='launcher',review=view==='review',utility=view==='utility',browser=view==='browser',terminal=view==='terminal',sideTask=view==='side-task';$('#sidePanelLauncher').hidden=!launcher;$('#reviewPanelContent').hidden=!review;$('#browserPanel').hidden=!browser;$('#sideTerminalPanel').hidden=!terminal;$('#sideTaskPanel').hidden=!sideTask;$('#utilityPanelContent').hidden=!utility;for(const tab of document.querySelectorAll('.side-panel-tab')){const selected=tab.dataset.sidePanelTab===view;tab.classList.toggle('active',selected);tab.setAttribute('aria-selected',String(selected))}if(launcher)$('#newTab').hidden=false;if(review)$('#reviewTab').hidden=false;if(utility||browser||terminal||sideTask)$('#utilityTab').hidden=false;$('#sidePanelTitle').textContent=title||(launcher?'New tab':review?'Review':$('#utilityTab').textContent);renderChanges();if(browser)requestAnimationFrame(positionNativeBrowser);else nativeBrowser()?.hide();if(terminal)requestAnimationFrame(()=>{initializeTerminal(terminalStates.side);fitTerminal(terminalStates.side);terminalStates.side.term?.focus()});if(sideTask)renderSideTasks();if(overlayPanelsEnabled()&&document.body.classList.contains('side-panel-open'))requestAnimationFrame(()=>$('#closeSidePanel').focus())}
function closeSidePanelTab(id){
  const tab=document.getElementById(id);
  if(!tab||tab.hidden)return;
  const selected=tab.classList.contains('active');
  tab.hidden=true;tab.classList.remove('active');tab.setAttribute('aria-selected','false');
  if(selected){
    const next=[...document.querySelectorAll('.side-panel-tab')].find(item=>!item.hidden);
    if(next){setSidePanelView(next.dataset.sidePanelTab,next.textContent);next.focus()}
    else setSidePanelOpen(false,false);
  }else document.querySelector('.side-panel-tab.active')?.focus();
}
function openReviewPanel(review=null){state.activeReview=review||[...state.turnDiffs.values()].at(-1)||state.activeReview;setSidePanelOpen(true,false);setSidePanelView('review','Review')}
let fileViewRequest=0,fileWorkspaceView=null;
function showFilesPanel(){
  if(mobileSidebarEnabled())setSidebarOpen(false);
  const tab=$('#utilityTab');tab.textContent="Files";tab.dataset.sidePanelTab='utility';
  setSidePanelOpen(true,false);setSidePanelView('utility',"Files");
}
async function openFiles(path=state.active?.cwd||state.config.defaultCwd){
  fileWorkspaceView={kind:'directory',path,cwd:state.active?.cwd||state.config.defaultCwd};
  const requestId=++fileViewRequest;showFilesPanel();
  const body=$('#filePanelBody');body.textContent="Loading directory…";$('#fileDownload').hidden=true;
  try{
    const response=await fetch(`/api/files/list?${new URLSearchParams({path,cwd:state.active?.cwd||state.config.defaultCwd})}`),data=await response.json();
    if(requestId!==fileViewRequest)return;if(!response.ok)throw new Error(data.error);
    $('#filePanelPath').textContent=data.path;$('#filePanelBack').disabled=!data.parent;$('#filePanelBack').onclick=()=>openFiles(data.parent);
    body.replaceChildren();
    for(const entry of data.entries){const button=document.createElement('button');button.type='button';button.className='file-browser-entry';button.innerHTML=codexIcon(entry.directory?'folderOpen':'file')+'<span>'+escapeHtml(entry.name)+'</span>';button.onclick=()=>entry.directory?openFiles(entry.path):openFilePreview(entry.path);body.append(button)}
    if(!data.entries.length)body.textContent="This directory is empty";
  }catch(error){if(requestId===fileViewRequest)body.textContent=error.message}
}
async function openFilePreview(path,cwd=state.active?.cwd||state.config.defaultCwd){
  fileWorkspaceView={kind:'file',path,cwd};
  const requestId=++fileViewRequest;showFilesPanel();
  const body=$('#filePanelBody');body.textContent="Loading file…";$('#fileDownload').hidden=true;
  try{
    const response=await fetch(`/api/files/preview?${new URLSearchParams({path,cwd})}`),data=await response.json();
    if(requestId!==fileViewRequest)return;if(!response.ok)throw new Error(data.error);
    $('#filePanelPath').textContent=data.path;$('#filePanelBack').disabled=false;$('#filePanelBack').onclick=()=>openFiles(data.parent);
    const download=$('#fileDownload');download.href=localDownloadUrl(data.path,cwd);download.download=data.filename;download.hidden=false;
    body.replaceChildren();
    if(data.kind==='document'){
      const pages=document.createElement('div');pages.className='file-preview-document';
      for(let page=1;page<=data.pages;page++){
        const figure=document.createElement('figure'),image=document.createElement('img'),caption=document.createElement('figcaption');
        const source=`/api/files/document-page?${new URLSearchParams({path:data.path,cwd,page:String(page),v:data.version})}`;
        const button=document.createElement('button');button.type='button';button.dataset.imageSrc=source;button.dataset.imageTitle=`${data.filename} · ${page} / ${data.pages}`;button.setAttribute('aria-label',`Enlarge page ${page}`);
        image.src=source;image.alt=`${data.filename} · Page ${page}`;image.loading=page===1?'eager':'lazy';image.decoding='async';image.width=Math.round(data.width);image.height=Math.round(data.height);
        image.onerror=()=>{caption.textContent=`Page ${page} failed to load. Click to retry.`;button.onclick=event=>{event.preventDefault();event.stopPropagation();image.src=source;caption.textContent=`${page} / ${data.pages}`}};
        image.onload=()=>{button.onclick=null};caption.textContent=`${page} / ${data.pages}`;
        button.append(image);figure.append(button,caption);pages.append(figure);
      }
      body.append(pages);
    }
    else if(data.kind==='html'){const content=document.createElement('iframe');content.className='file-preview-html';content.title=data.filename;content.setAttribute('sandbox','allow-forms allow-modals allow-popups allow-scripts');content.srcdoc=data.text;body.append(content)}
    else if(data.kind==='markdown'){const content=document.createElement('article');content.className='message-text file-preview-markdown';content.innerHTML=renderAssistantMarkdown(data.text,{cwd:data.parent});body.append(content)}
    else if(data.kind==='text'){const content=document.createElement('pre');content.className='file-preview-text';content.textContent=data.text;body.append(content)}
    else if(data.kind==='image'){const image=document.createElement('img');image.className='file-preview-image';image.alt=data.filename;image.src=localImageUrl(data.path,cwd);body.append(image)}
    else body.textContent=englishUiError(data.reason);
  }catch(error){if(requestId===fileViewRequest)body.textContent=error.message}
}
function openUtilityPanel(kind){if(kind==='browser'){openBrowserPanel();return}const tab=$('#utilityTab');if(kind==='terminal'){tab.textContent='Terminal';tab.dataset.sidePanelTab='terminal';setSidePanelOpen(true,false);setSidePanelView('terminal','Terminal');return}if(kind==='side-task'){tab.textContent='Side tasks';tab.dataset.sidePanelTab='side-task';setSidePanelOpen(true,false);setSidePanelView('side-task','Side tasks');return}if(kind==='files')void openFiles()}
function setSidePanelOpen(open,reset=true){const panel=$('#sidePanel'),trigger=$('#toggleSidePanel'),wasOpen=!panel.hidden;if(open){setSummaryPanelOpen(false);if(!wasOpen){sidePanelReturnFocus=document.activeElement instanceof HTMLElement?document.activeElement:trigger;panel.hidden=false;document.body.classList.add('side-panel-open');trigger.setAttribute('aria-pressed','true');trigger.setAttribute('aria-expanded','true')}if(reset)setSidePanelView('launcher','New tab');if(!wasOpen)focusPanel(panel,$('#closeSidePanel'))}else{nativeBrowser()?.hide();panel.hidden=true;document.body.classList.remove('side-panel-open','review-split-open');trigger.setAttribute('aria-pressed','false');trigger.setAttribute('aria-expanded','false');restorePanelFocus(panel,sidePanelReturnFocus);sidePanelReturnFocus=null}}
function setSummaryPanelOpen(open){const panel=$('#summaryPanel'),trigger=$('#toggleSummaryPanel');if(open){setSidePanelOpen(false,false);summaryPanelReturnFocus=document.activeElement instanceof HTMLElement?document.activeElement:trigger;panel.hidden=false;document.body.classList.add('summary-panel-open');trigger.setAttribute('aria-pressed','true');trigger.setAttribute('aria-expanded','true');syncSummaryPanel();focusPanel(panel,$('#closeSummaryPanel'))}else{panel.hidden=true;document.body.classList.remove('summary-panel-open');trigger.setAttribute('aria-pressed','false');trigger.setAttribute('aria-expanded','false');restorePanelFocus(panel,summaryPanelReturnFocus);summaryPanelReturnFocus=null}}
function closeImageViewer(){const dialog=$('#imageViewer');if(dialog.open)dialog.close()}
function openImageViewer(source,title='Image',path=''){const dialog=$('#imageViewer'),image=$('#imageViewerImage');imageViewerReturnFocus=document.activeElement instanceof HTMLElement?document.activeElement:null;$('#imageViewerTitle').textContent=title||'Image';$('#imageViewerPath').textContent=path||title||'';$('#imageViewerError').hidden=true;image.hidden=false;image.alt=title||'';image.src=source;$('#imageViewerOriginal').href=source;if(!dialog.open)dialog.showModal();requestAnimationFrame(()=>$('#closeImageViewer').focus())}
function currentTerminalCwd(){const path=state.active?.cwd||localStorage.getItem('codex-webui-project')||state.config.defaultCwd||$('#projectPath').textContent||'.';return path.startsWith('~')?state.config.home+path.slice(1):path}
function terminalIsVisible(terminalState){const host=$(`#${terminalState.hostId}`),panel=$(`#${terminalState.panelId}`);return Boolean(host&&panel&&!host.closest('[hidden]'))}
function fitTerminal(terminalState){const host=$(`#${terminalState.hostId}`);if(!terminalState.fit||!terminalIsVisible(terminalState)||host.clientWidth<1||host.clientHeight<1)return;try{terminalState.fit.fit()}catch{}}
function sendTerminalResize(terminalState){const ws=terminalState.ws,term=terminalState.term;if(ws?.readyState===WebSocket.OPEN&&term)ws.send(JSON.stringify({type:'resize',cols:term.cols,rows:term.rows}))}
function connectTerminal(terminalState){if(terminalState.ws&&[WebSocket.OPEN,WebSocket.CONNECTING].includes(terminalState.ws.readyState))return;clearTimeout(terminalState.reconnectTimer);const proto=location.protocol==='https:'?'wss:':'ws:',host=$(`#${terminalState.hostId}`),ws=new WebSocket(`${proto}//${location.host}/terminal?cwd=${encodeURIComponent(currentTerminalCwd())}`);terminalState.ws=ws;ws.binaryType='arraybuffer';host.dataset.connected='false';ws.onopen=()=>{host.dataset.connected='true';requestAnimationFrame(()=>{fitTerminal(terminalState);sendTerminalResize(terminalState);terminalState.term?.focus()})};ws.onmessage=async event=>{const data=event.data instanceof Blob?new Uint8Array(await event.data.arrayBuffer()):event.data instanceof ArrayBuffer?new Uint8Array(event.data):String(event.data);terminalState.term?.write(data)};ws.onerror=()=>ws.close();ws.onclose=()=>{host.dataset.connected='false';if(terminalState.ws===ws)terminalState.ws=null;if(terminalIsVisible(terminalState))terminalState.reconnectTimer=setTimeout(()=>connectTerminal(terminalState),1000)}}
function initializeTerminal(terminalState){if(terminalState.term){connectTerminal(terminalState);requestAnimationFrame(()=>fitTerminal(terminalState));return}const host=$(`#${terminalState.hostId}`),term=new Terminal({cursorBlink:true,cursorStyle:'block',fontFamily:'ui-monospace, "SFMono-Regular", "SF Mono", Menlo, Consolas, monospace',fontSize:12,lineHeight:1.2,scrollback:5000,theme:terminalTheme()}),fit=new FitAddon;term.loadAddon(fit);term.open(host);terminalState.term=term;terminalState.fit=fit;term.onData(data=>{const ws=terminalState.ws;if(ws?.readyState===WebSocket.OPEN)ws.send(new TextEncoder().encode(data))});term.onResize(()=>sendTerminalResize(terminalState));terminalState.resizeObserver=new ResizeObserver(()=>requestAnimationFrame(()=>fitTerminal(terminalState)));terminalState.resizeObserver.observe(host);connectTerminal(terminalState);globalThis.__codexTerminals=terminalStates;if(terminalState===terminalStates.bottom)globalThis.__codexTerminal={term,fit,state:terminalState}}
function setBottomPanelView(kind='launcher'){if(kind==='files'){setBottomPanelOpen(false);void openFiles();return;}const launcher=kind==='launcher',terminal=kind==='terminal',labels={browser:['Browser','globe','Open Browser from the right panel to keep it beside the chat.'],files:['Files','folderOpen','Choose or switch the local project folder available to this WebUI.']};$('#bottomPanelLauncher').hidden=!launcher;$('#terminalHost').hidden=!terminal;$('#bottomPanelUtility').hidden=launcher||terminal;$('#bottomPanelTab').textContent=launcher?'New tab':terminal?'Terminal':labels[kind]?.[0]||'New tab';if(launcher)return;bottomPanelLastView=kind;if(terminal){initializeTerminal(terminalStates.bottom);requestAnimationFrame(()=>{fitTerminal(terminalStates.bottom);terminalStates.bottom.term?.focus()});return}const[title,icon,description]=labels[kind];$('#bottomPanelIcon').innerHTML=codexIcon(icon);$('#bottomPanelUtilityTitle').textContent=title;$('#bottomPanelDescription').textContent=description;const action=$('#bottomPanelAction');action.hidden=kind!=='files';action.textContent='Choose project folder';action.onclick=kind==='files'?openFolderPicker:null}
function setBottomPanelOpen(open){const panel=$('#bottomPanel');panel.hidden=!open;document.body.classList.toggle('bottom-panel-open',open);$('#toggleBottomPanel').setAttribute('aria-pressed',String(open));$('#toggleBottomPanel').setAttribute('aria-expanded',String(open));if(open)setBottomPanelView(bottomPanelLastView||'launcher')}
function setSidebarSearchOpen(open){const panel=$('#sidebarSearchPanel'),input=$('#threadSearch');panel.hidden=!open;$('#sidebarSearchButton').setAttribute('aria-expanded',String(open));if(open){requestAnimationFrame(()=>input.focus());return}if(input.value){input.value='';renderThreads()}}
function setSidebarHelpOpen(open){$('#sidebarHelpMenu').hidden=!open;$('#sidebarHelpButton').setAttribute('aria-expanded',String(open))}

for(const close of document.querySelectorAll('[data-close-side-tab]'))close.onclick=()=>closeSidePanelTab(close.dataset.closeSideTab);
$('#newTab').onclick=()=>setSidePanelView('launcher','New tab');$('#reviewTab').onclick=()=>openReviewPanel(state.activeReview);$('#utilityTab').onclick=()=>setSidePanelView($('#utilityTab').dataset.sidePanelTab,$('#utilityTab').textContent);$('#openSidePanelTab').onclick=()=>setSidePanelView('launcher','New tab');for(const action of document.querySelectorAll('[data-side-panel-action]'))action.onclick=()=>action.dataset.sidePanelAction==='review'?openReviewPanel():openUtilityPanel(action.dataset.sidePanelAction);$('#browserAddressForm').onsubmit=event=>{event.preventDefault();navigateBrowser($('#browserUrl').value)};$('#browserBack').onclick=()=>moveBrowserHistory(-1);$('#browserForward').onclick=()=>moveBrowserHistory(1);$('#browserRefresh').onclick=()=>browserState.index>=0&&navigateBrowser(browserState.history[browserState.index],{push:false});$('#bottomPanelTab').onclick=()=>setBottomPanelView();for(const action of document.querySelectorAll('[data-bottom-panel-action]'))action.onclick=()=>setBottomPanelView(action.dataset.bottomPanelAction);$('#reviewMode').onclick=()=>{reviewPreferences.mode=reviewPreferences.mode==='unified'?'split':'unified';saveReviewPreferences();renderChanges()};$('#reviewWrap').onclick=()=>{reviewPreferences.wrap=!reviewPreferences.wrap;saveReviewPreferences();renderChanges()};$('#reviewExpand').onclick=()=>{reviewPreferences.expanded=!reviewPreferences.expanded;saveReviewPreferences();renderChanges()};$('#reviewPatch').onclick=applyActiveReviewPatch;$('#composer').addEventListener('submit',submitPrompt);$('#prompt').addEventListener('input',handlePromptInput);$('#prompt').addEventListener('keydown',handlePromptKeydown);$('#threadSearch').addEventListener('input',renderThreads);$('#modelButton').addEventListener('click',toggleModelMenu);$('#modeButton').onclick=togglePermissionMenu;$('#confirmFullAccess').onclick=()=>{const action=pendingFullAccessAction;$('#fullAccessDialog').close();if(action==='enable')setPermissionVisibility('fullAccess',true);else setPermissionMode('full-access');pendingFullAccessAction='select'};$('#fullAccessDialog').addEventListener('close',()=>{pendingFullAccessAction='select';syncPermissionSettings()});document.querySelector('[data-composer-control="add"]').onclick=()=>{
  const menu=$('#attachmentMenu');if(!menu.hidden){closeAttachmentMenu();return}
  closeComposerAutocomplete();menu.hidden=false;$('#attachmentFileChoices').hidden=true;
  document.querySelector('[data-composer-control="add"]').setAttribute('aria-expanded','true');void openComposerSkills();
};
$('#browserBack').onclick=()=>{const bridge=nativeBrowser();if(bridge)bridge.back();else moveBrowserHistory(-1)};
$('#browserForward').onclick=()=>{const bridge=nativeBrowser();if(bridge)bridge.forward();else moveBrowserHistory(1)};
$('#browserRefresh').onclick=()=>{const bridge=nativeBrowser();if(bridge)bridge.reload();else if(browserState.index>=0)navigateBrowser(browserState.history[browserState.index],{push:false})};
$('#skillFilter').oninput=renderSkillChoices;
$('#attachFileButton').onclick=()=>{$('#attachmentFileChoices').hidden=!$('#attachmentFileChoices').hidden};
for(const [buttonId,inputId] of [['attachImageButton','attachmentInput'],['uploadFileButton','attachmentInput'],['uploadFolderButton','folderAttachmentInput']]){
  $('#'+buttonId).onclick=()=>{closeAttachmentMenu();$('#'+inputId).click()};$('#'+inputId).onchange=event=>{void uploadAttachments(event.target.files);event.target.value='';};
}
$('#prompt').addEventListener('paste',event=>{const images=[...(event.clipboardData?.files||[])].filter(file=>file.type.startsWith('image/'));if(images.length){event.preventDefault();void uploadAttachments(images);}});
document.querySelector('[data-composer-control="dictation"]').onclick=()=>toast('Dictation requires the native desktop audio bridge.');$('#newTask').onclick=startNewTask;$('#projectButton').onclick=openFolderPicker;$('#projectlessOption').onclick=useProjectless;$('#accountButton').onclick=e=>{e.stopPropagation();if(state.account?.type==='chatgpt')toggleAccountMenu();else openSettings('general')};$('#folderGo').onclick=()=>loadFolders($('#folderPathInput').value);$('#folderPathInput').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();loadFolders(e.currentTarget.value)}};$('#folderUp').onclick=()=>folderBrowse.parent&&loadFolders(folderBrowse.parent);$('#folderConfirm').onclick=useSelectedFolder;$('#toggleSummaryPanel').onclick=()=>setSummaryPanelOpen($('#summaryPanel').hidden);$('#closeImageViewer').onclick=closeImageViewer;$('#imageViewerImage').onload=()=>{$('#imageViewerImage').hidden=false;$('#imageViewerError').hidden=true};$('#imageViewerImage').onerror=()=>{$('#imageViewerImage').hidden=true;$('#imageViewerError').hidden=false};$('#imageViewer').addEventListener('click',event=>{if(event.target===event.currentTarget)closeImageViewer()});$('#imageViewer').addEventListener('close',()=>{const image=$('#imageViewerImage');image.removeAttribute('src');if(imageViewerReturnFocus?.isConnected)imageViewerReturnFocus.focus();imageViewerReturnFocus=null});function mobileSidebarEnabled(){return document.documentElement.classList.contains('mobile-device')||innerWidth<720}
$('#panelBackdrop').onclick=()=>{setSidePanelOpen(false);setSummaryPanelOpen(false)};
document.querySelector('.conversation-shell').addEventListener('pointerdown',()=>{if(mobileSidebarEnabled())setSidebarOpen(false)});
$('#sidebarSearchButton').onclick=event=>{event.stopPropagation();setSidebarSearchOpen($('#sidebarSearchPanel').hidden)};$('#sidebarSearchClose').onclick=()=>setSidebarSearchOpen(false);$('#sidebarHelpButton').onclick=event=>{event.stopPropagation();setSidebarHelpOpen($('#sidebarHelpMenu').hidden)};$('#sidebarHelpSettings').onclick=()=>{setSidebarHelpOpen(false);openSettings('general-settings')};$('#sidebarHelpShortcuts').onclick=()=>{setSidebarHelpOpen(false);openSettings('keyboard-shortcuts')};$('#accountSettings').onclick=()=>openSettings('general-settings');$('#accountProfile').onclick=()=>openSettings('profile');$('#accountUsage').onclick=()=>{$('#accountUsageDetails').hidden=!$('#accountUsageDetails').hidden;void loadAccountUsage()};$('#accountShortcuts').onclick=()=>openSettings('keyboard-shortcuts');for(const button of document.querySelectorAll('[data-settings-page]'))button.onclick=()=>setSettingsPage(button.dataset.settingsPage);$('#settingsAutoReviewToggle').onchange=event=>setPermissionVisibility('autoReview',event.currentTarget.checked);$('#settingsFullAccessToggle').onchange=event=>{if(!event.currentTarget.checked){setPermissionVisibility('fullAccess',false);return}event.currentTarget.checked=false;pendingFullAccessAction='enable';const dialog=$('#fullAccessDialog');if(!dialog.open)dialog.showModal()};$('#accountLogout').onclick=async()=>{if(!confirm('Log out?'))return;try{await rpc('account/logout');clearTimeout(conversationCacheTimer);conversationCacheTimer=null;await clearCache();toggleAccountMenu(false);await loadAccount(true)}catch(error){toast(error.message)}};$('#settingsDialog').addEventListener('cancel',event=>{event.preventDefault();closeSettings()});
$('#languageSelect').value=i18n.preference;
$('#languageSelect').onchange=event=>i18n.setPreference(event.currentTarget.value);
applyTheme(themePreference(),{persist:false});
$('#themeSelect').onchange=event=>applyTheme(event.currentTarget.value);
systemTheme.addEventListener('change',()=>{if(themePreference()==='system')applyTheme('system',{persist:false})});
addEventListener('storage',e=>{if(e.key===THEME_STORAGE_KEY)applyTheme(e.newValue||'system',{persist:false})});
function refreshLocalizedRuntime(){
  localizeBrowserError();
  $('#languageSelect').value=i18n.preference;
  if(!state.active)$('#threadTitle').textContent=t('New task');
  if(!folderBrowse.selected)$('#folderSelection').textContent=t('No folder selected');
  if(state.account)renderAccount(state.account);else for(const id of ['accountName','accountMenuName','settingsAccountName'])$(`#${id}`).textContent=t('Settings');
  syncPermissionControl();syncModelLabel();refreshComposerPlaceholder();renderContextUsage();renderChanges();
  syncComposerSubmitState();
  if(!$('#modelMenu').hidden)renderModelMenuMain();
  if($('#settingsDialog').open){const current=document.querySelector('[data-settings-page].active')?.dataset.settingsPage||settingsRoutePage()||'general-settings';setSettingsPage(current,{updateRoute:false});filterSettingsNavigation($('#settingsSearch').value)}
}
i18n.subscribe(refreshLocalizedRuntime);
refreshLocalizedRuntime();
$('#toggleSidePanel').onclick=()=>setSidePanelOpen($('#sidePanel').hidden);$('#toggleBottomPanel').onclick=()=>setBottomPanelOpen($('#bottomPanel').hidden);$('#closeBottomPanel').onclick=()=>setBottomPanelOpen(false);$('#toggleSidebar').onclick=()=>setSidebarOpen(mobileSidebarEnabled()?!$('#sidebar').classList.contains('mobile-open'):document.body.classList.contains('sidebar-hidden'));$('#closeSidePanel').onclick=()=>setSidePanelOpen(false);$('#closeSummaryPanel').onclick=()=>setSummaryPanelOpen(false);document.addEventListener('click',e=>{const target=e.target instanceof Element?e.target:null,image=target?.closest('[data-image-src]');if(image){e.preventDefault();openImageViewer(image.dataset.imageSrc,image.dataset.imageTitle||image.querySelector('img')?.alt||'Image',image.dataset.imagePath||'');return}if(target?.closest('a[data-file-download]'))return;const citation=target?.closest('a[data-file-reference]');if(!citation)return;e.preventDefault();void openFilePreview(citation.dataset.fileReference,citation.dataset.fileCwd||state.active?.cwd||state.config.defaultCwd)});document.addEventListener('click',e=>{const path=e.composedPath();if(!path.includes($('#attachmentMenu'))&&!path.includes(document.querySelector('[data-composer-control="add"]')))closeAttachmentMenu();if(!path.includes($('#modelPicker')))closeModelMenu();if(!path.includes($('#permissionPicker')))closePermissionMenu();if(!path.includes($('#accountMenu'))&&!path.includes($('#accountButton')))toggleAccountMenu(false);if(!path.includes($('#sidebarSearchPanel'))&&!path.includes($('#sidebarSearchButton')))setSidebarSearchOpen(false);if(!path.includes($('#sidebarHelpMenu'))&&!path.includes($('#sidebarHelpButton')))setSidebarHelpOpen(false)});document.addEventListener('visibilitychange',()=>{if(document.visibilityState!=='visible'){saveConversationCache();return}scheduleThreadListRefresh(0);scheduleActiveThreadSync(0)});addEventListener('keydown',e=>{if(e.target instanceof Element&&e.target.closest('.terminal-host'))return;if(e.key==='Escape'){if(!$('#attachmentMenu').hidden){e.preventDefault();closeAttachmentMenu();return;}if($('#imageViewer').open){e.preventDefault();closeImageViewer();return}if($('#folderDialog').open||$('#fullAccessDialog').open)return;if(e.defaultPrevented)return;if(!$('#sidebarSearchPanel').hidden){e.preventDefault();setSidebarSearchOpen(false);return}if(!$('#sidebarHelpMenu').hidden){e.preventDefault();setSidebarHelpOpen(false);return}if($('#settingsDialog').open){e.preventDefault();closeSettings();return}closeModelMenu();closePermissionMenu();toggleAccountMenu(false);if(document.body.classList.contains('side-panel-open'))setSidePanelOpen(false);else if(document.body.classList.contains('summary-panel-open'))setSummaryPanelOpen(false)}if((e.metaKey||e.ctrlKey)&&e.key==='k'){e.preventDefault();startNewTask()}if((e.metaKey||e.ctrlKey)&&e.key==='b'){e.preventDefault();$('#toggleSidebar').click()}if((e.metaKey||e.ctrlKey)&&e.key==='j'){e.preventDefault();$('#toggleBottomPanel').click()}});addEventListener('resize',()=>{syncSidebarLayout();syncOverlayPanelMode();resizePrompt();for(const terminalState of Object.values(terminalStates))requestAnimationFrame(()=>fitTerminal(terminalState))});
$('#composerProjectButton').onclick=()=>setComposerProjectMenu($('#composerProjectMenu').hidden);
$('#composerProjectRemove').onclick=()=>{setProjectless();$('#prompt').focus()};
$('#composerProjectSearch').oninput=renderComposerProjects;
$('#composerProjectBrowse').onclick=()=>{setComposerProjectMenu(false);openFolderPicker()};
$('#composerProjectMenu').onkeydown=event=>{if(event.key==='Escape'){event.stopPropagation();setComposerProjectMenu(false);$('#composerProjectButton').focus()}};
document.addEventListener('click',event=>{if(!event.composedPath().includes($('#composerProjectBar')))setComposerProjectMenu(false)});
$('#threadMenu').addEventListener('beforetoggle',event=>{
  const open=event.newState==='open';$('#threadMenuButton').setAttribute('aria-expanded',String(open));showThreadCopyMenu(false);if(!open)return;
  if(!state.active){event.preventDefault();return}
  $('#threadPinLabel').textContent=t(state.active.pinned?'Unpin':'Pin');
  const rect=$('#threadMenuButton').getBoundingClientRect(),menu=$('#threadMenu'),left=Math.max(8,Math.min(rect.left,innerWidth-228));menu.style.left=`${left}px`;menu.style.top=`${rect.bottom+6}px`;menu.classList.toggle('copy-inside',mobileSidebarEnabled()||left+460>innerWidth);
});
$('#threadMenu').addEventListener('toggle',event=>{if(event.newState==='open')$('#threadMenu [role="menuitem"]').focus()});
$('#threadMenu').onclick=event=>{const action=event.target.closest('[data-thread-action]')?.dataset.threadAction;if(action)void runThreadAction(action)};
$('#threadCopyButton').onclick=()=>showThreadCopyMenu(true);
$('.thread-copy-group').onpointerenter=event=>{if(event.pointerType==='mouse')showThreadCopyMenu(true)};
$('.thread-copy-group').onpointerleave=event=>{if(event.pointerType==='mouse')showThreadCopyMenu(false)};
$('#threadMenu').onkeydown=event=>{
  if(event.key==='ArrowRight'&&event.target===$('#threadCopyButton')){event.preventDefault();showThreadCopyMenu(true);$('#threadCopyMenu button').focus();return}
  if((event.key==='ArrowLeft'||event.key==='Escape')&&!$('#threadCopyMenu').hidden){event.preventDefault();event.stopPropagation();showThreadCopyMenu(false);$('#threadCopyButton').focus();return}
  if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key))return;
  event.preventDefault();const rows=[...event.currentTarget.querySelectorAll('[role="menuitem"]')].filter(row=>row.getClientRects().length),index=rows.indexOf(document.activeElement);rows[event.key==='Home'?0:event.key==='End'?rows.length-1:(index+(event.key==='ArrowDown'?1:-1)+rows.length)%rows.length]?.focus();
};
addEventListener('resize',()=>{if($('#threadMenu').matches(':popover-open'))$('#threadMenu').hidePopover()});
globalThis.__codexWebuiDebug={notify:onNotification,request:onServerRequest,state,browserState,navigateBrowser,renderChanges,renderAccount,renderHeader,refreshComposerPlaceholder,setProjectless,openImageViewer,openThread,loadInitial,startNewTask,setSidebarOpen,openSettings,closeSettings,settingsRoutePage,selectedPermission,permissionThreadPolicy,permissionTurnPolicy,setPermissionMode,setPermissionProfiles,setPermissionVisibility,renderPermissionMenu,filterAppModels,renderModels,syncTurnSnapshot,recordTurnReview,scrollOpenedThreadToBottom};
bindPanelResizers();
function selectedProduct(){return location.pathname==='/zcode'?'zcode':location.pathname==='/claude'?'claude':'codex'}
function initializeProductSwitcher(){localStorage.setItem('codex-webui-last-product',selectedProduct())}
function saveWorkspaceView(){
  if(!workspaceViewReady||selectedProduct()!=='codex')return;
  saveComposerDraft();
  const root=$('#conversation'),loading=state.active?.historyLoaded===false;
  const view={threadId:state.active?.id||null,scrollTop:root.scrollTop,follow:conversationFollowsBottom,
    turnWindow:state.turnWindow?{threadId:state.turnWindow.threadId,start:state.turnWindow.start}:null,
    sidebar:$('#toggleSidebar').getAttribute('aria-expanded')==='true',sidebarMobile:mobileSidebarEnabled(),width:rightPanelWidth,
    panel:$('#sidePanel').hidden?null:$('.side-panel-tab.active')?.dataset.sidePanelTab,
    summary:!$('#summaryPanel').hidden,bottom:$('#bottomPanel').hidden?null:bottomPanelLastView||'launcher',
    file:fileWorkspaceView,browser:browserState.history[browserState.index]||'',draft:$('#prompt').value,
    drafts:Object.fromEntries([...composerDrafts].map(([key,draft])=>[key,{text:draft.text,mentions:draft.mentions.filter(mention=>mention.source!=='uploading').map(({previewUrl,...mention})=>mention)}]))};
  if(loading&&pendingWorkspaceView?.threadId===view.threadId){view.scrollTop=pendingWorkspaceView.scrollTop;view.follow=pendingWorkspaceView.follow;view.turnWindow=pendingWorkspaceView.turnWindow;}
  try{localStorage.setItem(WORKSPACE_VIEW_KEY,JSON.stringify(view));}catch{}
}
function restoreWorkspaceView(){
  const view=savedWorkspaceView;
  if(view){
    if(typeof view.sidebar==='boolean'&&view.sidebarMobile===mobileSidebarEnabled())setSidebarOpen(view.sidebar);
    if(Number.isFinite(view.width))rightPanelWidth=view.width;
    if(view.summary)setSummaryPanelOpen(true);
    else if(view.panel==='utility'&&view.file?.path){
      if(view.file.kind==='file')void openFilePreview(view.file.path,view.file.cwd);else void openFiles(view.file.path);
    }else if(view.panel==='browser'){openBrowserPanel();if(view.browser)navigateBrowser(view.browser);}
    else if(view.panel==='review')openReviewPanel();
    else if(['terminal','side-task'].includes(view.panel))openUtilityPanel(view.panel);
    else if(view.panel==='launcher')setSidePanelOpen(true);
    if(['terminal','launcher'].includes(view.bottom))setBottomPanelOpen(true),setBottomPanelView(view.bottom);
    layoutRightPanels();
  }
  switchComposerDraft(state.active?.id||new URLSearchParams(location.search).get('thread')||localStorage.getItem(ACTIVE_THREAD_STORAGE_KEY));
  workspaceViewReady=true;
}
// Save real UI transitions and backgrounding; no synchronization polling.
for(const event of ['click','input','change','pointerup','keyup'])document.addEventListener(event,()=>queueMicrotask(saveWorkspaceView));
let workspaceScrollTimer;
$('#conversation').addEventListener('scroll',()=>{clearTimeout(workspaceScrollTimer);workspaceScrollTimer=setTimeout(saveWorkspaceView,150);},{passive:true});
for(const event of ['pagehide','workspace-save'])addEventListener(event,saveWorkspaceView);
document.addEventListener('visibilitychange',()=>{if(document.hidden)saveWorkspaceView();});
function initializeZcodeLayout(){
  const key='codex-webui-zcode-layout',button=$('#zcodeDesktopLayout'),viewport=$('#zcodeViewport'),frame=$('#zcodeFrame');
  let desktop=false;
  try{desktop=localStorage.getItem(key)==='desktop'}catch{}
  const update=()=>{
    button.setAttribute('aria-pressed',String(desktop));
    button.title=desktop?"Restore automatic layout":"Force desktop layout";
    const width=viewport.clientWidth,height=viewport.clientHeight;
    if(!width||!height)return;
    // Give the native UI a real desktop viewport, so both its CSS and JS agree.
    const desktopWidth=desktop?Math.max(1024,width):width,scale=width/desktopWidth;
    frame.style.width=desktop?`${desktopWidth}px`:'';
    frame.style.height=desktop?`${height/scale}px`:'';
    frame.style.transform=desktop?`scale(${scale})`:'';
    const fontSize=parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--codex-chat-font-size'))||13;
    frame.contentDocument?.documentElement?.style.setProperty('--codex-zcode-font-size',`${fontSize/scale}px`);
  };
  frame.addEventListener('load',update);
  button.onclick=()=>{desktop=!desktop;try{localStorage.setItem(key,desktop?'desktop':'auto')}catch{}update()};
  new ResizeObserver(update).observe(viewport);
  update();
}
async function boot(){subscribeImports(receiveImports);initializeProductSwitcher();if(selectedProduct()==='zcode'){document.body.classList.add('product-zcode');$('#zcodeShell').hidden=false;initializeZcodeLayout();$('#zcodeFrame').src=`/zcode/client?theme=${isDarkTheme()?'dark':'light'}`;return}const savedProject=localStorage.getItem('codex-webui-project');syncSidebarLayout();syncPermissionControl();const configuration=fetch('/api/config').then(r=>r.json()).catch(()=>state.config);await restoreConversationCache();state.config=await configuration;if(savedProject==='~')setProjectless();else setWorkspace(savedProject||state.config.defaultCwd||'.');refreshComposerPlaceholder();const initialSettingsPage=settingsRoutePage();if(initialSettingsPage)showSettings(initialSettingsPage,{updateRoute:false});restoreWorkspaceView();connect()}
boot();

function refreshAfterBackground(){
  if(document.hidden)return;
  refreshThreadsSoon();
  historySyncNeeded=true;
  scheduleActiveThreadSync(0);
}
document.addEventListener('visibilitychange',refreshAfterBackground);
addEventListener('pageshow',refreshAfterBackground);
addEventListener('online',refreshAfterBackground);
