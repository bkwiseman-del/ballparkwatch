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
      includeAssets: ['favicon-32.png', 'favicon-16.png', 'ball.png', 'apple-touch-icon.png'],
      manifest: {
        name: 'Bandbox',
        short_name: 'Bandbox',
        description: 'Live baseball scoring & streaming for youth and amateur leagues.',
        // The installed app is the operator's tool — open it AT the app, not the
        // public marketing page at '/' (which hijacks login to the waitlist).
        // Not signed in → RequireAuth sends to /login.
        start_url: '/setup',
        scope: '/',
        theme_color: '#1A2A4A',
        background_color: '#F4ECD8',
        display: 'standalone',
        orientation: 'portrait',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
})
