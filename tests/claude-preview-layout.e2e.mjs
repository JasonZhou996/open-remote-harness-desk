import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import path from 'node:path';
const {chromium}=await import('playwright');

const frontend=path.resolve('web/claude'), require=createRequire(path.join(frontend,'package.json'));
const {default:config}=await import('../web/claude/tailwind.config.js');
config.content=[`${frontend}/src/**/*.{ts,tsx}`];
const css=await require('postcss')([require('tailwindcss')(config)]).process(await readFile(`${frontend}/src/index.css`,'utf8'),{from:`${frontend}/src/index.css`});
const bundle=await require('esbuild').build({stdin:{contents:String.raw`
  import React from 'react'; import {createRoot} from 'react-dom/client';
  import {ArtifactViewer} from './src/components/ArtifactViewer';
  import {ChatMessage} from './src/components/ChatMessage';
  function Preview(){const[open,setOpen]=React.useState(true);return <div className="flex-1 flex min-h-0 relative overflow-hidden">
    <main className="flex-1 min-w-0 h-full" data-chat><button onClick={()=>setOpen(true)}>Open</button>
      <ChatMessage message={{id:'text',role:'assistant',content:'正文与 Codex 同字号。',createdAt:0}}/>
      <ChatMessage message={{id:'tool1',role:'tool',content:'',toolUse:{toolName:'Bash',input:{command:'pwd'}},toolResult:{content:'ok'}}}/>
      <ChatMessage message={{id:'thinking',role:'assistant',content:'',thinkingContent:'done',createdAt:0}}/>
      <ChatMessage message={{id:'tool2',role:'tool',content:'',toolUse:{toolName:'Bash',input:{command:'ls'}},toolResult:{content:'ok'}}}/>
    </main>
    {open&&<ArtifactViewer artifact={{id:'test',type:'text/html',title:'Preview test',identifier:'preview-test',content:'<h1>Preview</h1><button onclick="this.textContent=\'clicked\'">Click</button>'}} onClose={()=>setOpen(false)}/>}
  </div>};createRoot(document.getElementById('root')).render(<Preview/>);`,loader:'tsx',resolveDir:frontend},bundle:true,write:false,format:'iife',jsx:'automatic',loader:{'.svg':'dataurl'},define:{'process.env.NODE_ENV':'"production"','import.meta.env.BASE_URL':'"/claude/app/"'},plugins:[{name:'isolate-chat',setup(b){b.onResolve({filter:/\/(?:i18n|context\/ChatContext)$/},a=>({path:a.path.includes('ChatContext')?'chat':'i18n',namespace:'test'}));b.onLoad({filter:/.*/,namespace:'test'},a=>({contents:a.path==='chat'?'export const useChat=()=>({isStreaming:false});':'export const t=x=>x;'}));}}]});
const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH||'/usr/bin/google-chrome'});
try{
  for(const width of [320,390,840,1440]){
    const page=await browser.newPage({viewport:{width,height:850},hasTouch:true});
    await page.setContent('<html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root" class="flex h-[100dvh] w-full overflow-hidden"></div></body></html>');
    await page.addStyleTag({content:css.css});await page.addScriptTag({content:bundle.outputFiles[0].text});
    const pane=page.getByRole('complementary'), handle=page.getByRole('separator');
    await pane.waitFor();
    const typography=await page.locator('.claude-prose').evaluate(e=>({font:getComputedStyle(e).fontSize,line:getComputedStyle(e).lineHeight}));
    assert.deepEqual(typography,{font:'13px',line:'21px'});
    const tools=page.getByRole('button',{name:/Bash (pwd|ls)/});
    const first=await tools.nth(0).boundingBox(),second=await tools.nth(1).boundingBox();
    assert.equal(second.y-first.y-first.height,10,'only card padding/borders may separate adjacent tools');
    const geometry=()=>page.evaluate(()=>({pane:document.querySelector('.claude-artifact-pane').getBoundingClientRect().toJSON(),chat:document.querySelector('[data-chat]').getBoundingClientRect().toJSON(),overlay:document.querySelector('.claude-artifact-pane').dataset.overlay,scroll:document.documentElement.scrollWidth}));
    const initial=await geometry();
    assert.equal(initial.pane.width,Math.min(340,width-48));
    assert.equal(initial.scroll,width);assert.ok(initial.pane.x>=48);
    assert.equal(initial.overlay,width<600?'true':'false');
    await handle.focus();await page.keyboard.press('ArrowRight');
    assert.equal((await geometry()).pane.width,initial.pane.width-20);
    const box=await handle.boundingBox();
    const cdp=await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:box.x+5,y:200}]});
    for(let i=1;i<=10;i++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:box.x+5+(52-box.x-5)*i/10,y:200}]});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    const grown=await geometry();assert.equal(grown.overlay,'true');assert.ok(Math.abs(grown.pane.x-48)<=2);
    assert.equal(grown.chat.width,width<600?width:360,'conversation stops shrinking at 360px');
    assert.ok(grown.pane.x<grown.chat.right);
    // Reverse a captured mouse drag, including over the sandbox iframe.
    const dragStart=await handle.boundingBox();await page.mouse.move(dragStart.x+5,240);await page.mouse.down();
    await page.mouse.move(width-245,240,{steps:12});await page.mouse.up();
    const shrunkWidth=(await geometry()).pane.width;
    assert.ok(Math.abs(shrunkWidth-250)<=2,'drag width includes the panel border');
    assert.equal(await pane.getAttribute('data-resizing'),'false');
    for(const title of ['Reload sandbox','Copy code','Download file','Fullscreen','Close pane']){
      const button=page.getByRole('button',{name:title,exact:true}),rect=await button.boundingBox(),p=await pane.boundingBox();
      assert.ok(rect.x>=p.x&&rect.x+rect.width<=p.x+p.width,`${title} fits in narrow pane`);
    }
    await page.frameLocator('iframe').getByRole('button',{name:'Click',exact:true}).click();
    assert.equal(await page.frameLocator('iframe').getByRole('button').textContent(),'clicked');
    const downloading=page.waitForEvent('download');
    await page.getByRole('button',{name:'Download file',exact:true}).click();
    const download=await downloading;
    assert.equal(download.suggestedFilename(),'preview-test.html');
    assert.match(await readFile(await download.path(),'utf8'),/<h1>Preview<\/h1>/);
    await page.getByRole('button',{name:'Fullscreen',exact:true}).click();assert.equal((await pane.boundingBox()).width,width);
    await page.getByRole('button',{name:'Exit fullscreen',exact:true}).click();assert.equal((await pane.boundingBox()).width,shrunkWidth);
    await handle.focus();for(let i=0;i<30;i++)await page.keyboard.press('ArrowLeft');
    await page.setViewportSize({width:320,height:850});await page.waitForFunction(()=>document.querySelector('[role="separator"]').getAttribute('aria-valuemax')==='272');
    assert.ok((await pane.boundingBox()).x>=48);
    await page.locator('.absolute.inset-0.z-30').click({position:{x:20,y:200}});await pane.waitFor({state:'detached'});
    await page.getByRole('button',{name:'Open',exact:true}).click();
    await page.getByRole('button',{name:'Close pane',exact:true}).click();await pane.waitFor({state:'detached'});
    console.log(`${width}px: touch/mouse/keyboard resize, dock-to-overlay, iframe, fullscreen and close passed`);
    await page.close();
  }
}finally{await browser.close();}
