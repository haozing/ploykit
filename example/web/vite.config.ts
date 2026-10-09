import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'


const backend = process.env.BACKEND || 'http://localhost:8030'






export default defineConfig(({ command }) => ({
  plugins: [react(), tailwindcss()],
  
  
  build: {
    manifest: true,
  },
  resolve: {
    conditions: command === 'serve' ? ['development'] : [],
    
    
    
    dedupe: [
      'react', 'react-dom', 'react-router', 'react-router-dom',
      
      
      
      
      '@tanstack/react-query', 'zod',
    ],
  },
  server: {
    port: 5173,
    
    fs: {
      allow: [path.resolve(__dirname, '../..')],
    },
    
    proxy: {
      '/auth': { target: backend, changeOrigin: true },
      '/api': { target: backend, changeOrigin: true },
      '/config': { target: backend, changeOrigin: true },
      
      '/webhooks/billing': { target: backend, changeOrigin: true },
      '/healthz': { target: backend, changeOrigin: true },
      '/readyz': { target: backend, changeOrigin: true },
      '/ws': { target: backend, changeOrigin: true, ws: true },
    },
  },
}))
