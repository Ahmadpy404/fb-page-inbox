import React, { useState, useEffect, useCallback } from 'react';
import { Navbar } from './components/Navbar';
import { ConversationList } from './components/Inbox/ConversationList';
import { ChatWindow } from './components/Inbox/ChatWindow';
import { RulesManager } from './components/Rules/RulesManager';
import { SettingsPanel } from './components/Settings/SettingsPanel';
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
} from './services/api';
import { getSocket, subscribeToRealtimeEvents } from './services/socket';
import { Conversation, Message, Rule, SettingsData, SyncStatus } from './types';

function deduplicateMessages(list: Message[]): Message[] {
  const seenIds = new Set<string>();
  const seenFbIds = new Set<string>();
  const result: Message[] = [];

  for (const m of list) {
    if (m.id && seenIds.has(m.id)) continue;
    if (m.fbMessageId && seenFbIds.has(m.fbMessageId)) continue;

    const isDuplicateOutbound = result.some(
      (existing) =>
        existing.direction === m.direction &&
        existing.direction === 'outbound_manual' &&
        existing.text === m.text &&
        Math.abs(new Date(existing.createdAt).getTime() - new Date(m.createdAt).getTime()) < 10000
    );

    if (isDuplicateOutbound) continue;

    if (m.id) seenIds.add(m.id);
    if (m.fbMessageId) seenFbIds.add(m.fbMessageId);
    result.push(m);
  }

  return result;
}

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'inbox' | 'rules' | 'settings'>('inbox');
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

  const showBrowserNotification = (senderName: string, text: string) => {
    try {
      if ('Notification' in window && Notification.permission === 'granted') {
        new Notification(`💬 ${senderName}`, {
          body: text || 'New message received',
          icon: '/favicon.ico',
          silent: false,
        });
      }
    } catch {
      // Ignore if not permitted
    }
  };

  const playNotificationChime = () => {
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.12);
      gain.gain.setValueAtTime(0.2, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.35);
    } catch {
      // Ignore if user has not interacted with browser yet
    }
  };

  // 1. Initial Data Fetching
  const loadConversations = useCallback(async () => {
    try {
      const list = await fetchConversations();
      setConversations(list);
      setSelectedConversationId((prev) => prev || (list.length > 0 ? list[0].id : null));
    } catch (err) {
      console.error('Failed to load conversations:', err);
    }
  }, []);

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
    loadConversations();
    loadRules();
    loadSettings();

    // Auto-refresh interval (3s) for bulletproof real-time sync
    const interval = setInterval(() => {
      loadConversations();
      if (selectedConversationId) {
        fetchConversationMessages(selectedConversationId)
          .then((data) => {
            setMessages((prev) => {
              const deduped = deduplicateMessages(data.messages);
              if (prev.length !== deduped.length || (deduped.length > 0 && prev[prev.length - 1]?.id !== deduped[deduped.length - 1]?.id)) {
                return deduped;
              }
              return prev;
            });
          })
          .catch(() => {});
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [loadConversations, loadRules, loadSettings, selectedConversationId]);

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
          playNotificationChime();
          showBrowserNotification(conversation.userName || 'Customer', message.text);
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
        }
      },
    });

    return () => {
      socket.off('connect', handleConnect);
      socket.off('disconnect', handleDisconnect);
      unsubscribe();
    };
  }, [loadConversations]);

  // Handlers
  const handleSendReply = async (text: string) => {
    if (!selectedConversationId) return;
    const result = await sendReply(selectedConversationId, text);
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
      await triggerSync();
      await loadConversations();
    } catch (err: any) {
      setSyncStatus({ inProgress: false, message: `Sync error: ${err.message || err}` });
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
            onUpdateGlobalAutoReply={handleUpdateGlobalAutoReply}
            onVerifyConnection={handleVerifyFacebook}
            onTriggerSync={handleTriggerSync}
          />
        )}
      </div>
    </div>
  );
};

export default App;
