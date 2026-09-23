import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import {mkdtemp, mkdir, writeFile, rm} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';

import {closeConnection, initializeDatabase, sessionsDb} from '@/modules/database/index.js';

import {sessionImportService} from '../services/session-import.service.js';

test('Claude import registration indexes a valid native session and filters other projects', async()=>{
  const home=await mkdtemp(path.join(os.tmpdir(),'claude-import-')), previousDb=process.env.DATABASE_PATH;
  const originalHome=os.homedir;
  closeConnection();process.env.DATABASE_PATH=path.join(home,'test.db');await writeFile(process.env.DATABASE_PATH,'');
  os.homedir=()=>home;
  try{
    await initializeDatabase();
    const cwd=path.join(home,'project'),other=path.join(home,'other'),id=randomUUID();await mkdir(cwd);await mkdir(other);
    const dir=path.join(home,'.claude/projects',cwd.replace(/[^a-zA-Z0-9]/g,'-'));await mkdir(dir,{recursive:true});
    const file=path.join(dir,id+'.jsonl');
    await writeFile(file,JSON.stringify({type:'user',sessionId:id,cwd,uuid:randomUUID(),timestamp:new Date().toISOString(),message:{role:'user',content:'Imported marker'}})+'\n');
    await sessionImportService.register(id,cwd);
    assert.equal(sessionsDb.getSessionById(id)?.jsonl_path,file);
    assert.equal((await sessionImportService.candidates(cwd)).length,1);
    assert.equal((await sessionImportService.candidates(other)).length,0);
    await assert.rejects(sessionImportService.register('../escape',cwd));
    await writeFile(file,JSON.stringify({sessionId:randomUUID(),cwd})+'\n');
    await assert.rejects(sessionImportService.register(id,cwd),/metadata mismatch/);
  }finally{os.homedir=originalHome;closeConnection();if(previousDb===undefined)delete process.env.DATABASE_PATH;else process.env.DATABASE_PATH=previousDb;await rm(home,{recursive:true,force:true});}
});
