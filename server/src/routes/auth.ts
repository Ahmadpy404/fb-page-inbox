import { Router, Request, Response } from 'express';
import {
  generateToken,
  verifyMasterPassword,
  isMasterPasswordConfigured,
  setMasterPassword,
} from '../utils/auth';
import { requireAuth, AuthenticatedRequest } from '../middleware/auth';
import { getConfig } from '../config';

const router = Router();

/**
 * GET /api/auth/setup-status
 * Check if master password has been configured
 */
router.get('/setup-status', async (_req: Request, res: Response) => {
  try {
    const config = getConfig();
    const isConfigured = await isMasterPasswordConfigured();
    return res.json({
      isConfigured,
      defaultUsername: config.ADMIN_USERNAME || 'admin',
    });
  } catch (err: any) {
    return res.status(500).json({ error: 'Failed to check setup status' });
  }
});

/**
 * POST /api/auth/setup
 * Initialize master admin password on first run
 */
router.post('/setup', async (req: Request, res: Response) => {
  try {
    const { password, confirmPassword } = req.body;
    if (!password || password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters long' });
    }
    if (password !== confirmPassword) {
      return res.status(400).json({ error: 'Passwords do not match' });
    }

    const isAlreadyConfigured = await isMasterPasswordConfigured();
    if (isAlreadyConfigured) {
      return res.status(400).json({ error: 'Admin password is already configured. Please login.' });
    }

    await setMasterPassword(password);
    const config = getConfig();
    const username = config.ADMIN_USERNAME || 'admin';
    const token = generateToken(username);

    return res.json({
      success: true,
      message: 'Master admin password configured successfully',
      token,
      user: { username, role: 'admin' },
    });
  } catch (err: any) {
    return res.status(500).json({ error: 'Failed to setup password: ' + (err.message || err) });
  }
});

/**
 * POST /api/auth/login
 * Authenticate with username and password
 */
router.post('/login', async (req: Request, res: Response) => {
  try {
    const { username, password, rememberMe } = req.body;
    const config = getConfig();
    const expectedUsername = config.ADMIN_USERNAME || 'admin';

    if (!password) {
      return res.status(400).json({ error: 'Password is required' });
    }

    // Verify username
    if (username && username.trim().toLowerCase() !== expectedUsername.toLowerCase()) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    // Verify password
    const isPasswordValid = await verifyMasterPassword(password);
    if (!isPasswordValid) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    // Duration: 30 days if rememberMe, otherwise 7 days
    const expiresInSeconds = rememberMe ? 30 * 24 * 3600 : 7 * 24 * 3600;
    const token = generateToken(expectedUsername, expiresInSeconds);

    return res.json({
      success: true,
      token,
      user: {
        username: expectedUsername,
        role: 'admin',
      },
      expiresIn: expiresInSeconds,
    });
  } catch (err: any) {
    return res.status(500).json({ error: 'Login failed: ' + (err.message || err) });
  }
});

/**
 * GET /api/auth/me
 * Verify current session token and return user info
 */
router.get('/me', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  return res.json({
    authenticated: true,
    user: req.user,
  });
});

/**
 * POST /api/auth/logout
 * Invalidate session (client clears local token)
 */
router.post('/logout', (_req: Request, res: Response) => {
  return res.json({ success: true, message: 'Logged out successfully' });
});

export default router;
