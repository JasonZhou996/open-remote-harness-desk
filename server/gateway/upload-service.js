import {mkdtemp, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, basename} from 'node:path';

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
export async function saveUpload(stream, name) {
  const filename = basename(String(name || 'attachment').replaceAll('\\', '/')).replace(/[\x00-\x1f\x7f]/g, '_').slice(-180) || 'attachment';
  let size = 0; const chunks = [];
  for await (const chunk of stream) {
    const bytes = Buffer.from(chunk); size += bytes.length;
    if (size > MAX_UPLOAD_BYTES) throw new Error('单个附件不能超过 25 MB');
    chunks.push(bytes);
  }
  if (!size) throw new Error('不能上传空文件');
  const bytes = Buffer.concat(chunks);
  const image = bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) || bytes.subarray(0,3).equals(Buffer.from([255,216,255])) || /^GIF8[79]a/.test(bytes.subarray(0,6).toString()) || (bytes.subarray(0,4).toString()==='RIFF' && bytes.subarray(8,12).toString()==='WEBP');
  const directory = await mkdtemp(join(tmpdir(),'codex-webui-upload-'));
  const path = join(directory, filename);
  await writeFile(path, bytes, {mode:0o600, flag:'wx'});
  return {path, filename, size, kind:image?'image':'file'};
}
