import React, { useState, useEffect, useRef } from 'react';
import { PageData, Conversation, BroadcastState } from '../../types';
import { startBroadcast, cancelBroadcast, fetchBroadcastStatus } from '../../services/api';

interface BulkBroadcastModalProps {
  isOpen: boolean;
  onClose: () => void;
  pages: PageData[];
  selectedPageId: string;
  conversations: Conversation[];
}

export const BulkBroadcastModal: React.FC<BulkBroadcastModalProps> = ({
  isOpen,
  onClose,
  pages,
  selectedPageId,
  conversations,
}) => {
  const [targetPageId, setTargetPageId] = useState<string>(selectedPageId || 'all');
  const [targetFilter, setTargetFilter] = useState<'all' | 'active_window' | 'custom'>('all');
  const [selectedConvIds, setSelectedConvIds] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [messageText, setMessageText] = useState(
    '🔥 Big weekend offer! Claim your exclusive bonus & $5 freeplay right now. Reply YES to get your redemption code!'
  );
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [filePreview, setFilePreview] = useState<string | null>(null);
  const [delaySec, setDelaySec] = useState<number>(1.2);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Broadcast Live State
  const [broadcastState, setBroadcastState] = useState<BroadcastState>({
    jobId: null,
    status: 'idle',
    total: 0,
    sent: 0,
    failed: 0,
    currentIndex: 0,
    currentRecipientName: null,
    startedAt: null,
    finishedAt: null,
    logs: [],
  });

  const fileInputRef = useRef<HTMLInputElement>(null);
  const pollIntervalRef = useRef<any>(null);

  // Filter available conversations based on targetPageId
  const availableConversations = conversations.filter((c) => {
    if (targetPageId !== 'all' && c.pageId && c.pageId !== targetPageId) return false;
    return true;
  });

  const searchedConversations = availableConversations.filter((c) => {
    if (!searchQuery) return true;
    const name = (c.userName || '').toLowerCase();
    const psid = (c.psid || '').toLowerCase();
    return name.includes(searchQuery.toLowerCase()) || psid.includes(searchQuery.toLowerCase());
  });

  // Calculate estimated audience count
  const estimatedAudienceCount = () => {
    if (targetFilter === 'custom') return selectedConvIds.length;
    if (targetFilter === 'active_window') {
      const twentyFourHoursAgo = Date.now() - 24 * 60 * 60 * 1000;
      return availableConversations.filter((c) => new Date(c.lastMessageAt).getTime() >= twentyFourHoursAgo).length;
    }
    return availableConversations.length;
  };

  // Poll status while open or running
  useEffect(() => {
    if (!isOpen) return;

    const checkStatus = async () => {
      try {
        const data = await fetchBroadcastStatus();
        if (data) setBroadcastState(data);
      } catch {}
    };

    checkStatus();
    pollIntervalRef.current = setInterval(checkStatus, 2000);

    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    };
  }, [isOpen]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setSelectedFile(file);
      const previewUrl = URL.createObjectURL(file);
      setFilePreview(previewUrl);
    }
  };

  const handleRemoveFile = () => {
    setSelectedFile(null);
    if (filePreview) URL.revokeObjectURL(filePreview);
    setFilePreview(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const insertVariable = (tag: string) => {
    setMessageText((prev) => prev + ` ${tag} `);
  };

  const handleSelectAll = () => {
    if (selectedConvIds.length === searchedConversations.length) {
      setSelectedConvIds([]);
    } else {
      setSelectedConvIds(searchedConversations.map((c) => c.id));
    }
  };

  const handleToggleConv = (id: string) => {
    setSelectedConvIds((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    );
  };

  const handleStartBroadcast = async () => {
    if (!messageText.trim() && !selectedFile) {
      setErrorMsg('Please enter a message or select an image to broadcast.');
      return;
    }

    if (targetFilter === 'custom' && selectedConvIds.length === 0) {
      setErrorMsg('Please select at least one contact for custom broadcast.');
      return;
    }

    try {
      setIsSubmitting(true);
      setErrorMsg(null);

      const formData = new FormData();
      if (targetPageId !== 'all') formData.append('pageId', targetPageId);
      formData.append('targetFilter', targetFilter);
      if (targetFilter === 'custom') {
        formData.append('conversationIds', JSON.stringify(selectedConvIds));
      }
      if (messageText.trim()) formData.append('text', messageText.trim());
      if (selectedFile) formData.append('media', selectedFile);
      formData.append('delayMs', String(Math.round(delaySec * 1000)));

      const res = await startBroadcast(formData);
      if (res.success && res.broadcast) {
        setBroadcastState(res.broadcast);
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to start broadcast');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancelBroadcast = async () => {
    try {
      await cancelBroadcast();
    } catch {}
  };

  if (!isOpen) return null;

  const isRunning = broadcastState.status === 'running';
  const progressPercent =
    broadcastState.total > 0
      ? Math.min(100, Math.round(((broadcastState.sent + broadcastState.failed) / broadcastState.total) * 100))
      : 0;

  return (
    <div className="broadcast-modal-overlay" onClick={onClose}>
      <div className="broadcast-modal-container" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="broadcast-modal-header">
          <div className="broadcast-header-left">
            <div className="broadcast-header-icon">📢</div>
            <div>
              <div className="broadcast-header-title-row">
                <h2 className="broadcast-title">Bulk Messenger Broadcast Studio</h2>
                <span className="broadcast-badge">Sequential Pacing</span>
              </div>
              <p className="broadcast-subtitle">
                Send personalized messages & photos one-by-one to customer leads with anti-ban rate limit protection.
              </p>
            </div>
          </div>
          <button onClick={onClose} className="broadcast-close-btn" title="Close">
            ✕
          </button>
        </div>

        {/* Modal Body: 2 Columns */}
        <div className="broadcast-modal-body">
          {/* Left Column: Composer & Target Settings */}
          <div className="broadcast-col-composer">
            {errorMsg && (
              <div className="broadcast-alert-error">
                <span>⚠️</span>
                <span>{errorMsg}</span>
              </div>
            )}

            {/* Target Page & Audience */}
            <div className="broadcast-card">
              <h3 className="broadcast-card-title">1. Target Audience</h3>
              <div className="broadcast-form-grid">
                <div className="broadcast-field-group">
                  <label className="broadcast-field-label">Facebook Page</label>
                  <select
                    value={targetPageId}
                    disabled={isRunning}
                    onChange={(e) => setTargetPageId(e.target.value)}
                    className="broadcast-select"
                  >
                    <option value="all">All Pages (Unified)</option>
                    {pages.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="broadcast-field-group">
                  <label className="broadcast-field-label">Audience Filter</label>
                  <select
                    value={targetFilter}
                    disabled={isRunning}
                    onChange={(e) => setTargetFilter(e.target.value as any)}
                    className="broadcast-select"
                  >
                    <option value="all">All Contacts ({availableConversations.length})</option>
                    <option value="active_window">Active 24h Window Only</option>
                    <option value="custom">Custom Pick ({selectedConvIds.length} selected)</option>
                  </select>
                </div>
              </div>

              {/* Custom selection checklist if active */}
              {targetFilter === 'custom' && (
                <div className="broadcast-custom-picker">
                  <div className="broadcast-picker-header">
                    <input
                      type="text"
                      placeholder="Search leads by name or ID..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="broadcast-picker-search"
                    />
                    <button onClick={handleSelectAll} className="broadcast-picker-action-btn">
                      {selectedConvIds.length === searchedConversations.length ? 'Deselect All' : 'Select All'}
                    </button>
                  </div>
                  <div className="broadcast-picker-list">
                    {searchedConversations.map((c) => (
                      <label key={c.id} className="broadcast-picker-item">
                        <input
                          type="checkbox"
                          checked={selectedConvIds.includes(c.id)}
                          onChange={() => handleToggleConv(c.id)}
                          className="broadcast-checkbox"
                        />
                        <span className="broadcast-picker-name">{c.userName || `User ${c.psid.slice(-4)}`}</span>
                        <span className="broadcast-picker-psid">PSID: {c.psid.slice(-6)}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              <div className="broadcast-audience-estimate">
                <span>🎯 Estimated Recipients:</span>
                <span className="broadcast-estimate-number">{estimatedAudienceCount()} Leads</span>
              </div>
            </div>

            {/* Message & Media Studio */}
            <div className="broadcast-card">
              <div className="broadcast-card-header-flex">
                <h3 className="broadcast-card-title">2. Message & Media</h3>
                <div className="broadcast-tag-buttons">
                  <span className="broadcast-tag-label">Insert:</span>
                  <button onClick={() => insertVariable('{first_name}')} className="broadcast-tag-btn">
                    {'{first_name}'}
                  </button>
                  <button onClick={() => insertVariable('{name}')} className="broadcast-tag-btn">
                    {'{name}'}
                  </button>
                </div>
              </div>

              <textarea
                rows={3}
                disabled={isRunning}
                value={messageText}
                onChange={(e) => setMessageText(e.target.value)}
                placeholder="Type your promotional or update message here..."
                className="broadcast-textarea"
              />

              {/* Photo/Image Upload */}
              <div className="broadcast-file-section">
                <input
                  type="file"
                  ref={fileInputRef}
                  disabled={isRunning}
                  accept="image/*"
                  onChange={handleFileChange}
                  style={{ display: 'none' }}
                />

                {!filePreview ? (
                  <button
                    type="button"
                    disabled={isRunning}
                    onClick={() => fileInputRef.current?.click()}
                    className="broadcast-upload-btn"
                  >
                    <span>📷</span>
                    <span>Attach Photo / Promo Flyer</span>
                  </button>
                ) : (
                  <div className="broadcast-file-preview-card">
                    <div className="broadcast-file-info">
                      <img src={filePreview} alt="Preview" className="broadcast-preview-thumb" />
                      <span className="broadcast-file-name">{selectedFile?.name}</span>
                    </div>
                    <button
                      type="button"
                      disabled={isRunning}
                      onClick={handleRemoveFile}
                      className="broadcast-file-remove-btn"
                    >
                      Remove
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Pacing & Action */}
            <div className="broadcast-card">
              <div className="broadcast-card-header-flex">
                <h3 className="broadcast-card-title">3. Anti-Ban Sequential Pacing</h3>
                <span className="broadcast-pacing-tag">{delaySec.toFixed(1)}s delay between leads</span>
              </div>
              <input
                type="range"
                min={0.8}
                max={4.0}
                step={0.2}
                disabled={isRunning}
                value={delaySec}
                onChange={(e) => setDelaySec(parseFloat(e.target.value))}
                className="broadcast-slider"
              />
              <p className="broadcast-slider-hint">
                Pacing messages one-by-one ensures 100% compliance with Meta rate limits and prevents page restrictions.
              </p>

              <div className="broadcast-action-row">
                {!isRunning ? (
                  <button
                    onClick={handleStartBroadcast}
                    disabled={isSubmitting || estimatedAudienceCount() === 0}
                    className="broadcast-submit-btn"
                  >
                    {isSubmitting ? 'Starting Engine...' : `🚀 Start Broadcast (${estimatedAudienceCount()} Leads)`}
                  </button>
                ) : (
                  <button onClick={handleCancelBroadcast} className="broadcast-abort-btn">
                    ⏹ Stop / Abort Broadcast
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Right Column: Live Broadcast Dashboard & Logs */}
          <div className="broadcast-col-monitor">
            <div className="broadcast-card broadcast-monitor-panel">
              <div className="broadcast-monitor-header">
                <h3 className="broadcast-card-title">Live Delivery Monitor</h3>
                <span className={`broadcast-status-badge status-${broadcastState.status}`}>
                  {broadcastState.status}
                </span>
              </div>

              {/* Progress Bar */}
              <div className="broadcast-progress-group">
                <div className="broadcast-progress-label">
                  <span>Overall Progress</span>
                  <span className="broadcast-progress-numbers">
                    {broadcastState.sent + broadcastState.failed} / {broadcastState.total} ({progressPercent}%)
                  </span>
                </div>
                <div className="broadcast-progress-track">
                  <div className="broadcast-progress-bar" style={{ width: `${progressPercent}%` }} />
                </div>
              </div>

              {/* Metrics Grid */}
              <div className="broadcast-stats-grid">
                <div className="broadcast-stat-box stat-total">
                  <div className="broadcast-stat-label">Total</div>
                  <div className="broadcast-stat-val">{broadcastState.total}</div>
                </div>
                <div className="broadcast-stat-box stat-delivered">
                  <div className="broadcast-stat-label">Delivered</div>
                  <div className="broadcast-stat-val">{broadcastState.sent}</div>
                </div>
                <div className="broadcast-stat-box stat-failed">
                  <div className="broadcast-stat-label">Failed</div>
                  <div className="broadcast-stat-val">{broadcastState.failed}</div>
                </div>
              </div>

              {/* Active Recipient Banner */}
              {isRunning && broadcastState.currentRecipientName && (
                <div className="broadcast-active-lead">
                  <span>⚡ Sending to:</span>
                  <span className="broadcast-active-name">{broadcastState.currentRecipientName}</span>
                </div>
              )}

              {/* Real-Time Log Feed */}
              <div className="broadcast-logs-container">
                <div className="broadcast-logs-label">Live Stream Logs:</div>
                <div className="broadcast-logs-feed">
                  {broadcastState.logs.length === 0 ? (
                    <div className="broadcast-logs-empty">
                      No broadcast activity yet. Click Start to begin sending.
                    </div>
                  ) : (
                    broadcastState.logs.map((log) => (
                      <div key={log.id} className={`broadcast-log-row log-status-${log.status}`}>
                        <div className="broadcast-log-lead">
                          <span>{log.status === 'success' ? '✅' : log.status === 'failed' ? '❌' : '⏳'}</span>
                          <span className="broadcast-log-name">{log.userName}</span>
                        </div>
                        <span className="broadcast-log-badge">
                          {log.status === 'failed' ? log.error?.slice(0, 25) || 'Failed' : log.status.toUpperCase()}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
