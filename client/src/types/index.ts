export type MessageDirection = 'inbound' | 'outbound_manual' | 'outbound_auto';
export type MatchType = 'exact' | 'contains' | 'regex';

export interface AttachmentItem {
  type: 'image' | 'video' | 'audio' | 'file' | string;
  url: string;
  title?: string;
  name?: string;
}

export interface Message {
  id: string;
  conversationId: string;
  direction: MessageDirection;
  text: string;
  attachments?: string | null;
  createdAt: string;
  fbMessageId?: string | null;
}

export interface PageData {
  id: string;
  pageId: string;
  name: string;
  accessToken?: string;
  pictureUrl?: string | null;
  isActive: boolean;
  totalConversations?: number;
  unreadConversations?: number;
  createdAt?: string;
}

export interface Conversation {
  id: string;
  psid: string;
  userName?: string | null;
  userAvatarUrl?: string | null;
  lastMessageAt: string;
  autoReplyEnabled: boolean;
  unread: boolean;
  pageId?: string | null;
  page?: {
    id: string;
    name: string;
    pageId: string;
  } | null;
  createdAt: string;
  lastMessage?: Message | null;
}

export interface Rule {
  id: string;
  keyword: string;
  matchType: MatchType;
  replyText: string;
  priority: number;
  enabled: boolean;
  pageId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FacebookStatus {
  connected: boolean;
  pageId?: string;
  pageName?: string;
  pagePicture?: string;
  error?: string;
}

export interface SettingsData {
  globalAutoReply: boolean;
  facebookStatus: FacebookStatus;
  webhookConfig: {
    callbackPath: string;
    verifyTokenSet: boolean;
    appSecretSet: boolean;
    pageAccessTokenSet: boolean;
  };
}

export interface SyncStatus {
  inProgress: boolean;
  total?: number;
  synced?: number;
  message?: string;
}
