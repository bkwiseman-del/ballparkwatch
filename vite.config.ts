import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'node:path'

// https://vite.dev/config/
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'Ballpark Watch',
        short_name: 'Ballpark',
        description: 'Live baseball scoring & streaming for youth and amateur leagues.',
        theme_color: '#1A2A4A',
        background_color: '#F4ECD8',
        display: 'standalone',
        orientation: 'portrait',
        icons: [
          { src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          // TODO: add raster pwa-192.png / pwa-512.png (incl. maskable) before launch.
        ],
      },
    }),
  ],
})
