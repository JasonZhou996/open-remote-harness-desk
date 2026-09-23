import { describe, expect, test } from "bun:test";
import { JSDOM } from "jsdom";
import { LOCALE_STORAGE_KEY, createDomI18n, createI18n, resolveLocale, translate, zhCNMessages } from "../web/codex/i18n.js";

describe("WebUI i18n", () => {
  test("resolves an explicit language before the system language", () => {
    expect(resolveLocale("zh-CN", ["en-US"])).toBe("zh-CN");
    expect(resolveLocale("en", ["zh-CN"])).toBe("en");
    expect(resolveLocale("system", ["zh-Hans-CN", "en"])).toBe("zh-CN");
    expect(resolveLocale("system", ["en-US"])).toBe("en");
  });

  test("persists a supported preference and notifies subscribers", () => {
    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) || null, setItem: (key: string, value: string) => values.set(key, value) };
    const i18n = createI18n({ storage, languages: ["en-US"] });
    let observed = "";
    i18n.subscribe(locale => { observed = locale; });
    expect(i18n.setPreference("zh-CN")).toBe(true);
    expect(i18n.locale).toBe("zh-CN");
    expect(observed).toBe("zh-CN");
    expect(values.get(LOCALE_STORAGE_KEY)).toBe("zh-CN");
    expect(i18n.setPreference("invalid")).toBe(false);
  });

  test("uses English as the fallback and interpolates translated values", () => {
    zhCNMessages["Hello {name}"] = "你好，{name}";
    expect(translate("Hello {name}", "zh-CN", { name: "Codex" })).toBe("你好，Codex");
    expect(translate("Missing {value}", "zh-CN", { value: 2 })).toBe("Missing 2");
    expect(translate("Hello {name}", "en", { name: "Codex" })).toBe("Hello Codex");
    expect(translate("3 changed files", "zh-CN")).toBe("3 个文件已更改");
    expect(translate("Worked for 2m 8s", "zh-CN")).toBe("处理耗时 2m 8s");
    expect(translate("Custom (config.toml)", "zh-CN")).toBe("自定义（config.toml）");
    expect(translate("Unrestricted access to the internet and any file on your computer", "zh-CN")).toBe("不受限制地访问互联网和此电脑上的任意文件");
    expect(translate("Choose project folder", "zh-CN")).toBe("选择项目文件夹");
    expect(translate("No side tasks", "zh-CN")).toBe("没有子任务");
    expect(translate("This task is currently running in another Codex app or CLI. Close it there, then try again.", "zh-CN")).toContain("另一个 Codex 应用或 CLI");
  });

  test("translates dynamic interface text without changing conversation content", async () => {
    const dom = new JSDOM("<!doctype html><html><body><button title='Open settings'>Settings</button><article class='message-text'>Settings</article><div class='activity-output' id='raw-output'>Running command</div><div class='activity-output'><div id='ui-output' data-i18n-ui>Image unavailable</div></div><div class='review-hunks'>Settings</div></body></html>", { url: "http://localhost" });
    const i18n = createI18n({ storage: dom.window.localStorage, languages: ["en"] });
    const binding = createDomI18n(i18n, { root: dom.window.document });
    i18n.setPreference("zh-CN");

    const button = dom.window.document.querySelector("button")!;
    expect(button.textContent).toBe("设置");
    expect(button.title).toBe("打开设置");
    expect(dom.window.document.querySelector(".message-text")!.textContent).toBe("Settings");
    expect(dom.window.document.querySelector("#raw-output")!.textContent).toBe("Running command");
    expect(dom.window.document.querySelector("#ui-output")!.textContent).toBe("图片不可用");
    expect(dom.window.document.querySelector(".review-hunks")!.textContent).toBe("Settings");
    expect(dom.window.document.documentElement.lang).toBe("zh-CN");

    const status = dom.window.document.createElement("span");
    status.textContent = "Running command";
    dom.window.document.body.append(status);
    await new Promise(resolve => dom.window.setTimeout(resolve, 0));
    expect(status.textContent).toBe("正在运行命令");

    i18n.setPreference("en");
    expect(button.textContent).toBe("Settings");
    expect(button.title).toBe("Open settings");
    expect(status.textContent).toBe("Running command");
    expect(dom.window.document.querySelector("#ui-output")!.textContent).toBe("Image unavailable");
    binding.disconnect();
  });
});

// These paths have their own renderers, outside the static settings pages.
test('dynamic import and question UI follows locale while preserving original content', async () => {
  const {renderImportProgress} = await import('../web/shared/session-import');
  const {createQuestionCard} = await import('../web/codex/user-input.js');
  const {englishUiError} = await import('../web/codex/i18n.js');
  const dom = new JSDOM('<body><div id="import"></div></body>', {url:'http://localhost'});
  const previous = globalThis.document;
  globalThis.document = dom.window.document;
  const i18n = createI18n({storage:dom.window.localStorage,languages:['en']});
  const binding = createDomI18n(i18n,{root:dom.window.document});
  try {
    const host=document.querySelector('#import') as HTMLElement;
    const job={id:'test',target:'codex' as const,sourceId:'source',projectPath:'/tmp',title:'Settings',status:'failed' as const,stage:2,createdAt:0,targetId:'target',error:'服务已重启，导入中断，请重试'};
    renderImportProgress(host,job,()=>{},()=>{});
    document.body.append(createQuestionCard([{id:'q',question:'Settings',options:['输入','Review']}],async()=>{}));
    for(const locale of ['zh-CN','en']) {
      i18n.setPreference(locale);
      expect(host.querySelector('h2')?.textContent).toBe(locale==='en'?'Import incomplete':'导入未完成');
      expect(host.querySelector('.session-import-source')?.textContent).toBe('Settings');
      expect(document.querySelector('legend')?.textContent).toBe('Settings');
      expect(document.querySelector('.user-input-option strong')?.textContent).toBe('输入');
      expect(document.querySelector('.user-input-submit')?.textContent).toBe(locale==='en'?'Submit answers':'提交答案');
    }
    expect(host.textContent).not.toMatch(/[\u3400-\u9fff]/);
    expect(translate('Weekly quota: 90% remaining','zh-CN')).toBe('周额度：剩余 90%');
    expect(translate('Enlarge page 2','zh-CN')).toBe('放大第 2 页');
    expect(englishUiError('自定义错误')).toBe('自定义错误');
    expect(englishUiError('toString')).toBe('toString');
  } finally {binding.disconnect();globalThis.document=previous;}
});

test('Claude restores legacy English preference and interpolates only UI labels', async () => {
  const dom=new JSDOM('',{url:'http://localhost'});
  const previous=globalThis.localStorage;
  globalThis.localStorage=dom.window.localStorage;
  try {
    const {loadSettings}=await import('../web/claude/src/services/storage');
    const {t,setUiLanguage}=await import('../web/claude/src/i18n');
    localStorage.setItem('claude_settings_v3',JSON.stringify({language:'English'}));
    expect(loadSettings().language).toBe('en');
    setUiLanguage('en');expect(t('View image: {value0}',{value0:'图片.png'})).toBe('View image: 图片.png');
    setUiLanguage('zh');expect(t('View image: {value0}',{value0:'图片.png'})).toBe('查看图片：图片.png');
  } finally {globalThis.localStorage=previous;}
});
