import assert from 'node:assert/strict';
import {launchOptions} from './browser-runtime.mjs';
const {chromium} = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.CODEX_WEBUI_TEST_URL || 'http://127.0.0.1:8899';
const browser = await chromium.launch(launchOptions());
try {
  for (const path of ['/', '/claude/app/']) {
    const context = await browser.newContext();
    const page = await context.newPage();
    const network = await context.newCDPSession(page);
    await network.send('Network.enable');
    await network.send('Network.setBlockedURLs', {urls: ['*://fonts.googleapis.com/*', '*://fonts.gstatic.com/*', '*://cdn.jsdelivr.net/*']});
    const requests = [];
    page.on('request', request => requests.push(request.url()));
    const ready = async () => {
      await page.waitForFunction(claude => claude
        ? Boolean(document.querySelector('textarea'))
        : Boolean(window.__codexWebuiDebug?.state.connected && document.querySelector('#threadList button')), path.includes('claude'));
      if (path.includes('claude')) {
        assert(await page.evaluate(async () => {
          const faces = await Promise.all(['16px Lora', 'italic 16px Lora', '16px "JetBrains Mono"', '16px KaTeX_Main'].map(font => document.fonts.load(font)));
          return faces.every(list => list.length && list.every(face => face.status === 'loaded'));
        }), 'original text and formula fonts load without external CDNs');
      }
    };
    const response = await page.goto(base + path, {waitUntil: 'domcontentloaded'});
    assert.equal(response.headers()['cache-control'], 'private, no-cache', 'HTML remains private and checks for updates');
    const themeUrl = await page.locator('script[src*="system-theme.js"]').getAttribute('src');
    assert(new URL(themeUrl, base).searchParams.get('v'), 'theme script has an update-safe cache version');
    assert.match((await context.request.get(base + themeUrl)).headers()['cache-control'], /immutable/);
    await ready();
    assert(!requests.some(url => /fonts\.googleapis|fonts\.gstatic|cdn\.jsdelivr/.test(url)), 'startup has no external style/font dependency');
    await page.reload({waitUntil: 'domcontentloaded'});
    await ready();
    const assets = await page.evaluate(() => performance.getEntriesByType('resource')
      .filter(r => /\.(?:js|css|woff2)(?:\?|$)/.test(r.name))
      .map(r => ({url: r.name, transferred: r.transferSize})));
    assert(assets.length >= 3);
    assert.deepEqual(assets.filter(r => r.transferred), [], 'unchanged startup assets use browser cache on reload');
    if (path === '/') {
      await network.send('Network.setBlockedURLs', {urls: ['*://*/api/auth/status']});
      await page.reload({waitUntil: 'domcontentloaded'});
      await ready(); // The gateway already authenticated this page; cookie refresh is background work.
    }
    console.log(`${path}: starts without external CDNs; ${assets.length} assets reused on reload`);
    await context.close();
  }
  for (const path of ['/system-theme.js', '/system-theme.js?v=stale']) {
    assert.equal((await fetch(base + path)).headers.get('cache-control'), 'no-cache', 'unversioned/stale URLs cannot become permanently cached');
  }
} finally { await browser.close(); }
