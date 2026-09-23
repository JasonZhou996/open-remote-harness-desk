import os from 'node:os';
import path from 'node:path';
import { realpath, readFile } from 'node:fs/promises';

import { projectsDb, sessionsDb } from '@/modules/database/index.js';
import { broadcastSessionUpserted } from '@/modules/websocket/index.js';
import { AppError } from '@/shared/utils.js';

import { sessionSynchronizerService } from './session-synchronizer.service.js';

/** Provider routes expose indexed source files and register completed imports for the unified gateway. */
export const sessionImportService = {
  async candidates(projectPath: string) {
    const cwd = await realpath(projectPath);
    const matching = await Promise.all(projectsDb.getProjectPaths().map(async project =>
      await realpath(project.project_path).catch(() => '') === cwd ? project : null));
    return matching.filter(project => project !== null).flatMap(project =>
      sessionsDb.getSessionsByProjectPath(project.project_path)
        .filter(row => row.provider === 'claude' && row.provider_session_id && row.jsonl_path)
        .map(row => ({id: row.session_id, file: row.jsonl_path, title: row.custom_name || '未命名对话', updatedAt: row.updated_at})));
  },
  async register(sessionId: string, projectPath: string) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sessionId) || !path.isAbsolute(projectPath)) {
      throw new AppError('Invalid imported session', {statusCode: 400, code: 'INVALID_IMPORT'});
    }
    const cwd = await realpath(projectPath);
    const root = await realpath(path.join(os.homedir(), '.claude', 'projects'));
    const file = await realpath(path.join(root, cwd.replace(/[^a-zA-Z0-9]/g, '-'), `${sessionId}.jsonl`));
    if (!file.startsWith(root + path.sep)) throw new AppError('Invalid import path', {statusCode: 400, code: 'INVALID_IMPORT'});
    const first = JSON.parse((await readFile(file, 'utf8')).split('\n').find(line => line.trim()) || '{}');
    if (first.sessionId !== sessionId || first.cwd !== cwd) throw new AppError('Import metadata mismatch', {statusCode: 400, code: 'INVALID_IMPORT'});
    const result = await sessionSynchronizerService.synchronizeProviderFile('claude', file);
    if (!result.sessionId) throw new Error('Claude could not index the imported conversation');
    await broadcastSessionUpserted(result.sessionId);
    return {sessionId: result.sessionId};
  },
};
