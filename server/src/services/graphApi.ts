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
    return getConfig().GRAPH_API_BASE_URL;
  }

  private get accessToken(): string {
    return getConfig().PAGE_ACCESS_TOKEN;
  }

  /**
   * Send a text message to a user via their Page-Scoped ID (PSID)
   */
  async sendMessage(psid: string, text: string): Promise<SendMessageResponse> {
    if (this.accessToken.startsWith('dev_') || this.accessToken.startsWith('test_')) {
      return {
        recipient_id: psid,
        message_id: `mid.mock.${Date.now()}`,
      };
    }

    const url = `${this.baseUrl}/me/messages?access_token=${encodeURIComponent(this.accessToken)}`;
    const payload = {
      recipient: { id: psid },
      message: { text },
      messaging_type: 'RESPONSE',
    };

    const response = await this.fetchFn(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
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
   * Fetch conversation list from Meta Graph API
   */
  async fetchConversationsList(limit: number = 25): Promise<any[]> {
    if (this.accessToken.startsWith('dev_') || this.accessToken.startsWith('test_')) {
      return [];
    }

    const strategies = [
      `${this.baseUrl}/me/conversations?limit=${limit}&access_token=${encodeURIComponent(this.accessToken)}`,
      `${this.baseUrl}/me/conversations?fields=id,link,updated_time&limit=${limit}&access_token=${encodeURIComponent(this.accessToken)}`,
      `${this.baseUrl}/me/conversations?platform=messenger&limit=${limit}&access_token=${encodeURIComponent(this.accessToken)}`,
    ];

    let lastErrorMsg = 'Failed to fetch conversations';

    for (const url of strategies) {
      try {
        const response = await this.fetchFn(url, { method: 'GET' });
        const data = (await response.json()) as any;

        if (response.ok && !data?.error && Array.isArray(data.data)) {
          return data.data;
        }

        if (data?.error?.message) {
          lastErrorMsg = data.error.message;
        }
      } catch (err: any) {
        lastErrorMsg = err.message || lastErrorMsg;
      }
    }

    throw new Error(`Meta Graph API Error: ${lastErrorMsg}`);
  }

  /**
   * Fetch participants and senders for a conversation
   */
  async fetchConversationDetails(conversationId: string): Promise<any> {
    if (this.accessToken.startsWith('dev_') || this.accessToken.startsWith('test_')) {
      return null;
    }

    try {
      const url = `${this.baseUrl}/${encodeURIComponent(conversationId)}?fields=participants,senders&access_token=${encodeURIComponent(this.accessToken)}`;
      const response = await this.fetchFn(url, { method: 'GET' });
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
   * Fetch messages for a specific conversation ID
   */
  async fetchConversationMessages(conversationId: string, limit: number = 25): Promise<any[]> {
    if (this.accessToken.startsWith('dev_') || this.accessToken.startsWith('test_')) {
      return [];
    }

    try {
      const url = `${this.baseUrl}/${encodeURIComponent(conversationId)}/messages?fields=id,message,from,to,created_time&limit=${limit}&access_token=${encodeURIComponent(this.accessToken)}`;
      const response = await this.fetchFn(url, { method: 'GET' });
      const data = (await response.json()) as any;

      if (response.ok && !data?.error && Array.isArray(data.data)) {
        return data.data;
      }
      return [];
    } catch {
      return [];
    }
  }

  /**
   * Legacy method for backward compatibility
   */
  async fetchConversations(limit: number = 25): Promise<GraphApiConversation[]> {
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
