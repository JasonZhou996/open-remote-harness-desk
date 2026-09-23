import {test, expect} from 'bun:test';
import {Database} from 'bun:sqlite';
import {mkdtemp, mkdir, writeFile, readFile, rm, symlink} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir, homedir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {SessionImports} from '../server/gateway/session-import.js';

test('real converter: four phases, both directions, project filtering, independent jobs and failed-write cleanup', async()=>{
  const home=await mkdtemp(join(tmpdir(),'tri-import-test-')), cwd=join(home,'project'), sourceId=randomUUID();
  await mkdir(cwd);await mkdir(join(home,'.codex'),{recursive:true});
  const db=new Database(join(home,'.codex/state_5.sqlite'));
  db.exec(`CREATE TABLE threads(id TEXT PRIMARY KEY,rollout_path TEXT,created_at INTEGER,updated_at INTEGER,source TEXT,model_provider TEXT,cwd TEXT,title TEXT,sandbox_policy TEXT,approval_mode TEXT,tokens_used INTEGER,has_user_event INTEGER,archived INTEGER,cli_version TEXT,first_user_message TEXT,memory_mode TEXT,thread_source TEXT,preview TEXT,history_mode TEXT,name TEXT,recency_at INTEGER,recency_at_ms INTEGER,project_id TEXT)`);
  const file=join(home,'.claude/projects',cwd.replace(/[^a-zA-Z0-9]/g,'-'),sourceId+'.jsonl');await mkdir(join(file,'..'),{recursive:true});
  const now=new Date().toISOString(), text='Remember import marker BLUE-739.';
  const source=[{type:'user',uuid:randomUUID(),sessionId:sourceId,cwd,timestamp:now,message:{role:'user',content:[{type:'text',text}]}},{type:'assistant',uuid:randomUUID(),sessionId:sourceId,cwd,timestamp:now,message:{role:'assistant',content:[{type:'tool_use',id:'call_1',name:'Read',input:{file_path:'README.md'}}]}},{type:'user',uuid:randomUUID(),sessionId:sourceId,cwd,timestamp:now,message:{role:'user',content:[{type:'tool_result',tool_use_id:'call_1',content:'read result'}]}},{type:'assistant',uuid:randomUUID(),sessionId:sourceId,cwd,timestamp:now,message:{role:'assistant',content:[{type:'text',text:'Noted BLUE-739.'}]}}].map(JSON.stringify).join('\n')+'\n';
  await writeFile(file,source);
  let failVerify=false;const phases=new Map<string,number[]>(), waiters=new Map<string,(value:any)=>void>();
  const publish=({jobs}:any)=>{for(const job of jobs){const a=phases.get(job.id)||[];if(a.at(-1)!==job.stage)a.push(job.stage);phases.set(job.id,a);if(job.status!=='running')waiters.get(job.id)?.(job);}};
  const opts={home,publish,converter:join(homedir(),'.cargo/bin/transession'),request:async(method:string)=>{if(failVerify&&method==='thread/resume')throw new Error('intentional verification failure');return {data:[{id:'turn'}]};},claudeRequest:async(path:string,body?:any)=>path.includes('import-candidates')?[{id:sourceId,file,title:'原会话'}]:body?{sessionId:body.sessionId}:{messages:[{content:text}]}};
  const service=new SessionImports(opts);
  const done=(job:any)=>new Promise<any>((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('import timeout')),30000);waiters.set(job.id,value=>{clearTimeout(timer);resolve(value);});});
  try {
    const first=await service.start({target:'codex',projectPath:cwd,sourceId,requestId:randomUUID()});
    expect(first.status).toBe('running');const pending=done(first);
    expect(await service.candidates('codex',cwd)).toHaveLength(1);
    const result=await pending;expect(result.status).toBe('completed');expect(phases.get(first.id)).toEqual([0,1,2,3,4]);
    expect(await readFile(file,'utf8')).toBe(source);
    const target=db.query('SELECT * FROM threads WHERE id=?').get(result.targetId) as any;
    expect(target.rollout_path.split('/').at(-1)).toMatch(/^rollout-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-[0-9a-f-]{36}\.jsonl$/);
    const translated=await readFile(target.rollout_path,'utf8');expect(translated).toContain(text);expect(translated).toContain('read result');expect(translated).toContain('function_call');
    const alias=join(home,'alias');await symlink(cwd,alias);
    expect(await service.candidates('claude',alias)).toHaveLength(1);
    const back=await service.start({target:'claude',projectPath:cwd,sourceId:result.targetId,requestId:randomUUID()});
    const backResult=await done(back);expect(backResult.status).toBe('completed');expect(phases.get(back.id)).toEqual([0,1,2,3,4]);
    const returned=await readFile(join(home,'.claude/projects',cwd.replace(/[^a-zA-Z0-9]/g,'-'),backResult.targetId+'.jsonl'),'utf8');expect(returned).toContain(text);expect(returned).toContain('tool_result');
    await writeFile(join(home,'.codex/.codex-global-state.json'),JSON.stringify({'local-projects':{other:{id:'other',name:'other',rootPaths:[home]}},'thread-project-assignments':{[result.targetId]:{projectKind:'local',projectId:'other'}}}));
    expect(await service.candidates('claude',cwd)).toHaveLength(0);
    await expect(service.start({target:'claude',projectPath:cwd,sourceId:result.targetId,requestId:randomUUID()})).rejects.toThrow('不属于当前项目');
    failVerify=true;
    const failed=await service.start({target:'codex',projectPath:cwd,sourceId,requestId:randomUUID()});const failure=await done(failed);
    expect(failure.status).toBe('failed');expect(db.query('SELECT id FROM threads WHERE id=?').get(failed.targetId)).toBeNull();
    const restored=new SessionImports(opts);expect(restored.snapshot().find((j:any)=>j.id===first.id)?.status).toBe('completed');
    const duplicate=await service.start({target:'codex',projectPath:cwd,sourceId,requestId:first.id.slice(7)});expect(duplicate.id).toBe(first.id);
  } finally {db.close();await rm(home,{recursive:true,force:true});}
},60000);
