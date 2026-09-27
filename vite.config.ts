import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  base: process.env.GITHUB_ACTIONS === 'true' ? '/Prism/' : '/',
  plugins: [vue()],
  worker: { format: 'es' },
})
