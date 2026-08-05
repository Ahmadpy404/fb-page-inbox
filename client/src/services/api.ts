import { Conversation, Message, Rule, SettingsData, MatchType, PageData } from '../types';

const API_BASE = '/api';
const TOKEN_KEY = 'fb_inbox_jwt_token';

/**
 * Token management
 */
export function getAuthToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setAuthToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearAuthToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

/**
 * Custom fetch wrapper that injects Bearer JWT authentication header
 */
async function authFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const token = getAuthToken();
  const headers = new Headers(options.headers || {});

  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const res = await fetch(url, { ...options, headers });

  if (res.status === 401 && !url.includes('/auth/login') && !url.includes('/auth/setup')) {
    clearAuthToken();
    window.dispatchEvent(new Event('auth:unauthorized'));
  }

  return res;
}

// -------------------------------------------------------------
// Authentication APIs
// -------------------------------------------------------------

export async function getAuthStatus(): Promise<{ isConfigured: boolean; defaultUsername: string }> {
  const res = await fetch(`${API_BASE}/auth/setup-status`);
  if (!res.ok) throw new Error('Failed to get auth setup status');
  return res.json();
}

export async function setupAdminPassword(password: string, confirmPassword: string): Promise<{ success: boolean; token: string; user: any }> {
  const res = await fetch(`${API_BASE}/auth/setup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password, confirmPassword }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Failed to setup password');
  }
  if (data.token) {
    setAuthToken(data.token);
  }
  return data;
}

export async function login(username: string, password: string, rememberMe: boolean = true): Promise<{ success: boolean; token: string; user: any }> {
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password, rememberMe }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Invalid credentials');
  }
  if (data.token) {
    setAuthToken(data.token);
  }
  return data;
}

export async function verifySession(): Promise<{ authenticated: boolean; user?: any }> {
  const token = getAuthToken();
  if (!token) return { authenticated: false };

  try {
    const res = await authFetch(`${API_BASE}/auth/me`);
    if (!res.ok) return { authenticated: false };
    return res.json();
  } catch {
    return { authenticated: false };
  }
}

export async function logout(): Promise<void> {
  try {
    await authFetch(`${API_BASE}/auth/logout`, { method: 'POST' });
  } finally {
    clearAuthToken();
  }
}

// -------------------------------------------------------------
// Conversation & Message APIs
// -------------------------------------------------------------

export async function fetchConversations(search?: string, pageId?: string): Promise<Conversation[]> {
  const params = new URLSearchParams();
  if (search) params.append('search', search);
  if (pageId && pageId !== 'all') params.append('pageId', pageId);

  const qs = params.toString() ? `?${params.toString()}` : '';
  const res = await authFetch(`${API_BASE}/conversations${qs}`);
  if (!res.ok) throw new Error('Failed to fetch conversations');
  const data = await res.json();
  return data.conversations || [];
}

export async function fetchConversationMessages(
  conversationId: string
): Promise<{ conversation: Conversation; messages: Message[] }> {
  const res = await authFetch(`${API_BASE}/conversations/${conversationId}/messages`);
  if (!res.ok) throw new Error('Failed to fetch messages');
  return res.json();
}

export async function sendReply(
  conversationId: string,
  text?: string,
  mediaFile?: File
): Promise<{ message: Message; conversation: Conversation }> {
  let res: Response;

  if (mediaFile) {
    const formData = new FormData();
    if (text) formData.append('text', text);
    formData.append('media', mediaFile);

    res = await authFetch(`${API_BASE}/conversations/${conversationId}/reply`, {
      method: 'POST',
      body: formData,
    });
  } else {
    res = await authFetch(`${API_BASE}/conversations/${conversationId}/reply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Failed to send reply' }));
    throw new Error(err.error || 'Failed to send reply');
  }
  return res.json();
}

export async function toggleConversationAutoReply(
  conversationId: string,
  enabled?: boolean
): Promise<{ conversation: Conversation }> {
  const res = await authFetch(`${API_BASE}/conversations/${conversationId}/auto-reply`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled }),
  });
  if (!res.ok) throw new Error('Failed to toggle auto-reply');
  return res.json();
}

export async function markConversationAsRead(conversationId: string): Promise<{ conversation: Conversation }> {
  const res = await authFetch(`${API_BASE}/conversations/${conversationId}/read`, {
    method: 'POST',
  });
  if (!res.ok) throw new Error('Failed to mark conversation as read');
  return res.json();
}

