import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Navbar } from './components/Navbar';
import { ConversationList } from './components/Inbox/ConversationList';
import { ChatWindow } from './components/Inbox/ChatWindow';
import { RulesManager } from './components/Rules/RulesManager';
import { SettingsPanel } from './components/Settings/SettingsPanel';
import { AddPageModal } from './components/Pages/AddPageModal';
import { BulkBroadcastModal } from './components/Broadcast/BulkBroadcastModal';
import { LoginModal } from './components/Auth/LoginModal';
import { ToastAlert } from './components/Notification/ToastAlert';
import {
  fetchConversations,
  fetchConversationMessages,
  sendReply,
  toggleConversationAutoReply,
  markConversationAsRead,
  fetchRules,
  createRule,
  updateRule,
  deleteRule,
  reorderRules,
  fetchSettings,
  updateGlobalAutoReply,
  updateFollowUpSettings,
  triggerFollowUpNow,
  verifyFacebookConnection,
  triggerSync,
  fetchPages,
  deletePage,
  verifySession,
  logout,
  syncPagesVault,
} from './services/api';
import { getSocket, subscribeToRealtimeEvents, refreshSocketAuth } from './services/socket';
import { Conversation, Message, Rule, SettingsData, SyncStatus, PageData } from './types';

const VAULT_KEY = 'fb_inbox_pages_vault';
const EMBEDDED_NOTIFICATION_ICON =
  'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="48" fill="%230084ff"/><path d="M28 50 C28 36 38 26 50 26 C62 26 72 36 72 50 C72 64 62 74 50 74 C45 74 41 73 37 71 L26 75 L30 63 C29 59 28 55 28 50 Z" fill="white"/></svg>';

function deduplicateMessages(list: Message[]): Message[] {
  const seenIds = new Set<string>();
  const seenFbIds = new Set<string>();
  const result: Message[] = [];

  for (const m of list) {
    if (!m) continue;
    if (m.id && seenIds.has(m.id)) continue;
    if (m.fbMessageId && seenFbIds.has(m.fbMessageId)) continue;

    const isDuplicateOutbound = result.some(
      (existing) =>
        existing.direction === m.direction &&
        (existing.direction === 'outbound_manual' || existing.direction === 'outbound_auto') &&
        existing.text?.trim() === m.text?.trim() &&
        Math.abs(new Date(existing.createdAt).getTime() - new Date(m.createdAt).getTime()) < 30000
    );

    if (isDuplicateOutbound) continue;

    if (m.id) seenIds.add(m.id);
    if (m.fbMessageId) seenFbIds.add(m.fbMessageId);
    result.push(m);
  }

  return result;
}

/**
 * J.A.R.V.I.S. Mark-85 High-Resonance Futuristic Notification Sound FX
 */
function playLoudNotificationChime() {
  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();

    if (ctx.state === 'suspended') {
      ctx.resume();
    }

    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.setValueAtTime(-15, ctx.currentTime);
    compressor.knee.setValueAtTime(20, ctx.currentTime);
    compressor.ratio.setValueAtTime(12, ctx.currentTime);
    compressor.attack.setValueAtTime(0.002, ctx.currentTime);
    compressor.release.setValueAtTime(0.2, ctx.currentTime);

    const masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(1.0, ctx.currentTime);
    masterGain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 1.4);

    // Stark Holographic Arc Beacon: C#5, G#5, C#6, F#6 (Cyber HUD Beacon)
    const frequencies = [554.37, 830.61, 1108.73, 1479.98];
    frequencies.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const oscGain = ctx.createGain();

      osc.type = idx % 2 === 0 ? 'sine' : 'triangle';
      osc.frequency.setValueAtTime(freq, ctx.currentTime + idx * 0.07);

      oscGain.gain.setValueAtTime(0.5, ctx.currentTime + idx * 0.07);
      oscGain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + idx * 0.07 + 0.9);

      osc.connect(oscGain);
      oscGain.connect(compressor);

      osc.start(ctx.currentTime + idx * 0.07);
      osc.stop(ctx.currentTime + idx * 0.07 + 0.95);
    });

    compressor.connect(masterGain);
    masterGain.connect(ctx.destination);
  } catch (err) {
    console.warn('[Audio] Notification playback error:', err);
  }
}

