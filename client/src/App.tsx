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
import { NotificationBanner } from './components/Notification/NotificationBanner';
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
  simulateTestInboundMessage,
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

let sharedAudioCtx: AudioContext | null = null;

function getOrCreateAudioContext(): AudioContext | null {
  try {
    if (typeof window === 'undefined') return null;
    if (!sharedAudioCtx) {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioCtx) {
        sharedAudioCtx = new AudioCtx();
      }
    }
    if (sharedAudioCtx && sharedAudioCtx.state === 'suspended') {
      sharedAudioCtx.resume().catch(() => {});
    }
    return sharedAudioCtx;
  } catch {
    return null;
  }
}

// Automatically unlock audio context on first user interaction on window
if (typeof window !== 'undefined') {
  const unlockAudio = () => {
    getOrCreateAudioContext();
    window.removeEventListener('click', unlockAudio);
    window.removeEventListener('keydown', unlockAudio);
    window.removeEventListener('touchstart', unlockAudio);
  };
  window.addEventListener('click', unlockAudio, { once: true, passive: true });
  window.addEventListener('keydown', unlockAudio, { once: true, passive: true });
  window.addEventListener('touchstart', unlockAudio, { once: true, passive: true });
}

/**
 * J.A.R.V.I.S. Mark-85 High-Resonance Futuristic Notification Sound FX
 */
