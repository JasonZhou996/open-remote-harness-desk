import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {launchOptions} from './browser-runtime.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
let upstreamHeaders;
let slowClosed;const cancelled=new Promise(resolve=>{slowClosed=resolve});
const site=createServer((req,res)=>{
 upstreamHeaders=req.headers;
 if(req.url.startsWith('/gbk')){
  res.writeHead(200,{'content-type':req.url==='/gbk-header'?'text/html; charset=gb2312':'text/html'});
  res.end(Buffer.concat([Buffer.from('<!doctype html><meta charset="gbk"><h1>'),Buffer.from([0xd6,0xd0,0xce,0xc4]),Buffer.from('</h1><!--'+'padding '.repeat(250)+'-->')]));return;
 }
 if(req.url==='/slow-image'){res.once('close',slowClosed);res.writeHead(200,{'content-type':'image/png'});res.flushHeaders();return;}
 if(req.url==='/style.css'){res.writeHead(200,{'content-type':'text/css'});res.end('body{color:rgb(12,34,56)}');return;}
 if(req.url==='/interactive'){
  res.writeHead(200,{'content-type':'text/html'});
  res.end('<!doctype html><link rel="stylesheet" href="/style.css"><style>button{background-image:url("/slow-image")}</style><body><button onclick="this.textContent=\'Clicked\'">Click me</button><img src="/slow-image"><script>window.originalPattern=/src="asset"/;</script>');return;
 }
 res.writeHead(req.url==='/denied'?403:200,{'content-type':'text/html'});res.end('<!doctype html><h1>Browser recovery check</h1>');
});
await new Promise(resolve=>site.listen(0,'127.0.0.1',resolve));
const target=`http://127.0.0.1:${site.address().port}`;
const browser=await chromium.launch(launchOptions());
try{
 const page=await browser.newPage({locale:'zh-CN'});
 await page.goto(process.env.CODEX_WEBUI_TEST_URL||'http://127.0.0.1:8899',{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>globalThis.__codexWebuiDebug?.state.connected);
 await page.locator('#toggleSidePanel').click();await page.locator('[data-side-panel-action="browser"]').click();
 const navigate=async url=>{await page.locator('#browserUrl').fill(url);await page.locator('#browserUrl').press('Enter');};
 await navigate(target+'/denied');
 await page.waitForFunction(()=>document.querySelector('#browserStatus').dataset.tone==='error');
 assert.match(await page.locator('#browserNoticeDescription').textContent(),/HTTP 403/);
 assert.equal(await page.locator('#browserFrameShell').getAttribute('aria-busy'),'false');
 await navigate(target+'/ok');
 await page.frameLocator('#browserFrame').getByRole('heading',{name:'Browser recovery check'}).waitFor();
 await page.waitForFunction(()=>document.querySelector('#browserStatus').dataset.tone==='loaded');
 assert.equal(await page.locator('#browserNotice').isVisible(),false);
 assert.equal(upstreamHeaders['user-agent'],await page.evaluate(()=>navigator.userAgent));
 assert.match(upstreamHeaders['accept-language'],/^zh-CN/);
 assert.equal(upstreamHeaders['sec-ch-ua-platform'],await page.evaluate(()=>JSON.stringify(navigator.userAgentData.platform)));
 for(const path of ['/gbk-header','/gbk-meta']){
  const response=page.waitForResponse(r=>r.url().endsWith(path));
  await navigate(target+path);
  assert.equal((await response).headers()['content-encoding'],'gzip');
  await page.frameLocator('#browserFrame').getByRole('heading',{name:'中文',exact:true}).waitFor({timeout:5000});
  assert.equal(await page.frameLocator('#browserFrame').locator('body').evaluate(node=>node.ownerDocument.characterSet),'UTF-8');
 }
 const uncompressed=await page.request.get(new URL(await page.locator('#browserFrame').getAttribute('src'),page.url()).href,{headers:{'Accept-Encoding':'gzip;q=0'}});
 assert.equal(uncompressed.headers()['content-encoding'],undefined);
 await navigate(target+'/interactive');
 const content=page.frameLocator('#browserFrame');
 await content.getByRole('button',{name:'Click me'}).waitFor();
 assert.equal(await content.locator('body').evaluate(()=>String(window.originalPattern)),'/src="asset"/');
 await page.waitForFunction(()=>document.querySelector('#browserLoading').hidden,{},{timeout:2000});
 assert.equal(await content.locator('body').evaluate(node=>getComputedStyle(node).color),'rgb(12, 34, 56)');
 assert.match(await content.getByRole('button').evaluate(node=>getComputedStyle(node).backgroundImage),/\/api\/browser\/local\/.*\/slow-image/);
 await content.getByRole('button',{name:'Click me'}).click();
 assert.equal(await content.getByRole('button').textContent(),'Clicked');
 await navigate(target+'/ok');
 await page.frameLocator('#browserFrame').getByRole('heading',{name:'Browser recovery check'}).waitFor();
 await Promise.race([cancelled,new Promise((_,reject)=>setTimeout(()=>reject(new Error('Abandoned upstream request was not cancelled')),2000))]);
 site.closeAllConnections();
 await new Promise(resolve=>site.close(resolve));
 await navigate(target+'/offline');
 await page.waitForFunction(()=>document.querySelector('#browserStatus').dataset.tone==='error');
 assert.match(await page.locator('#browserNoticeDescription').textContent(),/无法连接网站/);
 console.log('PASS: client UA/language/hints; GBK header/meta; gzip negotiation; scripts/CSS; interaction before slow image; request cancellation; HTTP/offline recovery');
}finally{await browser.close();site.closeAllConnections();if(site.listening)await new Promise(resolve=>site.close(resolve));}
