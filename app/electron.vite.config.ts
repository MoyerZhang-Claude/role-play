import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

const shared = resolve(__dirname, 'src/shared')

/** 只在正式构建时写入严格的内容安全策略（开发时热更新需要内联脚本） */
const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: yt-data:; font-src 'self' data:; media-src 'self' data: blob:; connect-src 'self' yt-data: data: blob:; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-src 'none'"
const cspPlugin = () => ({
  name: 'yt-csp',
  apply: 'build' as const,
  transformIndexHtml(html: string) {
    return html.replace('<!--CSP-->', `<meta http-equiv="Content-Security-Policy" content="${CSP}" />`)
  }
})

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: { '@shared': shared } },
    build: { rollupOptions: { input: { index: resolve(__dirname, 'src/main/index.ts') } } }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: { '@shared': shared } },
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/preload/index.ts') },
        output: { format: 'cjs', entryFileNames: '[name].cjs' }
      }
    }
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    resolve: { alias: { '@shared': shared, '@r': resolve(__dirname, 'src/renderer/src') } },
    plugins: [react(), cspPlugin()],
    build: {
      target: 'chrome140',
      rollupOptions: { input: { index: resolve(__dirname, 'src/renderer/index.html') } },
      assetsInlineLimit: 0,
      chunkSizeWarningLimit: 4000
    },
    server: { port: 5199, strictPort: true }
  }
})
