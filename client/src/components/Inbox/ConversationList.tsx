import React, { useState, useMemo } from 'react';
import { Search, Bot, BellOff, MessageSquareOff } from 'lucide-react';
import { Conversation } from '../../types';

interface ConversationListProps {
  conversations: Conversation[];
  selectedConversationId: string | null;
  onSelectConversation: (id: string) => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
}

function formatRelativeTime(dateString: string): string {
  if (!dateString) return '';
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m`;
  if (diffHours < 24) return `${diffHours}h`;
  if (diffDays < 7) return `${diffDays}d`;
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function getInitials(name?: string | null): string {
  if (!name) return 'FB';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

interface ConversationItemProps {
  conv: Conversation;
  isSelected: boolean;
  onSelect: (id: string) => void;
}

const ConversationItem = React.memo<ConversationItemProps>(({ conv, isSelected, onSelect }) => {
  const snippetPrefix =
    conv.lastMessage?.direction === 'outbound_manual'
      ? 'You: '
      : conv.lastMessage?.direction === 'outbound_auto'
      ? '🤖: '
      : '';

  return (
    <div
      className={`conversation-item ${isSelected ? 'active' : ''} ${conv.unread ? 'unread' : ''}`}
      onClick={() => onSelect(conv.id)}
      id={`conv-item-${conv.id}`}
    >
      <div className="avatar-wrapper">
        {conv.userAvatarUrl ? (
          <img src={conv.userAvatarUrl} alt={conv.userName || 'User'} className="avatar-img" loading="lazy" />
        ) : (
          <div className="avatar-placeholder">{getInitials(conv.userName)}</div>
        )}
        {conv.unread && <div className="unread-badge-dot" />}
      </div>

      <div className="conversation-info">
        <div className="conversation-title-row">
          <span className="conversation-name">{conv.userName || `User ${conv.psid.slice(-6)}`}</span>
          <span className="conversation-time">{formatRelativeTime(conv.lastMessageAt)}</span>
        </div>

        <div className="conversation-snippet-row">
          <span className="conversation-snippet">
            {conv.lastMessage ? `${snippetPrefix}${conv.lastMessage.text}` : 'No messages yet'}
          </span>

          {conv.autoReplyEnabled ? (
            <span className="bot-tag active" title="Auto-reply enabled for this conversation">
              <Bot size={10} />
              Auto
            </span>
          ) : (
            <span className="bot-tag muted" title="Auto-reply muted by admin">
              <BellOff size={10} />
              Muted
            </span>
          )}
        </div>
      </div>
    </div>
  );
});

export const ConversationList: React.FC<ConversationListProps> = ({
  conversations,
  selectedConversationId,
  onSelectConversation,
  searchQuery,
  onSearchChange,
}) => {
  const [filter, setFilter] = useState<'all' | 'unread' | 'bot_active' | 'bot_muted'>('all');

  const filteredConversations = useMemo(() => {
    return conversations.filter((c) => {
      // Search query filter
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesName = (c.userName || '').toLowerCase().includes(q);
        const matchesPsid = c.psid.toLowerCase().includes(q);
        const matchesSnippet = (c.lastMessage?.text || '').toLowerCase().includes(q);
        if (!matchesName && !matchesPsid && !matchesSnippet) {
          return false;
        }
      }

      // Tab filter
      if (filter === 'unread') return c.unread;
      if (filter === 'bot_active') return c.autoReplyEnabled;
      if (filter === 'bot_muted') return !c.autoReplyEnabled;
      return true;
    });
  }, [conversations, searchQuery, filter]);

  return (
    <aside className="conversation-sidebar">
      <div className="sidebar-header">
        <div className="search-box">
          <Search size={16} color="var(--text-muted)" />
          <input
            type="text"
            className="search-input"
            placeholder="Search conversations, names, PSID..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            id="input-search-conversations"
          />
        </div>

        <div className="filter-pills">
          <button
            className={`filter-pill ${filter === 'all' ? 'active' : ''}`}
            onClick={() => setFilter('all')}
          >
            All ({conversations.length})
          </button>
          <button
            className={`filter-pill ${filter === 'unread' ? 'active' : ''}`}
            onClick={() => setFilter('unread')}
          >
            Unread ({conversations.filter((c) => c.unread).length})
          </button>
          <button
            className={`filter-pill ${filter === 'bot_active' ? 'active' : ''}`}
            onClick={() => setFilter('bot_active')}
          >
            Bot Active
          </button>
          <button
            className={`filter-pill ${filter === 'bot_muted' ? 'active' : ''}`}
            onClick={() => setFilter('bot_muted')}
          >
            Muted
          </button>
        </div>
      </div>

      <div className="conversation-list">
        {filteredConversations.length === 0 ? (
          <div className="empty-state">
            <MessageSquareOff size={32} />
            <h3>No conversations found</h3>
            <p>
              {searchQuery
                ? 'Try matching a different keyword or name.'
                : 'Incoming messages from your Facebook Page will appear here live.'}
            </p>
          </div>
        ) : (
          filteredConversations.map((conv) => (
            <ConversationItem
              key={conv.id}
              conv={conv}
              isSelected={conv.id === selectedConversationId}
              onSelect={onSelectConversation}
            />
          ))
        )}
      </div>
    </aside>
  );
};
