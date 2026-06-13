import express from 'express'
import cors from 'cors'
import fetch from 'node-fetch'
import { readFileSync } from 'fs'
import pg from 'pg'

const app = express()
// Railway (and most hosts) inject PORT; fall back to 3001 for local dev.
const PORT = process.env.PORT || 3001

// Restrict CORS to your frontend in production by setting ALLOWED_ORIGIN
// (e.g. https://your-site.netlify.app). If unset, allow all (local dev).
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || ''
app.use(cors(ALLOWED_ORIGIN ? { origin: ALLOWED_ORIGIN } : {}))
app.use(express.json())

// ── Postgres dealer-fee ledger ───────────────────────────────────────
// Railway injects DATABASE_URL when a Postgres service is attached.
// Internal Railway connections (*.railway.internal) don't use SSL; public do.
const { Pool } = pg
const DATABASE_URL = process.env.DATABASE_URL || ''
let pool = null
if (DATABASE_URL) {
  const useSSL = !/railway\.internal/.test(DATABASE_URL)
  pool = new Pool({ connectionString: DATABASE_URL, ssl: useSSL ? { rejectUnauthorized: false } : false })
  pool.query(`CREATE TABLE IF NOT EXISTS dealer_fees (
    id SERIAL PRIMARY KEY,
    dealer_key TEXT NOT NULL,
    dealer_name TEXT,
    source TEXT,
    fee_total INTEGER,
    fee_detail JSONB,
    vin TEXT,
    url TEXT,
    checked_by TEXT,
    checked_at TIMESTAMPTZ DEFAULT now()
  )`).then(() => console.log('   Dealer-fee ledger: Postgres ready ✅'))
    .catch(e => console.error('DB init error:', e.message))
} else {
  console.log('   Dealer-fee ledger: no DATABASE_URL — fee history disabled')
}

