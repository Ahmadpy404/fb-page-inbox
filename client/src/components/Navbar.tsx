import React from 'react';
import { MessageSquare, Bot, Settings as SettingsIcon, RefreshCw, Radio } from 'lucide-react';
import { FacebookStatus, SyncStatus } from '../types';

interface NavbarProps {
  activeTab: 'inbox' | 'rules' | 'settings';
  setActiveTab: (tab: 'inbox' | 'rules' | 'settings') => void;
  socketConnected: boolean;
  facebookStatus?: FacebookStatus;
  syncStatus?: SyncStatus;
  onTriggerSync: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  activeTab,
  setActiveTab,
  socketConnected,
  facebookStatus,
  syncStatus,
  onTriggerSync,
}) => {
  return (
    <nav className="navbar">
      <div className="brand-section">
        <div className="brand-logo-badge">
          <MessageSquare size={20} />
        </div>
        <div className="brand-title-group">
          <h1>
            FB Page Unified Inbox
            <span style={{ fontSize: '11px', color: '#818cf8', fontWeight: 600 }}>v1.0</span>
          </h1>
          <div className="brand-subtitle">Official Meta Graph API</div>
        </div>
      </div>

      <div className="nav-tabs">
        <button
          className={`nav-tab-btn ${activeTab === 'inbox' ? 'active' : ''}`}
          onClick={() => setActiveTab('inbox')}
          id="nav-tab-inbox"
        >
          <MessageSquare size={16} />
          Inbox
        </button>
        <button
          className={`nav-tab-btn ${activeTab === 'rules' ? 'active' : ''}`}
          onClick={() => setActiveTab('rules')}
          id="nav-tab-rules"
        >
          <Bot size={16} />
          Auto-Reply Rules
        </button>
        <button
          className={`nav-tab-btn ${activeTab === 'settings' ? 'active' : ''}`}
          onClick={() => setActiveTab('settings')}
          id="nav-tab-settings"
        >
          <SettingsIcon size={16} />
          Settings
        </button>
      </div>

      <div className="nav-actions">
        <div className="status-pill" title={socketConnected ? 'Real-time WebSocket connected' : 'Connecting to WebSocket...'}>
          <div className={`status-dot ${socketConnected ? 'online' : 'offline'}`} />
          <span>{socketConnected ? 'Live' : 'Connecting...'}</span>
        </div>

        {facebookStatus && (
          <div
            className="status-pill"
            style={{
              borderColor: facebookStatus.connected ? 'rgba(16, 185, 129, 0.3)' : 'rgba(239, 68, 68, 0.3)',
            }}
          >
            <Radio
              size={12}
              color={facebookStatus.connected ? '#10b981' : '#ef4444'}
            />
            <span style={{ color: facebookStatus.connected ? '#34d399' : '#f87171' }}>
              {facebookStatus.connected ? (facebookStatus.pageName || 'FB Connected') : 'FB Disconnected'}
            </span>
          </div>
        )}

        <button
          className="sync-btn"
          onClick={onTriggerSync}
          disabled={syncStatus?.inProgress}
          title="Backfill conversation history from Meta Graph API"
          id="btn-sync-history"
        >
          <RefreshCw size={14} className={syncStatus?.inProgress ? 'spin-icon' : ''} />
          <span>{syncStatus?.inProgress ? 'Syncing...' : 'Sync History'}</span>
        </button>
      </div>
    </nav>
  );
};
