import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import express, { type NextFunction, type Request, type Response } from 'express';

import { closeConnection, initializeDatabase, sessionsDb } from '@/modules/database/index.js';
import providerRouter from '@/modules/providers/provider.routes.js';
import { providerRegistry } from '@/modules/providers/provider.registry.js';
import { chatRunRegistry, connectedClients } from '@/modules/websocket/index.js';
import { AppError } from '@/shared/utils.js';

async function withProviderServer(
  run: (baseUrl: string, workspacePath: string) => Promise<void>,
): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'provider-routes-'));

  closeConnection();
  process.env.DATABASE_PATH = path.join(tempDirectory, 'auth.db');
  await writeFile(process.env.DATABASE_PATH, '');
  await initializeDatabase();

  const app = express().use(express.json()).use('/api/providers', providerRouter);
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof AppError) {
      res.status(error.statusCode).json({
        success: false,
        error: { code: error.code, message: error.message },
      });
      return;
    }
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR' } });
  });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');

  try {
    const address = server.address() as AddressInfo;
    await run(`http://127.0.0.1:${address.port}`, path.join(tempDirectory, 'workspace'));
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
    closeConnection();
    if (previousDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = previousDatabasePath;
    }
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

test('retract route rejects missing, invalid, or unknown anchors before mutating history', async () => {
  await withProviderServer(async baseUrl => {
    for (const anchorId of [undefined, '', {}, '../transcript']) {
      const response = await fetch(`${baseUrl}/api/providers/sessions/check/retract`, {
        method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({anchorId}),
      });
      assert.equal(response.status,400);
    }
    const response = await fetch(`${baseUrl}/api/providers/sessions/missing/retract`, {
      method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({anchorId:'valid-id'}),
    });
    assert.equal(response.status,404);
  });
});

test('rename persists one canonical session and broadcasts updates for app and native ids', async () => {
  await withProviderServer(async (baseUrl, workspacePath) => {
    sessionsDb.createAppSession('rename-app', 'claude', workspacePath, 'Original');
    sessionsDb.assignProviderSessionId('rename-app', 'rename-native');
    const frames: Array<{sessionId: string; session: {summary: string}}> = [];
    const client = {readyState: 1, send: (payload: string) => frames.push(JSON.parse(payload))};
    connectedClients.add(client as never);
    const rename = (id: string, body: object) => fetch(`${baseUrl}/api/providers/sessions/${id}`, {
      method: 'PUT', headers: {'content-type': 'application/json'}, body: JSON.stringify(body),
    });
    try {
      for (const body of [{name:'Wrong field'}, {summary:' '}, {summary:'x'.repeat(501)}]) {
        assert.equal((await rename('rename-app', body)).status, 400);
      }
      assert.equal(sessionsDb.getSessionById('rename-app')?.custom_name, 'Original');
      for (const id of ['rename-app', 'rename-native']) {
        const summary = `Renamed via ${id}`;
        const response = await rename(id, {summary});
        assert.equal(response.status, 200);
        assert.deepEqual((await response.json() as any).data, {sessionId:'rename-app', summary});
        const details = await (await fetch(`${baseUrl}/api/providers/sessions/rename-app`)).json() as any;
        assert.equal(details.data.summary, summary);
        assert.equal(frames.at(-1)?.sessionId, 'rename-app');
        assert.equal(frames.at(-1)?.session.summary, summary);
        assert.equal(sessionsDb.getSessionById('rename-native'), null, 'do not insert a duplicate');
      }
      const concurrent = await Promise.all(['Browser', 'CLI'].map(summary => rename('rename-native', {summary})));
      assert.deepEqual(concurrent.map(response => response.status), [200, 200]);
      assert.equal(frames.at(-1)?.session.summary, sessionsDb.getSessionById('rename-app')?.custom_name);
      const count = frames.length;
      assert.equal((await rename('missing-session', {summary:'Missing'})).status, 404);
      assert.equal(sessionsDb.getSessionById('missing-session'), null);
      assert.equal(frames.length, count);
    } finally { connectedClients.delete(client as never); }
  });
});

test('deletion resolves native ids and broadcasts the canonical removal after archiving', async () => {
  await withProviderServer(async (baseUrl, workspacePath) => {
    sessionsDb.createAppSession('delete-app', 'claude', workspacePath, 'Keep transcript');
    sessionsDb.assignProviderSessionId('delete-app', 'delete-native');
    const frames: any[] = [];
    const client = {readyState: 1, send: (payload: string) => {
      assert.equal(sessionsDb.getSessionById('delete-app')?.isArchived, 1);
      frames.push(JSON.parse(payload));
    }};
    connectedClients.add(client as never);
    try {
      const response = await fetch(`${baseUrl}/api/providers/sessions/delete-native`, {method:'DELETE'});
      assert.equal(response.status, 200);
      assert.deepEqual((await response.json() as any).data, {sessionId:'delete-app',action:'archived',deletedFromDisk:false});
      assert.deepEqual(frames, [{kind:'session_removed',sessionId:'delete-app',providerSessionId:'delete-native'}]);
      sessionsDb.createSession('delete-native', 'claude', workspacePath, 'Disk title', undefined, '2099-01-01T00:00:00Z');
      assert.equal(sessionsDb.getSessionById('delete-app')?.isArchived, 1);
      assert.equal((await fetch(`${baseUrl}/api/providers/sessions/missing`, {method:'DELETE'})).status, 404);
      assert.equal(frames.length, 1, 'failed deletion must not notify clients');
    } finally { connectedClients.delete(client as never); }
  });
});

test('permission mode validates input and persists the session choice', async () => {
  await withProviderServer(async (baseUrl,workspacePath) => {
    sessionsDb.createSession('permissions-check','claude',workspacePath);
    const url = `${baseUrl}/api/providers/sessions/permissions-check/permission-mode`;
    for(const mode of ['auto','default','plan','acceptEdits','bypassPermissions']) {
      const res = await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({mode})});
      assert.equal(res.status,200);
      assert.equal(((await res.json()) as any).data.mode,mode);
      assert.equal(((await (await fetch(url)).json()) as any).data.mode,mode);
    }
    const invalid = await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({mode:'anything'})});
    assert.equal(invalid.status,400);
    assert.equal(((await (await fetch(url)).json()) as any).data.mode,'bypassPermissions');
  });
});

