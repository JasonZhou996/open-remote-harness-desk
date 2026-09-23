import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import {renderAssistantMarkdown} from '../web/codex/rendering.js';

// Standalone DOM, no live task, account, or desktop app.
const dom=new JSDOM('<body></body>',{url:'http://192.168.1.100:8899/',runScripts:'outside-only'});
const {window}=dom,calls=[];
const source=readFileSync(new URL('../web/codex/app.js',import.meta.url),'utf8');
const start=source.indexOf('function downloadLinkInAndroid(');
assert.notEqual(start,-1,'Download click handler must exist');
window.CodexBrowser={download:(url,name)=>{calls.push({url,name});return true}};
window.nativeBrowser=()=>window.CodexBrowser;
window.toast=message=>{throw new Error(message)};
window.eval(source.slice(start,source.indexOf('let nativeBrowserState=',start)));
function click(html){
  window.document.body.innerHTML=html;
  const event=new window.MouseEvent('click',{bubbles:true,cancelable:true});
  window.document.querySelector('a').dispatchEvent(event);
  return event.defaultPrevented;
}
const publicLink='https://web.example.com/api/files/download?path=%2Ftmp%2F%E6%96%87%E4%BB%B6.pdf';
assert.equal(click(renderAssistantMarkdown(`[下载文件](${publicLink})`)),true,'Rendered target=_blank download must invoke Android directly');
assert.deepEqual(calls.pop(),{url:publicLink,name:'文件.pdf'});
assert.equal(click('<a id="fileDownload" data-file-download download="计划.md" href="/api/files/download?path=%2Ftmp%2Fplan.md">下载</a>'),true);
assert.equal(calls.pop().name,'计划.md');
assert.equal(click('<a data-file-reference href="#file-reference">预览文档</a>'),false);
assert.equal(click('<a href="#ordinary-link">普通链接</a>'),false);
window.CodexBrowser={}; // Previous APKs must retain their original browser download path.
assert.equal(click('<a download href="#old-apk">下载</a>'),false);
window.CodexBrowser={download:()=>false};
assert.equal(click('<a download href="#not-handled">下载</a>'),false);
assert.equal(calls.length,0);
dom.window.close();
console.log('PASS: rendered message download and preview download invoke native save; preview/old APK fallback retained');