// Normalize a dealer name into a stable key for matching across listings.
function dealerKey(name) {
  return (name || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

// Record a positive fee check so this dealer can be flagged in future.
async function recordFee({ dealer, source, feeTotal, feeDetail, vin, url, user }) {
  if (!pool) return
  try {
    await pool.query(
      `INSERT INTO dealer_fees(dealer_key,dealer_name,source,fee_total,fee_detail,vin,url,checked_by)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
      [dealerKey(dealer), dealer || '', source || '', feeTotal || 0,
       JSON.stringify(feeDetail || []), vin || '', url || '', user || '']
    )
  } catch (e) { console.error('recordFee error:', e.message) }
}

// Build a map of dealers we've previously caught charging fees.
async function getKnownFeeDealers() {
  if (!pool) return {}
  try {
    const r = await pool.query(
      `SELECT dealer_key, max(dealer_name) AS dealer_name, round(avg(fee_total))::int AS avg_fee,
              max(fee_total) AS max_fee, count(*)::int AS n, max(checked_at) AS last_seen
       FROM dealer_fees WHERE fee_total > 0 GROUP BY dealer_key`
    )
    const map = {}
    for (const row of r.rows) {
      map[row.dealer_key] = { name: row.dealer_name, avgFee: row.avg_fee, maxFee: row.max_fee, count: row.n }
    }
    return map
  } catch (e) { console.error('getKnownFeeDealers error:', e.message); return {} }
}

// API key: prefer environment variable (set this in Railway), fall back to
// config.json for local development. Never commit a real key to git.
let ANTHROPIC_KEY = process.env.ANTHROPIC_KEY || ''
if (!ANTHROPIC_KEY) {
  try {
    const cfg = JSON.parse(readFileSync('./config.json', 'utf8'))
    ANTHROPIC_KEY = cfg.anthropicKey || ''
  } catch {}
}

// VinAudit Market Listings key (set VINAUDIT_KEY in Railway). config.json fallback for local.
let VINAUDIT_KEY = process.env.VINAUDIT_KEY || ''
if (!VINAUDIT_KEY) {
  try {
    const cfg = JSON.parse(readFileSync('./config.json', 'utf8'))
    VINAUDIT_KEY = cfg.vinauditKey || ''
  } catch {}
}

// ── VIN DECODE via NHTSA (free, no key needed) ──────────────────────
app.get('/api/vin/:vin', async (req, res) => {
  const vin = req.params.vin.toUpperCase().trim()

  if (vin.length !== 17) {
    return res.status(400).json({ error: 'VIN must be 17 characters' })
  }

  try {
    const url = `https://vpic.nhtsa.dot.gov/api/vehicles/decodevinvalues/${vin}?format=json`
    const response = await fetch(url)
    const data = await response.json()
    const r = data.Results?.[0]

    if (!r || r.ErrorCode === '8') {
      return res.status(404).json({ error: 'VIN not found' })
    }

    // Map NHTSA fields to Vantage fields
    const engineParts = [
      r.DisplacementL ? `${parseFloat(r.DisplacementL).toFixed(1)}L` : '',
      r.EngineCylinders ? `${r.EngineCylinders}-Cylinder` : '',
      r.EngineConfiguration || '',
      r.FuelTypePrimary && r.FuelTypePrimary !== 'Gasoline' ? r.FuelTypePrimary : '',
    ].filter(Boolean)

    const decoded = {
      year:         r.ModelYear || '',
      make:         r.Make ? r.Make.charAt(0) + r.Make.slice(1).toLowerCase() : '',
      model:        r.Model || '',
      series:       r.Series || r.Trim || '',
      bodyType:     r.BodyClass || '',
      engine:       engineParts.join(' '),
      transmission: r.TransmissionStyle || '',
      drivetrain:   r.DriveType || '',
      doors:        r.Doors || '',
      extColour:    '',
      intColour:    '',
      // Extra data for logging
      _plant:       r.PlantCountry || '',
      _vin:         vin,
    }

    res.json({ success: true, data: decoded })
  } catch (err) {
    console.error('VIN decode error:', err.message)
    res.status(500).json({ error: 'VIN decode failed: ' + err.message })
  }
})

// ── CLAUDE AI — descriptions only ───────────────────────────────────
app.post('/api/claude', async (req, res) => {
  const key = ANTHROPIC_KEY || req.headers['x-api-key'] || ''
  if (!key || key === 'YOUR_ANTHROPIC_API_KEY_HERE') {
    return res.status(400).json({
      error: 'Anthropic API key not configured. Open config.json and add your key to enable AI descriptions.'
    })
  }
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(req.body),
    })
    const data = await response.json()
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── VINAUDIT MARKET LISTINGS — Canadian comps, active + dropped blend ──
// Helpers (pure, testable)
function percentile(sorted, p) {
  if (sorted.length === 0) return null
  if (sorted.length === 1) return sorted[0]
  const idx = (sorted.length - 1) * p
  const lo = Math.floor(idx), hi = Math.ceil(idx)
  if (lo === hi) return sorted[lo]
  return Math.round(sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo))
}

// Compute the market band from MAPPED comp objects (price/mileage/days) — i.e.
// the exact comps shown to the user, so the numbers always match the table.
// Normalize a drivetrain string to a canonical bucket: 'awd', 'fwd', 'rwd', or null.
// AWD and 4WD/4x4 are treated as the same "all/four-wheel" bucket for matching.
function normalizeDrive(s) {
  const t = (s || '').toString().toLowerCase()
  if (!t) return null
  if (/\b(awd|all.?wheel|4wd|4x4|four.?wheel|quattro|4motion|xdrive|4matic)\b/.test(t)) return 'awd'
  if (/\b(fwd|front.?wheel|2wd|front)\b/.test(t)) return 'fwd'
  if (/\b(rwd|rear.?wheel)\b/.test(t)) return 'rwd'
  return null
}
// Detect drivetrain from a comp's free-text title/trim.
function detectDrive(text) {
  return normalizeDrive(text)
}

function computeMarketFromComps(comps) {
  const priced = comps.filter(c => Number.isFinite(c.price) && c.price >= 1000)
  if (priced.length === 0) return null
  const prices = priced.map(c => c.price).sort((a, b) => a - b)
  const miles = priced.map(c => c.mileage).filter(Number.isFinite).sort((a, b) => a - b)
  const daysArr = priced.map(c => c.days).filter(Number.isFinite).sort((a, b) => a - b)
  return {
    comps: priced.length,
    low: percentile(prices, 0.10),
    mid: percentile(prices, 0.50),
    high: percentile(prices, 0.90),
    avg: Math.round(prices.reduce((s, p) => s + p, 0) / prices.length),
    medianCompMileage: miles.length ? percentile(miles, 0.50) : null,
    medianDaysSeen: daysArr.length ? percentile(daysArr, 0.50) : null,
    certifiedShare: Math.round(priced.filter(c => c.certified).length / priced.length * 100),
  }
}

function computeSoldStatsFromComps(comps) {
  const priced = comps.filter(c => Number.isFinite(c.price) && c.price >= 1000)
  if (priced.length === 0) return { count: 0, avgPrice: null, medianPrice: null, avgDts: null, avgOdo: null }
  const prices = priced.map(c => c.price).sort((a, b) => a - b)
  const dts = priced.map(c => c.days).filter(Number.isFinite)
  const odos = priced.map(c => c.mileage).filter(Number.isFinite)
  const avg = a => a.length ? Math.round(a.reduce((s, n) => s + n, 0) / a.length) : null
  return {
    count: priced.length,
    avgPrice: avg(prices),
    medianPrice: percentile(prices, 0.50),
    avgDts: avg(dts),
    avgOdo: avg(odos),
  }
}

function computeMarket(listings) {
  const priced = listings
    .map(l => ({
      price: Number(l.listing_price),
      mileage: Number(l.listing_mileage) || null,
      days: Number(l.days_seen) || null,
      cert: !!l.certified_flag,
    }))
    .filter(l => l.price >= 1000 && Number.isFinite(l.price))
  if (priced.length === 0) return null
  const prices = priced.map(l => l.price).sort((a, b) => a - b)
  const miles = priced.map(l => l.mileage).filter(Number.isFinite).sort((a, b) => a - b)
  const daysArr = priced.map(l => l.days).filter(Number.isFinite).sort((a, b) => a - b)
  return {
    comps: priced.length,
    low: percentile(prices, 0.10),
    mid: percentile(prices, 0.50),
    high: percentile(prices, 0.90),
    avg: Math.round(prices.reduce((s, p) => s + p, 0) / prices.length),
    medianCompMileage: miles.length ? percentile(miles, 0.50) : null,
    medianDaysSeen: daysArr.length ? percentile(daysArr, 0.50) : null,
    certifiedShare: Math.round(priced.filter(l => l.cert).length / priced.length * 100),
  }
}

// Stats for SOLD (dropped) listings, kept SEPARATE from the active market math.
// Sold cars must never feed Low/Mid/High or the active median — they're shown
// in their own panel (avg sold price, avg days-to-sell, avg odometer) the way
// vAuto segregates its "Sold" column.
function computeSoldStats(listings) {
  const rows = listings
    .map(l => ({
      price: Number(l.listing_price),
      mileage: Number(l.listing_mileage) || null,
      dts: Number(l.days_seen) || null,   // days the car was listed before dropping = days-to-sell proxy
    }))
    .filter(l => l.price >= 1000 && Number.isFinite(l.price))
  if (rows.length === 0) return { count: 0, avgPrice: null, avgDts: null, avgOdo: null, medianPrice: null }
  const avg = arr => arr.length ? Math.round(arr.reduce((s, n) => s + n, 0) / arr.length) : null
  const prices = rows.map(r => r.price).sort((a, b) => a - b)
  const miles = rows.map(r => r.mileage).filter(Number.isFinite)
  const dtsArr = rows.map(r => r.dts).filter(Number.isFinite)
  return {
    count: rows.length,
    avgPrice: avg(prices),
    medianPrice: percentile(prices, 0.50),
    avgDts: avg(dtsArr),
    avgOdo: avg(miles),
  }
}

// Market Day Supply (vAuto-style): how many days the local market would take to
// sell through current ACTIVE comparable inventory at the recent rate of sale.
//   MDS = (active comparable listings ÷ sold in the window) × window_days
// Lower = sells fast / liquid; higher = slow mover. Returns null if we can't
// measure a sales rate (no sold comps in the window).
function marketDaySupply(activeCount, soldInWindow, windowDays = 45) {
  if (!soldInWindow || soldInWindow <= 0) return null
  return Math.round((activeCount / soldInWindow) * windowDays)
}

async function fetchListings({ vin, match, status, postal, radius, historyDays }) {
  const params = new URLSearchParams({
    key: VINAUDIT_KEY,
    format: 'json',
    country: 'canada',          // force Canadian market
    listing_status: status,     // 'active' or 'dropped'
    page_size: '100',
    spec_vin: vin,
    spec_vin_match: match,      // 'trim' (strict) or 'model'
    postal,
    radius: String(radius),
  })
  if (status === 'dropped' && historyDays) params.set('history_days', String(historyDays))
  const url = `https://marketlistings.vinaudit.com/v1/listings?${params.toString()}`
  const r = await fetch(url)
  if (!r.ok) throw new Error(`VinAudit HTTP ${r.status}`)
  const data = await r.json()
  if (data.error) throw new Error(data.error)
  return Array.isArray(data.listings) ? data.listings : []
}

const MIN_COMPS = 5  // below this, widen match strictness

// Identify where a listing lives from its URL, so the appraiser sees the
// source before clicking (and knows which comps Check Fees can likely read).
function sourceFromUrl(url) {
  if (!url) return ''
  try {
    const h = new URL(url).hostname.replace(/^www\./, '').toLowerCase()
    if (h.includes('autotrader')) return 'AutoTrader'
    if (h.includes('cargurus')) return 'CarGurus'
    if (h.includes('clutch')) return 'Clutch'
    if (h.includes('kijiji')) return 'Kijiji'
    if (h.includes('carpages')) return 'CarPages'
    if (h.includes('carfax')) return 'Carfax'
    if (h.includes('facebook')) return 'Facebook'
    return h  // dealer's own site — show the domain (e.g. rockcliffauto.ca)
  } catch (e) { return '' }
}


// Pull recognized consumer-portal links (AutoTrader, CarGurus, etc.) out of
// VinAudit's listing_portal_urls field, ranked by recognizability.
function parsePortals(raw) {
  if (!raw) return []
  const urls = Array.isArray(raw) ? raw : String(raw).split(',').join(' ').split(' ').filter(Boolean)
  const rank = { AutoTrader: 0, CarGurus: 1, CarPages: 2, Kijiji: 3, Facebook: 4 }
  const seen = new Set()
  const out = []
  for (const u of urls) {
    if (!u.toLowerCase().startsWith('http')) continue
    let host = ''
    try { host = new URL(u).hostname.toLowerCase() } catch (e) { continue }
    if (host.startsWith('www.')) host = host.slice(4)
    let name = null
    if (host.includes('autotrader')) name = 'AutoTrader'
    else if (host.includes('cargurus')) name = 'CarGurus'
    else if (host.includes('carpages')) name = 'CarPages'
    else if (host.includes('kijiji')) name = 'Kijiji'
    else if (host.includes('facebook')) name = 'Facebook'
    else continue
    if (seen.has(name)) continue
    seen.add(name)
    out.push({ name, url: u })
  }
  out.sort(function (a, b) { return (rank[a.name] === undefined ? 9 : rank[a.name]) - (rank[b.name] === undefined ? 9 : rank[b.name]) })
  return out
}

// Map a raw VinAudit listing into a clean competitive-set row for the UI.
function mapComp(l) {
  const price = Number(l.listing_price)
  return {
    id: l.id || l.listing_vdp_url || `${l.name || ''}|${l.listing_price || ''}`,
    vin: (l.vin || '').toUpperCase().trim(),
    source: sourceFromUrl(l.listing_vdp_url),
    portals: parsePortals(l.listing_portal_urls),
    price: Number.isFinite(price) ? price : null,
    mileage: Number(l.listing_mileage) || null,
    days: Number(l.days_seen) || null,
    certified: !!l.certified_flag,
    status: l.listing_status || '',
    dropDate: l.listing_drop_date || l.date_max || '',
    dealer: l.name || 'Dealer',
    sellerType: l.seller_type || '',
    city: l.city || '',
    region: l.region || '',
    title: l.listing_title || '',
    year: l.vehicle_year || '',
    make: l.vehicle_make || '',
    model: l.vehicle_model || '',
    trim: l.vehicle_trim || '',
    url: l.listing_vdp_url || '',
  }
}

// Build a deduped, price-sorted competitive set (capped to keep payload small).
function buildComps(listings, limit = null) {
  const seen = new Set()
  const out = listings
    .filter(l => {
      const k = l.id || `${l.listing_vdp_url || ''}|${l.listing_price || ''}`
      if (seen.has(k)) return false
      seen.add(k); return true
    })
    .map(mapComp)
    .filter(c => c.price && c.price >= 1000)
    .sort((a, b) => a.price - b.price)
  return limit ? out.slice(0, limit) : out
}

// Collapse the same physical car (same VIN) into ONE listing.
// A car cross-posted by several dealers, or relisted, should count once.
// Rule: if ANY instance is still active, the car is currently listed (not sold);
// only if every instance has dropped do we treat it as recently sold.
// Listings with no/short VIN can't be matched this way, so they pass through.
// Rank a listing's URL by how recognizable / credible its marketplace is, so
// dedup surfaces AutoTrader/CarGurus ads over an obscure dealer page for the
// same car. Higher = preferred; no listing page ranks lowest.
function portalRank(url) {
  const h = (url || '').toLowerCase()
  if (!h) return -1
  if (h.includes('autotrader')) return 3
  if (h.includes('cargurus')) return 3
  return 0
}

function dedupeByVin(listings) {
  const byVin = new Map()
  const noVin = []
  for (const l of listings) {
    const vin = (l.vin || '').toUpperCase().trim()
    if (!vin || vin.length < 11) { noVin.push(l); continue }
    const existing = byVin.get(vin)
    if (!existing) { byVin.set(vin, l); continue }
    const exActive = existing.listing_status !== 'dropped'
    const newActive = l.listing_status !== 'dropped'
    if (newActive && !exActive) { byVin.set(vin, l); continue }
    if (newActive === exActive) {
      // Same status. Prefer a recognizable portal (AutoTrader/CarGurus) so those
      // ads get surfaced; then any real listing page; then the lower price.
      const exRank = portalRank(existing.listing_vdp_url)
      const newRank = portalRank(l.listing_vdp_url)
      if (newRank > exRank) { byVin.set(vin, l); continue }
      if (newRank < exRank) continue
      if (Number(l.listing_price) < Number(existing.listing_price)) byVin.set(vin, l)
    }
  }
  return [...byVin.values(), ...noVin]
}

// Strip a listing page down to readable text for fee extraction.
function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#\d+;/g, ' ')
    .replace(/\s+/g, ' ').trim()
}

