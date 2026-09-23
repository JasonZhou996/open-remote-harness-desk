import {t} from '../i18n';
import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { Conversation, Message, Artifact, Attachment, Project, ActivePageView } from '../types';
import { useSettings } from './SettingsContext';
import { backend, BackendFrame, NativeCatalog } from '../services/backend';
import { extractArtifactsAndThinking } from '../services/artifactParser';
import {subscribeImports, type ImportJob} from '../../../shared/session-import';

interface ChatContextType {
  activeImport: ImportJob | null;
  openImport: (job:ImportJob) => void;
  conversations: Conversation[];
  activeConversationId: string | null;
  newConversationKey: string;
  setActiveConversationId: (id: string | null) => void;
  activeConversation: Conversation | null;
  isStreaming: boolean;
  selectedModel: string;
  setSelectedModel: (model: string) => void;
  activeMode: 'chat' | 'cowork';
  setActiveMode: (mode: 'chat' | 'cowork') => void;
  activeArtifact: Artifact | null;
  setActiveArtifact: (artifact: Artifact | null) => void;
  isArtifactPaneOpen: boolean;
  setIsArtifactPaneOpen: (open: boolean) => void;
  activeProject: Project | null;
  setActiveProject: (project: Project | null) => void;
  projects: Project[];
  setProjects: React.Dispatch<React.SetStateAction<Project[]>>;
  runningSessionIds: Set<string>;
  allArtifacts: Artifact[];
  activePageView: ActivePageView;
  setActivePageView: (view: ActivePageView) => void;

  catalog: NativeCatalog | null;
  catalogError: string;
  permissionMode: string;
  setPermissionMode: (mode: string) => Promise<void>;
  permissionPending: boolean;
  permissionError: string;
  refreshSidebar: () => Promise<void>;
  // Actions
  createNewConversation: (projectId?: string) => string;
  selectConversation: (id: string) => void;
  sendMessage: (content: string, attachments?: Attachment[], interrupt?: boolean) => Promise<void>;
  regenerateResponse: (assistantMessageId?: string) => Promise<void>;
  editUserMessage: (userMessageId: string, newContent: string) => Promise<void>;
  retractUserMessage: (userMessageId: string) => Promise<void>;
  recalledDraft: {sessionId:string; text:string; attachments:Attachment[]} | null;
  clearRecalledDraft: () => void;
  retryLastRequest: () => Promise<void>;
  stopGeneration: () => Promise<void>;
  deleteConversation: (id: string) => Promise<void>;
  renameConversation: (id: string, newTitle: string) => Promise<void>;
  toggleStarConversation: (id: string) => void;
  moveConversationToProject: (convId: string, targetProjectId?: string) => void;
  startNewArtifactChat: () => string;
  selectArtifactCategory: (categoryTitle: string) => Promise<void>;
  clearAllConversations: () => void;
  saveArtifact: (artifact: Artifact) => void;
  deleteArtifact: (id: string) => void;
  createNewArtifact: (title: string, type: Artifact['type'], content: string) => Artifact;
}

const ChatContext = createContext<ChatContextType | undefined>(undefined);

const VIEW_KEY = 'claude-workspace-view';

/**
 * Scratch-workspace sessions (and bare-home ones) are ordinary chats, not
 * project work — they belong in "Chats and tasks", not as sidebar projects.
 */
