import assert from 'node:assert/strict';
import { DesktopSync, desktopThread } from '../server/codex/desktop-sync.mjs';
import { mergeConversationTurns } from '../server/codex/thread-history.js';
import { launchOptions } from './browser-runtime.mjs';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');

const events = [], sync = new DesktopSync(event => events.push(event));
const native = { id: 'compaction-check', turns: [{ turnId: 'turn', status: 'inProgress', items: [
  { id: 'compact', type: 'contextCompaction', completed: false, source: 'automatic' },
] }] };
sync.followed.set(native.id, { owner: 'desktop', revision: null, state: null });
sync.receive({ method: 'thread-stream-state-changed', sourceClientId: 'desktop', params: {
  conversationId: native.id, change: { type: 'snapshot', revision: 1, conversationState: structuredClone(native) },
} });
const started = events.filter(event => event.params.item).at(-1);
console.log('Native compaction start mapped to:', started.method);

const browser = await chromium.launch(launchOptions());
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 750 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => { if (window === window.top) localStorage.setItem('codex-webui-locale', 'zh-CN'); });
  await page.goto(process.env.CODEX_WEBUI_TEST_URL || 'http://127.0.0.1:8899', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => globalThis.__codexWebuiDebug);
  await page.evaluate(({ id, event }) => {
    const api = globalThis.__codexWebuiDebug;
    api.state.active = { id, turns: [] };
    document.querySelector('#conversation').replaceChildren();
    api.notify(event.method, event.params);
  }, { id: native.id, event: started });
  assert.equal(await page.locator('.context-compaction').count(), 1, 'Web must show the native compaction item');
  assert.equal(started.method, 'item/started');
  assert.equal(await page.locator('.context-compaction').textContent(), '正在自动压缩上下文');
  assert.equal(await page.locator('.context-compaction').getAttribute('aria-busy'), 'true');

  sync.receive({ method: 'thread-stream-state-changed', sourceClientId: 'desktop', params: {
    conversationId: native.id, change: { type: 'patches', baseRevision: 1, revision: 2,
      patches: [{ op: 'replace', path: ['turns', 0, 'items', 0, 'completed'], value: true }] },
  } });
  const completed = events.filter(event => event.params.item).at(-1);
  assert.equal(completed.method, 'item/completed');
  await page.evaluate(event => globalThis.__codexWebuiDebug.notify(event.method, event.params), completed);
  assert.equal(await page.locator('.context-compaction').count(), 1, 'completion updates the existing row');
  assert.equal(await page.locator('.context-compaction').textContent(), '上下文已自动压缩');
  assert.equal(await page.locator('.context-compaction').getAttribute('aria-busy'), 'false');

  const interrupted = structuredClone(native);
  interrupted.turns[0].turnId = 'stopped-turn';
  interrupted.turns[0].status = 'interrupted';
  interrupted.turns[0].items[0].id = 'stopped-compact';
  const history = desktopThread(interrupted).turns[0];
  await page.evaluate(turn => globalThis.__codexWebuiDebug.syncTurnSnapshot(turn), history);
  assert.equal(await page.locator('[data-item-id="stopped-compact"]').textContent(), '上下文压缩已中断');

  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => globalThis.__codexWebuiDebug);
  const completedHistory = mergeConversationTurns([], desktopThread(sync.followed.get(native.id).state).turns)[0];
  await page.evaluate(({ id, turn }) => {
    const api = globalThis.__codexWebuiDebug;
    api.state.active = { id, turns: [] };
    document.querySelector('#conversation').replaceChildren();
    api.syncTurnSnapshot(turn);
  }, { id: native.id, turn: completedHistory });
  assert.equal(await page.locator('.context-compaction').textContent(), '上下文已自动压缩');
  await page.evaluate(() => globalThis.__codexWebuiDebug.setSidebarOpen(true));
  const sidebar = await page.locator('#sidebar').boundingBox();
  const topbar = await page.locator('.topbar').boundingBox();
  assert.equal(sidebar.y, 0, 'desktop sidebar must start at the top of the viewport');
  assert.equal(topbar.x, sidebar.x + sidebar.width, 'desktop header starts beside the sidebar');
  await page.evaluate(() => globalThis.__codexWebuiDebug.setSidebarOpen(false));
  await page.waitForFunction(() => document.querySelector('#sidebar').getBoundingClientRect().width === 0);
  assert.equal((await page.locator('.topbar').boundingBox()).x, 0, 'collapsed sidebar leaves no blank header column');
  await page.evaluate(() => globalThis.__codexWebuiDebug.setSidebarOpen(true));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => globalThis.__codexWebuiDebug.setSidebarOpen(false));
  await page.waitForFunction(() => getComputedStyle(document.querySelector('#sidebar')).opacity === '0');
  assert.ok(await page.locator('.context-compaction').isVisible());
  await page.screenshot({ path: '/tmp/codex-compaction-web-20260921.png' });
  assert.deepEqual(errors, []);
  await page.evaluate(() => globalThis.__codexWebuiDebug.setSidebarOpen(true));
  assert.equal(await page.locator('#sidebar').evaluate(el => getComputedStyle(el).position), 'fixed');
  assert.equal((await page.locator('#sidebar').boundingBox()).y, 46, 'mobile drawer remains below its toolbar');
  console.log('PASS: native compaction start/completion/history; desktop sidebar at top; collapse; mobile layout');
} finally { sync.close(); await browser.close(); }
