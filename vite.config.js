import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173
  },
  build: {
    rollupOptions: {
      input: {
        // Main Vantage app
        main: resolve(__dirname, 'index.html'),
        // Standalone customer trade-in widget (embedded via embed.js iframe,
        // or linked directly). Builds to /widget.html.
        widget: resolve(__dirname, 'widget.html'),
        // TradeLane — consumer "sell us your car" marketing site. Wraps the
        // shared quote widget in a full landing page. Builds to /tradelane.html.
        tradelane: resolve(__dirname, 'tradelane.html'),
      },
    },
  },
})