function isOrdinaryChatPath(path: string | undefined | null): boolean {
  if (!path) return true;
  return (
    path.includes('scratch-workspaces') ||
    /^\/(?:home|Users)\/[^/]+\/?$/.test(path) || path === '/root' ||
    path.startsWith('/tmp/')
  );
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const ChatProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { settings, updateSettings } = useSettings();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [importJobs,setImportJobs]=useState<ImportJob[]>([]);
  const completedImports=useRef(new Set<string>());
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [newConversationKey, setNewConversationKey] = useState<string>(() => {
    try { return JSON.parse(localStorage.getItem(VIEW_KEY) || sessionStorage.getItem(VIEW_KEY) || 'null')?.draftKey || ''; } catch { return ''; }
  });
  const [selectedModel, setSelectedModel] = useState<string>('default');
  const [activeMode, setActiveMode] = useState<'chat' | 'cowork'>('chat');
  const [isStreaming, setIsStreaming] = useState(false);
  const [recalledDraft, setRecalledDraft] = useState<ChatContextType['recalledDraft']>(null);
  const retracting = useRef(false);
  const conversationsRef = useRef(conversations);
  conversationsRef.current = conversations;
  const [activeArtifact, setActiveArtifact] = useState<Artifact | null>(null);
  const [isArtifactPaneOpen, setIsArtifactPaneOpen] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProject, setActiveProject] = useState<Project | null>(null);
  const [allArtifacts, setAllArtifacts] = useState<Artifact[]>([]);
  const [activePageView, setActivePageView] = useState<ActivePageView>('chat');
  const [runningSessionIds, setRunningSessionIds] = useState<Set<string>>(new Set());
  const [sidebarReady, setSidebarReady] = useState(false);
  const [viewRestored, setViewRestored] = useState(false);

  const [catalog, setCatalog] = useState<NativeCatalog | null>(null);
  const [catalogError, setCatalogError] = useState('');
  const [permissionMode, setPermissionModeState] = useState('acceptEdits');
  const [permissionPending, setPermissionPending] = useState(false);
  const [permissionError, setPermissionError] = useState('');
  const permissionRevision = useRef(0);
  const permissionChanging = useRef(false);
  useEffect(() => {
    let alive = true; setCatalog(null); setCatalogError('');
    backend.workspace(activeProject?.id).then(data => { if(alive) setCatalog(data); })
      .catch(error => { if(alive) setCatalogError(error.message); });
    return () => { alive = false; };
  }, [activeProject?.id]);

  // Which sessions currently have a run in progress (this backend only).
  useEffect(() => {
    let alive = true;
    const load = () =>
      backend.runningSessions()
        .then((r) => { if (alive) setRunningSessionIds(new Set((r.sessions ?? []).map((x) => x.sessionId))); })
        .catch(() => {});
    load();
    const timer = setInterval(load, 8000);
    return () => { alive = false; clearInterval(timer); };
  }, []);

  /** projectId → on-disk path, kept alongside the trimmed Project rows. */
  const projectPaths = useRef(new Map<string, string>());
  /** sessionId → true once its history has been fetched. */
  const loadedSessions = useRef(new Set<string>());
  const loadFailures = useRef(new Map<string, string>());

  const activeConversation = conversations.find((c) => c.id === activeConversationId) || null;
  const activeIdRef = useRef<string | null>(null);
  activeIdRef.current = activeConversationId;

  useEffect(() => {
    const revision = ++permissionRevision.current;
    setPermissionError('');
    if (!activeConversationId || activeConversationId.startsWith('import-')) { setPermissionPending(false); return; }
    setPermissionPending(true);
    backend.sessionPermissionMode(activeConversationId).then(result => {
      if (revision === permissionRevision.current) setPermissionModeState(result.mode);
    }).catch(error => {
      if (revision === permissionRevision.current) setPermissionError(error.message);
    }).finally(() => {
      if (revision === permissionRevision.current) setPermissionPending(false);
    });
    return () => { permissionRevision.current++; };
  }, [activeConversationId]);

  const setPermissionMode = async (mode: string) => {
    if (permissionChanging.current) return;
    const sid = activeIdRef.current;
    const revision = ++permissionRevision.current;
    permissionChanging.current = true;
    setPermissionPending(true); setPermissionError('');
    try {
      const result = sid ? await backend.setPermissionMode(sid, mode) : {mode};
      if (sid === activeIdRef.current) setPermissionModeState(result.mode);
    } catch (error: any) {
      if (sid === activeIdRef.current) setPermissionError(error.message);
    } finally {
      permissionChanging.current = false;
      if (revision === permissionRevision.current) setPermissionPending(false);
    }
  };

  // ------------------------------------------------------------- list load

  const refreshSidebar = useCallback(async () => {
    const knownIds = new Set(conversationsRef.current.map(c => c.id));
    try {
      const [projectsRes, sessionsRes] = await Promise.all([
        backend.projects(),
        backend.recentSessions(100)
      ]);
      // /api/projects returns a bare array; other routes wrap in {data}.
      const rows = Array.isArray(projectsRes) ? projectsRes : (projectsRes.projects ?? []);
      projectPaths.current = new Map(rows.map((p: any) => [p.projectId ?? p.id, p.fullPath ?? p.path]));
      setProjects(
        rows
          .filter((p: any) => !isOrdinaryChatPath(p.fullPath ?? p.path))
          .map((p: any) => ({
            id: p.projectId ?? p.id,
            name: p.displayName ?? p.customProjectName ?? p.name ?? ((p.fullPath ?? p.path ?? '').split('/').pop() || '(project)'),
            path: p.fullPath ?? p.path,
            description: p.fullPath ?? p.path,
            createdAt: 0,
            updatedAt: 0
          }))
      );
      setConversations((prev) => {
        const byId = new Map(prev.map((c) => [c.id, c]));
        const mapped: Conversation[] = (sessionsRes.conversations ?? []).map((s: any) => {
          const existing = byId.get(s.sessionId);
          return {
            id: s.sessionId,
            title: s.sessionTitle || '(untitled)',
            messages: existing?.messages ?? [],
            createdAt: 0,
            updatedAt: s.lastActivity ? Date.parse(s.lastActivity) || 0 : 0,
            model: existing?.model ?? 'default',
            projectId: isOrdinaryChatPath(projectPaths.current.get(s.projectId)) ? undefined : (s.projectId ?? undefined),
            isStarred: existing?.isStarred
          };
        });
        // Sessions created locally this second that the list query hasn't
        // picked up yet must survive the refresh.
        const ids = new Set(mapped.map((c) => c.id));
        prev.forEach((c) => {
          if (!ids.has(c.id) && c.messages.length > 0 && (!knownIds.has(c.id) || sessionsRes.hasMore)) mapped.unshift(c);
        });
        return mapped;
      });
      backend.subscribeSessions((sessionsRes.conversations ?? []).map((s: any) => s.sessionId));
      setSidebarReady(true);
    } catch (e) {
      console.error('[sidebar] refresh failed', e);
    }
  }, []);

  useEffect(() => {
    // Platform mode: no token needed, always connect and load.
    backend.connect();
    refreshSidebar();
  }, [refreshSidebar]);

  // ------------------------------------------------------ frame application

  const removeConversation = useCallback((id: string, providerId?: string) => {
    const ids = new Set([id, providerId]);
    ids.forEach(sid => { if (sid) loadedSessions.current.delete(sid); });
    setConversations(prev => prev.filter(c => !ids.has(c.id)));
    if (activeIdRef.current && ids.has(activeIdRef.current)) {
      setActiveConversationId(null);
      setIsStreaming(false);
      setActiveArtifact(null);
      setIsArtifactPaneOpen(false);
    }
  }, []);

  const updateMessages = useCallback(
    (sessionId: string, updater: (messages: Message[]) => Message[]) => {
      setConversations((prev) =>
        prev.map((c) => (c.id === sessionId ? { ...c, messages: updater(c.messages), updatedAt: Date.now() } : c))
      );
    },
    []
  );

  /** Live events may arrive for a session the sidebar list hasn't shown yet. */
  const ensureConversation = useCallback((sessionId: string) => {
    setConversations((prev) => {
      if (prev.some((c) => c.id === sessionId)) return prev;
      const fresh: Conversation = {
        id: sessionId,
        title: '(new session)',
        messages: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        model: 'default'
      };
      return [fresh, ...prev];
    });
    backend.subscribeSessions([sessionId]);
  }, []);

  const applyFrame = useCallback(
    (frame: BackendFrame) => {
      const kind = frame.kind as string;

      if (kind === 'session_removed') {
        removeConversation(frame.sessionId, frame.providerSessionId);
        return;
      }

      if (kind === 'session_upserted') {
        const sid = frame.sessionId as string;
        const providerSid = (frame.providerSessionId ?? null) as string | null;
        const summary = frame.session?.summary || frame.session?.id || '(session)';
        const projectId = frame.project?.projectId as string | undefined;
        const ts = frame.session?.lastActivity ? Date.parse(frame.session.lastActivity) || Date.now() : Date.now();
        setConversations((prev) => {
          // Keep one row when both the app and native ids reached the sidebar.
          const existing = prev.find(c => c.id === sid) ?? prev.find(c => c.id === providerSid);
          const rows = prev.filter(c => c.id !== providerSid || c.id === sid);
          const idx = rows.findIndex((c) => c.id === sid);
          const row: Conversation = {
            id: sid,
            title: summary,
            messages: existing?.messages ?? [],
            createdAt: existing?.createdAt ?? ts,
            updatedAt: ts,
            model: existing?.model ?? 'default',
            projectId: isOrdinaryChatPath(frame.project?.fullPath) ? undefined : (projectId ?? existing?.projectId),
            isStarred: existing?.isStarred
          };
          if (idx >= 0) {
            const next = [...rows];
            next[idx] = row;
            return next;
          }
          return [row, ...rows];
        });
        if (providerSid && providerSid !== sid && activeIdRef.current === providerSid) {
          setActiveConversationId(sid);
          backend.subscribeSessions([sid]);
        }
        return;
      }

      const sid = frame.sessionId as string | undefined;
      if (!sid) return;
      // Only touch conversations we know about — the sidebar list drives what
      // the user can see, and unknown sessions get created by ensure paths.
      setConversations((prev) => {
        if (!prev.some((c) => c.id === sid)) return prev;
        return prev;
      });

      if(kind==='chat_subscribed' && typeof frame.isProcessing==='boolean'){
        if(sid===activeIdRef.current)setIsStreaming(frame.isProcessing);
        setRunningSessionIds(prev=>{const next=new Set(prev);if(frame.isProcessing)next.add(sid);else next.delete(sid);return next;});
      }
      if(['stream_delta','thinking','tool_use','permission_request'].includes(kind)) {
        if(sid===activeIdRef.current)setIsStreaming(true);
        setRunningSessionIds(prev=>{if(prev.has(sid))return prev;return new Set([...prev,sid]);});
      }
      switch (kind) {
        case 'thinking': {
          const chunk = (frame.content ?? frame.text ?? '') as string;
          const streaming = !!frame.isDelta || !frame.streamId;
          updateMessages(sid, (msgs) => {
            const i = findStreamingAssistant(msgs, frame.streamId);
            if (i === -1) return [...msgs, {id: frame.id ?? frame.streamId ?? `thinking-${Date.now()}`, streamId:frame.streamId, role: 'assistant', content: '', thinkingContent: chunk, createdAt: Date.now(), isStreaming: streaming, isThinking: streaming}];
            const next = [...msgs];
            next[i] = { ...next[i], streamId:frame.streamId, thinkingContent: frame.isDelta ? (next[i].thinkingContent ?? '') + chunk : chunk, isStreaming:streaming, isThinking:streaming };
            return next;
          });
          break;
        }
        case 'stream_delta': {
          const chunk = (frame.text ?? frame.content ?? '') as string;
          if (!chunk) break;
          updateMessages(sid, (msgs) => {
            let i = findStreamingAssistant(msgs, frame.streamId);
            let next = msgs;
            if (i === -1) {
              next = [
                ...msgs,
                { id: frame.streamId ?? `live-${Date.now()}`, streamId:frame.streamId, role: 'assistant', content: '', createdAt: Date.now(), isStreaming: true, isThinking: false }
              ];
              i = next.length - 1;
            }
            next = [...next];
            next[i] = { ...next[i], streamId:frame.streamId, content: next[i].content + chunk, isStreaming:true, isThinking: false, thinkingStatus: undefined };
            return next;
          });
          break;
        }
        case 'stream_end': {
          updateMessages(sid, msgs => {
            const i = findStreamingAssistant(msgs, frame.streamId);
            return i < 0 ? msgs : msgs.map((m, index) => index === i ? {...m, isStreaming:false, isThinking:false, thinkingStatus:undefined} : m);
          });
          break;
        }
        case 'text': {
          const text = (frame.content ?? frame.text ?? '') as string;
          const role = frame.role === 'user' ? 'user' : 'assistant';
          if (role === 'assistant' && text) {
            // A full block confirms its streamed prefix; it must stay after
            // preceding tools and must not duplicate the streamed text.
            updateMessages(sid, (msgs) => {
              const i = findStreamingAssistant(msgs, frame.streamId);
              if (i >= 0 && (frame.streamId || !msgs[i].content || text.startsWith(msgs[i].content))) {
                const next = [...msgs];
                const parsed = extractArtifactsAndThinking(text, next[i].id);
                next[i] = { ...next[i], streamId:frame.streamId, content: parsed.cleanedText, artifacts: parsed.artifacts, thinkingContent: parsed.thinkingContent ?? next[i].thinkingContent, isStreaming: false, isThinking: false, thinkingStatus: undefined, transcriptAnchorId: frame.transcriptAnchorId ?? next[i].transcriptAnchorId };
                return next;
              }
              const id = frame.id ?? `text-${Date.now()}`;
              const parsed = extractArtifactsAndThinking(text, id);
              return [
                ...msgs,
                {
                  id,
                  streamId: frame.streamId,
                  role: 'assistant',
                  content: parsed.cleanedText,
                  artifacts: parsed.artifacts,
                  thinkingContent: parsed.thinkingContent,
                  createdAt: Date.now(),
                  transcriptAnchorId: frame.transcriptAnchorId
                }
              ];
            });
          } else if (role === 'user' && (text || frame.images?.length || frame.files?.length)) {
            // A queued/interrupted user turn replayed from elsewhere.
            updateMessages(sid, (msgs) =>
              msgs.some((m) => m.transcriptAnchorId && m.transcriptAnchorId === frame.transcriptAnchorId)
                ? msgs
                : [
                    ...msgs,
                    { id: frame.id ?? `user-${Date.now()}`, role: 'user', content: text, attachments:attachmentsFromRow(frame), createdAt: Date.now(), transcriptAnchorId: frame.transcriptAnchorId }
                  ]
            );
          }
          break;
        }
        case 'tool_use': {
          updateMessages(sid, (msgs) => [
            ...msgs.filter(m => m.role !== 'assistant' || !(m.isStreaming || m.isThinking) || m.content || m.thinkingContent || m.error)
              .map(m => m.role === 'assistant' && (m.isStreaming || m.isThinking) ? {...m, isStreaming: false, isThinking: false, thinkingStatus: undefined} : m),
            {
              id: frame.id ?? frame.toolId ?? `tool-${Date.now()}`,
              role: 'tool' as const,
              content: '',
              createdAt: Date.now(),
              toolUse: {
                toolId: frame.toolId ?? frame.id ?? '',
                toolName: frame.toolName ?? 'tool',
                input: frame.toolInput
              }
            }
          ]);
          break;
        }
        case 'tool_result': {
          updateMessages(sid, (msgs) => {
            const toolId = (frame.toolId ?? '') as string;
            for (let i = msgs.length - 1; i >= 0; i--) {
              if (msgs[i].toolUse && (msgs[i].toolUse!.toolId === toolId || (toolId && msgs[i].id === frame.id))) {
                const next = [...msgs];
                next[i] = {
                  ...next[i],
                  toolResult: { content: frame.toolResult?.content ?? frame.content, isError: frame.toolResult?.isError ?? frame.isError }
                };
                return next;
              }
            }
            return [
              ...msgs,
              {
                id: frame.id ?? `toolres-${Date.now()}`,
                role: 'tool' as const,
                content: '',
                createdAt: Date.now(),
                toolUse: { toolId, toolName: frame.toolName ?? 'tool', input: undefined },
                toolResult: { content: frame.toolResult?.content ?? frame.content, isError: frame.toolResult?.isError }
              }
            ];
          });
          break;
        }
        case 'permission_request': {
          const requestId = frame.requestId as string;
          updateMessages(sid, (msgs) =>
            msgs.some((m) => m.permission?.requestId === requestId)
              ? msgs
              : [
                  ...msgs,
                  {
                    id: `perm-${requestId}`,
                    role: 'system' as const,
                    content: '',
                    createdAt: Date.now(),
                    permission: { requestId, toolName: frame.toolName ?? 'tool', input: frame.input, state: 'pending' as const }
                  }
                ]
          );
          break;
        }
        case 'permission_resolved':
        case 'permission_cancelled': {
          const requestId = frame.requestId as string;
          const state = kind === 'permission_cancelled' ? 'cancelled' : frame.allow === false ? 'denied' : 'allowed';
          updateMessages(sid, (msgs) =>
            msgs.map((m) =>
              m.permission?.requestId === requestId ? { ...m, permission: { ...m.permission!, state: state as any } } : m
            )
          );
          break;
        }
        case 'status': {
          if (frame.permissionMode) {
            if (sid === activeIdRef.current) setPermissionModeState(frame.permissionMode);
            break;
          }
          const status = (frame.status ?? frame.content ?? '') as string;
          if (!status) break;
          updateMessages(sid, (msgs) => {
            const i = findStreamingAssistant(msgs);
            if (i === -1) return msgs;
            const next = [...msgs];
            next[i] = { ...next[i], thinkingStatus: status, isThinking: true };
            return next;
          });
          break;
        }
        case 'error': {
          const message = (frame.content ?? frame.text ?? frame.error ?? t("Something went wrong")) as string;
          updateMessages(sid, (msgs) => {
            const i = findStreamingAssistant(msgs);
            const next = [...msgs];
            if (i >= 0) {
              next[i] = { ...next[i], error: message, isStreaming: false, isThinking: false, thinkingStatus: undefined };
            } else {
              next.push({ id: `err-${Date.now()}`, role: 'assistant', content: '', error: message, createdAt: Date.now() });
            }
            return next;
          });
          break;
        }
        case 'complete': {
          setRunningSessionIds(prev=>{const next=new Set(prev);next.delete(sid);return next;});
          updateMessages(sid, (msgs) =>
            msgs.map((m) =>
              m.isStreaming || m.isThinking
                ? { ...m, isStreaming: false, isThinking: false, thinkingStatus: undefined }
                : m
            )
          );
          if (sid === activeIdRef.current) setIsStreaming(false);
          break;
        }
        case 'history_truncated': {
          if (frame.retracted) {
            loadedSessions.current.delete(sid);
            if (retracting.current) break;
            const snapshot = conversationsRef.current.find(c => c.id === sid)?.messages;
            backend.sessionMessages(sid).then(res => {
              updateMessages(sid, messages => messages === snapshot ? mapHistory(res.messages ?? []) : messages);
            }).catch(e => console.error('[retract] history refresh failed', e));
          }
          break;
        }
        default:
          break;
      }
    },
    [updateMessages, removeConversation]
  );

  useEffect(() => {
    return backend.onFrame(applyFrame);
  }, [applyFrame]);

  const openImport = (job:ImportJob) => {
    if(job.status==='completed'){selectConversation(job.targetId);return;}
    setImportJobs(prev=>[job,...prev.filter(item=>item.id!==job.id)]);
    setActiveConversationId(job.id);setIsStreaming(false);setActivePageView('chat');
    setActiveProject(projects.find(p=>p.path===job.projectPath)??null);
  };
  useEffect(()=>subscribeImports(jobs=>setImportJobs(jobs.filter(job=>job.target==='claude'))),[]);
  useEffect(()=>{
    for(const job of importJobs.filter(job=>job.status==='completed')){
      if(completedImports.current.has(job.id)){
        if(activeIdRef.current===job.id)selectConversation(job.targetId);
        continue;
      }
      completedImports.current.add(job.id);
      backend.sessionMessages(job.targetId).then(result=>{
        const messages=mapHistory(result.messages??[]);
        loadedSessions.current.add(job.targetId);
        setConversations(prev=>[{id:job.targetId,title:job.title,messages,createdAt:job.createdAt,updatedAt:job.createdAt,model:'default',projectId:projects.find(p=>p.path===job.projectPath)?.id},...prev.filter(c=>c.id!==job.targetId)]);
        if(activeIdRef.current===job.id)setActiveConversationId(job.targetId);
        void refreshSidebar();
      }).catch(error=>{
        completedImports.current.delete(job.id);
        console.error('[import] history load failed',error);
      });
    }
  },[importJobs,projects]);

  // ---------------------------------------------------------------- actions

  const selectConversation = (id: string) => {
    const imported=importJobs.find(job=>job.id===id);
    if(imported){openImport(imported);return;}
    setActiveConversationId(id);
    setIsStreaming(runningSessionIds.has(id));
    setActivePageView('chat');
    const conv = conversations.find((c) => c.id === id);
    setActiveProject(projects.find(p => p.id === conv?.projectId) ?? null);
    backend.sessionActiveModel(id).then(m => {
      if(activeIdRef.current !== id) return;
      if(m.model) setSelectedModel(m.model);
      if(m.effort) updateSettings({thinkingEffort:m.effort as any});
    }).catch(() => {});
    if (!loadedSessions.current.has(id) && !loadFailures.current.has(id)) {
      loadedSessions.current.add(id);

      backend
        .sessionMessages(id)
        .then((res) => {
          const mapped = mapHistory(res.messages ?? []);
          updateMessages(id, () => mapped);
        })
        .catch((e) => {
          loadedSessions.current.delete(id);
          loadFailures.current.set(id, String(e?.message ?? e));
          console.error('[history] load failed', id, e);
        });
    }
  };

  useEffect(() => {
    if (!sidebarReady || viewRestored) return;
    try {
      const saved = JSON.parse(localStorage.getItem(VIEW_KEY) || sessionStorage.getItem(VIEW_KEY) || 'null');
      if (saved) {
        if (conversations.some(c => c.id === saved.sessionId)) selectConversation(saved.sessionId);
        else if (saved.sessionId?.startsWith('import-')) setActiveConversationId(saved.sessionId);
        if (['chat', 'projects', 'routines', 'artifacts'].includes(saved.page)) setActivePageView(saved.page);
        setActiveProject(projects.find(p => p.id === saved.projectId) ?? null);
        if (saved.paneOpen && saved.preview?.id) {
          const preview: Artifact = {...saved.preview, content: ''};
          setActiveArtifact(preview);
          setIsArtifactPaneOpen(true);
          if (preview.sourcePath) {
            const cwd = projects.find(p => p.id === saved.projectId)?.path || catalog?.cwd;
            (cwd ? Promise.resolve(cwd) : backend.workspace().then(data => data.cwd)).then(path => backend.filePreview(preview.sourcePath!, path)).then(file => {
              setActiveArtifact(current => current?.id === preview.id ? {...current, content: file.text ?? ''} : current);
            }).catch(error => {
              setActiveArtifact(current => current?.id === preview.id ? {...current, content: String(error.message)} : current);
            });
          }
        }
      }
    } catch { /* Missing or unavailable browser storage starts on the home page. */ }
    setViewRestored(true);
  }, [sidebarReady, viewRestored, conversations, projects]);

  useEffect(() => {
    if (!viewRestored) return;
    const preview = activeArtifact ? {...activeArtifact, content: undefined} : null;
    try { localStorage.setItem(VIEW_KEY, JSON.stringify({sessionId: activeConversationId, draftKey: newConversationKey, page: activePageView, projectId: activeProject?.id, paneOpen: isArtifactPaneOpen, preview})); } catch { /* private storage */ }
  }, [viewRestored, activeConversationId, newConversationKey, activePageView, activeProject?.id, isArtifactPaneOpen, activeArtifact]);

  useEffect(() => {
    if (!activeArtifact || activeArtifact.sourcePath || activeArtifact.content) return;
    const restored = conversations.find(c => c.id === activeConversationId)?.messages.flatMap(m => m.artifacts ?? []).find(a => a.id === activeArtifact.id);
    if (restored) setActiveArtifact(restored);
  }, [conversations, activeConversationId, activeArtifact]);

  const sendMessage = async (content: string, attachments: Attachment[] = [], interrupt = false) => {
    if (activeConversationId?.startsWith('import-')) throw new Error(t("Please wait for the import to finish"));
    if (permissionPending || permissionChanging.current || permissionError) throw new Error(permissionError || t("Permission confirmation is pending. Please send your message afterward."));
    if (retracting.current) throw new Error(t("A message is being recalled. Please try sending shortly."));
    if (!content.trim() && attachments.length === 0) return;
    let convId = activeConversationId;
    // A Stop acknowledgement must precede the new turn, including its UI placeholder.
    if (interrupt && convId) await backend.abort(convId);
    setActivePageView('chat');

    const userMessage: Message = {
      id: `local-user-${Date.now()}`,
      role: 'user',
      content,
      attachments: attachments.length > 0 ? attachments : undefined,
      createdAt: Date.now()
    };
    const assistantPlaceholder: Message = {
      id: `local-assistant-${Date.now()}`,
      role: 'assistant',
      content: '',
      thinkingContent: '',
      isThinking: true,
      thinkingStatus: 'Thinking',
      createdAt: Date.now(),
      isStreaming: true
    };

    try {
      if (!convId) {
        const projectPath =
          (activeProject && projectPaths.current.get(activeProject.id)) ||
          activeProject?.path ||
          catalog?.cwd || (await backend.workspace()).cwd;
        const created = await backend.createSession(projectPath, content);
        convId = created.sessionId;
        await backend.setPermissionMode(convId, permissionMode);
        loadedSessions.current.add(convId); // history is what we already have
        setConversations((prev) => [
          {
            id: convId!,
            title: content.trim().slice(0, 38) || '(new session)',
            messages: [userMessage, assistantPlaceholder],
            createdAt: Date.now(),
            updatedAt: Date.now(),
            model: selectedModel,
            projectId: activeProject?.id
          },
          ...prev
        ]);
        setActiveConversationId(convId);
        backend.subscribeSessions([convId]);
      } else {
        updateMessages(convId, (msgs) => [...msgs, userMessage, assistantPlaceholder]);
      }
      if (activeIdRef.current === convId || !activeConversationId) setIsStreaming(true);
      const effortRaw = (settings.thinkingEffort || 'medium') as string;
      backend.sendChat(convId!, content.trim(), {
        permissionMode,
        attachments: attachments.map(a => ({path:a.path,name:a.name,mimeType:a.type,size:a.size})),
        model: selectedModel,
        ...(catalog?.models.find(m => m.value === selectedModel || m.resolvedModel === selectedModel)?.supportsEffort ? {effort:effortRaw === 'extra' ? 'xhigh' : effortRaw} : {})
      });
    } catch (e: any) {
      console.error('[send] failed', e);
      if (convId) {
        updateMessages(convId, (msgs) => {
          const next = [...msgs];
          const i = findStreamingAssistant(next);
          if (i >= 0) next[i] = { ...next[i], error: e?.message ?? t("Send failed"), isStreaming: false, isThinking: false };
          return next;
        });
      }
      setIsStreaming(false);
      throw e;
    }
  };

  const stopGeneration = async () => {
    if (activeConversationId) await backend.abort(activeConversationId);
    if (activeIdRef.current === activeConversationId) setIsStreaming(false);
    updateMessages(activeConversationId ?? '', (msgs) =>
      msgs.map((m) => (m.isStreaming || m.isThinking ? { ...m, isStreaming: false, isThinking: false } : m))
    );
  };

  const deleteConversation = async (id: string) => {
    try {
      const result = await backend.deleteSession(id);
      removeConversation(result.sessionId, id);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : t("Delete failed. Please try again."));
    }
  };

  const renameConversation = async (id: string, newTitle: string) => {
    const saved = await backend.renameSession(id, newTitle.trim());
    setConversations((prev) =>
      prev.map((c) => (c.id === id || c.id === saved.sessionId ? { ...c, title: saved.summary } : c))
    );
  };

  const editUserMessage = async (userMessageId: string, newContent: string) => {
    if (permissionPending || permissionChanging.current || permissionError) throw new Error(permissionError || t("Permission confirmation is pending. Please send your message afterward."));
    if (!activeConversation || isStreaming) return;
    const conv = activeConversation;
    const target = conv.messages.find((m) => m.id === userMessageId);
    if (!target) return;
    const anchorId = target.transcriptAnchorId;
    if (!anchorId) {
      console.warn('[edit] no transcript anchor on this message (live-turn message), cannot edit-send');
      return;
    }
    setIsStreaming(true);
    // Optimistic local view; the rewind arrives as fresh live events.
    const userIdx = conv.messages.findIndex((m) => m.id === userMessageId);
    const kept = conv.messages.slice(0, userIdx);
    const updatedUser: Message = { ...target, content: newContent };
    const placeholder: Message = {
      id: `local-assistant-${Date.now()}`,
      role: 'assistant',
      content: '',
      isThinking: true,
      thinkingStatus: 'Thinking',
      createdAt: Date.now(),
      isStreaming: true
    };
    updateMessages(conv.id, () => [...kept, updatedUser, placeholder]);
    try {
      backend.editSend(conv.id, anchorId, newContent.trim(), {permissionMode, model:selectedModel,
        ...(catalog?.models.find(m => m.value === selectedModel || m.resolvedModel === selectedModel)?.supportsEffort ? {effort:settings.thinkingEffort === 'extra' ? 'xhigh' : settings.thinkingEffort} : {})});
    } catch (e: any) {
      setIsStreaming(false);
      updateMessages(conv.id, (msgs) => {
        const next = [...msgs];
        const i = findStreamingAssistant(next);
        if (i >= 0) next[i] = { ...next[i], error: e?.message ?? t("Send failed"), isStreaming: false, isThinking: false };
        return next;
      });
    }
  };

  const retractUserMessage = async (userMessageId: string) => {
    if (!activeConversation || isStreaming || retracting.current) throw new Error(t("Stop the current response before recalling a message."));
    const conv = activeConversation;
    const users = conv.messages.filter(m => m.role === 'user');
    const index = users.findIndex(m => m.id === userMessageId);
    const target = users[index];
    if (!target) throw new Error(t("The message to recall could not be found."));
    retracting.current = true;
    try {
      let anchorId = target.transcriptAnchorId;
      if (!anchorId) {
        // Live optimistic rows have no CLI UUID. Resolve against persisted
        // user order and text, never guess by text alone (repeated prompts).
        const history = mapHistory((await backend.sessionMessages(conv.id)).messages ?? []);
        const saved = history.filter(m => m.role === 'user')[index];
        if (saved?.content !== target.content) throw new Error(t("Conversation history is not synced yet. Please try again shortly."));
        anchorId = saved.transcriptAnchorId;
      }
      if (!anchorId) throw new Error(t("The message is not saved yet. Please try again shortly."));
      // Historical images are embedded in the transcript, not upload paths.
      // Restore usable upload descriptors before committing the withdrawal.
      const attachments = await Promise.all((target.attachments ?? []).map(async attachment => {
        if (attachment.path || !attachment.dataUrl?.startsWith('data:image/')) return attachment;
        const blob = await (await fetch(attachment.dataUrl)).blob();
        const uploaded = (await backend.upload([new File([blob], attachment.name, {type:blob.type})])).attachments[0];
        if (!uploaded) throw new Error(t("Could not restore the image. The message has not been recalled."));
        return {...attachment, path:uploaded.path, type:uploaded.mimeType, size:uploaded.size};
      }));
      const result = await backend.retractMessage(conv.id, anchorId);
      updateMessages(conv.id, () => mapHistory(result.messages ?? []));
      loadedSessions.current.add(conv.id);
      setRecalledDraft({sessionId:conv.id, text:target.content, attachments});
    } finally { retracting.current = false; }
  };

  const regenerateResponse = async (_assistantMessageId?: string) => {
    // The backend protocol only supports replacing a user turn (edit-send);
    // plain "regenerate last answer" has no frame. Rewriting via edit of the
    // last user message with identical content gets the same effect.
    if (!activeConversation || isStreaming) return;
    const lastUser = [...activeConversation.messages].reverse().find((m) => m.role === 'user' && m.transcriptAnchorId);
    if (lastUser) await editUserMessage(lastUser.id, lastUser.content);
  };

  const retryLastRequest = () => regenerateResponse();

  const createNewConversation = (projectId?: string): string => {
    setNewConversationKey(crypto.getRandomValues(new Uint32Array(4)).join('-'));
    setActiveConversationId(null);
    setIsStreaming(false);
    setActiveArtifact(null);
    setIsArtifactPaneOpen(false);
    if (projectId) {
      setActiveProject(projects.find((p) => p.id === projectId) ?? null);
    } else {
      setActiveProject(null);
    }
    setActivePageView('chat');
    return '';
  };

  const toggleStarConversation = (id: string) => {
    setConversations((prev) => prev.map((c) => (c.id === id ? { ...c, isStarred: !c.isStarred } : c)));
  };

  const moveConversationToProject = (convId: string, targetProjectId?: string) => {
    // Session↔project is decided by cwd on disk; local move is cosmetic only.
    setConversations((prev) =>
      prev.map((c) => (c.id === convId ? { ...c, projectId: targetProjectId || undefined, updatedAt: Date.now() } : c))
    );
  };

  const clearAllConversations = () => {
    setConversations([]);
    setActiveConversationId(null);
    setActiveArtifact(null);
    setIsArtifactPaneOpen(false);
    refreshSidebar();
  };

  // ------------------------------------------------- artifacts (local-only)

  const saveArtifact = (artifact: Artifact) => {
    setAllArtifacts((prev) => {
      const filtered = prev.filter((a) => a.id !== artifact.id);
      return [artifact, ...filtered];
    });
  };

  const deleteArtifact = (id: string) => {
    setAllArtifacts((prev) => prev.filter((a) => a.id !== id));
    if (activeArtifact?.id === id) {
      setActiveArtifact(null);
      setIsArtifactPaneOpen(false);
    }
  };

  const createNewArtifact = (title: string, type: Artifact['type'], content: string): Artifact => {
    const newArt: Artifact = {
      id: `art-${Date.now()}`,
      identifier: title.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      type,
      title,
      content,
      createdAt: Date.now()
    };
    saveArtifact(newArt);
    setActiveArtifact(newArt);
    setIsArtifactPaneOpen(true);
    return newArt;
  };

  const startNewArtifactChat = (): string => {
    createNewConversation();
    return '';
  };

  const selectArtifactCategory = async (_categoryTitle: string) => {
    /* demo flow; no backend equivalent */
  };

  return (
    <ChatContext.Provider
      value={{
        catalog, catalogError, permissionMode, setPermissionMode, permissionPending, permissionError, refreshSidebar,
        activeImport: importJobs.find(job=>job.id===activeConversationId) || null,
        openImport,
        conversations: [...importJobs.filter(job=>job.status!=='completed').map(job=>({id:job.id,title:job.title,messages:[],createdAt:job.createdAt,updatedAt:job.createdAt,model:'default',projectId:projects.find(p=>p.path===job.projectPath)?.id})),...conversations.filter(conv=>!importJobs.some(job=>job.status!=='completed'&&job.targetId===conv.id))],
        activeConversationId,
        newConversationKey,
        setActiveConversationId,
        activeConversation,
        isStreaming,
        selectedModel,
        setSelectedModel,
        activeMode,
        setActiveMode,
        activeArtifact,
        setActiveArtifact,
        isArtifactPaneOpen,
        setIsArtifactPaneOpen,
        activeProject,
        setActiveProject,
        projects,
        setProjects,
        runningSessionIds,
        allArtifacts,
        activePageView,
        setActivePageView,
        createNewConversation,
        startNewArtifactChat,
        selectArtifactCategory,
        selectConversation,
        sendMessage,
        regenerateResponse,
        editUserMessage,
        retractUserMessage,
        recalledDraft,
        clearRecalledDraft: () => setRecalledDraft(null),
        retryLastRequest,
        stopGeneration,
        deleteConversation,
        renameConversation,
        toggleStarConversation,
        moveConversationToProject,
        clearAllConversations,
        saveArtifact,
        deleteArtifact,
        createNewArtifact
      }}
    >
      {children}
    </ChatContext.Provider>
  );
};

