import React, { useState, useEffect } from 'react';
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import { backend } from '../services/backend';
import { attachmentImageUrl } from '../services/attachments';
import { AttachmentImage } from './AttachmentImage';
import { downloadArtifact } from '../services/download';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import rehypeHighlight from 'rehype-highlight';
import { ToolCallCard } from './ToolCallCard';
import { PermissionCard } from './PermissionCard';
import {
  Copy,
  Check,
  RotateCcw,
  Undo2,
  Sparkles,
  ChevronDown,
  ChevronRight,
  Code2,
  FileCheck,
  FileText,
  AlertCircle,
  Edit2,
  Terminal,
  Volume2,
  VolumeX,
  ThumbsUp,
  ThumbsDown,
  Download
} from 'lucide-react';
import { Message, Artifact } from '../types';
import { useChat } from '../context/ChatContext';
import { ClaudeStarburst } from './ClaudeIcons';
import { t, uiLocale, englishUiError } from '../i18n';
import { copyTextToClipboard } from '../services/clipboard';

interface ChatMessageProps {
  message: Message;
  isLast?: boolean;
}

const THINKING_WORDS = [
  t('Thinking'),
  'Sleuthing',
  'Cooking',
  'Pondering',
  'Synthesizing',
  'Crafting',
  'Brewing',
  'Calculating',
  'Refining'
];

/**
 * Step-by-step execution timeline tree (matching Image 1 & 2)
 * Rendered dynamically for actual generated artifacts
 */
interface ExecutionTreeProps {
  artifacts: Artifact[];
}

export const ExecutionStepsTree: React.FC<ExecutionTreeProps> = ({ artifacts }) => {
  const [isOpen, setIsOpen] = useState(false);

  if (!artifacts || artifacts.length === 0) return null;

  const firstArtifact = artifacts[0];
  const fileTypeLabel = firstArtifact.type.includes('html')
    ? 'HTML'
    : firstArtifact.type.includes('react')
    ? 'React'
    : firstArtifact.language?.toUpperCase() || 'source';

  return (
    <div className="mb-3 text-xs select-none">
      {/* Expandable Header */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors py-0.5 font-sans group"
        aria-expanded={isOpen}
      >
        <span className="text-[var(--text-secondary)] group-hover:text-[var(--text-primary)]">{t('Ran a command, created a file, read a file')}</span>
        {isOpen ? (
          <ChevronDown className="w-3.5 h-3.5 text-[var(--text-secondary)]" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 text-[var(--text-secondary)]" />
        )}
      </button>

      {/* Vertical Steps Tree */}
      {isOpen && (
        <div className="mt-3 ml-0.5 space-y-0 text-xs animate-in fade-in duration-150">
          {/* Step 1: Command */}
          <div className="flex items-center gap-3">
            <div className="w-5 h-5 rounded-md bg-[var(--bg-card-hover)] border border-[var(--border-color)] flex items-center justify-center text-[var(--text-secondary)] shrink-0">
              <Terminal className="w-3 h-3" />
            </div>
            <span className="text-[var(--text-secondary)] font-sans text-xs">{t('Ensure workspace output directory exists')}</span>
          </div>

          {/* Connector Line 1 */}
          <div className="w-5 flex justify-center py-0.5">
            <div className="w-[1px] h-3.5 bg-[var(--bg-card-hover)]" />
          </div>

          {/* Step 2: Real Generated Artifact File */}
          <div className="flex items-center gap-3">
            <div className="w-5 h-5 rounded-md bg-[var(--bg-card-hover)] border border-[var(--border-color)] flex items-center justify-center text-[#DA7756] shrink-0">
              <Code2 className="w-3 h-3" />
            </div>
            <span className="text-[var(--text-primary)] font-medium font-sans text-xs">
              {firstArtifact.title} as a self-contained {fileTypeLabel} file
            </span>
          </div>

          {/* Connector Line 2 */}
          <div className="w-5 flex justify-center py-0.5">
            <div className="w-[1px] h-3.5 bg-[var(--bg-card-hover)]" />
          </div>

          {/* Step 3: Presentation */}
          <div className="flex items-center gap-3">
            <div className="w-5 h-5 rounded-md bg-[var(--bg-card-hover)] border border-[var(--border-color)] flex items-center justify-center text-[var(--text-secondary)] shrink-0">
              <FileCheck className="w-3 h-3" />
            </div>
            <span className="text-[var(--text-secondary)] font-sans text-xs">{t('Presented file')}</span>
          </div>
        </div>
      )}
    </div>
  );
};

interface ClaudeThinkingStatusProps {
  customStatus?: string;
}

export const ClaudeThinkingStatus: React.FC<ClaudeThinkingStatusProps> = ({ customStatus }) => {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setIndex((prev) => (prev + 1) % THINKING_WORDS.length);
    }, 1800);
    return () => clearInterval(interval);
  }, []);

  const displayStatus = customStatus ? (customStatus.endsWith('...') ? customStatus : `${customStatus}...`) : `${THINKING_WORDS[index]}...`;

  return (
    <div className="flex items-center gap-2.5 py-2 text-xs text-[var(--text-secondary)] select-none animate-in fade-in duration-300">
      <div className="animate-[spin_4s_linear_infinite] origin-center shrink-0">
        <ClaudeStarburst size={18} color="#DA7756" />
      </div>
      <span className="font-serif italic text-sm text-[var(--text-primary)]">
        {displayStatus}
      </span>
    </div>
  );
};

