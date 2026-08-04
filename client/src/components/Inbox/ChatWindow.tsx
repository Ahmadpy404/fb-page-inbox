import React, { useState, useEffect, useRef } from 'react';
import { Send, Bot, BellOff, MessageSquare, Check, Sparkles } from 'lucide-react';
import { Conversation, Message } from '../../types';

interface ChatWindowProps {
  conversation: Conversation | null;
  messages: Message[];
  loading: boolean;
  onSendReply: (text: string) => Promise<void>;
  onToggleAutoReply: (enabled?: boolean) => Promise<void>;
  onMarkAsRead: () => Promise<void>;
}

function formatMessageTime(dateString: string): string {
  if (!dateString) return '';
  const date = new Date(dateString);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function getInitials(name?: string | null): string {
  if (!name) return 'FB';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

const QUICK_REPLIES = [
  'Hi there! How can we help you today?',
  'Thanks for reaching out! Let me check that for you.',
  'Our support team is looking into this.',
  'Have a wonderful day!',
];

export const ChatWindow: React.FC<ChatWindowProps> = ({
  conversation,
  messages,
  loading,
  onSendReply,
  onToggleAutoReply,
  onMarkAsRead,
}) => {
  const [inputText, setInputText] = useState('');
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Mark as read when conversation is opened
  useEffect(() => {
    if (conversation && conversation.unread) {
      onMarkAsRead();
    }
  }, [conversation?.id]);

  const handleSend = async () => {
    if (!inputText.trim() || sending) return;
    const textToSend = inputText.trim();
    setInputText('');
    setSending(true);

    // Keep focus immediately in textarea
    textareaRef.current?.focus();

    try {
      await onSendReply(textToSend);
    } catch (err) {
      console.error('Failed to send reply:', err);
      setInputText(textToSend);
    } finally {
      setSending(false);
      // Re-assert focus
      setTimeout(() => {
        textareaRef.current?.focus();
      }, 0);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  if (!conversation) {
    return (
      <main className="chat-window">
        <div className="empty-state" style={{ height: '100%' }}>
          <MessageSquare size={48} color="var(--accent-primary)" />
          <h3>No Conversation Selected</h3>
          <p>Select a Messenger conversation from the left sidebar to view message history and reply.</p>
        </div>
      </main>
    );
  }

  return (
    <main className="chat-window">
      {/* Header */}
      <header className="chat-header">
        <div className="chat-user-meta">
          <div className="avatar-wrapper" style={{ width: '40px', height: '40px', minWidth: '40px' }}>
            {conversation.userAvatarUrl ? (
              <img
                src={conversation.userAvatarUrl}
                alt={conversation.userName || 'User'}
                className="avatar-img"
              />
            ) : (
              <div className="avatar-placeholder">{getInitials(conversation.userName)}</div>
            )}
          </div>
          <div className="chat-user-details">
            <h2>{conversation.userName || `User ${conversation.psid.slice(-6)}`}</h2>
            <div className="psid-chip">PSID: {conversation.psid}</div>
          </div>
        </div>

        <div className="chat-controls">
          <button
            className={`toggle-bot-btn ${conversation.autoReplyEnabled ? 'active' : 'muted'}`}
            onClick={() => onToggleAutoReply()}
            title={
              conversation.autoReplyEnabled
                ? 'Auto-reply is active. Click to mute bot and take over manually.'
                : 'Auto-reply is muted. Click to re-enable bot for this user.'
            }
            id="btn-toggle-auto-reply"
          >
            {conversation.autoReplyEnabled ? (
              <>
                <Bot size={14} />
                <span>Auto-Reply Active</span>
              </>
            ) : (
              <>
                <BellOff size={14} />
                <span>Auto-Reply Muted</span>
              </>
            )}
          </button>
        </div>
      </header>

      {/* Messages Thread */}
      <div className="chat-messages-container" id="chat-messages-container">
        {loading && messages.length === 0 ? (
          <div className="empty-state">
            <p>Loading messages...</p>
          </div>
        ) : messages.length === 0 ? (
          <div className="empty-state">
            <p>No messages in this conversation yet.</p>
          </div>
        ) : (
          messages.map((msg) => {
            const isInbound = msg.direction === 'inbound';
            const isAuto = msg.direction === 'outbound_auto';
            const isManual = msg.direction === 'outbound_manual';

            return (
              <div
                key={msg.id}
                className={`message-row ${isInbound ? 'inbound' : 'outbound'} ${isAuto ? 'auto' : isManual ? 'manual' : ''}`}
                id={`msg-item-${msg.id}`}
              >
                <span className="message-sender-name">
                  {isInbound
                    ? conversation.userName || 'Customer'
                    : isAuto
                    ? '🤖 Auto-Reply Bot'
                    : 'Page Admin (You)'}
                </span>

                <div className="message-bubble">
                  {isAuto && (
                    <div className="auto-badge-indicator">
                      <Sparkles size={11} />
                      <span>Keyword Auto-Reply</span>
                    </div>
                  )}
                  <div>{msg.text}</div>
                </div>

                <div className="message-meta">
                  <span>{formatMessageTime(msg.createdAt)}</span>
                  {!isInbound && <Check size={12} color="var(--accent-success)" />}
                </div>
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Quick Replies Bar */}
      <div style={{ padding: '0 24px 8px', display: 'flex', gap: '8px', overflowX: 'auto' }}>
        {QUICK_REPLIES.map((quickText, idx) => (
          <button
            key={idx}
            className="filter-pill"
            style={{ whiteSpace: 'nowrap', fontSize: '11px' }}
            onClick={() => setInputText(quickText)}
          >
            {quickText}
          </button>
        ))}
      </div>

      {/* Input Bar */}
      <footer className="chat-input-bar">
        <div className="input-wrapper">
          <textarea
            ref={textareaRef}
            className="chat-textarea"
            placeholder={`Reply to ${conversation.userName || 'user'}... (Press Enter to send, Shift+Enter for new line)`}
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={1}
            id="input-chat-reply"
          />
          <button
            className="send-btn"
            onClick={handleSend}
            disabled={!inputText.trim() || sending}
            title="Send Message (Enter)"
            id="btn-send-reply"
          >
            <Send size={16} />
          </button>
        </div>
      </footer>
    </main>
  );
};
