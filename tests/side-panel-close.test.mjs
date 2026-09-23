import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {JSDOM} from 'jsdom';
import {codexIcon} from '../web/codex/codex-icons.js';

test('panel tabs close independently and reopen; terminal visibility follows its page',()=>{
  const dom=new JSDOM(readFileSync('web/codex/index.html','utf8'));
  const {document}=dom.window;
  const source=readFileSync('web/codex/app.js','utf8');
  const $=selector=>document.querySelector(selector);
  const context=vm.createContext({document,$,requestAnimationFrame:()=>{},renderChanges(){},nativeBrowser:()=>null,overlayPanelsEnabled:()=>false,
    setSidePanelOpen:open=>{$('#sidePanel').hidden=!open;}});
  // Load the real view/close functions, with only unrelated pane effects stubbed.
  vm.runInContext(source.slice(source.indexOf('function setSidePanelView('),source.indexOf('function openReviewPanel(')),context);
  vm.runInContext(source.split('\n').find(line=>line.startsWith('function terminalIsVisible(')),context);
  vm.runInContext(source.split('\n').find(line=>line.startsWith('for(const close of document.querySelectorAll(')),context);
  const close=id=>document.querySelector(`[data-close-side-tab="${id}"]`).click();
  try{
    assert.equal(document.querySelectorAll('[data-close-side-tab]').length,3);
    $('#sidePanel').hidden=false;$('#utilityTab').dataset.sidePanelTab='terminal';
    context.setSidePanelView('terminal','Terminal');
    assert.equal(context.terminalIsVisible({hostId:'sideTerminalHost',panelId:'sidePanel'}),true);
    close('newTab');assert.equal($('#newTab').hidden,true);assert.equal($('#sideTerminalPanel').hidden,false);
    $('#reviewTab').hidden=false;
    close('utilityTab');assert.equal($('#utilityTab').hidden,true);assert.equal($('#reviewPanelContent').hidden,false);
    assert.equal($('#newTab').hidden,true,'switching must not resurrect the closed launcher');
    assert.equal(context.terminalIsVisible({hostId:'sideTerminalHost',panelId:'sidePanel'}),false);
    close('reviewTab');assert.equal($('#sidePanel').hidden,true,'closing the last tab closes the pane');
    $('#sidePanel').hidden=false;context.setSidePanelView('launcher','New tab');
    assert.equal($('#newTab').hidden,false);assert.equal($('#newTab').getAttribute('aria-selected'),'true');
    context.setSidePanelView('terminal','Terminal');assert.equal($('#utilityTab').hidden,false);
    const button=$('#sendButton');button.innerHTML=codexIcon('square');button.dataset.submitMode='stop';
    const style=document.createElement('style');
    style.textContent=readFileSync('web/codex/style.css','utf8').match(/[^{}]+\{[^{}]*\}/g).filter(rule=>/^\s*\.(send-button|icon-slot)[{ >.:,[]/.test(rule)).join('\n');
    document.head.append(style);
    assert.equal(dom.window.getComputedStyle(button.querySelector('svg')).transform,'none');
    assert.equal(dom.window.getComputedStyle(button.querySelector('.icon-slot')).width,'18px');
    assert.equal(dom.window.getComputedStyle(button.querySelector('svg')).width,'18px');
    const square=button.querySelector('rect');assert.equal(+square.getAttribute('x')+(+square.getAttribute('width'))/2,12);
    assert.equal(+square.getAttribute('y')+(+square.getAttribute('height'))/2,12);
  }finally{dom.window.close();}
});
