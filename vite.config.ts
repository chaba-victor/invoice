import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import path from 'path'

// Mirrors what the `laravel-vite` plugin used to configure (see config/vite.php),
// without shelling out to `php artisan` at build time.
export default defineConfig({
  plugins: [vue()],
  // Assets are served by Laravel from public/build, so chunk and preload URLs need this prefix.
  base: '/build/',
  // Fonts and images referenced as /fonts/* and /img/* live here and are copied to public/build.
  publicDir: 'resources/static',
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './resources'),
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
