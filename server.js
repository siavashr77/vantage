import crypto from 'crypto'
import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import fetch from 'node-fetch'
import { readFileSync } from 'fs'
import pg from 'pg'
import { computeSuggestedBuy, confidenceFrom, accidentDeduction } from './shared/suggestedBuy.js'

const app = express()
// Railway (and most hosts) inject PORT; fall back to 3001 for local dev.
const PORT = process.env.PORT || 3001

// Behind Railway's proxy — needed so express-rate-limit sees real client IPs
// (via X-Forwarded-For) instead of the proxy's IP.
app.set('trust proxy', 1)

// ── Security headers (helmet) ────────────────────────────────────────
// Sensible defaults. CSP is left off here because the API serves JSON, not
// HTML; the frontend (Netlify) sets its own headers via public/_headers.
app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'cross-origin' } }))

// ── CORS ─────────────────────────────────────────────────────────────
// Restrict to your frontend origin(s) in production by setting ALLOWED_ORIGIN
// (comma-separated list, e.g. "https://your-site.netlify.app,https://app.yourdomain.com").
// If unset, allow all (local dev only — ALWAYS set this in production).
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || ''
// First-party sites are always allowed. These are our own front-ends; leaving
// them to env config alone meant TradeLane's lead POSTs were silently blocked by
// CORS the moment it moved to its own domain (the browser rejects the preflight,
// so the lead never reaches the server and the visitor sees nothing).
const FIRST_PARTY_ORIGINS = [
  'https://tradelane.ca',
  'https://www.tradelane.ca',
  'https://ornate-marshmallow-236af3.netlify.app',
]
const allowedOrigins = [
  ...ALLOWED_ORIGIN.split(',').map(s => s.trim()).filter(Boolean),
  ...FIRST_PARTY_ORIGINS,
].filter((v, i, arr) => arr.indexOf(v) === i)
app.use(cors(allowedOrigins.length ? {
  origin(origin, cb) {
    // Allow same-origin / server-to-server (no Origin header) and whitelisted origins.
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true)
    return cb(new Error('Not allowed by CORS'))
  },
} : {}))
app.use(express.json({ limit: '12mb' }))

// ── Rate limiting ────────────────────────────────────────────────────
// Two tiers. The general limiter covers everything; the strict limiter guards
// the expensive/public endpoints (each call can trigger a PAID VinAudit lookup
// and/or an Anthropic call) so the public can't drain the API budget or flood us.
const generalLimiter = rateLimit({
  windowMs: 60 * 1000, max: 120,            // 120 req/min/IP across the API
  standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many requests — please slow down.' },
})
const strictLimiter = rateLimit({
  windowMs: 60 * 1000, max: 15,             // 15 req/min/IP on costly/public routes
  standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many requests — please try again in a minute.' },
})
// Lead submission is public by necessity and can't sit behind auth. Someone
// scripting it could bury real customers in noise and drain the MarketCheck
// quota, since every submission triggers a market lookup. A person completes
// this form once; five an hour is generous for a household behind one IP.
const leadSubmitLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, max: 5,
  standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many estimate requests from this connection. Please try again later, or call us.' },
})
app.use('/api/', generalLimiter)

// ── Input validation helpers ─────────────────────────────────────────
const isVin = v => typeof v === 'string' && /^[A-HJ-NPR-Z0-9]{17}$/i.test(v)
const cleanStr = (v, max = 200) => (v == null ? null : String(v).trim().slice(0, max) || null)
const isPostal = v => typeof v === 'string' && /^[A-Za-z]\d[A-Za-z]/.test(v.trim())

// ── Team auth gate ───────────────────────────────────────────────────
// Private endpoints (reading/managing the customer-lead database) require a
// shared secret that only the Vantage frontend knows, sent as x-vantage-key.
// The PUBLIC widget endpoints (lead submission, offer prefetch, VIN decode,
// market) do NOT use this — customers must be able to call them anonymously.
//
// NOTE (handover): this is a shared-secret gate, not real per-user auth. It
// stops the public + other sites from reading your lead database and is a solid
// interim control, but a secret shipped to the browser can ultimately be
// extracted. Real auth (server-enforced, per-user sessions) is the backend-phase
// replacement. If TEAM_API_KEY is unset, the gate is OPEN (logs a warning) so
// local dev and the current setup don't break — SET IT IN PRODUCTION.
const TEAM_API_KEY = process.env.TEAM_API_KEY || ''
// Clerk verifies who is signed in. Unset → falls back to the team key.
const CLERK_SECRET_KEY = process.env.CLERK_SECRET_KEY || ''
// Verify a Clerk session token. The token is short-lived and signed by Clerk,
// so unlike the team key it can't simply be lifted out of the frontend bundle
// and reused — and it identifies WHO is acting, which the shared key never did.
async function verifyClerkSession(req) {
  if (!CLERK_SECRET_KEY) return null
  const auth = req.get('authorization') || ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : ''
  if (!token) return null
  try {
    const { verifyToken } = await import('@clerk/backend')
    const claims = await verifyToken(token, { secretKey: CLERK_SECRET_KEY })
    return claims && claims.sub ? claims : null
  } catch (e) {
    return null   // expired, tampered with, or issued by a different instance
  }
}

async function requireTeamKey(req, res, next) {
  // Prefer a signed-in user when Clerk is configured.
  if (CLERK_SECRET_KEY) {
    const claims = await verifyClerkSession(req)
    if (claims) {
      req.clerkUserId = claims.sub
      req.clerkEmail = claims.email || ''
      return next()
    }
  }
  // The team key remains accepted so the two can run side by side during the
  // switchover — a phone holding an older bundle keeps working rather than
  // locking someone out mid-appraisal. Retire it once everyone has signed in.
  if (TEAM_API_KEY) {
    const key = (req.get('x-vantage-key') || '').trim()
    if (key && key === TEAM_API_KEY.trim()) return next()
  }
  // Neither configured → open (dev/legacy); the boot log warns about it.
  if (!CLERK_SECRET_KEY && !TEAM_API_KEY) return next()
  return res.status(401).json({ error: 'Unauthorized' })
}

// Short, non-reversible fingerprint of the team key so the frontend and backend
// can be compared without either side ever revealing the secret.
function keyFingerprint(v) {
  const t = (v || '').trim()
  if (!t) return null
  return crypto.createHash('sha256').update(t).digest('hex').slice(0, 8)
}

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

  // Customer trade-in leads from the embeddable widget land here as PENDING
  // appraisals. Vantage reads these and an appraiser works them on the lot.
  pool.query(`CREATE TABLE IF NOT EXISTS pending_leads (
    id SERIAL PRIMARY KEY,
    dealer_key TEXT,
    vin TEXT,
    year TEXT, make TEXT, model TEXT, trim TEXT,
    odometer INTEGER,
    postal TEXT,
    accident BOOLEAN DEFAULT false,
    accident_amount INTEGER,
    customer_name TEXT NOT NULL,
    customer_email TEXT,
    customer_phone TEXT,
    offer_amount INTEGER,
    base_offer INTEGER,
    accident_deduction INTEGER DEFAULT 0,
    offer_breakdown JSONB,
    market_mid INTEGER,
    confidence TEXT,
    thin_market BOOLEAN DEFAULT false,
    status TEXT DEFAULT 'pending',
    source TEXT DEFAULT 'widget',
    created_at TIMESTAMPTZ DEFAULT now()
  )`).then(() => console.log('   Customer leads: Postgres ready ✅'))
    .catch(e => console.error('Leads table init error:', e.message))

  // Add columns that may not exist on an already-created table (safe, idempotent).
  pool.query(`ALTER TABLE pending_leads ADD COLUMN IF NOT EXISTS thin_market BOOLEAN DEFAULT false`)
    .catch(e => console.error('Leads alter error:', e.message))
  // Customer-reported detail (appraiser context only — does NOT affect the offer).
  pool.query(`ALTER TABLE pending_leads
      ADD COLUMN IF NOT EXISTS condition_opinion TEXT,
      ADD COLUMN IF NOT EXISTS known_issues TEXT,
      ADD COLUMN IF NOT EXISTS tire_condition TEXT,
      ADD COLUMN IF NOT EXISTS brake_condition TEXT,
      ADD COLUMN IF NOT EXISTS ownership TEXT,
      ADD COLUMN IF NOT EXISTS lien_holder TEXT,
      ADD COLUMN IF NOT EXISTS lien_balance INTEGER,
      ADD COLUMN IF NOT EXISTS photos JSONB`)
    .catch(e => console.error('Leads detail-cols alter error:', e.message))

  // 24h market cache — keyed by VIN-or-spec + FSA. Lets the widget return an
  // instant offer (and the prefetch warm it) without re-paginating VinAudit.
  // ── Appraisals and inventory ───────────────────────────────────────
  // Previously these lived in the browser's localStorage, which meant one
  // device could see them, they vanished if the browser was cleared, and two
  // appraisers couldn't share a store.
  //
  // dealer_key scopes every row to a dealership. There's only one today, but
  // adding it later — once Vantage is sold to a second dealer and real customer
  // data is in the system — means revisiting every query with live rows in
  // place. It costs nothing now.
  //
  // The JSON columns hold structures the app already nests (market results,
  // photos, the action log). Normalising them properly is a separate job; doing
  // it in the same change as the move to a database would be two problems at
  // once.
  pool.query(`CREATE TABLE IF NOT EXISTS appraisals (
    id TEXT PRIMARY KEY,
    dealer_key TEXT NOT NULL DEFAULT 'default',
    vin TEXT,
    year TEXT, make TEXT, model TEXT, series TEXT,
    odometer INTEGER,
    status TEXT DEFAULT 'in_progress',
    appraised_value INTEGER,
    suggested_buy INTEGER,
    first_name TEXT, last_name TEXT, email TEXT, phone TEXT,
    -- The full record. Columns above are promoted copies for querying.
    data JSONB NOT NULL DEFAULT '{}'::jsonb,
    finalized_at TIMESTAMPTZ,
    finalized_by TEXT,
    deleted_at TIMESTAMPTZ,
    created_by TEXT, updated_by TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
  )`).then(() => pool.query(
      `CREATE INDEX IF NOT EXISTS appraisals_dealer_idx ON appraisals (dealer_key, updated_at DESC)`))
    .then(() => console.log('   Appraisals: Postgres ready ✅'))
    .catch(e => console.error('Appraisals table init error:', e.message))

  pool.query(`CREATE TABLE IF NOT EXISTS vehicles (
    id TEXT PRIMARY KEY,
    dealer_key TEXT NOT NULL DEFAULT 'default',
    vin TEXT,
    stock_number TEXT,
    year TEXT, make TEXT, model TEXT, series TEXT,
    odometer INTEGER,
    status TEXT DEFAULT 'available',
    cost INTEGER, price INTEGER,
    data JSONB NOT NULL DEFAULT '{}'::jsonb,
    deleted_at TIMESTAMPTZ,
    created_by TEXT, updated_by TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
  )`).then(() => pool.query(
      `CREATE INDEX IF NOT EXISTS vehicles_dealer_idx ON vehicles (dealer_key, updated_at DESC)`))
    .then(() => console.log('   Inventory: Postgres ready ✅'))
    .catch(e => console.error('Vehicles table init error:', e.message))

  // One settings row per dealership, holding the store details, staff list and
  // the pricing strategy that drives every suggested-buy number.
  pool.query(`CREATE TABLE IF NOT EXISTS dealer_settings (
    dealer_key TEXT PRIMARY KEY,
    settings JSONB NOT NULL,
    updated_by TEXT,
    updated_at TIMESTAMPTZ DEFAULT now()
  )`).then(() => console.log('   Dealer settings: Postgres ready ✅'))
    .catch(e => console.error('Dealer settings init error:', e.message))

  pool.query(`CREATE TABLE IF NOT EXISTS market_cache (
    cache_key TEXT PRIMARY KEY,
    market JSONB NOT NULL,
    cached_at TIMESTAMPTZ DEFAULT now()
  )`).then(() => console.log('   Market cache: Postgres ready ✅'))
    .catch(e => console.error('Market cache init error:', e.message))
  // A VIN's decode never changes, so we cache NeoVIN results permanently (one
  // paid decode per unique vehicle, ever). Every later appraisal of the same VIN
  // reads from here — no repeat NeoVIN call, no repeat cost.
  // Every appraisal where a human commits a number is a labelled example: two
  // methods made a prediction, and the appraiser decided what the car was worth.
  // Recording all three lets us measure which method is closer, in which
  // segments, and whether either carries a consistent bias worth correcting.
  pool.query(`CREATE TABLE IF NOT EXISTS appraisal_calibration (
    id SERIAL PRIMARY KEY,
    appraisal_id TEXT,
    vin TEXT,
    year TEXT, make TEXT, model TEXT, trim TEXT,
    odometer INTEGER,
    market_mid INTEGER,
    comp_count INTEGER,
    match_mode TEXT,
    formula_buy INTEGER,
    ai_buy INTEGER,
    final_value INTEGER NOT NULL,
    appraiser TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE (appraisal_id)
  )`).then(() => console.log('   Calibration log: Postgres ready ✅'))
    .catch(e => console.error('Calibration init error:', e.message))

  // Marks leads whose personal fields have been cleared by the retention sweep,
  // so the sweep doesn't reconsider them and we can tell "never had contact
  // details" apart from "had them, and they were removed on schedule".
  pool.query(`ALTER TABLE pending_leads ADD COLUMN IF NOT EXISTS anonymised_at TIMESTAMPTZ`)
    .catch(e => console.error('retention column:', e.message))

  // Who looked at whose personal details, and when. Needed if there's ever a
  // privacy complaint or a dispute about who saw what — and it can't be added
  // after the fact, because you can't reconstruct history you never recorded.
  pool.query(`CREATE TABLE IF NOT EXISTS access_log (
    id BIGSERIAL PRIMARY KEY,
    dealer_key TEXT NOT NULL DEFAULT 'default',
    actor TEXT,
    actor_id TEXT,
    action TEXT NOT NULL,
    subject TEXT,
    subject_id TEXT,
    detail JSONB,
    ip TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
  )`).then(() => pool.query(
      `CREATE INDEX IF NOT EXISTS access_log_time_idx ON access_log (dealer_key, created_at DESC)`))
    .then(() => console.log('   Access log: Postgres ready ✅'))
    .catch(e => console.error('Access log init error:', e.message))

  pool.query(`CREATE TABLE IF NOT EXISTS vin_decode_cache (
    vin TEXT PRIMARY KEY,
    decoded JSONB NOT NULL,
    source TEXT,
    cached_at TIMESTAMPTZ DEFAULT now()
  )`).then(() => console.log('   VIN decode cache: Postgres ready ✅'))
    .catch(e => console.error('VIN decode cache init error:', e.message))
} else {
  console.log('   Dealer-fee ledger: no DATABASE_URL — fee history disabled')
}
// True if the leads table is usable (DATABASE_URL present). Reported in /api/health.
const LEADS_DB = !!DATABASE_URL

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
// GET /api/trims?year=&make=&model= — the trims that ACTUALLY exist in the
// Canadian market for this year/make/model, from MarketCheck facets. Used to
// populate the appraisal form's trim picker so the value the appraiser selects
// always matches what the comp search expects (e.g. "Sport with EyeSight",
// not "Sport"). One cheap Inventory Search call, cached 30 days in Postgres.
app.get('/api/trims', strictLimiter, async (req, res) => {
  const year = (req.query.year || '').toString().trim()
  const make = (req.query.make || '').toString().trim()
  const model = (req.query.model || '').toString().trim()
  if (!make || !model) return res.status(400).json({ error: 'make and model required' })
  if (!MARKETCHECK_API_KEY) return res.json({ success: true, trims: [] })
  const key = `trims|${year}|${make}|${model}`.toLowerCase()
  // Cache hit
  if (pool) {
    try {
      const c = await pool.query(
        `SELECT market FROM market_cache WHERE cache_key=$1 AND cached_at > now() - interval '30 days'`, [key])
      if (c.rows[0]) return res.json({ success: true, trims: c.rows[0].market.trims || [], cached: true })
    } catch {}
  }
  try {
    const params = new URLSearchParams({
      api_key: MARKETCHECK_API_KEY, country: 'CA', car_type: 'used',
      make, model, rows: '1', facets: 'trim|0|60|1',
    })
    if (year) params.set('year', year)
    const r = await fetch(`${MC_HOST}/search/car/active?${params.toString()}`)
    if (!r.ok) throw new Error(`MarketCheck HTTP ${r.status}`)
    const d = await r.json()
    const raw = (d.facets && d.facets.trim) || []
    // Sort by frequency (facets already are), keep the label only.
    const trims = raw.map(t => t.item).filter(Boolean)
    if (pool && trims.length) {
      try {
        await pool.query(
          `INSERT INTO market_cache(cache_key, market) VALUES($1,$2)
           ON CONFLICT (cache_key) DO UPDATE SET market=$2, cached_at=now()`,
          [key, JSON.stringify({ trims })]
        )
      } catch {}
    }
    res.json({ success: true, trims })
  } catch (err) {
    console.error('trims error:', err.message)
    res.json({ success: true, trims: [] })   // never block the form
  }
})

