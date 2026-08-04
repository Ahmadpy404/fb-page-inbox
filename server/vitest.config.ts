import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    env: {
      NODE_ENV: 'test',
      PORT: '3000',
      DATABASE_URL: 'file:./test.db',
      APP_SECRET: 'test_app_secret_12345',
      PAGE_ACCESS_TOKEN: 'test_page_access_token_67890',
      VERIFY_TOKEN: 'test_verify_token_abcde',
      GRAPH_API_BASE_URL: 'https://graph.facebook.com/v19.0',
    },
    // Run tests sequentially to avoid SQLite concurrent file lock issues
    poolOptions: {
      threads: {
        singleThread: true,
      },
    },
  },
});
