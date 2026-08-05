import React, { useState } from 'react';
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
} from 'lucide-react';
import { SettingsData, SyncStatus, PageData } from '../../types';

interface SettingsPanelProps {
  settings: SettingsData | null;
  syncStatus?: SyncStatus;
  pages: PageData[];
  onUpdateGlobalAutoReply: (enabled: boolean) => Promise<void>;
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
  onVerifyConnection,
  onTriggerSync,
  onOpenAddModal,
  onDeletePage,
  onPlayLoudNotification,
}) => {
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
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

        {/* 4. Meta Graph API Connection Health */}
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
