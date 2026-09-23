import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {JSDOM} from 'jsdom';

test('Claude message actions copy, retract, and open artifact cards and local links', async () => {
  const frontend=path.resolve('web/claude'), require=createRequire(path.join(frontend,'package.json'));
  const React=require('react'), {act}=React;
  const dom=new JSDOM('<!doctype html><div id="root"></div>',{url:'http://192.168.1.2:8899/claude/app/'});
  for(const key of ['window','document','localStorage','HTMLElement','Node','Event','CustomEvent'])globalThis[key]=dom.window[key];
  const oldNavigator=Object.getOwnPropertyDescriptor(globalThis,'navigator');
  Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true});
  globalThis.IS_REACT_ACT_ENVIRONMENT=true;
  globalThis.ResizeObserver=class {observe(){} disconnect(){}};
  globalThis.__claudeMessageActions={isStreaming:false};
  const temp=await mkdtemp(path.join(tmpdir(),'claude-actions-'));
  const originalFetch=globalThis.fetch;
  let root;
  try {
    const outfile=path.join(temp,'message.mjs');
    await require('esbuild').build({stdin:{contents:'export {ChatMessage} from "./src/components/ChatMessage"; export {ArtifactViewer} from "./src/components/ArtifactViewer"; export {extractArtifactsAndThinking} from "./src/services/artifactParser";',resolveDir:frontend},outfile,bundle:true,platform:'node',format:'esm',jsx:'automatic',loader:{'.svg':'dataurl'},define:{'import.meta.env.BASE_URL':'"/claude/app/"'},logLevel:'silent',plugins:[{
      name:'isolate-chat',setup(b){
        b.onResolve({filter:/^react(?:\/.*)?$/},a=>({path:require.resolve(a.path),external:true}));
        b.onResolve({filter:/ChatContext|i18n/},a=>({path:a.path.includes('ChatContext')?'chat':'i18n',namespace:'mock'}));
        b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:a.path==='chat'?'export const useChat=()=>globalThis.__claudeMessageActions;':'export const t=x=>x;',loader:'js'}));
      }
    }]});
    const {ChatMessage,ArtifactViewer,extractArtifactsAndThinking:parse}=await import(pathToFileURL(outfile));
    const {createRoot}=require('react-dom/client');
    const content='回答正文\n\n```js\nconsole.log("hello");\n```';
    const mount=async()=>{
      if(root)await act(async()=>root.unmount());
      root=createRoot(document.getElementById('root'));
      await act(async()=>root.render(React.createElement(ChatMessage,{message:{id:'a',role:'assistant',content,createdAt:Date.now()}})));
    };
    const copy=()=>document.querySelector('button[title="Copy message"], button[aria-label="复制回答"]');
    let copied=[];
    document.execCommand=command=>{assert.equal(command,'copy');copied.push(document.activeElement.value);return true;};
    await mount();
    await act(async()=>copy().click());
    assert.deepEqual(copied,[content],'HTTP must copy even without navigator.clipboard');
    assert.ok(copy().querySelector('.lucide-check'));
    await act(async()=>document.querySelector('[aria-label="复制代码"]').click());
    assert.equal(copied.at(-1),'console.log("hello");\n');
    assert.equal(document.querySelectorAll('textarea').length,0,'fallback must remove its temporary input');

    await mount(); copied=[];
    Object.defineProperty(navigator,'clipboard',{value:{writeText:async()=>{throw new Error('blocked');}},configurable:true});
    await act(async()=>copy().click());
    assert.deepEqual(copied,[content],'blocked Clipboard API must use the fallback');
    await mount();
    document.execCommand=()=>false;
    await act(async()=>copy().click());
    assert.match(document.querySelector('[role="alert"]')?.textContent||'',/复制失败/);
    assert.equal(copy().querySelector('.lucide-check'),null,'failed copy must not show success');

    await mount(); copied=[];
    navigator.clipboard.writeText=async text=>{copied.push(text);};
    document.execCommand=()=>{throw new Error('must use Clipboard API when available');};
    await act(async()=>copy().click());
    assert.deepEqual(copied,[content]);

    for (const extra of [{}, {thinkingContent:'internal thinking'}, {content:' \n  '}]) {
      await act(async()=>root.render(React.createElement(ChatMessage,{message:{id:'empty',role:'assistant',content:'',createdAt:Date.now(),...extra}})));
      assert.equal(document.getElementById('root').childElementCount,0,'finished empty/thinking records must not leave padded rows between tools');
    }

    const html='<h1>侧栏预览</h1><button>点我</button>';
    const parsed=parse('```html\n'+html+'\n```','artifact-message');
    const artifactMessage={id:'artifact-message',role:'assistant',content:parsed.cleanedText,artifacts:parsed.artifacts,createdAt:Date.now()};
    function PreviewHarness({message}) {
      const [artifact,setActiveArtifact]=React.useState(null),[open,setIsArtifactPaneOpen]=React.useState(false);
      globalThis.__claudeMessageActions={isStreaming:false,setActiveArtifact,setIsArtifactPaneOpen,catalog:{cwd:'/home/user'}};
      return React.createElement(React.Fragment,null,React.createElement(ChatMessage,{message}),open&&artifact&&React.createElement(ArtifactViewer,{artifact,onClose:()=>setIsArtifactPaneOpen(false)}));
    }
    await act(async()=>root.render(React.createElement(PreviewHarness,{message:artifactMessage})));
    await act(async()=>document.querySelector('.cursor-pointer').click());
    assert.equal(document.querySelector('iframe').getAttribute('srcdoc'),html,'artifact card opens the real viewer');
    assert.ok(!document.querySelector('iframe').getAttribute('sandbox').includes('allow-same-origin'));
    const nativeDownloads=[];
    window.CodexBrowser={download:(url,name)=>{nativeDownloads.push({url,name});return true;}};
    globalThis.fetch=async(url,init)=>{
      const target=new URL(url,'http://localhost');
      assert.equal(target.pathname,'/api/attachments');assert.equal(init.method,'POST');assert.equal(init.body,html);
      const filename=target.searchParams.get('name');
      return {ok:true,json:async()=>({path:`/tmp/codex-webui-upload-check/${filename}`,filename})};
    };
    await act(async()=>document.querySelector('[title="Download file"]').click());
    assert.equal(nativeDownloads.length,1);
    assert.match(nativeDownloads[0].url,/^http:\/\/192\.168\.1\.2:8899\/api\/files\/download\?path=/);
    assert.ok(nativeDownloads[0].name.endsWith('.html'));
    await act(async()=>document.querySelector('[title="Close pane"]').click());
    assert.equal(document.querySelector('iframe'),null);
    await act(async()=>[...document.querySelectorAll('button')].find(b=>b.textContent==='Download').click());
    assert.equal(nativeDownloads.length,2,'card download uses the same Android save path');
    assert.equal(document.querySelector('iframe'),null,'downloading a card does not open it');
    globalThis.fetch=async()=>({ok:false,status:400,json:async()=>({error:'下载请求失败'})});
    await act(async()=>document.querySelector('.cursor-pointer').click());
    await act(async()=>document.querySelector('[title="Download file"]').click());
    assert.match(document.querySelector('[role="alert"]').textContent,/下载请求失败/);
    assert.equal(nativeDownloads.length,2,'failed preparation must not claim native save');
    await act(async()=>document.querySelector('[title="Close pane"]').click());

    const links='[HTML](/home/user/artifact_demo.html) [Markdown](preview_test.md) [File URI](file:///home/user/artifact_demo.html) [外网](https://example.com) [危险](javascript:alert%281%29)';
    await act(async()=>root.render(React.createElement(PreviewHarness,{message:{id:'links',role:'assistant',content:links,createdAt:Date.now()}})));
    const link=label=>[...document.querySelectorAll('.claude-prose a')].find(a=>a.textContent===label);
    const requests=[];
    globalThis.fetch=async url=>{
      requests.push(String(url)); const target=new URL(url,'http://localhost');
      assert.equal(target.pathname,'/api/files/preview','preview must use the gateway, not the Claude backend');
      assert.equal(target.searchParams.get('cwd'),'/home/user');
      const md=target.searchParams.get('path')==='preview_test.md';
      return {ok:true,json:async()=>({path:md?'/home/user/preview_test.md':'/home/user/artifact_demo.html',filename:md?'preview_test.md':'artifact_demo.html',kind:md?'markdown':'html',text:md?'# Markdown 预览':html})};
    };
    assert.match(link('HTML').getAttribute('href'),/^\/api\/files\/download\?/);
    assert.equal(link('外网').getAttribute('href'),'https://example.com');
    assert.equal(link('危险').getAttribute('href'),'');
    await act(async()=>link('HTML').click());
    assert.equal(document.querySelector('iframe').getAttribute('srcdoc'),html);
    await act(async()=>document.querySelector('[title="Download file"]').click());
    assert.deepEqual(nativeDownloads.at(-1),{url:'http://192.168.1.2:8899/api/files/download?path=%2Fhome%2Fuser%2Fartifact_demo.html',name:'artifact_demo.html'});
    assert.equal(requests.length,1,'an existing file is downloaded directly, not uploaded again');
    await act(async()=>link('Markdown').click());
    assert.equal(document.querySelector('h1').textContent,'Markdown 预览');
    await act(async()=>document.querySelector('[title="Download file"]').click());
    assert.equal(nativeDownloads.at(-1).name,'preview_test.md','preserve the original Markdown filename');
    await act(async()=>link('File URI').click());
    assert.equal(document.querySelector('iframe').getAttribute('srcdoc'),html);
    assert.equal(requests.length,3);
    const beforeBinary=nativeDownloads.length;
    globalThis.fetch=async()=>({ok:true,json:async()=>({path:'/home/user/文件.pdf',filename:'文件.pdf',kind:'document'})});
    await act(async()=>link('HTML').click());
    assert.equal(nativeDownloads.length,beforeBinary,'opening a file must never start a download');
    await act(async()=>document.querySelector('[title="Download file"]').click());
    assert.equal(nativeDownloads.at(-1).name,'文件.pdf');
    globalThis.fetch=async()=>({ok:false,status:400,json:async()=>({error:'File not found'})});
    await act(async()=>link('Markdown').click());
    assert.match(document.querySelector('[role="alert"]').textContent,/File not found/);

    await act(async()=>root.render(React.createElement(ChatMessage,{message:{id:'user-id',role:'user',content:'撤回我',createdAt:Date.now()}})));
    let recalls=0;
    globalThis.__claudeMessageActions.retractUserMessage=async id=>{assert.equal(id,'user-id');recalls++;throw new Error('服务拒绝撤回');};
    // Re-render so the component receives the action just installed.
    await act(async()=>root.render(React.createElement(ChatMessage,{message:{id:'user-id',role:'user',content:'撤回我',createdAt:Date.now()}})));
    window.confirm=()=>{throw new Error('retraction must execute without a confirmation dialog');};
    await act(async()=>document.querySelector('[aria-label="撤回消息"]').click());assert.equal(recalls,1);
    assert.match(document.querySelector('[role="alert"]').textContent,/服务拒绝撤回/);
    assert.ok(document.body.textContent.includes('撤回我'),'failed retraction must preserve the bubble');
  } finally {
    globalThis.fetch=originalFetch;
    if(root)await act(async()=>root.unmount());
    dom.window.close(); await rm(temp,{recursive:true,force:true});
    for(const key of ['window','document','localStorage','HTMLElement','Node','Event','CustomEvent','ResizeObserver','IS_REACT_ACT_ENVIRONMENT','__claudeMessageActions'])delete globalThis[key];
    if(oldNavigator)Object.defineProperty(globalThis,'navigator',oldNavigator);else delete globalThis.navigator;
  }
});
