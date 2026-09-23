import { Artifact, ArtifactType } from '../types';

export interface ParseResult {
  cleanedText: string;
  artifacts: Artifact[];
  thinkingContent?: string;
}

const renderable: Record<string, { type: ArtifactType; title: string }> = {
  html: { type: 'text/html', title: 'HTML' },
  htm: { type: 'text/html', title: 'HTML' },
  svg: { type: 'image/svg+xml', title: 'SVG' },
  jsx: { type: 'application/vnd.ant.react', title: 'React' },
  tsx: { type: 'application/vnd.ant.react', title: 'React' },
};

/** Consume ordinary fences too, so examples inside them remain literal text. */
function parseText(rawText: string, messageId: string, streaming = false): ParseResult {
  const artifacts: Artifact[] = [];
  const thinking: string[] = [];
  const blocks = /```([^\r\n`]*)\r?\n([\s\S]*?)(```|$)|`+[^`\r\n]*`+|<antArtifact\b([^>]*)>([\s\S]*?)(<\/antArtifact>|$)|<(thinking|antThinking)>([\s\S]*?)<\/\7>/gi;
  const cleanedText = rawText.replace(blocks, (whole, info, code, fenceEnd, attrs, taggedCode, tagEnd, thinkingTag, thought) => {
    if (thinkingTag) {
      thinking.push(thought.trim());
      return '';
    }
    const explicit = attrs !== undefined;
    const language = info?.trim().toLowerCase();
    const format = renderable[language];
    if (!explicit && !format) return whole;
    if (!(explicit ? tagEnd : fenceEnd) && !streaming) return whole;

    const attribute = (name: string) => attrs?.match(new RegExp(name + String.raw`\s*=\s*["']([^"']+)["']`, 'i'))?.[1];
    const identifier = attribute('identifier') || `artifact-${artifacts.length}`;
    artifacts.push({
      id: `${messageId}-artifact-${artifacts.length}`,
      identifier,
      type: (attribute('type') || format?.type || 'application/vnd.ant.code') as ArtifactType,
      title: attribute('title') || format?.title || 'Artifact',
      language: attribute('language') || language,
      content: (explicit ? taggedCode : code).trim(),
      messageId,
      createdAt: Date.now(),
    });
    return '';
  }).trim();
  return { cleanedText, artifacts, thinkingContent: thinking.join('\n\n') || undefined };
}

export function cleanStreamingChatText(rawText: string): { cleanText: string; isCrafting: boolean; artifactTitle?: string } {
  const parsed = parseText(rawText, '', true);
  return { cleanText: parsed.cleanedText, isCrafting: parsed.artifacts.length > 0, artifactTitle: parsed.artifacts[parsed.artifacts.length - 1]?.title };
}

export function extractArtifactsAndThinking(rawText: string, messageId = ''): ParseResult {
  return parseText(rawText, messageId);
}
