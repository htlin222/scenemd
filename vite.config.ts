import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

const buildTime = new Date().toISOString()

function deployVersionPlugin(): Plugin {
  return {
    name: 'scenemd-deploy-version',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: JSON.stringify({ deployedAt: buildTime }),
      })
    },
  }
}

export default defineConfig({
  define: {
    __SCENEMD_BUILD_TIME__: JSON.stringify(buildTime),
  },
  plugins: [
    react(),
    deployVersionPlugin(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      useCredentials: true,
      manifest: {
        name: 'SceneMD',
        short_name: 'SceneMD',
        description: 'Present documents, not slides.',
        theme_color: '#f7f7f5',
        background_color: '#f7f7f5',
        display: 'standalone',
        start_url: '/',
      },
      workbox: {
        navigateFallback: '/index.html',
        globPatterns: ['**/*.{js,css,html,svg,woff,woff2}'],
      },
    }),
  ],
  build: {
    target: 'es2022',
  },
})
