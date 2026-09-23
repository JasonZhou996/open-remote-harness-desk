import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import path from 'node:path';
const {chromium}=await import('playwright');
const frontend=path.resolve('web/claude'), require=createRequire(path.join(frontend,'package.json'));
const {default:config}=await import('../web/claude/tailwind.config.js');
config.content=[`${frontend}/src/**/*.{ts,tsx}`];
const css=await require('postcss')([require('tailwindcss')(config)]).process(await readFile(`${frontend}/src/index.css`,'utf8'),{from:`${frontend}/src/index.css`});
const bundle=await require('esbuild').build({stdin:{contents:`
  import React from 'react';import {createRoot} from 'react-dom/client';
  import {ClaudeMascot} from './src/components/ClaudeMascot';
  createRoot(document.getElementById('root')).render(<div style={{margin:'100px 16px 0'}}>
    <div data-composer className="relative rounded-[18px] border bg-[var(--bg-input)] p-3">
      <ClaudeMascot label="Replay"/><textarea aria-label="Message" className="w-full bg-transparent"/>
    </div></div>);`,loader:'tsx',resolveDir:frontend},bundle:true,write:false,format:'iife',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'}});
const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH||'/usr/bin/google-chrome'});
try{
  const page=await browser.newPage({viewport:{width:390,height:650},hasTouch:true});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.setContent('<html><body><div id="root"></div></body></html>');
  await page.addStyleTag({content:css.css});await page.addScriptTag({content:bundle.outputFiles[0].text});
  const mascot=page.getByRole('button',{name:'Replay'}),shape=mascot.locator('svg');await shape.waitFor();
  const first=await shape.innerHTML();await page.waitForTimeout(1300);assert.ok(first!==await shape.innerHTML(),'original animation plays');
  await page.waitForTimeout(2500);const end=await shape.innerHTML();
  await page.waitForTimeout(150);assert.equal(await shape.innerHTML(),end,'animation stops instead of looping');
  await page.getByRole('textbox',{name:'Message'}).focus();await mascot.click();
  assert.equal(await page.getByRole('textbox',{name:'Message'}).evaluate(el=>el===document.activeElement),true,'replay does not steal input focus');
  await page.waitForTimeout(1300);assert.ok(await shape.innerHTML()!==end,'click replays');
  await page.emulateMedia({reducedMotion:'reduce'});await page.waitForTimeout(80);const still=await shape.innerHTML();
  await mascot.tap();await page.waitForTimeout(150);assert.equal(await shape.innerHTML(),still,'reduced motion stays still');
  for(const width of [320,840,1440])for(const theme of ['light','dark']){
    await page.setViewportSize({width,height:650});await page.evaluate(theme=>document.documentElement.className=theme,theme);
    const layout=await mascot.evaluate(el=>{const c=el.parentElement.getBoundingClientRect(),m=el.getBoundingClientRect(),s=getComputedStyle(el);return {width:m.width,height:m.height,right:c.right-m.right,overlap:m.bottom-c.top,background:s.backgroundColor,tap:s.webkitTapHighlightColor,selected:getComputedStyle(el.firstElementChild).transform,overflow:document.documentElement.scrollWidth>innerWidth};});
    assert.equal(layout.width,80);assert.equal(layout.height,80);assert.ok(Math.abs(layout.overlap-13)<=1);assert.ok(Math.abs(layout.right)<=1);
    assert.equal(layout.background,'rgba(0, 0, 0, 0)');assert.equal(layout.tap,'rgba(0, 0, 0, 0)');assert.match(layout.selected,/matrix\(-1,/);assert.equal(layout.overflow,false);
  }
  assert.deepEqual(errors,[]);console.log('Claude original mascot: playback, replay, focus, reduced motion, transparent touch background and 320/840/1440px light/dark placement passed');
}finally{await browser.close();}