test('live permission changes wait for CLI acknowledgement and leave saved mode intact on failure', async t => {
  await withProviderServer(async (baseUrl,workspacePath) => {
    const sid='live-permissions';
    sessionsDb.createSession(sid,'claude',workspacePath);
    sessionsDb.setSessionPermissionMode(sid,'default');
    const run=chatRunRegistry.startRun({appSessionId:sid,provider:'claude',providerSessionId:null,connection:null,userId:null})!;
    let acknowledge!:(applied:boolean)=>void, markCalled!:()=>void;
    const called=new Promise<void>(resolve=>markCalled=resolve);
    const runtime=providerRegistry.resolveProvider('claude').runtime.permissions as {setMode(sessionId:string,mode:string):Promise<boolean>};
    const mode=t.mock.method(runtime,'setMode',async()=>{markCalled();return new Promise<boolean>(resolve=>acknowledge=resolve);});
    const post=(mode='plan')=>fetch(`${baseUrl}/api/providers/sessions/${sid}/permission-mode`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({mode})});
    try {
      const response=post();await called;
      assert.equal(sessionsDb.getSessionById(sid)?.permission_mode,'default');
      acknowledge(true);
      assert.equal((await response).status,200);
      assert.equal(sessionsDb.getSessionById(sid)?.permission_mode,'plan');
      assert.equal(run.events.at(-1)?.permissionMode,'plan');
      mode.mock.mockImplementation(async()=>false);
      assert.equal((await post('acceptEdits')).status,409,'a preparing runtime must not pretend it applied the change');
      mode.mock.mockImplementation(async()=>{throw new Error('CLI refused');});
      assert.equal((await post('bypassPermissions')).status,500);
      assert.equal(sessionsDb.getSessionById(sid)?.permission_mode,'plan');
    } finally {mode.mock.restore();chatRunRegistry.completeRunIfCurrent(run,{exitCode:0});}
  });
});

