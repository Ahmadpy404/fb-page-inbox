import React, { useState, useEffect, useRef } from 'react';
import {
  Send,
  Bot,
  BellOff,
  MessageSquare,
  Check,
  CheckCheck,
  Clock,
  Sparkles,
  Paperclip,
  Video as VideoIcon,
  X,
  Maximize2,
  Download,
  ChevronLeft,
} from 'lucide-react';
import { Conversation, Message, AttachmentItem } from '../../types';

interface ChatWindowProps {
  conversation: Conversation | null;
  messages: Message[];
  loading: boolean;
  onSendReply: (text?: string, mediaFile?: File) => Promise<void>;
  onToggleAutoReply: (enabled?: boolean) => Promise<void>;
  onMarkAsRead: () => Promise<void>;
  onBackToMobileList?: () => void;
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
  onBackToMobileList,
}) => {
  const [inputText, setInputText] = useState('');
  const [sending, setSending] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [filePreviewUrl, setFilePreviewUrl] = useState<string | null>(null);
  const [lightboxImage, setLightboxImage] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll to bottom when messages change or typing changes
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, filePreviewUrl, conversation?.isTyping]);

  // Mark as read and auto-focus when conversation is opened
  useEffect(() => {
    if (conversation) {
      if (conversation.unread) {
        onMarkAsRead();
      }
      setTimeout(() => {
        textareaRef.current?.focus();
      }, 50);
    }
  }, [conversation?.id]);

  // Handle selected file change
  useEffect(() => {
    if (!selectedFile) {
      setFilePreviewUrl(null);
      return;
    }

    const objectUrl = URL.createObjectURL(selectedFile);
    setFilePreviewUrl(objectUrl);

    return () => URL.revokeObjectURL(objectUrl);
  }, [selectedFile]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
    }
    // Reset input so re-selecting same file triggers change
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeSelectedFile = () => {
    setSelectedFile(null);
    setFilePreviewUrl(null);
  };

  const handleSend = async () => {
    if ((!inputText.trim() && !selectedFile) || sending) return;

    const textToSend = inputText.trim();
    const fileToSend = selectedFile;

    setInputText('');
    setSelectedFile(null);
    setFilePreviewUrl(null);
    setSending(true);

    // Maintain focus
    textareaRef.current?.focus();

    try {
      await onSendReply(textToSend || undefined, fileToSend || undefined);
    } catch (err) {
      console.error('Failed to send reply:', err);
      setInputText(textToSend);
      setSelectedFile(fileToSend);
    } finally {
      setSending(false);
      requestAnimationFrame(() => {
        textareaRef.current?.focus();
      });
      setTimeout(() => {
        textareaRef.current?.focus();
      }, 50);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Drag and drop handlers
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file && (file.type.startsWith('image/') || file.type.startsWith('video/'))) {
      setSelectedFile(file);
    }
  };

  // Parse attachments from message JSON
  const parseAttachments = (attachmentsStr?: string | null): AttachmentItem[] => {
    if (!attachmentsStr) return [];
    try {
      const parsed = JSON.parse(attachmentsStr);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
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

  // Compute 24-hour Meta Messaging Policy Window
  const lastInboundMsg = [...messages].reverse().find((m) => m.direction === 'inbound');
  const lastInboundTime = lastInboundMsg ? new Date(lastInboundMsg.createdAt).getTime() : 0;
  const nowTime = Date.now();
  const elapsedHours = lastInboundTime ? (nowTime - lastInboundTime) / (1000 * 60 * 60) : 999;
  const remainingHours = Math.max(0, 24 - elapsedHours);
  const isInside24h = elapsedHours <= 24;

  return (
    <main
      className={`chat-window ${isDragging ? 'drag-over' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Header */}
      <header className="chat-header">
        <div className="chat-user-meta">
          {/* Mobile Back to List button */}
          {onBackToMobileList && (
            <button
              type="button"
              className="mobile-back-btn"
              onClick={onBackToMobileList}
              title="Back to conversation list"
            >
              <ChevronLeft size={20} />
              <span>Chats</span>
            </button>
          )}

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
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <h2>{conversation.userName || `User ${conversation.psid.slice(-6)}`}</h2>
              {conversation.page?.name && (
                <span className="page-context-tag">{conversation.page.name}</span>
              )}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginTop: '2px' }}>
              <div className="psid-chip">
                PSID: {conversation.psid}
                {conversation.isTyping && (
                  <span className="active-typing-pill"> • typing...</span>
                )}
              </div>

              {/* 24-Hour Policy Window Live Indicator */}
              {lastInboundTime > 0 && (
                <div
                  className="psid-chip"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                    fontSize: '11px',
                    fontWeight: 600,
                    background: isInside24h
                      ? remainingHours > 4
                        ? 'rgba(16, 185, 129, 0.15)'
                        : 'rgba(245, 158, 11, 0.2)'
                      : 'rgba(244, 63, 94, 0.15)',
                    color: isInside24h
                      ? remainingHours > 4
                        ? '#34d399'
                        : '#fbbf24'
                      : '#f87171',
                    border: isInside24h
                      ? remainingHours > 4
                        ? '1px solid rgba(16, 185, 129, 0.3)'
                        : '1px solid rgba(245, 158, 11, 0.4)'
                      : '1px solid rgba(244, 63, 94, 0.3)',
                  }}
                  title={
                    isInside24h
                      ? `Customer replied ${elapsedHours.toFixed(1)}h ago. Window active for ~${remainingHours.toFixed(1)}h more.`
                      : 'Meta 24h window has passed. Customer must message or reply to reopen standard messaging.'
                  }
                >
                  <Clock size={11} />
                  <span>
                    {isInside24h
                      ? `${remainingHours.toFixed(0)}h Window Active`
                      : '24h Window Expired'}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="chat-controls">
          <button
            className={`toggle-bot-btn ${conversation.autoReplyEnabled ? 'active' : 'muted'}`}
            onClick={() => onToggleAutoReply()}
            title={
              conversation.autoReplyEnabled
                ? 'Auto-reply active. Tap to mute bot and take over manually.'
                : 'Auto-reply muted. Tap to re-enable bot for this user.'
            }
            id="btn-toggle-auto-reply"
          >
            {conversation.autoReplyEnabled ? (
              <>
                <Bot size={15} />
                <span className="btn-label-desktop">Auto-Reply Active</span>
                <span className="btn-label-mobile">Bot Active</span>
              </>
            ) : (
              <>
                <BellOff size={15} />
                <span className="btn-label-desktop">Auto-Reply Muted</span>
                <span className="btn-label-mobile">Bot Muted</span>
              </>
            )}
          </button>
        </div>
      </header>

      {/* Messages Thread */}
      <div className="chat-messages-container" id="chat-messages-container">
        {loading && messages.length === 0 ? (
          <div className="skeleton-chat-container">
            <div className="skeleton-bubble-row inbound">
              <div className="skeleton-bubble shimmer" style={{ width: '65%', height: '48px' }} />
            </div>
            <div className="skeleton-bubble-row outbound">
              <div className="skeleton-bubble shimmer" style={{ width: '45%', height: '36px' }} />
            </div>
            <div className="skeleton-bubble-row inbound">
              <div className="skeleton-bubble shimmer" style={{ width: '75%', height: '54px' }} />
            </div>
            <div className="skeleton-bubble-row outbound">
              <div className="skeleton-bubble shimmer" style={{ width: '50%', height: '40px' }} />
            </div>
          </div>
        ) : messages.length === 0 ? (
          <div className="empty-state">
            <p>No messages in this conversation yet.</p>
          </div>
        ) : (
          <>
            {messages.map((msg) => {
              const isInbound = msg.direction === 'inbound';
              const isAuto = msg.direction === 'outbound_auto';
              const isManual = msg.direction === 'outbound_manual';
              const attachments = parseAttachments(msg.attachments);
              const isPending = msg.isPending === true;
              const msgTime = new Date(msg.createdAt).getTime();
              const isSeen = !isInbound && Boolean(conversation.readWatermark && msgTime <= conversation.readWatermark);

              return (
                <div
                  key={msg.id}
                  className={`message-row ${isInbound ? 'inbound' : 'outbound'} ${isAuto ? 'auto' : isManual ? 'manual' : ''} ${isPending ? 'pending-msg' : ''}`}
                  id={`msg-item-${msg.id}`}
                >
                  <span className="message-sender-name">
                    {isInbound
                      ? conversation.userName || 'Customer'
                      : isAuto
                      ? '🤖 Auto-Reply Bot'
                      : 'Page Admin (You)'}
                  </span>

                  <div className={`message-bubble ${isPending ? 'pending' : ''}`}>
                    {isAuto && (
                      <div className="auto-badge-indicator">
                        <Sparkles size={11} />
                        <span>Keyword Auto-Reply</span>
                      </div>
                    )}

                    {/* Render media attachments if present */}
                    {attachments.map((att, idx) => {
                      const isVideo = att.type === 'video' || att.url?.match(/\.(mp4|mov|webm)$/i);
                      const isImage = att.type === 'image' || att.url?.match(/\.(jpg|jpeg|png|gif|webp)$/i);

                      if (isVideo) {
                        return (
                          <div key={idx} className="media-attachment-container video-box">
                            <video controls className="chat-media-video" src={att.url} preload="metadata" />
                          </div>
                        );
                      }

                      if (isImage || att.url) {
                        return (
                          <div
                            key={idx}
                            className="media-attachment-container image-box"
                            onClick={() => setLightboxImage(att.url)}
                            title="Click to view full size"
                          >
                            <img src={att.url} alt={att.title || 'Attachment'} className="chat-media-image" />
                            <div className="image-zoom-overlay">
                              <Maximize2 size={16} />
                            </div>
                          </div>
                        );
                      }

                      return null;
                    })}

                    {/* Message text */}
                    {msg.text && (
                      <div className="message-text-content">{msg.text}</div>
                    )}
                  </div>

                  <div className="message-meta">
                    <span>{formatMessageTime(msg.createdAt)}</span>
                    {!isInbound && (
                      <>
                        {isPending ? (
                          <span className="pending-status" title="Sending...">
                            <Clock size={11} className="spin-slow" />
                          </span>
                        ) : isSeen ? (
                          <span className="seen-receipt" title="Seen by customer">
                            <CheckCheck size={13} color="var(--accent-primary)" />
                            <span className="seen-text">Seen</span>
                          </span>
                        ) : (
                          <span title="Sent">
                            <Check size={12} color="var(--accent-success)" />
                          </span>
                        )}
                      </>
                    )}
                  </div>
                </div>
              );
            })}

            {/* Live Typing Indicator Animation */}
            {conversation.isTyping && (
              <div className="message-row inbound typing-row">
                <span className="message-sender-name">
                  {conversation.userName || 'Customer'}
                </span>
                <div className="message-bubble typing-bubble">
                  <div className="typing-dots">
                    <span className="dot dot-1" />
                    <span className="dot dot-2" />
                    <span className="dot dot-3" />
                  </div>
                  <span className="typing-text">typing...</span>
                </div>
              </div>
            )}
          </>
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

      {/* Staged File Preview */}
      {selectedFile && filePreviewUrl && (
        <div className="staged-media-bar">
          <div className="staged-media-preview">
            {selectedFile.type.startsWith('video/') ? (
              <div className="media-thumbnail-box video">
                <VideoIcon size={20} color="#fff" />
              </div>
            ) : (
              <img src={filePreviewUrl} alt="Preview" className="media-thumbnail-img" />
            )}
            <div className="staged-file-meta">
              <span className="file-name">{selectedFile.name}</span>
              <span className="file-size">{(selectedFile.size / (1024 * 1024)).toFixed(2)} MB</span>
            </div>
          </div>
          <button className="icon-btn remove-media-btn" onClick={removeSelectedFile} title="Remove attachment">
            <X size={16} />
          </button>
        </div>
      )}

      {/* Input Bar */}
      <footer className="chat-input-bar">
        {/* Hidden file input */}
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleFileSelect}
          accept="image/*,video/*"
          style={{ display: 'none' }}
          id="file-attachment-input"
        />

        <div className="input-wrapper">
          <button
            type="button"
            className="attach-btn"
            onClick={() => fileInputRef.current?.click()}
            title="Attach Photo or Video"
            id="btn-attach-media"
          >
            <Paperclip size={18} />
          </button>

          <textarea
            ref={textareaRef}
            className="chat-textarea"
            placeholder={
              selectedFile
                ? 'Add an optional message or press Enter to send media...'
                : `Reply to ${conversation.userName || 'user'}... (Press Enter to send)`
            }
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={1}
            id="input-chat-reply"
          />

          <button
            className="send-btn"
            onClick={handleSend}
            disabled={(!inputText.trim() && !selectedFile) || sending}
            title="Send Message (Enter)"
            id="btn-send-reply"
          >
            <Send size={16} />
          </button>
        </div>
      </footer>

      {/* Full-Screen Image Lightbox */}
      {lightboxImage && (
        <div className="lightbox-overlay" onClick={() => setLightboxImage(null)}>
          <div className="lightbox-content" onClick={(e) => e.stopPropagation()}>
            <img src={lightboxImage} alt="Full Size Preview" className="lightbox-img" />
            <div className="lightbox-actions">
              <a
                href={lightboxImage}
                target="_blank"
                rel="noreferrer"
                download
                className="lightbox-action-btn"
                title="Download original"
              >
                <Download size={16} />
                <span>Open / Download</span>
              </a>
              <button
                className="lightbox-action-btn close"
                onClick={() => setLightboxImage(null)}
                title="Close"
              >
                <X size={16} />
                <span>Close</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
};
