import crypto from 'crypto';
import { getConfig } from '../config';
import { prisma } from '../db';

export interface JwtPayload {
  username: string;
  role: 'admin';
  iat: number;
  exp: number;
}

/**
 * Base64 URL encode
 */
function base64UrlEncode(str: string): string {
  return Buffer.from(str)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

/**
 * Base64 URL decode
 */
function base64UrlDecode(str: string): string {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) {
    str += '=';
  }
  return Buffer.from(str, 'base64').toString('utf8');
}

/**
 * Get the secret used for signing JWTs
 */
function getSigningSecret(): string {
  const config = getConfig();
  return config.JWT_SECRET || config.APP_SECRET || 'fb-page-inbox-default-secret-key-32chars';
}

/**
 * Sign a JWT token for the admin user
 */
export function generateToken(username: string = 'admin', expiresInSeconds: number = 7 * 24 * 3600): string {
  const secret = getSigningSecret();
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const payload: JwtPayload = {
    username,
    role: 'admin',
    iat: now,
    exp: now + expiresInSeconds,
  };

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signature = crypto
    .createHmac('sha256', secret)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

/**
 * Verify and decode a JWT token
 */
export function verifyToken(token: string): JwtPayload | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const [encodedHeader, encodedPayload, signature] = parts;
    const secret = getSigningSecret();

    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(`${encodedHeader}.${encodedPayload}`)
      .digest('base64')
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');

    if (
      signature.length !== expectedSignature.length ||
      !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))
    ) {
      return null;
    }

    const payload: JwtPayload = JSON.parse(base64UrlDecode(encodedPayload));
    const now = Math.floor(Date.now() / 1000);

    if (payload.exp && payload.exp < now) {
      return null; // Expired
    }

    return payload;
  } catch {
    return null;
  }
}

/**
 * Hash a password with salt using PBKDF2
 */
export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
  return `${salt}:${hash}`;
}

/**
 * Verify password against stored hash
 */
export function verifyPassword(password: string, storedHash: string): boolean {
  try {
    const [salt, originalHash] = storedHash.split(':');
    if (!salt || !originalHash) return false;

    const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
    return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(originalHash));
  } catch {
    return false;
  }
}

/**
 * Check if master admin password is set (in DB or environment)
 */
export async function isMasterPasswordConfigured(): Promise<boolean> {
  const config = getConfig();
  if (config.ADMIN_PASSWORD && config.ADMIN_PASSWORD.trim().length > 0) {
    return true;
  }

  const setting = await prisma.setting.findUnique({
    where: { key: 'admin_password_hash' },
  });

  return !!setting && setting.value.length > 0;
}

/**
 * Verify master admin password against environment or database
 */
export async function verifyMasterPassword(password: string): Promise<boolean> {
  const config = getConfig();

  // 1. Check environment variable first if set
  if (config.ADMIN_PASSWORD && config.ADMIN_PASSWORD.trim().length > 0) {
    return password === config.ADMIN_PASSWORD;
  }

  // 2. Check hashed password stored in Database Setting table
  const setting = await prisma.setting.findUnique({
    where: { key: 'admin_password_hash' },
  });

  if (setting && setting.value) {
    return verifyPassword(password, setting.value);
  }

  // 3. Fallback: If no password is configured anywhere yet, allow default admin password 'admin123'
  // and prompt to set a custom one
  return password === 'admin123';
}

/**
 * Save/update master admin password in Database
 */
export async function setMasterPassword(newPassword: string): Promise<void> {
  const passwordHash = hashPassword(newPassword);
  await prisma.setting.upsert({
    where: { key: 'admin_password_hash' },
    update: { value: passwordHash },
    create: {
      key: 'admin_password_hash',
      value: passwordHash,
    },
  });
}
