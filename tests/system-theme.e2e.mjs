import assert from 'node:assert/strict';
import {launchOptions} from './browser-runtime.mjs';
const {chromium} = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch(launchOptions());
try {
  for (const path of ['/', '/claude/app/']) {
    const page = await browser.newPage({colorScheme:'light'});
    await page.addInitScript(() => {
      localStorage.setItem('codex-webui-theme', 'dark');
      window.themeCalls = [];
      window.CodexBrowser = {setTheme:(dark, color) => window.themeCalls.push({dark, color})};
    });
    await page.route('**/api/**', route => ['GET','HEAD','OPTIONS'].includes(route.request().method()) ? route.continue() : route.abort());
    await page.goto((process.env.CODEX_WEBUI_TEST_URL || 'http://127.0.0.1:8899') + path, {waitUntil:'domcontentloaded'});
    await page.waitForFunction(() => window.themeCalls.length);
    const check = async dark => {
      await page.waitForFunction(dark => window.themeCalls.at(-1)?.dark === dark, dark);
      const state = await page.evaluate(() => ({
        native:window.themeCalls.at(-1),
        color:document.querySelector('meta[name="theme-color"]').content,
        apple:document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]').content,
        scheme:document.documentElement.style.colorScheme,
      }));
      assert.equal(state.apple, dark ? 'black' : 'default');
      assert.equal(state.scheme, dark ? 'dark' : 'light');
      assert.equal(state.native.color, state.color);
      assert.equal(state.color.toLowerCase(), path === '/' ? (dark ? '#181818' : '#fff') : (dark ? '#141413' : '#faf9f5'));
    };
    const select = async theme => page.evaluate(theme => {
      if (theme === null) localStorage.removeItem('codex-webui-theme');
      else localStorage.setItem('codex-webui-theme', theme);
      dispatchEvent(new StorageEvent('storage', {key:'codex-webui-theme', newValue:theme}));
    }, theme);
    await check(true);
    await select('light'); await check(false);
    await select('dark'); await check(true);
    await select(null); await check(false);
    await page.emulateMedia({colorScheme:'dark'}); await check(true);
    await page.emulateMedia({colorScheme:'light'}); await check(false);
    // Embedded web content cannot recolor the host app's native bars.
    await page.evaluate(() => {
      window.frameThemeCalls = 0;
      const frame = document.createElement('iframe');
      frame.srcdoc = '<script>window.CodexBrowser={setTheme:()=>parent.frameThemeCalls++}</script><script src="/system-theme.js"></script>';
      document.body.append(frame);
      return new Promise(resolve => frame.onload = resolve);
    });
    assert.equal(await page.evaluate(() => window.frameThemeCalls), 0);
    console.log(`${path}: startup, manual, system, iOS metadata and native bridge follow theme; iframe ignored`);
    await page.close();
  }
} finally { await browser.close(); }
