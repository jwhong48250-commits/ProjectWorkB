import { defineConfig, type UserConfig } from 'vite'
import react from '@vitejs/plugin-react'

const config = {
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/setupTests.ts'],
    globals: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
    },
    include: ['src/**/*.test.{ts,tsx}'],
  },
}

export default defineConfig(config as UserConfig)
