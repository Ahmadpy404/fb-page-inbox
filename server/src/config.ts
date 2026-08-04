import dotenv from 'dotenv';
import path from 'path';
import { z } from 'zod';

// Load .env from workspace root or server root
dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config({ path: path.resolve(process.cwd(), '../.env') });

const configSchema = z.object({
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  APP_SECRET: z.string().min(1, 'APP_SECRET is required (Meta App Secret for webhook HMAC validation)'),
  PAGE_ACCESS_TOKEN: z.string().min(1, 'PAGE_ACCESS_TOKEN is required (Facebook Page Access Token)'),
  VERIFY_TOKEN: z.string().min(1, 'VERIFY_TOKEN is required (Webhook verification token)'),
  GRAPH_API_BASE_URL: z.string().url().default('https://graph.facebook.com/v19.0'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});

export type Config = z.infer<typeof configSchema>;

export function validateConfig(env: Record<string, string | undefined> = process.env): Config {
  const result = configSchema.safeParse(env);
  if (!result.success) {
    const errorDetails = result.error.errors
      .map((err) => `  - ${err.path.join('.')}: ${err.message}`)
      .join('\n');
    throw new Error(
      `\n================ CONFIGURATION ERROR ================\n` +
      `Missing or invalid required environment variables:\n${errorDetails}\n` +
      `Please check your .env file or copy from .env.example\n` +
      `=====================================================\n`
    );
  }
  return result.data;
}

let cachedConfig: Config | null = null;

export function getConfig(): Config {
  if (!cachedConfig) {
    // In test environment, provide safe defaults if not explicitly set
    if (process.env.NODE_ENV === 'test') {
      const testEnv = {
        PORT: process.env.PORT || '3000',
        DATABASE_URL: process.env.DATABASE_URL || 'file:./test.db',
        APP_SECRET: process.env.APP_SECRET || 'test_app_secret_12345',
        PAGE_ACCESS_TOKEN: process.env.PAGE_ACCESS_TOKEN || 'test_page_access_token_67890',
        VERIFY_TOKEN: process.env.VERIFY_TOKEN || 'test_verify_token_abcde',
        GRAPH_API_BASE_URL: process.env.GRAPH_API_BASE_URL || 'https://graph.facebook.com/v19.0',
        NODE_ENV: 'test',
        ...process.env,
      };
      cachedConfig = validateConfig(testEnv);
    } else {
      cachedConfig = validateConfig(process.env);
    }
  }
  return cachedConfig;
}

export function resetConfigCache(): void {
  cachedConfig = null;
}
