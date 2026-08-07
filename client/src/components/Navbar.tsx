import React, { useState, useEffect } from 'react';
import { MessageSquare, Bot, Settings as SettingsIcon, RefreshCw, LogOut, ShieldCheck, Bell } from 'lucide-react';
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
  onOpenBroadcastModal: () => void;
  onPlayLoudNotification?: () => void;
  onSimulateTestInbound?: () => void;
  adminUser?: { username: string; role?: string } | null;
  onLogout: () => void;
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
  onOpenBroadcastModal,
  onPlayLoudNotification,
  onSimulateTestInbound,
  adminUser,
  onLogout,
}) => {
  const totalUnread = pages.reduce((acc, p) => acc + (p.unreadConversations || 0), 0);
  const [notifPermission, setNotifPermission] = useState<NotificationPermission>(
    typeof Notification !== 'undefined' ? Notification.permission : 'default'
  );

  useEffect(() => {
    if (typeof Notification !== 'undefined') {
      setNotifPermission(Notification.permission);
    }
  }, []);

  const handleTestAlerts = async () => {
    if (onPlayLoudNotification) {
      onPlayLoudNotification();
    }
    if (typeof Notification !== 'undefined') {
      if (Notification.permission === 'default') {
        const res = await Notification.requestPermission();
        setNotifPermission(res);
      }
      if (Notification.permission === 'granted') {
        try {
          new Notification('⚡ FB Unified Inbox Alerts Active', {
            body: '🔔 Sound and real-time desktop notifications are verified and working perfectly!',
            icon: typeof window !== 'undefined' ? `${window.location.origin}/vite.svg` : undefined,
            silent: false,
          });
        } catch {
          // ignore
        }
      }
    }
    if (onSimulateTestInbound) {
      onSimulateTestInbound();
    }
  };

  return (
    <>
      {/* Main Top Header Navbar */}
      <nav className="navbar">
        <div className="brand-section">
          <div className="brand-logo-badge">
            <MessageSquare size={20} />
          </div>
          <div className="brand-title-group">
            <h1>
              FB Unified Inbox
              <span className="version-pill">PRO</span>
            </h1>
            <div className="brand-subtitle">Multi-Page Real-Time Messenger</div>
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

        {/* Desktop Navigation Tabs */}
        <div className="nav-tabs desktop-only">
          <button
            className={`nav-tab-btn ${activeTab === 'inbox' ? 'active' : ''}`}
            onClick={() => setActiveTab('inbox')}
            id="nav-tab-inbox"
          >
            <MessageSquare size={16} />
            <span>Inbox</span>
            {totalUnread > 0 && <span className="tab-unread-badge">{totalUnread}</span>}
          </button>
          <button
            className={`nav-tab-btn ${activeTab === 'rules' ? 'active' : ''}`}
            onClick={() => setActiveTab('rules')}
            id="nav-tab-rules"
          >
            <Bot size={16} />
            <span>Auto-Reply Rules</span>
          </button>
          <button
            className={`nav-tab-btn ${activeTab === 'settings' ? 'active' : ''}`}
            onClick={() => setActiveTab('settings')}
            id="nav-tab-settings"
          >
            <SettingsIcon size={16} />
            <span>Settings & Pages</span>
          </button>
        </div>

        {/* Action Controls */}
        <div className="nav-actions">
          <div
            className="status-pill"
            title={socketConnected ? 'Real-time WebSocket connected' : 'Connecting to WebSocket...'}
          >
            <div className={`status-dot ${socketConnected ? 'online' : 'offline'}`} />
            <span className="status-label">{socketConnected ? 'Live' : 'Connecting'}</span>
          </div>

          {/* Sound & Notification Test Button */}
          <button
            className={`sound-test-btn ${notifPermission === 'default' ? 'needs-permission' : ''}`}
            onClick={handleTestAlerts}
            title={
              notifPermission === 'granted'
                ? 'Audio & Desktop Notifications Active (Click to test sound)'
                : 'Click to enable browser notifications & test audio alert'
            }
            id="btn-test-notification-sound"
          >
            <Bell size={14} className={notifPermission === 'default' ? 'bell-bounce' : ''} />
            <span className="sound-btn-text">
              {notifPermission === 'granted' ? 'Alerts ON' : 'Enable Alerts'}
            </span>
          </button>

          {/* Bulk Broadcast Action Button */}
          <button
            className="broadcast-nav-btn"
            onClick={onOpenBroadcastModal}
            title="Open Bulk Messaging Broadcast Studio"
            id="btn-open-broadcast"
          >
            <span>📢</span>
            <span className="broadcast-btn-text">Bulk Broadcast</span>
          </button>

          <button
            className="sync-btn"
            onClick={() => onTriggerSync()}
            disabled={syncStatus?.inProgress}
            title="Sync all conversation history from Facebook Graph API"
            id="btn-sync-history"
          >
            <RefreshCw size={14} className={syncStatus?.inProgress ? 'spin-icon' : ''} />
            <span className="sync-btn-text">
              {syncStatus?.inProgress ? 'Syncing...' : 'Sync History'}
            </span>
          </button>

          {adminUser && (
            <div className="admin-profile-pill" title={`Logged in as ${adminUser.username}`}>
              <ShieldCheck size={14} className="admin-icon" />
              <span className="admin-name">{adminUser.username}</span>
              <button
                className="logout-icon-btn"
                onClick={onLogout}
                title="Logout from Dashboard"
                id="btn-logout"
              >
                <LogOut size={13} />
              </button>
            </div>
          )}
        </div>
      </nav>

      {/* Mobile Bottom Navigation Bar (< 768px) */}
      <div className="mobile-bottom-nav">
        <button
          className={`mobile-nav-item ${activeTab === 'inbox' ? 'active' : ''}`}
          onClick={() => setActiveTab('inbox')}
        >
          <div className="mobile-nav-icon-wrapper">
            <MessageSquare size={20} />
            {totalUnread > 0 && <span className="mobile-nav-badge">{totalUnread}</span>}
          </div>
          <span>Inbox</span>
        </button>

        <button
          className={`mobile-nav-item ${activeTab === 'rules' ? 'active' : ''}`}
          onClick={() => setActiveTab('rules')}
        >
          <div className="mobile-nav-icon-wrapper">
            <Bot size={20} />
          </div>
          <span>Rules</span>
        </button>

        <button
          className={`mobile-nav-item ${activeTab === 'settings' ? 'active' : ''}`}
          onClick={() => setActiveTab('settings')}
        >
          <div className="mobile-nav-icon-wrapper">
            <SettingsIcon size={20} />
          </div>
          <span>Settings</span>
        </button>

        <button
          className="mobile-nav-item"
          onClick={() => onTriggerSync()}
          disabled={syncStatus?.inProgress}
        >
          <div className="mobile-nav-icon-wrapper">
            <RefreshCw size={20} className={syncStatus?.inProgress ? 'spin-icon' : ''} />
          </div>
          <span>{syncStatus?.inProgress ? 'Syncing' : 'Sync'}</span>
        </button>
      </div>
    </>
  );
};

