import express from 'express'
import cors from 'cors'
import fetch from 'node-fetch'
import { readFileSync } from 'fs'

const app = express()
// Railway (and most hosts) inject PORT; fall back to 3001 for local dev.
const PORT = process.env.PORT || 3001

// Restrict CORS to your frontend in production by setting ALLOWED_ORIGIN
// (e.g. https://your-site.netlify.app). If unset, allow all (local dev).
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || ''
app.use(cors(ALLOWED_ORIGIN ? { origin: ALLOWED_ORIGIN } : {}))
app.use(express.json())

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

app.get('/api/market/:vin', async (req, res) => {
  const vin = req.params.vin.toUpperCase().trim()
  const postal = (req.query.postal || '').toString().trim()
  const radius = Math.min(Number(req.query.radius) || 250, 500)
  const historyDays = Number(req.query.history_days) || 45

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

    // Blend: dropped (closer to transacted) + active (current asking).
    const blended = [...dropped, ...active]
    const stats = computeMarket(blended)

    if (!stats) {
      return res.json({
        success: true,
        found: false,
        message: 'No Canadian comparable listings found for this vehicle.',
        meta: { matchMode: match, widened, radius, activeCount: active.length, droppedCount: dropped.length },
      })
    }

    res.json({
      success: true,
      found: true,
      // Mapped to Vantage's market fields
      marketLow: stats.low,
      marketMid: stats.mid,
      marketHigh: stats.high,
      marketAvgPrice: stats.avg,
      activeComps: active.length,
      marketDaysSupply: stats.medianDaysSeen,
      medianCompMileage: stats.medianCompMileage,
      certifiedShare: stats.certifiedShare,
      marketDataFetched: new Date().toISOString(),
      meta: {
        matchMode: match,         // 'trim' = strict, 'model' = widened
        widened,                  // true if we had to loosen matching
        comps: stats.comps,       // total listings the estimate rests on
        activeCount: active.length,
        droppedCount: dropped.length,
        radius,
        country: 'canada',
      },
    })
  } catch (err) {
    console.error('VinAudit market error:', err.message)
    res.status(500).json({ error: 'Market data failed: ' + err.message })
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
