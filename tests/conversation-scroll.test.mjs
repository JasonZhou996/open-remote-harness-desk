import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {JSDOM} from 'jsdom';

test('live messages follow the bottom until the reader scrolls away, including pending frames',()=>{
  const dom=new JSDOM('<div id="conversation"><article><div class="message-text"></div></article></div><button id="scrollToBottomButton" hidden></button>');
  const root=dom.window.document.querySelector('#conversation'),frames=[];
  const bottomButton=dom.window.document.querySelector('#scrollToBottomButton');
  let resized;
  let height=2400,top=0;
  Object.defineProperties(root,{clientHeight:{value:600},scrollHeight:{get:()=>height},scrollTop:{get:()=>top,set:value=>{top=Math.max(0,Math.min(value,height-600));}}});
  const state={active:{id:'one'},items:new Map([['reply',root.firstElementChild]])};
  const context=vm.createContext({document:dom.window.document,$:selector=>dom.window.document.querySelector(selector),state,
    ResizeObserver:class{constructor(callback){resized=callback;}observe(){}},
    requestAnimationFrame:callback=>frames.push(callback),imageCwd:()=>'.',renderAssistantMarkdown:text=>{height+=200;return text;}});
  const source=readFileSync('web/codex/app.js','utf8');
  const begin=source.includes('let conversationFollowsBottom=')?'let conversationFollowsBottom=':'function scrollBottom(';
  vm.runInContext(source.slice(source.indexOf(begin),source.indexOf('function formatAge(')),context);
  vm.runInContext(source.slice(source.indexOf('function onNotification('),source.indexOf('function applyQuestionAnswers(')),context);
  const flush=()=>{while(frames.length){const batch=frames.splice(0);for(const frame of batch)frame();}};
  const scroll=value=>{root.scrollTop=value;root.dispatchEvent(new dom.window.Event('scroll'));};
  const delta=()=>context.onNotification('item/agentMessage/delta',{threadId:state.active.id,itemId:'reply',delta:'new text'});
  try{
    context.scrollOpenedThreadToBottom();flush();assert.equal(top,1800);
    assert.equal(bottomButton.hidden,true,'the button is hidden at the bottom');
    scroll(500);delta();flush();assert.equal(top,500,'a live delta must not take the reader to the bottom');
    assert.equal(bottomButton.hidden,false,'the button appears while reading earlier messages');
    bottomButton.click();flush();assert.equal(top,height-600,'the button returns to the newest message');
    assert.equal(bottomButton.hidden,true);
    delta();flush();assert.equal(top,height-600,'clicking the button resumes following live messages');
    scroll(height-600);delta();flush();assert.equal(top,height-600,'returning to the bottom resumes following');
    const before=top;delta();scroll(before-15);flush();assert.equal(top,before-15,'even a small upward scroll cancels an already scheduled follow');
    scroll(height-600);delta();const wheelTop=top;
    root.dispatchEvent(new dom.window.WheelEvent('wheel',{deltaY:-30}));flush();assert.equal(top,wheelTop,'wheel intent cancels the frame before the native scroll event');
    scroll(300);context.scrollOpenedThreadToBottom();frames.shift()();
    scroll(400);flush();assert.equal(top,400,'the second opening frame must respect an intervening manual scroll');
    scroll(height-600);delta();state.active={id:'two'};root.scrollTop=200;flush();assert.equal(top,200,'old frames must not scroll a different conversation');
    height=600;root.scrollTop=0;resized();assert.equal(bottomButton.hidden,true,'no button is shown when everything fits');
    height=1200;resized();assert.equal(bottomButton.hidden,false,'layout changes update the button without scrolling');
  }finally{dom.window.close();}
});
