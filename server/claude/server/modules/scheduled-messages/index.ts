import express from 'express';

import {scheduledMessagesDb, sessionsDb} from '@/modules/database/index.js';
import {runDetachedChatTurn, chatRunRegistry, type ProviderRuntimeGateway} from '@/modules/websocket/index.js';
import {asyncHandler, AppError, createApiSuccessResponse} from '@/shared/utils.js';

function userId(req:express.Request) {
  const id = Number((req as express.Request & {user?:{id?:unknown}}).user?.id);
  if (!Number.isSafeInteger(id) || id <= 0) throw new AppError('请先登录', {statusCode:401,code:'UNAUTHENTICATED'});
  return id;
}
function content(value:unknown) {
  if(typeof value !== 'string' || !value.trim() || value.length > 100000) throw new AppError('消息不能为空或超过 100000 字符', {statusCode:400,code:'INVALID_CONTENT'});
  return value.trim();
}
function deliveryKind(value:unknown): 'queue' | 'schedule' | undefined {
  if(value === undefined || value === 'queue' || value === 'schedule')return value;
  throw new AppError('任务类型无效',{statusCode:400,code:'INVALID_KIND'});
}
export function createScheduledMessagesRouter() {
  const router = express.Router();
  router.get('/', (req,res,next)=>{try {res.json(createApiSuccessResponse({items:scheduledMessagesDb.list(userId(req),deliveryKind(req.query.kind))}));}catch(e){next(e);}});
  router.post('/', asyncHandler(async(req,res)=>{
    const id=userId(req); const text=content(req.body.content);const kind=deliveryKind(req.body.kind) ?? 'schedule';
    const sessionId = typeof req.body.sessionId === 'string' ? req.body.sessionId : '';
    if(sessionsDb.getSessionById(sessionId)?.provider !== 'claude') throw new AppError('请选择 Claude 会话', {statusCode:400,code:'SESSION_REQUIRED'});
    const when=new Date(req.body.scheduledFor);
    if(!Number.isFinite(when.getTime())) throw new AppError('时间无效',{statusCode:400,code:'INVALID_TIME'});
    const repeat=Number(req.body.repeatHours || 0);
    if(![0,24,168].includes(repeat)) throw new AppError('重复间隔无效',{statusCode:400,code:'INVALID_REPEAT'});
    const raw=req.body.options || {};
    // Only composer settings cross this boundary; never accept arbitrary SDK options.
    const permissionMode=['auto','default','acceptEdits','plan','bypassPermissions'].includes(raw.permissionMode) ? raw.permissionMode : 'default';
    const options={model: typeof raw.model==='string'?raw.model:'default',effort:['low','medium','high','xhigh','max'].includes(raw.effort)?raw.effort:undefined,permissionMode,
      attachments:Array.isArray(raw.attachments)?raw.attachments:[],repeatHours:repeat,deliveryKind:kind};
    res.json(createApiSuccessResponse(scheduledMessagesDb.create({userId:id,sessionId,content:text,options,scheduledFor:when})));
  }));
  router.patch('/:id',(req,res,next)=>{try{if(!scheduledMessagesDb.updatePending(userId(req),String(req.params.id),content(req.body.content)))throw new AppError('此消息已开始执行，请刷新',{statusCode:409,code:'ALREADY_STARTED'});res.json({ok:true});}catch(e){next(e);}});
  router.delete('/:id',(req,res,next)=>{try{res.json({cancelled:scheduledMessagesDb.cancel(userId(req),String(req.params.id))});}catch(e){next(e);}});
  return router;
}
/** Timers read only the local DB. Turns use the normal runtime and approval channel. */
export function startScheduledMessages(runtime:ProviderRuntimeGateway) {
  scheduledMessagesDb.recoverInterrupted();
  const active=new Set<string>();
  const tick=()=>{
    for(const row of scheduledMessagesDb.claimDue(new Date())) {
      if(active.has(row.session_id) || chatRunRegistry.getRun(row.session_id)?.status === 'running') {
        scheduledMessagesDb.settle(row.id,new Date(Date.now()+5000),null); continue;
      }
      active.add(row.session_id);
      let options:Record<string,unknown>;
      try{options=JSON.parse(row.options);}catch{scheduledMessagesDb.settle(row.id,null,'任务参数无效');active.delete(row.session_id);continue;}
      const repeatHours=Number(options.repeatHours || 0);delete options.repeatHours;delete options.deliveryKind;
      void runDetachedChatTurn({sessionId:row.session_id,userId:row.user_id,content:row.content,options},{runtime}).then(result=>{
        const busy=!result.started && result.error?.includes('in progress');
        const next=busy ? new Date(Date.now()+5000) : result.started && repeatHours && !result.error ? new Date(Date.now()+repeatHours*3600000) : null;
        scheduledMessagesDb.settle(row.id,next,result.error);
      }).catch(e=>scheduledMessagesDb.settle(row.id,null,String(e.message || e))).finally(()=>active.delete(row.session_id));
    }
  };
  const timer=setInterval(tick,2000);timer.unref();tick();
  return ()=>clearInterval(timer);
}
