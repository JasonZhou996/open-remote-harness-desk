import assert from 'node:assert/strict';
import {launchOptions} from './browser-runtime.mjs';
const {chromium} = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch(launchOptions());
try {
  const page = await browser.newPage({viewport:{width:1440,height:900}});
  // Uploads are mocked and model/session writes are blocked.
  let finishUpload;
  let uploadGate = Promise.resolve();
  await page.route('**/api/**', async route => {
    if (route.request().url().includes('/api/assets/files') && route.request().method() === 'POST') {
      await uploadGate;
      await route.fulfill({json:{attachments:[{path:'/tmp/new-chat-check.png',name:'new-chat-check.png',mimeType:'image/png',size:1}]}});
    } else if (['GET','HEAD','OPTIONS'].includes(route.request().method())) await route.continue();
    else await route.abort();
  });
  await page.goto((process.env.CODEX_WEBUI_TEST_URL || 'http://127.0.0.1:8899') + '/claude/app/', {waitUntil:'domcontentloaded'});
  const input = page.getByRole('textbox',{name:'消息',exact:true});
  const newChat = page.getByRole('button',{name:/Start new conversation|新建聊天/,exact:true});
  await input.waitFor();
  await newChat.click();
  const upload = () => page.locator('input[type=file][accept="image/*"]').setInputFiles({name:'new-chat-check.png',mimeType:'image/png',buffer:Buffer.from('test')});
  await input.fill('这是上一个新对话的草稿');
  await upload();
  await page.getByRole('button',{name:'移除附件',exact:true}).waitFor();
  await newChat.click();
  assert.equal(await input.inputValue(), '', 'repeated New chat clears old text');
  assert.equal(await page.getByRole('button',{name:'移除附件',exact:true}).count(), 0, 'repeated New chat clears attachments');
  // A fresh draft survives reload, but the next explicit New chat still clears it.
  await input.fill('刷新保留当前草稿');
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForFunction(() => document.querySelector('textarea[aria-label="消息"]')?.value === '刷新保留当前草稿');
  await newChat.click();
  assert.equal(await input.inputValue(), '');
  // An upload finishing for a discarded draft cannot reappear in the new one.
  uploadGate = new Promise(resolve => finishUpload = resolve);
  const started = page.waitForRequest(request => request.url().includes('/api/assets/files') && request.method() === 'POST');
  await upload(); await started;
  await newChat.click();
  const completed = page.waitForResponse(response => response.url().includes('/api/assets/files') && response.request().method() === 'POST');
  finishUpload(); await completed;
  await page.waitForFunction(() => document.querySelector('input[accept="image/*"]').value === '');
  assert.equal(await input.inputValue(), '');
  assert.equal(await page.getByRole('button',{name:'移除附件',exact:true}).count(), 0);
  console.log('PASS: repeated New chat clears text/images; refresh keeps current draft; late upload stays with old draft. No model requests sent.');
} finally { await browser.close(); }
