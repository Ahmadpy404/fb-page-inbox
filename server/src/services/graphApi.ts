import * as crypto from 'crypto';
import { getConfig } from '../config';

export interface SendMessageResponse {
  recipient_id: string;
  message_id: string;
}

export interface UserProfileResponse {
  id: string;
  first_name?: string;
  last_name?: string;
  profile_pic?: string;
  name?: string;
}

export interface PageDetailsResponse {
  id: string;
  name: string;
  picture?: {
    data?: {
      url?: string;
    };
  };
}

export interface GraphApiConversationMessage {
  id: string;
  message?: string;
  from?: {
    id: string;
    name?: string;
    email?: string;
  };
  to?: {
    data?: Array<{
      id: string;
      name?: string;
      email?: string;
    }>;
  };
  created_time: string;
}

export interface GraphApiConversation {
  id: string;
  updated_time: string;
  participants?: {
    data?: Array<{
      id: string;
      name?: string;
      email?: string;
    }>;
  };
  messages?: {
    data?: GraphApiConversationMessage[];
    paging?: {
      cursors?: {
        before?: string;
        after?: string;
      };
      next?: string;
    };
  };
}

export class GraphApiClient {
  private customFetch?: typeof fetch;

  constructor(customFetch?: typeof fetch) {
    this.customFetch = customFetch;
  }

  private get fetchFn(): typeof fetch {
    return this.customFetch || globalThis.fetch;
  }

  private get baseUrl(): string {
    return getConfig().GRAPH_API_BASE_URL.replace(/\/+$/, '');
  }

  private get accessToken(): string {
    return (getConfig().PAGE_ACCESS_TOKEN || '').trim();
  }

  private get appSecretProof(): string | undefined {
    try {
      const secret = (getConfig().APP_SECRET || '').trim();
      const token = this.accessToken;
      if (secret && token && !token.startsWith('dev_') && !token.startsWith('test_')) {
        return crypto.createHmac('sha256', secret).update(token).digest('hex');
      }
    } catch {}
    return undefined;
  }

