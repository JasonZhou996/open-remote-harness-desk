import assert from 'node:assert/strict';
import {artifact,launchOptions} from './browser-runtime.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const base=process.env.CODEX_WEBUI_TEST_URL||'http://127.0.0.1:8899';
const browser=await chromium.launch(launchOptions());
try{
 for(const theme of ['light','dark']){
  const context=await browser.newContext({viewport:{width:1280,height:900},colorScheme:theme});
  await context.addInitScript(theme=>{if(window===window.top)localStorage.setItem('codex-webui-theme',theme);},theme);
  await context.route('**/zcode/client*',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>ZCode test surface</title>'}));
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  for(const [product,path] of [['codex','/'],['claude','/claude/app/'],['zcode','/zcode']]){
   await page.goto(base+path,{waitUntil:'domcontentloaded'});
   const host=page.locator(`product-switcher[product="${product}"]`),trigger=host.getByRole('button',{name:'切换应用',exact:true}),menu=host.getByRole('menu');
   await trigger.click();
   assert.deepEqual(await menu.getByRole('menuitemradio').allTextContents(),['Codex','ZCode','Claude']);
   assert.equal(await menu.locator('[aria-checked=true]').getAttribute('data-product'),product);
   const style=await menu.evaluate(el=>{const s=getComputedStyle(el),r=el.getBoundingClientRect();return{background:s.backgroundColor,color:s.color,radius:s.borderRadius,width:r.width,left:r.left,right:r.right};});
   assert.equal(style.radius,'14px');assert.equal(style.width,208);
   const red=Number(style.background.match(/[\d.]+/)[0]);assert.ok(theme==='light'?red>180:red<80,`${product} ${theme}: ${style.background}`);
   await page.screenshot({path:artifact(`product-switcher-${product}-${theme}.png`),clip:{x:0,y:0,width:300,height:230}});
   await page.keyboard.press('Escape');assert.equal(await menu.isVisible(),false);
   await trigger.focus();await page.keyboard.press('ArrowUp');
   assert.equal(await host.evaluate(el=>el.shadowRoot.activeElement?.textContent.trim()),'Claude');
   await page.keyboard.press('Home');assert.equal(await host.evaluate(el=>el.shadowRoot.activeElement?.textContent.trim()),'Codex');
   await page.keyboard.press('Escape');
   await trigger.click();await page.mouse.click(600,260);assert.equal(await menu.isVisible(),false);
   await page.setViewportSize({width:390,height:844});
   if(product==='codex')await page.locator('#toggleSidebar').click();
   if(product==='claude'&&await page.getByRole('button',{name:'打开侧边栏',exact:true}).isVisible())await page.getByRole('button',{name:'打开侧边栏',exact:true}).click();
   await trigger.click();
   const rect=await menu.boundingBox();assert.ok(rect.x>=0&&rect.x+rect.width<=390&&rect.y+rect.height<=844);
   await page.keyboard.press('Escape');
   await page.setViewportSize({width:1280,height:900});
   console.log(`PASS: ${product} ${theme}, shared menu, selected state, keyboard, outside dismissal and narrow viewport`);
  }
  // Navigate through the actual menu; keep a Codex draft through both sibling products.
  await page.locator('product-switcher[product="zcode"]').getByRole('button',{name:'切换应用',exact:true}).click();
  await page.getByRole('menuitemradio',{name:'Codex',exact:true}).click();await page.waitForURL(base+'/',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>globalThis.__codexWebuiDebug?.state.connected);
  await page.locator('#prompt').fill('retain switcher draft');
  await page.locator('product-switcher[product="codex"]').getByRole('button',{name:'切换应用',exact:true}).click();
  await page.getByRole('menuitemradio',{name:'Claude',exact:true}).click();await page.waitForURL('**/claude/app/',{waitUntil:'domcontentloaded'});
  await page.locator('product-switcher[product="claude"]').getByRole('button',{name:'切换应用',exact:true}).click();
  await page.getByRole('menuitemradio',{name:'ZCode',exact:true}).click();await page.waitForURL('**/zcode',{waitUntil:'domcontentloaded'});
  await page.locator('product-switcher[product="zcode"]').getByRole('button',{name:'切换应用',exact:true}).click();
  await page.getByRole('menuitemradio',{name:'Codex',exact:true}).click();await page.waitForURL(base+'/',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>document.querySelector('#prompt')?.value==='retain switcher draft');
  assert.deepEqual(errors,[]);await context.close();
  console.log(`PASS: ${theme} Codex -> Claude -> ZCode -> Codex restores draft; no model messages sent`);
 }
}finally{await browser.close();}
