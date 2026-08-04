import React, { useState } from 'react';
import { Bot, RefreshCw, CheckCircle2, XCircle, Copy, Check, ExternalLink, ShieldCheck } from 'lucide-react';
import { SettingsData, SyncStatus } from '../../types';

interface SettingsPanelProps {
  settings: SettingsData | null;
  syncStatus?: SyncStatus;
  onUpdateGlobalAutoReply: (enabled: boolean) => Promise<void>;
  onVerifyConnection: () => Promise<void>;
  onTriggerSync: () => Promise<void>;
}

export const SettingsPanel: React.FC<SettingsPanelProps> = ({
  settings,
  syncStatus,
  onUpdateGlobalAutoReply,
  onVerifyConnection,
  onTriggerSync,
}) => {
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);

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

  const webhookUrl = `${window.location.origin}/webhook/facebook`;

  return (
    <div className="settings-container">
      <header className="page-header">
        <div className="page-title-group">
          <h2>Settings & Configuration</h2>
          <p>Manage global automation policies, Meta Graph API connection, and history backfills.</p>
        </div>
      </header>

      <div className="settings-grid">
        {/* 1. Global Auto-Reply Master Toggle */}
        <section className="setting-card">
          <div className="card-header-row">
            <div className="card-title-group">
              <h3>
                <Bot size={18} color="var(--accent-primary)" />
                Global Auto-Reply Master Switch
              </h3>
              <p>When turned off, no automated replies will be sent to any conversation, regardless of individual rules.</p>
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

        {/* 2. Facebook Page Connection Health */}
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
                    <span style={{ color: '#34d399', fontWeight: 600 }}>Active & Verified</span>
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
              <div className="info-label">Connected Facebook Page</div>
              <div className="info-value">{settings?.facebookStatus.pageName || 'Not Available'}</div>
            </div>

            <div className="info-item">
              <div className="info-label">Page ID</div>
              <div className="info-value">{settings?.facebookStatus.pageId || 'Not Available'}</div>
            </div>
          </div>
        </section>

        {/* 3. Webhook Integration Details */}
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
              <div className="info-label">Webhook Callback URL (Use with Cloudflare tunnel / ngrok)</div>
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

            <div className="info-item">
              <div className="info-label">Subscribed Webhook Fields</div>
              <div className="info-value">messages, message_echoes, messaging_postbacks</div>
            </div>

            <div className="info-item">
              <div className="info-label">Security Signature</div>
              <div className="info-value">HMAC-SHA256 (X-Hub-Signature-256)</div>
            </div>
          </div>
        </section>

        {/* 4. History Backfill / Synchronization */}
        <section className="setting-card">
          <div className="card-header-row">
            <div className="card-title-group">
              <h3>
                <RefreshCw size={18} color="#f59e0b" />
                Facebook History Backfill
              </h3>
              <p>Fetch existing conversations and prior message history from Facebook Graph API to populate the local database.</p>
            </div>
            <button
              className="secondary-btn"
              onClick={onTriggerSync}
              disabled={syncStatus?.inProgress}
              id="btn-trigger-sync"
            >
              <RefreshCw size={14} className={syncStatus?.inProgress ? 'spin-icon' : ''} />
              <span>{syncStatus?.inProgress ? 'Sync in Progress...' : 'Sync History Now'}</span>
            </button>
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
              {syncStatus.total && syncStatus.synced && (
                <div style={{ width: '100%', height: '6px', background: '#e2e8f0', borderRadius: '3px', overflow: 'hidden' }}>
                  <div
                    style={{
                      height: '100%',
                      background: 'var(--accent-primary)',
                      width: `${Math.min(100, Math.round((syncStatus.synced / syncStatus.total) * 100))}%`,
                      transition: 'width 200ms ease',
                    }}
                  />
                </div>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
};
