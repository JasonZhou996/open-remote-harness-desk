import {t} from '../i18n';
import {useSettings} from '../context/SettingsContext';
import React, {useEffect, useRef} from 'react';
import {renderImportPicker, renderImportProgress} from '../../../shared/session-import';
import {useChat} from '../context/ChatContext';

export function SessionImport({progress=false}:{progress?:boolean}) {
  const {activeProject, activeImport, openImport, createNewConversation} = useChat();
  const {settings}=useSettings();
  const ref=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    if (!ref.current) return;
    if (progress && activeImport) {
      renderImportProgress(ref.current,activeImport,openImport,()=>createNewConversation(activeProject?.id),t);
    } else if (!progress) return renderImportPicker(ref.current,'claude',activeProject?.path || '',openImport,t);
  },[progress,activeImport,activeProject?.path,settings.language]);
  return <div ref={ref}/>;
}
