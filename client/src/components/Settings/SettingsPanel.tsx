import React, { useState, useEffect } from 'react';
import {
  Bot,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Copy,
  Check,
  ExternalLink,
  ShieldCheck,
  Volume2,
  Bell,
  Globe,
  Plus,
  Trash2,
  Clock,
  Sparkles,
  Zap,
  Flame,
  Save,
} from 'lucide-react';
import { SettingsData, SyncStatus, PageData } from '../../types';

interface SettingsPanelProps {
  settings: SettingsData | null;
  syncStatus?: SyncStatus;
  pages: PageData[];
  onUpdateGlobalAutoReply: (enabled: boolean) => Promise<void>;
  onUpdateFollowUpSettings?: (updates: {
    followUpEnabled?: boolean;
    followUpHours?: number;
    followUpTemplate?: string;
  }) => Promise<void>;
  onTriggerFollowUpNow?: () => Promise<{ success: boolean; sentCount: number; message: string }>;
  onVerifyConnection: () => Promise<void>;
  onTriggerSync: (forceFullSync?: boolean) => Promise<void>;
  onOpenAddModal: () => void;
  onDeletePage: (id: string) => Promise<void>;
  onPlayLoudNotification: () => void;
}

export const SettingsPanel: React.FC<SettingsPanelProps> = ({
  settings,
  syncStatus,
  pages,
  onUpdateGlobalAutoReply,
  onUpdateFollowUpSettings,
  onTriggerFollowUpNow,
  onVerifyConnection,
  onTriggerSync,
  onOpenAddModal,
  onDeletePage,
  onPlayLoudNotification,
}) => {
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [triggeringFollowUp, setTriggeringFollowUp] = useState(false);
  const [followUpTriggerResult, setFollowUpTriggerResult] = useState<string | null>(null);
  const [followUpSaving, setFollowUpSaving] = useState(false);
  const [followUpSaveSuccess, setFollowUpSaveSuccess] = useState(false);

  // Local follow-up editable state
  const [followUpEnabled, setFollowUpEnabled] = useState(
    settings?.followUpConfig?.enabled ?? true
  );
  const [followUpHours, setFollowUpHours] = useState(
    settings?.followUpConfig?.triggerHours ?? 21
  );
  const [followUpTemplate, setFollowUpTemplate] = useState(
    settings?.followUpConfig?.templateText ??
      '🔥 Quick reminder: Your exclusive bonus & $5 freeplay is reserved for just a few more hours! Reply "YES" or message us here to claim it before time runs out. 🎁'
  );

  useEffect(() => {
    if (settings?.followUpConfig) {
      setFollowUpEnabled(settings.followUpConfig.enabled);
      setFollowUpHours(settings.followUpConfig.triggerHours);
      setFollowUpTemplate(settings.followUpConfig.templateText);
    }
  }, [settings?.followUpConfig]);

  const handleSaveFollowUp = async () => {
    if (!onUpdateFollowUpSettings) return;
    setFollowUpSaving(true);
    setFollowUpSaveSuccess(false);
    try {
      await onUpdateFollowUpSettings({
        followUpEnabled,
        followUpHours: Number(followUpHours),
        followUpTemplate,
      });
      setFollowUpSaveSuccess(true);
      setTimeout(() => setFollowUpSaveSuccess(false), 3000);
    } catch (err: any) {
      alert(`Failed to save follow-up settings: ${err.message || err}`);
    } finally {
      setFollowUpSaving(false);
    }
  };

  const handleTriggerFollowUpScan = async () => {
    if (!onTriggerFollowUpNow) return;
    setTriggeringFollowUp(true);
    setFollowUpTriggerResult(null);
    try {
      const res = await onTriggerFollowUpNow();
      setFollowUpTriggerResult(res.message || `Scanned! Sent ${res.sentCount} follow-ups.`);
      setTimeout(() => setFollowUpTriggerResult(null), 5000);
    } catch (err: any) {
      setFollowUpTriggerResult(`Scan failed: ${err.message || err}`);
    } finally {
      setTriggeringFollowUp(false);
    }
  };
  const [notificationStatus, setNotificationStatus] = useState<string>(
    typeof window !== 'undefined' && 'Notification' in window ? Notification.permission : 'unsupported'
  );

  const copyToClipboard = (text: string, fieldId: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(fieldId);
    setTimeout(() => setCopiedField(null), 2000);
  };

  const handleVerify = async () => {
    setVerifying(true);
    try {
      await onVerifyConnection();
    } finally {
      setVerifying(false);
    }
  };

  const requestNotificationPermission = async () => {
    if ('Notification' in window) {
      const permission = await Notification.requestPermission();
      setNotificationStatus(permission);
      if (permission === 'granted') {
        new Notification('Notifications Enabled!', {
          body: 'You will now receive loud, real-time alerts for incoming Messenger chats.',
          icon: '/favicon.ico',
        });
      }
    }
  };

  const webhookUrl = `${window.location.origin}/webhook/facebook`;

  return (
    <div className="settings-container">
      <header className="page-header">
        <div className="page-title-group">
          <h2>Settings & Multi-Page Management</h2>
          <p>Manage connected Facebook Pages, sound alerts, browser notifications, and automation rules.</p>
        </div>
      </header>

      <div className="settings-grid">
        {/* 1. Connected Facebook Pages Manager */}
        <section className="setting-card" style={{ gridColumn: '1 / -1' }}>
          <div className="card-header-row">
            <div className="card-title-group">
              <h3>
                <Globe size={18} color="var(--accent-primary)" />
                Connected Facebook Pages ({pages.length})
              </h3>
              <p>Manage all connected Facebook Pages and their individual Messenger inboxes.</p>
            </div>
            <button className="primary-btn" onClick={onOpenAddModal} id="btn-add-page-settings">
              <Plus size={15} />
              <span>Connect New Page</span>
            </button>
          </div>

          <div className="pages-table-wrapper">
            <table className="pages-table">
              <thead>
                <tr>
                  <th>Page</th>
                  <th>Page ID</th>
                  <th>Status</th>
                  <th>Conversations</th>
                  <th>Unread</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {pages.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <div className="page-cell-brand">
                        <div className="avatar-placeholder mini">
                          {p.pictureUrl ? (
                            <img src={p.pictureUrl} alt={p.name} className="avatar-img" />
                          ) : (
                            p.name.slice(0, 2).toUpperCase()
                          )}
                        </div>
                        <span className="page-cell-name">{p.name}</span>
                      </div>
                    </td>
                    <td>
                      <code className="code-chip">{p.pageId}</code>
                    </td>
                    <td>
                      <span className="status-badge active">
                        <CheckCircle2 size={12} color="#10b981" />
                        Connected
                      </span>
                    </td>
                    <td>{p.totalConversations || 0}</td>
                    <td>
                      {(p.unreadConversations || 0) > 0 ? (
                        <span className="unread-counter-badge">{p.unreadConversations}</span>
                      ) : (
                        '0'
                      )}
                    </td>
                    <td>
                      {pages.length > 1 && (
                        <button
                          className="icon-btn delete-btn"
                          onClick={() => {
                            if (confirm(`Are you sure you want to disconnect ${p.name}?`)) {
                              onDeletePage(p.id);
                            }
                          }}
                          title="Disconnect Page"
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* 2. Notification Sound & Browser Push Alert */}
        <section className="setting-card">
          <div className="card-header-row">
            <div className="card-title-group">
              <h3>
                <Volume2 size={18} color="#8b5cf6" />
                Loud Audio Alert & Browser Notifications
              </h3>
              <p>Crystal-clear chime sound and instant desktop notifications when clients message.</p>
            </div>
            <button
              className="secondary-btn"
              onClick={onPlayLoudNotification}
              title="Test the loud notification chime"
              id="btn-test-loud-sound"
            >
              <Volume2 size={15} />
              <span>Test Loud Chime</span>
            </button>
          </div>

          <div className="info-field-group">
            <div className="info-item">
              <div className="info-label">Browser Push Notification Permission</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '6px' }}>
                <span
                  style={{
                    fontWeight: 600,
                    color: notificationStatus === 'granted' ? '#34d399' : '#f59e0b',
                  }}
                >
                  {notificationStatus === 'granted' ? 'Enabled (Active)' : 'Permission Required'}
                </span>
                {notificationStatus !== 'granted' && (
                  <button className="primary-btn mini" onClick={requestNotificationPermission}>
                    <Bell size={12} />
                    <span>Enable Push Notifications</span>
                  </button>
                )}
              </div>
            </div>

            <div className="info-item">
              <div className="info-label">Alert Sound Type</div>
              <div className="info-value">High-Gain Harmonic Triad Bell (Loud)</div>
            </div>
          </div>
        </section>

        {/* 3. Global Auto-Reply Master Toggle */}
        <section className="setting-card">
          <div className="card-header-row">
            <div className="card-title-group">
              <h3>
                <Bot size={18} color="var(--accent-primary)" />
                Global Auto-Reply Master Switch
              </h3>
              <p>When turned off, no automated replies will be sent, regardless of individual rules.</p>
            </div>
            <label className="switch">
              <input
                type="checkbox"
                checked={settings?.globalAutoReply ?? true}
                onChange={(e) => onUpdateGlobalAutoReply(e.target.checked)}
                id="switch-global-auto-reply"
              />
              <span className="slider" />
            </label>
          </div>
        </section>

        {/* 4. 23rd-Hour Re-Engagement & Window Protection Engine */}
        <section className="setting-card" style={{ gridColumn: '1 / -1', border: '1px solid rgba(245, 158, 11, 0.3)', background: 'linear-gradient(135deg, rgba(26, 34, 51, 0.95), rgba(30, 27, 45, 0.95))' }}>
          <div className="card-header-row">
            <div className="card-title-group">
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span className="badge-pill" style={{ background: 'rgba(245, 158, 11, 0.2)', color: '#fbbf24', border: '1px solid rgba(245, 158, 11, 0.4)' }}>
                  <Flame size={13} />
                  <span>24-Hour Policy Protector</span>
                </span>
                <span className="badge-pill" style={{ background: 'rgba(99, 102, 241, 0.2)', color: '#818cf8', border: '1px solid rgba(99, 102, 241, 0.4)' }}>
                  <Zap size={13} />
                  <span>Auto Re-Engagement</span>
                </span>
              </div>
              <h3 style={{ marginTop: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Clock size={20} color="#f59e0b" />
                23rd-Hour Auto-Followup Re-Engagement Engine
              </h3>
              <p>
                Automatically pings customers with a freeplay/bonus incentive between the 18th to 23rd hour before Meta's 24-hour window expires. When they reply, their 24h messaging window is 100% refreshed!
              </p>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <label className="switch">
                <input
                  type="checkbox"
                  checked={followUpEnabled}
                  onChange={(e) => setFollowUpEnabled(e.target.checked)}
                  id="switch-followup-engine"
                />
                <span className="slider" />
              </label>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px', marginTop: '16px' }}>
            <div className="info-item" style={{ background: 'rgba(0, 0, 0, 0.25)', padding: '14px', borderRadius: '12px', border: '1px solid rgba(255, 255, 255, 0.05)' }}>
              <label className="info-label" style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px', color: '#e2e8f0' }}>
                <Clock size={14} color="#f59e0b" />
                <span>Re-Engagement Trigger Time (Hours after last customer message)</span>
              </label>
              <select
                value={followUpHours}
                onChange={(e) => setFollowUpHours(Number(e.target.value))}
                className="select-input"
                style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', background: 'var(--clay-bg-input)', color: '#fff', border: '1px solid rgba(255,255,255,0.1)' }}
              >
                <option value={18}>18 Hours (Safe early follow-up)</option>
                <option value={20}>20 Hours (Recommended)</option>
                <option value={21}>21 Hours (Optimal for bonus reminder)</option>
                <option value={22}>22 Hours (Last call reminder)</option>
                <option value={23}>23 Hours (Final hour urgent ping)</option>
              </select>
              <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '6px' }}>
                Messages are only sent while inside Meta's policy window so delivery is 100% guaranteed.
              </p>
            </div>

            <div className="info-item" style={{ background: 'rgba(0, 0, 0, 0.25)', padding: '14px', borderRadius: '12px', border: '1px solid rgba(255, 255, 255, 0.05)' }}>
              <label className="info-label" style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px', color: '#e2e8f0' }}>
                <Sparkles size={14} color="#a855f7" />
                <span>Re-Engagement Message Template</span>
              </label>
              <textarea
                value={followUpTemplate}
                onChange={(e) => setFollowUpTemplate(e.target.value)}
                rows={3}
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  borderRadius: '8px',
                  background: 'var(--clay-bg-input)',
                  color: '#fff',
                  border: '1px solid rgba(255,255,255,0.1)',
                  fontFamily: 'inherit',
                  fontSize: '13px',
                  resize: 'vertical',
                }}
                placeholder="Enter re-engagement message..."
              />
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '16px', flexWrap: 'wrap', gap: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <button
                type="button"
                className="primary-btn"
                onClick={handleSaveFollowUp}
                disabled={followUpSaving}
                id="btn-save-followup"
              >
                <Save size={14} />
                <span>{followUpSaving ? 'Saving...' : followUpSaveSuccess ? 'Saved ✓' : 'Save Engine Settings'}</span>
              </button>

              <button
                type="button"
                className="secondary-btn"
                onClick={handleTriggerFollowUpScan}
                disabled={triggeringFollowUp}
                id="btn-test-followup-scan"
                title="Scan all leads right now and send pending follow-ups"
              >
                <RefreshCw size={14} className={triggeringFollowUp ? 'spin-icon' : ''} />
                <span>{triggeringFollowUp ? 'Scanning leads...' : 'Run Auto-Scan Now'}</span>
              </button>
            </div>

            {followUpTriggerResult && (
              <span className="badge-pill" style={{ background: 'rgba(16, 185, 129, 0.15)', color: '#34d399', border: '1px solid rgba(16, 185, 129, 0.3)', padding: '6px 12px' }}>
                <CheckCircle2 size={13} />
                {followUpTriggerResult}
              </span>
            )}
          </div>
        </section>

        {/* 5. Meta Graph API Connection Health */}
        <section className="setting-card">
          <div className="card-header-row">
            <div className="card-title-group">
              <h3>
                <ShieldCheck size={18} color="var(--accent-fb)" />
                Meta Graph API Connection
              </h3>
              <p>Validates your Page Access Token against Meta's Graph API.</p>
            </div>
            <button
              className="secondary-btn"
              onClick={handleVerify}
              disabled={verifying}
              id="btn-verify-fb"
            >
              <RefreshCw size={14} className={verifying ? 'spin-icon' : ''} />
              <span>{verifying ? 'Verifying...' : 'Test Connection'}</span>
            </button>
          </div>

          <div className="info-field-group">
            <div className="info-item">
              <div className="info-label">Connection Status</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px' }}>
                {settings?.facebookStatus.connected ? (
                  <>
                    <CheckCircle2 size={16} color="#10b981" />
                    <span style={{ color: '#34d399', fontWeight: 600 }}>Active & Verified (Lifetime Token)</span>
                  </>
                ) : (
                  <>
                    <XCircle size={16} color="#ef4444" />
                    <span style={{ color: '#f87171', fontWeight: 600 }}>
                      {settings?.facebookStatus.error || 'Disconnected / Check Token'}
                    </span>
                  </>
                )}
              </div>
            </div>

            <div className="info-item">
              <div className="info-label">Active Facebook Page</div>
              <div className="info-value">{settings?.facebookStatus.pageName || 'Not Available'}</div>
            </div>

            <div className="info-item">
              <div className="info-label">Page ID</div>
              <div className="info-value">{settings?.facebookStatus.pageId || 'Not Available'}</div>
            </div>
          </div>
        </section>

        {/* 5. Webhook Integration Details */}
        <section className="setting-card">
          <div className="card-header-row">
            <div className="card-title-group">
              <h3>
                <ExternalLink size={18} color="var(--accent-primary)" />
                Webhook Integration & Page Subscription
              </h3>
              <p>Ensure Facebook forwards all incoming Messenger messages to your server in real-time.</p>
            </div>
            <button
              className="primary-btn"
              onClick={async () => {
                try {
                  const { subscribeWebhook } = await import('../../services/api');
                  const res = await subscribeWebhook();
                  alert(res.message || 'Page subscribed to webhook successfully!');
                } catch (e: any) {
                  alert(`Failed: ${e.message}`);
                }
              }}
              id="btn-subscribe-page-webhook"
            >
              <CheckCircle2 size={14} />
              <span>Subscribe Page to Webhook</span>
            </button>
          </div>

          <div className="info-field-group">
            <div className="info-item" style={{ gridColumn: '1 / -1' }}>
              <div className="info-label">Webhook Callback URL</div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '4px' }}>
                <span className="info-value">{webhookUrl}</span>
                <button
                  className="icon-btn"
                  onClick={() => copyToClipboard(webhookUrl, 'url')}
                  title="Copy URL"
                >
                  {copiedField === 'url' ? <Check size={14} color="#10b981" /> : <Copy size={14} />}
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* 6. History Backfill / Synchronization */}
        <section className="setting-card">
          <div className="card-header-row">
            <div className="card-title-group">
              <h3>
                <RefreshCw size={18} color="#f59e0b" />
                Smart Delta Sync & History Backfill
              </h3>
              <p>Smart Delta Sync automatically fetches only new messages since your last sync in under a second. Deep Re-sync indexes entire history from scratch.</p>
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                className="secondary-btn"
                onClick={() => onTriggerSync(false)}
                disabled={syncStatus?.inProgress}
                id="btn-trigger-delta-sync"
                title="Only fetch new messages since last sync"
              >
                <RefreshCw size={14} className={syncStatus?.inProgress ? 'spin-icon' : ''} />
                <span>{syncStatus?.inProgress ? 'Syncing...' : '⚡ Fast Delta Sync'}</span>
              </button>
              <button
                className="ghost-btn"
                onClick={() => onTriggerSync(true)}
                disabled={syncStatus?.inProgress}
                id="btn-trigger-full-sync"
                title="Scan all historical conversations from 0"
                style={{ fontSize: '12px' }}
              >
                <span>🔄 Deep Full Re-Sync</span>
              </button>
            </div>
          </div>

          {syncStatus && (
            <div
              style={{
                marginTop: '16px',
                background: '#f8fafc',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-md)',
                padding: '12px 16px',
                fontSize: '13px',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Status:</span>
                <span style={{ fontWeight: 600, color: 'var(--accent-primary)' }}>{syncStatus.message || 'Ready'}</span>
              </div>
            </div>
          )}
        </section>

        {/* 7. 24/7 Keep-Alive & Cloud Persistence */}
        <section className="setting-card">
          <div className="card-header-row">
            <div className="card-title-group">
              <h3>
                <Globe size={18} color="#10b981" />
                24/7 Keep-Alive & Cloud Persistence
              </h3>
              <p>Keep your free Render server awake 24/7 so real-time webhooks, auto-replies, and chats never pause.</p>
            </div>
          </div>

          <div className="info-field-group">
            <div className="info-item" style={{ gridColumn: '1 / -1' }}>
              <div className="info-label">Health & Heartbeat URL (Add to UptimeRobot / cron for 24/7 zero-sleep)</div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '4px' }}>
                <span className="info-value">{window.location.origin}/health</span>
                <button
                  className="icon-btn"
                  onClick={() => copyToClipboard(`${window.location.origin}/health`, 'health')}
                  title="Copy Health URL"
                >
                  {copiedField === 'health' ? <Check size={14} color="#10b981" /> : <Copy size={14} />}
                </button>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
};