function playLoudNotificationChime() {
  try {
    const ctx = getOrCreateAudioContext();
    if (!ctx) return;

    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
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

let tabFlashTimer: any = null;

/**
 * Pulses the browser tab title to alert the user even when working on another window/tab
 */
function flashTabTitle(senderName: string, text: string) {
  if (typeof document === 'undefined') return;
  const originalTitle = 'FB Page Unified Inbox';
  const alertTitle = `💬 (${senderName}): ${text ? text.slice(0, 24) : 'New message'}`;

  if (tabFlashTimer) {
    clearInterval(tabFlashTimer);
  }

  let toggled = false;
  let counter = 0;
  document.title = alertTitle;

  tabFlashTimer = setInterval(() => {
    counter++;
    toggled = !toggled;
    document.title = toggled ? originalTitle : alertTitle;

    if (counter > 16 || (typeof document !== 'undefined' && document.hasFocus())) {
      clearInterval(tabFlashTimer);
      tabFlashTimer = null;
      document.title = originalTitle;
    }
  }, 900);
}

/**
 * Displays OS-native browser notification with Service Worker support for guaranteed delivery
 */
function showBrowserNotification(
  userName: string,
  text: string,
  pageName?: string,
  convId?: string,
  onOpenConversation?: (id: string) => void
) {
  try {
    // 1. Tab title flashing for instantaneous visual alert
    flashTabTitle(userName || 'Customer', text && text.trim() ? text : 'Sent an attachment / media');

    if (typeof window === 'undefined' || !('Notification' in window)) return;

    if (Notification.permission === 'granted') {
      const title = `⚡ ${userName || 'Customer'} [${pageName || 'Facebook'}]`;
      const body = text && text.trim() ? text : 'Sent a photo, video, or attachment.';
      const iconUrl = typeof window !== 'undefined' ? `${window.location.origin}/favicon.svg` : undefined;

      const triggerNativeNotification = () => {
        try {
          const notification = new Notification(title, {
            body,
            icon: iconUrl,
            badge: iconUrl,
            tag: `fb-msg-${convId || 'chat'}-${Date.now()}`,
            requireInteraction: false,
            silent: false,
          });

          notification.onclick = () => {
            try {
              window.focus();
              if (convId && onOpenConversation) {
                onOpenConversation(convId);
              }
            } catch {}
            notification.close();
          };
        } catch (e) {
          console.warn('[Notification] Native Notification constructor fallback error:', e);
        }
      };

      // If ServiceWorker is active, use showNotification for guaranteed background OS delivery
      if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
        navigator.serviceWorker.ready
          .then((reg) => {
            return reg.showNotification(title, {
              body,
              icon: iconUrl,
              badge: iconUrl,
              tag: `fb-msg-${convId || 'chat'}-${Date.now()}`,
              data: { convId },
            });
          })
          .catch(() => {
            triggerNativeNotification();
          });
      } else {
        triggerNativeNotification();
      }
    } else if (Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {});
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
  const selectedConversationIdRef = useRef<string | null>(selectedConversationId);

  useEffect(() => {
    selectedConversationIdRef.current = selectedConversationId;
  }, [selectedConversationId]);

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

        // Pre-warm message cache for top conversations for 0ms instant click response
        convList.slice(0, 8).forEach((c) => {
          if (c.lastMessage && !messageCacheRef.current.has(c.id)) {
            messageCacheRef.current.set(c.id, [c.lastMessage]);
          }
          fetchConversationMessages(c.id)
            .then((data) => {
              if (isMounted && data?.messages) {
                messageCacheRef.current.set(c.id, deduplicateMessages(data.messages));
              }
            })
            .catch(() => {});
        });

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

    // 10s background sync when active (real-time is powered by Socket.IO)
    const interval = setInterval(() => {
      if (!document.hidden) {
        loadConversations();
        loadPages();
      }
    }, 10000);

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
      // Seed with lastMessage from conversation list if available (0ms instant display)
      const currentConv = conversations.find((c) => c.id === selectedConversationId);
      if (currentConv?.lastMessage) {
        setMessages([currentConv.lastMessage]);
      } else {
        setMessages([]);
      }
      setLoadingMessages(true);
    }

    fetchConversationMessages(selectedConversationId)
      .then((data) => {
        if (isCurrent && data?.messages) {
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

  // Register ServiceWorker for background notifications
  useEffect(() => {
    if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch((err) => {
        console.warn('[SW] ServiceWorker registration notice:', err);
      });

      const handleSwMessage = (event: MessageEvent) => {
        if (event.data && event.data.type === 'OPEN_CONVERSATION' && event.data.convId) {
          setActiveTab('inbox');
          setSelectedConversationId(event.data.convId);
          selectedConversationIdRef.current = event.data.convId;
          setMobileView('chat');
        }
      };

      navigator.serviceWorker.addEventListener('message', handleSwMessage);
      return () => {
        navigator.serviceWorker.removeEventListener('message', handleSwMessage);
      };
    }
  }, []);

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
        const activeId = selectedConversationIdRef.current;
        const convId = conversation.id;
        const convPsid = conversation.psid;
        const msgConvId = message.conversationId;

        // 1. Sound, Desktop push & Floating HUD Toast for inbound messages
        if (message.direction === 'inbound') {
          playLoudNotificationChime();
          showBrowserNotification(
            conversation.userName || 'Customer',
            message.text,
            conversation.page?.name,
            convId,
            (targetConvId) => {
              setActiveTab('inbox');
              setSelectedConversationId(targetConvId);
              selectedConversationIdRef.current = targetConvId;
              setMobileView('chat');
            }
          );
          setHudToast({
            title: conversation.userName || 'Customer',
            body: message.text || 'Sent an attachment / media',
            pageName: conversation.page?.name,
            convId: convId,
          });
        }

        // 2. Update local message cache across all identifiers
        if (convId) {
          const cached = messageCacheRef.current.get(convId) || [];
          const updatedCache = deduplicateMessages([...cached, message]);
          messageCacheRef.current.set(convId, updatedCache);
        }
        if (convPsid) {
          const cached = messageCacheRef.current.get(convPsid) || [];
          const updatedCache = deduplicateMessages([...cached, message]);
          messageCacheRef.current.set(convPsid, updatedCache);
        }
        if (msgConvId && msgConvId !== convId) {
          const cached = messageCacheRef.current.get(msgConvId) || [];
          const updatedCache = deduplicateMessages([...cached, message]);
          messageCacheRef.current.set(msgConvId, updatedCache);
        }

        // 3. Match active chat by id, psid, or message conversationId
        const isCurrentActive =
          activeId &&
          (activeId === convId ||
            activeId === msgConvId ||
            activeId === convPsid ||
            conversations.some((c) => c.id === activeId && (c.psid === convPsid || c.id === convId)));

        if (isCurrentActive) {
          setMessages((prev) => deduplicateMessages([...prev, message]));
        }

        // 4. Update or insert conversation in sidebar list & move to top
        setConversations((prev) => {
          const index = prev.findIndex(
            (c) => c.id === convId || (convPsid && c.psid === convPsid) || (msgConvId && c.id === msgConvId)
          );
          const isCurrentlyOpen = activeId === convId || (activeId && prev[index]?.id === activeId);
          const existing = index >= 0 ? prev[index] : null;
          const updatedConv = {
            ...(existing || {}),
            ...conversation,
            lastMessage: message,
            lastMessageAt: message.createdAt,
            unread: isCurrentlyOpen ? false : message.direction === 'inbound' ? true : (existing?.unread ?? true),
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

        loadPages();
      },

      onNewReply: ({ message, conversationId }) => {
        // 1. Update message cache
        const cached = messageCacheRef.current.get(conversationId) || [];
        const updatedCache = deduplicateMessages([...cached, message]);
        messageCacheRef.current.set(conversationId, updatedCache);

        // 2. Update active chat messages in real time if open
        const activeId = selectedConversationIdRef.current;
        const isCurrentActive =
          activeId &&
          (activeId === conversationId ||
            conversations.some((c) => c.id === activeId && (c.id === conversationId || c.psid === conversationId)));

        if (isCurrentActive) {
          setMessages((prev) => deduplicateMessages([...prev, message]));
        }

        // 3. Update sidebar conversation lastMessage and timestamp
        setConversations((prev) => {
          const index = prev.findIndex((c) => c.id === conversationId || c.psid === conversationId);
          if (index >= 0) {
            const target = { ...prev[index], lastMessage: message, lastMessageAt: message.createdAt };
            const copy = [...prev];
            copy.splice(index, 1);
            return [target, ...copy];
          }
          return prev;
        });
      },

      onConversationUpdated: (updated) => {
        setConversations((prev) => {
          const index = prev.findIndex((c) => c.id === updated.id || (updated.psid && c.psid === updated.psid));
          if (index >= 0) {
            const copy = [...prev];
            copy[index] = { ...copy[index], ...updated };
            return copy;
          }
          return [updated, ...prev];
        });
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

  const handleSelectConversation = useCallback((id: string) => {
    setSelectedConversationId(id);
    selectedConversationIdRef.current = id;
    setMobileView('chat');

    // Instant local UI mark-as-read
    setConversations((prev) =>
      prev.map((c) => (c.id === id ? { ...c, unread: false } : c))
    );
  }, []);

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

  const handleSimulateTestInbound = async () => {
    try {
      await simulateTestInboundMessage('🔔 Test Incoming Message: Real-time notification & chat stream verified!', 'Test Customer (Live Meta)');
    } catch (err) {
      console.error('Failed to trigger test inbound message:', err);
    }
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
        onPlayLoudNotification={playLoudNotificationChime}
        onSimulateTestInbound={handleSimulateTestInbound}
        adminUser={adminUser}
        onLogout={handleLogout}
      />

      <NotificationBanner onPlayChime={playLoudNotificationChime} />

      {hudToast && (
        <ToastAlert
          title={hudToast.title}
          body={hudToast.body}
          pageName={hudToast.pageName}
          convId={hudToast.convId}
          onOpen={(targetId) => {
            setActiveTab('inbox');
            handleSelectConversation(targetId);
            setHudToast(null);
          }}
          onClose={() => setHudToast(null)}
        />
      )}

      <div className="main-content">
        {activeTab === 'inbox' && (
          <div className={`inbox-layout mobile-view-${mobileView}`}>
            <div className={`inbox-col-sidebar ${mobileView === 'chat' ? 'mobile-hidden' : ''}`}>
              <ConversationList
                conversations={conversations}
                selectedConversationId={selectedConversationId}
                onSelectConversation={handleSelectConversation}
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
