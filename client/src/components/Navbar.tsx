import React from 'react';
import { MessageSquare, Bot, Settings as SettingsIcon, RefreshCw } from 'lucide-react';
import { FacebookStatus, SyncStatus, PageData } from '../types';
import { PageSelector } from './Pages/PageSelector';

interface NavbarProps {
  activeTab: 'inbox' | 'rules' | 'settings';
  setActiveTab: (tab: 'inbox' | 'rules' | 'settings') => void;
  socketConnected: boolean;
  facebookStatus?: FacebookStatus;
  syncStatus?: SyncStatus;
  pages: PageData[];
  selectedPageId: string;
  onSelectPage: (pageId: string) => void;
  onOpenAddModal: () => void;
  onTriggerSync: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  activeTab,
  setActiveTab,
  socketConnected,
  syncStatus,
  pages,
  selectedPageId,
  onSelectPage,
  onOpenAddModal,
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
            <span style={{ fontSize: '11px', color: '#818cf8', fontWeight: 600 }}>v2.0 PRO</span>
          </h1>
          <div className="brand-subtitle">Multi-Page & Real-Time Messenger</div>
        </div>
      </div>

      {/* Multi-Page Selector Dropdown */}
      <div className="nav-page-selector-wrapper">
        <PageSelector
          pages={pages}
          selectedPageId={selectedPageId}
          onSelectPage={onSelectPage}
          onOpenAddModal={onOpenAddModal}
        />
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
          Settings & Pages
        </button>
      </div>

      <div className="nav-actions">
        <div className="status-pill" title={socketConnected ? 'Real-time WebSocket connected' : 'Connecting to WebSocket...'}>
          <div className={`status-dot ${socketConnected ? 'online' : 'offline'}`} />
          <span>{socketConnected ? 'Live' : 'Connecting...'}</span>
        </div>

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
