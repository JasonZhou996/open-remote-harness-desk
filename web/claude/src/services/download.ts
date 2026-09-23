import { Artifact } from '../types';
import { backend } from './backend';

declare global {
  interface Window { CodexBrowser?: { download?: (url: string, filename: string) => boolean } }
}

function saveLink(url: string, filename: string) {
  if (/^https?:/.test(url) && window.CodexBrowser?.download?.(url, filename)) return;
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

export function downloadFile(path: string, filename: string) {
  const url = new URL('/api/files/download', window.location.href);
  url.searchParams.set('path', path);
  saveLink(url.href, filename);
}

export async function downloadArtifact(artifact: Artifact) {
  if (artifact.sourcePath) return downloadFile(artifact.sourcePath, artifact.identifier);
  const ext = artifact.type.includes('html') ? '.html' : artifact.type.includes('react') ? '.tsx'
    : artifact.type.includes('svg') ? '.svg' : artifact.type.includes('markdown') ? '.md' : '.txt';
  const name = (artifact.identifier || 'artifact').replace(/[\\/\x00-\x1f\x7f]/g, '_');
  const filename = name.toLowerCase().endsWith(ext) ? name : name + ext;
  if (window.CodexBrowser) {
    // The APK saves HTTP files; blob URLs belong only to the WebView renderer.
    const file = await backend.api<{path: string; filename: string}>(`/api/attachments?${new URLSearchParams({name: filename})}`, {
      method: 'POST', headers: {'Content-Type': 'application/octet-stream'}, body: artifact.content,
    }, '/');
    downloadFile(file.path, file.filename);
  } else {
    const url = URL.createObjectURL(new Blob([artifact.content], {type: 'text/plain;charset=utf-8'}));
    saveLink(url, filename);
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}