// Focus the text on fee-relevant passages so the model sees the fine print.
function relevantText(text) {
  const head = text.slice(0, 6000)
  const kw = /(fee|admin|documentation|\bdoc\b|reconditioning|freight|pdi|etch|nitrogen|certification|surcharge|does not include|all prices|additional|plus applicable|plus hst)/gi
  const windows = []
  let m
  while ((m = kw.exec(text)) && windows.length < 12) {
    windows.push(text.slice(Math.max(0, m.index - 200), Math.min(text.length, m.index + 300)))
  }
  return (head + '\n...\n' + windows.join('\n...\n')).slice(0, 12000)
}

app.get('/api/market/:vin', async (req, res) => {
  const vin = req.params.vin.toUpperCase().trim()
  const postal = (req.query.postal || '').toString().trim()
  // Radius up to national coverage (Canada ~5500km wide) so rare cars can pull
  // comps from anywhere. VinAudit may still cap internally, but we don't clamp.
  const radius = Math.min(Number(req.query.radius) || 250, 6000)
  let historyDays = Number(req.query.history_days) || 60

  if (vin.length !== 17) return res.status(400).json({ error: 'VIN must be 17 characters' })
  if (!postal) return res.status(400).json({ error: 'postal code required' })
  if (!VINAUDIT_KEY || VINAUDIT_KEY === 'YOUR_VINAUDIT_API_KEY_HERE') {
    return res.status(400).json({ error: 'VinAudit API key not configured.' })
  }

  try {
    // Try strict (trim) match first; widen to model if too few comps.
    let match = 'trim'
    let active = [], dropped = []
    try {
      ;[active, dropped] = await Promise.all([
        fetchListings({ vin, match, status: 'active', postal, radius }),
        fetchListings({ vin, match, status: 'dropped', postal, radius, historyDays }),
      ])
    } catch (e) {
      // trim match can error on sparse specs — fall through to model
      active = []; dropped = []
    }

    let widened = false
    if (active.length + dropped.length < MIN_COMPS) {
      match = 'model'
      widened = true
      ;[active, dropped] = await Promise.all([
        fetchListings({ vin, match, status: 'active', postal, radius }),
        fetchListings({ vin, match, status: 'dropped', postal, radius, historyDays }),
      ])
    }

    // History widening (fallback only): keep archived/sold comps to the last
    // 60 days when recent data is sufficient; reach further back ONLY if the set
    // is still too sparse — so we never surface year-old sales unnecessarily.
    let historyWidened = false
    for (const step of [180, 365]) {
      if (active.length + dropped.length >= MIN_COMPS) break
      if (step <= historyDays) continue
      historyDays = step
      historyWidened = true
      dropped = await fetchListings({ vin, match, status: 'dropped', postal, radius, historyDays })
    }

    // Blend: dropped (closer to transacted) + active (current asking),
    // then collapse duplicate VINs so stats and comps count UNIQUE cars.
    const blended = [...dropped, ...active]
    const deduped = dedupeByVin(blended)

    // DEBUG (gated by ?debug=hosts): raw pre-dedup tally, so we can see whether
    // recognizable portals (AutoTrader/CarGurus) appear before dedup, and whether
    // they are live ads (active) or archived (dropped).
    let rawHostsDebug = null
    if (req.query.debug === 'hosts') {
      const tally = {}
      let none = 0, portalActive = 0, portalDropped = 0
      const portalRe = /autotrader|cargurus/i
      for (const l of blended) {
        const u = l.listing_vdp_url || ''
        if (!u) { none++; continue }
        let h = ''
        try { h = new URL(u).hostname.replace(/^www\./, '') } catch { h = '(bad)' }
        tally[h] = (tally[h] || 0) + 1
        if (portalRe.test(h)) { (l.listing_status === 'dropped' ? portalDropped++ : portalActive++) }
      }
      rawHostsDebug = {
        rawTotal: blended.length,
        noUrl: none,
        portalsActive: portalActive,
        portalsDropped: portalDropped,
        namedMarketplaces: Object.entries(tally).filter(([h]) => /autotrader|cargurus|kijiji|carpages|clutch/i.test(h)),
        hosts: Object.entries(tally).sort((a, b) => b[1] - a[1]),
      }
    }
    const dedupActive = deduped.filter(l => l.listing_status !== 'dropped').length
    const dedupDropped = deduped.filter(l => l.listing_status === 'dropped').length

    // Build the displayed comps FIRST, then compute every number from this exact
    // same set — so Low/Mid/High always match the cars shown on screen.
    // No display cap: show the whole active market. Sold cars older than 30 days
    // are dropped entirely (only recent sold comps are relevant).
    const known = await getKnownFeeDealers()
    const SOLD_MAX_AGE_DAYS = 30
    const allComps = buildComps(deduped).map(c => {
      const k = dealerKey(c.dealer)
      if (known[k]) c.feeWarning = { avgFee: known[k].avgFee, count: known[k].count }
      return c
    })
    // Split the displayed set: active drives pricing; sold shown separately and
    // filtered to the last 30 days.
    let activeComps = allComps.filter(c => c.status !== 'dropped')
    let soldComps = allComps.filter(c => c.status === 'dropped' && (c.days == null || c.days <= SOLD_MAX_AGE_DAYS))

    // ── Drivetrain-precise trim matching ──
    // VinAudit's trim match lumps FWD and AWD of the same trim together (e.g.
    // "Corolla LE FWD" and "Corolla LE AWD"), but drivetrain is a major price
    // driver. If the caller tells us the subject's drivetrain, drop comps whose
    // drivetrain clearly differs. Detect comp drivetrain from its title/trim.
    const subjectDrive = normalizeDrive(req.query.drivetrain)
    if (subjectDrive) {
      const matchesDrive = c => {
        const cd = detectDrive(`${c.title || ''} ${c.trim || ''}`)
        // keep comps with no detectable drivetrain (benefit of the doubt) and
        // comps whose drivetrain matches the subject
        return cd === null || cd === subjectDrive
      }
      const beforeA = activeComps.length, beforeS = soldComps.length
      const fa = activeComps.filter(matchesDrive)
      const fs = soldComps.filter(matchesDrive)
      // Only apply the filter if it doesn't wipe out the set (safety: if every
      // comp got a different drivetrain tag, we likely mis-detected — keep all).
      if (fa.length >= Math.min(3, beforeA)) { activeComps = fa; soldComps = fs }
    }
    const comps = [...activeComps, ...soldComps]

    // Pricing band computed on the EXACT active comps displayed (deduped, ≥$1000).
    const stats = computeMarketFromComps(activeComps)
    const soldStats = computeSoldStatsFromComps(soldComps)

    const MDS_WINDOW = 45
    const soldInWindow = soldComps.length
    const mds = marketDaySupply(activeComps.length, soldInWindow, MDS_WINDOW)

    if (!stats) {
      return res.json({
        success: true,
        found: false,
        message: 'No Canadian comparable ACTIVE listings found for this vehicle.',
        soldStats,
        meta: { matchMode: match, widened, radius, activeCount: activeComps.length, droppedCount: soldComps.length },
      })
    }

    res.json({
      success: true,
      found: true,
      // Mapped to Vantage's market fields — ACTIVE LISTINGS ONLY.
      marketLow: stats.low,
      marketMid: stats.mid,
      marketHigh: stats.high,
      marketAvgPrice: stats.avg,
      activeComps: activeComps.length,
      // True Market Day Supply (active ÷ sales rate × 45). null if no sold comps.
      marketDaySupply: mds,
      // Median days a CURRENT listing has been on market (distinct from MDS).
      medianDaysListed: stats.medianDaysSeen,
      // Back-compat: keep the old field name pointing at median days listed so
      // existing UI doesn't break; new UI should read marketDaySupply.
      marketDaysSupply: stats.medianDaysSeen,
      medianCompMileage: stats.medianCompMileage,
      certifiedShare: stats.certifiedShare,
      // Sold/dropped summary — never mixed into the numbers above.
      soldStats,
      marketDataFetched: new Date().toISOString(),
      comps,
      meta: {
        matchMode: match,         // 'trim' = strict, 'model' = widened
        widened,                  // true if we had to loosen matching
        comps: stats.comps,       // ACTIVE listings the estimate rests on
        activeCount: activeComps.length,
        droppedCount: soldComps.length,
        soldInWindow,             // sold comps counted toward MDS (≤45d)
        mdsWindow: MDS_WINDOW,
        deduped: blended.length - deduped.length,  // duplicate VINs removed
        radius,
        historyDays,              // archived window actually used (60 unless widened)
        historyWidened,           // true if we reached past 60 days for more comps
        country: 'canada',
        ...(rawHostsDebug ? { rawHostsDebug } : {}),
      },
    })
  } catch (err) {
    console.error('VinAudit market error:', err.message)
    res.status(500).json({ error: 'Market data failed: ' + err.message })
  }
})

