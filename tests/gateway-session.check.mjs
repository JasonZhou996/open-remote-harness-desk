import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {randomUUID} from 'node:crypto';
import {createPasswordSession} from '../server/gateway/server-security.js';

const secret=randomUUID(),port=18917,base=`http://127.0.0.1:${port}`;
const headers={Host:'codex.example:3391','X-Forwarded-For':'203.0.113.42','X-Forwarded-Proto':'https'};
let server;
async function start(){
  server=spawn(process.env.BUN_BIN||'bun',['server/gateway/index.ts'],{cwd:new URL('..',import.meta.url),stdio:['ignore','ignore','pipe'],env:{...process.env,HOST:'127.0.0.1',PORT:String(port),ZCODE_LOCAL_RELAY_PORT:'0',CODEX_WEBUI_NO_AUTH:'1',CODEX_WEBUI_ACCESS_TOKEN:secret,CODEX_WEBUI_PASSWORD:'',XARNESS_BUNDLED_CODEX_BIN:'/usr/lib/chatgpt/resources/codex'}});
  let failure='';server.stderr.on('data',chunk=>{failure=(failure+chunk).slice(-3000)});
  for(let i=0;i<100;i++){
    if(server.exitCode!==null)throw new Error(`Test gateway exited: ${server.exitCode}\n${failure}`);
    try{if((await fetch(`${base}/api/health`)).ok)return}catch{}
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  throw new Error('Test gateway did not start');
}
async function stop(){if(server&&server.exitCode===null){const done=once(server,'exit');server.kill('SIGTERM');await done}}
const request=(path,extra={})=>fetch(base+path,{headers:{...headers,...extra}});
try{
  await start();
  const anonymous=await request('/api/auth/status');
  assert.equal((await anonymous.json()).authenticated,false);
  assert.equal(anonymous.headers.get('set-cookie'),null);
  assert.equal((await request('/api/config')).status,401);
  assert.equal((await request('/manifest.json')).status,200);
  assert.equal((await request('/assets/codex-lan-icon.png')).status,200);
  const initial=await request('/api/auth/status',{Authorization:`Bearer ${secret}`});
  const issued=initial.headers.get('set-cookie');
  assert.equal((await initial.json()).authenticated,true);
  assert.match(issued,/HttpOnly; SameSite=Strict; Max-Age=604800; Secure/);
  const Cookie=issued.split(';')[0];
  for(let i=0;i<12;i++){
    const response=await request('/api/auth/status',{Cookie});
    assert.equal(response.status,200);
    assert.equal((await response.json()).authenticated,true);
    assert.equal(response.headers.get('set-cookie'),null,'valid cookie must not be rotated per page load');
  }
  assert.equal((await request('/api/config',{Cookie})).status,200);
  assert.equal((await request('/api/config',{Cookie:Cookie+'x'})).status,401);
  const expired=createPasswordSession(secret,{ttlMs:-1}).token;
  assert.equal((await request('/api/config',{Cookie:`codex_webui_session=${expired}`})).status,401);
  assert.equal((await request('/api/config',{Cookie,Origin:'https://untrusted.example'})).status,401);
  await stop();await start();
  assert.equal((await request('/api/config',{Cookie})).status,200,'saved browser session survives gateway restart');
  console.log('PASS: trusted HTTPS login issues persistent cookie; cookie-only reopen and restart work; forged, expired, cross-origin and anonymous requests fail; page loads do not consume login attempts');
}finally{await stop()}
