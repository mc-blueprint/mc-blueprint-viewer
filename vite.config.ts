import { defineConfig } from 'vite'
import { devApi } from './scripts/dev-api.mjs'

export default defineConfig({
  plugins: [{ name: 'viewer-dev-api', configureServer(server) { server.middlewares.use(devApi()) } }],
  server: { host: '127.0.0.1', fs: { strict: true } },
  build: { target: 'es2023' },
})