// ── Check Fees ───────────────────────────────────────────────────────
// Fetch ONE listing page on demand, extract fees ADDED on top of the
// advertised price, and record positives so the dealer can be flagged later.
app.post('/api/fees', async (req, res) => {
  const { url, dealer, vin, source, user } = req.body || {}
  if (!url) return res.status(400).json({ error: 'listing url required' })
  if (!ANTHROPIC_KEY || ANTHROPIC_KEY === 'YOUR_ANTHROPIC_API_KEY_HERE') {
    return res.status(400).json({ error: 'AI key not configured' })
  }

  // 1) Fetch the listing page (browser UA, 12s timeout via AbortController —
  //    node-fetch v3 has no timeout option). Many big portals will block us;
  //    fail soft so the UI can say "couldn't read this listing".
  let pageText = ''
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 12000)
    const r = await fetch(url, {
      redirect: 'follow',
      signal: ctrl.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
      },
    })
    clearTimeout(t)
    if (!r.ok) return res.json({ success: true, readable: false, reason: `page returned ${r.status}` })
    const html = await r.text()
    pageText = relevantText(htmlToText(html))
  } catch (e) {
    return res.json({ success: true, readable: false, reason: 'could not fetch page' })
  }
  if (!pageText || pageText.length < 40) {
    return res.json({ success: true, readable: false, reason: 'no readable text on page' })
  }

  // 2) Extract fees with the LLM (strict JSON; exclude HST & licensing).
  try {
    const prompt = `You are analyzing a Canadian used-car listing page. Extract ONLY fees or charges that are ADDED ON TOP of the advertised vehicle price and are NOT already included in it — e.g. admin fee, documentation/doc fee, dealer fee, reconditioning, freight/PDI, etching, nitrogen, certification fee, surcharges. Do NOT include HST/tax or government licensing/registration. If a fee's inclusion is ambiguous, leave it out. Respond with STRICT JSON only, no prose, no markdown: {"fees":[{"name":"...","amount":NUMBER}],"note":"short note or empty string"}. If none are clearly found, return {"fees":[],"note":"..."}.

LISTING PAGE TEXT:
${pageText}`
    const ar = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-3-5-haiku-20241022', max_tokens: 400, messages: [{ role: 'user', content: prompt }] }),
    })
    const ad = await ar.json()
    if (ad.error) return res.status(502).json({ error: 'AI error: ' + (ad.error.message || 'unknown') })
    let txt = (ad.content && ad.content[0] && ad.content[0].text) || ''
    txt = txt.replace(/```json|```/g, '').trim()
    let parsed
    try { parsed = JSON.parse(txt) } catch (e) { parsed = { fees: [], note: 'could not parse model output' } }
    const fees = Array.isArray(parsed.fees)
      ? parsed.fees.filter(f => f && Number(f.amount) > 0)
                   .map(f => ({ name: String(f.name || 'fee').slice(0, 40), amount: Math.round(Number(f.amount)) }))
      : []
    const feeTotal = fees.reduce((s, f) => s + f.amount, 0)
    if (feeTotal > 0) recordFee({ dealer, source, feeTotal, feeDetail: fees, vin, url, user })
    res.json({ success: true, readable: true, fees, feeTotal, note: parsed.note || '' })
  } catch (e) {
    res.status(500).json({ error: 'fee extraction failed: ' + e.message })
  }
})

// ── Health check ─────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    vinDecode: 'NHTSA — free',
    marketData: VINAUDIT_KEY && VINAUDIT_KEY !== 'YOUR_VINAUDIT_API_KEY_HERE' ? 'configured' : 'not configured',
    aiDescriptions: ANTHROPIC_KEY && ANTHROPIC_KEY !== 'YOUR_ANTHROPIC_API_KEY_HERE' ? 'configured' : 'not configured'
  })
})

app.listen(PORT, () => {
  console.log(`\n✅ Vantage server running on http://localhost:${PORT}`)
  console.log(`   VIN decode: NHTSA (free, no key needed)`)
  console.log(`   Market data: ${VINAUDIT_KEY && VINAUDIT_KEY !== 'YOUR_VINAUDIT_API_KEY_HERE' ? 'VinAudit configured ✅' : 'not configured — set VINAUDIT_KEY'}`)
  const aiStatus = ANTHROPIC_KEY && ANTHROPIC_KEY !== 'YOUR_ANTHROPIC_API_KEY_HERE'
    ? 'configured ✅'
    : 'not configured — add key to config.json for AI descriptions'
  console.log(`   AI descriptions: ${aiStatus}\n`)
})