export async function triggerSync(pageId?: string): Promise<{ success: boolean; conversationsSynced: number; messagesSynced: number }> {
  const res = await authFetch(`${API_BASE}/conversations/sync`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pageId }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Failed to sync' }));
    throw new Error(err.error || 'Failed to sync conversations');
  }
  return res.json();
}

// -------------------------------------------------------------
// Pages APIs & Persistent Vault Sync
// -------------------------------------------------------------

export async function fetchPages(): Promise<PageData[]> {
  const res = await authFetch(`${API_BASE}/pages`);
  if (!res.ok) throw new Error('Failed to fetch pages');
  return res.json();
}

export async function addPage(token: string, name?: string, pageId?: string): Promise<{ success: boolean; page: PageData }> {
  const res = await authFetch(`${API_BASE}/pages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, name, pageId }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Failed to add page' }));
    throw new Error(err.error || 'Failed to add page');
  }
  return res.json();
}

export async function updatePage(id: string, updates: Partial<{ name: string; isActive: boolean; accessToken: string }>): Promise<{ success: boolean; page: PageData }> {
  const res = await authFetch(`${API_BASE}/pages/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });
  if (!res.ok) throw new Error('Failed to update page');
  return res.json();
}

export async function deletePage(id: string): Promise<void> {
  const res = await authFetch(`${API_BASE}/pages/${id}`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Failed to delete page' }));
    throw new Error(err.error || 'Failed to delete page');
  }
}

export async function syncPagesVault(pages: Array<{ pageId: string; name?: string; token: string }>): Promise<{ success: boolean; restoredCount: number }> {
  const res = await authFetch(`${API_BASE}/pages/sync-vault`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pages }),
  });
  if (!res.ok) return { success: false, restoredCount: 0 };
  return res.json();
}

// -------------------------------------------------------------
// Rules APIs
// -------------------------------------------------------------

export async function fetchRules(): Promise<Rule[]> {
  const res = await authFetch(`${API_BASE}/rules`);
  if (!res.ok) throw new Error('Failed to fetch rules');
  const data = await res.json();
  return data.rules || [];
}

export async function createRule(rule: {
  keyword: string;
  matchType: MatchType;
  replyText: string;
  priority?: number;
  enabled?: boolean;
}): Promise<Rule> {
  const res = await authFetch(`${API_BASE}/rules`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(rule),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Failed to create rule' }));
    throw new Error(err.error || 'Failed to create rule');
  }
  const data = await res.json();
  return data.rule;
}

export async function updateRule(
  id: string,
  updates: Partial<{
    keyword: string;
    matchType: MatchType;
    replyText: string;
    priority: number;
    enabled: boolean;
  }>
): Promise<Rule> {
  const res = await authFetch(`${API_BASE}/rules/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Failed to update rule' }));
    throw new Error(err.error || 'Failed to update rule');
  }
  const data = await res.json();
  return data.rule;
}

export async function deleteRule(id: string): Promise<void> {
  const res = await authFetch(`${API_BASE}/rules/${id}`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new Error('Failed to delete rule');
}

export async function reorderRules(ruleIds: string[]): Promise<Rule[]> {
  const res = await authFetch(`${API_BASE}/rules/reorder`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ruleIds }),
  });
  if (!res.ok) throw new Error('Failed to reorder rules');
  const data = await res.json();
  return data.rules;
}

// -------------------------------------------------------------
// Settings APIs
// -------------------------------------------------------------

export async function fetchSettings(): Promise<SettingsData> {
  const res = await authFetch(`${API_BASE}/settings`);
  if (!res.ok) throw new Error('Failed to fetch settings');
  return res.json();
}

export async function updateGlobalAutoReply(enabled: boolean): Promise<boolean> {
  const res = await authFetch(`${API_BASE}/settings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ globalAutoReply: enabled }),
  });
  if (!res.ok) throw new Error('Failed to update settings');
  const data = await res.json();
  return data.globalAutoReply;
}

export async function verifyFacebookConnection(): Promise<{ connected: boolean; pageName?: string; error?: string; webhookSubscribed?: boolean; webhookMessage?: string }> {
  const res = await authFetch(`${API_BASE}/settings/verify-connection`);
  const data = await res.json();
  return data;
}

export async function subscribeWebhook(): Promise<{ success: boolean; message: string }> {
  const res = await authFetch(`${API_BASE}/settings/subscribe-webhook`, { method: 'POST' });
  const data = await res.json();
  return data;
}
