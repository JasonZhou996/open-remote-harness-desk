import assert from 'node:assert/strict';
const { chromium, devices } = await import(process.env.PLAYWRIGHT_MODULE||'playwright');
import { artifact, launchOptions } from './browser-runtime.mjs';

const browser=await chromium.launch(launchOptions());
try {
// Touch-capable PCs stay desktop, including users with an old collapsed mobile view.
for(const hasTouch of [true,false]){
  const desktop=await browser.newContext({viewport:{width:1920,height:1080},screen:{width:1920,height:1200},hasTouch});
  await desktop.addInitScript(touch=>{if(!localStorage.getItem('codex-webui-workspace-view'))localStorage.setItem('codex-webui-workspace-view',JSON.stringify({sidebar:false,...(touch?{}:{sidebarMobile:true}),draft:'keep this draft'}));},hasTouch);
  const page=await desktop.newPage();
  await page.goto(process.env.CODEX_WEBUI_TEST_URL||'http://127.0.0.1:8899',{waitUntil:'networkidle'});
  assert.equal(await page.locator('html').evaluate(el=>el.classList.contains('mobile-device')),false,'wide touch screen is a desktop');
  await page.waitForFunction(()=>document.querySelector('#sidebar').getBoundingClientRect().width>250);
  assert.notEqual(await page.locator('#sidebar').evaluate(el=>getComputedStyle(el).position),'fixed');
  assert.equal(await page.locator('#prompt').inputValue(),'keep this draft');
  await page.click('#toggleSidebar');
  await page.reload({waitUntil:'networkidle'});
  assert.equal(await page.locator('body').evaluate(el=>el.classList.contains('sidebar-hidden')),true,'explicit desktop collapse survives refresh');
  await page.setViewportSize({width:600,height:900});
  assert.equal(await page.locator('#sidebar').evaluate(el=>getComputedStyle(el).position),'fixed');
  await page.setViewportSize({width:1920,height:1080});
  await page.waitForFunction(()=>document.querySelector('#sidebar').getBoundingClientRect().width>250);
  await desktop.close();
}
// An unfolded phone remains mobile even when both screen dimensions exceed the narrow breakpoint.
const foldable=await browser.newContext({...devices['Pixel 7'],viewport:{width:900,height:840},screen:{width:900,height:840}});
const foldedPage=await foldable.newPage();
await foldedPage.goto(process.env.CODEX_WEBUI_TEST_URL||'http://127.0.0.1:8899',{waitUntil:'networkidle'});
assert.equal(await foldedPage.locator('html').evaluate(el=>el.classList.contains('mobile-device')),true);
assert.equal(await foldedPage.locator('#sidebar').evaluate(el=>getComputedStyle(el).position),'fixed');
assert.equal(await foldedPage.locator('#toggleSidebar').getAttribute('aria-expanded'),'false');
await foldedPage.click('#toggleSidebar');
assert.equal(await foldedPage.locator('#sidebar').evaluate(el=>el.classList.contains('mobile-open')),true);
await foldable.close();
const context=await browser.newContext({
  ...devices['Pixel 7'],
  viewport:{width:980,height:1800},
  screen:{width:412,height:915},
  isMobile:true,
  hasTouch:true,
});
const page=await context.newPage();
await page.goto(process.env.CODEX_WEBUI_TEST_URL||'http://127.0.0.1:8899',{waitUntil:'networkidle'});
const before=await page.evaluate(()=>({
  innerWidth,
  coarse:matchMedia('(pointer: coarse)').matches,
  mobileClass:document.documentElement.classList.contains('mobile-device'),
  sidebarX:document.querySelector('#sidebar').getBoundingClientRect().x,
  sidebarPosition:getComputedStyle(document.querySelector('#sidebar')).position,
  sidebarShadow:getComputedStyle(document.querySelector('#sidebar')).boxShadow,
}));
await page.click('#toggleSidebar');
await page.waitForFunction(()=>Math.abs(document.querySelector('#sidebar').getBoundingClientRect().x)<.5);
const after=await page.evaluate(()=>{const sidebar=document.querySelector('#sidebar'),rect=sidebar.getBoundingClientRect();return{
  x:rect.x,
  right:rect.right,
  width:rect.width,
  mobileOpen:sidebar.classList.contains('mobile-open'),
  bodyHidden:document.body.classList.contains('sidebar-hidden'),
  position:getComputedStyle(sidebar).position,
  shadow:getComputedStyle(sidebar).boxShadow,
  topElement:document.elementFromPoint(Math.min(rect.right-10,innerWidth-10),Math.min(rect.top+20,innerHeight-10))?.closest('#sidebar')===sidebar,
}});
await page.screenshot({path:artifact('mobile-device-sidebar.png'),fullPage:false});
console.log(JSON.stringify({before,after},null,2));
assert.ok(before.coarse&&before.mobileClass&&before.sidebarPosition==='fixed'&&before.sidebarX<0&&before.sidebarShadow==='none'&&after.mobileOpen&&!after.bodyHidden&&Math.abs(after.x)<.5&&after.width<=948&&after.shadow!=='none'&&after.topElement,'phone keeps its overlay sidebar even with a desktop-site viewport');
console.log('PASS: regular/touch desktop, old saved mobile state, remembered desktop collapse, window resize, unfolded phone, and phone desktop-site layout');
} finally {await browser.close();}