// ------------------------------------------------------------------ helpers

function findStreamingAssistant(messages: Message[], streamId?: string): number {
  if (streamId) {
    const matched = messages.findIndex(m => m.role === 'assistant' && m.streamId === streamId);
    if (matched >= 0) return matched;
  }
  const i = messages.length - 1;
  const m = messages[i];
  // Never fill a placeholder across a tool or user message: that reverses events.
  if (streamId && (m?.streamId || m?.content || m?.thinkingContent)) return -1;
  return m?.role === 'assistant' && (m.isStreaming || m.isThinking) ? i : -1;
}

/** NormalizedMessage[] from the history endpoint → the UI's Message shape. */
function attachmentsFromRow(row: any): Attachment[] {
  const files = Array.isArray(row.files) ? row.files : [];
  const images = Array.isArray(row.images) ? row.images : [];
  return [...images.map((image:any,i:number)=>({id:`${row.id}-image-${i}`,name:image.name || t("Image"),type:image.mimeType || 'image/png',size:0,path:image.path,dataUrl:image.data})),
    ...files.map((file:any,i:number)=>({id:`${row.id}-file-${i}`,name:file.name || file.path?.split('/').pop() || t("Files"),type:file.mimeType || 'application/octet-stream',size:file.size || 0,path:file.path}))];
}

