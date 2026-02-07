import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.js',
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'android-chrome-512x512.png'],
      manifest: {
        name: 'Gold Road - Shipment Analytics',
        short_name: 'Gold Road',
        description: 'Track and analyze your shipments with powerful analytics',
        theme_color: '#1a1a2e',
        background_color: '#0f0f1a',
        display: 'standalone',
        orientation: 'portrait',
        scope: '/',
        start_url: '/',
        icons: [
          {
            src: '/icon-192x192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: '/icon-512x512.png',
            sizes: '512x512',
            type: 'image/png'
          },
          {
            src: '/icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable'
          },
          {
            src: '/apple-touch-icon.png',
            sizes: '180x180',
            type: 'image/png',
            purpose: 'apple touch icon'
          }
        ]
      },

      devOptions: {
        enabled: true,
        type: 'module',
      },
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
      }
    })
  ],
  server: {
    proxy: {
      '/upload': 'http://127.0.0.1:8000',
      '/health': 'http://127.0.0.1:8000',
      '/shipments': 'http://127.0.0.1:8000',
      '/payments': 'http://127.0.0.1:8000',
      '/statuses': 'http://127.0.0.1:8000',
      '/notifications': 'http://127.0.0.1:8000',
      // Proxy all /api routes to backend
      '/api': 'http://127.0.0.1:8000',
    }
  }
})
