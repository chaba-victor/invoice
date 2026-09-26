import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import path from 'path'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './resources'),
      '/img': path.resolve(__dirname, './resources/static/img'),
      'vue-i18n': 'vue-i18n/dist/vue-i18n.cjs.js',
    },
  },
  build: {
    outDir: 'public/build',
    manifest: true,
    rollupOptions: {
      input: 'resources/scripts/main.js',
    },
  },
})
