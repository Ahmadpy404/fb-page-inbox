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

  getAppSecretProof(token?: string): string | undefined {
    try {
      const secret = (getConfig().APP_SECRET || '').trim();
      const t = (token || this.accessToken || '').trim();
      if (secret && t && !t.startsWith('dev_') && !t.startsWith('test_')) {
        return crypto.createHmac('sha256', secret).update(t).digest('hex');
      }
    } catch {}
    return undefined;
  }

  /**
   * Send a text message to a user via their Page-Scoped ID (PSID).
   * Automatically falls back to HUMAN_AGENT message tag if standard 24-hr window has passed.
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
    const standardPayload = {
      recipient: { id: psid },
      message: { text },
      messaging_type: 'RESPONSE',
    };

    let response = await this.fetchFn(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'FBPageUnifiedInbox/1.0',
      },
      body: JSON.stringify(standardPayload),
    });

    let data = (await response.json()) as any;

    // If 24-hour window or policy error occurs, retry with HUMAN_AGENT message tag (extends window to 7 days)
    if (!response.ok || data?.error) {
      const errorMsg = String(data?.error?.message || '');
      const errorCode = data?.error?.code;
      const subcode = data?.error?.error_subcode;

      const isPolicyOrWindowError =
        errorCode === 10 ||
        errorCode === 2018001 ||
        subcode === 2018001 ||
        errorMsg.toLowerCase().includes('24-hour') ||
        errorMsg.toLowerCase().includes('message tag') ||
        errorMsg.toLowerCase().includes('window') ||
        errorMsg.toLowerCase().includes('recipient is not eligible');

      if (isPolicyOrWindowError) {
        console.warn(`[GraphApi] Standard RESPONSE failed for PSID ${psid} (${errorMsg}), retrying with HUMAN_AGENT tag...`);
        const tagPayload = {
          recipient: { id: psid },
          message: { text },
          messaging_type: 'MESSAGE_TAG',
          tag: 'HUMAN_AGENT',
        };

        const tagResponse = await this.fetchFn(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'FBPageUnifiedInbox/1.0',
          },
          body: JSON.stringify(tagPayload),
        });

        const tagData = (await tagResponse.json()) as any;
        if (tagResponse.ok && !tagData?.error) {
          console.log(`[GraphApi] Message successfully delivered to ${psid} using HUMAN_AGENT tag.`);
          return tagData as SendMessageResponse;
        } else {
          console.warn(`[GraphApi] HUMAN_AGENT retry also failed:`, tagData?.error?.message || tagResponse.statusText);
        }
      }

      throw new Error(`Meta Graph API Error (${response.status}): ${errorMsg || 'Failed to send message'}`);
    }

    return data as SendMessageResponse;
  }

  /**
   * Send a media attachment (photo / video) to a user via PSID.
   * Automatically falls back to HUMAN_AGENT message tag if standard 24-hr window has passed.
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

      let response = await this.fetchFn(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'FBPageUnifiedInbox/1.0',
        },
        body: JSON.stringify(payload),
      });

      let data = (await response.json()) as any;
      if (!response.ok || data?.error) {
        // Retry with HUMAN_AGENT tag
        const tagPayload = {
          ...payload,
          messaging_type: 'MESSAGE_TAG',
          tag: 'HUMAN_AGENT',
        };
        const tagResponse = await this.fetchFn(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'FBPageUnifiedInbox/1.0',
          },
          body: JSON.stringify(tagPayload),
        });
        const tagData = (await tagResponse.json()) as any;
        if (tagResponse.ok && !tagData?.error) {
          return tagData as SendMessageResponse;
        }
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

    let response = await this.fetchFn(url, {
      method: 'POST',
      headers: {
        'User-Agent': 'FBPageUnifiedInbox/1.0',
      },
      body: formData as any,
    });

    let data = (await response.json()) as any;
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

      const response = await this.fetchFn(url, {
        method: 'GET',
        signal: AbortSignal.timeout(3500),
      });
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
  /**
   * Fetch ALL conversations from Meta Graph API using recursive cursor pagination.
   * Supports incremental/delta syncing via optional `since` parameter (Unix seconds).
   */
  async fetchAllConversations(
    pageId?: string,
    customToken?: string,
    maxConversations: number = 3000,
    since?: number
  ): Promise<any[]> {
    const token = (customToken || this.accessToken || '').trim();
    if (!token || token.startsWith('dev_') || token.startsWith('test_')) {
      return [];
    }

    const proof = this.getAppSecretProof(token);
    const proofParam = proof ? `&appsecret_proof=${proof}` : '';
    const sinceParam = since && since > 0 ? `&since=${since}` : '';

    // Use clean, lightweight fields so Meta does not reject with 500 'reduce data' error
    const fields = 'id,snippet,updated_time,link,participants,unread_count';
    const targets = pageId && pageId !== 'me' ? [pageId, 'me'] : ['me'];

    for (const target of targets) {
      // Try with proof first (if available), then without proof if signature mismatch occurs
      const proofAttempts = proofParam ? [proofParam, ''] : [''];

      for (const pOption of proofAttempts) {
        let currentUrl: string | null = `${this.baseUrl}/${target}/conversations?fields=${encodeURIComponent(fields)}&limit=100&access_token=${encodeURIComponent(token)}${sinceParam}${pOption}`;
        const allConversations: any[] = [];
        const seenIds = new Set<string>();
        let pageCount = 0;
        let hadError = false;

        while (currentUrl && allConversations.length < maxConversations && pageCount < 60) {
          pageCount++;
          try {
            console.log(`[GraphApi] Fetching conversations page ${pageCount} for target=${target}${since ? ` (since ${since})` : ''}...`);
            const response = await this.fetchFn(currentUrl, {
              method: 'GET',
              headers: { 'User-Agent': 'FBPageUnifiedInbox/1.0' },
            });

            const data = (await response.json()) as any;
            if (!response.ok || data?.error) {
              console.warn(
                `[GraphApi] Conversation fetch error for target=${target} (status ${response.status}):`,
                data?.error?.message || response.statusText
              );
              hadError = true;
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

            // Next cursor link
            if (data.paging && data.paging.next && allConversations.length < maxConversations) {
              currentUrl = data.paging.next;
            } else {
              currentUrl = null;
            }
          } catch (err: any) {
            console.warn('[GraphApi] Network error fetching conversations:', err.message || err);
            hadError = true;
            break;
          }
        }

        if (!hadError || allConversations.length > 0) {
          console.log(`[GraphApi] Successfully retrieved ${allConversations.length} conversation(s) from Meta Graph API for target=${target}.`);
          return allConversations;
        }
      }
    }

    return [];
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
    const token = (customToken || this.accessToken || '').trim();
    if (!token || token.startsWith('dev_') || token.startsWith('test_')) {
      return null;
    }

    const proof = this.getAppSecretProof(token);
    const proofParam = proof ? `&appsecret_proof=${proof}` : '';

    const proofAttempts = proofParam ? [proofParam, ''] : [''];
    for (const pOption of proofAttempts) {
      try {
        const url = `${this.baseUrl}/${encodeURIComponent(conversationId)}?fields=participants,senders&access_token=${encodeURIComponent(token)}${pOption}`;
        const response = await this.fetchFn(url, {
          method: 'GET',
          headers: { 'User-Agent': 'FBPageUnifiedInbox/1.0' },
          signal: AbortSignal.timeout(5000),
        });
        const data = (await response.json()) as any;
        if (response.ok && !data?.error) {
          return data;
        }
      } catch {
        // continue
      }
    }
    return null;
  }

  /**
   * Fetch ALL messages for a specific conversation ID using cursor pagination.
   */
  async fetchAllConversationMessages(
    conversationId: string,
    customToken?: string,
    maxMessages: number = 300,
    since?: number
  ): Promise<any[]> {
    const token = (customToken || this.accessToken || '').trim();
    if (!token || token.startsWith('dev_') || token.startsWith('test_')) {
      return [];
    }

    const proof = this.getAppSecretProof(token);
    const proofParam = proof ? `&appsecret_proof=${proof}` : '';
    const sinceParam = since && since > 0 ? `&since=${since}` : '';

    const proofAttempts = proofParam ? [proofParam, ''] : [''];
    for (const pOption of proofAttempts) {
      let currentUrl: string | null = `${this.baseUrl}/${encodeURIComponent(conversationId)}/messages?fields=id,message,from,to,created_time,attachments{mime_type,name,size,image_data,video_data,file_url}&limit=50&access_token=${encodeURIComponent(token)}${sinceParam}${pOption}`;

      const allMessages: any[] = [];
      const seenIds = new Set<string>();
      let pageCount = 0;
      let hadError = false;

      while (currentUrl && allMessages.length < maxMessages && pageCount < 10) {
        pageCount++;
        try {
          const response = await this.fetchFn(currentUrl, {
            method: 'GET',
            headers: { 'User-Agent': 'FBPageUnifiedInbox/1.0' },
            signal: AbortSignal.timeout(5000),
          });
          const data = (await response.json()) as any;

          if (!response.ok || data?.error) {
            hadError = true;
            break;
          }

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
          hadError = true;
          break;
        }
      }

      if (!hadError || allMessages.length > 0) {
        return allMessages;
      }
    }

    return [];
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
