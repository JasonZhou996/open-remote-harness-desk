import {Database} from 'bun:sqlite';
import {readdirSync} from 'node:fs';
import {join} from 'node:path';

// Native paginated forks inherit history but omit the preview used by both
// desktop and Web thread/list. Only update this fork's display metadata.
export function finalizeFork(codexHome, thread, source) {
  if (!thread.forkedFromId || thread.forkedFromId !== source.id) throw new Error('Invalid fork source');
  const file = readdirSync(codexHome).filter(name => /^state_\d+\.sqlite$/.test(name))
    .sort((a, b) => Number(b.match(/\d+/)[0]) - Number(a.match(/\d+/)[0]))[0];
  if (!file) throw new Error('Codex state database unavailable');
  const title = source.name || source.preview?.replace(/\s+/g, ' ').trim().slice(0, 110) || '新对话';
  const base = source.forkedFromId ? title.replace(/\(\d+\)$/, '') : title;
  const db = new Database(join(codexHome, file), {readwrite: true});
  try {
    return db.transaction(() => {
      let number = 2;
      const prefix = base + '(';
      for (const {name} of db.query('SELECT name FROM threads WHERE substr(name, 1, length(?)) = ?').all(prefix, prefix)) {
        const suffix = name.slice(prefix.length);
        if (/^\d+\)$/.test(suffix)) number = Math.max(number, Number(suffix.slice(0, -1)) + 1);
      }
      const name = `${base}(${number})`, preview = thread.preview || source.preview || name;
      const result = db.query("UPDATE threads SET name = ?, preview = CASE WHEN preview = '' THEN ? ELSE preview END WHERE id = ? AND archived = 0 RETURNING name, preview").get(name, preview, thread.id);
      if (!result) throw new Error('Fork is no longer available');
      return result;
    }).immediate();
  } finally { db.close(); }
}
