/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { feudApi } from './server/api.ts';

export default defineConfig({
  plugins: [react(), feudApi()],
  server: { port: 5173, host: 'localhost' },
  preview: { port: 4173, host: 'localhost' },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
