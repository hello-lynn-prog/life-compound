import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 前端构建配置：产物输出到 frontend/dist，由 Python 后端托管
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 1500,
  },
  server: {
    // 开发时（npm run dev）代理到本地后端，方便调试
    proxy: {
      '/api': 'http://127.0.0.1:8910',
    },
  },
})
