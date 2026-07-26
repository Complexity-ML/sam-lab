import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/@xyflow')) return 'flow-vendor'
          if (id.includes('node_modules/lucide-react')) return 'icons-vendor'
          if (id.includes('node_modules/react')) return 'react-vendor'
        },
      },
    },
  },
  test: { exclude: ['**/node_modules/**', '**/dist/**', '**/dist-electron/**'] },
})