test('session creation route names a CloudCLI session from the initial message', async () => {
  await withProviderServer(async (baseUrl, workspacePath) => {
    const response = await fetch(`${baseUrl}/api/providers/sessions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        provider: 'codex',
        projectPath: workspacePath,
        initialMessage: 'abcd  efg\nhij klm nop',
      }),
    });
    const payload = await response.json() as {
      data: { sessionId: string; sessionName: string };
    };

    assert.equal(response.status, 201);
    assert.equal(payload.data.sessionName, 'abcd efg hij klm');
    assert.equal(
      sessionsDb.getSessionById(payload.data.sessionId)?.custom_name,
      'abcd efg hij klm',
    );
  });
});

test('conversation search streams title matches before transcript results', async () => {
  await withProviderServer(async (baseUrl, workspacePath) => {
    sessionsDb.createAppSession(
      'title-only-session',
      'codex',
      workspacePath,
      'Release planning notes',
    );
    const transcriptPath = path.join(path.dirname(workspacePath), 'codex-search.jsonl');
    await writeFile(transcriptPath, `${JSON.stringify({
      type: 'event_msg',
      timestamp: '2026-08-12T09:00:00.000Z',
      payload: {
        type: 'user_message',
        kind: 'plain',
        message: 'Release planning also appears in this conversation.',
      },
    })}\n`);
    sessionsDb.createSession(
      'transcript-session',
      'codex',
      workspacePath,
      'Unrelated session',
      undefined,
      undefined,
      transcriptPath,
    );

    const response = await fetch(
      `${baseUrl}/api/providers/search/sessions?q=release%20planning&limit=50`,
    );
    const eventStream = await response.text();
    const titleEventIndex = eventStream.indexOf('event: title-results');
    const conversationEventIndex = eventStream.indexOf('event: result');
    const doneEventIndex = eventStream.indexOf('event: done');

    assert.equal(response.status, 200);
    assert.ok(titleEventIndex >= 0);
    assert.ok(conversationEventIndex > titleEventIndex);
    assert.ok(doneEventIndex > titleEventIndex);

    const titleDataLine = eventStream
      .slice(titleEventIndex, conversationEventIndex)
      .split('\n')
      .find((line) => line.startsWith('data: '));
    assert.ok(titleDataLine);

    const titlePayload = JSON.parse(titleDataLine.slice('data: '.length)) as {
      titleResults: Array<{
        sessionId: string;
        sessionTitle: string;
        provider: string;
      }>;
    };
    assert.equal(titlePayload.titleResults.length, 1);
    assert.equal(titlePayload.titleResults[0]?.sessionId, 'title-only-session');
    assert.equal(titlePayload.titleResults[0]?.sessionTitle, 'Release planning notes');
    assert.equal(titlePayload.titleResults[0]?.provider, 'codex');
  });
});

test('reasoning effort is persisted and returned with the active session model', async () => {
  await withProviderServer(async (baseUrl, workspacePath) => {
    sessionsDb.createAppSession('effort-session', 'codex', workspacePath);

    const updateResponse = await fetch(
      `${baseUrl}/api/providers/codex/sessions/effort-session/active-effort`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ effort: 'ultra' }),
      },
    );
    const updatePayload = await updateResponse.json() as {
      data: { effort: string; sessionId: string };
    };

    assert.equal(updateResponse.status, 200);
    assert.equal(updatePayload.data.effort, 'ultra');
    assert.equal(sessionsDb.getSessionById('effort-session')?.effort, 'ultra');

    const readResponse = await fetch(
      `${baseUrl}/api/providers/codex/sessions/effort-session/active-model`,
    );
    const readPayload = await readResponse.json() as {
      data: { effort: string | null; sessionId: string };
    };

    assert.equal(readResponse.status, 200);
    assert.equal(readPayload.data.sessionId, 'effort-session');
    assert.equal(readPayload.data.effort, 'ultra');
  });
});

test('model routes expose immutable defaults and full custom model CRUD', async () => {
  await withProviderServer(async (baseUrl) => {
    const initialResponse = await fetch(`${baseUrl}/api/providers/codex/models`);
    const initialPayload = await initialResponse.json() as {
      data: {
        cache?: unknown;
        models: {
          OPTIONS: Array<{ recordId?: number; value: string; isCustom: boolean }>;
        };
      };
    };
    assert.equal(initialResponse.status, 200);
    assert.equal('cache' in initialPayload.data, false);
    const predefined = initialPayload.data.models.OPTIONS[0];
    assert.equal(predefined.isCustom, false);
    assert.equal(predefined.recordId, undefined);

    const createResponse = await fetch(`${baseUrl}/api/providers/codex/models`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'Gateway GPT', id: 'gateway/gpt' }),
    });
    const createPayload = await createResponse.json() as {
      data: { model: { recordId: number; value: string; label: string; isCustom: boolean } };
    };
    assert.equal(createResponse.status, 201);
    assert.equal(createPayload.data.model.isCustom, true);
    const customRecordId = createPayload.data.model.recordId;

    const updateResponse = await fetch(
      `${baseUrl}/api/providers/codex/models/${customRecordId}`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'Gateway GPT Updated', id: 'gateway/gpt-v2' }),
      },
    );
    const updatePayload = await updateResponse.json() as {
      data: { model: { value: string; label: string } };
    };
    assert.equal(updateResponse.status, 200);
    assert.equal(updatePayload.data.model.value, 'gateway/gpt-v2');
    assert.equal(updatePayload.data.model.label, 'Gateway GPT Updated');

    const immutableResponse = await fetch(
      `${baseUrl}/api/providers/codex/models/999999`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'Changed', id: 'changed' }),
      },
    );
    const immutablePayload = await immutableResponse.json() as { error: { code: string } };
    assert.equal(immutableResponse.status, 404);
    assert.equal(immutablePayload.error.code, 'MODEL_NOT_FOUND');

    const deleteResponse = await fetch(
      `${baseUrl}/api/providers/codex/models/${customRecordId}`,
      { method: 'DELETE' },
    );
    const deletePayload = await deleteResponse.json() as {
      data: { models: { OPTIONS: Array<{ recordId: number }> } };
    };
    assert.equal(deleteResponse.status, 200);
    assert.equal(
      deletePayload.data.models.OPTIONS.some((option) => option.recordId === customRecordId),
      false,
    );
  });
});
