import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {JSDOM} from 'jsdom';

test('Claude live messages preserve tool order and restore the last workspace view', async () => {
  const frontend=path.resolve('web/claude');
  const require=createRequire(path.join(frontend,'package.json'));
  const React=require('react'), {act}=React;
  const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost/claude/app/'});
  for(const key of ['window','document','localStorage','sessionStorage','HTMLElement','Node','Event','CustomEvent'])globalThis[key]=dom.window[key];
  globalThis.IS_REACT_ACT_ENVIRONMENT=true;
  const temp=await mkdtemp(path.join(tmpdir(),'claude-state-'));
  const imports=new Set();
  const frames=new Set(); let chat, root, history=[], retractResult, retractCalls=[], permissionResult={mode:'plan'}, sent=[], edits=[], renameResult;
  const project={projectId:'p',displayName:'Project',fullPath:'/project'};
  globalThis.__claudeState={
    imports,
    settings:{settings:{thinkingEffort:'high'},updateSettings(){}},
    backend:{connect(){},subscribeSessions(){},workspace:async()=>({models:[],commands:[]}),projects:async()=>[project],
      recentSessions:async()=>({conversations:[{sessionId:'s',sessionTitle:'Session',projectId:'p'}]}),
      runningSessions:async()=>({sessions:[]}),sessionMessages:async()=>({messages:history}),sessionActiveModel:async()=>({model:'native-model'}),
      sessionPermissionMode:async()=>({mode:'default'}),setPermissionMode:async()=>permissionResult,
      onFrame(fn){frames.add(fn);return()=>frames.delete(fn);},sendChat(...args){sent.push(args);},editSend(...args){edits.push(args);},
      retractMessage:async(...args)=>{retractCalls.push(args);return retractResult;},renameSession:async()=>renameResult}
  };
  try {
    const outfile=path.join(temp,'context.mjs');
    await require('esbuild').build({entryPoints:[path.join(frontend,'src/context/ChatContext.tsx')],outfile,bundle:true,platform:'node',format:'esm',jsx:'automatic',logLevel:'silent',plugins:[{
      name:'isolate-transport',setup(b){
        b.onResolve({filter:/^react(?:\/.*)?$/},a=>({path:require.resolve(a.path),external:true}));
        b.onResolve({filter:/shared\/session-import/},a=>({path:'imports',namespace:'mock'}));
        b.onResolve({filter:/SettingsContext|services\/backend/},a=>({path:a.path.includes('SettingsContext')?'settings':'backend',namespace:'mock'}));
        b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:a.path==='imports'?'export const subscribeImports=fn=>{globalThis.__claudeState.imports.add(fn);return()=>globalThis.__claudeState.imports.delete(fn);};':a.path==='settings'?'export const useSettings=()=>globalThis.__claudeState.settings;':'export const backend=globalThis.__claudeState.backend;',loader:'js'}));
      }
    }]});
    const {ChatProvider,useChat}=await import(pathToFileURL(outfile));
    const {createRoot}=require('react-dom/client');
    function Read(){chat=useChat();return null;}
    const mount=async()=>{root=createRoot(document.getElementById('root'));await act(async()=>root.render(React.createElement(ChatProvider,null,React.createElement(Read))));};
    const emit=async frame=>act(async()=>frames.forEach(fn=>fn({sessionId:'s',...frame})));
    await mount(); await act(async()=>chat.selectConversation('s'));
    let resolveRename, rejectRename, renaming;
    renameResult=new Promise(resolve=>resolveRename=resolve);
    await act(async()=>{renaming=chat.renameConversation('s','Saved title');await Promise.resolve();});
    assert.equal(chat.activeConversation.title,'Session','keep the saved title until the API succeeds');
    await act(async()=>{resolveRename({sessionId:'s',summary:'Saved title'});await renaming;});
    assert.equal(chat.activeConversation.title,'Saved title');
    renameResult=new Promise((resolve,reject)=>rejectRename=reject);
    await act(async()=>{renaming=chat.renameConversation('s','Unsaved title');await Promise.resolve();});
    await act(async()=>{const rejected=assert.rejects(renaming,/Rename failed/);rejectRename(new Error('Rename failed'));await rejected;});
    assert.equal(chat.activeConversation.title,'Saved title','failed rename must not change the title');
    await emit({kind:'session_upserted',session:{summary:'CLI title'},project:{projectId:'p',fullPath:'/project'}});
    assert.equal(chat.activeConversation.title,'CLI title','CLI rename updates the open page without polling');
    assert.equal(chat.permissionMode,'default','load the session permission, not a stale UI default');
    let acknowledge;
    permissionResult=new Promise(resolve=>acknowledge=resolve);
    let changing;
    await act(async()=>{changing=chat.setPermissionMode('plan');await Promise.resolve();});
    assert.equal(chat.permissionMode,'default','do not show the new mode before CLI acknowledgement');
    assert.equal(chat.permissionPending,true);
    await assert.rejects(chat.sendMessage('blocked while switching'),/确认权限/);
    await act(async()=>{acknowledge({mode:'plan'});await changing;});
    assert.equal(chat.permissionMode,'plan');
    assert.equal(chat.permissionPending,false);
    let rejectMode;permissionResult=new Promise((resolve,reject)=>rejectMode=reject);
    await act(async()=>{changing=chat.setPermissionMode('bypassPermissions');await Promise.resolve();});
    await act(async()=>{rejectMode(new Error('CLI refused'));await changing;});
    assert.equal(chat.permissionMode,'plan');assert.equal(chat.permissionError,'CLI refused');
    permissionResult={mode:'plan'};await act(async()=>chat.setPermissionMode('plan'));
    await act(async()=>chat.sendMessage('hello'));
    assert.equal(sent.at(-1)[2].permissionMode,'plan');
    await emit({kind:'tool_use',toolId:'t1',toolName:'ToolSearch'});
    await emit({kind:'tool_result',toolId:'t1',content:'first result'});
    await emit({kind:'tool_use',toolId:'t2',toolName:'ToolSearch'});
    await emit({kind:'text',content:'正文在工具之后'});
    assert.deepEqual(chat.activeConversation.messages.map(m=>m.role),['user','tool','tool','assistant']);
    assert.equal(chat.activeConversation.messages.at(-1).content,'正文在工具之后');
    await emit({kind:'tool_result',toolId:'t2',content:'late result'});
    assert.equal(chat.activeConversation.messages[2].toolResult.content,'late result');
    assert.equal(chat.activeConversation.messages.at(-1).role,'assistant','late results must stay on the original tool card');
    await emit({kind:'stream_delta',content:'接下来'});
    await emit({kind:'text',content:'接下来是第二段'});
    assert.equal(chat.activeConversation.messages.filter(m=>m.content.startsWith('接下来')).length,1,'full snapshots replace the streamed prefix');
    await emit({kind:'tool_use',toolId:'t3',toolName:'Read'});
    await emit({kind:'thinking',content:'工具后的思考'});
    await emit({kind:'stream_delta',content:'最终'});
    await emit({kind:'text',content:'最终答案'});
    await emit({kind:'complete'});
    assert.deepEqual(chat.activeConversation.messages.slice(-2).map(m=>m.toolUse?.toolId||m.content),['t3','最终答案']);
    assert.equal(chat.activeConversation.messages.some(m=>m.isStreaming||m.isThinking),false);
    await emit({kind:'thinking',content:'思',isDelta:true,streamId:'api_0'});
    await emit({kind:'thinking',content:'考',isDelta:true,streamId:'api_0'});
    await emit({kind:'thinking',content:'思考',streamId:'api_0'});
    await emit({kind:'stream_end',streamId:'api_0'});
    await emit({kind:'stream_delta',content:'渐进',streamId:'api_1'});
    assert.equal(chat.activeConversation.messages.at(-1).content,'渐进','render before full snapshot');
    await emit({kind:'stream_delta',content:'输出',streamId:'api_1'});
    await emit({kind:'stream_end',streamId:'api_1'});
    await emit({kind:'text',content:'渐进输出',streamId:'api_1'});
    await emit({kind:'complete'});
    assert.equal(chat.activeConversation.messages.filter(m=>m.streamId==='api_0').length,1);
    assert.equal(chat.activeConversation.messages.find(m=>m.streamId==='api_0').thinkingContent,'思考');
    assert.equal(chat.activeConversation.messages.filter(m=>m.streamId==='api_1').length,1);
    assert.equal(chat.activeConversation.messages.at(-1).content,'渐进输出');
    const htmlReply='之前\n```html\n<button>预览测试</button>\n```\n之后';
    await emit({kind:'stream_delta',content:htmlReply,streamId:'artifact_0'});
    await emit({kind:'text',id:'artifact-row',content:htmlReply,streamId:'artifact_0'});
    await emit({kind:'text',id:'artifact-row',content:htmlReply,streamId:'artifact_0'});
    const artifactMessage=chat.activeConversation.messages.at(-1);
    assert.equal(chat.activeConversation.messages.filter(m=>m.streamId==='artifact_0').length,1);
    assert.equal(artifactMessage.artifacts.length,1);
    assert.equal(artifactMessage.artifacts[0].content,'<button>预览测试</button>');
    assert.ok(artifactMessage.content.includes('之前')&&artifactMessage.content.includes('之后'));
    assert.equal(artifactMessage.content.includes('```'),false);
    await emit({kind:'complete'});
    history=[{kind:'text',id:'native-user',transcriptAnchorId:'native-user',role:'user',content:'hello'}];
    const oldMessages=chat.activeConversation.messages;
    let fail;retractResult=new Promise((resolve,reject)=>{fail=reject;});
    let failed;
    await act(async()=>{failed=chat.retractUserMessage(oldMessages[0].id).catch(e=>e);await Promise.resolve();});
    assert.equal(chat.activeConversation.messages,oldMessages,'do not hide messages before the backend succeeds');
    await act(async()=>fail(new Error('busy')));assert.match((await failed).message,/busy/);
    assert.equal(chat.recalledDraft,null);
    assert.equal(chat.activeConversation.messages,oldMessages,'rejection must leave conversation intact');
    retractResult={messages:[]};
    await act(async()=>chat.retractUserMessage(oldMessages[0].id));
    assert.deepEqual(retractCalls.at(-1),['s','native-user'],'live rows must resolve a real transcript anchor');
    assert.equal(chat.activeConversation.messages.length,0);
    assert.deepEqual(chat.recalledDraft,{sessionId:'s',text:'hello',attachments:[]});
    await act(async()=>chat.clearRecalledDraft());
    history=[{kind:'text',id:'persisted',role:'assistant',content:'restored history'},
      {kind:'text',id:'artifact-row',role:'assistant',content:htmlReply},
      {kind:'text',id:'artifact-row-2',role:'assistant',content:'```html\n<p>第二张卡片</p>\n```'}];
    await act(async()=>chat.setActivePageView('projects'));
    await act(async()=>root.unmount()); root=null;
    sessionStorage.clear();
    await mount();
    assert.equal(chat.activeConversationId,'s');
    assert.equal(chat.activeProject.id,'p');
    assert.equal(chat.activePageView,'projects');
    assert.ok(chat.activeConversation.messages[0].content.startsWith('restored history'));
    assert.equal(chat.activeConversation.messages[0].artifacts.length,2,'parse after merging consecutive history rows');
    assert.equal(new Set(chat.activeConversation.messages[0].artifacts.map(a=>a.id)).size,2);
    assert.equal(chat.activeConversation.messages[0].artifacts[0].content,artifactMessage.artifacts[0].content);
    const preview=chat.activeConversation.messages[0].artifacts[0];
    await act(async()=>{chat.setActiveArtifact(preview);chat.setIsArtifactPaneOpen(true);});
    assert.equal(JSON.parse(localStorage.getItem('claude-workspace-view')).preview.content,undefined,'persist selection, not document contents');
    await act(async()=>root.unmount());root=null;sessionStorage.clear();await mount();
    assert.equal(chat.isArtifactPaneOpen,true);
    assert.equal(chat.activeArtifact.id,preview.id);
    assert.equal(chat.activeArtifact.content,preview.content,'reload inline preview from real conversation history');
    await act(async()=>chat.setIsArtifactPaneOpen(false));
    await act(async()=>root.unmount());root=null;sessionStorage.clear();await mount();
    assert.equal(chat.isArtifactPaneOpen,false,'a closed preview must stay closed');
    await emit({kind:'text',role:'user',content:'editable',transcriptAnchorId:'editable'});
    await act(async()=>chat.editUserMessage(chat.activeConversation.messages.at(-1).id,'edited'));
    assert.equal(edits.at(-1)[3].permissionMode,'default','edit-send uses the current session permission too');
    await emit({kind:'complete'});
    await act(async()=>chat.createNewConversation());
    await act(async()=>root.unmount()); root=null;
    await mount();
    assert.equal(chat.activeConversationId,null,'intentional new chat must not reopen the last conversation');
    assert.equal(chat.activeProject,null);

    await act(async()=>chat.selectConversation('s'));
    await emit({kind:'stream_delta',content:'还在回答',streamId:'before-stop'});
    const beforeStop=chat.activeConversation.messages, beforeCount=sent.length;
    let acknowledgeStop;
    globalThis.__claudeState.backend.abort=id=>{assert.equal(id,'s');return new Promise(resolve=>acknowledgeStop=resolve);};
    const attachment={id:'file',path:'/uploads/file.txt',name:'file.txt',type:'text/plain',size:5};
    let inserting;
    await act(async()=>{inserting=chat.sendMessage('立即插话',[attachment],true);await Promise.resolve();});
    assert.equal(sent.length,beforeCount,'do not send before the server confirms Stop');
    assert.equal(chat.activeConversation.messages,beforeStop,'do not insert the next placeholder into the old run');
    await emit({kind:'complete',aborted:true,exitCode:0});
    await act(async()=>{acknowledgeStop();await inserting;});
    assert.equal(sent.length,beforeCount+1);
    assert.deepEqual(sent.at(-1).slice(0,2),['s','立即插话']);
    assert.equal(sent.at(-1)[2].attachments[0].path,attachment.path);
    assert.equal(chat.activeConversation.messages.at(-2).content,'立即插话');
    assert.equal(chat.isStreaming,true);
    const afterInsert=chat.activeConversation.messages;
    globalThis.__claudeState.backend.abort=async()=>{throw new Error('停止失败');};
    await assert.rejects(chat.sendMessage('不要丢失',[],true),/停止失败/);
    assert.equal(sent.length,beforeCount+1);
    assert.equal(chat.activeConversation.messages,afterInsert,'failed Stop must not append or send the new message');

    await emit({kind:'complete'});
    await emit({kind:'session_upserted',sessionId:'native-s',session:{summary:'Old title'}});
    await act(async()=>chat.selectConversation('native-s'));
    await emit({kind:'session_upserted',sessionId:'s',providerSessionId:'native-s',session:{summary:'Renamed'}});
    assert.equal(chat.conversations.filter(c=>c.id==='s'||c.id==='native-s').length,1,'canonical mapping merges both existing rows');
    assert.equal(chat.activeConversationId,'s','selection follows the canonical session');
    assert.equal(chat.activeConversation.title,'Renamed');

    const imageFrame={kind:'text',id:'live-image',role:'user',content:'',transcriptAnchorId:'image-anchor',images:[{data:'data:image/png;base64,AAAA'}]};
    await emit(imageFrame);
    assert.equal(chat.activeConversation.messages.at(-1).attachments[0].dataUrl,'data:image/png;base64,AAAA','image-only live messages are visible');
    await emit(imageFrame);
    assert.equal(chat.activeConversation.messages.filter(m=>m.transcriptAnchorId==='image-anchor').length,1);
    await emit({...imageFrame,id:'path-image',transcriptAnchorId:'path-image',images:[{path:'/uploads/screenshot.png',mimeType:'image/png',name:'Screenshot'}]});
    assert.equal(chat.activeConversation.messages.at(-1).attachments[0].path,'/uploads/screenshot.png','path-backed images retain their preview source');

    const alerts=[];window.alert=message=>alerts.push(message);
    let rejectDelete, deleting;
    globalThis.__claudeState.backend.deleteSession=()=>new Promise((resolve,reject)=>rejectDelete=reject);
    await act(async()=>{deleting=chat.deleteConversation('s');await Promise.resolve();});
    assert.ok(chat.conversations.some(c=>c.id==='s'),'wait for deletion acknowledgement');
    await act(async()=>{rejectDelete(new Error('Delete failed'));await deleting;});
    assert.ok(chat.conversations.some(c=>c.id==='s'),'failed deletion preserves the row');
    assert.match(alerts.at(-1),/Delete failed/);
    globalThis.__claudeState.backend.deleteSession=async()=>({sessionId:'s'});
    await act(async()=>chat.deleteConversation('s'));
    assert.equal(chat.conversations.some(c=>c.id==='s'),false);
    assert.equal(chat.activeConversationId,null);
    await emit({kind:'session_upserted',sessionId:'another',session:{summary:'Another device'}});
    await emit({kind:'session_removed',sessionId:'another'});
    assert.equal(chat.conversations.some(c=>c.id==='another'),false,'deletion propagates from other clients');
    await emit({kind:'session_upserted',sessionId:'removed-elsewhere',session:{summary:'Old cached conversation'}});
    await emit({kind:'text',sessionId:'removed-elsewhere',role:'user',content:'Cached history'});
    await act(async()=>chat.refreshSidebar());
    assert.equal(chat.conversations.some(c=>c.id==='removed-elsewhere'),false,'cached messages do not override the refreshed session list');
    const job={id:'import-check',target:'claude',sourceId:'source',projectPath:'/project',title:'Imported',status:'running',stage:0,createdAt:Date.now(),targetId:'imported-session'};
    await act(async()=>{imports.forEach(fn=>fn([job]));chat.openImport(job);});
    assert.equal(chat.activeImport.id,job.id);
    await assert.rejects(chat.sendMessage('not ready'),/导入完成/);
    await act(async()=>chat.refreshSidebar());
    assert.ok(chat.conversations.some(c=>c.id===job.id),'sidebar refresh preserves running imports');
    await act(async()=>chat.selectConversation('s'));
    await act(async()=>chat.sendMessage('other chat works during import'));
    assert.equal(sent.at(-1)[0],'s');
    await act(async()=>imports.forEach(fn=>fn([{...job,status:'completed',stage:4}])));
    assert.equal(chat.activeConversationId,'s','completion must not steal the active conversation');
    await emit({kind:'complete'});

  } finally {
    if(root)await act(async()=>root.unmount());
    dom.window.close(); await rm(temp,{recursive:true,force:true});
    for(const key of ['window','document','localStorage','sessionStorage','HTMLElement','Node','Event','CustomEvent','IS_REACT_ACT_ENVIRONMENT','__claudeState'])delete globalThis[key];
  }
});
