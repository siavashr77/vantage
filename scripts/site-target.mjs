// Per-site build target. Both the Vantage dealer app and the TradeLane consumer
// site build from this one repo. Netlify host-based redirect conditions are NOT
// supported (only Country/Language/Role/Cookie), so we choose the root page at
// BUILD time instead: when SITE_TARGET=tradelane (set only on the tradelane-site
// Netlify project), we replace dist/index.html with the TradeLane page so the
// site's root serves TradeLane. The Vantage site has no SITE_TARGET, so its
// build is untouched and its root stays the dealer app.
import { copyFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const target = process.env.SITE_TARGET || ''
const dist = resolve(process.cwd(), 'dist')

if (target === 'tradelane') {
  const src = resolve(dist, 'tradelane.html')
  const dest = resolve(dist, 'index.html')
  if (existsSync(src)) {
    copyFileSync(src, dest)
    console.log('[site-target] SITE_TARGET=tradelane -> dist/index.html now serves the TradeLane page')
  } else {
    console.warn('[site-target] tradelane.html not found in dist; leaving index.html as-is')
  }
} else {
  console.log('[site-target] no SITE_TARGET -> default build (Vantage dealer app at root)')
}
