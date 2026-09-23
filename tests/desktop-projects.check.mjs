import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,renameSync,readFileSync,rmSync,watch} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {runInNewContext} from 'node:vm';
import {desktopProjects} from '../server/codex/desktop-projects.js';

const saved = {'local-projects': {a:{id:'a',name:'项目甲',rootPaths:['/a','/a2']},b:{id:'b',name:'空项目',rootPaths:['/b']}},
  'project-order':['b','a'], 'thread-project-assignments':{moved:{projectKind:'local',projectId:'b'}},
  'projectless-thread-ids':['moved','loose'], 'app-server-project-id-by-legacy-project-id-by-host':{local:{a:'native-a'}}};
const threads = [{id:'moved',cwd:'/a'}, {id:'root',cwd:'/a2'}, {id:'loose',cwd:'/a'}, {id:'unknown',cwd:'/elsewhere'}, {id:'native',cwd:'/elsewhere',projectId:'native-a'}];
assert.deepEqual(desktopProjects(saved,threads).map(p=>p.name),['空项目','项目甲']);
assert.deepEqual(threads.map(t=>t.projectId),['b','a',null,null,'a']);
assert.equal(threads[0].cwd,'/a','moving a task must not change its work directory');
delete saved['local-projects'].b;
desktopProjects(saved,threads);
assert.equal(threads[0].projectless,true,'deleted project must not be recreated from cwd');

// Run the production watcher with an isolated directory; use real change and
// atomic-rename events, never modify the user's desktop state for this check.
const homeDir=mkdtempSync(join(tmpdir(),'webui-project-watch-'));
mkdirSync(join(homeDir,'.codex'));
let nextEvent;
const source=readFileSync(new URL('../server/gateway/index.ts',import.meta.url),'utf8');
const block=source.slice(source.indexOf('let threadStateChangedTimer:'),source.indexOf('const terminalSessions'))
  .replace(': ReturnType<typeof setTimeout> | null','');
const watcher=runInNewContext(block+'\nthreadStateWatcher',{homeDir,watch,resolve,setTimeout,clearTimeout,console,broadcast:event=>nextEvent?.(event)});
try {
  for(const filename of ['.codex-global-state.json','state_5.sqlite-wal']){
    const changed=new Promise((yes,no)=>{const timer=setTimeout(()=>no(new Error('Missing '+filename+' event')),2000);nextEvent=event=>{clearTimeout(timer);yes(event)}});
    if(filename.endsWith('.json')){writeFileSync(join(homeDir,'.codex/pending'),'{}');renameSync(join(homeDir,'.codex/pending'),join(homeDir,'.codex',filename))}
    else writeFileSync(join(homeDir,'.codex',filename),'changed');
    assert.equal((await changed).type,'host/thread-list-invalidated');
  }
  console.log('PASS: desktop names/order/membership/multiple roots and real JSON/WAL change notifications');
} finally {watcher.close();rmSync(homeDir,{recursive:true});}