app.get('/api/vin/:vin', strictLimiter, async (req, res) => {
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

    // ── Enrich with NeoVIN (cached, one paid decode per VIN ever) ──
    // NHTSA is weak on trim — often blank for Japanese/Korean makes. NeoVIN
    // returns the confirmed trim ("Sport with EyeSight"), drivetrain, engine and
    // colour, which is what the appraisal form actually needs. Only fills gaps /
    // upgrades weak values; never blanks out something NHTSA got right.
    try {
      const neo = await decodeVinRich(vin)
      if (neo) {
        if (neo.trim) decoded.series = neo.trim          // the big one
        if (neo.drivetrain) decoded.drivetrain = neo.drivetrain
        if (neo.engine) decoded.engine = neo.engine
        if (neo.transmission) decoded.transmission = neo.transmission
        if (neo.bodyType) decoded.bodyType = neo.bodyType
        // NOTE: colour is deliberately NOT auto-filled. Paint colour is not
        // encoded in the VIN for most makes, so NeoVIN infers it from a matched
        // build/listing record and is frequently WRONG (e.g. reports "Midnight
        // Black" for a white Sienna). A wrong colour propagates into the window
        // sticker and the ad, so the appraiser enters it from the actual car.
        // The decoder's guess is returned as a hint only.
        if (neo.extColour) decoded._extColourGuess = neo.extColour
        if (neo.intColour) decoded._intColourGuess = neo.intColour
        if (neo.year && !decoded.year) decoded.year = String(neo.year)
        if (neo.make && !decoded.make) decoded.make = neo.make
        if (neo.model && !decoded.model) decoded.model = neo.model
        decoded._decodeSource = 'neovin'
        if (neo.version) decoded._version = neo.version
        if (neo.msrp) decoded._msrp = neo.msrp
      }
    } catch (e) { /* NeoVIN optional — NHTSA result still returned */ }

    res.json({ success: true, data: decoded })
  } catch (err) {
    console.error('VIN decode error:', err.message)
    res.status(500).json({ error: 'VIN decode failed: ' + err.message })
  }
})

