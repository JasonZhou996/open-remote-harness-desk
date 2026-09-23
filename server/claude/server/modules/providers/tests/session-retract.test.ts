import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp, mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('retract persists a native Claude branch, preserves the source, and rejects busy or invalid requests', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'claude-retract-'));
  const previous = {config:process.env.CLAUDE_CONFIG_DIR, database:process.env.DATABASE_PATH};
  process.env.CLAUDE_CONFIG_DIR = path.join(directory, '.claude');
  process.env.DATABASE_PATH = path.join(directory, 'test.db');
  await writeFile(process.env.DATABASE_PATH, '');
  const {closeConnection, initializeDatabase, sessionsDb} = await import('@/modules/database/index.js');
  const {sessionsService} = await import('@/modules/providers/services/sessions.service.js');
  const {chatRunRegistry} = await import('@/modules/websocket/index.js');
  const project = path.join(directory, 'workspace');
  const transcriptDirectory = path.join(process.env.CLAUDE_CONFIG_DIR, 'projects', project.replace(/[^a-zA-Z0-9]/g, '-'));
  await mkdir(transcriptDirectory, {recursive:true});
  await mkdir(project);
  const sessionId = randomUUID(), u1 = randomUUID(), a1 = randomUUID(), u2 = randomUUID();
  const transcript = path.join(transcriptDirectory, `${sessionId}.jsonl`);
  const rows = [
    {type:'user', uuid:u1, parentUuid:null, message:{role:'user',content:'first'}},
    {type:'assistant', uuid:a1, parentUuid:u1, message:{role:'assistant',model:'claude-opus-5',content:[{type:'text',text:'first reply'}]}},
    {type:'user', uuid:u2, parentUuid:a1, message:{role:'user',content:'second'}},
  ].map(row => ({...row,sessionId,cwd:project,version:'2.1.278',timestamp:new Date().toISOString()}));
  const original = rows.map(row => JSON.stringify(row)).join('\n')+'\n';
  await writeFile(transcript, original);
  closeConnection(); await initializeDatabase();
  const now = new Date().toISOString();
  sessionsDb.createSession(sessionId,'claude',project,'Recall check',now,now,transcript);
  try {
    chatRunRegistry.startRun({appSessionId:sessionId,provider:'claude',providerSessionId:sessionId,connection:null,userId:null});
    await assert.rejects(()=>sessionsService.retractMessage(sessionId,u2),{code:'SESSION_BUSY'});
    chatRunRegistry.clearAll();
    await assert.rejects(()=>sessionsService.retractMessage(sessionId,a1),{code:'ANCHOR_NOT_FOUND'});
    await assert.rejects(()=>sessionsService.retractMessage(sessionId,'missing'),{code:'ANCHOR_NOT_FOUND'});
    assert.equal(sessionsDb.getSessionById(sessionId)?.provider_session_id,sessionId);

    const result = await sessionsService.retractMessage(sessionId,u2);
    assert.deepEqual(result.messages.filter(m=>m.kind==='text').map(m=>m.content),['first','first reply']);
    const forked = sessionsDb.getSessionById(sessionId)!;
    assert.notEqual(forked.provider_session_id,sessionId);
    assert.notEqual(forked.jsonl_path,transcript);
    assert.equal(await readFile(transcript,'utf8'),original,'source transcript stays recoverable');
    assert.equal(sessionsDb.isProviderSessionSuperseded(sessionId,'claude'),true);
    // Re-indexing the original must not bring retracted messages back.
    sessionsDb.createSession(sessionId,'claude',project,'Old name',now,now,transcript);
    assert.equal(sessionsDb.getSessionById(sessionId)?.provider_session_id,forked.provider_session_id);
    closeConnection(); await initializeDatabase();
    const reloaded = await sessionsService.fetchHistory(sessionId);
    assert.deepEqual(reloaded.messages.filter(m=>m.kind==='text').map(m=>m.content),['first','first reply']);
    const first = reloaded.messages.find(m=>m.role==='user')!;
    const empty = await sessionsService.retractMessage(sessionId,first.transcriptAnchorId ?? first.id!);
    assert.equal(empty.messages.length,0);
    assert.equal(sessionsDb.getSessionById(sessionId)?.provider_session_id,null,'next send must start from empty context');
    assert.equal(chatRunRegistry.isProcessing(sessionId),false);
  } finally {
    chatRunRegistry.clearAll(); closeConnection();
    if(previous.config===undefined)delete process.env.CLAUDE_CONFIG_DIR;else process.env.CLAUDE_CONFIG_DIR=previous.config;
    if(previous.database===undefined)delete process.env.DATABASE_PATH;else process.env.DATABASE_PATH=previous.database;
    await rm(directory,{recursive:true,force:true});
  }
});
