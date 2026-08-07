import React, { useState, useEffect } from 'react';
import { BellRing, AlertCircle, X, ShieldCheck } from 'lucide-react';

interface NotificationBannerProps {
  onPermissionGranted?: () => void;
  onPlayChime?: () => void;
}

export const NotificationBanner: React.FC<NotificationBannerProps> = ({
  onPermissionGranted,
  onPlayChime,
}) => {
  const [permission, setPermission] = useState<NotificationPermission>(() => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      return Notification.permission;
    }
    return 'granted';
  });
  const [dismissed, setDismissed] = useState(false);
  const [isRequesting, setIsRequesting] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      setPermission(Notification.permission);
    }
  }, []);

  if (permission === 'granted' || dismissed) {
    return null;
  }

  const handleRequestPermission = async () => {
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    setIsRequesting(true);
    try {
      if (onPlayChime) {
        onPlayChime();
      }
      const result = await Notification.requestPermission();
      setPermission(result);
      if (result === 'granted') {
        if (onPermissionGranted) {
          onPermissionGranted();
        }
        // Test notification
        try {
          new Notification('⚡ FB Unified Inbox Alerts Activated', {
            body: '🔔 Real-time desktop alerts are now active for all your Facebook pages!',
            icon: `${window.location.origin}/vite.svg`,
            silent: false,
          });
        } catch {}
      }
    } catch (err) {
      console.warn('Failed to request notification permission:', err);
    } finally {
      setIsRequesting(false);
    }
  };

  return (
    <div className={`notification-permission-banner ${permission === 'denied' ? 'denied-state' : ''}`}>
      <div className="notif-banner-content">
        <div className="notif-banner-icon-badge">
          {permission === 'denied' ? (
            <AlertCircle size={18} className="notif-icon-denied" />
          ) : (
            <BellRing size={18} className="notif-icon-ring" />
          )}
        </div>

        <div className="notif-banner-text">
          {permission === 'denied' ? (
            <>
              <strong>⚠️ Browser Notifications are Blocked in Chrome Settings:</strong>
              <span>
                To get real-time popups when customers message, click the 🔒 <strong>Lock icon</strong> next to{' '}
                <code>localhost:5173</code> in your address bar & toggle <strong>Notifications: Allow</strong>, then refresh.
              </span>
            </>
          ) : (
            <>
              <strong>🔔 Enable Real-Time Desktop Notifications:</strong>
              <span>
                Get instant OS popups & sound alerts whenever a customer messages any of your Facebook Pages.
              </span>
            </>
          )}
        </div>
      </div>

      <div className="notif-banner-actions">
        {permission !== 'denied' && (
          <button
            type="button"
            className="notif-banner-btn-enable"
            onClick={handleRequestPermission}
            disabled={isRequesting}
            id="btn-enable-desktop-notifs"
          >
            <ShieldCheck size={14} />
            <span>{isRequesting ? 'Requesting...' : 'Allow Desktop Alerts'}</span>
          </button>
        )}

        <button
          type="button"
          className="notif-banner-btn-dismiss"
          onClick={() => setDismissed(true)}
          title="Dismiss banner"
          aria-label="Dismiss banner"
        >
          <X size={15} />
        </button>
      </div>
    </div>
  );
};

export default NotificationBanner;
