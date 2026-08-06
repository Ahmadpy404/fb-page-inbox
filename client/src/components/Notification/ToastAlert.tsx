import React, { useEffect, useState } from 'react';
import { MessageSquare, X, ArrowRight, ShieldCheck } from 'lucide-react';

export interface ToastAlertProps {
  id?: string;
  title: string;
  body: string;
  pageName?: string;
  convId: string;
  onOpen: (convId: string) => void;
  onClose: () => void;
  durationMs?: number;
}

export const ToastAlert: React.FC<ToastAlertProps> = ({
  title,
  body,
  pageName,
  convId,
  onOpen,
  onClose,
  durationMs = 6000,
}) => {
  const [progress, setProgress] = useState(100);

  useEffect(() => {
    const startTime = Date.now();
    const interval = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const remaining = Math.max(0, 100 - (elapsed / durationMs) * 100);
      setProgress(remaining);
      if (remaining <= 0) {
        clearInterval(interval);
        onClose();
      }
    }, 50);

    return () => clearInterval(interval);
  }, [durationMs, onClose]);

  return (
    <div className="toast-floating-container" role="alert" aria-live="assertive">
      <div className="toast-floating-card" onClick={() => onOpen(convId)}>
        {/* Glow accent */}
        <div className="toast-glow-accent" />

        {/* Top Header */}
        <div className="toast-header-row">
          <div className="toast-badge">
            <span className="toast-pulsing-dot" />
            <MessageSquare size={13} className="toast-icon" />
            <span>NEW MESSENGER ALERT</span>
          </div>

          {pageName && (
            <span className="toast-page-pill" title={pageName}>
              <ShieldCheck size={11} />
              {pageName}
            </span>
          )}

          <button
            type="button"
            className="toast-close-btn"
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
            title="Dismiss"
          >
            <X size={14} />
          </button>
        </div>

        {/* Content Body */}
        <div className="toast-content-row">
          <div className="toast-avatar-bubble">
            {title ? title.slice(0, 2).toUpperCase() : 'FB'}
          </div>

          <div className="toast-text-col">
            <div className="toast-sender-name">{title || 'Customer'}</div>
            <div className="toast-message-preview">{body || 'Sent an attachment / media.'}</div>
          </div>
        </div>

        {/* Action Bar */}
        <div className="toast-action-row">
          <span className="toast-hint-text">Click to open chat & reply</span>
          <div className="toast-open-btn">
            <span>Open Chat</span>
            <ArrowRight size={12} />
          </div>
        </div>

        {/* Shrinking progress bar */}
        <div className="toast-progress-track">
          <div className="toast-progress-fill" style={{ width: `${progress}%` }} />
        </div>
      </div>
    </div>
  );
};

export default ToastAlert;