function localFilePath(href = ''): string | null {
  if (!href || /^(?:[a-z][\w+.-]*:|\/\/|#)/i.test(href) && !/^(?:file:\/\/\/|sandbox:\/)/i.test(href)) return null;
  return /^(?:\/|~\/|\.{1,2}\/|file:\/\/\/|sandbox:\/)|\.[\w-]+(?::\d+)?$/i.test(href)
    ? href.replace(/(?::\d+(?:-\d+)?)$/, '') : null;
}

export const ChatMessage: React.FC<ChatMessageProps> = ({ message, isLast = false }) => {
  const {
    setActiveArtifact,
    setIsArtifactPaneOpen,
    activeArtifact,
    activeProject,
    catalog,
    regenerateResponse,
    editUserMessage,
    retractUserMessage,
    retryLastRequest,
    isStreaming
  } = useChat();

  const [isCopied, setIsCopied] = useState(false);
  const [actionError, setActionError] = useState('');
  const [retracting, setRetracting] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [feedback, setFeedback] = useState<'like' | 'dislike' | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editedContent, setEditedContent] = useState(message.content);
  useEffect(() => {
    if (!isCopied) return;
    const timer = setTimeout(() => setIsCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [isCopied]);

  const isUser = message.role === 'user';
  const hasArtifacts = Boolean(message.artifacts && message.artifacts.length > 0);

  // Claude Code transcript rows render as their own card types, not bubbles.
  if (message.role === 'tool' && message.toolUse) {
    return <ToolCallCard message={message} />;
  }
  if (message.permission) {
    return <PermissionCard message={message} />;
  }
  // Finished thinking/empty stream records have no visible body or toolbar.
  if (!isUser && !message.content.trim() && !hasArtifacts && !message.error && !message.isStreaming) return null;

  const handleCopy = async (text: string, answer = false) => {
    setActionError('');
    const copied = await copyTextToClipboard(text);
    if (!copied) setActionError(t("Copy failed. Press and hold the text to select and copy it."));
    if (answer) {
      setIsCopied(copied);
    }
  };

  const handleSpeak = () => {
    if ('speechSynthesis' in window) {
      if (window.speechSynthesis.speaking) {
        window.speechSynthesis.cancel();
        setIsSpeaking(false);
      } else {
        const cleanText = message.content.replace(/<[^>]*>/g, '').replace(/```[\s\S]*?```/g, '');
        const utterance = new SpeechSynthesisUtterance(cleanText);
        utterance.onend = () => setIsSpeaking(false);
        utterance.onerror = () => setIsSpeaking(false);
        setIsSpeaking(true);
        window.speechSynthesis.speak(utterance);
      }
    }
  };

  const handleDownloadArtifact = async (art: Artifact, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setActionError('');
    try { await downloadArtifact(art); }
    catch (error) { setActionError(error instanceof Error ? error.message : t("Download failed")); }
  };

  const handleSaveEdit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editedContent.trim()) {
      editUserMessage(message.id, editedContent.trim());
    }
    setIsEditing(false);
  };

  const handleOpenArtifact = (art: Artifact) => {
    setActiveArtifact(art);
    setIsArtifactPaneOpen(true);
  };

  const fileCwd = activeProject?.path || catalog?.cwd || '';
  const downloadUrl = (path: string) => `/api/files/download?${new URLSearchParams({path, cwd:fileCwd})}`;
  const openFile = async (path: string) => {
    setActionError('');
    try {
      const file = await backend.filePreview(path, fileCwd);
      const language = file.filename.split('.').pop()?.toLowerCase();
      handleOpenArtifact({id:`file-${file.path}`,identifier:file.filename,title:file.filename,sourcePath:file.path,content:file.text ?? '',language,createdAt:Date.now(),
        type:file.kind === 'html' ? 'text/html' : file.kind === 'markdown' ? 'text/markdown' : language === 'svg' ? 'image/svg+xml' : 'application/vnd.ant.code'});
    } catch (error) { setActionError(error instanceof Error ? error.message : t("Could not read file")); }
  };

  const formatTimeAgo = (timestamp: number) => {
    const diff = Math.floor((Date.now() - timestamp) / 1000);
    if (diff < 60) return t('Just now');
    if (diff < 3600) return `${Math.floor(diff / 60)} minutes ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)} hours ago`;
    return new Date(timestamp).toLocaleDateString(uiLocale());
  };

  return (
    <div className={`py-4 px-3 sm:px-6 w-full min-w-0 max-w-3xl mx-auto group ${isUser ? 'flex justify-end' : 'flex justify-start'}`}>
      
      {/* 1. USER MESSAGE */}
      {isUser ? (
        <div className="flex flex-col items-end min-w-0 max-w-[85%] space-y-2 [overflow-wrap:anywhere]">
          {/* Attachments */}
          {message.attachments && message.attachments.length > 0 && (
            <div className="flex flex-wrap gap-2 justify-end mb-1">
              {message.attachments.map((att) => attachmentImageUrl(att) ? <AttachmentImage key={att.id} attachment={att}/> : (
                <div
                  key={att.id}
                  className="flex items-center gap-2 p-1.5 bg-[var(--bg-card-hover)] border border-[var(--border-color)] rounded-xl text-xs text-[var(--text-primary)]"
                >
                  <FileText className="w-5 h-5 text-[#DA7756]" />
                  <span className="truncate max-w-[140px] text-xs font-mono">{att.name}</span>
                </div>
              ))}
            </div>
          )}

          {isEditing ? (
            <form onSubmit={handleSaveEdit} className="w-full min-w-0 bg-[var(--bg-card-hover)] p-3 rounded-2xl border border-[#DA7756] space-y-2">
              <textarea
                value={editedContent}
                onChange={(e) => setEditedContent(e.target.value)}
                rows={3}
                className="w-full bg-transparent text-xs text-[var(--text-primary)] focus:outline-none resize-none font-sans leading-relaxed"
                autoFocus
              />
              <div className="flex justify-end gap-2 text-xs">
                <button
                  type="button"
                  onClick={() => setIsEditing(false)}
                  className="px-3 py-1 rounded-lg text-[var(--text-secondary)] hover:bg-[var(--bg-card-hover)]"
                >{t('Cancel')}</button>
                <button
                  type="submit"
                  className="px-3.5 py-1 rounded-lg bg-[#DA7756] hover:bg-[#C86545] text-white font-medium shadow"
                >{t('Save & Submit')}</button>
              </div>
            </form>
          ) : (
            <div className="relative group/msg">
              {message.content && <div className="bg-[var(--bg-card-hover)] text-[var(--text-primary)] px-4 py-2.5 rounded-2xl rounded-tr-md text-[13px] leading-[21px] whitespace-pre-wrap selection:bg-[#DA7756]/40 border border-[var(--border-color)]/60 shadow-xs">
                {message.content}
              </div>}

              {/* Touch devices cannot rely on hover to expose actions. */}
              {!isStreaming && (
                <div className="flex justify-end gap-2 mt-1 opacity-0 group-hover/msg:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100">
                <button
                  onClick={() => {
                    setEditedContent(message.content);
                    setIsEditing(true);
                  }}
                  className="p-1.5 rounded-lg hover:bg-[var(--bg-card-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                  disabled={retracting}
                  title="Edit message"
                >
                  <Edit2 className="w-3.5 h-3.5" />
                </button>
                <button type="button" aria-label={t("Recall message")} title={t("Move back to composer")} disabled={retracting} className="p-1.5 rounded-lg hover:bg-[var(--bg-card-hover)] text-[var(--text-secondary)] disabled:opacity-40" onClick={async()=>{
                  setRetracting(true);setActionError('');
                  try { await retractUserMessage(message.id); }
                  catch(error) { setActionError(error instanceof Error ? error.message : t("Recall failed. Please try again.")); }
                  finally { setRetracting(false); }
                }}><Undo2 className="w-3.5 h-3.5"/></button>
                </div>
              )}
            </div>
          )}
          {actionError && <p role="alert" className="text-xs text-red-500">{actionError}</p>}
        </div>
      ) : (
        /* 2. ASSISTANT MESSAGE */
        <div className="w-full space-y-3 min-w-0">
          
          {/* Step-by-Step Execution Tree (for generated artifacts) */}
          {hasArtifacts && message.artifacts && (
            <ExecutionStepsTree artifacts={message.artifacts} />
          )}

          {/* Error Banner */}
          {message.error && (
            <div className="p-3 rounded-xl bg-red-950/30 border border-red-800/50 text-red-300 text-xs flex items-center justify-between">
              <div className="flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
                <span>{t(englishUiError(message.error))}</span>
              </div>
              <button
                onClick={retryLastRequest}
                className="px-2.5 py-1 rounded-lg bg-red-900/50 hover:bg-red-800/60 text-white font-medium text-[11px] transition-colors"
              >{t('Retry')}</button>
            </div>
          )}

          {/* Main Conversational Markdown Text (matching Image 2 font style) */}
          {message.content && (
            <div className="claude-prose text-[var(--text-primary)] font-serif">
              <ReactMarkdown
                urlTransform={(url, key) => key === 'href' && localFilePath(url) ? url : defaultUrlTransform(url)}
                remarkPlugins={[remarkGfm, remarkMath]}
                rehypePlugins={[[rehypeKatex, { throwOnError: false, strict: false }], rehypeHighlight]}
                components={{
                  a({href, children}) {
                    const path = localFilePath(href);
                    return <a href={path ? downloadUrl(path) : href} target={path ? undefined : '_blank'} rel="noopener noreferrer"
                      onClick={path ? event => { if (!event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) { event.preventDefault(); void openFile(path); } } : undefined}>{children}</a>;
                  },
                  pre({ node, children }) {
                    const code = node?.children.find(child => child.type === 'element' && child.tagName === 'code');
                    const classes = code?.type === 'element' ? code.properties.className : [];
                    const language = Array.isArray(classes) ? String(classes.find(value => String(value).startsWith('language-')) || '').replace('language-', '') : '';
                    return <div className="claude-code-block">
                      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-[var(--border-color)] text-xs text-[var(--text-secondary)] font-sans">
                        <span className="truncate">{language || 'text'}</span>
                        <button className="flex items-center gap-1 shrink-0 hover:text-[var(--text-primary)]" aria-label={t("Copy code")} onClick={event => void handleCopy(event.currentTarget.closest('.claude-code-block')?.querySelector('code')?.textContent || '')}><Copy size={13}/>{t('Copy')}</button>
                      </div>
                      <pre>{children}</pre>
                    </div>;
                  },
                  table({ children }) {
                    return <div className="max-w-full overflow-x-auto"><table>{children}</table></div>;
                  },
                }}
              >
                {message.content}
              </ReactMarkdown>
            </div>
          )}

          {/* Active Thinking / Crafting Status during streaming */}
          {message.isStreaming && (
            <ClaudeThinkingStatus customStatus={message.thinkingStatus} />
          )}

          {/* Claude Artifact Card (matching Image 2) */}
          {message.artifacts && message.artifacts.length > 0 && (
            <div className="space-y-2 pt-1">
              {message.artifacts.map((art) => (
                <div
                  key={art.id}
                  onClick={() => handleOpenArtifact(art)}
                  className="w-full rounded-2xl border border-[var(--border-color)] bg-[var(--bg-primary)] hover:bg-[var(--bg-card-hover)] hover:border-[var(--border-color)] transition-all p-3.5 flex items-center justify-between cursor-pointer group shadow-sm"
                >
                  <div className="flex items-center gap-3.5 min-w-0">
                    {/* Left Thumbnail icon box */}
                    <div className="w-11 h-11 rounded-xl bg-[var(--bg-card-hover)] border border-[var(--border-color)] flex items-center justify-center text-[#DA7756] shrink-0 group-hover:scale-105 transition-transform">
                      <Code2 className="w-5 h-5" />
                    </div>
                    {/* Title & Subtitle */}
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-[var(--text-primary)] group-hover:text-[#DA7756] transition-colors truncate">
                        {art.title || 'Code Artifact'}
                      </div>
                      <div className="text-xs text-[var(--text-secondary)] font-sans mt-0.5">
                        Code · {art.type.includes('html') ? 'HTML' : art.type.includes('react') ? 'React' : art.language?.toUpperCase() || 'Script'}
                      </div>
                    </div>
                  </div>

                  {/* Right Download Action Button */}
                  <button
                    onClick={(e) => handleDownloadArtifact(art, e)}
                    className="px-4 py-2 rounded-xl bg-[var(--bg-card-hover)] hover:bg-[var(--bg-card-hover)] text-xs font-medium text-[var(--text-primary)] border border-[var(--border-color)] transition-colors shrink-0 shadow-sm flex items-center gap-1.5"
                  >
                    <Download className="w-3.5 h-3.5 text-[var(--text-secondary)]" />
                    <span>{t('Download')}</span>
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Action Toolbar (matching Image 2 bottom toolbar) */}
          {!message.isStreaming && (message.content || hasArtifacts) && (
            <div className="flex items-center gap-3 pt-2 text-[var(--text-secondary)] text-xs select-none">
              {/* Copy */}
              <button
                onClick={() => void handleCopy(message.content, true)}
                className="p-1 rounded-lg hover:text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)] transition-colors"
                title={t('Copy message')}
                aria-label={t("Copy response")}
              >
                {isCopied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              </button>

              {/* Read Aloud */}
              <button
                onClick={handleSpeak}
                className={`p-1 rounded-lg transition-colors ${
                  isSpeaking ? 'text-[#DA7756] bg-[#DA7756]/10' : 'hover:text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)]'
                }`}
                title={isSpeaking ? 'Stop reading' : 'Read aloud'}
              >
                {isSpeaking ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
              </button>

              {/* Thumbs Up */}
              <button
                onClick={() => setFeedback(feedback === 'like' ? null : 'like')}
                className={`p-1 rounded-lg transition-colors ${
                  feedback === 'like' ? 'text-emerald-400 bg-emerald-950/30' : 'hover:text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)]'
                }`}
                title="Good response"
              >
                <ThumbsUp className="w-3.5 h-3.5" />
              </button>

              {/* Thumbs Down */}
              <button
                onClick={() => setFeedback(feedback === 'dislike' ? null : 'dislike')}
                className={`p-1 rounded-lg transition-colors ${
                  feedback === 'dislike' ? 'text-red-400 bg-red-950/30' : 'hover:text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)]'
                }`}
                title="Poor response"
              >
                <ThumbsDown className="w-3.5 h-3.5" />
              </button>

              {/* Regenerate */}
              {isLast && (
                <button
                  onClick={() => regenerateResponse(message.id)}
                  className="p-1 rounded-lg hover:text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)] transition-colors"
                  title="Retry response"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                </button>
              )}

              {/* Timestamp */}
              <span className="text-[11px] text-[#555] font-sans ml-1">
                {formatTimeAgo(message.createdAt)}
              </span>
            </div>
          )}

          {actionError && <p role="alert" className="text-xs text-red-500">{actionError}</p>}

        </div>
      )}

    </div>
  );
};
