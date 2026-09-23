import React, { useState } from 'react';
import {
  ChevronDown,
  Edit2,
  Trash2,
  Check,
  X,
  Copy,
  Sparkles,
  PanelLeftOpen
} from 'lucide-react';
import { useChat } from '../context/ChatContext';
import { ClaudeArtifactsIcon } from './ClaudeIcons';
import { t } from '../i18n';

interface ActiveChatHeaderProps {
  isSidebarOpen?: boolean;
  onToggleSidebar?: () => void;
}

export const ActiveChatHeader: React.FC<ActiveChatHeaderProps> = ({
  isSidebarOpen = true,
  onToggleSidebar
}) => {
  const {
    activeConversation: conversation,
    activeImport,
    isArtifactPaneOpen,
    setIsArtifactPaneOpen,
    activeArtifact,
    renameConversation,
    deleteConversation,
    projects,
    setActiveProject,
    createNewConversation,
    setActivePageView
  } = useChat();

  const [isTitleMenuOpen, setIsTitleMenuOpen] = useState(false);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleInput, setTitleInput] = useState('');
  const [renameError, setRenameError] = useState('');
  const [renaming, setRenaming] = useState(false);

  const activeConversation = conversation || (activeImport && {id:activeImport.id,title:activeImport.title,projectId:projects.find(p=>p.path===activeImport.projectPath)?.id});
  if (!activeConversation) return null;

  const currentProject = activeConversation.projectId
    ? projects.find((p) => p.id === activeConversation.projectId)
    : null;

  const handleStartRename = () => {
    setRenameError('');
    setTitleInput(activeConversation.title);
    setIsEditingTitle(true);
    setIsTitleMenuOpen(false);
  };

  const handleSaveTitle = async (e: React.FormEvent) => {
    e.preventDefault();
    if (renaming || !titleInput.trim()) return;
    setRenaming(true); setRenameError('');
    try { await renameConversation(activeConversation.id, titleInput.trim()); setIsEditingTitle(false); }
    catch (error) { setRenameError(error instanceof Error ? error.message : t("Rename failed")); }
    finally { setRenaming(false); }
  };


  return (
    <>
      <header className="h-12 bg-[var(--bg-primary)] px-4 sm:px-6 flex items-center justify-between z-20 shrink-0 select-none border-b border-[var(--border-color)]">
        
        {/* TOP LEFT: Sidebar open toggle button (when collapsed) & Conversation Name ˅ */}
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {!isSidebarOpen && onToggleSidebar && (
            <button
              onClick={onToggleSidebar}
              className="p-1.5 shrink-0 rounded-lg text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)] transition-colors"
              title="Open sidebar"
              aria-label="Open sidebar"
            >
              <PanelLeftOpen className="w-4 h-4" />
            </button>
          )}

          {isEditingTitle && !activeImport ? (
            <form onSubmit={handleSaveTitle} className="flex flex-wrap items-center gap-1.5 min-w-0">
              <input
                type="text"
                value={titleInput}
                disabled={renaming}
                aria-label="Rename conversation"
                onChange={(e) => setTitleInput(e.target.value)}
                autoFocus
                className="min-w-0 bg-[var(--bg-card-hover)] text-xs font-medium text-[var(--text-primary)] px-2.5 py-1 rounded-lg border border-[#DA7756] focus:outline-none"
              />
              <button type="submit" disabled={renaming} className="p-1 text-[#DA7756] hover:text-white" title={t('Save')}>
                <Check className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                disabled={renaming}
                onClick={() => setIsEditingTitle(false)}
                className="p-1 text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                title={t('Cancel')}
              >
                <X className="w-3.5 h-3.5" />
              </button>
              {renameError && <span role="alert" className="basis-full text-xs text-red-500">{renameError}</span>}
            </form>
          ) : (
            <div className="flex items-center gap-1.5 min-w-0 flex-1">
              {currentProject && (
                <>
                  <button
                    onClick={() => {
                      createNewConversation(currentProject.id);
                      setActiveProject(currentProject);
                      setActivePageView('projects');
                    }}
                    className="text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors truncate max-w-[25%] font-normal"
                    title={`Back to ${currentProject.name}`}
                  >
                    {currentProject.name}
                  </button>
                  <span className="text-xs text-[var(--text-secondary)]">/</span>
                </>
              )}

              <div className="relative min-w-0">
                <button
                  onClick={() => setIsTitleMenuOpen(!isTitleMenuOpen)}
                  disabled={Boolean(activeImport)}
                  className="flex items-center gap-1.5 max-w-full text-xs font-normal text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)] px-2 py-1 rounded-lg transition-colors group"
                >
                  <span className="truncate max-w-[240px] sm:max-w-md text-[var(--text-primary)] font-medium">
                    {activeConversation.title}
                  </span>
                  {!activeImport && <ChevronDown className="w-3.5 h-3.5 shrink-0 text-[var(--text-secondary)] group-hover:text-[var(--text-primary)]" />}
                </button>

                {/* Title Context Menu */}
                {isTitleMenuOpen && !activeImport && (
                  <div
                    className="absolute top-full left-0 mt-1 w-44 bg-[var(--bg-card-hover)] border border-[var(--border-color)] rounded-xl shadow-2xl p-1 z-50 text-xs"
                    onClick={() => setIsTitleMenuOpen(false)}
                  >
                    <button
                      onClick={handleStartRename}
                      className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)] hover:text-[var(--text-primary)] text-left"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                      <span>{t('Rename chat')}</span>
                    </button>
                    <button
                      onClick={() => deleteConversation(activeConversation.id)}
                      className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-red-400 hover:bg-red-950/40 text-left"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>{t('Delete chat')}</span>
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* TOP RIGHT: Share Button ONLY (and optional Artifacts split pane toggle if active) */}
        <div className="flex items-center gap-3 shrink-0">
          {activeArtifact && (
            <button
              onClick={() => setIsArtifactPaneOpen(!isArtifactPaneOpen)}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border transition-all ${
                isArtifactPaneOpen
                  ? 'bg-[#DA7756]/15 border-[#DA7756]/50 text-[#DA7756]'
                  : 'bg-[var(--bg-card-hover)] border-[var(--border-color)] text-[var(--text-primary)] hover:text-[var(--text-primary)]'
              }`}
            >
              <ClaudeArtifactsIcon size={14} color="#DA7756" />
              <span className="hidden sm:inline">Artifacts</span>
            </button>
          )}

        </div>
      </header>

    </>
  );
};
