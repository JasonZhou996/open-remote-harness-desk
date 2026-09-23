import assert from 'node:assert/strict';
import {launchOptions} from './browser-runtime.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch(launchOptions());
try {
  const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>{if(window!==window.top)return;window.CodexBrowser={hide(){}};window.EventSource=class {constructor(url){if(url==='/api/events')queueMicrotask(()=>this.onmessage?.({data:JSON.stringify({type:'bridge/status',status:'connected'})}))}close(){}}});
  await page.route('**/api/rpc',route=>route.fulfill({json:{type:'rpc/result',id:route.request().postDataJSON().id,result:{data:[]}}}));
  if(process.env.CODEX_WEBUI_TEST_BUNDLE)await page.route('**/app.bundle.js*',route=>route.fulfill({path:process.env.CODEX_WEBUI_TEST_BUNDLE,contentType:'application/javascript'}));
  await page.goto((process.env.CODEX_WEBUI_TEST_URL||'http://127.0.0.1:8899')+'/settings/general-settings',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>document.querySelector('#settingsDialog')?.open);
  for(const selected of ['appearance','agent','general-settings']){
    await page.locator('.settings-page:not([hidden]) .settings-mobile-back').click();
    assert.equal(await page.locator('.settings-nav').isVisible(),true);
    await page.locator(`[data-settings-page="${selected}"]`).click();
    assert.equal(await page.locator('#settingsContent').isVisible(),true,`${selected}: selection must reveal content`);
    assert.equal(await page.locator('.settings-nav').isVisible(),false);
    assert.equal(new URL(page.url()).pathname,`/settings/${selected}`);
    assert.equal(await page.locator('.settings-page:not([hidden]) .settings-mobile-back').evaluate(el=>el===document.activeElement),true);
  }
  for(const width of [320,480,600,1280,390]){
    await page.setViewportSize({width,height:844});
    await page.waitForFunction(()=>document.querySelector('#settingsContent').getBoundingClientRect().width>0);
    assert.equal(await page.locator('.settings-nav').isVisible(),width>480);
    assert.equal(await page.locator('#settingsContent').evaluate(el=>el.scrollWidth<=el.clientWidth+1),true,`no content overflow at ${width}`);
  }
  await page.locator('.settings-page:not([hidden]) .settings-mobile-back').click();
  await page.locator('[data-settings-page="appearance"]').click();
  await page.locator('#themeSelect').selectOption('dark');
  assert.equal(await page.locator('#themeSelect').inputValue(),'dark');
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>document.querySelector('#settingsDialog')?.open);
  assert.equal(await page.locator('#themeSelect').isVisible(),true,'direct route survives reload');
  assert.equal(await page.locator('#themeSelect').inputValue(),'dark');
  await page.screenshot({path:'/tmp/codex-settings-narrow.png'});
  assert.deepEqual(errors,[]);
  console.log('PASS: narrow settings navigation, page controls, reload and 320/390/480/600/1280px layouts');
} finally {await browser.close();}