  /**
   * Send a text message to a user via their Page-Scoped ID (PSID)
   */
  async sendMessage(psid: string, text: string, customToken?: string): Promise<SendMessageResponse> {
    const token = customToken || this.accessToken;
    if (token.startsWith('dev_') || token.startsWith('test_')) {
      return {
        recipient_id: psid,
        message_id: `mid.mock.${Date.now()}`,
      };
    }

    const url = `${this.baseUrl}/me/messages?access_token=${encodeURIComponent(token)}`;
    const payload = {
      recipient: { id: psid },
      message: { text },
      messaging_type: 'RESPONSE',
    };

    const response = await this.fetchFn(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'FBPageUnifiedInbox/1.0',
      },
      body: JSON.stringify(payload),
    });

    const data = (await response.json()) as any;

    if (!response.ok || data?.error) {
      const errorMsg = data?.error?.message || response.statusText || 'Failed to send message';
      throw new Error(`Meta Graph API Error (${response.status}): ${errorMsg}`);
    }

    return data as SendMessageResponse;
  }

  /**
   * Send a media attachment (photo / video) to a user via PSID
   */
  async sendMediaAttachment(
    psid: string,
    attachmentType: 'image' | 'video' | 'audio' | 'file',
    mediaUrlOrBuffer: string | Buffer,
    filename: string = 'media',
    mimeType: string = 'image/jpeg',
    customToken?: string
  ): Promise<SendMessageResponse> {
    const token = customToken || this.accessToken;
    if (token.startsWith('dev_') || token.startsWith('test_')) {
      return {
        recipient_id: psid,
        message_id: `mid.mock.${Date.now()}`,
      };
    }

    const url = `${this.baseUrl}/me/messages?access_token=${encodeURIComponent(token)}`;

    // 1. If mediaUrl is a string URL
    if (typeof mediaUrlOrBuffer === 'string') {
      const payload = {
        recipient: { id: psid },
        message: {
          attachment: {
            type: attachmentType,
            payload: {
              url: mediaUrlOrBuffer,
              is_reusable: true,
            },
          },
        },
        messaging_type: 'RESPONSE',
      };

      const response = await this.fetchFn(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'FBPageUnifiedInbox/1.0',
        },
        body: JSON.stringify(payload),
      });

      const data = (await response.json()) as any;
      if (!response.ok || data?.error) {
        throw new Error(`Meta Graph API Error (${response.status}): ${data?.error?.message || 'Failed to send media'}`);
      }
      return data as SendMessageResponse;
    }

    // 2. Binary buffer upload using FormData
    const formData = new FormData();
    formData.append('recipient', JSON.stringify({ id: psid }));
    formData.append(
      'message',
      JSON.stringify({
        attachment: {
          type: attachmentType,
          payload: { is_reusable: true },
        },
      })
    );
    formData.append('messaging_type', 'RESPONSE');

    const blob = new Blob([mediaUrlOrBuffer], { type: mimeType });
    formData.append('filedata', blob, filename);

    const response = await this.fetchFn(url, {
      method: 'POST',
      headers: {
        'User-Agent': 'FBPageUnifiedInbox/1.0',
      },
      body: formData as any,
    });

    const data = (await response.json()) as any;
    if (!response.ok || data?.error) {
      throw new Error(`Meta Graph API Error (${response.status}): ${data?.error?.message || 'Failed to upload and send media'}`);
    }

    return data as SendMessageResponse;
  }

  /**
   * Fetch user profile (first_name, last_name, profile_pic) for a PSID
   */
  async getUserProfile(psid: string): Promise<UserProfileResponse | null> {
    if (this.accessToken.startsWith('dev_') || this.accessToken.startsWith('test_')) {
      return {
        id: psid,
        name: `Customer ${psid.slice(-4)}`,
        first_name: 'Customer',
        last_name: psid.slice(-4),
      };
    }

    try {
      const fields = 'first_name,last_name,name,profile_pic';
      const url = `${this.baseUrl}/${encodeURIComponent(psid)}?fields=${fields}&access_token=${encodeURIComponent(this.accessToken)}`;

      const response = await this.fetchFn(url, { method: 'GET' });
      const data = (await response.json()) as any;

      if (!response.ok || data?.error) {
        // PSID lookup may fail if permissions are restricted or test account without profile access
        console.warn(`[GraphApi] Could not fetch profile for PSID ${psid}:`, data?.error?.message || response.statusText);
        return null;
      }

      const name = data.name || (data.first_name ? `${data.first_name} ${data.last_name || ''}`.trim() : undefined);

      return {
        id: data.id || psid,
        first_name: data.first_name,
        last_name: data.last_name,
        name,
        profile_pic: data.profile_pic,
      };
    } catch (err) {
      console.warn(`[GraphApi] Network error fetching profile for ${psid}:`, err);
      return null;
    }
  }

  /**
   * Verify token & retrieve Facebook Page details
   */
  async getPageDetails(): Promise<PageDetailsResponse> {
    if (this.accessToken.startsWith('dev_') || this.accessToken.startsWith('test_')) {
      return {
        id: '123456789012345',
        name: 'Demo Facebook Business Page',
      };
    }

    try {
      // 1. Try fetching with picture
      const fields = 'id,name,picture';
      const url = `${this.baseUrl}/me?fields=${fields}&access_token=${encodeURIComponent(this.accessToken)}`;

      const response = await this.fetchFn(url, { method: 'GET' });
      const data = (await response.json()) as any;

      if (response.ok && !data?.error) {
        return data as PageDetailsResponse;
      }

      // 2. Fallback: Try with just id,name if picture requires extra review/permissions
      const fallbackUrl = `${this.baseUrl}/me?fields=id,name&access_token=${encodeURIComponent(this.accessToken)}`;
      const fallbackRes = await this.fetchFn(fallbackUrl, { method: 'GET' });
      const fallbackData = (await fallbackRes.json()) as any;

      if (fallbackRes.ok && !fallbackData?.error) {
        return fallbackData as PageDetailsResponse;
      }

      // 3. Fallback: Try /me directly
      const minUrl = `${this.baseUrl}/me?access_token=${encodeURIComponent(this.accessToken)}`;
      const minRes = await this.fetchFn(minUrl, { method: 'GET' });
      const minData = (await minRes.json()) as any;

      if (minRes.ok && !minData?.error) {
        return minData as PageDetailsResponse;
      }

      const errorMsg = data?.error?.message || fallbackData?.error?.message || minData?.error?.message || 'Failed to verify token';
      throw new Error(`Meta Graph API Error (${response.status}): ${errorMsg}`);
    } catch (err: any) {
      throw new Error(err.message || 'Failed to verify Facebook token');
    }
  }

  /**
   * Fetch ALL conversations from Meta Graph API using recursive cursor pagination.
   * Continues through data.paging.next until all chats are retrieved (up to maxConversations).
   */
  async fetchAllConversations(
    pageId?: string,
    customToken?: string,
    maxConversations: number = 2000
  ): Promise<any[]> {
    const token = customToken || this.accessToken;
    if (token.startsWith('dev_') || token.startsWith('test_')) {
      return [];
    }

    const proof = this.appSecretProof ? `&appsecret_proof=${this.appSecretProof}` : '';
    const target = pageId && pageId !== 'me' ? pageId : 'me';
    let currentUrl: string | null = `${this.baseUrl}/${target}/conversations?fields=id,snippet,updated_time,link&limit=50&access_token=${encodeURIComponent(token)}${proof}`;

    const allConversations: any[] = [];
    const seenIds = new Set<string>();
    let pageCount = 0;

    while (currentUrl && allConversations.length < maxConversations && pageCount < 40) {
      pageCount++;
      try {
        const response = await this.fetchFn(currentUrl, {
          method: 'GET',
          headers: { 'User-Agent': 'FBPageUnifiedInbox/1.0' },
        });

        const data = (await response.json()) as any;
        if (!response.ok || data?.error) {
          console.warn('[GraphApi] Pagination error:', data?.error?.message || response.statusText);
          break;
        }

        if (Array.isArray(data.data) && data.data.length > 0) {
          for (const item of data.data) {
            if (item.id && !seenIds.has(item.id)) {
              seenIds.add(item.id);
              allConversations.push(item);
            }
          }
        } else {
          break;
        }

        // Check next page URL
        if (data.paging && data.paging.next && allConversations.length < maxConversations) {
          currentUrl = data.paging.next;
        } else {
          currentUrl = null;
        }
      } catch (err: any) {
        console.warn('[GraphApi] Network error during pagination:', err.message || err);
        break;
      }
    }

    return allConversations;
  }

  /**
   * Fetch conversation list (single page or fallback)
   */
  async fetchConversationsList(limit: number = 50, pageId?: string, customToken?: string): Promise<any[]> {
    return this.fetchAllConversations(pageId, customToken, limit);
  }

  /**
   * Fetch participants and senders for a conversation
   */
  async fetchConversationDetails(conversationId: string, customToken?: string): Promise<any> {
    const token = customToken || this.accessToken;
    if (token.startsWith('dev_') || token.startsWith('test_')) {
      return null;
    }

    const proof = this.appSecretProof ? `&appsecret_proof=${this.appSecretProof}` : '';
    try {
      const url = `${this.baseUrl}/${encodeURIComponent(conversationId)}?fields=participants,senders&access_token=${encodeURIComponent(token)}${proof}`;
      const response = await this.fetchFn(url, {
        method: 'GET',
        headers: { 'User-Agent': 'FBPageUnifiedInbox/1.0' },
      });
      const data = (await response.json()) as any;
      if (response.ok && !data?.error) {
        return data;
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Fetch ALL messages for a specific conversation ID using cursor pagination.
   */
  async fetchAllConversationMessages(
    conversationId: string,
    customToken?: string,
    maxMessages: number = 200
  ): Promise<any[]> {
    const token = customToken || this.accessToken;
    if (token.startsWith('dev_') || token.startsWith('test_')) {
      return [];
    }

    const proof = this.appSecretProof ? `&appsecret_proof=${this.appSecretProof}` : '';
    let currentUrl: string | null = `${this.baseUrl}/${encodeURIComponent(conversationId)}/messages?fields=id,message,from,to,created_time,attachments{mime_type,name,size,image_data,video_data,file_url}&limit=50&access_token=${encodeURIComponent(token)}${proof}`;

    const allMessages: any[] = [];
    const seenIds = new Set<string>();
    let pageCount = 0;

    while (currentUrl && allMessages.length < maxMessages && pageCount < 10) {
      pageCount++;
      try {
        const response = await this.fetchFn(currentUrl, {
          method: 'GET',
          headers: { 'User-Agent': 'FBPageUnifiedInbox/1.0' },
        });
        const data = (await response.json()) as any;

        if (!response.ok || data?.error) break;

        if (Array.isArray(data.data) && data.data.length > 0) {
          for (const msg of data.data) {
            if (msg.id && !seenIds.has(msg.id)) {
              seenIds.add(msg.id);
              allMessages.push(msg);
            }
          }
        } else {
          break;
        }

        if (data.paging && data.paging.next && allMessages.length < maxMessages) {
          currentUrl = data.paging.next;
        } else {
          currentUrl = null;
        }
      } catch {
        break;
      }
    }

    return allMessages;
  }

  /**
   * Fetch messages for a specific conversation ID (single page limit)
   */
  async fetchConversationMessages(conversationId: string, limit: number = 50, customToken?: string): Promise<any[]> {
    return this.fetchAllConversationMessages(conversationId, customToken, limit);
  }

  /**
   * Legacy method for backward compatibility
   */
  async fetchConversations(limit: number = 50): Promise<GraphApiConversation[]> {
    return this.fetchConversationsList(limit);
  }

  /**
   * Subscribes the Facebook Page to this app's Webhooks via Graph API
   */
  async subscribePageToWebhook(): Promise<{ success: boolean; message: string }> {
    if (this.accessToken.startsWith('dev_') || this.accessToken.startsWith('test_')) {
      return { success: true, message: 'Mock page webhook subscription successful.' };
    }

    try {
      const url = `${this.baseUrl}/me/subscribed_apps?subscribed_fields=messages,messaging_postbacks,message_echoes,message_reactions,message_reads&access_token=${encodeURIComponent(this.accessToken)}`;
      const response = await this.fetchFn(url, { method: 'POST' });
      const data = (await response.json()) as any;

      if (!response.ok || data?.error) {
        const errorMsg = data?.error?.message || response.statusText || 'Failed to subscribe page';
        console.warn('[GraphApi] Page webhook subscription response:', errorMsg);
        return { success: false, message: errorMsg };
      }

      console.log('[GraphApi] Page successfully subscribed to webhooks via Graph API:', data);
      return { success: true, message: 'Page subscribed to webhooks successfully!' };
    } catch (err: any) {
      console.warn('[GraphApi] Network error during page subscription:', err);
      return { success: false, message: err.message || 'Subscription failed' };
    }
  }
}

export const graphApiClient = new GraphApiClient();
