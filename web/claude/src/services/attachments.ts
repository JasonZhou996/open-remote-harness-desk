import type {Attachment} from '../types';

/** Uploaded drafts/queued messages use file paths; history embeds image data. */
export function attachmentImageUrl(attachment: Attachment): string | undefined {
  return attachment.dataUrl || (attachment.type.startsWith('image/') && attachment.path
    ? `${import.meta.env.BASE_URL}api/assets/images/${encodeURIComponent(attachment.path.split('/').pop()!)}`
    : undefined);
}
