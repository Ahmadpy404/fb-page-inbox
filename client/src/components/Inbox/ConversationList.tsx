import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { Search, Bot, BellOff, MessageSquareOff, ChevronDown } from 'lucide-react';
import { Conversation } from '../../types';

interface ConversationListProps {
  conversations: Conversation[];
  selectedConversationId: string | null;
  onSelectConversation: (id: string) => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
}

const INITIAL_PAGE_SIZE = 40;
const PAGE_INCREMENT = 40;

function formatRelativeTime(dateString?: string): string {
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

const ConversationItem = React.memo<ConversationItemProps>(
  ({ conv, isSelected, onSelect }) => {
    const snippetPrefix =
      conv.lastMessage?.direction === 'outbound_manual'
        ? 'You: '
        : conv.lastMessage?.direction === 'outbound_auto'
        ? '🤖: '
        : '';

    const handleClick = useCallback(() => {
      onSelect(conv.id);
    }, [conv.id, onSelect]);

    const formattedTime = useMemo(
      () => formatRelativeTime(conv.lastMessageAt),
      [conv.lastMessageAt]
    );

    const displayName = conv.userName || `User ${conv.psid.slice(-6)}`;
    const initials = useMemo(() => getInitials(conv.userName), [conv.userName]);

    return (
      <div
        className={`conversation-item ${isSelected ? 'active' : ''} ${conv.unread ? 'unread' : ''}`}
        onClick={handleClick}
        id={`conv-item-${conv.id}`}
        style={{ contentVisibility: 'auto', containIntrinsicSize: '68px' }}
      >
        <div className="avatar-wrapper">
          {conv.userAvatarUrl ? (
            <img
              src={conv.userAvatarUrl}
              alt={displayName}
              className="avatar-img"
              loading="lazy"
            />
          ) : (
            <div className="avatar-placeholder">{initials}</div>
          )}
          {conv.unread && <div className="unread-badge-dot" />}
        </div>

        <div className="conversation-info">
          <div className="conversation-title-row">
            <span className="conversation-name">{displayName}</span>
            <span className="conversation-time">{formattedTime}</span>
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
  },
  (prev, next) => {
    return (
      prev.isSelected === next.isSelected &&
      prev.conv.id === next.conv.id &&
      prev.conv.unread === next.conv.unread &&
      prev.conv.lastMessageAt === next.conv.lastMessageAt &&
      prev.conv.userName === next.conv.userName &&
      prev.conv.userAvatarUrl === next.conv.userAvatarUrl &&
      prev.conv.autoReplyEnabled === next.conv.autoReplyEnabled &&
      prev.conv.lastMessage?.text === next.conv.lastMessage?.text &&
      prev.conv.lastMessage?.direction === next.conv.lastMessage?.direction &&
      prev.onSelect === next.onSelect
    );
  }
);

ConversationItem.displayName = 'ConversationItem';

export const ConversationList: React.FC<ConversationListProps> = ({
  conversations,
  selectedConversationId,
  onSelectConversation,
  searchQuery,
  onSearchChange,
}) => {
  const [filter, setFilter] = useState<'all' | 'unread' | 'bot_active' | 'bot_muted'>('all');
  const [visibleCount, setVisibleCount] = useState(INITIAL_PAGE_SIZE);
  const listContainerRef = useRef<HTMLDivElement>(null);

  // Filter conversations
  const filteredConversations = useMemo(() => {
    const trimmed = searchQuery.trim().toLowerCase();
    return conversations.filter((c) => {
      // Search query filter
      if (trimmed) {
        const matchesName = (c.userName || '').toLowerCase().includes(trimmed);
        const matchesPsid = c.psid.toLowerCase().includes(trimmed);
        const matchesSnippet = (c.lastMessage?.text || '').toLowerCase().includes(trimmed);
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

  // Reset pagination on filter / search change
  useEffect(() => {
    setVisibleCount(INITIAL_PAGE_SIZE);
    if (listContainerRef.current) {
      listContainerRef.current.scrollTop = 0;
    }
  }, [searchQuery, filter]);

  // Handle progressive scroll to load more
  const handleScroll = useCallback(() => {
    if (!listContainerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = listContainerRef.current;
    if (scrollTop + clientHeight >= scrollHeight - 150) {
      setVisibleCount((prev) => Math.min(prev + PAGE_INCREMENT, filteredConversations.length));
    }
  }, [filteredConversations.length]);

  const visibleConversations = useMemo(() => {
    return filteredConversations.slice(0, visibleCount);
  }, [filteredConversations, visibleCount]);

  const unreadCount = useMemo(
    () => conversations.filter((c) => c.unread).length,
    [conversations]
  );

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
            Unread ({unreadCount})
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

      <div
        className="conversation-list"
        ref={listContainerRef}
        onScroll={handleScroll}
        id="conversation-scroll-container"
      >
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
          <>
            {visibleConversations.map((conv) => (
              <ConversationItem
                key={conv.id}
                conv={conv}
                isSelected={conv.id === selectedConversationId}
                onSelect={onSelectConversation}
              />
            ))}

            {visibleCount < filteredConversations.length && (
              <div
                className="load-more-indicator"
                onClick={() => setVisibleCount((prev) => prev + PAGE_INCREMENT)}
                style={{
                  padding: '12px',
                  textAlign: 'center',
                  color: 'var(--accent-primary)',
                  fontSize: '0.8rem',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '4px',
                }}
              >
                <span>Showing {visibleCount} of {filteredConversations.length} leads</span>
                <ChevronDown size={14} />
              </div>
            )}
          </>
        )}
      </div>
    </aside>
  );
};
