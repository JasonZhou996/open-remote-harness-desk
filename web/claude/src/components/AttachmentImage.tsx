import {t} from '../i18n';
import {useRef} from 'react';
import {X} from 'lucide-react';
import type {Attachment} from '../types';
import {attachmentImageUrl} from '../services/attachments';

/** Composer, queue and transcript thumbnails follow the original image-card UI. */
export function AttachmentImage({attachment,compact=false,onRemove}:{attachment:Attachment;compact?:boolean;onRemove?:()=>void}){
  const preview=useRef<HTMLDialogElement>(null);
  const src=attachmentImageUrl(attachment);
  return <div className="group/image relative inline-block max-w-full shrink-0 align-top">
    <button type="button" aria-label={t("View image: {value0}", {value0: attachment.name})} title={attachment.name} onClick={()=>preview.current?.showModal()}
      className="block overflow-hidden rounded-xl border border-[var(--border-color)] shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#DA7756]">
      <img src={src} alt={attachment.name} className={`${compact?'h-20 w-20':'h-28 w-28'} cursor-zoom-in object-cover transition-transform duration-200 hover:scale-105`}/>
    </button>
    {onRemove&&<button type="button" aria-label={t("Remove attachment")} title={t("Remove {value0}", {value0: attachment.name})} onClick={onRemove}
      className="absolute -right-1.5 -top-1.5 rounded-full border border-[var(--border-color)] bg-[var(--bg-input)] p-1 shadow-sm sm:opacity-0 sm:group-hover/image:opacity-100 focus-visible:opacity-100"><X size={12}/></button>}
    <dialog ref={preview} aria-label={t("Image preview: {value0}", {value0: attachment.name})} onClick={e=>{if(e.target===e.currentTarget)e.currentTarget.close();}}
      className="fixed inset-0 m-0 h-[100dvh] w-screen max-h-none max-w-none items-center justify-center border-0 bg-transparent p-4 open:flex backdrop:bg-black/80 backdrop:backdrop-blur-sm">
      <button type="button" aria-label={t("Close image preview")} onClick={()=>preview.current?.close()} className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"><X size={20}/></button>
      <img src={src} alt={t("Preview: {value0}", {value0: attachment.name})} className="max-h-[90dvh] max-w-[92vw] rounded-lg object-contain shadow-2xl"/>
    </dialog>
  </div>;
}