// ── CLAUDE AI — descriptions only ───────────────────────────────────
app.post('/api/claude', strictLimiter, async (req, res) => {
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

// ── APPRAISALS & INVENTORY ───────────────────────────────────────────
// Records are stored as the whole object in a `data` column, with the fields we
// actually query promoted to real columns. The appraisal object has ~50 fields
// and grows as features are added; mapping each one by hand would mean a schema
// change every time, and any field I forgot would be silently dropped on save —
// exactly the quiet failure that's hardest to notice.

const DEALER_KEY = process.env.DEALER_KEY || 'default'

function rowToRecord(r) {
  // The stored object is the source of truth; the columns are for querying.
  const d = r.data || {}
  return { ...d, id: r.id, updatedAt: r.updated_at, createdAt: r.created_at,
           _updatedBy: r.updated_by || '', _createdBy: r.created_by || '' }
}

function makeCrud(table, promote) {
  return {
    async list() {
      const r = await pool.query(
        `SELECT * FROM ${table} WHERE dealer_key=$1 AND deleted_at IS NULL
         ORDER BY updated_at DESC LIMIT 2000`, [DEALER_KEY])
      return r.rows.map(rowToRecord)
    },
    async upsert(rec, user) {
      const cols = promote(rec)
      const names = Object.keys(cols)
      const setList = names.map(n => `${n}=EXCLUDED.${n}`).join(', ')
      const placeholders = names.map((_, i) => `$${i + 5}`).join(', ')
      await pool.query(
        `INSERT INTO ${table} (id, dealer_key, data, updated_by, ${names.join(', ')})
         VALUES ($1,$2,$3,$4,${placeholders})
         ON CONFLICT (id) DO UPDATE SET
           data=EXCLUDED.data, updated_by=EXCLUDED.updated_by,
           updated_at=now(), ${setList}`,
        [rec.id, DEALER_KEY, JSON.stringify(rec), user || '', ...names.map(n => cols[n])])
    },
    async remove(id) {
      // Soft delete: on a shared dataset one person shouldn't be able to
      // destroy another's work with a mis-tap.
      await pool.query(
        `UPDATE ${table} SET deleted_at=now() WHERE id=$1 AND dealer_key=$2`, [id, DEALER_KEY])
    },
  }
}

const num = v => { const n = Number(v); return Number.isFinite(n) ? Math.round(n) : null }

const appraisalsRepo = makeCrud('appraisals', a => ({
  vin: a.vin || '', year: a.year || '', make: a.make || '', model: a.model || '',
  series: a.series || '', odometer: num(a.odometer), status: a.status || 'in_progress',
  appraised_value: num(a.appraisedValue), suggested_buy: num(a.suggestedBuy),
  first_name: a.firstName || '', last_name: a.lastName || '',
  phone: a.phone || '', email: a.email || '',
  finalized_at: a.finalizedAt || null, finalized_by: a.finalizedBy || null,
}))

const vehiclesRepo = makeCrud('vehicles', v => ({
  vin: v.vin || '', year: v.year || '', make: v.make || '', model: v.model || '',
  series: v.series || '', odometer: num(v.odometer), status: v.status || 'available',
  stock_number: v.stockNumber || '', cost: num(v.cost), price: num(v.price),
}))

function mountCrud(path, repo) {
  app.get(`/api/${path}`, requireTeamKey, async (req, res) => {
    if (!pool) return res.json({ success: true, items: [], dbConnected: false })
    try { res.json({ success: true, dbConnected: true, items: await repo.list() }) }
    catch (e) { console.error(`GET ${path}:`, e.message); res.status(500).json({ error: 'Could not load' }) }
  })
  app.put(`/api/${path}/:id`, requireTeamKey, async (req, res) => {
    if (!pool) return res.status(503).json({ error: 'No database' })
    const rec = req.body && req.body.record
    if (!rec || !rec.id) return res.status(400).json({ error: 'record with id required' })
    if (rec.id !== req.params.id) return res.status(400).json({ error: 'id mismatch' })
    try {
      await repo.upsert(rec, (req.body.user || '').toString().slice(0, 80))
      res.json({ success: true })
    } catch (e) { console.error(`PUT ${path}:`, e.message); res.status(500).json({ error: 'Could not save' }) }
  })
  app.delete(`/api/${path}/:id`, requireTeamKey, async (req, res) => {
    if (!pool) return res.status(503).json({ error: 'No database' })
    try { await repo.remove(req.params.id); res.json({ success: true }) }
    catch (e) { console.error(`DELETE ${path}:`, e.message); res.status(500).json({ error: 'Could not delete' }) }
  })
}

mountCrud('appraisals', appraisalsRepo)
mountCrud('vehicles', vehiclesRepo)

// Record an access to personal data. Fire-and-forget: an audit write must
// never fail the request it's describing, or the log becomes a reason for the
// app to break.
function logAccess(req, action, { subject, subjectId, detail } = {}) {
  if (!pool) return
  const actor = req.clerkEmail || req.clerkUserId || 'team-key'
  pool.query(
    `INSERT INTO access_log(dealer_key, actor, actor_id, action, subject, subject_id, detail, ip)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
    [DEALER_KEY, actor, req.clerkUserId || '', action, subject || '', String(subjectId || ''),
     detail ? JSON.stringify(detail) : null, (req.ip || '').slice(0, 45)]
  ).catch(e => console.error('access log:', e.message))
}

// ── Data retention ───────────────────────────────────────────────────
// An unconverted lead from two years ago is liability, not asset: it's personal
// data being held for no purpose, which PIPEDA asks us not to do. Rather than
// deleting the row and losing the ability to say how many enquiries we handled,
// the identifying fields are cleared and the rest kept. Runs daily; the window
// is configurable so it can be shortened without a deploy.
const RETENTION_DAYS = Number(process.env.LEAD_RETENTION_DAYS || 730)

async function anonymiseOldLeads() {
  if (!pool || !RETENTION_DAYS) return
  try {
    const r = await pool.query(
      `UPDATE pending_leads
          SET customer_name = NULL, customer_email = NULL, customer_phone = NULL,
              photos = NULL, anonymised_at = now()
        WHERE created_at < now() - ($1 || ' days')::interval
          AND anonymised_at IS NULL
          AND (customer_name IS NOT NULL OR customer_email IS NOT NULL OR customer_phone IS NOT NULL)`,
      [String(RETENTION_DAYS)]
    )
    if (r.rowCount) console.log(`   Retention: anonymised ${r.rowCount} lead(s) older than ${RETENTION_DAYS} days`)
  } catch (e) {
    console.error('retention sweep:', e.message)
  }
}

// ── Backup export ────────────────────────────────────────────────────
// Railway's managed backups need their Pro plan, so until that's on there is
// exactly one copy of this data. This produces a single file holding everything
// — appraisals, inventory, leads, settings, calibration history — that can be
// downloaded and kept somewhere else. Restoring is a manual job, but having the
// records at all is the part that matters.
app.get('/api/export', requireTeamKey, async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'No database' })
  // Every customer record leaving the system in one file — the most significant
  // disclosure available, so it's always recorded.
  logAccess(req, 'data.export', { subject: 'all' })
  try {
    const tables = ['appraisals', 'vehicles', 'pending_leads', 'dealer_settings',
                    'appraisal_calibration', 'dealer_fees', 'access_log']
    const out = {
      exportedAt: new Date().toISOString(),
      dealerKey: DEALER_KEY,
      note: 'Vantage backup. Keep somewhere other than the server this came from.',
      tables: {},
    }
    for (const t of tables) {
      try {
        const r = await pool.query(`SELECT * FROM ${t}`)
        out.tables[t] = r.rows
      } catch (e) {
        // A missing table shouldn't cost you the rest of the backup.
        out.tables[t] = { error: e.message }
      }
    }
    const stamp = new Date().toISOString().slice(0, 10)
    res.setHeader('Content-Type', 'application/json')
    res.setHeader('Content-Disposition', `attachment; filename="vantage-backup-${stamp}.json"`)
    res.send(JSON.stringify(out, null, 2))
  } catch (e) {
    console.error('export error:', e.message)
    res.status(500).json({ error: 'Could not build the export' })
  }
})

// Dealer settings — one row per dealership.
app.get('/api/dealer', requireTeamKey, async (req, res) => {
  if (!pool) return res.json({ success: true, settings: null })
  try {
    const r = await pool.query('SELECT settings FROM dealer_settings WHERE dealer_key=$1', [DEALER_KEY])
    res.json({ success: true, settings: r.rows[0]?.settings || null })
  } catch (e) { console.error('GET dealer:', e.message); res.status(500).json({ error: 'Could not load settings' }) }
})

app.put('/api/dealer', requireTeamKey, async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'No database' })
  const settings = req.body && req.body.settings
  if (!settings || typeof settings !== 'object') return res.status(400).json({ error: 'settings required' })
  try {
    await pool.query(
      `INSERT INTO dealer_settings (dealer_key, settings, updated_by)
       VALUES ($1,$2,$3)
       ON CONFLICT (dealer_key) DO UPDATE SET settings=$2, updated_by=$3, updated_at=now()`,
      [DEALER_KEY, JSON.stringify(settings), (req.body.user || '').toString().slice(0, 80)])
    res.json({ success: true })
  } catch (e) { console.error('PUT dealer:', e.message); res.status(500).json({ error: 'Could not save settings' }) }
})

// ── CALIBRATION ──────────────────────────────────────────────────────
// Record what the appraiser actually committed to, alongside what each method
// predicted. Upserted on appraisal_id so revising an offer replaces the row
// rather than logging the same car twice.
app.post('/api/calibration', async (req, res) => {
  if (!pool) return res.json({ success: true, stored: false })
  const b = req.body || {}
  const final = Number(b.finalValue)
  if (!Number.isFinite(final) || final <= 0) return res.status(400).json({ error: 'finalValue required' })
  try {
    await pool.query(
      `INSERT INTO appraisal_calibration
        (appraisal_id, vin, year, make, model, trim, odometer, market_mid, comp_count,
         match_mode, formula_buy, ai_buy, final_value, appraiser)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       ON CONFLICT (appraisal_id) DO UPDATE SET
         final_value=$13, formula_buy=$11, ai_buy=$12, market_mid=$8,
         comp_count=$9, match_mode=$10, odometer=$7, created_at=now()`,
      [b.appraisalId || null, (b.vin || '').toUpperCase(), b.year || '', b.make || '', b.model || '',
       b.trim || '', Number(b.odometer) || null, Number(b.marketMid) || null,
       Number(b.compCount) || null, b.matchMode || '', Number(b.formulaBuy) || null,
       Number(b.aiBuy) || null, Math.round(final), b.appraiser || '']
    )
    res.json({ success: true, stored: true })
  } catch (e) {
    console.error('calibration write:', e.message)
    res.json({ success: true, stored: false })
  }
})

// How well each method tracks the appraiser's decision.
app.get('/api/calibration/summary', requireTeamKey, async (req, res) => {
  if (!pool) return res.json({ success: true, n: 0 })
  try {
    const r = await pool.query(
      `SELECT * FROM appraisal_calibration WHERE final_value > 0 ORDER BY created_at DESC LIMIT 1000`)
    const rows = r.rows
    const stat = key => {
      const xs = rows.filter(x => Number(x[key]) > 0)
      if (!xs.length) return null
      // Signed error shows bias (is the method habitually high or low);
      // absolute error shows accuracy regardless of direction.
      const errs = xs.map(x => (Number(x[key]) - Number(x.final_value)) / Number(x.final_value) * 100)
      const mean = errs.reduce((t, v) => t + v, 0) / errs.length
      const absMean = errs.reduce((t, v) => t + Math.abs(v), 0) / errs.length
      const sorted = [...errs].sort((a, b) => a - b)
      return {
        n: xs.length,
        bias: Math.round(mean * 10) / 10,          // + = predicts above what we pay
        avgError: Math.round(absMean * 10) / 10,   // typical distance either way
        median: Math.round(sorted[Math.floor(sorted.length / 2)] * 10) / 10,
        within5: Math.round(errs.filter(v => Math.abs(v) <= 5).length / errs.length * 100),
      }
    }
    res.json({ success: true, n: rows.length, formula: stat('formula_buy'), ai: stat('ai_buy'),
      recent: rows.slice(0, 25).map(x => ({
        vin: x.vin, vehicle: [x.year, x.make, x.model, x.trim].filter(Boolean).join(' '),
        odometer: x.odometer, formulaBuy: x.formula_buy, aiBuy: x.ai_buy,
        finalValue: x.final_value, createdAt: x.created_at })) })
  } catch (e) {
    console.error('calibration summary:', e.message)
    res.status(500).json({ error: 'Could not load calibration' })
  }
})

// ── AI APPRAISAL ─────────────────────────────────────────────────────
// Claude writes the appraised number and the reasoning behind it, grounded in
// the actual comparable listings we just pulled. Two deliberate guardrails:
//   1. It only ever sees real comps — it is never asked to recall market prices
//      from memory, which is where a language model would invent numbers.
//   2. Its number is sanity-checked against the comp range. If it lands outside,
//      we return it flagged rather than silently trusting it.
app.post('/api/appraise', strictLimiter, async (req, res) => {
  const key = ANTHROPIC_KEY || ''
  if (!key || key === 'YOUR_ANTHROPIC_API_KEY_HERE') {
    return res.status(400).json({ error: 'Anthropic API key not configured.' })
  }
  const b = req.body || {}
  const v = b.vehicle || {}
  const m = b.market || {}
  const comps = Array.isArray(m.comps) ? m.comps.slice(0, 25) : []
  if (!comps.length) return res.status(400).json({ error: 'No comparable listings to appraise against.' })

  // Market-wide repricing signal. One dealer cutting is noise; most of the
  // market cutting means asking prices are ahead of what buyers will pay, and a
  // valuation built on today's asks will be too high.
  const repriced = comps.filter(c => Number.isFinite(c.priceChangePct) && c.priceChangePct !== 0)
  const cut = repriced.filter(c => c.priceChangePct < 0)
  const cutShare = comps.length ? Math.round((cut.length / comps.length) * 100) : 0
  const avgCut = cut.length
    ? Math.round(cut.reduce((t, c) => t + Math.abs(c.priceChangePct), 0) / cut.length * 10) / 10
    : 0
  const priceTrendLine = repriced.length
    ? `${cut.length} of ${comps.length} comparables have CUT their asking price (${cutShare}% of the set), averaging ${avgCut}% off. ${repriced.length - cut.length} raised.`
    : 'No comparables show a price change on record.'

  const compLines = comps.map(c =>
    `- ${c.year || ''} ${c.make || ''} ${c.model || ''} ${c.trim || ''} | ${
      Number.isFinite(c.mileage) ? c.mileage.toLocaleString('en-CA') + ' km' : 'km n/a'} | $${
      Number.isFinite(c.price) ? c.price.toLocaleString('en-CA') : '?'}${
      c.daysListed != null ? ` | ${c.daysListed}d listed` : ''}${c.certified ? ' | certified' : ''}${
      Number.isFinite(c.priceChangePct) && c.priceChangePct !== 0
        ? ` | repriced ${c.priceChangePct > 0 ? '+' : ''}${c.priceChangePct}%${c.prevPrice ? ` from $${Number(c.prevPrice).toLocaleString('en-CA')}` : ''}`
        : ''}`
  ).join('\n')

  const prompt = `You are appraising a used vehicle for a Canadian dealership that will BUY it and resell it.

SUBJECT VEHICLE
${v.year || ''} ${v.make || ''} ${v.model || ''} ${v.trim || ''}
Odometer: ${v.odometer ? Number(v.odometer).toLocaleString('en-CA') + ' km' : 'not provided'}
${v.condition ? `Condition noted: ${v.condition}` : ''}${v.accident ? `\nAccident history: ${v.accident}` : ''}${v.notes ? `\nAppraiser notes: ${v.notes}` : ''}

LIVE COMPARABLE LISTINGS (active retail asking prices, same market, pulled just now)
${compLines}

PRICE MOVEMENT
${priceTrendLine}

MARKET SUMMARY
Retail asking band: low $${m.marketLow || '?'} / mid $${m.marketMid || '?'} / high $${m.marketHigh || '?'}
Comps used: ${m.count || comps.length}${m.medianCompMileage ? ` | median comp odometer: ${Number(m.medianCompMileage).toLocaleString('en-CA')} km` : ''}${m.medianDaysListed ? ` | median days listed: ${m.medianDaysListed}` : ''}

TASK
Work only from the listings above — do not use remembered prices. Reason about how the
subject's odometer compares to the comps, how quickly this segment is moving, and any
condition or accident disclosure.

Weigh the price movement carefully. Asking prices are what sellers WANT, not what buyers
pay. If a large share of the set has cut prices, the asks are ahead of the market and the
band above overstates real value — price the buy number accordingly and say so plainly in
your reasoning. If prices are steady or rising, the band is trustworthy.

Then give:
  retail — what this vehicle realistically RETAILS for here
  buy — the maximum the dealer should PAY, leaving normal recon and margin
  reasoning — 2-4 sentences a manager can read and act on, in plain language
  confidence — "High", "Medium" or "Low" based on how many comps and how well they match

Respond with ONLY raw JSON, no markdown fences:
{"retail": 12345, "buy": 12345, "reasoning": "...", "confidence": "Medium"}`

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 900,
        messages: [{ role: 'user', content: prompt }],
      }),
    })
    const data = await r.json()
    if (data.error) return res.status(502).json({ error: data.error.message || 'AI request failed' })
    const text = (data.content || []).filter(x => x.type === 'text').map(x => x.text).join('').trim()
    let out
    try { out = JSON.parse(text.replace(/```json|```/g, '').trim()) }
    catch { return res.status(502).json({ error: 'AI returned an unreadable response.' }) }

    const retail = Number(out.retail), buy = Number(out.buy)
    if (!Number.isFinite(retail) || !Number.isFinite(buy)) {
      return res.status(502).json({ error: 'AI did not return usable numbers.' })
    }
    // Sanity check against the real comps — a value far outside the observed
    // range is reported as suspect rather than presented as fact.
    const prices = comps.map(c => c.price).filter(Number.isFinite)
    const lo = Math.min(...prices), hi = Math.max(...prices)
    const outOfBand = prices.length ? (retail < lo * 0.6 || retail > hi * 1.25 || buy > retail) : false

    res.json({
      success: true,
      retail: Math.round(retail),
      buy: Math.round(buy),
      reasoning: String(out.reasoning || '').slice(0, 1200),
      confidence: ['High', 'Medium', 'Low'].includes(out.confidence) ? out.confidence : 'Medium',
      outOfBand,
      compsUsed: comps.length,
      generatedAt: new Date().toISOString(),
    })
  } catch (err) {
    console.error('appraise error:', err.message)
    res.status(500).json({ error: 'Appraisal failed.' })
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
// Normalize a drivetrain string to a canonical bucket: 'awd', '2wd', or null.
// The meaningful price split is AWD/4WD vs everything else (FWD/RWD/2WD).
// NHTSA reports "4x2" (two-wheel) and "4x4" (four-wheel); dealers write
// FWD/AWD/etc. We bucket to awd vs 2wd so a FWD subject excludes AWD comps.
function normalizeDrive(s) {
  const t = (s || '').toString().toLowerCase()
  if (!t) return null
  if (/\b(awd|all.?wheel|4wd|4x4|four.?wheel|quattro|4motion|xdrive|4matic|sh.?awd)\b/.test(t)) return 'awd'
  if (/\b(fwd|front.?wheel|rwd|rear.?wheel|2wd|4x2|front|rear)\b/.test(t)) return '2wd'
  return null
}
// Detect drivetrain from a comp's free-text title/trim.
function detectDrive(text) {
  return normalizeDrive(text)
}

// Reduce a trim string to a clean token set for matching, dropping drivetrain
// and package noise so "LE FWD" and "LE w/Tech" both reduce to "le".
function normalizeTrim(s) {
  let t = (s || '').toString().toLowerCase()
  if (!t) return ''
  t = t
    // Drivetrain isn't trim — handled by its own filter.
    .replace(/\b(awd|fwd|rwd|4wd|2wd|4x4|4x2|all.?wheel|front.?wheel|rear.?wheel)\b/g, ' ')
    // Driver-assist / option packages that ride along with EVERY trim of a model
    // (Subaru EyeSight, Honda Sensing, Toyota Safety Sense...). Left in, they
    // become shared tokens that make unlike trims look alike.
    .replace(/\b(with|w)\s*\/?\s*(eyesight|sensing|safety\s*sense|technology|tech)\b.*$/g, ' ')
    .replace(/\bw\/.*$/g, ' ')
    // Body/transmission/market noise only. NOTE: do NOT strip words that are
    // real trim names on some makes — 'Convenience', 'Premium', 'Plus' and
    // 'Touring' are Subaru/Honda trims, and removing them collapsed distinct
    // trims into the same token set (a Convenience matched every EyeSight car).
    .replace(/\b(package|pkg|cvt|automatic|sedan|hatchback|coupe|wagon|us|canada|source)\b/g, ' ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return t
}
// True if the comp's normalized trim contains the subject trim token (whole-word).
function trimContains(compTrim, subjectTrim) {
  if (!subjectTrim) return true
  const tokens = compTrim.split(' ').filter(Boolean)
  const want = subjectTrim.split(' ').filter(Boolean)
  // require every subject token to appear in the comp trim tokens
  return want.every(w => tokens.includes(w))
}

// Remove price outliers so a few loaded/new high-trim units (or a stray cheap
// salvage) don't distort the band. Uses median ± k·MAD (median absolute
// deviation), which is robust to skew unlike mean/stddev. Only applied when we
// have enough comps to make a stable median (>= 8); below that every comp counts.
// Returns the kept comps (always >= 3 so we never wipe the set on a tight match).
function filterPriceOutliers(comps) {
  const priced = comps.filter(c => Number.isFinite(c.price) && c.price >= 1000)
  if (priced.length < 8) return comps
  const prices = priced.map(c => c.price).sort((a, b) => a - b)
  const median = percentile(prices, 0.50)
  const absDevs = prices.map(p => Math.abs(p - median)).sort((a, b) => a - b)
  let mad = percentile(absDevs, 0.50)
  // Guard: if MAD is tiny (very tight cluster), fall back to a % band so we
  // don't over-trim a legitimately consistent market.
  const floor = median * 0.18
  if (!mad || mad < floor) mad = floor
  const k = 3.0   // keep within 3 MADs of the median (~robust 99% band)
  const lo = median - k * mad
  const hi = median + k * mad
  const kept = comps.filter(c => !Number.isFinite(c.price) || (c.price >= lo && c.price <= hi))
  // Safety: never trim below 3 comps or below ~60% of the set.
  const keptPriced = kept.filter(c => Number.isFinite(c.price) && c.price >= 1000)
  if (keptPriced.length < Math.max(3, Math.floor(priced.length * 0.5))) return comps
  return kept
}

function computeMarketFromComps(comps) {
  const priced = comps.filter(c => Number.isFinite(c.price) && c.price >= 1000)
  if (priced.length === 0) return null
  const prices = priced.map(c => c.price).sort((a, b) => a - b)
  const miles = priced.map(c => c.mileage).filter(Number.isFinite).sort((a, b) => a - b)
  const daysArr = priced.map(c => c.days).filter(Number.isFinite).sort((a, b) => a - b)
  return {
    comps: priced.length,
    // Use the interquartile core (25th/50th/75th) so the headline band reflects
    // the bulk of the market rather than the extreme tails — after outlier
    // removal this keeps Low/Mid/High consistent with the comps actually shown.
    low: percentile(prices, 0.25),
    mid: percentile(prices, 0.50),
    high: percentile(prices, 0.75),
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
// Sold listings are segregated from active ones.
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

// Market Day Supply: how many days the local market would take to
// sell through current ACTIVE comparable inventory at the recent rate of sale.
//   MDS = (active comparable listings ÷ sold in the window) × window_days
// Lower = sells fast / liquid; higher = slow mover. Returns null if we can't
// measure a sales rate (no sold comps in the window).
function marketDaySupply(activeCount, soldInWindow, windowDays = 45) {
  if (!soldInWindow || soldInWindow <= 0) return null
  return Math.round((activeCount / soldInWindow) * windowDays)
}

// ── MARKET DATA PROVIDER ─────────────────────────────────────────────
// Switchable data source. VinAudit is left dormant (set MARKET_PROVIDER=vinaudit
// to revert). MarketCheck is the active provider. Both fetch functions return
// listings in the SAME field shape (VinAudit's), so mapComp() and all downstream
// logic (dedup, filtering, stats, MDS) work unchanged regardless of provider.
const MARKET_PROVIDER = (process.env.MARKET_PROVIDER || 'marketcheck').toLowerCase()
const MARKETCHECK_API_KEY = process.env.MARKETCHECK_API_KEY || ''
// Google Apps Script web-app URL that emails the team when a lead arrives.
// Unset = no notifications, everything else unaffected.
const LEAD_WEBHOOK_URL = process.env.LEAD_WEBHOOK_URL || ''
const MC_HOST = 'https://api.marketcheck.com/v2'

// Minimal FSA→lat/long resolver. MarketCheck searches by lat/long + radius; the
// customer's FSA (first 3 of postal) is enough to anchor the local market.
// A few high-value GTA FSAs are pinned precisely; else a province-letter bucket;
// else central Toronto.
const FSA_POINTS = {
  M: [43.6532, -79.3832], L: [43.70, -79.50], K: [45.40, -75.70], N: [43.00, -81.20],
  P: [46.50, -80.90],
}
function fsaToPoint(postal) {
  const fsa = (postal || '').trim().toUpperCase().slice(0, 3)
  const precise = {
    'M6H': [43.6690, -79.4300], 'M5V': [43.6426, -79.3986], 'M4C': [43.6890, -79.3120],
    'L4C': [43.8830, -79.4400], 'L5B': [43.5890, -79.6440], 'L6T': [43.7160, -79.6900],
  }
  if (precise[fsa]) return precise[fsa]
  return FSA_POINTS[fsa[0]] || [43.6532, -79.3832]
}

// Fetch from MarketCheck and normalize each listing into VinAudit's field shape
// so the rest of the pipeline is provider-agnostic. Filters to USED inventory
// (excludes new-car MSRP listings, which would inflate the market mid).
// NeoVIN toggle. Default ON for best accuracy (confirmed trim/drivetrain →
// tightest comps). Set USE_NEOVIN=false to run decode-free (pure NHTSA YMMT) —
// useful for conserving free-tier calls during testing.
// Bump to retire decodes captured under older, buggier parsing.
const DECODE_VERSION = 2
const USE_NEOVIN = (process.env.USE_NEOVIN || 'true').toLowerCase() !== 'false'

// ── VIN DECODE (NeoVIN-first, cached, with NHTSA fallback) ──────────
// Returns { year, make, model, trim, drivetrain, source }. Strategy:
//   1. Postgres cache (a VIN's decode never changes — free forever after first)
//   2. NeoVIN via MarketCheck ($0.08/call, but cached so paid once per VIN)
//   3. NHTSA YMMT (free floor — weak/blank trim, but always available)
// NeoVIN gives confirmed trim + drivetrain, which we feed into the MarketCheck
// search for a tight, correct comp set instead of an all-YMMT pull.
async function decodeVinNHTSA(vin) {
  try {
    const r = await fetch(`https://vpic.nhtsa.dot.gov/api/vehicles/decodevinvalues/${vin}?format=json`)
    const d = await r.json()
    const v = d.Results && d.Results[0]
    if (!v) return null
    const dr = (v.DriveType || '').toLowerCase()
    let drivetrain = ''
    if (/awd|all.?wheel/.test(dr)) drivetrain = 'AWD'
    else if (/4wd|4x4|four.?wheel/.test(dr)) drivetrain = '4WD'
    else if (/fwd|front/.test(dr)) drivetrain = 'FWD'
    else if (/rwd|rear/.test(dr)) drivetrain = 'RWD'
    return {
      year: v.ModelYear || '',
      make: v.Make ? (v.Make.charAt(0) + v.Make.slice(1).toLowerCase()) : '',
      model: v.Model || '',
      trim: v.Trim || v.Series || '',
      drivetrain,
      source: 'nhtsa',
      v: DECODE_VERSION,
    }
  } catch { return null }
}

// NeoVIN returns its answer at the top level when it has history for the VIN,
// and under data.generic[].<COUNTRY>[] when it doesn't ("NO HISTORY FOUND").
// Reading only the top level meant those VINs looked like decode failures and
// silently fell back to NHTSA — which supplies a body class where the trim
// should be, so a Tucson Plug-In Hybrid Ultimate came through as "Wagon Body
// Style" and matched nothing.
function neovinCore(payload) {
  const d = payload && (payload.data || payload)
  if (!d) return null
  if (d.trim || d.model) return d
  const generic = Array.isArray(d.generic) ? d.generic : []
  for (const entry of generic) {
    for (const country of ['CA', 'US']) {
      const arr = entry && entry[country]
      if (Array.isArray(arr) && arr.length && (arr[0].trim || arr[0].model)) return arr[0]
    }
  }
  return null
}

// Full NeoVIN field set for the appraisal form (cached alongside the search
// decode — same Postgres row, so still one paid decode per VIN ever).
async function decodeVinRich(vin) {
  if (!vin || vin.length !== 17 || !USE_NEOVIN || !MARKETCHECK_API_KEY) return null
  const V = vin.toUpperCase().trim()
  if (pool) {
    try {
      const r = await pool.query('SELECT decoded FROM vin_decode_cache WHERE vin=$1', [V])
      const hit = r.rows[0] && r.rows[0].decoded
      // Decodes captured while NeoVIN's generic fallback was being misparsed are
      // wrong and would be served forever, so anything without the current
      // version stamp is re-decoded.
      if (hit && hit.v === DECODE_VERSION && hit.trim !== undefined) return hit
    } catch {}
  }
  try {
    const url = `${MC_HOST}/decode/car/neovin/${V}/specs?api_key=${encodeURIComponent(MARKETCHECK_API_KEY)}`
    const r = await fetch(url)
    if (!r.ok) return null
    const d = await r.json()
    const v = neovinCore(d)
    if (!v || !v.make) return null
    const out = {
      year: v.year || '', make: v.make || '', model: v.model || '',
      trim: v.trim || '',
      version: v.version || '',
      drivetrain: normalizeDriveLabel(v.drivetrain, v.installed_equipment),
      engine: v.engine || '',
      transmission: v.transmission || '',
      bodyType: v.body_type || '',
      extColour: (v.exterior_color && v.exterior_color.name) || '',
      intColour: (v.interior_color && v.interior_color.name) || '',
      msrp: v.msrp || null,
      // A PHEV and a gas car of the same trim are different markets entirely,
      // so this has to reach the comp search.
      powertrain: v.powertrain_type || '',
      fuelType: v.fuel_type || '',
      source: 'neovin',
      v: DECODE_VERSION,
    }
    if (pool) {
      try {
        await pool.query(
          `INSERT INTO vin_decode_cache(vin, decoded, source) VALUES($1,$2,'neovin')
           ON CONFLICT (vin) DO UPDATE SET decoded=$2, source='neovin', cached_at=now()`,
          [V, JSON.stringify(out)]
        )
      } catch {}
    }
    return out
  } catch { return null }
}

// NeoVIN's `drivetrain` is unreliable for AWD crossovers — it reports "4WD" for
// cars the market lists as "AWD" (e.g. Subaru Crosstrek). Prefer the
// North-America 4WD type in installed_equipment when present.
function normalizeDriveLabel(dt, equipment) {
  let out = (dt || '').toUpperCase()
  try {
    const std = equipment && equipment.STANDARD
    if (Array.isArray(std)) {
      const na = std.find(e => e && /North America 4WD type/i.test(e.attribute || ''))
      if (na && na.value) out = String(na.value).toUpperCase()
    }
  } catch {}
  if (/ALL/.test(out)) return 'AWD'
  if (/FRONT/.test(out)) return 'FWD'
  if (/REAR/.test(out)) return 'RWD'
  if (/FOUR|4X4/.test(out)) return '4WD'
  return out
}

async function decodeVinNeoVIN(vin) {
  if (!MARKETCHECK_API_KEY) return null
  try {
    const url = `${MC_HOST}/decode/car/neovin/${vin}/specs?api_key=${encodeURIComponent(MARKETCHECK_API_KEY)}`
    const r = await fetch(url)
    if (!r.ok) return null
    const d = await r.json()
    const v = neovinCore(d)
    if (!v || !v.make || !v.model) return null
    // Normalize drivetrain (NeoVIN gives e.g. "4WD","AWD","FWD","RWD").
    let dt = (v.drivetrain || '').toUpperCase()
    if (/ALL/.test(dt)) dt = 'AWD'
    else if (/FOUR|4X4/.test(dt)) dt = '4WD'
    else if (/FRONT/.test(dt)) dt = 'FWD'
    else if (/REAR/.test(dt)) dt = 'RWD'
    return {
      year: v.year || '',
      make: v.make || '',
      model: v.model || '',
      trim: v.trim || '',
      drivetrain: dt || '',
      powertrain: v.powertrain_type || '',
      source: 'neovin',
      v: DECODE_VERSION,
    }
  } catch { return null }
}

async function decodeVinCached(vin) {
  if (!vin || vin.length !== 17) return null
  const V = vin.toUpperCase().trim()
  // 1. Cache hit → return immediately (no call, no cost).
  if (pool) {
    try {
      const r = await pool.query('SELECT decoded FROM vin_decode_cache WHERE vin=$1', [V])
      const hit = r.rows[0] && r.rows[0].decoded
      if (hit && hit.v === DECODE_VERSION) return hit
    } catch (e) { console.error('vin cache read:', e.message) }
  }
  // 2. NeoVIN (best) if enabled, else 3. NHTSA (free floor).
  let decoded = null
  if (USE_NEOVIN) decoded = await decodeVinNeoVIN(vin)
  if (!decoded) decoded = await decodeVinNHTSA(vin)
  if (!decoded) return null
  // Persist so this VIN is never decoded (or paid for) again.
  if (pool) {
    try {
      await pool.query(
        `INSERT INTO vin_decode_cache(vin, decoded, source) VALUES($1,$2,$3)
         ON CONFLICT (vin) DO UPDATE SET decoded=$2, source=$3, cached_at=now()`,
        [V, JSON.stringify(decoded), decoded.source || '']
      )
    } catch (e) { console.error('vin cache write:', e.message) }
  }
  return decoded
}

// Back-compat shim: the MarketCheck fetch used decodeVinYMMT for YMMT only.
async function decodeVinYMMT(vin) { return decodeVinCached(vin) }

async function fetchListingsMarketCheck({ vin, specId, match, status, postal, radius, callerTrim, callerDrive }) {
  if (!MARKETCHECK_API_KEY) throw new Error('MARKETCHECK_API_KEY not set')
  const isSold = status === 'dropped'
  // Sold/expired listings come from a separate endpoint (note the plural path).
  // They power Market Day Supply and, more importantly, let us tell whether the
  // car we're appraising has recently been through the market.
  const [lat, lon] = fsaToPoint(postal)
  // The app works in kilometres; MarketCheck's radius is in miles. Passing the
  // km figure straight through searched a far wider area than intended — a
  // 250km setting became 250mi before clamping — which is how Winnipeg dealers
  // turned up in a Toronto comp set. Free tier caps at 100mi (~160km).
  const radKm = Number(radius) || 160
  const radMiles = Math.min(100, Math.max(10, Math.round(radKm / 1.609344)))
  const base = isSold ? `${MC_HOST}/search/car/recents` : `${MC_HOST}/search/car/active`
  const params = isSold
    ? new URLSearchParams({
        api_key: MARKETCHECK_API_KEY,
        country: 'CA',
        latitude: String(lat),
        longitude: String(lon),
        radius: String(radMiles),
        rows: '50',
      })
    : new URLSearchParams({
        api_key: MARKETCHECK_API_KEY,
        country: 'CA',
        car_type: 'used',
        latitude: String(lat),
        longitude: String(lon),
        radius: String(radMiles),
        rows: '50',
        stats: 'price,miles',
      })
  // Search by SPEC (similar cars), not the exact VIN (MarketCheck's vin param
  // means the EXACT car → ~0 comps). Decode gives year+make+model always, plus
  // confirmed trim+drivetrain from NeoVIN. On a STRICT ('trim') match we add
  // trim+drivetrain to the search for a tight comp set; on a WIDENED ('model')
  // match we drop them to recover volume. Downstream filters still apply either
  // way, so trim in the query only tightens — it can't wrongly exclude.
  if (vin) {
    const dec = await decodeVinYMMT(vin)   // cached NeoVIN-first decode
    if (dec && dec.make && dec.model) {
      if (dec.year) params.set('year', String(dec.year))
      params.set('make', dec.make)
      params.set('model', dec.model)
      if (match === 'trim') {
        // Trim: prefer caller-supplied (frontend decode) else NeoVIN's.
        const trim = (callerTrim || dec.trim || '').trim()
        if (trim) params.set('trim', trim)
        // Powertrain is not a trim level but it separates markets just as hard:
        // a Tucson Plug-In Hybrid Ultimate and a gas Ultimate are different cars
        // at different money. Without this the comp set mixes them and the mid
        // lands between two markets, describing neither.
        const pt = (dec.powertrain || '').toUpperCase()
        if (pt === 'PHEV') params.set('fuel_type', 'PHEV')
        else if (pt === 'HEV') params.set('fuel_type', 'Hybrid')
        else if (pt === 'BEV' || pt === 'EV') params.set('fuel_type', 'Electric')
        // NOTE: we deliberately do NOT send drivetrain to MarketCheck. Decoder
        // and marketplace labels disagree (NeoVIN says "4WD" for a Subaru
        // Crosstrek the market lists as "AWD"), which silently returns ZERO
        // results and forces an unnecessary widen. The downstream matchesDrive
        // filter handles drivetrain correctly on the returned comps instead.
      }
    } else {
      params.set('vin', vin)   // decode failed → exact VIN beats nothing
    }
  } else if (specId) {
    // Spec search (no VIN): "2014_hyundai_santa fe sport" → year/make/model,
    // with the trim as a fourth part when we have one. Without this branch the
    // request carried no vehicle filter at all and MarketCheck returned any
    // used car in the country — which is why two different Hyundais came back
    // with identical comps, including dealers far outside the search radius.
    const parts = String(specId).split('_')
    const [yr, mk, ...rest] = parts
    // buildSpecId slugs each part, so "Santa Fe Sport" arrives as
    // "santa-fe-sport". Hyphens have to come back out as spaces or the search
    // looks for a model literally named "Santa-fe-sport" and matches nothing.
    const cap = w => w.replace(/-+/g, ' ').replace(/\b[a-z]/g, c => c.toUpperCase())
    if (/^\d{4}$/.test(yr)) params.set('year', yr)
    if (mk) params.set('make', cap(mk))
    if (rest.length) {
      // Everything after the make is the model, except a trailing trim segment
      // when the caller supplied one separately.
      const trimPart = (callerTrim || '').trim()
      const modelParts = trimPart && rest.length > 1 ? rest.slice(0, -1) : rest
      params.set('model', cap(modelParts.join(' ')))
      if (trimPart && match === 'trim') params.set('trim', trimPart)
    }
    const drive = (callerDrive || '').trim()
    if (drive && match === 'trim') params.set('drivetrain', drive)
  } else {
    // Neither a VIN nor a spec: refuse rather than return every used car in
    // Canada, which is what an unfiltered search does.
    throw new Error('No vehicle specified for market search')
  }
  const url = `${base}?${params.toString()}`
  const r = await fetch(url)
  if (!r.ok) {
    // The sold feed is supplementary: it powers Market Day Supply and the
    // "already on the market" check. If it fails, the appraisal should still
    // price off active listings rather than erroring out entirely.
    if (isSold) {
      console.error(`MarketCheck recents HTTP ${r.status} — continuing without sold data`)
      return []
    }
    throw new Error(`MarketCheck HTTP ${r.status}`)
  }
  const data = await r.json()
  const listings = Array.isArray(data.listings) ? data.listings : []
  return listings.map(l => {
    const b = l.build || {}
    return {
      id: l.id,
      vin: l.vin || '',
      listing_price: l.price,
      // MarketCheck normalises odometers to MILES, including on Canadian
      // listings. Verified against source: a Q5 the dealer advertises at
      // 132,000 km comes back as miles: 82020 (132000 * 0.621371 = 82021).
      // Canada runs on kilometres, so convert — leaving it raw understated
      // every comparable by ~1.61x and skewed the mileage adjustment.
      listing_mileage: Number.isFinite(Number(l.miles)) ? Math.round(Number(l.miles) * 1.609344) : null,
      days_seen: l.dom_active ?? l.dom,
      // Price history: ref_price is the previous asking price, so a listing that
      // has been cut tells us the seller isn't getting takers at the old number.
      ref_price: l.ref_price ?? null,
      price_change_percent: l.price_change_percent ?? null,
      certified_flag: l.is_certified === 1 || l.is_certified === true,
      listing_status: isSold ? 'dropped' : 'active',
      listing_drop_date: l.last_seen_at_date || '',
      name: (l.dealer && l.dealer.name) || l.source || 'Dealer',
      seller_type: l.seller_type || 'dealer',
      city: (l.dealer && l.dealer.city) || '',
      region: (l.dealer && l.dealer.state) || '',
      listing_title: l.heading || '',
      vehicle_year: b.year || '',
      vehicle_make: b.make || '',
      vehicle_model: b.model || '',
      vehicle_trim: b.trim || '',
      listing_vdp_url: l.vdp_url || '',
      listing_portal_urls: '', // MarketCheck has no aggregator links; dealer VDP is the source
    }
  })
}

// Provider dispatch.
async function fetchListings(args) {
  if (MARKET_PROVIDER === 'vinaudit') return fetchListingsVinAudit(args)
  return fetchListingsMarketCheck(args)
}

async function fetchListingsVinAudit({ vin, specId, match, status, postal, radius, historyDays }) {
  // VinAudit paginates with `page` (1-based) + `page_size` (default/typical 100).
  // The response includes `query_total` (total matches across all pages), so we
  // page until we've pulled them all. Bounded by MAX_PAGES for latency/cost.
  const PAGE_SIZE = 100
  const MAX_PAGES = 12          // up to ~1200 raw listings
  let all = []
  let queryTotal = null
  for (let page = 1; page <= MAX_PAGES; page++) {
    const params = new URLSearchParams({
      key: VINAUDIT_KEY,
      format: 'json',
      country: 'canada',
      listing_status: status,
      page_size: String(PAGE_SIZE),
      page: String(page),
      postal,
      radius: String(radius),
    })
    // Match by VIN spec (similar YMMT) or by an explicit spec_id (manual entry,
    // no VIN). spec_id takes precedence per VinAudit docs.
    if (specId) {
      params.set('spec_id', specId)
    } else {
      params.set('spec_vin', vin)
      params.set('spec_vin_match', match)   // 'trim' (strict) or 'model'
    }
    if (status === 'dropped' && historyDays) params.set('history_days', String(historyDays))
    const url = `https://marketlistings.vinaudit.com/v1/listings?${params.toString()}`
    const r = await fetch(url)
    if (!r.ok) throw new Error(`VinAudit HTTP ${r.status}`)
    const data = await r.json()
    if (data.error) throw new Error(data.error)
    const listings = Array.isArray(data.listings) ? data.listings : []
    if (queryTotal == null) queryTotal = Number(data.query_total) || null
    all = all.concat(listings)
    // Stop conditions: short page (no more data), or we've pulled query_total.
    if (listings.length < PAGE_SIZE) break
    if (queryTotal != null && all.length >= queryTotal) break
  }
  return all
}

const STALE_DAYS = Number(process.env.STALE_DAYS || 200)
const MIN_FRESH_COMPS = Number(process.env.MIN_FRESH_COMPS || 3)
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
    // Previous asking price and the % move, when the listing has been repriced.
    prevPrice: Number.isFinite(Number(l.ref_price)) ? Number(l.ref_price) : null,
    priceChangePct: Number.isFinite(Number(l.price_change_percent)) ? Number(l.price_change_percent) : null,
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
    // A listing with no odometer can't be compared on the thing that drives
    // used value most. It would still pull the price band around while telling
    // us nothing about why it's priced where it is, so it's dropped outright.
    .filter(c => c.price && c.price >= 1000 && Number.isFinite(c.mileage) && c.mileage > 0)
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

// Shared market-response builder: takes already-fetched active/dropped listing
// arrays plus context, runs dedup/filter/band, and sends the JSON response.
// Used by both the VIN endpoint and the manual spec_id endpoint.
async function buildMarketResponse(active, dropped, ctx, res) {
  // cacheKey is optional: only the VIN route caches (spec searches vary too much
  // to key reliably). When absent we simply don't store.
  const { req, radius, match, widened, historyWidened, historyDays, cacheKey } = ctx
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
    // If the car we're appraising is itself advertised somewhere, that matters:
    // the customer may be shopping it privately, or another dealer already has
    // it listed. Flag the match and keep it out of the pricing set — a car can't
    // be its own comparable.
    const subjectVin = (req.params.vin || '').toUpperCase().trim()
    let subjectListing = null
    const allComps = buildComps(deduped).map(c => {
      const k = dealerKey(c.dealer)
      if (known[k]) c.feeWarning = { avgFee: known[k].avgFee, count: known[k].count }
      if (subjectVin && c.vin && c.vin.toUpperCase() === subjectVin) {
        c.isSubject = true
        subjectListing = {
          // 'sold' = the listing has dropped off the market (usually sold);
          // 'active' = it is advertised right now.
          status: c.status === 'dropped' ? 'sold' : 'active',
          price: c.price, mileage: c.mileage, days: c.days,
          dealer: c.dealer, sellerType: c.sellerType, url: c.url,
          city: c.city, region: c.region, dropDate: c.dropDate || '',
          prevPrice: c.prevPrice, priceChangePct: c.priceChangePct,
        }
      }
      return c
    }).filter(c => !c.isSubject)
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

    // ── Trim-level matching ──
    // If the caller specifies the subject's trim (e.g. "LE"), keep only comps
    // whose trim/title contains that trim token — so an LE subject isn't priced
    // against SE/XSE. Matching is token-based and case-insensitive, and tolerant
    // of suffixes ("LE FWD", "LE w/Tech"). Comps with no trim info are kept.
    let trimMixed = false, trimMatchCount = null
    const subjectTrim = normalizeTrim(req.query.trim)
    if (subjectTrim) {
      const matchesTrim = c => {
        const ct = normalizeTrim(`${c.trim || ''} ${c.title || ''}`)
        if (!ct) return true               // no trim info → keep
        return trimContains(ct, subjectTrim)
      }
      const beforeA = activeComps.length
      const fa = activeComps.filter(matchesTrim)
      const fs = soldComps.filter(matchesTrim)
      if (fa.length >= Math.min(3, beforeA)) { activeComps = fa; soldComps = fs }
      else {
        // Too few same-trim comps to price against. We keep the wider set so the
        // appraiser still gets a band, but flag it — silently showing other
        // trims as if they were matches is how a bad number gets trusted.
        trimMixed = true
        trimMatchCount = fa.length
      }
    }

    // ── Price-outlier trim ──
    // After trim/drivetrain matching, drop price outliers (e.g. loaded Lariat/
    // Platinum or brand-new MSRP units that slipped through an "XLT" match, or a
    // stray salvage unit) so the headline band, the displayed comps, and the
    // suggested retail are all consistent with the real used-market cluster.
    activeComps = filterPriceOutliers(activeComps)
    soldComps = filterPriceOutliers(soldComps)

    // ── Stale-listing trim ──
    // A car listed for 200+ days is usually one of two things: sold long ago and
    // never removed from the dealer's site, or priced so far off the market that
    // nobody wants it. Either way its asking price is not evidence of value, and
    // leaving it in drags the band. Dropped unless doing so leaves too little to
    // price against, in which case we keep the full set and flag it — a thin
    // stale-based estimate is better than none, provided we say so.
    let staleDropped = 0, staleFallback = false
    {
      const fresh = activeComps.filter(c => !(Number(c.days) > STALE_DAYS))
      if (fresh.length >= MIN_FRESH_COMPS) {
        staleDropped = activeComps.length - fresh.length
        activeComps = fresh
      } else if (fresh.length < activeComps.length) {
        staleFallback = true   // not enough fresh comps — keep stale, but say so
      }
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

    const payload = {
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
        trimMixed,                // true = comps include OTHER trims (too few exact)
        trimMatchCount,           // how many comps actually matched the subject trim
        subjectTrim: req.query.trim || '',
        comps: stats.comps,       // ACTIVE listings the estimate rests on
        activeCount: activeComps.length,
        droppedCount: soldComps.length,
        soldInWindow,             // sold comps counted toward MDS (≤45d)
        mdsWindow: MDS_WINDOW,
        deduped: blended.length - deduped.length,  // duplicate VINs removed
        radius,
        historyDays,              // archived window actually used (60 unless widened)
        historyWidened,           // true if we reached past 60 days for more comps
        shapeVersion: MARKET_SHAPE_VERSION,  // lets clients spot data from an older comp shape
        subjectListing,           // the appraised VIN found among active or sold listings
        staleDropped,             // listings excluded for sitting past STALE_DAYS
        staleFallback,            // true = too few fresh comps, stale ones kept
        staleDays: STALE_DAYS,
        country: 'canada',
        ...(rawHostsDebug ? { rawHostsDebug } : {}),
      },
    }
    // Store so repeat lookups of the same vehicle are free for 24h — this is what
    // makes auto-fetching on the appraisal page affordable on a metered plan.
    if (cacheKey) setCachedMarket(cacheKey, payload).catch(() => {})
    res.json(payload)
}

app.get('/api/market/:vin', strictLimiter, async (req, res) => {
  const vin = req.params.vin.toUpperCase().trim()
  const postal = (req.query.postal || '').toString().trim()
  // Radius up to national coverage (Canada ~5500km wide) so rare cars can pull
  // comps from anywhere. VinAudit may still cap internally, but we don't clamp.
  const radius = Math.min(Number(req.query.radius) || 250, 6000)
  let historyDays = Number(req.query.history_days) || 60
  // Caller-supplied trim/drivetrain (from the frontend's own VIN decode). Fed
  // into the MarketCheck search on strict matches for a tight comp set; falls
  // back to NeoVIN's decode inside the fetch when absent.
  const callerTrim = (req.query.trim || '').toString().trim()
  const callerDrive = (req.query.drivetrain || '').toString().trim()

  if (vin.length !== 17) return res.status(400).json({ error: 'VIN must be 17 characters' })
  if (!postal) return res.status(400).json({ error: 'postal code required' })
  if (MARKET_PROVIDER === 'marketcheck' ? !MARKETCHECK_API_KEY : (!VINAUDIT_KEY || VINAUDIT_KEY === 'YOUR_VINAUDIT_API_KEY_HERE')) {
    return res.status(400).json({ error: 'Market data API key not configured.' })
  }

  // 24h cache. The appraisal route previously bypassed it, so every lookup was a
  // fresh paid MarketCheck call — which is why fetching was a manual button.
  // Keyed on everything that changes the answer so a trim change still refetches.
  const mktKey = `mkt|${MARKET_SHAPE_VERSION}|${vin}|${(postal||'').toUpperCase().slice(0,3)}|${radius}|${callerTrim.toLowerCase()}|${callerDrive.toLowerCase()}`
  if (!/^(1|true)$/i.test(String(req.query.refresh || ''))) {
    const cached = await getCachedMarket(mktKey)
    if (cached) return res.json({ ...cached, meta: { ...(cached.meta || {}), cached: true } })
  }

  try {
    // Try strict (trim) match first; widen to model if too few comps.
    let match = 'trim'
    let active = [], dropped = []
    try {
      ;[active, dropped] = await Promise.all([
        fetchListings({ vin, match, status: 'active', postal, radius, callerTrim, callerDrive }),
        fetchListings({ vin, match, status: 'dropped', postal, radius, historyDays, callerTrim, callerDrive }),
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
        fetchListings({ vin, match, status: 'active', postal, radius, callerTrim, callerDrive }),
        fetchListings({ vin, match, status: 'dropped', postal, radius, historyDays, callerTrim, callerDrive }),
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
      dropped = await fetchListings({ vin, match, status: 'dropped', postal, radius, historyDays, callerTrim, callerDrive })
    }

    // Blend: dropped (closer to transacted) + active (current asking),
    // then collapse duplicate VINs so stats and comps count UNIQUE cars.
    await buildMarketResponse(active, dropped, { req, radius, match, widened, historyWidened, historyDays, cacheKey: mktKey }, res)
  } catch (err) {
    console.error('VinAudit market error:', err.message)
    res.status(500).json({ error: 'Market data failed: ' + err.message })
  }
})

// Manual market lookup by year/make/model/trim (no VIN). The client builds a
// spec_id like "2024_toyota_corolla_le" (or partial: "2024_toyota_corolla").
app.get('/api/market-by-spec', strictLimiter, async (req, res) => {
  const specId = (req.query.spec_id || '').toString().trim().toLowerCase()
  const postal = (req.query.postal || '').toString().trim()
  const radius = Math.min(Number(req.query.radius) || 250, 6000)
  let historyDays = Number(req.query.history_days) || 60

  if (!specId) return res.status(400).json({ error: 'spec_id required (year_make_model[_trim])' })
  if (!postal) return res.status(400).json({ error: 'postal code required' })
  if (MARKET_PROVIDER === 'marketcheck' ? !MARKETCHECK_API_KEY : (!VINAUDIT_KEY || VINAUDIT_KEY === 'YOUR_VINAUDIT_API_KEY_HERE')) {
    return res.status(400).json({ error: 'Market data API key not configured.' })
  }

  try {
    let active = [], dropped = []
    ;[active, dropped] = await Promise.all([
      fetchListings({ specId, status: 'active', postal, radius }),
      fetchListings({ specId, status: 'dropped', postal, radius, historyDays }),
    ])
    // History widening if sparse.
    let historyWidened = false
    for (const step of [180, 365]) {
      if (active.length + dropped.length >= MIN_COMPS) break
      if (step <= historyDays) continue
      historyDays = step; historyWidened = true
      dropped = await fetchListings({ specId, status: 'dropped', postal, radius, historyDays })
    }
    // spec_id is already trim-precise; match label reflects whether a trim was given.
    const match = specId.split('_').length >= 4 ? 'trim' : 'model'
    await buildMarketResponse(active, dropped, { req, radius, match, widened: false, historyWidened, historyDays }, res)
  } catch (err) {
    console.error('VinAudit spec market error:', err.message)
    res.status(500).json({ error: 'Market data failed: ' + err.message })
  }
})

// ── Check Fees ───────────────────────────────────────────────────────
// Fetch ONE listing page on demand, extract fees ADDED on top of the
// advertised price, and record positives so the dealer can be flagged later.
app.post('/api/fees', strictLimiter, async (req, res) => {
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
// ── CUSTOMER TRADE-IN LEADS (embeddable widget → pending appraisal) ──
// The widget posts vehicle + contact info; we compute the SAME suggested-buy
// number Vantage shows the appraiser (no consumer haircut), then apply ONE
// exception: a customer-declared accident deducts per the claim-$ rule.

// Server-side money formatter (mirrors the client's fmt used in breakdown text).
function fmtMoney(n) {
  if (n == null || !Number.isFinite(Number(n))) return '$—'
  return '$' + Math.round(Number(n)).toLocaleString('en-CA')
}

// Offer math now lives in the SHARED brain (shared/suggestedBuy.js) so the widget
// and Vantage's appraisal page compute the identical number. Imported at top of
// file as computeSuggestedBuy / confidenceFrom / accidentDeduction.

// Default dealer config mirrors the client DEFAULT_DEALER pricing strategy.
// (Single-dealer for now; later this is looked up by dealer_key.)
const WIDGET_DEALER = { marketPositionPct: 97, targetGross: 2500, avgRecon: 1500 }

// Fetch market mid + MDS + comp count for a VIN or spec, reusing the same
// VinAudit path as /api/market. Returns { mid, mds, compCount } or null.

// ── 24h market cache (Postgres-backed) ──
const MARKET_CACHE_TTL_HOURS = 24
// Bump when the comp object gains or changes fields, so cached payloads from an
// older shape are not served as though they were complete.
const MARKET_SHAPE_VERSION = 'v4-subjectvin'
// Build a stable cache key from VIN-or-spec + FSA (first 3 of postal). FSA-level
// keying means nearby customers share a warm entry and the comp set is the same.
function marketCacheKey({ vin, specId, postal }) {
  const fsa = (postal || '').toString().toUpperCase().replace(/\s+/g, '').slice(0, 3)
  const subject = vin && vin.length === 17 ? `vin:${vin}` : `spec:${specId || ''}`
  return `${subject}|${fsa}`
}
async function getCachedMarket(key) {
  if (!pool) return null
  try {
    const r = await pool.query(
      `SELECT market FROM market_cache
       WHERE cache_key = $1 AND cached_at > now() - interval '${MARKET_CACHE_TTL_HOURS} hours'`,
      [key]
    )
    return r.rows[0]?.market || null
  } catch (e) { console.error('getCachedMarket error:', e.message); return null }
}
async function setCachedMarket(key, market) {
  if (!pool || !market) return
  try {
    await pool.query(
      `INSERT INTO market_cache(cache_key, market, cached_at)
       VALUES($1, $2, now())
       ON CONFLICT (cache_key) DO UPDATE SET market = $2, cached_at = now()`,
      [key, JSON.stringify(market)]
    )
  } catch (e) { console.error('setCachedMarket error:', e.message) }
}

// Cached wrapper: returns { mid, mds, compCount, _cached } or null. Hits the
// 24h cache first; on miss, runs the full (unlimited, accurate) fetch and stores.
async function marketForLead(args) {
  const key = marketCacheKey(args)
  const hit = await getCachedMarket(key)
  if (hit) return { ...hit, _cached: true }
  const fresh = await marketForLeadRaw(args)
  if (fresh) await setCachedMarket(key, fresh)
  return fresh ? { ...fresh, _cached: false } : null
}

async function marketForLeadRaw({ vin, specId, postal }) {
  // The free tier caps the search at 100mi regardless, so asking for 6000km was
  // misleading — it silently became ~160km. Stating the real figure keeps the
  // customer's quote and the appraiser's comps drawn from the same market.
  const radius = 160
  let match = 'trim', active = [], dropped = []
  try {
    ;[active, dropped] = await Promise.all([
      fetchListings({ vin, specId, match, status: 'active', postal, radius }),
      fetchListings({ vin, specId, match, status: 'dropped', postal, radius, historyDays: 60 }),
    ])
  } catch { active = []; dropped = [] }
  if (!specId && active.length + dropped.length < MIN_COMPS) {
    match = 'model'
    ;[active, dropped] = await Promise.all([
      fetchListings({ vin, match, status: 'active', postal, radius }),
      fetchListings({ vin, match, status: 'dropped', postal, radius, historyDays: 60 }),
    ])
  }
  // Mirror the proven /api/market chain EXACTLY so the mid matches the appraisal
  // page: blend → dedupe by VIN → build comps → split active/sold → outlier filter.
  const blended = [...dropped, ...active]
  const deduped = dedupeByVin(blended)
  const allComps = buildComps(deduped)
  const SOLD_MAX_AGE_DAYS = 30
  let activeComps = allComps.filter(c => c.status !== 'dropped')
  let soldComps = allComps.filter(c => c.status === 'dropped' && (c.days == null || c.days <= SOLD_MAX_AGE_DAYS))
  activeComps = filterPriceOutliers(activeComps)
  soldComps = filterPriceOutliers(soldComps)
  const stats = computeMarketFromComps(activeComps)
  if (!stats) return null
  const mds = marketDaySupply(activeComps.length, soldComps.length, 45)
  // Return lightweight comps (price+mileage only) so the shared brain can run
  // the price↔km regression. Cached in market_cache alongside mid/mds.
  const comps = activeComps.map(c => ({ price: c.price, mileage: c.mileage }))
  return { mid: stats.mid, mds, compCount: activeComps.length, comps }
}

// POST /api/leads — widget submission. Computes the offer and (if DB present)
// stores it as a pending lead. Returns the offer even with no DB so the widget
// works during setup.
app.post('/api/leads', leadSubmitLimiter, async (req, res) => {
  try {
    const b = req.body || {}
    const name = (b.customerName || '').toString().trim().slice(0, 120)
    const email = (b.customerEmail || '').toString().trim().slice(0, 200)
    const phone = (b.customerPhone || '').toString().trim().slice(0, 40)
    if (!name) return res.status(400).json({ error: 'Name is required' })
    if (!email && !phone) return res.status(400).json({ error: 'Email or phone is required' })
    // Honeypot: bots fill hidden fields. If present and non-empty, silently accept
    // (200) without persisting, so the bot thinks it succeeded.
    if (b.website || b.company || b._hp) return res.json({ ok: true })

    const vin = (b.vin || '').toString().toUpperCase().trim()
    if (vin && !isVin(vin)) return res.status(400).json({ error: 'Invalid VIN' })
    const postal = (b.postal || '').toString().trim().slice(0, 10)
    // Where the customer came from, so we can tell which channel actually
    // produces leads. Restricted to a short slug — it's shown in the inbox and
    // written to the database, so it shouldn't carry arbitrary text.
    const source = ((b.source || 'widget').toString().trim().toLowerCase()
      .replace(/[^a-z0-9_-]/g, '').slice(0, 32)) || 'widget'
    if (!postal || !isPostal(postal)) return res.status(400).json({ error: 'Valid postal code is required' })

    let year = (b.year || '').toString().trim().slice(0, 4)
    let make = (b.make || '').toString().trim().slice(0, 40)
    let model = (b.model || '').toString().trim().slice(0, 60)
    let trim = (b.trim || '').toString().trim().slice(0, 60)

    // If a VIN is given, decode YMMT from NHTSA so the lead carries clean specs.
    if (vin.length === 17) {
      try {
        const dr = await fetch(`https://vpic.nhtsa.dot.gov/api/vehicles/decodevinvalues/${vin}?format=json`)
        const dd = await dr.json()
        const r = dd.Results?.[0]
        if (r && r.ErrorCode !== '8') {
          year = year || r.ModelYear || ''
          make = make || (r.Make ? r.Make.charAt(0) + r.Make.slice(1).toLowerCase() : '')
          model = model || r.Model || ''
          trim = trim || r.Series || r.Trim || ''
        }
      } catch {}
    }

    if (!vin && !(year && make && model)) {
      return res.status(400).json({ error: 'Provide a VIN, or year + make + model' })
    }

    // Market lookup (same engine as the appraisal page).
    let market = null
    const specId = !vin
      ? [year, make, model, trim].filter(Boolean).map(s => s.toLowerCase().replace(/\s+/g, '-')).join('_')
      : null
    try {
      market = await marketForLead({ vin: vin.length === 17 ? vin : undefined, specId, postal })
    } catch (e) { console.error('lead market error:', e.message) }

    // If the market lookup comes back empty, we DON'T lose the lead — persist it
    // flagged for specialist follow-up (no offer). Capturing the customer is the
    // whole point; a thin VinAudit response shouldn't drop them.
    const noMarket = !market || !market.mid
    const odometer = b.odometer != null && b.odometer !== '' ? Math.round(Number(b.odometer)) : null

    // Suggested buy (only when we have market data).
    const sb = noMarket ? null : computeSuggestedBuy(
      { marketMid: market.mid, marketDaysSupply: market.mds, make, comps: market.comps, odometer },
      WIDGET_DEALER
    )

    // The ONLY consumer adjustment: declared accident.
    const accident = !!b.accident
    const accidentAmount = b.accidentAmount != null && b.accidentAmount !== '' ? Number(b.accidentAmount) : null
    const deduction = accidentDeduction(accident, accidentAmount)
    // No market → no offer (specialist lead). Otherwise compute as usual.
    const offer = sb ? Math.max(0, sb.suggested - deduction) : null
    const confidence = sb ? sb.confidence : null
    // Gates that withhold the number (lead still persists for follow-up):
    //  • No market data at all (thin VinAudit response for this postal).
    //  • Thin market: too few comps for a stable number.
    //  • Extreme mileage: subject km far outside comps.
    const MIN_OFFER_COMPS = 6
    const thinMarket = noMarket || (Number(market?.compCount) || 0) < MIN_OFFER_COMPS
    const extremeKm = sb ? sb.kmExtreme === true : false

    // Customer-reported detail — appraiser context only, does NOT affect the offer.
    const clean = v => (v == null ? null : String(v).trim().slice(0, 2000) || null)
    const conditionOpinion = clean(b.conditionOpinion)
    const knownIssues = clean(b.knownIssues)
    const tireCondition = clean(b.tireCondition)
    const brakeCondition = clean(b.brakeCondition)
    const ownership = clean(b.ownership)
    const lienHolder = clean(b.lienHolder)
    const lienBalance = b.lienBalance != null && b.lienBalance !== '' ? Math.round(Number(b.lienBalance)) : null
    // Photos: array of compressed data-URLs from the widget. Cap count + total size.
    let photos = Array.isArray(b.photos) ? b.photos.filter(p => typeof p === 'string' && p.startsWith('data:image')) : []
    photos = photos.slice(0, 12)
    // Guard against oversized payloads (compressed client-side, but double-check).
    const totalBytes = photos.reduce((s, p) => s + p.length, 0)
    if (totalBytes > 8 * 1024 * 1024) photos = photos.slice(0, 6) // hard cap ~8MB

    const breakdown = sb ? {
      reasons: sb.reasons,
      targetRetail: sb.targetRetail,
      gross: sb.gross,
      recon: sb.recon,
      baseOffer: sb.suggested,
      accidentDeduction: deduction,
      ...(deduction ? { accidentNote: accidentAmount ? `Declared accident claim/estimate ${fmtMoney(accidentAmount)} → −${fmtMoney(deduction)}` : `Declared accident (amount not provided) → −${fmtMoney(deduction)}` } : {}),
    } : { note: 'No market comps found for this vehicle/postal at submission — specialist follow-up.' }

    // Persist if DB available; otherwise still return the offer.
    let leadId = null
    let duplicate = false
    if (pool) {
      // Don't record the same enquiry twice. Catches a customer double-tapping
      // Submit, and blunts the cheapest form of abuse — replaying one payload —
      // which would otherwise bury real leads in the inbox. The customer still
      // gets their offer; only the duplicate row is suppressed.
      try {
        const dupe = await pool.query(
          `SELECT id FROM pending_leads
           WHERE created_at > now() - interval '30 minutes'
             AND coalesce(customer_email,'') = $1
             AND coalesce(customer_phone,'') = $2
             AND coalesce(vin,'') = $3
             AND coalesce(year,'') = $4 AND coalesce(make,'') = $5 AND coalesce(model,'') = $6
           LIMIT 1`,
          [email, phone, vin, year, make, model]
        )
        if (dupe.rows[0]) { leadId = dupe.rows[0].id; duplicate = true }
      } catch (e) { console.error('lead dupe check:', e.message) }
    }
    if (pool && !duplicate) {
      try {
        const ins = await pool.query(
          `INSERT INTO pending_leads
            (dealer_key,vin,year,make,model,trim,odometer,postal,accident,accident_amount,
             customer_name,customer_email,customer_phone,offer_amount,base_offer,accident_deduction,
             offer_breakdown,market_mid,confidence,thin_market,
             condition_opinion,known_issues,tire_condition,brake_condition,ownership,lien_holder,lien_balance,photos,
             status,source)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
             $21,$22,$23,$24,$25,$26,$27,$28,'pending',$29)
           RETURNING id`,
          [(b.dealer || '').toString().trim(), vin, year, make, model, trim, odometer, postal,
           accident, accidentAmount, name, email, phone, offer, sb ? sb.suggested : null, deduction,
           JSON.stringify(breakdown), market ? market.mid : null, confidence, thinMarket,
           conditionOpinion, knownIssues, tireCondition, brakeCondition, ownership, lienHolder, lienBalance,
           photos.length ? JSON.stringify(photos) : null, source]
        )
        leadId = ins.rows[0]?.id || null
      } catch (e) { console.error('lead insert error:', e.message) }
    }

    // Notify the team. A trade-in lead is only worth what it's worth if someone
    // calls quickly, and nobody watches a dashboard all day. Fire-and-forget:
    // the customer's offer must never wait on, or fail because of, an email.
    if (LEAD_WEBHOOK_URL && !duplicate) {
      const summary = {
        leadId,
        vehicle: [year, make, model, trim].filter(Boolean).join(' '),
        vin,
        odometer: odometer ? Number(odometer).toLocaleString('en-CA') + ' km' : '',
        customerName: name, customerEmail: email, customerPhone: phone,
        postal,
        source,
        offer: market && market.mid ? market.mid : null,
        confidence,
        thinMarket,
        submittedAt: new Date().toLocaleString('en-CA', { timeZone: 'America/Toronto' }),
        // A few photos, not all of them: the customer may send twelve, and
        // Gmail caps attachments at 25MB. Four is enough to judge condition
        // from a phone, and the rest are waiting in the lead itself.
        photos: photos.slice(0, 4),
      }
      fetch(LEAD_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(summary),
      }).catch(e => console.error('lead notify failed:', e.message))
    }

    // Withhold the number when EITHER gate trips; give the customer the reason.
    const withhold = thinMarket || extremeKm
    let customerMessage
    if (extremeKm) {
      customerMessage = "Because of your vehicle's mileage, we want a specialist to confirm an accurate offer for you. Someone will be in touch shortly."
    } else if (thinMarket) {
      customerMessage = "The market for your vehicle is limited right now, so we want a specialist to give you an accurate offer. Someone will be in touch shortly."
    }

    // On LOW-confidence offers (data's a bit thin but km is normal) we present a
    // ±3% RANGE instead of a single number — honest about the uncertainty without
    // killing the lead. High/Medium confidence show the precise number.
    let offerRange = null
    if (!withhold && confidence === 'Low' && offer > 0) {
      offerRange = { low: Math.round(offer * 0.97), high: Math.round(offer * 1.03) }
    }

    res.json({
      success: true,
      leadId,
      persisted: !!leadId,
      thinMarket,
      extremeKm,
      withheld: withhold,
      confidence,
      // When a gate trips → no number (specialist message). Low confidence → a
      // ±3% range. Otherwise → a single precise offer.
      offer: withhold ? null : (offerRange ? null : offer),
      offerRange,
      message: customerMessage,
      vehicle: { year, make, model, trim, vin: vin || null },
    })
  } catch (err) {
    console.error('POST /api/leads error:', err.message)
    res.status(500).json({ error: 'Could not process this request. Please try again.' })
  }
})

// POST /api/offer/prefetch — warm the 24h market cache for a VIN-or-spec + postal
// WITHOUT creating a lead or computing a final offer. The widget fires this as
// soon as it has the vehicle + location, so the heavy VinAudit fetch overlaps
// with the customer filling in the rest of the form → instant offer at submit.
app.post('/api/offer/prefetch', strictLimiter, async (req, res) => {
  try {
    const b = req.body || {}
    const vin = (b.vin || '').toString().toUpperCase().trim()
    const postal = (b.postal || '').toString().trim()
    if (!postal) return res.status(400).json({ error: 'postal required' })

    const year = (b.year || '').toString().trim()
    const make = (b.make || '').toString().trim()
    const model = (b.model || '').toString().trim()
    const trim = (b.trim || '').toString().trim()
    const specId = !vin
      ? [year, make, model, trim].filter(Boolean).map(s => s.toLowerCase().replace(/\s+/g, '-')).join('_')
      : null
    if (vin.length !== 17 && !(year && make && model)) {
      return res.status(400).json({ error: 'Provide a VIN, or year + make + model' })
    }

    // Respond immediately; warm the cache in the background so the widget isn't
    // blocked. If already cached, this is a no-op cache hit.
    const args = { vin: vin.length === 17 ? vin : undefined, specId, postal }
    const key = marketCacheKey(args)
    const already = await getCachedMarket(key)
    if (already) return res.json({ success: true, warmed: true, cached: true })

    // Fire-and-forget the heavy fetch; don't await before responding.
    marketForLead(args).catch(e => console.error('prefetch warm error:', e.message))
    res.json({ success: true, warmed: true, cached: false })
  } catch (err) {
    console.error('POST /api/offer/prefetch error:', err.message)
    res.status(500).json({ error: 'prefetch failed' })
  }
})

// GET /api/leads — Vantage reads pending leads (newest first). Optional ?status=
app.get('/api/leads', requireTeamKey, async (req, res) => {
  logAccess(req, 'leads.list', { subject: 'leads', detail: { status: req.query.status || 'all' } })
  if (!pool) return res.json({ success: true, leads: [], dbConnected: false })
  try {
    const status = (req.query.status || '').toString().trim()
    const params = []
    let where = ''
    if (status) { params.push(status); where = 'WHERE status = $1' }
    const r = await pool.query(
      `SELECT * FROM pending_leads ${where} ORDER BY created_at DESC LIMIT 500`, params
    )
    res.json({ success: true, dbConnected: true, leads: r.rows })
  } catch (e) {
    console.error('GET /api/leads error:', e.message)
    res.status(500).json({ error: 'Could not load leads' })
  }
})

// PATCH /api/leads/:id — update status (e.g. converted/dismissed).
app.patch('/api/leads/:id', requireTeamKey, async (req, res) => {
  logAccess(req, 'leads.update', { subject: 'lead', subjectId: req.params.id, detail: { status: req.body?.status } })
  if (!pool) return res.status(503).json({ error: 'No database connected' })
  const id = Number(req.params.id)
  const status = (req.body?.status || '').toString().trim()
  const allowed = ['pending', 'converted', 'dismissed']
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid id' })
  if (!allowed.includes(status)) return res.status(400).json({ error: 'status must be one of: ' + allowed.join(', ') })
  try {
    const r = await pool.query('UPDATE pending_leads SET status=$1 WHERE id=$2 RETURNING id,status', [status, id])
    if (!r.rows.length) return res.status(404).json({ error: 'Lead not found' })
    res.json({ success: true, lead: r.rows[0] })
  } catch (e) {
    console.error('PATCH /api/leads error:', e.message)
    res.status(500).json({ error: 'Could not update lead' })
  }
})

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    vinDecode: 'NHTSA — free',
    teamKeyFingerprint: keyFingerprint(TEAM_API_KEY),
    marketData: VINAUDIT_KEY && VINAUDIT_KEY !== 'YOUR_VINAUDIT_API_KEY_HERE' ? 'configured' : 'not configured',
    aiDescriptions: ANTHROPIC_KEY && ANTHROPIC_KEY !== 'YOUR_ANTHROPIC_API_KEY_HERE' ? 'configured' : 'not configured',
    leadsDb: LEADS_DB ? 'connected (DATABASE_URL present)' : 'NOT connected — attach Postgres in Railway to persist leads',
    marketCache: LEADS_DB ? `enabled (${MARKET_CACHE_TTL_HOURS}h TTL)` : 'disabled (no DB)'
  })
})

// ── Carfax Canada (mock now, structured for the real API) ──
// When you sign a Carfax Canada data agreement you'll get an endpoint + key.
// Set CARFAX_API_KEY (and adjust the request below to their spec). Until then,
// this returns deterministic mock data so the UI works. The frontend calls this
// route, so wiring the real API later requires NO frontend changes.
const CARFAX_API_KEY = process.env.CARFAX_API_KEY || ''
app.get('/api/carfax/:vin', strictLimiter, async (req, res) => {
  const vin = (req.params.vin || '').toUpperCase().trim()
  if (vin.length !== 17) return res.status(400).json({ error: 'VIN must be 17 characters' })

  // ── REAL API (enable when credentials exist) ──
  if (CARFAX_API_KEY) {
    try {
      // NOTE: replace URL/params/field-mapping with Carfax Canada's actual spec.
      // const r = await fetch(`https://api.carfax.ca/...?vin=${vin}`, {
      //   headers: { Authorization: `Bearer ${CARFAX_API_KEY}` }
      // })
      // const d = await r.json()
      // return res.json({ vin, fetchedAt:new Date().toISOString(),
      //   accidents: d.accidentCount, owners: d.ownerCount, lien: d.hasLien,
      //   odometer_issues: d.odometerProblem, total_loss: d.totalLoss,
      //   service_records: d.serviceRecordCount,
      //   last_reported_odometer: d.lastOdometer,
      //   clean: d.accidentCount===0 && !d.odometerProblem && !d.totalLoss,
      //   report_url: d.reportUrl, _source:'carfax' })
      // For now, fall through to mock even if a key is set but code above is stubbed.
    } catch (e) {
      console.error('Carfax API error:', e.message)
      // fall through to mock on error so the UI still functions
    }
  }

  // ── MOCK (deterministic from VIN so the same car returns the same report) ──
  const seed = vin.split('').reduce((s, c) => s + c.charCodeAt(0), 0)
  const rnd = (n) => (seed * 9301 + 49297) % n
  const accidents = rnd(10) < 7 ? 0 : 1 + (rnd(3) % 2)
  const clean = accidents === 0
  res.json({
    vin, fetchedAt: new Date().toISOString(),
    accidents,
    owners: 1 + (rnd(5) % 3),
    lien: rnd(10) > 8,
    odometer_issues: false,
    total_loss: false,
    service_records: 2 + (rnd(13) % 8),
    last_reported_odometer: Math.round(vin.charCodeAt(5) * 800 + 20000),
    clean,
    report_url: `https://www.carfax.ca/vehicle-history-report?vin=${vin}`,
    _source: 'mock',
  })
})

// Sweep on boot, then daily. A deploy happens often enough that boot alone
// would mostly work, but not reliably — a server left running for weeks would
// never clear anything.
setTimeout(anonymiseOldLeads, 30 * 1000)
setInterval(anonymiseOldLeads, 24 * 60 * 60 * 1000)

app.listen(PORT, () => {
  console.log(`\n✅ Vantage server running on http://localhost:${PORT}`)
  console.log(`   Lead retention: personal fields cleared after ${RETENTION_DAYS} days`)
  console.log(`   VIN decode: NHTSA (free, no key needed)`)
  console.log(`   Market provider: ${MARKET_PROVIDER}${MARKET_PROVIDER === 'marketcheck' ? (MARKETCHECK_API_KEY ? ' ✅' : ' ⚠ set MARKETCHECK_API_KEY') : (VINAUDIT_KEY ? ' ✅' : ' ⚠ set VINAUDIT_KEY')}`)
  if (MARKET_PROVIDER === 'marketcheck') console.log(`   VIN decode: ${USE_NEOVIN ? 'NeoVIN (cached, best trim/drivetrain)' : 'NHTSA only (USE_NEOVIN=false)'}`)
  const aiStatus = ANTHROPIC_KEY && ANTHROPIC_KEY !== 'YOUR_ANTHROPIC_API_KEY_HERE'
    ? 'configured ✅'
    : 'not configured — add key to config.json for AI descriptions'
  console.log(`   AI descriptions: ${aiStatus}`)
  // Security posture at boot — make gaps loud so they're not missed in prod.
  console.log(`   ── Security ──`)
  console.log(`   CORS: ${allowedOrigins.length ? `restricted to ${allowedOrigins.join(', ')} ✅` : '⚠ OPEN (set ALLOWED_ORIGIN in production)'}`)
  console.log(`   Team API gate: ${TEAM_API_KEY ? 'enabled ✅' : '⚠ OPEN — lead read/modify endpoints are PUBLIC (set TEAM_API_KEY in production)'}`)
  console.log(`   Rate limiting: enabled ✅ (general 120/min, strict 15/min)\n`)
})
