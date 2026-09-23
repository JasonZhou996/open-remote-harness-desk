import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {asyncQuestions, createQuestionCard, parseQuestionReply, questionReply, validateUserInputResponse} from '../web/codex/user-input.js';
import {userMessageText} from '../web/codex/rendering.js';
import {DesktopBridge} from '../server/codex/desktop-bridge.mjs';
import {desktopThread, DesktopSync} from '../server/codex/desktop-sync.mjs';

test('phone choice form retains answers on errors and emits native async and blocking replies', async () => {
  const dom = new JSDOM('<body></body>'); globalThis.document = dom.window.document;
  try {
    const questions = asyncQuestions({id:'call_1',type:'agentMessage',delivery:'async',questions:[{title:'合并哪部分？',options:['源码和启动','共享会话']}]});
    assert.equal(questions[0].id,JSON.stringify(['request_user_input_async','call_1',0]));
    let attempts=0, received;
    const form=createQuestionCard(questions,async answers=>{received=answers;if(++attempts===1)throw new Error('暂时断线');},{partial:true});document.body.append(form);
    const radios=form.querySelectorAll('input[type=radio]');radios[1].click();
    await form.onsubmit({preventDefault(){}});
    assert.equal(form.querySelector('.user-input-error').textContent,'暂时断线');
    assert.equal(radios[1].checked,true);assert.equal(form.querySelector('button').disabled,false);
    const custom=form.querySelector('input[type=text]');custom.value='统一源码仓库和启动管理';custom.dispatchEvent(new dom.window.Event('input'));
    assert.equal(radios[1].checked,false);
    await form.onsubmit({preventDefault(){}});
    assert.equal(form.querySelector('button').textContent,'Submitted');
    const text=questionReply(questions,received),content=[{type:'text',text}];
    assert.deepEqual(parseQuestionReply(content),[{questionItemId:questions[0].id,question:'合并哪部分？',answer:custom.value}]);
    assert.equal(userMessageText(content),'合并哪部分？\n统一源码仓库和启动管理');
    assert.deepEqual(parseQuestionReply([{type:'text',text:'<send_user_message_question_reply>bad</send_user_message_question_reply>'}]),[]);
    const blocking=[{id:'mode',question:'选哪个？',options:[{label:'A',description:'说明'},{label:'B',description:'其他'}]}];
    const response=validateUserInputResponse(blocking,{answers:{mode:{answers:['B']}}});
    assert.deepEqual(response.answers.mode.answers,['B']);
    assert.throws(()=>validateUserInputResponse(blocking,{answers:{wrong:{answers:['B']}}}));
    assert.throws(()=>validateUserInputResponse(blocking,{answers:{mode:{answers:[]}}}));
    const waiting=createQuestionCard(blocking,async()=>{throw new Error('not used');});
    waiting.applyAnswers({mode:['A']});assert.equal(waiting.querySelector('button').disabled,true);
  } finally {dom.window.close();delete globalThis.document;}
});

test('desktop pending question and completion survive streaming and reply goes to its owner', async () => {
  const question={id:'user-input-response-7',type:'userInputResponse',requestId:7,completed:false,questions:[{id:'q',question:'继续？',options:[]}],answers:{}};
  const native={id:'thread',cwd:'/tmp',turns:[{turnId:'turn',status:'inProgress',items:[question]}]};
  assert.deepEqual(desktopThread(native).turns[0].items[0],question);
  const events=[], sync=new DesktopSync(event=>events.push(event));
  sync.publish('thread',desktopThread(native));question.completed=true;question.answers={q:['继续']};sync.publish('thread',desktopThread(native));
  assert.equal(events.filter(e=>e.method==='item/completed').at(-1).params.item.completed,true);
  const bridge=new DesktopBridge();let sent;
  bridge.raw=async(...args)=>{sent=args;return{resultType:'success'};};
  const response={answers:{q:{answers:['继续']}}};
  await bridge.answerUserInput('owner','thread',7,response);
  assert.deepEqual(sent,['thread-follower-submit-user-input',{conversationId:'thread',requestId:7,response},'owner',1]);
  bridge.raw=async()=>({resultType:'error',error:'已过期'});
  await assert.rejects(bridge.answerUserInput('owner','thread',7,response),/已过期/);
});
