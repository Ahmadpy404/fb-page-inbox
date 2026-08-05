import React, { useState } from 'react';
import { X, Plus, Key, Globe, ShieldCheck, Loader2 } from 'lucide-react';
import { PageData } from '../../types';
import { addPage } from '../../services/api';

interface AddPageModalProps {
  isOpen: boolean;
  onClose: () => void;
  onPageAdded: (page: PageData) => void;
}

export const AddPageModal: React.FC<AddPageModalProps> = ({ isOpen, onClose, onPageAdded }) => {
  const [token, setToken] = useState('');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token.trim()) {
      setError('Please provide a Facebook User or Page Access Token');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await addPage(token.trim(), name.trim() || undefined);
      if (res.success && res.page) {
        try {
          const VAULT_KEY = 'fb_inbox_pages_vault';
          const existingVault = JSON.parse(localStorage.getItem(VAULT_KEY) || '[]');
          const filtered = existingVault.filter((v: any) => v.pageId !== res.page.pageId);
          filtered.push({
            pageId: res.page.pageId,
            name: res.page.name,
            token: token.trim(),
          });
          localStorage.setItem(VAULT_KEY, JSON.stringify(filtered));
        } catch {}

        onPageAdded(res.page);
        onClose();
        setToken('');
        setName('');
      } else {
        throw new Error('Failed to connect Facebook Page');
      }
    } catch (err: any) {
      setError(err.message || 'Error connecting page');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal-content page-modal">
        <div className="modal-header">
          <div className="modal-title-group">
            <div className="modal-icon-badge">
              <Plus size={20} color="var(--accent-primary)" />
            </div>
            <div>
              <h3>Add Facebook Page</h3>
              <p>Connect and manage an additional Facebook Page inbox</p>
            </div>
          </div>
          <button className="icon-btn close-btn" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="modal-body">
          {error && <div className="modal-error-banner">{error}</div>}

          <div className="form-group">
            <label htmlFor="input-page-name">
              <Globe size={14} /> Page Name (Optional)
            </label>
            <input
              id="input-page-name"
              type="text"
              className="form-input"
              placeholder="e.g. My Second Brand (Auto-detected if left empty)"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="form-group">
            <label htmlFor="input-page-token">
              <Key size={14} /> Access Token (User or Page Token) *
            </label>
            <textarea
              id="input-page-token"
              className="form-textarea"
              rows={4}
              placeholder="Paste token from Graph API Explorer (will auto-convert to permanent token)"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              required
            />
            <small className="form-help-text">
              <ShieldCheck size={12} /> Our system automatically exchanges short-lived tokens for permanent lifetime tokens.
            </small>
          </div>

          <div className="modal-actions">
            <button type="button" className="secondary-btn" onClick={onClose} disabled={loading}>
              Cancel
            </button>
            <button type="submit" className="primary-btn" disabled={loading} id="btn-submit-add-page">
              {loading ? (
                <>
                  <Loader2 size={16} className="spin-icon" />
                  <span>Connecting Page...</span>
                </>
              ) : (
                <>
                  <Plus size={16} />
                  <span>Connect Page</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
