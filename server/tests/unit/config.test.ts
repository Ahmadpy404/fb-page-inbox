import { describe, it, expect } from 'vitest';
import { validateConfig } from '../../src/config';

describe('Config Validation Module', () => {
  const validEnv = {
    PORT: '3000',
    DATABASE_URL: 'file:./test.db',
    APP_SECRET: 'test_meta_app_secret_123',
    PAGE_ACCESS_TOKEN: 'test_page_access_token_456',
    VERIFY_TOKEN: 'my_custom_verify_token_789',
    GRAPH_API_BASE_URL: 'https://graph.facebook.com/v19.0',
    NODE_ENV: 'test',
  };

  it('successfully validates a complete and valid environment configuration', () => {
    const config = validateConfig(validEnv);
    expect(config.PORT).toBe(3000);
    expect(config.DATABASE_URL).toBe('file:./test.db');
    expect(config.APP_SECRET).toBe('test_meta_app_secret_123');
    expect(config.PAGE_ACCESS_TOKEN).toBe('test_page_access_token_456');
    expect(config.VERIFY_TOKEN).toBe('my_custom_verify_token_789');
    expect(config.GRAPH_API_BASE_URL).toBe('https://graph.facebook.com/v19.0');
  });

  it('fails fast when APP_SECRET is missing', () => {
    const invalidEnv = { ...validEnv, APP_SECRET: '' };
    expect(() => validateConfig(invalidEnv)).toThrow(/APP_SECRET is required/);
  });

  it('fails fast when PAGE_ACCESS_TOKEN is missing', () => {
    const invalidEnv = { ...validEnv, PAGE_ACCESS_TOKEN: '' };
    expect(() => validateConfig(invalidEnv)).toThrow(/PAGE_ACCESS_TOKEN is required/);
  });

  it('fails fast when VERIFY_TOKEN is missing', () => {
    const invalidEnv = { ...validEnv, VERIFY_TOKEN: '' };
    expect(() => validateConfig(invalidEnv)).toThrow(/VERIFY_TOKEN is required/);
  });

  it('fails fast when DATABASE_URL is missing', () => {
    const invalidEnv = { ...validEnv, DATABASE_URL: '' };
    expect(() => validateConfig(invalidEnv)).toThrow(/DATABASE_URL is required/);
  });

  it('defaults PORT to 3000 if not provided', () => {
    const envWithoutPort = { ...validEnv, PORT: undefined };
    const config = validateConfig(envWithoutPort);
    expect(config.PORT).toBe(3000);
  });

  it('defaults GRAPH_API_BASE_URL to official v19.0 endpoint if not provided', () => {
    const envWithoutBaseUrl = { ...validEnv, GRAPH_API_BASE_URL: undefined };
    const config = validateConfig(envWithoutBaseUrl);
    expect(config.GRAPH_API_BASE_URL).toBe('https://graph.facebook.com/v19.0');
  });
});
