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

// ── Health check ─────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    vinDecode: 'NHTSA — free',
    aiDescriptions: ANTHROPIC_KEY && ANTHROPIC_KEY !== 'YOUR_ANTHROPIC_API_KEY_HERE' ? 'configured' : 'not configured'
  })
})

app.listen(PORT, () => {
  console.log(`\n✅ Vantage server running on http://localhost:${PORT}`)
  console.log(`   VIN decode: NHTSA (free, no key needed)`)
  const aiStatus = ANTHROPIC_KEY && ANTHROPIC_KEY !== 'YOUR_ANTHROPIC_API_KEY_HERE'
    ? 'configured ✅'
    : 'not configured — add key to config.json for AI descriptions'
  console.log(`   AI descriptions: ${aiStatus}\n`)
})