/**
 * Displays OS-native browser notification with fallback
 */
function showBrowserNotification(userName: string, text: string, pageName?: string) {
  try {
    if (typeof window === 'undefined' || !('Notification' in window)) return;

    if (Notification.permission === 'granted') {
      const title = `⚡ ${userName || 'Customer'} [${pageName || 'Messenger'}]`;
      const body = text && text.trim() ? text : 'Sent a photo, video, or attachment.';
      const notification = new Notification(title, {
        body,
        icon: EMBEDDED_NOTIFICATION_ICON,
        tag: 'fb-chat-alert',
        silent: false,
      });

      notification.onclick = () => {
        window.focus();
        notification.close();
      };
    } else if (Notification.permission === 'default') {
      Notification.requestPermission();
    }
  } catch (err) {
    console.warn('[Notification] Browser notification error:', err);
  }
}

export const App: React.FC = () => {
  // Auth state
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [isAuthChecking, setIsAuthChecking] = useState<boolean>(true);
  const [adminUser, setAdminUser] = useState<{ username: string; role?: string } | null>(null);

  const [activeTab, setActiveTab] = useState<'inbox' | 'rules' | 'settings'>('inbox');
  const [pages, setPages] = useState<PageData[]>([]);
  const [selectedPageId, setSelectedPageId] = useState<string>('all');
  const [isAddPageModalOpen, setIsAddPageModalOpen] = useState(false);
  const [isBroadcastModalOpen, setIsBroadcastModalOpen] = useState(false);

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [rules, setRules] = useState<Rule[]>([]);
  const [settings, setSettings] = useState<SettingsData | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatus | undefined>();
  const [socketConnected, setSocketConnected] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [hasAutoSynced, setHasAutoSynced] = useState(false);
  const [mobileView, setMobileView] = useState<'list' | 'chat'>('list');

  // Client-side cache for instant switching between chats (0ms delay)
  const messageCacheRef = useRef<Map<string, Message[]>>(new Map());
  const typingTimeoutsRef = useRef<Map<string, NodeJS.Timeout>>(new Map());

  const [hudToast, setHudToast] = useState<{
    title: string;
    body: string;
    pageName?: string;
    convId: string;
  } | null>(null);

  // Auto-dismiss HUD toast after 6 seconds
  useEffect(() => {
    if (hudToast) {
      const timer = setTimeout(() => setHudToast(null), 6000);
      return () => clearTimeout(timer);
    }
  }, [hudToast]);

  // Check auth session on boot
  useEffect(() => {
    async function checkAuth() {
      try {
        const session = await verifySession();
        if (session.authenticated && session.user) {
          setIsAuthenticated(true);
          setAdminUser(session.user);
          refreshSocketAuth();
        } else {
          setIsAuthenticated(false);
          setAdminUser(null);
        }
      } catch {
        setIsAuthenticated(false);
      } finally {
        setIsAuthChecking(false);
      }
    }

    checkAuth();

    const handleUnauthorized = () => {
      setIsAuthenticated(false);
      setAdminUser(null);
    };

    window.addEventListener('auth:unauthorized', handleUnauthorized);
    return () => window.removeEventListener('auth:unauthorized', handleUnauthorized);
  }, []);

  // Request browser notification permissions on mount
  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {});
    }
  }, []);

  // Reconcile and save persistent pages vault
  const syncAndSaveVault = useCallback(async (serverPages: PageData[]) => {
    try {
      const storedVault = localStorage.getItem(VAULT_KEY);
      let vaultList: Array<{ pageId: string; name?: string; token: string }> = [];

      if (storedVault) {
        try {
          vaultList = JSON.parse(storedVault);
        } catch {}
      }

      // Check if server is missing any pages from vault (e.g. after fresh Render restart)
      const serverPageIds = new Set(serverPages.map((p) => p.pageId));
      const missingPages = vaultList.filter((vp) => !serverPageIds.has(vp.pageId) && vp.token);

      if (missingPages.length > 0) {
        await syncPagesVault(missingPages);
        const refreshed = await fetchPages();
        setPages(refreshed);
      }

      // Update vault with current server pages, preserving tokens if known
      const tokenMap = new Map(vaultList.map((v) => [v.pageId, v.token]));
      const updatedVault = serverPages
        .map((p) => ({
          pageId: p.pageId,
          name: p.name,
          token: p.accessToken || tokenMap.get(p.pageId) || '',
        }))
        .filter((p) => p.token);

      localStorage.setItem(VAULT_KEY, JSON.stringify(updatedVault));
    } catch (err) {
      console.warn('[Vault] Sync error:', err);
    }
  }, []);

  const loadPages = useCallback(async () => {
    if (!isAuthenticated) return;
    try {
      const pageList = await fetchPages();
      setPages(pageList);
      syncAndSaveVault(pageList);
    } catch (err) {
      console.error('Failed to load pages:', err);
    }
  }, [isAuthenticated, syncAndSaveVault]);

  const loadConversations = useCallback(async () => {
    if (!isAuthenticated) return;
    try {
      const list = await fetchConversations(searchQuery || undefined, selectedPageId);
      setConversations(list);
      setSelectedConversationId((prev) => prev || (list.length > 0 ? list[0].id : null));
    } catch (err) {
      console.error('Failed to load conversations:', err);
    }
  }, [isAuthenticated, searchQuery, selectedPageId]);

  const loadRules = useCallback(async () => {
    if (!isAuthenticated) return;
    try {
      const list = await fetchRules();
      setRules(list);
    } catch (err) {
      console.error('Failed to load rules:', err);
    }
  }, [isAuthenticated]);

  const loadSettings = useCallback(async () => {
    if (!isAuthenticated) return;
    try {
      const data = await fetchSettings();
      setSettings(data);
    } catch (err) {
      console.error('Failed to load settings:', err);
    }
  }, [isAuthenticated]);

  // Load rules & settings when switching tabs
  useEffect(() => {
    if (!isAuthenticated) return;
    if (activeTab === 'rules') loadRules();
    if (activeTab === 'settings') loadSettings();
  }, [isAuthenticated, activeTab, loadRules, loadSettings]);

  // Master Boot & Auto-Sync Initializer
  useEffect(() => {
    if (!isAuthenticated) return;

    let isMounted = true;

    async function initializeAndAutoSync() {
      try {
        // Step 1: Reconcile vault from localStorage with backend
        const storedVault = localStorage.getItem(VAULT_KEY);
        let vaultList: Array<{ pageId: string; name?: string; token: string }> = [];
        if (storedVault) {
          try {
            vaultList = JSON.parse(storedVault);
          } catch {}
        }

        if (vaultList.length > 0) {
          try {
            await syncPagesVault(vaultList);
          } catch (err) {
            console.warn('[Vault] sync error on boot:', err);
          }
        }

        const currentPages = await fetchPages();

        if (!isMounted) return;
        setPages(currentPages);

        // Step 2: Parallel fetch initial data
        const [rulesList, settingsData, convList] = await Promise.all([
          fetchRules().catch(() => []),
          fetchSettings().catch(() => null),
          fetchConversations(undefined, selectedPageId).catch(() => []),
        ]);

        if (!isMounted) return;
        setRules(rulesList);
        if (settingsData) setSettings(settingsData);
        setConversations(convList);
        if (convList.length > 0) {
          setSelectedConversationId((prev) => prev || convList[0].id);
        }

        // Step 3: Trigger background automatic sync if not completed in this session
        if (!hasAutoSynced) {
          setHasAutoSynced(true);
          console.log('[AutoSync] Running automated initial sync for inbox history...');
          triggerSync(selectedPageId !== 'all' ? selectedPageId : undefined)
            .then(async () => {
              if (!isMounted) return;
              const refreshedChats = await fetchConversations(undefined, selectedPageId);
              setConversations(refreshedChats);
              if (refreshedChats.length > 0) {
                setSelectedConversationId((prev) => prev || refreshedChats[0].id);
              }
            })
            .catch((err) => console.warn('[AutoSync] Notice:', err.message || err));
        }
      } catch (err) {
        console.error('[Initializer] Error during startup:', err);
      }
    }

    initializeAndAutoSync();

    return () => {
      isMounted = false;
    };
  }, [isAuthenticated, selectedPageId, hasAutoSynced]);

  useEffect(() => {
    if (!isAuthenticated) return;

    // Window focus & tab visibility handlers for instant refresh when returning to tab
    const handleFocus = () => {
      loadConversations();
      loadPages();
    };

    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleFocus);

    // Gentle 30s background heartbeat (real-time is powered by Socket.IO)
    const interval = setInterval(() => {
      loadConversations();
      loadPages();
    }, 30000);

    return () => {
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleFocus);
      clearInterval(interval);
    };
  }, [isAuthenticated, loadConversations, loadPages]);

  // 2. Instant cache-assisted message loader (0ms switching)
  useEffect(() => {
    if (!isAuthenticated || !selectedConversationId) {
      setMessages([]);
      return;
    }

    let isCurrent = true;

    // Check cache first for 0ms transition
    if (messageCacheRef.current.has(selectedConversationId)) {
      setMessages(messageCacheRef.current.get(selectedConversationId)!);
      setLoadingMessages(false);
    } else {
      setLoadingMessages(true);
    }

    fetchConversationMessages(selectedConversationId)
      .then((data) => {
        if (isCurrent) {
          const deduped = deduplicateMessages(data.messages);
          setMessages(deduped);
          messageCacheRef.current.set(selectedConversationId, deduped);
        }
      })
      .catch((err) => console.error('Failed to fetch messages:', err))
      .finally(() => {
        if (isCurrent) setLoadingMessages(false);
      });

    return () => {
      isCurrent = false;
    };
  }, [isAuthenticated, selectedConversationId]);

  // 3. Setup Socket.IO Realtime Listeners
  useEffect(() => {
    if (!isAuthenticated) return;

    const socket = getSocket();

    const handleConnect = () => setSocketConnected(true);
    const handleDisconnect = () => setSocketConnected(false);

    setSocketConnected(socket.connected);
    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);

    const unsubscribe = subscribeToRealtimeEvents({
      onNewMessage: ({ message, conversation }) => {
        // Sound & Browser Notification for inbound messages
        if (message.direction === 'inbound') {
          playLoudNotificationChime();
          showBrowserNotification(
            conversation.userName || 'Customer',
            message.text,
            conversation.page?.name
          );
          setHudToast({
            title: conversation.userName || 'Customer',
            body: message.text || 'Sent an attachment / media',
            pageName: conversation.page?.name,
            convId: conversation.id,
          });
        }

        // Update or insert conversation in list
        setConversations((prev) => {
          const index = prev.findIndex((c) => c.id === conversation.id);
          const updatedConv = {
            ...conversation,
            lastMessage: message,
            isTyping: false,
          };
          if (index >= 0) {
            const copy = [...prev];
            copy.splice(index, 1);
            return [updatedConv, ...copy];
          } else {
            return [updatedConv, ...prev];
          }
        });

        // Update message thread and cache
        setSelectedConversationId((currentId) => {
          if (currentId === conversation.id) {
            setMessages((prev) => {
              const deduped = deduplicateMessages([...prev, message]);
              messageCacheRef.current.set(conversation.id, deduped);
              return deduped;
            });
          }
          return currentId;
        });

        loadPages();
      },

      onNewReply: ({ message, conversationId }) => {
        setConversations((prev) => {
          const index = prev.findIndex((c) => c.id === conversationId);
          if (index >= 0) {
            const target = { ...prev[index], lastMessage: message, lastMessageAt: message.createdAt };
            const copy = [...prev];
            copy.splice(index, 1);
            return [target, ...copy];
          }
          return prev;
        });

        setSelectedConversationId((currentId) => {
          if (currentId === conversationId) {
            setMessages((prev) => {
              const deduped = deduplicateMessages([...prev, message]);
              messageCacheRef.current.set(conversationId, deduped);
              return deduped;
            });
          }
          return currentId;
        });
      },

      onConversationUpdated: (updated) => {
        setConversations((prev) =>
          prev.map((c) => (c.id === updated.id ? { ...c, ...updated } : c))
        );
      },

      onMessageRead: ({ conversationId, watermark }) => {
        console.log(`[Socket] Read receipt: conv ${conversationId} watermark ${watermark}`);
        setConversations((prev) =>
          prev.map((c) => (c.id === conversationId ? { ...c, readWatermark: watermark } : c))
        );
      },

      onTypingStatus: ({ conversationId, isTyping }) => {
        setConversations((prev) =>
          prev.map((c) => (c.id === conversationId ? { ...c, isTyping } : c))
        );

        if (isTyping) {
          if (typingTimeoutsRef.current.has(conversationId)) {
            clearTimeout(typingTimeoutsRef.current.get(conversationId)!);
          }
          const timeout = setTimeout(() => {
            setConversations((prev) =>
              prev.map((c) => (c.id === conversationId ? { ...c, isTyping: false } : c))
            );
          }, 6000);
          typingTimeoutsRef.current.set(conversationId, timeout);
        }
      },

      onSyncStatus: (status) => {
        setSyncStatus(status);
        if (!status.inProgress) {
          loadConversations();
          loadPages();
        }
      },
    });

    return () => {
      socket.off('connect', handleConnect);
      socket.off('disconnect', handleDisconnect);
      unsubscribe();
    };
  }, [isAuthenticated, loadConversations, loadPages]);

  // Handlers
  const handleLoginSuccess = (user: any) => {
    setIsAuthenticated(true);
    setAdminUser(user);
  };

  const handleLogout = async () => {
    if (window.confirm('Are you sure you want to log out of the Facebook Page Unified Inbox?')) {
      await logout();
      setIsAuthenticated(false);
      setAdminUser(null);
    }
  };

  // Instant 0ms Optimistic Outbound Messaging
  const handleSendReply = async (text?: string, mediaFile?: File) => {
    if (!selectedConversationId) return;

    const tempId = `temp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const nowIso = new Date().toISOString();
    const optimisticMsg: Message = {
      id: tempId,
      conversationId: selectedConversationId,
      direction: 'outbound_manual',
      text: text || (mediaFile ? `[Uploading ${mediaFile.name}...]` : ''),
      createdAt: nowIso,
      isPending: true,
      status: 'sending',
    };

    // 1. Instantly append to active chat (0ms feedback)
    setMessages((prev) => [...prev, optimisticMsg]);

    // 2. Instantly update sidebar snippet & elevate conversation
    setConversations((prev) => {
      const idx = prev.findIndex((c) => c.id === selectedConversationId);
      if (idx >= 0) {
        const updated = {
          ...prev[idx],
          lastMessage: optimisticMsg,
          lastMessageAt: nowIso,
        };
        const copy = [...prev];
        copy.splice(idx, 1);
        return [updated, ...copy];
      }
      return prev;
    });

    try {
      const result = await sendReply(selectedConversationId, text, mediaFile);

      // 3. Confirm message
      setMessages((prev) => {
        const deduped = deduplicateMessages(
          prev.map((m) => (m.id === tempId ? { ...result.message, isPending: false, status: 'sent' } : m))
        );
        messageCacheRef.current.set(selectedConversationId, deduped);
        return deduped;
      });

      // Update sidebar
      setConversations((prev) => {
        const idx = prev.findIndex((c) => c.id === selectedConversationId);
        if (idx >= 0) {
          const updated = {
            ...prev[idx],
            lastMessage: result.message,
            lastMessageAt: result.message.createdAt,
          };
          const copy = [...prev];
          copy.splice(idx, 1);
          return [updated, ...copy];
        }
        return prev;
      });
    } catch (err) {
      console.error('Failed to send reply:', err);
      // Mark as failed
      setMessages((prev) =>
        prev.map((m) => (m.id === tempId ? { ...m, isPending: false, status: 'failed' } : m))
      );
      throw err;
    }
  };

  const handleToggleAutoReply = async (enabled?: boolean) => {
    if (!selectedConversationId) return;
    const result = await toggleConversationAutoReply(selectedConversationId, enabled);
    setConversations((prev) =>
      prev.map((c) => (c.id === result.conversation.id ? { ...c, ...result.conversation } : c))
    );
  };

  const handleMarkAsRead = async () => {
    if (!selectedConversationId) return;
    const result = await markConversationAsRead(selectedConversationId);
    setConversations((prev) =>
      prev.map((c) => (c.id === result.conversation.id ? { ...c, ...result.conversation } : c))
    );
    loadPages();
  };

  const handleCreateRule = async (newRule: any) => {
    const created = await createRule(newRule);
    setRules((prev) => [...prev, created].sort((a, b) => a.priority - b.priority));
  };

  const handleUpdateRule = async (id: string, updates: any) => {
    const updated = await updateRule(id, updates);
    setRules((prev) => prev.map((r) => (r.id === id ? updated : r)));
  };

  const handleDeleteRule = async (id: string) => {
    await deleteRule(id);
    setRules((prev) => prev.filter((r) => r.id !== id));
  };

  const handleReorderRules = async (orderedIds: string[]) => {
    const updated = await reorderRules(orderedIds);
    setRules(updated);
  };

  const handleUpdateGlobalAutoReply = async (enabled: boolean) => {
    const result = await updateGlobalAutoReply(enabled);
    setSettings((prev) => (prev ? { ...prev, globalAutoReply: result } : null));
  };

  const handleUpdateFollowUpSettings = async (updates: {
    followUpEnabled?: boolean;
    followUpHours?: number;
    followUpTemplate?: string;
  }) => {
    const updated = await updateFollowUpSettings(updates);
    setSettings((prev) => (prev ? { ...prev, followUpConfig: updated.followUpConfig } : null));
  };

  const handleVerifyFacebook = async () => {
    const status = await verifyFacebookConnection();
    setSettings((prev) =>
      prev ? { ...prev, facebookStatus: { ...prev.facebookStatus, ...status } } : null
    );
  };

  const handleTriggerSync = async (forceFullSync?: boolean) => {
    const isForce = forceFullSync === true;
    setSyncStatus({
      inProgress: true,
      message: isForce ? 'Starting deep full Facebook sync...' : 'Checking for updates (Delta Sync)...',
    });
    try {
      await triggerSync(selectedPageId !== 'all' ? selectedPageId : undefined, isForce);
      await loadConversations();
      await loadPages();
    } catch (err: any) {
      setSyncStatus({ inProgress: false, message: `Sync error: ${err.message || err}` });
    }
  };

  const handleDeletePage = async (id: string) => {
    const targetPage = pages.find((p) => p.id === id);
    await deletePage(id);

    // Remove from local storage vault
    try {
      const stored = localStorage.getItem(VAULT_KEY);
      if (stored && targetPage) {
        const vaultList = JSON.parse(stored);
        const filtered = vaultList.filter((v: any) => v.pageId !== targetPage.pageId);
        localStorage.setItem(VAULT_KEY, JSON.stringify(filtered));
      }
    } catch {}

    await loadPages();
    if (selectedPageId === id) setSelectedPageId('all');
  };

  if (isAuthChecking) {
    return (
      <div className="app-container loading-center">
        <div className="skeleton-spinner" />
        <p style={{ marginTop: '16px', color: 'var(--text-secondary)' }}>
          Authenticating secure Facebook Inbox workspace...
        </p>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <LoginModal onLoginSuccess={handleLoginSuccess} />;
  }

  const selectedConversation =
    conversations.find((c) => c.id === selectedConversationId) || null;

  return (
    <div className={`app-container ${activeTab === 'inbox' && mobileView === 'chat' ? 'mobile-chat-active' : ''}`}>
      <Navbar
        activeTab={activeTab}
        setActiveTab={(tab) => {
          setActiveTab(tab);
          if (tab === 'inbox') setMobileView('list');
        }}
        socketConnected={socketConnected}
        facebookStatus={settings?.facebookStatus}
        syncStatus={syncStatus}
        pages={pages}
        selectedPageId={selectedPageId}
        onSelectPage={(pageId) => {
          setSelectedPageId(pageId);
          setMobileView('list');
        }}
        onOpenAddModal={() => setIsAddPageModalOpen(true)}
        onTriggerSync={handleTriggerSync}
        onOpenBroadcastModal={() => setIsBroadcastModalOpen(true)}
        adminUser={adminUser}
        onLogout={handleLogout}
      />

      <div className="main-content">
        {activeTab === 'inbox' && (
          <div className={`inbox-layout mobile-view-${mobileView}`}>
            <div className={`inbox-col-sidebar ${mobileView === 'chat' ? 'mobile-hidden' : ''}`}>
              <ConversationList
                conversations={conversations}
                selectedConversationId={selectedConversationId}
                onSelectConversation={(id) => {
                  setSelectedConversationId(id);
                  setMobileView('chat');
                }}
                searchQuery={searchQuery}
                onSearchChange={setSearchQuery}
              />
            </div>

            <div className={`inbox-col-chat ${mobileView === 'list' ? 'mobile-hidden' : ''}`}>
              <ChatWindow
                conversation={selectedConversation}
                messages={messages}
                loading={loadingMessages}
                onSendReply={handleSendReply}
                onToggleAutoReply={handleToggleAutoReply}
                onMarkAsRead={handleMarkAsRead}
                onBackToMobileList={() => setMobileView('list')}
              />
            </div>
          </div>
        )}

        {activeTab === 'rules' && (
          <RulesManager
            rules={rules}
            onCreateRule={handleCreateRule}
            onUpdateRule={handleUpdateRule}
            onDeleteRule={handleDeleteRule}
            onReorderRules={handleReorderRules}
          />
        )}

        {activeTab === 'settings' && (
          <SettingsPanel
            settings={settings}
            syncStatus={syncStatus}
            pages={pages}
            onUpdateGlobalAutoReply={handleUpdateGlobalAutoReply}
            onUpdateFollowUpSettings={handleUpdateFollowUpSettings}
            onTriggerFollowUpNow={triggerFollowUpNow}
            onVerifyConnection={handleVerifyFacebook}
            onTriggerSync={handleTriggerSync}
            onOpenAddModal={() => setIsAddPageModalOpen(true)}
            onDeletePage={handleDeletePage}
            onPlayLoudNotification={playLoudNotificationChime}
          />
        )}
      </div>

      <AddPageModal
        isOpen={isAddPageModalOpen}
        onClose={() => setIsAddPageModalOpen(false)}
        onPageAdded={async (newPage) => {
          await loadPages();
          setSelectedPageId(newPage.id);
          triggerSync(newPage.id)
            .then(async () => {
              const chats = await fetchConversations(undefined, newPage.id);
              setConversations(chats);
              if (chats.length > 0) setSelectedConversationId(chats[0].id);
            })
            .catch(() => {});
        }}
      />

      <BulkBroadcastModal
        isOpen={isBroadcastModalOpen}
        onClose={() => setIsBroadcastModalOpen(false)}
        pages={pages}
        selectedPageId={selectedPageId}
        conversations={conversations}
      />

      {/* Floating Glassmorphic Toast Alert for incoming messages */}
      {hudToast && (
        <ToastAlert
          title={hudToast.title}
          body={hudToast.body}
          pageName={hudToast.pageName}
          convId={hudToast.convId}
          onOpen={(convId) => {
            setSelectedConversationId(convId);
            setActiveTab('inbox');
            setMobileView('chat');
            setHudToast(null);
          }}
          onClose={() => setHudToast(null)}
        />
      )}
    </div>
  );
};

export default App;
