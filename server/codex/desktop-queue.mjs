import {readFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';

export function queuedMessage(input, cwd, id=randomUUID()) {
  const text=input.filter(item=>item.type==='text').map(item=>item.text).join('\n');
  const imageAttachments=input.filter(item=>item.type==='localImage').map(item=>({id:randomUUID(),src:item.path,localPath:item.path}));
  return {id,text,cwd,createdAt:Date.now(),context:{prompt:text,workspaceRoots:[cwd],addedFiles:[],fileAttachments:[],imageAttachments,ideContext:null}};
}
export class DesktopQueue {
  pending=new Map();
  constructor(sync){this.sync=sync;}
  read(threadId){
    const state=JSON.parse(readFileSync(join(process.env.CODEX_HOME||join(homedir(),'.codex'),'.codex-global-state.json'),'utf8'));
    return state['queued-follow-ups']?.[threadId] || [];
  }
  async write(threadId, messages, owner){
    const response=await this.sync.bridge.raw('thread-follower-set-queued-follow-ups-state',{conversationId:threadId,state:{[threadId]:messages}},owner,1);
    if(response.resultType!=='success')throw new Error(response.error);
  }
  change(params){
    const previous=this.pending.get(params.threadId)||Promise.resolve();
    const next=previous.catch(()=>{}).then(()=>this.apply(params));this.pending.set(params.threadId,next);
    return next.finally(()=>{if(this.pending.get(params.threadId)===next)this.pending.delete(params.threadId)});
  }
  async apply({threadId,action,input,id,text,expectedText}){
    if(typeof threadId!=='string'||!threadId)throw new Error('Invalid thread id');
    const thread=await this.sync.observe(threadId);
    if(!thread)throw new Error('桌面会话当前不可用，请保持客户端打开');
    const owner=this.sync.followed.get(threadId).owner;
    const messages=this.read(threadId);
    if(action==='add'){
      if(!Array.isArray(input)||!input.length||input.some(item=>!['text','localImage'].includes(item.type)))throw new Error('Invalid queued input');
      const message=queuedMessage(input,thread.cwd,id||randomUUID());
      if(!messages.some(item=>item.id===message.id))await this.write(threadId,[...messages,message],owner);
    }else if(action==='edit'){
      const message=messages.find(item=>item.id===id);
      if(!message)throw new Error('该消息已离开队列，请查看对话');
      if(typeof text!=='string'||typeof expectedText!=='string')throw new Error('Invalid queued text');
      if((message.text||'')!==expectedText)throw new Error('该消息已在另一端修改，请取消编辑后重新打开');
      if(!text.trim()&&!message.context?.imageAttachments?.length&&!message.context?.fileAttachments?.length)throw new Error('消息不能为空');
      const updated={...message,text,context:{...message.context,prompt:text}};
      await this.write(threadId,messages.map(item=>item.id===id?updated:item),owner);
    }else if(action==='remove'){
      await this.write(threadId,messages.filter(item=>item.id!==id),owner);
    }else if(action==='steer'){
      const message=messages.find(item=>item.id===id);if(!message)throw new Error('该消息已离开队列，请查看对话');
      // Keep the message in the native queue, paused, until submission is acknowledged.
      await this.write(threadId,messages.map(item=>item.id===id?{...item,pausedReason:'正在立即插入'}:item),owner);
      const input=[...(message.text?[{type:'text',text:message.text}]:[]),...(message.context?.imageAttachments||[]).map(image=>({type:'localImage',path:image.localPath||image.src}))];
      try{
        const latest=await this.sync.observe(threadId);
        await this.sync.bridge.control(owner,latest.activeTurnId?'turn/steer':'turn/start',{threadId,input,expectedTurnId:latest.activeTurnId,clientUserMessageId:message.id},thread.cwd);
        await this.write(threadId,this.read(threadId).filter(item=>item.id!==id),owner);
      }catch(error){
        // An ambiguous transport failure must never silently send the same message twice.
        await this.write(threadId,this.read(threadId).map(item=>item.id===id?{...item,pausedReason:'插入未确认，请核对对话后重试'}:item),owner).catch(()=>{});
        throw error;
      }
    }else if(action!=='read')throw new Error('Unknown queue action');
    return {messages:this.read(threadId)};
  }
}
