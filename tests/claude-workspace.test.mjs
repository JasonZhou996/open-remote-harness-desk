import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {JSDOM} from 'jsdom';

// Exercise the real page and sidebar components without a browser or live AI requests.
const frontend=path.resolve('web/claude');
const requireFrontend=createRequire(path.join(frontend,'package.json'));
const {build}=requireFrontend('esbuild');
const React=requireFrontend('react');
const {act}=React;

test('Claude workspace pages can reopen navigation; routines and statistics keep working',async()=>{
  const temp=await mkdtemp(path.join(tmpdir(),'claude-workspace-check-'));
  const dom=new JSDOM('<!doctype html><body><div id="root"></div></body>',{url:'http://localhost/claude/app/'});
  for(const key of ['window','document','localStorage','sessionStorage','HTMLElement','Node','Event','CustomEvent'])globalThis[key]=dom.window[key];
  const errors=[],settingsTargets=[];
  window.addEventListener('error',event=>errors.push(event.error));
  window.addEventListener('claude-settings-tab',event=>settingsTargets.push(event.detail));
  globalThis.IS_REACT_ACT_ENVIRONMENT=true;
  const requests=[],mutations=[];
  let queued=[];
  const messages=[];
  let refreshes=0;
  const frameListeners=new Set();
  let contextRead=Promise.resolve({used:348800,total:1000000,inputTokens:348600,outputTokens:200});
  const usage={plan:'Pro',usage:{five_hour:{utilization:12,resets_at:'2026-09-21T12:00:00Z'},seven_day:{utilization:48}}};
  const project={id:'project',name:'工作项目',path:'/example/project'};
  const data={sessions:2,messages:12,activeDays:1,models:{'real-model':{input:10,output:20,cacheRead:30,cacheWrite:40}},daily:{'2026-09-20':12},source:'本地记录',updatedAt:'2026-09-20T12:00:00Z'};
  globalThis.__claudeWorkspaceTest={
    settings:{settings:{language:'zh',theme:'light',thinkingEffort:'high'},isSettingsOpen:false,setIsSettingsOpen(){}},
    auth:{isAuthenticated:true,user:{name:'Jason'},logout(){}},
    backend:{upload:async files=>({attachments:files.map(file=>({path:'/uploads/'+file.name,name:file.name,mimeType:file.type,size:file.size}))}),createSession:async()=>({sessionId:'scheduled-session'}),api:async(url,init)=>{
      requests.push(url);if(init)mutations.push({url,...init});
      if(url.includes('scheduled-messages')){
        if(init?.method==='POST'){const body=JSON.parse(init.body);queued.push({id:'queued-'+mutations.length,session_id:body.sessionId,content:body.content,options:JSON.stringify({...body.options,deliveryKind:body.kind||'schedule'}),status:'pending'});}
        if(init?.method==='DELETE'){if(globalThis.__claudeWorkspaceTest.rejectCancel)return {cancelled:false};queued=queued.filter(row=>!url.endsWith('/'+row.id));return {cancelled:true};}
        const kind=new URL(url,'http://localhost').searchParams.get('kind');
        return {items:queued.filter(row=>!kind||(JSON.parse(row.options||'{}').deliveryKind||'schedule')===kind)};
      }
      return url.includes('token-usage')?contextRead:url.includes('statistics')?data:{items:[]};
    },onFrame:fn=>{frameListeners.add(fn);return()=>frameListeners.delete(fn);}},
    subscribeUsage:callback=>{callback(usage);return()=>{};},refreshUsage:async()=>{refreshes++;return usage;}
  };
  let root;
  try{
    const outfile=path.join(temp,'app.mjs');
    await build({entryPoints:[path.join(frontend,'src/App.tsx')],outfile,bundle:true,platform:'node',format:'esm',jsx:'automatic',loader:{'.svg':'dataurl'},define:{'import.meta.env.BASE_URL':'"/claude/app/"'},logLevel:'silent',plugins:[{
      name:'isolate-network-and-unrelated-views',setup(builder){
        builder.onResolve({filter:/^react(?:\/.*)?$/},args=>({path:requireFrontend.resolve(args.path),external:true}));
        const replacements={
          ChatContext:'export const useChat=()=>globalThis.__claudeWorkspaceTest.chat;',
          SettingsContext:'export const useSettings=()=>globalThis.__claudeWorkspaceTest.settings;',
          AuthContext:'export const useAuth=()=>globalThis.__claudeWorkspaceTest.auth;',
          backend:'export const backend=globalThis.__claudeWorkspaceTest.backend;',
          usage:'export const {subscribeUsage,refreshUsage}=globalThis.__claudeWorkspaceTest;',
          i18n:'export const t=x=>x;',
        };
        for(const name of ['ArtifactViewer','ArtifactCategoryPicker','UpgradeView','CustomizeModal','SearchModal','LoginView','CodeWorkspaceView','CustomizeView','ClaudeMascot'])replacements[name]=`export const ${name}=()=>null;`;
        builder.onResolve({filter:/.*/},args=>{
          const name=path.basename(args.path).replace(/\.[^.]+$/,'');
          return replacements[name]?{path:name,namespace:'fixture'}:undefined;
        });
        builder.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:replacements[args.path],loader:'js'}));
      }
    }]});
    const {App}=await import(pathToFileURL(outfile));
    const {createRoot}=requireFrontend('react-dom/client');
    const button=label=>[...document.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')===label||b.textContent.trim()===label);
    const click=async label=>{assert.ok(button(label),`missing button: ${label}`);await act(async()=>button(label).click());};
    function Harness({page,detail,transcript}){
      const [view,setView]=React.useState(page);
      const [activeProject,setActiveProject]=React.useState(detail?project:null);
      const [projects,setProjects]=React.useState([project]);
      const [model,setModel]=React.useState('real-model');
      const [effort,setEffort]=React.useState('high');
      const [permission,setPermission]=React.useState('default');
      const [recalledDraft,setRecalledDraft]=React.useState(null);
      globalThis.__claudeWorkspaceTest.settings.settings.thinkingEffort=effort;
      globalThis.__claudeWorkspaceTest.settings.updateSettings=value=>setEffort(value.thinkingEffort);
      globalThis.__claudeWorkspaceTest.chat={
        activePageView:view,setActivePageView:setView,activeProject,setActiveProject,projects,setProjects,
        conversations:[],activeConversation:transcript?{id:'check',title:'一段很长的对话标题'.repeat(8),projectId:project.id,messages:transcript}:null,activeConversationId:transcript?'check':null,runningSessionIds:new Set(),
        isArtifactPaneOpen:false,isStreaming:globalThis.__claudeWorkspaceTest.streaming||false,selectedModel:model,setSelectedModel:setModel,permissionMode:permission,setPermissionMode:setPermission,
        catalog:{models:[
          {value:'default',resolvedModel:'real-model',displayName:'Default',description:'本机模型'},
          {value:'real-model',resolvedModel:'real-model',displayName:'Native',description:'本机模型',supportsEffort:true,supportedEffortLevels:['low','medium','high','xhigh','max','ultracode']},
          {value:'another-model',displayName:'Another',description:'另一个真实模型'},
          {value:'third-model',displayName:'Third',description:'第三个模型'},
          {value:'fourth-model',displayName:'Fourth',description:'第四个模型'},
          {value:'claude-opus-4-8',resolvedModel:'claude-opus-4-8',displayName:'Opus 4.8',description:'Opus 4.8',menuGroup:'more'},
          {value:'claude-fable-5',resolvedModel:'claude-fable-5',displayName:'Fable 5',description:'Fable 5 · Requires usage credits',menuGroup:'more'},
          {value:'claude-opus-4-7',resolvedModel:'claude-opus-4-7',displayName:'Opus 4.7',description:'Opus 4.7',menuGroup:'more'},
          {value:'claude-opus-4-6',resolvedModel:'claude-opus-4-6',displayName:'Opus 4.6',description:'Opus 4.6',menuGroup:'more'},
          {value:'claude-sonnet-4-6',resolvedModel:'claude-sonnet-4-6',displayName:'Sonnet 4.6',description:'Sonnet 4.6',menuGroup:'more'},
        ],commands:[{name:'explain',description:'解释代码'},{name:'effort',description:'力度'},{name:'usage',description:'额度'}]},
        sendMessage:async(...args)=>{if(globalThis.__claudeWorkspaceTest.sendError)throw new Error(globalThis.__claudeWorkspaceTest.sendError);await globalThis.__claudeWorkspaceTest.sendGate;messages.push(args);},stopGeneration:async()=>{},
        recalledDraft,setRecalledDraft,clearRecalledDraft(){setRecalledDraft(null);},
        refreshSidebar:async()=>{},setActiveConversationId(){},createNewConversation(){setView('chat');},
      };
      return React.createElement(App);
    }
    for(const width of [390,1280])for(const page of ['projects','routines'])for(const detail of page==='projects'?[false,true]:[false]){
      queued=page==='routines'?[{id:'old-queue',session_id:'check',content:'意外混入的普通消息',options:JSON.stringify({deliveryKind:'queue'}),status:'cancelled',scheduled_for:'2026-09-20T12:00:00Z'}]:[];
      window.innerWidth=width;
      root=createRoot(document.getElementById('root'));
      await act(async()=>root.render(React.createElement(Harness,{page,detail})));
      assert.equal(document.querySelector('section[aria-label="使用统计"]'),null);
      if(width>=768)await click('Close sidebar');
      await click('打开侧边栏');
      assert.ok(document.querySelector('aside').classList.contains('translate-x-0'));
      await click('Close sidebar');
      if(page==='routines'){
        assert.equal(document.querySelector('main').textContent.includes('意外混入的普通消息'),false,'routine page excludes the normal message queue');
        assert.equal(document.querySelector('main form'),null);
        await click('新建任务');assert.ok(document.querySelector('main form'));
        await click('收起新建任务');assert.equal(document.querySelector('main form'),null);
        await click('新建任务');
        const model=document.querySelector('select[aria-label="任务模型"]'),permission=document.querySelector('select[aria-label="任务权限"]');
        assert.ok(model && permission,'routines offer independent model and permission selectors');
        assert.deepEqual([...permission.options].map(option=>option.value),['auto','default','acceptEdits','plan','bypassPermissions']);
        await act(async()=>{model.value='another-model';model.dispatchEvent(new window.Event('change',{bubbles:true}));permission.value='auto';permission.dispatchEvent(new window.Event('change',{bubbles:true}));});
        assert.equal(globalThis.__claudeWorkspaceTest.chat.selectedModel,'real-model','routine selection must not change the chat model');
        assert.equal(globalThis.__claudeWorkspaceTest.chat.permissionMode,'default','routine selection must not change the chat permissions');
        await act(async()=>{
          const form=document.querySelector('main form'),text=form.querySelector('textarea'),when=form.querySelector('input[type="datetime-local"]');
          Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set.call(text,'独立模型和权限');text.dispatchEvent(new window.Event('input',{bubbles:true}));
          Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set.call(when,'2099-01-01T12:00');when.dispatchEvent(new window.Event('input',{bubbles:true}));
        });
        await act(async()=>document.querySelector('main form').dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true})));
        const saved=JSON.parse(mutations.filter(row=>row.method==='POST'&&row.url==='/api/scheduled-messages').at(-1).body);
        assert.equal(saved.options.model,'another-model');assert.equal(saved.options.permissionMode,'auto');assert.equal(saved.options.effort,undefined,'models without effort support receive no effort override');
      }
      if(detail){
        const before=mutations.length;
        await click('删除项目');assert.ok(document.querySelector('[role="alertdialog"]').textContent.includes('保留磁盘文件和已有对话'));
        await click('取消');assert.equal(mutations.length,before);
        await click('删除项目');await click('确认删除');
        assert.deepEqual(mutations.at(-1),{url:'/api/projects/project',method:'DELETE'},'remove the entry without force-deleting transcripts');
        assert.equal(globalThis.__claudeWorkspaceTest.chat.projects.length,0);
        assert.equal(globalThis.__claudeWorkspaceTest.chat.activeProject,null);
        await act(async()=>globalThis.__claudeWorkspaceTest.chat.setProjects([project]));
      }
      await click('返回对话');
      assert.ok(document.querySelector('h1').textContent.includes('接下来做什么'));
      const overview=document.querySelector('[aria-label="新对话概览"]');
      const composer=document.querySelector('[aria-label="新对话输入区"]');
      assert.equal(overview.contains(composer),false,'composer must not scroll with the home content');
      assert.equal(overview.nextElementSibling,composer);
      await click('选择项目');
      assert.equal(document.querySelector('[role="menu"][aria-label="项目"] [aria-checked="true"]').textContent,'无项目');
      await act(async()=>[...document.querySelectorAll('[role="menu"][aria-label="项目"] button')].find(b=>b.textContent.includes('工作项目')).click());
      assert.equal(globalThis.__claudeWorkspaceTest.chat.activeProject.path,'/example/project');
      assert.equal(globalThis.__claudeWorkspaceTest.chat.activePageView,'chat','project choice must stay in the composer');
      assert.equal(document.querySelector('[role="menu"][aria-label="项目"]'),null);
      await click('选择项目');await click('无项目');assert.equal(globalThis.__claudeWorkspaceTest.chat.activeProject,null);
      await click('选择项目');await act(async()=>document.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Escape'})));
      assert.equal(document.querySelector('[role="menu"][aria-label="项目"]'),null);
      assert.equal(document.activeElement,button('选择项目'));
      await click('选择项目');await act(async()=>overview.dispatchEvent(new window.Event('pointerdown',{bubbles:true})));
      assert.equal(document.querySelector('[role="menu"][aria-label="项目"]'),null);
      assert.ok(document.querySelector('section[aria-label="使用统计"]'));
      assert.equal(document.querySelectorAll('[role="img"] span').length,182);
      assert.ok(document.querySelector('[title="2026-09-20 · 12 条消息"]'));
      assert.equal(button('使用统计'),undefined,'statistics must not be a sidebar destination');
      await click('模型');assert.ok(document.querySelector('table').textContent.includes('real-model'));
      await click('7 天');assert.equal(requests.at(-1),'/api/providers/claude/statistics?days=7');
      const toolbar=document.querySelector('[aria-label="对话工具栏"]');
      assert.equal(toolbar.contains(document.querySelector('textarea[aria-label="消息"]')),false);
      assert.ok(toolbar.previousElementSibling.contains(document.querySelector('textarea[aria-label="消息"]')),'toolbar is below the bordered text field');
      assert.equal(button('语音输入'),undefined,'unsupported microphone must not be offered');
      await click('权限模式');
      const modeMenu=document.querySelector('[role="menu"][aria-label="Mode"]');
      const modeRows=[...modeMenu.querySelectorAll('[role="menuitemradio"]')];
      assert.deepEqual(modeRows.map(row=>row.querySelector('span span').textContent),['Auto','Manual','Accept edits','Plan','Bypass permissions']);
      assert.ok(modeMenu.textContent.includes('Claude handles permission decisions'));
      assert.equal(modeRows.filter(row=>row.getAttribute('aria-checked')==='true').length,1);
      await act(async()=>modeMenu.dispatchEvent(new window.KeyboardEvent('keydown',{key:'4',bubbles:true})));
      assert.equal(globalThis.__claudeWorkspaceTest.chat.permissionMode,'plan');
      assert.equal(document.querySelector('[role="menu"][aria-label="Mode"]'),null);
      assert.equal(button('权限模式').textContent,'Plan');
      await click('权限模式');
      await act(async()=>document.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Escape'})));
      assert.equal(document.querySelector('[role="menu"][aria-label="Mode"]'),null);
      assert.equal(document.activeElement,button('权限模式'));
      await click('思考强度');
      const effort=document.querySelector('input[aria-label="思考深度"]');
      assert.equal(effort.max,'5');
      const changeEffort=async value=>act(async()=>{
        Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set.call(effort,String(value));
        effort.dispatchEvent(new window.Event('input',{bubbles:true}));
      });
      await changeEffort(5);assert.equal(button('思考强度').textContent,'Ultracode');
      assert.equal(effort.getAttribute('aria-valuetext'),'Ultracode');
      await changeEffort(4);assert.equal(button('思考强度').textContent,'Max');
      await changeEffort(0);assert.equal(button('思考强度').textContent,'低');
      await act(async()=>document.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Escape'})));
      const textarea=document.querySelector('textarea[aria-label="消息"]');
      await act(async()=>{
        Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set.call(textarea,'/');
        textarea.dispatchEvent(new window.Event('input',{bubbles:true}));
      });
      await click('explain');assert.equal(textarea.value,'/explain ');
      const before=refreshes;
      await click('查看套餐额度');assert.equal(textarea.value,'/explain ','opening usage must preserve the draft');
      const quota=document.querySelector('[role="dialog"][aria-label="套餐额度"]');
      assert.ok(quota.textContent.includes('已用 12%')&&quota.textContent.includes('已用 48%'));
      assert.equal(settingsTargets.length,0,'usage opens a popover instead of settings');
      assert.equal(refreshes,before,'opening usage must not contact the upstream');
      await click('刷新额度');assert.equal(refreshes,before+1);
      await act(async()=>textarea.dispatchEvent(new window.Event('pointerdown',{bubbles:true})));
      assert.equal(document.querySelector('[role="dialog"][aria-label="套餐额度"]'),null);
      await click('发送消息');assert.equal(messages.at(-1)[0],'/explain ');assert.equal(textarea.value,'');
      await click('选择模型');
      assert.equal(document.querySelectorAll('[role="menuitemradio"]').length,4,'default and resolved alias must share a row');
      assert.equal(document.querySelectorAll('[role="menuitemradio"][aria-checked="true"]').length,1);
      const panel=document.querySelector('[role="menu"][aria-label="模型"]').parentElement;
      panel.getBoundingClientRect=()=>({left:width>=768?500:30});
      await click('更多模型');
      if(width>=768)assert.ok(document.querySelector('[role="menu"][aria-label="更多模型"]'));
      else {assert.ok(button('返回模型'));assert.equal(document.querySelector('[role="menu"][aria-label="更多模型"]'),null);}
      for(const name of ['Fable 5','Opus 4.8','Opus 4.7','Opus 4.6','Sonnet 4.6'])assert.ok([...document.querySelectorAll('[role="menuitemradio"]')].some(row=>row.textContent.includes(name)),`missing ${name}`);
      await click('Opus 4.8');assert.equal(button('选择模型').textContent,'Opus 4.8');
      assert.equal(globalThis.__claudeWorkspaceTest.chat.selectedModel,'claude-opus-4-8','selection must send the full CLI model id');
      await click('选择模型');await click('另一个真实模型');assert.equal(button('选择模型').textContent,'另一个真实模型');
      await act(async()=>root.unmount());root=null;
      queued=[];
    }
    const code='const path = "'+ '/home/user/very-long-workspace/'.repeat(10)+'";\n'+Array.from({length:7},(_,i)=>`console.log(${i});`).join('\n')+'\n';
    const transcript=[{id:'reply',role:'assistant',createdAt:Date.now(),content:'普通 `行内代码`\n\n```js\n'+code+'```\n\n```\n/home/user/文件夹\n```\n\n| 列 |\n| --- |\n| 内容 |'}];
    root=createRoot(document.getElementById('root'));
    await act(async()=>root.render(React.createElement(Harness,{page:'chat',transcript})));
    assert.equal(document.querySelectorAll('.claude-code-block').length,2,'both labeled and plain fences render');
    assert.equal(document.querySelectorAll('pre pre, pre div').length,0,'fences must not nest block wrappers inside pre');
    assert.equal(document.querySelector('pre code').textContent,code,'long code remains complete');
    assert.equal(document.querySelector('table').parentElement.classList.contains('overflow-x-auto'),true);
    const scroller=document.querySelector('.overscroll-contain');
    let height=2400, top=0;
    Object.defineProperties(scroller,{clientHeight:{value:600},scrollHeight:{get:()=>height},scrollTop:{get:()=>top,set:value=>{top=Math.max(0,Math.min(value,height-600));}}});
    const updateTranscript=async()=>{height+=100;await act(async()=>root.render(React.createElement(Harness,{page:'chat',transcript:[...transcript]})));};
    const scroll=async(value)=>act(async()=>{scroller.scrollTop=value;scroller.dispatchEvent(new window.Event('scroll'));});
    await updateTranscript();assert.equal(top,height-600);
    await scroll(top-15);const readingTop=top;
    await updateTranscript();assert.equal(top,readingTop,'even a small upward scroll must pause streaming follow');
    await scroll(height-600);await updateTranscript();assert.equal(top,height-600,'returning to bottom resumes follow');
    await act(async()=>scroller.dispatchEvent(new window.WheelEvent('wheel',{deltaY:-30,bubbles:true})));
    const wheelTop=top;await updateTranscript();assert.equal(top,wheelTop,'wheel intent wins before the scroll event');
    await scroll(300);await click('Scroll to bottom');await updateTranscript();assert.equal(top,height-600);
    const touch=async(type,y)=>act(async()=>{const event=new window.Event(type,{bubbles:true});Object.defineProperty(event,'touches',{value:[{clientY:y}]});scroller.dispatchEvent(event);});
    await touch('touchstart',200);await touch('touchmove',260);
    const touchTop=top;await updateTranscript();assert.equal(top,touchTop,'touching upward through history pauses follow');
    await scroll(100);await updateTranscript();assert.equal(top,100,'later message updates keep the reading position');
    const recallInput=document.querySelector('textarea[aria-label="消息"]');
    const pasted=new window.Event('paste',{bubbles:true,cancelable:true});
    Object.defineProperty(pasted,'clipboardData',{value:{files:[new window.File(['image'],'粘贴截图.png',{type:'image/png'})]}});
    await act(async()=>recallInput.dispatchEvent(pasted));
    assert.equal(pasted.defaultPrevented,true);
    assert.match(document.querySelector('img[alt="粘贴截图.png"]').src,/api\/assets\/images\//);
    await click('发送消息');assert.equal(messages.at(-1)[1][0].path,'/uploads/粘贴截图.png');
    transcript.push({id:'image-only',role:'user',createdAt:Date.now(),content:'',attachments:messages.at(-1)[1]});
    await updateTranscript();
    assert.ok(document.querySelector('img[alt="粘贴截图.png"]'),'sent image-only message retains its thumbnail');
    assert.equal(document.querySelector('[class~="group/msg"] .whitespace-pre-wrap'),null,'image-only messages do not render empty text bubbles');
    await act(async()=>{Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set.call(recallInput,'现有草稿');recallInput.dispatchEvent(new window.Event('input',{bubbles:true}));});
    const recalledAttachment={id:'attachment',name:'撤回图片.png',type:'image/png',size:12,path:'/uploads/image.png',dataUrl:'data:image/png;base64,AAAA'};
    await act(async()=>globalThis.__claudeWorkspaceTest.chat.setRecalledDraft({sessionId:'check',text:'撤回内容',attachments:[recalledAttachment]}));
    assert.equal(recallInput.value,'现有草稿\n撤回内容');
    assert.ok(document.querySelector('img[alt="撤回图片.png"]'));
    assert.equal(globalThis.__claudeWorkspaceTest.chat.recalledDraft,null,'consume a recalled draft exactly once');
    await click('发送消息');assert.deepEqual(messages.at(-1),['现有草稿\n撤回内容',[recalledAttachment],false]);
    globalThis.__claudeWorkspaceTest.streaming=true;
    await act(async()=>root.render(React.createElement(Harness,{page:'chat',transcript})));
    await act(async()=>{Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set.call(recallInput,'马上插话');recallInput.dispatchEvent(new window.Event('input',{bubbles:true}));});
    assert.equal(button('立即插入'),undefined,'immediate send belongs on the queued row, not beside the input');
    await act(async()=>recallInput.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Enter',bubbles:true})));
    assert.equal(JSON.parse(mutations.findLast(m=>m.method==='POST'&&m.url.includes('scheduled-messages')).body).kind,'queue');
    assert.equal(recallInput.value,'');
    assert.ok(button('立刻发送').parentElement.textContent.includes('编辑删除'));
    globalThis.__claudeWorkspaceTest.sendError='停止失败';await click('立刻发送');
    assert.equal(recallInput.value,'马上插话','failed Stop must retain the draft');
    assert.match(document.querySelector('[role="alert"]').textContent,/停止失败/);
    assert.equal(queued.length,0,'cancel the scheduled copy before stopping');
    delete globalThis.__claudeWorkspaceTest.sendError;
    await act(async()=>globalThis.__claudeWorkspaceTest.chat.setRecalledDraft({sessionId:'check',text:'带附件插话',attachments:[recalledAttachment]}));
    await click('排队发送');
    assert.ok(document.querySelector('img[alt="撤回图片.png"]'),'queued image keeps a thumbnail after composer clears');
    const queuedText=queued[0].content;
    let finishInsert;
    globalThis.__claudeWorkspaceTest.sendGate=new Promise(resolve=>finishInsert=resolve);
    await click('立刻发送');
    assert.equal(mutations.at(-1).method,'DELETE');assert.equal(queued.length,0);
    await act(async()=>{Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set.call(recallInput,'等待时继续写');recallInput.dispatchEvent(new window.Event('input',{bubbles:true}));});
    await act(async()=>finishInsert());
    assert.equal(messages.at(-1)[0],queuedText);assert.equal(messages.at(-1)[2],true);
    assert.equal(messages.at(-1)[1][0].path,recalledAttachment.path,'queued attachments must travel with immediate send');
    assert.equal(recallInput.value,'等待时继续写','Stop acknowledgement must not clear newer input');
    delete globalThis.__claudeWorkspaceTest.sendGate;
    await click('排队发送');const sentCount=messages.length;
    globalThis.__claudeWorkspaceTest.rejectCancel=true;await click('立刻发送');
    assert.equal(messages.length,sentCount,'a row already sent by the scheduler must not be sent twice');
    delete globalThis.__claudeWorkspaceTest.rejectCancel;
    globalThis.__claudeWorkspaceTest.streaming=false;
    await act(async()=>root.render(React.createElement(Harness,{page:'chat',transcript})));
    const ring=()=>document.querySelector('svg[aria-label="上下文占用"]');
    assert.equal(ring().getAttribute('aria-valuenow'),'34.88');
    assert.equal(ring().lastElementChild.getAttribute('stroke'),'#4285d4');
    assert.equal(ring().lastElementChild.getAttribute('stroke-dasharray'),'34.88 100');
    const before=refreshes;
    await click('查看套餐额度');
    assert.ok(document.querySelector('[aria-label="上下文窗口"]').textContent.includes('348.8k / 1M (35%)'));
    await click('查看套餐额度');
    const emit=frame=>act(async()=>{frameListeners.forEach(fn=>fn(frame));});
    await emit({kind:'status',text:'token_budget',sessionId:'different-session',tokenBudget:{used:990000}});
    assert.equal(ring().getAttribute('aria-valuenow'),'34.88','other sessions must not change this ring');
    for(const [used,color] of [[500000,'#d99a29'],[920000,'#d95555'],[100000,'#4285d4']]){
      await emit({kind:'status',text:'token_budget',sessionId:'check',tokenBudget:{used,total:160000,inputTokens:used-200,outputTokens:200}});
      assert.equal(ring().getAttribute('aria-valuenow'),String(used/10000));
      assert.equal(ring().lastElementChild.getAttribute('stroke'),color,'ring changes color without opening the popover');
    }
    let resolveRead;
    contextRead=new Promise(resolve=>{resolveRead=resolve;});
    await emit({kind:'complete',sessionId:'check'});
    await emit({kind:'status',text:'token_budget',sessionId:'check',tokenBudget:{used:600000,inputTokens:599800,outputTokens:200}});
    await act(async()=>resolveRead({used:100000,total:1000000,inputTokens:99800,outputTokens:200}));
    assert.equal(ring().getAttribute('aria-valuenow'),'60','a late history read must not replace newer live counts');
    assert.equal(refreshes,before,'context updates must not refresh the plan quota');
    await act(async()=>root.unmount());root=createRoot(document.getElementById('root'));
    await act(async()=>root.render(React.createElement(Harness,{page:'chat'})));
    assert.equal(ring().getAttribute('aria-valuenow'),null,'a new conversation must not inherit another context');
    const draft=document.querySelector('textarea[aria-label="消息"]');
    await act(async()=>{Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set.call(draft,'切换应用后继续写');draft.dispatchEvent(new window.Event('input',{bubbles:true}));window.dispatchEvent(new window.Event('pagehide'));});
    await act(async()=>root.unmount());root=createRoot(document.getElementById('root'));
    await act(async()=>root.render(React.createElement(Harness,{page:'chat'})));
    assert.equal(document.querySelector('textarea[aria-label="消息"]').value,'切换应用后继续写');
    assert.deepEqual(errors,[],'no event handler errors');
  }finally{
    if(root)await act(async()=>root.unmount());
    dom.window.close();
    for(const key of ['window','document','localStorage','sessionStorage','HTMLElement','Node','Event','CustomEvent','IS_REACT_ACT_ENVIRONMENT','__claudeWorkspaceTest'])delete globalThis[key];
    await rm(temp,{recursive:true,force:true});
  }
});
