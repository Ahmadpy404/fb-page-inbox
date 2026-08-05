import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword, generateToken, verifyToken } from '../../src/utils/auth';

describe('Authentication Utilities (Unit Tests)', () => {
  it('correctly hashes a password using PBKDF2 and verifies valid match', () => {
    const rawPassword = 'SuperSecretAdminPassword123!';
    const hashed = hashPassword(rawPassword);

    expect(hashed).toContain(':');
    const [salt, key] = hashed.split(':');
    expect(salt.length).toBeGreaterThan(10);
    expect(key.length).toBeGreaterThan(10);

    const isMatch = verifyPassword(rawPassword, hashed);
    expect(isMatch).toBe(true);
  });

  it('rejects incorrect passwords when verifying against PBKDF2 hash', () => {
    const rawPassword = 'CorrectPassword999';
    const hashed = hashPassword(rawPassword);

    const isMatch = verifyPassword('WrongPassword123', hashed);
    expect(isMatch).toBe(false);
  });

  it('generates and verifies HMAC-SHA256 JWT tokens with custom claims', () => {
    const token = generateToken('admin', 3600);
    expect(typeof token).toBe('string');
    expect(token.split('.').length).toBe(3);

    const verified = verifyToken(token);
    expect(verified).not.toBeNull();
    expect(verified?.username).toBe('admin');
    expect(verified?.role).toBe('admin');
  });

  it('rejects tampered JWT tokens', () => {
    const token = generateToken('admin', 3600);
    const parts = token.split('.');
    // Tamper with signature
    const tampered = `${parts[0]}.${parts[1]}.${parts[2]}tampered`;

    const verified = verifyToken(tampered);
    expect(verified).toBeNull();
  });
});
