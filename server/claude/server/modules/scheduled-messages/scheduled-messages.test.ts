import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {once} from 'node:events';

test('durable schedules claim once, edit queued text, cancel recurrence, and flag interrupted runs',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'claude-schedule-check-'));
  process.env.DATABASE_PATH=path.join(dir,'test.db');
  await fs.writeFile(process.env.DATABASE_PATH,'');
  const {getConnection,closeConnection,scheduledMessagesDb:db}=await import('../database/index.js');
  try{
    getConnection().exec(`CREATE TABLE scheduled_messages(id TEXT PRIMARY KEY,user_id INTEGER,session_id TEXT,content TEXT,options TEXT,scheduled_for TEXT,status TEXT,failure_reason TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP)`);
    const input={userId:1,sessionId:'test',content:'original',options:{repeatHours:24},scheduledFor:new Date(0)};
    const row=db.create(input);assert.equal(db.updatePending(2,row.id,'wrong user'),false);assert.equal(db.updatePending(1,row.id,'edited'),true);
    assert.equal(db.claimDue(new Date()).length,1);assert.equal(db.claimDue(new Date()).length,0);assert.equal(db.list(1)[0].content,'edited');
    assert.equal(db.updatePending(1,row.id,'too late'),false);
    db.settle(row.id,new Date(0),null);assert.equal(db.claimDue(new Date()).length,1);
    db.cancel(1,row.id);db.settle(row.id,new Date(0),null);assert.equal(db.list(1)[0].status,'cancelled');
    const interrupted=db.create(input);db.claimDue(new Date());db.recoverInterrupted();assert.equal(db.list(1).find(r=>r.id===interrupted.id)?.status,'failed');
    const queued=db.create({...input,content:'ordinary chat',options:{deliveryKind:'queue'}});
    assert.deepEqual(db.list(1,'queue').map(r=>r.id),[queued.id]);
    assert.equal(db.list(1,'schedule').some(r=>r.id===queued.id),false,'ordinary queued messages are not routines');
    assert.ok(db.list(1,'schedule').some(r=>r.id===row.id),'existing explicit schedules remain visible');
  }finally{closeConnection();await fs.rm(dir,{recursive:true,force:true});}
});

test('HTTP schedules fire through the timer and chat gateway, with separate queue and routine lists',async()=>{
  const {default:express}=await import('express');
  const {setTimeout:delay}=await import('node:timers/promises');
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'claude-schedule-runtime-'));
  const oldPath=process.env.DATABASE_PATH;
  const {getConnection,closeConnection,initializeDatabase,sessionsDb,scheduledMessagesDb:db}=await import('../database/index.js');
  closeConnection();process.env.DATABASE_PATH=path.join(dir,'test.db');await fs.writeFile(process.env.DATABASE_PATH,'');
  await initializeDatabase();
  getConnection().prepare("INSERT INTO users(id,username,password_hash) VALUES(1,'test','unused')").run();
  sessionsDb.createAppSession('timed-test','claude',dir);
  const {createScheduledMessagesRouter,startScheduledMessages}=await import('./index.js');
  const app=express().use(express.json()).use((req:any,_res,next)=>{req.user={id:1};next();}).use('/schedules',createScheduledMessagesRouter());
  app.use((error:any,_req:any,res:any,_next:any)=>res.status(error.statusCode||500).json({error:error.message}));
  const server=app.listen(0,'127.0.0.1');await once(server,'listening');
  const url=`http://127.0.0.1:${(server.address() as any).port}/schedules`;
  const calls:any[]=[];let stop=()=>{};
  try {
    const post=(kind:string,content:string,when:Date)=>fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({kind,content,sessionId:'timed-test',scheduledFor:when.toISOString(),options:{model:'claude-sonnet-4-6',permissionMode:'auto'}})});
    assert.equal((await post('invalid','reject',new Date())).status,400);
    assert.equal((await fetch(url+'?kind=invalid')).status,400);
    const queue=await (await post('queue','ordinary chat',new Date(Date.now()+60000))).json() as any;
    const routine=await (await post('schedule','timer check',new Date(Date.now()+100))).json() as any;
    const listed=await (await fetch(url+'?kind=schedule')).json() as any;
    assert.deepEqual(listed.data.items.map((r:any)=>r.id),[routine.data.id]);
    assert.deepEqual((await (await fetch(url+'?kind=queue')).json() as any).data.items.map((r:any)=>r.id),[queue.data.id]);
    stop=startScheduledMessages({hasRuntime:()=>true,run:async(provider:any,command:any,options:any,writer:any)=>{
      calls.push({provider,command,options});
      writer.send({kind:'complete',provider:'claude',sessionId:options.sessionId,exitCode:0});
    }} as never);
    const deadline=Date.now()+5000;
    while(db.list(1,'schedule')[0].status!=='sent'&&Date.now()<deadline)await delay(50);
    assert.equal(db.list(1,'schedule')[0].status,'sent','actual timer must dispatch and settle the schedule');
    assert.equal(calls.length,1);
    assert.equal(calls[0].command,'timer check');assert.equal(calls[0].provider,'claude');
    assert.equal(calls[0].options.model,'claude-sonnet-4-6');
    assert.equal(calls[0].options.permissionMode,'auto');
    assert.equal(calls[0].options.deliveryKind,undefined,'scheduler metadata must not reach the model runtime');
    assert.equal(db.list(1,'queue')[0].status,'pending');
  } finally {
    stop();await new Promise<void>(resolve=>server.close(()=>resolve()));closeConnection();
    if(oldPath===undefined)delete process.env.DATABASE_PATH;else process.env.DATABASE_PATH=oldPath;
    await fs.rm(dir,{recursive:true,force:true});
  }
});
