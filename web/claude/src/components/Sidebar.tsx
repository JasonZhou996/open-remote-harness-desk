import React, { useState, useRef, useEffect } from 'react';
import '../../../codex/product-switcher.js';
import { subscribeUsage } from '../services/usage';
import {
  Plus,
  ChevronDown,
  ChevronRight,
  ArrowUpRight,
  Search,
  Download,
  Trash2,
  Edit2,
  Star,
  Check,
  X,
  Settings,
  Globe,
  HelpCircle,
  ArrowUpCircle,
  GraduationCap,
  LogOut,
  PanelLeftClose,
  Sparkles,
  FolderKanban,
  Code2,
  Sliders,
  SlidersHorizontal,
  MoreHorizontal,
  Clock,
} from 'lucide-react';
import { useChat } from '../context/ChatContext';
import { useSettings } from '../context/SettingsContext';
import { useAuth } from '../context/AuthContext';
import { Conversation } from '../types';
import { ClaudeProjectsIcon, ClaudeArtifactsIcon, ClaudeCustomizeIcon, ClaudeNewChatIcon, ClaudeCodeIcon } from './ClaudeIcons';
import { t } from '../i18n';

interface SidebarProps {
  isOpen: boolean;
  onToggle: () => void;
  onOpenSearch: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ isOpen, onToggle, onOpenSearch }) => {
  const { user, logout } = useAuth();
  const {
    conversations,
    activeConversationId,
    runningSessionIds,
    activePageView,
    setActivePageView,
    createNewConversation,
    selectConversation,
    deleteConversation,
    renameConversation,
    toggleStarConversation,
    projects,
    activeProject,
    setActiveProject
  } = useChat();

  const { settings, setIsSettingsOpen } = useSettings();

  const [searchQuery, setSearchQuery] = useState('');
  const [editingChatId, setEditingChatId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [renameError, setRenameError] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [contextMenuChatId, setContextMenuChatId] = useState<string | null>(null);
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);
  const [isProjectsExpanded, setIsProjectsExpanded] = useState<boolean>(true);
  const [isChatsExpanded, setIsChatsExpanded] = useState<boolean>(true);
  const [collapsedProjects, setCollapsedProjects] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem('cc_collapsed_projects') || '[]'));
    } catch {
      return new Set();
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem('cc_collapsed_projects', JSON.stringify([...collapsedProjects]));
    } catch {}
  }, [collapsedProjects]);

  // Real plan name for the profile pill (never the stale DB tier).
  const [planName, setPlanName] = useState<string | null>(null);
  useEffect(() => subscribeUsage(info => setPlanName(info?.plan || null)), []);

  const sidebarRef = useRef<HTMLDivElement>(null);
  const profileMenuRef = useRef<HTMLDivElement>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);

  // Close menus when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (profileMenuRef.current && !profileMenuRef.current.contains(target)) {
        setIsProfileMenuOpen(false);
      }
      if (contextMenuRef.current && !contextMenuRef.current.contains(target)) {
        setContextMenuChatId(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Standalone conversations (not belonging to any project)
  const standaloneConversations = conversations.filter((c) =>
    !c.projectId && c.title.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleSelectConversation = (id: string) => {
    selectConversation(id);
    if (window.innerWidth < 768) {
      onToggle();
    }
  };

  const handleNewChatClick = () => {
    createNewConversation(activeProject?.id);
    if (window.innerWidth < 768) {
      onToggle();
    }
  };

  const handleNavClick = (view: any) => {
    setActivePageView(view);
    if (window.innerWidth < 768) {
      onToggle();
    }
  };

  const startEditing = (chat: Conversation, e: React.MouseEvent) => {
    e.stopPropagation();
    if (renaming) return;
    setRenameError('');
    setEditingChatId(chat.id);
    setEditTitle(chat.title);
    setContextMenuChatId(null);
  };

  const handleSaveRename = async (id: string, e: React.FormEvent) => {
    e.preventDefault();
    if (renaming || !editTitle.trim()) return;
    setRenaming(true); setRenameError('');
    try { await renameConversation(id, editTitle.trim()); setEditingChatId(null); }
    catch (error) { setRenameError(error instanceof Error ? error.message : t("Rename failed")); }
    finally { setRenaming(false); }
  };

  const renderRenameForm = (id: string) => (
    <form onSubmit={e => void handleSaveRename(id, e)} className="flex flex-wrap items-center gap-1.5 w-full" onClick={e => e.stopPropagation()}>
      <input type="text" value={editTitle} disabled={renaming} onChange={e => setEditTitle(e.target.value)} autoFocus
        className="min-w-0 flex-1 bg-[var(--bg-primary)] text-sm text-[var(--text-primary)] px-2.5 py-1 rounded-lg border border-[#DA7756] focus:outline-none"
        aria-label="Rename conversation" onKeyDown={e => { if (e.key === 'Escape' && !renaming) setEditingChatId(null); }} />
      <button type="submit" disabled={renaming} className="p-1 hover:text-[#DA7756] text-[var(--text-secondary)]" aria-label={t('Save')}><Check className="w-3.5 h-3.5" /></button>
      <button type="button" disabled={renaming} onClick={() => setEditingChatId(null)} className="p-1 text-[var(--text-secondary)]" aria-label={t('Cancel')}><X className="w-3.5 h-3.5" /></button>
      {renameError && <span role="alert" className="basis-full text-xs text-red-500">{renameError}</span>}
    </form>
  );

  return (
    <>
      {/* Mobile Backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/60 backdrop-blur-xs md:hidden"
          onClick={onToggle}
          aria-hidden="true"
        />
      )}

      {/* Sidebar Container */}
      <aside
        ref={sidebarRef}
        role="navigation"
        aria-label="Main navigation"
        className={`fixed inset-y-0 left-0 z-40 flex flex-col w-[270px] bg-[var(--bg-primary)] border-r border-[var(--border-color)] transition-transform duration-200 ease-in-out select-none ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        } md:static md:shrink-0 ${isOpen ? 'md:translate-x-0' : 'md:-translate-x-full md:w-0 md:border-0 md:overflow-hidden'}`}
      >
        {/* ─── Top Brand Header (matching Image 1) ─── */}
        <div className="flex items-center justify-between px-4 pt-4 pb-2.5">
          {React.createElement('product-switcher', {product:'claude'})}
          <button
            onClick={onToggle}
            className="p-1.5 rounded-lg text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)] transition-colors"
            aria-label="Close sidebar"
          >
            <PanelLeftClose className="w-4 h-4 stroke-[2]" />
          </button>
        </div>

        {/* ─── New Chat Button ─── */}
        <div className="px-3 mb-1">
          <button
            onClick={handleNewChatClick}
            className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-[13px] font-normal transition-all group ${
              activePageView === 'chat' && !activeConversationId
                ? 'bg-[var(--bg-card-hover)] text-[var(--text-primary)] font-medium'
                : 'text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)] hover:text-[var(--text-primary)]'
            }`}
            aria-label="Start new conversation"
          >
            <ClaudeNewChatIcon size={18} />
            <span>{t('New chat')}</span>
          </button>
        </div>

        <nav className="px-3 space-y-0.5 mb-4 text-[13px]" aria-label="Primary navigation">
          <button className="nav-row" onClick={() => { onOpenSearch(); if (window.innerWidth < 768) onToggle(); }}><Search size={18} />{t('Search')}</button>
          <button className="nav-row" onClick={() => { setActiveProject(null); handleNavClick('projects'); }}><FolderKanban size={18} />{t('Projects')}</button>
          <button className="nav-row" onClick={() => handleNavClick('routines')}><Clock size={18}/><span>{t("Scheduled tasks")}</span></button>
        </nav>

        {/* Everything between the nav and the account area scrolls as one
            region; without this the projects tree overflows the fixed-height
            aside and gets clipped with no way to reach it. */}
        <div className="flex-1 min-h-0 overflow-y-auto">
        {/* ─── Dynamic Projects Section (matching reference images) ─── */}
        {projects && projects.length > 0 && (
          <div className="px-3 mb-2.5">
            <div className="flex items-center justify-between px-1.5 py-1 text-xs text-[var(--text-secondary)]">
              <button
                onClick={() => setIsProjectsExpanded(!isProjectsExpanded)}
                className="flex items-center gap-1.5 font-medium text-[13px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors select-none"
              >
                <span>{t('Projects')}</span>
                {isProjectsExpanded ? (
                  <ChevronDown className="w-3.5 h-3.5 text-[var(--text-secondary)]" />
                ) : (
                  <ChevronRight className="w-3.5 h-3.5 text-[var(--text-secondary)]" />
                )}
              </button>

              <div className="flex items-center gap-1.5">
                {isProjectsExpanded && (
                  <button
                    onClick={() => {
                      setActiveProject(null);
                      setActivePageView('projects');
                    }}
                    className="p-1 rounded hover:text-[var(--text-primary)] text-[var(--text-secondary)] transition-colors"
                    title="View all projects"
                  >
                    <ArrowUpRight className="w-3.5 h-3.5 stroke-[2]" />
                  </button>
                )}
                <button
                  onClick={() => {
                    setActiveProject(null);
                    setActivePageView('projects');
                  }}
                  className="p-1 rounded hover:text-[var(--text-primary)] text-[var(--text-secondary)] transition-colors"
                  title="Create or view projects"
                >
                  <Plus className="w-4 h-4 stroke-[2.2]" />
                </button>
              </div>
            </div>

            {isProjectsExpanded && (
              <div className="space-y-1 mt-0.5 animate-in fade-in duration-100">
                {projects.map((proj) => {
                  const projectChats = conversations.filter((c) => c.projectId === proj.id);
                  const isProjActive = activePageView === 'projects' && activeProject?.id === proj.id;
                  const isProjCollapsed = collapsedProjects.has(proj.id);
                  const toggleProj = () => {
                    setCollapsedProjects((prev) => {
                      const next = new Set(prev);
                      if (next.has(proj.id)) next.delete(proj.id);
                      else next.add(proj.id);
                      return next;
                    });
                  };

                  return (
                    <div key={proj.id} className="space-y-0.5">
                      <div className="group/proj relative">
                      <button
                        onClick={() => { createNewConversation(proj.id); setActiveProject(proj); handleNavClick('projects'); }}
                        title={proj.description || proj.name}
                        className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-[14px] text-left transition-colors ${
                          isProjActive
                            ? 'bg-[var(--bg-card-hover)] text-[var(--text-primary)] font-medium'
                            : 'text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)] hover:text-[var(--text-primary)]'
                        }`}
                      >
                        <span role="button" tabIndex={0} aria-label={isProjCollapsed ? t("Expand projects") : t("Collapse projects")} aria-expanded={!isProjCollapsed} onClick={e=>{e.stopPropagation();toggleProj();}} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();e.stopPropagation();toggleProj();}}}>
                          {isProjCollapsed?<ChevronRight size={18}/>:<ChevronDown size={18}/>}
                        </span>
                        <span className="truncate">{proj.name}</span>
                        <span className="ml-auto text-[11px] text-[var(--text-secondary)] shrink-0 group-hover/proj:opacity-0 transition-opacity">{projectChats.length}</span>
                      </button>
                      {/* New task inside this project */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          // New task must be visible immediately — expand if collapsed.
                          setCollapsedProjects((prev) => {
                            if (!prev.has(proj.id)) return prev;
                            const next = new Set(prev);
                            next.delete(proj.id);
                            return next;
                          });
                          createNewConversation(proj.id);
                        }}
                        className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1 rounded-md text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)] opacity-0 group-hover/proj:opacity-100 transition-opacity"
                        title={t("New task in {value0}", {value0: proj.name})}
                        aria-label={`New task in ${proj.name}`}
                      >
                        <Plus className="w-3.5 h-3.5 stroke-[2.2]" />
                      </button>
                      </div>

                      {/* Nested Project Chats Tree */}
                      {!isProjCollapsed && projectChats.length > 0 && (
                        <div className="ml-4 pl-3.5 border-l border-[var(--border-color)] space-y-0.5 py-0.5">
                          {projectChats.map((chat) => {
                            const isChatActive = activePageView === 'chat' && chat.id === activeConversationId;
                            const isContextOpen = !chat.id.startsWith('import-') && contextMenuChatId === chat.id;

                            return (
                              <div
                                key={chat.id}
                                onClick={() => handleSelectConversation(chat.id)}
                                className={`group relative flex items-center justify-between py-1.5 px-2 rounded-lg text-[13.5px] transition-colors cursor-pointer ${
                                  isChatActive
                                    ? 'text-[var(--text-primary)] font-medium bg-[var(--bg-card-hover)]'
                                    : 'text-[var(--text-primary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)]'
                                }`}
                              >
                                {editingChatId === chat.id ? renderRenameForm(chat.id) : <>
                                <div className="flex items-center gap-2.5 overflow-hidden mr-2 min-w-0">
                                  <span
                                    title={runningSessionIds.has(chat.id) ? t("Running") : undefined}
                                    className={`w-2 h-2 rounded-full shrink-0 transition-colors ${
                                      runningSessionIds.has(chat.id)
                                        ? 'bg-[#DA7756] animate-pulse'
                                        : isChatActive
                                          ? 'border-[1.6px] border-[var(--border-color)] bg-[var(--bg-card-hover)]/40'
                                          : 'border-[1.6px] border-[var(--border-color)]'
                                    }`}
                                  />
                                  <span className="truncate">{chat.title}</span>
                                </div>

                                <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      if(!chat.id.startsWith('import-')) setContextMenuChatId(isContextOpen ? null : chat.id);
                                    }}
                                    className="p-1 rounded text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)]"
                                    hidden={chat.id.startsWith('import-')}
                          aria-label="More actions"
                                  >
                                    <MoreHorizontal className="w-3.5 h-3.5" />
                                  </button>
                                </div>

                                </>}
                                {isContextOpen && (
                                  <div
                                    ref={contextMenuRef}
                                    className="absolute right-2 top-8 w-36 bg-[var(--bg-card-hover)] border border-[var(--border-color)] rounded-xl shadow-2xl p-1 z-50 text-xs"
                                    onClick={(e) => e.stopPropagation()}
                                    role="menu"
                                  >
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        toggleStarConversation(chat.id);
                                        setContextMenuChatId(null);
                                      }}
                                      className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-[var(--bg-card-hover)] text-left text-[var(--text-primary)]"
                                      role="menuitem"
                                    >
                                      <Star className={`w-3.5 h-3.5 ${chat.isStarred ? 'text-[#DA7756] fill-[#DA7756]' : 'text-[var(--text-secondary)]'}`} />
                                      <span>{chat.isStarred ? 'Unstar' : 'Star'}</span>
                                    </button>
                                    <button
                                      onClick={(e) => startEditing(chat, e)}
                                      className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-[var(--bg-card-hover)] text-left text-[var(--text-primary)]"
                                      role="menuitem"
                                    >
                                      <Edit2 className="w-3.5 h-3.5 text-[var(--text-secondary)]" />
                                      <span>{t('Rename')}</span>
                                    </button>
                                    <div className="my-0.5 border-t border-[var(--border-color)]" />
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        deleteConversation(chat.id);
                                        setContextMenuChatId(null);
                                      }}
                                      className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-red-950/40 text-left text-red-400"
                                      role="menuitem"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                      <span>{t('Delete')}</span>
                                    </button>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ─── Chats and Tasks Header (matching reference images) ─── */}
        <div className="px-4 mb-1">
          <div className="flex items-center justify-between py-1.5 text-xs text-[var(--text-secondary)]">
            <button
              onClick={() => setIsChatsExpanded(!isChatsExpanded)}
              className="flex items-center gap-1.5 font-medium text-[13px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors select-none"
            >
              <span>{t("Recents")}</span>
              {!isChatsExpanded && (
                <ChevronRight className="w-3.5 h-3.5 text-[var(--text-secondary)]" />
              )}
            </button>
            <button
              onClick={onOpenSearch}
              className="p-1 rounded hover:text-[var(--text-primary)] text-[var(--text-secondary)] transition-colors"
              title="Filter / Search (Ctrl+K)"
              aria-label="Filter chats"
            >
              <SlidersHorizontal className="w-4 h-4 stroke-[2]" />
            </button>
          </div>
        </div>

        {/* ─── Scrollable History List with Bullets (matching reference images) ─── */}
        {isChatsExpanded && (
          <div className="flex-1 overflow-y-auto px-2.5 pb-2 space-y-0.5 animate-in fade-in duration-100" role="list" aria-label="Conversation history">
            {standaloneConversations.length === 0 && (
              <div className="px-3 py-6 text-center text-xs text-[var(--text-secondary)]">
                {searchQuery ? `No results for "${searchQuery}"` : t('No conversations yet')}
              </div>
            )}

            {standaloneConversations.map((chat) => {
              const isActive = activePageView === 'chat' && chat.id === activeConversationId;
              const isEditing = editingChatId === chat.id;
              const isContextOpen = !chat.id.startsWith('import-') && contextMenuChatId === chat.id;

              return (
                <div
                  key={chat.id}
                  role="listitem"
                  onClick={() => handleSelectConversation(chat.id)}
                  className={`group relative flex items-center justify-between px-3 py-2 rounded-xl text-[14.5px] leading-normal cursor-pointer transition-colors ${
                    isActive
                      ? 'bg-[var(--bg-card-hover)] text-[var(--text-primary)] font-normal'
                      : 'text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)] hover:text-[var(--text-primary)]'
                  }`}
                  aria-selected={isActive}
                  aria-label={`Conversation: ${chat.title}`}
                >
                  {isEditing ? (
                    renderRenameForm(chat.id)
                  ) : (
                    <>
                      <div className="flex items-center gap-2.5 overflow-hidden mr-2 min-w-0">
                        {/* Bullet Circle (matching Claude) */}
                        <span
                          title={runningSessionIds.has(chat.id) ? t("Running") : undefined}
                          className={`w-2 h-2 rounded-full shrink-0 transition-colors ${
                            runningSessionIds.has(chat.id)
                              ? 'bg-[#DA7756] animate-pulse'
                              : isActive
                                ? 'border-[1.5px] border-[var(--border-color)] bg-[var(--bg-card-hover)]/40'
                                : 'border-[1.5px] border-[var(--border-color)]'
                          }`}
                        />
                        <span className="truncate">{chat.title}</span>
                      </div>

                      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            if(!chat.id.startsWith('import-')) setContextMenuChatId(isContextOpen ? null : chat.id);
                          }}
                          className="p-1 rounded text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)]"
                          hidden={chat.id.startsWith('import-')}
                                    aria-label="More actions"
                          aria-haspopup="true"
                          aria-expanded={isContextOpen}
                        >
                          <MoreHorizontal className="w-4 h-4" />
                        </button>
                      </div>

                      {/* Context menu */}
                      {isContextOpen && (
                        <div
                          ref={contextMenuRef}
                          className="absolute right-2 top-8 w-36 bg-[var(--bg-card-hover)] border border-[var(--border-color)] rounded-xl shadow-2xl p-1 z-50 text-xs"
                          onClick={(e) => e.stopPropagation()}
                          role="menu"
                        >
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleStarConversation(chat.id);
                              setContextMenuChatId(null);
                            }}
                            className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-[var(--bg-card-hover)] text-left text-[var(--text-primary)]"
                            role="menuitem"
                          >
                            <Star className={`w-3.5 h-3.5 ${chat.isStarred ? 'text-[#DA7756] fill-[#DA7756]' : 'text-[var(--text-secondary)]'}`} />
                            <span>{chat.isStarred ? 'Unstar' : 'Star'}</span>
                          </button>
                          <button
                            onClick={(e) => startEditing(chat, e)}
                            className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-[var(--bg-card-hover)] text-left text-[var(--text-primary)]"
                            role="menuitem"
                          >
                            <Edit2 className="w-3.5 h-3.5 text-[var(--text-secondary)]" />
                            <span>{t('Rename')}</span>
                          </button>
                          <div className="my-0.5 border-t border-[var(--border-color)]" />
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              deleteConversation(chat.id);
                              setContextMenuChatId(null);
                            }}
                            className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-red-950/40 text-left text-red-400"
                            role="menuitem"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            <span>{t('Delete')}</span>
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}

        </div>

        <div className="claude-sidebar-account mt-auto border-t border-[var(--border-color)] p-3">
          <button className="nav-row" onClick={() => { setIsSettingsOpen(true); if (window.innerWidth < 768) onToggle(); }} aria-label={t("Settings")}>
            <span className="w-7 h-7 rounded-full bg-[var(--bg-card-hover)] flex items-center justify-center">{(user?.name || settings.userName || 'J').charAt(0)}</span>
            <span className="truncate">{user?.name || settings.userName || 'Claude'}{planName && ` · ${planName}`}</span>
            <Settings size={18} className="ml-auto shrink-0" />
          </button>
        </div>
      </aside>
    </>
  );
};
