import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import WebSocket from 'ws';

const base=process.env.ZCODE_CHECK_URL||'http://127.0.0.1:8899';
const client=await fetch(`${base}/zcode/client?theme=dark`,{redirect:'manual'});
assert.equal(client.status,302);
const location=client.headers.get('location');
assert.ok(location);
const remoteUrl=new URL(location,base),sid=remoteUrl.searchParams.get('sid');
assert.ok(sid);
const page=await fetch(remoteUrl);
assert.equal(page.status,200);
const html=await page.text();
assert.match(html,/\/remote\/v4\/assets\/index-[A-Za-z0-9_-]+\.js/);
const scriptPath=html.match(/src="(\/remote\/v4\/assets\/index-[A-Za-z0-9_-]+\.js(?:\?[^"<>]+)?)"/)?.[1];
const stylesheetPath=html.match(/href="(\/remote\/v4\/assets\/index-[A-Za-z0-9_-]+\.css)"/)?.[1];
assert.ok(scriptPath);assert.ok(stylesheetPath);
// Keep lazy chunks importing the entry module on the same patched URL.
const imports=JSON.parse(html.match(/<script type="importmap">([\s\S]*?)<\/script>/)?.[1]||'{}').imports;
assert.equal(imports?.[scriptPath.split('?')[0]],scriptPath);
for(const path of [scriptPath,stylesheetPath]){
  const asset=await fetch(new URL(path,base));
  assert.equal(asset.status,200,path);
  assert.ok(Number(asset.headers.get('content-length'))>1000,path);
  if(path===scriptPath){
    const source=await asset.text();
    const start=source.indexOf('function Hgt('),end=source.indexOf('var n1=',start);
    assert.ok(start>=0&&end>start,'pinned native toolbar');
    const element=(type,props)=>({type,...props});
    const render=runInNewContext(`(${source.slice(start,end)})`,{
      $:{jsx:element,jsxs:element,Fragment:'fragment'},
      q:()=>({intl:{formatMessage:({id})=>id}}),Z:(...parts)=>parts.filter(Boolean).join(' '),
      vs:'close-sidebar',ys:'open-sidebar',t1:'button',zgt:'update',es:'back',ts:'forward',Eh:'new-task',
    });
    const flatten=node=>!node||typeof node!=='object'?[]:[node,...[node.children].flat(Infinity).flatMap(flatten)];
    let visible=true;
    for(const expectedIcon of ['close-sidebar','open-sidebar']){
      const toolbar=render({isDesktop:false,isMacDesktop:false,isWindowsDesktop:false,isSidebarVisible:visible,onToggleSidebar:()=>{visible=!visible}});
      const button=flatten(toolbar).find(node=>node.ariaLabel==='workspaceSidebar.toggleSidebar');
      assert.ok(button,'web wide toolbar exposes the existing sidebar toggle');
      assert.equal(button.children.type,expectedIcon);
      assert.equal(button.buttonClassName,'max-md:hidden','narrow mode keeps its own navigation handle');
      button.onClick();
    }
    assert.equal(visible,true,'can close and reopen');
    const sidebarExpression=source.match(/let Vn=([^,]+),\{panelRef:Hn/)?.[1];
    assert.ok(sidebarExpression);
    for(const [remote,narrow,wideVisible,expected] of [[true,false,false,false],[true,true,false,true],[true,false,true,true],[false,true,false,false]]){
      assert.equal(runInNewContext(sidebarExpression,{$t:remote,bn:narrow,ve:wideVisible}),expected);
    }
  }else await asset.body?.cancel();
}

const wsUrl=new URL('/zcode-relay',base);wsUrl.protocol=wsUrl.protocol==='https:'?'wss:':'ws:';
await new Promise((resolve,reject)=>{
  const socket=new WebSocket(wsUrl);
  const timeout=setTimeout(()=>{socket.terminate();reject(new Error('ZCode relay handshake timed out'))},12000);
  const done=error=>{clearTimeout(timeout);if(socket.readyState<WebSocket.CLOSING)socket.close();error?reject(error):resolve()};
  socket.on('open',()=>socket.send(JSON.stringify({type:'auth_init',role:'terminal',device_sid:sid,meta:{platform:'web',version:'check',name:'relay-check'},client_ts:Date.now()})));
  socket.on('message',async raw=>{
    const message=JSON.parse(String(raw));
    if(message.type==='auth_challenge'){
      try {
        const response=await fetch(`${base}/api/zcode/relay-proof`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({nonce:message.nonce,deviceSid:sid})});
        assert.equal(response.status,200);
        const {proof}=await response.json();
        socket.send(JSON.stringify({type:'auth_response',device_sid:sid,proof,client_ts:Date.now()}));
      } catch(error) {done(error);}
    }
    if(message.type==='auth_ack')['waiting','matched'].includes(message.pair_status)?done():done(new Error(`Unexpected pair status: ${message.pair_status}`));
  });
  socket.on('error',done);
});
console.log('PASS: ZCode native sidebar close/reopen, folding layout state, module cache identity and authenticated local relay');
