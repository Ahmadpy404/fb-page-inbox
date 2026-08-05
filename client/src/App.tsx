import React, { useState, useEffect, useCallback } from 'react';
import { Navbar } from './components/Navbar';
import { ConversationList } from './components/Inbox/ConversationList';
import { ChatWindow } from './components/Inbox/ChatWindow';
import { RulesManager } from './components/Rules/RulesManager';
import { SettingsPanel } from './components/Settings/SettingsPanel';
import { AddPageModal } from './components/Pages/AddPageModal';
import { LoginModal } from './components/Auth/LoginModal';
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
        icon: '/favicon.svg',
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

    // Auto-refresh interval (3s) for bulletproof real-time sync
    const interval = setInterval(() => {
      loadConversations();
      loadPages();
      if (selectedConversationId) {
        fetchConversationMessages(selectedConversationId)
          .then((data) => {
            setMessages((prev) => {
              const deduped = deduplicateMessages(data.messages);
              if (
                prev.length !== deduped.length ||
                (deduped.length > 0 && prev[prev.length - 1]?.id !== deduped[deduped.length - 1]?.id)
              ) {
                return deduped;
              }
              return prev;
            });
          })
          .catch(() => {});
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [isAuthenticated, loadConversations, loadPages, selectedConversationId]);

  // 2. Fetch Messages when selected conversation changes
  useEffect(() => {
    if (!isAuthenticated || !selectedConversationId) {
      setMessages([]);
      return;
    }

    let isCurrent = true;
    setLoadingMessages(true);

    fetchConversationMessages(selectedConversationId)
      .then((data) => {
        if (isCurrent) {
          setMessages(deduplicateMessages(data.messages));
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
          };
          if (index >= 0) {
            const copy = [...prev];
            copy.splice(index, 1);
            return [updatedConv, ...copy];
          } else {
            return [updatedConv, ...prev];
          }
        });

        // If message belongs to active thread, append it
        setSelectedConversationId((currentId) => {
          if (currentId === conversation.id) {
            setMessages((prev) => deduplicateMessages([...prev, message]));
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
            setMessages((prev) => deduplicateMessages([...prev, message]));
          }
          return currentId;
        });
      },

      onConversationUpdated: (updated) => {
        setConversations((prev) =>
          prev.map((c) => (c.id === updated.id ? { ...c, ...updated } : c))
        );
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

  const handleSendReply = async (text?: string, mediaFile?: File) => {
    if (!selectedConversationId) return;
    const result = await sendReply(selectedConversationId, text, mediaFile);
    setMessages((prev) => deduplicateMessages([...prev, result.message]));
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

  const handleUpdateRule = async (id: string, updates: Partial<Rule>) => {
    const updated = await updateRule(id, updates);
    setRules((prev) => prev.map((r) => (r.id === id ? updated : r)));
  };

  const handleDeleteRule = async (id: string) => {
    await deleteRule(id);
    setRules((prev) => prev.filter((r) => r.id !== id));
  };

  const handleReorderRules = async (ruleIds: string[]) => {
    const reordered = await reorderRules(ruleIds);
    setRules(reordered);
  };

  const handleUpdateGlobalAutoReply = async (enabled: boolean) => {
    const newVal = await updateGlobalAutoReply(enabled);
    setSettings((prev) => (prev ? { ...prev, globalAutoReply: newVal } : null));
  };

  const handleVerifyFacebook = async () => {
    const status = await verifyFacebookConnection();
    setSettings((prev) =>
      prev ? { ...prev, facebookStatus: { ...prev.facebookStatus, ...status } } : null
    );
  };

  const handleTriggerSync = async (forceFullSync?: boolean) => {
    setSyncStatus({
      inProgress: true,
      message: forceFullSync ? 'Starting deep full Facebook sync...' : 'Checking for updates (Delta Sync)...',
    });
    try {
      await triggerSync(selectedPageId !== 'all' ? selectedPageId : undefined, forceFullSync);
      await loadConversations();
      await loadPages();
    } catch (err: any) {
      setSyncStatus({ inProgress: false, message: `Sync error: ${err.message || err}` });
    }
  };

  const handleDeletePage = async (pageDbId: string) => {
    try {
      await deletePage(pageDbId);
      await loadPages();
      if (selectedPageId === pageDbId) {
        setSelectedPageId('all');
      }
      await loadConversations();
    } catch (err: any) {
      alert(`Failed to remove page: ${err.message || err}`);
    }
  };

  if (isAuthChecking) {
    return (
      <div className="auth-splash-screen">
        <div className="spinner-glow" />
        <h2>Facebook Page Unified Inbox</h2>
        <p>Securing connection...</p>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <LoginModal onLoginSuccess={handleLoginSuccess} />;
  }

  const selectedConversation =
    conversations.find((c) => c.id === selectedConversationId) || null;

  return (
    <div className="app-container">
      <Navbar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        socketConnected={socketConnected}
        facebookStatus={settings?.facebookStatus}
        syncStatus={syncStatus}
        pages={pages}
        selectedPageId={selectedPageId}
        onSelectPage={(pageId) => setSelectedPageId(pageId)}
        onOpenAddModal={() => setIsAddPageModalOpen(true)}
        onTriggerSync={handleTriggerSync}
        adminUser={adminUser}
        onLogout={handleLogout}
      />

      <div className="main-content">
        {activeTab === 'inbox' && (
          <div className="inbox-layout">
            <ConversationList
              conversations={conversations}
              selectedConversationId={selectedConversationId}
              onSelectConversation={setSelectedConversationId}
              searchQuery={searchQuery}
              onSearchChange={setSearchQuery}
            />
            <ChatWindow
              conversation={selectedConversation}
              messages={messages}
              loading={loadingMessages}
              onSendReply={handleSendReply}
              onToggleAutoReply={handleToggleAutoReply}
              onMarkAsRead={handleMarkAsRead}
            />
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

      {/* J.A.R.V.I.S. In-App Holographic Transmission Alert Toast */}
      {hudToast && (
        <div
          className="hud-toast-alert"
          onClick={() => {
            setSelectedConversationId(hudToast.convId);
            setActiveTab('inbox');
            setHudToast(null);
          }}
          title="Click to open conversation transmission"
        >
          <div className="hud-toast-header">
            <span className="hud-toast-tag">⚡ J.A.R.V.I.S. TRANSMISSION</span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text-muted)' }}>
              {hudToast.pageName || 'Messenger'}
            </span>
          </div>
          <div className="hud-toast-sender">{hudToast.title}</div>
          <div className="hud-toast-body">{hudToast.body}</div>
        </div>
      )}
    </div>
  );
};

export default App;
