import React, { useState, useEffect, useCallback } from 'react';
import { Navbar } from './components/Navbar';
import { ConversationList } from './components/Inbox/ConversationList';
import { ChatWindow } from './components/Inbox/ChatWindow';
import { RulesManager } from './components/Rules/RulesManager';
import { SettingsPanel } from './components/Settings/SettingsPanel';
import { AddPageModal } from './components/Pages/AddPageModal';
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
} from './services/api';
import { getSocket, subscribeToRealtimeEvents } from './services/socket';
import { Conversation, Message, Rule, SettingsData, SyncStatus, PageData } from './types';

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
 * Synthesizes a loud, high-gain harmonic chime bell using the Web Audio API.
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
    compressor.threshold.setValueAtTime(-20, ctx.currentTime);
    compressor.knee.setValueAtTime(25, ctx.currentTime);
    compressor.ratio.setValueAtTime(10, ctx.currentTime);
    compressor.attack.setValueAtTime(0.003, ctx.currentTime);
    compressor.release.setValueAtTime(0.25, ctx.currentTime);

    const masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(0.9, ctx.currentTime);
    masterGain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 1.2);

    // Harmonic bell triad: E5 (659.25Hz), A5 (880Hz), C#6 (1108.73Hz), E6 (1318.51Hz)
    const notes = [
      { freq: 659.25, delay: 0.0 },
      { freq: 880.0, delay: 0.08 },
      { freq: 1108.73, delay: 0.16 },
      { freq: 1318.51, delay: 0.24 },
    ];

    notes.forEach(({ freq, delay }) => {
      const osc = ctx.createOscillator();
      const oscGain = ctx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, ctx.currentTime + delay);

      oscGain.gain.setValueAtTime(0.45, ctx.currentTime + delay);
      oscGain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + 0.85);

      osc.connect(oscGain);
      oscGain.connect(compressor);

      osc.start(ctx.currentTime + delay);
      osc.stop(ctx.currentTime + delay + 0.9);
    });

    compressor.connect(masterGain);
    masterGain.connect(ctx.destination);
  } catch (err) {
    console.warn('[Audio] Notification playback issue:', err);
  }
}

export const App: React.FC = () => {
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

  // Request browser notification permissions on mount
  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {});
    }
  }, []);

  const showBrowserNotification = (senderName: string, text: string, pageName?: string) => {
    try {
      if ('Notification' in window && Notification.permission === 'granted') {
        const title = pageName ? `💬 ${senderName} (${pageName})` : `💬 ${senderName}`;
        new Notification(title, {
          body: text || 'New message/attachment received',
          icon: '/favicon.ico',
          silent: false,
        });
      }
    } catch {
      // Ignore if not permitted
    }
  };

  // 1. Initial Data Fetching
  const loadPages = useCallback(async () => {
    try {
      const pageList = await fetchPages();
      setPages(pageList);
    } catch (err) {
      console.error('Failed to load pages:', err);
    }
  }, []);

  const loadConversations = useCallback(async () => {
    try {
      const list = await fetchConversations(searchQuery || undefined, selectedPageId);
      setConversations(list);
      setSelectedConversationId((prev) => prev || (list.length > 0 ? list[0].id : null));
    } catch (err) {
      console.error('Failed to load conversations:', err);
    }
  }, [searchQuery, selectedPageId]);

  const loadRules = useCallback(async () => {
    try {
      const list = await fetchRules();
      setRules(list);
    } catch (err) {
      console.error('Failed to load rules:', err);
    }
  }, []);

  const loadSettings = useCallback(async () => {
    try {
      const data = await fetchSettings();
      setSettings(data);
    } catch (err) {
      console.error('Failed to load settings:', err);
    }
  }, []);

  useEffect(() => {
    loadPages();
    loadRules();
    loadSettings();
  }, [loadPages, loadRules, loadSettings]);

  useEffect(() => {
    loadConversations();

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
  }, [loadConversations, loadPages, selectedConversationId]);

  // 2. Fetch Messages when selected conversation changes
  useEffect(() => {
    if (!selectedConversationId) {
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
  }, [selectedConversationId]);

  // 3. Setup Socket.IO Realtime Listeners
  useEffect(() => {
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
  }, [loadConversations, loadPages]);

  // Handlers
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

  const handleTriggerSync = async () => {
    setSyncStatus({ inProgress: true, message: 'Starting Facebook sync...' });
    try {
      await triggerSync(selectedPageId !== 'all' ? selectedPageId : undefined);
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
          await loadConversations();
        }}
      />
    </div>
  );
};

export default App;