function mapHistory(rows: any[]): Message[] {
  const out: Message[] = [];
  const push = (m: Message) => out.push(m);

  for (const row of rows) {
    const anchor = row.transcriptAnchorId ?? row.id;
    switch (row.kind) {
      case 'text': {
        const text = row.content ?? row.text ?? '';
        const attachments=attachmentsFromRow(row);
        if (!text && !attachments.length) break;
        if (row.role === 'user') {
          push({ id: row.id ?? `h-user-${out.length}`, role: 'user', content: text, attachments, createdAt: ts(row), transcriptAnchorId: anchor });
        } else {
          // Merge consecutive assistant text blocks (Claude splits paragraphs).
          const last = out[out.length - 1];
          if (last && last.role === 'assistant' && !last.toolUse && !last.permission) {
            last.content = last.content ? `${last.content}\n\n${text}` : text;
            if (!last.transcriptAnchorId) last.transcriptAnchorId = anchor;
          } else {
            push({ id: row.id ?? `h-asst-${out.length}`, role: 'assistant', content: text, createdAt: ts(row), transcriptAnchorId: anchor });
          }
        }
        break;
      }
      case 'thinking': {
        const text = row.content ?? row.text ?? '';
        const last = out[out.length - 1];
        if (last && last.role === 'assistant') {
          last.thinkingContent = last.thinkingContent ? `${last.thinkingContent}\n${text}` : text;
        } else if (text) {
          push({ id: row.id ?? `h-think-${out.length}`, role: 'assistant', content: '', thinkingContent: text, createdAt: ts(row), transcriptAnchorId: anchor });
        }
        break;
      }
      case 'tool_use':
        // Claude's history adapter merges the result into the tool_use row.
        push({
          id: row.id ?? row.toolId ?? `h-tool-${out.length}`,
          role: 'tool',
          content: '',
          createdAt: ts(row),
          toolUse: { toolId: row.toolId ?? row.id ?? '', toolName: row.toolName ?? 'tool', input: row.toolInput },
          ...(row.toolResult ? { toolResult: { content: row.toolResult.content, isError: row.toolResult.isError } } : {})
        });
        break;
      case 'tool_result': {
        const toolId = row.toolId ?? '';
        let attached = false;
        for (let i = out.length - 1; i >= 0; i--) {
          if (out[i].toolUse && out[i].toolUse!.toolId === toolId) {
            out[i].toolResult = { content: row.toolResult?.content ?? row.content, isError: row.toolResult?.isError ?? row.isError };
            attached = true;
            break;
          }
        }
        if (!attached) {
          push({
            id: row.id ?? `h-toolres-${out.length}`,
            role: 'tool',
            content: '',
            createdAt: ts(row),
            toolUse: { toolId, toolName: row.toolName ?? 'tool', input: undefined },
            toolResult: { content: row.toolResult?.content ?? row.content, isError: row.toolResult?.isError }
          });
        }
        break;
      }
      case 'error':
        push({ id: row.id ?? `h-err-${out.length}`, role: 'assistant', content: '', error: row.content ?? row.text ?? 'error', createdAt: ts(row) });
        break;
      default:
        // status / complete / stream_* / permission_* / session_created rows
        // are live-transport kinds; history has nothing to draw for them.
        break;
    }
  }
  return out.map(message => {
    if (message.role !== 'assistant' || !message.content) return message;
    const parsed = extractArtifactsAndThinking(message.content, message.id);
    return { ...message, content: parsed.cleanedText, artifacts: parsed.artifacts, thinkingContent: parsed.thinkingContent ?? message.thinkingContent };
  });
}

function ts(row: any): number {
  const t = Date.parse(row.timestamp ?? '');
  return Number.isFinite(t) ? t : 0;
}

export const useChat = () => {
  const context = useContext(ChatContext);
  if (!context) {
    throw new Error('useChat must be used within a ChatProvider');
  }
  return context;
};
