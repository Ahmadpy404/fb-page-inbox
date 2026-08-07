import { io, Socket } from 'socket.io-client';
import { Message, Conversation, SyncStatus } from '../types';

import { getAuthToken } from './api';

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) {
    const serverUrl = window.location.port === '5173' ? `http://${window.location.hostname}:3000` : '/';
    socket = io(serverUrl, {
      transports: ['websocket', 'polling'],
      autoConnect: true,
      auth: {
        token: getAuthToken(),
      },
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
    });

    socket.on('connect', () => {
      console.log('[Socket.IO] Connected to backend server, id:', socket?.id);
    });

    socket.on('disconnect', (reason) => {
      console.log('[Socket.IO] Disconnected:', reason);
    });

    socket.on('connect_error', (err) => {
      console.warn('[Socket.IO] Connection error:', err.message);
    });
  }

  return socket;
}

export function refreshSocketAuth(): void {
  if (socket) {
    (socket.auth as any) = { token: getAuthToken() };
    if (socket.connected) {
      socket.disconnect().connect();
    }
  }
}

export function subscribeToRealtimeEvents(handlers: {
  onNewMessage?: (payload: { message: Message; conversation: Conversation }) => void;
  onNewReply?: (payload: { message: Message; conversationId: string }) => void;
  onConversationUpdated?: (conversation: Conversation) => void;
  onSyncStatus?: (status: SyncStatus) => void;
  onMessageRead?: (payload: { conversationId: string; watermark: number; readAt: string }) => void;
  onTypingStatus?: (payload: { conversationId: string; isTyping: boolean }) => void;
}) {
  const s = getSocket();

  if (handlers.onNewMessage) {
    s.on('new_message', handlers.onNewMessage);
    s.on('message:new', handlers.onNewMessage);
  }
  if (handlers.onNewReply) {
    s.on('new_reply', handlers.onNewReply);
    s.on('reply:new', handlers.onNewReply);
  }
  if (handlers.onConversationUpdated) {
    s.on('conversation_updated', handlers.onConversationUpdated);
    s.on('conversation:updated', handlers.onConversationUpdated);
  }
  if (handlers.onSyncStatus) {
    s.on('sync_status', handlers.onSyncStatus);
    s.on('sync:status', handlers.onSyncStatus);
  }
  if (handlers.onMessageRead) {
    s.on('message_read', handlers.onMessageRead);
    s.on('message:read', handlers.onMessageRead);
  }
  if (handlers.onTypingStatus) {
    s.on('typing_status', handlers.onTypingStatus);
    s.on('typing:status', handlers.onTypingStatus);
  }

  return () => {
    if (handlers.onNewMessage) {
      s.off('new_message', handlers.onNewMessage);
      s.off('message:new', handlers.onNewMessage);
    }
    if (handlers.onNewReply) {
      s.off('new_reply', handlers.onNewReply);
      s.off('reply:new', handlers.onNewReply);
    }
    if (handlers.onConversationUpdated) {
      s.off('conversation_updated', handlers.onConversationUpdated);
      s.off('conversation:updated', handlers.onConversationUpdated);
    }
    if (handlers.onSyncStatus) {
      s.off('sync_status', handlers.onSyncStatus);
      s.off('sync:status', handlers.onSyncStatus);
    }
    if (handlers.onMessageRead) {
      s.off('message_read', handlers.onMessageRead);
      s.off('message:read', handlers.onMessageRead);
    }
    if (handlers.onTypingStatus) {
      s.off('typing_status', handlers.onTypingStatus);
      s.off('typing:status', handlers.onTypingStatus);
    }
  };
}
