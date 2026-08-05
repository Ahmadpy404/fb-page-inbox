import React, { useState, useEffect } from 'react';
import { Lock, Key, ShieldCheck, Eye, EyeOff, Sparkles, AlertCircle, ArrowRight, UserCheck } from 'lucide-react';
import { login, setupAdminPassword, getAuthStatus } from '../../services/api';
import { refreshSocketAuth } from '../../services/socket';

interface LoginModalProps {
  onLoginSuccess: (user: any) => void;
}

export const LoginModal: React.FC<LoginModalProps> = ({ onLoginSuccess }) => {
  const [isConfigured, setIsConfigured] = useState<boolean>(true);
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checkingStatus, setCheckingStatus] = useState(true);

  useEffect(() => {
    async function checkStatus() {
      try {
        const res = await getAuthStatus();
        setIsConfigured(res.isConfigured);
        if (res.defaultUsername) {
          setUsername(res.defaultUsername);
        }
      } catch {
        // Fallback to standard login
      } finally {
        setCheckingStatus(false);
      }
    }
    checkStatus();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      if (!isConfigured) {
        // First time master password setup
        if (password.length < 6) {
          throw new Error('Password must be at least 6 characters long');
        }
        if (password !== confirmPassword) {
          throw new Error('Passwords do not match');
        }
        const res = await setupAdminPassword(password, confirmPassword);
        refreshSocketAuth();
        onLoginSuccess(res.user);
      } else {
        // Normal login
        const res = await login(username, password, rememberMe);
        refreshSocketAuth();
        onLoginSuccess(res.user);
      }
    } catch (err: any) {
      setError(err.message || 'Authentication failed. Please check your credentials.');
    } finally {
      setLoading(false);
    }
  };

  if (checkingStatus) {
    return (
      <div className="login-backdrop">
        <div className="login-card loading-state">
          <div className="spinner-glow" />
          <p>Verifying system security...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="login-backdrop">
      <div className="login-card">
        {/* Glow ambient background element */}
        <div className="login-glow" />

        <div className="login-header">
          <div className="login-badge-icon">
            <ShieldCheck size={28} className="shield-icon" />
          </div>
          <h2>
            {isConfigured ? 'Admin Authentication' : 'Initial Admin Setup'}
          </h2>
          <p className="login-subtitle">
            {isConfigured
              ? 'Enter your master credentials to access the Facebook Page Unified Inbox.'
              : 'Create a master admin password to protect your Facebook conversations & inbox.'}
          </p>
        </div>

        {error && (
          <div className="login-error-banner">
            <AlertCircle size={18} className="error-icon" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="login-form">
          <div className="form-group">
            <label htmlFor="login-username">
              <UserCheck size={14} />
              <span>Admin Username</span>
            </label>
            <input
              id="login-username"
              type="text"
              className="login-input"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="admin"
              required
              disabled={loading}
              autoComplete="username"
            />
          </div>

          <div className="form-group">
            <label htmlFor="login-password">
              <Key size={14} />
              <span>{isConfigured ? 'Master Password' : 'New Master Password (min 6 chars)'}</span>
            </label>
            <div className="password-input-wrapper">
              <input
                id="login-password"
                type={showPassword ? 'text' : 'password'}
                className="login-input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={isConfigured ? '••••••••••••' : 'Enter strong password'}
                required
                disabled={loading}
                autoComplete={isConfigured ? 'current-password' : 'new-password'}
                autoFocus
              />
              <button
                type="button"
                className="password-toggle-btn"
                onClick={() => setShowPassword(!showPassword)}
                tabIndex={-1}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          {!isConfigured && (
            <div className="form-group">
              <label htmlFor="login-confirm-password">
                <Lock size={14} />
                <span>Confirm Master Password</span>
              </label>
              <input
                id="login-confirm-password"
                type={showPassword ? 'text' : 'password'}
                className="login-input"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Re-enter password"
                required
                disabled={loading}
                autoComplete="new-password"
              />
            </div>
          )}

          {isConfigured && (
            <div className="login-options-row">
              <label className="remember-checkbox-label">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  disabled={loading}
                />
                <span>Remember me on this device (30 Days)</span>
              </label>
            </div>
          )}

          <button type="submit" className="login-submit-btn" disabled={loading} id="btn-admin-login">
            {loading ? (
              <span className="spinner-row">
                <div className="mini-spinner" />
                <span>Authenticating...</span>
              </span>
            ) : (
              <span className="button-content-row">
                <span>{isConfigured ? 'Unlock Dashboard' : 'Save & Enter Dashboard'}</span>
                <ArrowRight size={16} />
              </span>
            )}
          </button>
        </form>

        <div className="login-footer">
          <div className="security-tag">
            <Sparkles size={12} />
            <span>End-to-End HMAC Session Protection</span>
          </div>
        </div>
      </div>
    </div>
  );
};
