import { defineConfig } from 'vitest/config';

// the write suite moves the clock and logs everyone in again, scrypt makes that take a moment
export default defineConfig({ test: { testTimeout: 60_000, hookTimeout: 60_000 } });
