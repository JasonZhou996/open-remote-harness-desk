import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import path from 'node:path';

test('Claude Stop waits for the matching terminal frame, handles completion races and rejects failures',async()=>{
  const require=createRequire(path.resolve('web/claude/package.json'));
  const bundle=await require('esbuild').build({entryPoints:['web/claude/src/services/backend.ts'],bundle:true,write:false,platform:'node',format:'esm',define:{'import.meta.env.BASE_URL':'"/claude/app/"'}});
  const saved=Object.fromEntries(['WebSocket','window','location'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  const sent=[];let socket;
  class Socket extends EventTarget {
    static OPEN=1;static CONNECTING=0;readyState=1;
    constructor(){super();socket=this;}
    send(data){sent.push(JSON.parse(data));}
  }
  globalThis.WebSocket=Socket;globalThis.window=new EventTarget();globalThis.location={protocol:'http:',host:'localhost'};
  try {
    const {backend}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
    backend.connect();
    const emit=frame=>socket.onmessage({data:JSON.stringify(frame)});
    let stopped=false;
    const stopping=backend.abort('session').then(()=>{stopped=true;});
    assert.deepEqual(sent,[{type:'chat.abort',sessionId:'session'}]);
    emit({kind:'complete',sessionId:'other',exitCode:0});await Promise.resolve();assert.equal(stopped,false);
    emit({kind:'stream_delta',sessionId:'session',content:'late token'});await Promise.resolve();assert.equal(stopped,false);
    emit({kind:'complete',sessionId:'session',aborted:true,exitCode:0});await stopping;assert.equal(stopped,true);
    const alreadyDone=backend.abort('session');emit({kind:'protocol_error',sessionId:'session',code:'NO_ACTIVE_RUN'});await alreadyDone;
    const failed=backend.abort('session');emit({kind:'complete',sessionId:'session',aborted:true,exitCode:1});await assert.rejects(failed,/停止失败/);
    const disconnected=backend.abort('session');socket.dispatchEvent(new Event('close'));await assert.rejects(disconnected,/连接已断开/);
    socket.readyState=3;await assert.rejects(backend.abort('session'),/连接未就绪/);
  }finally{
    for(const [key,descriptor] of Object.entries(saved))if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];
  }
});
