import {t} from './i18n';
import {Routines} from './components/WorkspaceTools';
import {SessionImport} from './components/SessionImport';
import React, { useState, useRef, useEffect } from 'react';
import { Sidebar } from './components/Sidebar';
import { ActiveChatHeader } from './components/ActiveChatHeader';
import { LandingView } from './components/LandingView';
import { ChatMessage } from './components/ChatMessage';
import { ChatInput } from './components/ChatInput';
import { ArtifactViewer } from './components/ArtifactViewer';
import { ProjectsView } from './components/ProjectsView';
import { ArtifactsView } from './components/ArtifactsView';
import { ArtifactCategoryPicker } from './components/ArtifactCategoryPicker';
import { CustomizeModal } from './components/CustomizeModal';
import { SearchModal } from './components/SearchModal';
import { useChat } from './context/ChatContext';
import { useSettings } from './context/SettingsContext';
import { useAuth } from './context/AuthContext';
import { LoginView } from './components/LoginView';
import { ArrowDown, ArrowLeft, PanelLeftOpen } from 'lucide-react';

const ClaudeWorkspace: React.FC = () => {
  const {
    activeConversation,
    activeImport,
    activeConversationId,
    activePageView,
    setActivePageView,
    isArtifactPaneOpen,
    setIsArtifactPaneOpen,
    activeArtifact,
    isStreaming
  } = useChat();

  const { settings, isSettingsOpen } = useSettings();

  const [isSidebarOpen, setIsSidebarOpen] = useState(() => {
    // Default to open on desktop, closed on mobile
    return window.innerWidth >= 768;
  });
  useEffect(() => { if (isSettingsOpen && window.innerWidth < 768) setIsSidebarOpen(false); }, [isSettingsOpen]);

  const [isSearchModalOpen, setIsSearchModalOpen] = useState(false);
  const [showScrollBottom, setShowScrollBottom] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatScrollContainerRef = useRef<HTMLDivElement>(null);
  const followsBottom = useRef(true);
  const lastScrollTop = useRef(0);
  const touchY = useRef<number | null>(null);
  const [savedPosition] = useState(() => {
    try { return JSON.parse(localStorage.getItem('claude-workspace-scroll') || 'null'); } catch { return null; }
  });
  const pendingPosition = useRef(savedPosition);
  const savePosition = () => {
    const el = chatScrollContainerRef.current;
    if (!el || !activeConversationId || pendingPosition.current?.sessionId === activeConversationId) return;
    try { localStorage.setItem('claude-workspace-scroll', JSON.stringify({sessionId: activeConversationId, top: el.scrollTop, follow: followsBottom.current, sidebar: isSidebarOpen})); } catch { /* Storage disabled. */ }
  };
  useEffect(() => {
    if (typeof savedPosition?.sidebar === 'boolean') setIsSidebarOpen(savedPosition.sidebar);
  }, [savedPosition]);
  useEffect(() => {
    const save = () => savePosition();
    window.addEventListener('pagehide', save);
    window.addEventListener('workspace-save', save);
    document.addEventListener('visibilitychange', save);
    return () => {
      window.removeEventListener('pagehide', save);
      window.removeEventListener('workspace-save', save);
      document.removeEventListener('visibilitychange', save);
    };
  }, [activeConversationId, isSidebarOpen]);

  // Handle window resize - auto-close sidebar on mobile
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth < 768) {
        // Don't force close if user explicitly opened it
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const hasMessages = Boolean(activeConversation && activeConversation.messages.length > 0);

  // scrollIntoView() also scrolls overflow-hidden ancestors (they carry no
  // scrollbar but keep a stale scrollTop, shoving the whole layout off-screen),
  // so drive the messages container's scrollTop directly instead.
  const scrollToBottom = () => {
    const el = chatScrollContainerRef.current;
    followsBottom.current = true;
    if (el) { el.scrollTop = el.scrollHeight; lastScrollTop.current = el.scrollTop; }
    setShowScrollBottom(false);
  };

  // A different conversation starts at the bottom; updates keep the reader's position.
  useEffect(() => {
    followsBottom.current = pendingPosition.current?.sessionId === activeConversationId ? pendingPosition.current.follow !== false : true;
    lastScrollTop.current = 0;
    let el: HTMLElement | null = chatScrollContainerRef.current?.parentElement ?? null;
    while (el && el !== document.body) {
      if (el.scrollTop > 0) el.scrollTop = 0;
      el = el.parentElement;
    }
  }, [activeConversationId]);

  useEffect(() => {
    const saved = pendingPosition.current, el = chatScrollContainerRef.current;
    if (saved?.sessionId === activeConversationId && el && hasMessages) {
      pendingPosition.current = null;
      el.scrollTop = saved.follow === false ? Number(saved.top) || 0 : el.scrollHeight;
      lastScrollTop.current = el.scrollTop;
      setShowScrollBottom(el.scrollHeight - el.scrollTop - el.clientHeight >= 80);
    }
    if (followsBottom.current && activePageView === 'chat' && hasMessages && settings.autoScroll !== false) {
      scrollToBottom();
    }
  }, [activeConversationId, activeConversation?.messages, isStreaming, activePageView, settings.autoScroll, hasMessages]);

  // Global keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl/Cmd+K for search
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setIsSearchModalOpen((prev) => !prev);
      }
      // Ctrl+Shift+, for settings
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === ',') {
        e.preventDefault();
        // Settings handled in SettingsContext
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleScroll = () => {
    if (chatScrollContainerRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = chatScrollContainerRef.current;
      const isNearBottom = scrollHeight - scrollTop - clientHeight < 80;
      if (scrollTop !== lastScrollTop.current) {
        followsBottom.current = scrollTop > lastScrollTop.current && isNearBottom;
        lastScrollTop.current = scrollTop;
      }
      setShowScrollBottom(!isNearBottom);
      savePosition();
    }
  };

  return (
    <div className="flex h-[100dvh] w-full overflow-hidden bg-[var(--bg-primary)] text-[var(--text-primary)] font-sans antialiased selection:bg-[#DA7756]/30">
      {/* Left Navigation Sidebar */}
      <Sidebar
        isOpen={isSidebarOpen}
        onToggle={() => setIsSidebarOpen(!isSidebarOpen)}
        onOpenSearch={() => setIsSearchModalOpen(true)}
      />

      {/* Main Workspace Viewport */}
      <div className="flex-1 flex flex-col min-w-0 h-full relative overflow-hidden bg-[var(--bg-primary)]">
        {/* Navigation belongs to the workspace, including pages without a chat header. */}
        {(activePageView !== 'chat' || (!hasMessages && activeConversation?.isArtifactPicker)) && (
          <header className="h-12 px-3 sm:px-5 flex items-center gap-1 shrink-0">
            {!isSidebarOpen && (
              <button className="workspace-icon" aria-label={t("Open sidebar")} aria-expanded={false} onClick={() => setIsSidebarOpen(true)}>
                <PanelLeftOpen size={20} />
              </button>
            )}
            <button className="workspace-icon" aria-label={t("Back to chat")} title={t("Back to chat")} onClick={() => setActivePageView('chat')}>
              <ArrowLeft size={20} />
            </button>
          </header>
        )}
        
        {/* Top Header for active chat */}
        {activePageView === 'chat' && (hasMessages || activeImport) && (
          <ActiveChatHeader
            isSidebarOpen={isSidebarOpen}
            onToggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)}
          />
        )}

        {/* Content Area */}
        <div className="flex-1 flex min-h-0 relative overflow-hidden">
          
          {/* Projects View */}
          {activePageView === 'routines' && <Routines/>}
          {activePageView === 'projects' && <ProjectsView />}

          {/* Artifacts View */}
          {activePageView === 'artifacts' && <ArtifactsView />}

          {/* Chat View */}
          {activePageView === 'chat' && (
            <div className="flex-1 flex flex-col min-w-0 h-full relative overflow-hidden">
              {activeImport ? <SessionImport progress/> : !hasMessages ? (
                /* Landing / Empty Chat State or Artifact Starter Picker */
                activeConversation?.isArtifactPicker ? (
                  <div className="flex-1 overflow-y-auto flex flex-col justify-start">
                    <ArtifactCategoryPicker />
                  </div>
                ) : (
                  <LandingView
                    isSidebarOpen={isSidebarOpen}
                    onToggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)}
                  />
                )
              ) : (
                /* Active Conversation */
                <>
                  <div
                    ref={chatScrollContainerRef}
                    onScroll={handleScroll}
                    onWheel={event => { if (event.deltaY < 0) followsBottom.current = false; }}
                    onTouchStart={event => { touchY.current = event.touches[0]?.clientY ?? null; }}
                    onTouchMove={event => {
                      const y = event.touches[0]?.clientY;
                      if (y != null && touchY.current != null && y > touchY.current) followsBottom.current = false;
                      touchY.current = y ?? null;
                    }}
                    className="flex-1 min-w-0 min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain pt-4 pb-6 px-2 sm:px-4"
                  >
                    {/* If artifact starter chat, show the category cards at the top */}
                    {activeConversation?.isArtifactPicker && (
                      <ArtifactCategoryPicker
                        compact={true}
                        selectedCategory={activeConversation.artifactCategory || activeConversation.title}
                      />
                    )}

                    {activeConversation?.messages.map((message, index) => (
                      <ChatMessage
                        key={message.id}
                        message={message}
                        isLast={index === (activeConversation.messages.length - 1)}
                      />
                    ))}
                    <div ref={messagesEndRef} />
                  </div>

                  {/* Scroll to bottom floating button */}
                  {showScrollBottom && (
                    <button
                      onClick={scrollToBottom}
                      className="absolute bottom-28 left-1/2 -translate-x-1/2 p-2 rounded-full bg-[var(--bg-card-hover)] hover:bg-[var(--bg-card-hover)] border border-[var(--border-color)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] shadow-xl z-20 transition-all"
                      title="Scroll to bottom"
                      aria-label="Scroll to bottom"
                    >
                      <ArrowDown className="w-4 h-4" />
                    </button>
                  )}

                  {/* Bottom Sticky Composer */}
                  <div className="shrink-0 bg-[var(--bg-primary)] pb-3 px-2 sm:px-4">
                    <div className="pointer-events-auto">
                      <ChatInput compact />
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Artifacts Split View Pane */}
          {isArtifactPaneOpen && activeArtifact && (
            <ArtifactViewer
              artifact={activeArtifact}
              onClose={() => setIsArtifactPaneOpen(false)}
            />
          )}

        </div>
      </div>

      {/* Global Search Modal (Ctrl+K) */}
      <SearchModal
        isOpen={isSearchModalOpen}
        onClose={() => setIsSearchModalOpen(false)}
      />

      {/* Settings Modal */}
      <CustomizeModal />
    </div>
  );
};

export const App: React.FC = () => {
  const { isAuthenticated } = useAuth();

  if (!isAuthenticated) {
    return <LoginView />;
  }

  return <ClaudeWorkspace />;
};
