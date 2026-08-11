import React, { useState, useEffect, useRef, useCallback } from 'react'
import ReactDOM from 'react-dom/client'
import VINScanner from './VINScanner.jsx'

// ── Customer Trade-In Widget ──────────────────────────────────────────────
// Standalone, embeddable page. Customer enters their vehicle + contact, gets an
// instant offer (or a range / specialist message), and the submission lands in
// Vantage as a pending customer lead. Embedded via embed.js (iframe) or linked
// directly. Talks to the same backend as Vantage (VITE_API_URL).

const API_BASE = (import.meta.env.VITE_API_URL || 'http://localhost:3001').replace(/\/$/, '')

// Dealer key (which dealership this widget belongs to). Set via ?dealer= on the
// embed URL; defaults to the single dealer for now.
const DEALER = new URLSearchParams(location.search).get('dealer') || 'default'

// Palette — mirrors Vantage so the widget feels on-brand.
const BASE_C = {
  navy:'#1C2D5E', navyLight:'#2B3F80', navyMuted:'rgba(28,45,94,0.06)',
  teal:'#00B4A6', tealLight:'#00C8B8', tealMuted:'rgba(0,180,166,0.10)',
  card:'#FFFFFF', textDark:'#1C2D5E', textMid:'#4A5568', textLight:'#8C95A0',
  green:'#1A7A4A', greenBg:'rgba(26,122,74,0.08)',
  orange:'#C05621', orangeBg:'rgba(192,86,33,0.08)',
  red:'#C53030', border:'rgba(0,0,0,0.10)', borderStr:'rgba(0,0,0,0.16)',
}

const fmt = n => n != null ? `$${Number(n).toLocaleString('en-CA')}` : ''

// Compress an image File → a small JPEG data-URL (max 1200px, ~0.7 quality) so
// photos travel light to the backend and into the appraisal.
function compressImage(file, maxDim = 1200, quality = 0.7) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(url)
      let { width, height } = img
      if (width > height && width > maxDim) { height = Math.round(height * maxDim / width); width = maxDim }
      else if (height > maxDim) { width = Math.round(width * maxDim / height); height = maxDim }
      const canvas = document.createElement('canvas')
      canvas.width = width; canvas.height = height
      canvas.getContext('2d').drawImage(img, 0, 0, width, height)
      resolve(canvas.toDataURL('image/jpeg', quality))
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('image load failed')) }
    img.src = url
  })
}

// Tell the embedding page our height so the iframe can auto-resize (embed.js
// listens for this).
function postHeight() {
  try {
    const h = document.getElementById('widget-root')?.scrollHeight || document.body.scrollHeight
    window.parent?.postMessage({ type: 'vantage-widget-height', height: h }, '*')
  } catch {}
}

// ── Reverse-geocode coords → FSA (first 3 of postal). No API key: uses the free
// Nominatim service to get a postal code, then takes the FSA. Falls back to
// asking the user for their first-3 if geolocation is denied/unavailable.
async function fsaFromCoords(lat, lon) {
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=18`, {
      headers: { 'Accept': 'application/json' },
    })
    const d = await r.json()
    const postcode = d?.address?.postcode || ''
    const fsa = postcode.replace(/\s+/g, '').toUpperCase().slice(0, 3)
    return /^[A-Z]\d[A-Z]$/.test(fsa) ? fsa : null
  } catch { return null }
}

const YEARS = Array.from({ length: 30 }, (_, i) => String(new Date().getFullYear() + 1 - i))

// Curated common makes for the Make dropdown (same list Vantage uses). A short,
// reliable list avoids NHTSA's huge/messy "all makes" feed. Models then load
// from NHTSA for the chosen year+make — free, and the slugified result matches
// VinAudit's spec_id format, so the market lookup gets clean inputs.
const MAKES = ['Acura','Alfa Romeo','Audi','BMW','Buick','Cadillac','Chevrolet','Chrysler','Dodge','Fiat','Ford','Genesis','GMC','Honda','Hyundai','Infiniti','Jaguar','Jeep','Kia','Land Rover','Lexus','Lincoln','Maserati','Mazda','Mercedes-Benz','MINI','Mitsubishi','Nissan','Polestar','Porsche','Ram','Subaru','Tesla','Toyota','Volkswagen','Volvo']

const _modelsCache = {}
async function fetchModelsFor(year, make) {
  if (!year || !make) return []
  const key = `${year}|${make}`.toLowerCase()
  if (_modelsCache[key]) return _modelsCache[key]
  try {
    const url = `https://vpic.nhtsa.dot.gov/api/vehicles/getmodelsformakeyear/make/${encodeURIComponent(make)}/modelyear/${year}?format=json`
    const r = await fetch(url)
    const d = await r.json()
    const models = [...new Set((d.Results || []).map(m => m.Model_Name).filter(Boolean))].sort()
    _modelsCache[key] = models
    return models
  } catch { return [] }
}

// Branding is overridable so the same engine can power the standalone Vantage
// widget and the consumer TradeLane site. Defaults preserve the original widget.
const DEFAULT_BRANDING = {
  title: 'Get Your Instant Offer',
  subtitle: 'Tell us about your vehicle — get a real cash offer in seconds.',
  footer: 'Powered by Vantage',
}

function Widget({ branding, theme } = {}) {
  // TradeLane supplies its own brand colours; Vantage and the standalone embed
  // use the defaults. Merging rather than replacing means a host only has to
  // name the colours it actually wants to change.
  const C = theme ? { ...BASE_C, ...theme } : BASE_C
  // Selected states (toggles, chips, hint panels) read better in the primary
  // colour when the accent is a bright yellow — reserving the accent for the
  // single primary action is what keeps it feeling deliberate.
  const SEL = C.select || C.teal
  const SELBG = C.selectMuted || C.tealMuted
  const B = { ...DEFAULT_BRANDING, ...(branding || {}) }
  const [step, setStep] = useState('vehicle')     // vehicle → details → contact → result
  // ── Mobile focus mode ──────────────────────────────────────────────
  // Embedded in a long marketing page, the form on a phone is surrounded by
  // page content, so the customer scrolls up and down hunting for fields. Once
  // they start, we take over the viewport and show ONLY the current step.
  const [isPhone, setIsPhone] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia('(max-width: 720px)').matches)
  const [focusMode, setFocusMode] = useState(false)
  const [scanning, setScanning] = useState(false)
  const bodyRef = useRef(null)
  useEffect(() => {
    if (typeof window === 'undefined') return
    const mq = window.matchMedia('(max-width: 720px)')
    const on = e => setIsPhone(e.matches)
    mq.addEventListener ? mq.addEventListener('change', on) : mq.addListener(on)
    return () => { mq.removeEventListener ? mq.removeEventListener('change', on) : mq.removeListener(on) }
  }, [])
  const immersive = isPhone && focusMode
  // Lock the page behind the sheet so only the step scrolls.
  useEffect(() => {
    if (typeof document === 'undefined') return
    if (!immersive) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [immersive])
  // New step starts at the top — never mid-question.
  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = 0
  }, [step])
  const [vinMode, setVinMode] = useState(true)     // VIN entry vs YMMT dropdowns

  // Vehicle
  const [vin, setVin] = useState('')
  const [vinLocked, setVinLocked] = useState(false)
  const [decoding, setDecoding] = useState(false)
  const [vehicle, setVehicle] = useState(null)     // {year,make,model,trim}
  const [year, setYear] = useState('')
  const [make, setMake] = useState('')
  const [model, setModel] = useState('')
  const [trim, setTrim] = useState('')
  const [models, setModels] = useState([])           // NHTSA models for year+make
  const [loadingModels, setLoadingModels] = useState(false)

  // When year+make are chosen, load the model list (cascading dropdown).
  useEffect(() => {
    let cancelled = false
    if (year && make) {
      setLoadingModels(true)
      fetchModelsFor(year, make).then(ms => { if (!cancelled) { setModels(ms); setLoadingModels(false) } })
    } else { setModels([]) }
    return () => { cancelled = true }
  }, [year, make])

  // Location
  const [fsa, setFsa] = useState('')
  const [fsaConfirmed, setFsaConfirmed] = useState(false)
  const [askFsa, setAskFsa] = useState(false)
  const [locating, setLocating] = useState(false)

  // Details
  const [odometer, setOdometer] = useState('')
  const [accident, setAccident] = useState(null)   // null | true | false
  const [accidentAmount, setAccidentAmount] = useState('')

  // Condition & ownership (appraiser info — does NOT affect the offer)
  const [conditionOpinion, setConditionOpinion] = useState('')
  const [knownIssues, setKnownIssues] = useState('')
  const [tireCondition, setTireCondition] = useState('')
  const [brakeCondition, setBrakeCondition] = useState('')
  const [ownership, setOwnership] = useState('')        // owned | financed | leased
  const [lienHolder, setLienHolder] = useState('')
  const [lienBalance, setLienBalance] = useState('')
  const [photos, setPhotos] = useState([])             // compressed data-URLs
  const [photoBusy, setPhotoBusy] = useState(false)

  // Contact
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [hp, setHp] = useState('') // honeypot — hidden; bots fill it, humans don't

  // Submission
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const prefetched = useRef(false)

  // Keep the iframe sized to content.
  useEffect(() => { postHeight() })
  useEffect(() => {
    // Only observe when running as the standalone iframe widget (where
    // #widget-root exists). When embedded as a component (e.g. the TradeLane
    // page) there's no #widget-root and no iframe to resize — skip it.
    const el = document.getElementById('widget-root')
    if (!el) return
    const ro = new ResizeObserver(postHeight)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Try geolocation once on load → FSA (silent; falls back to asking).
  useEffect(() => {
    if (!navigator.geolocation) { setAskFsa(true); return }
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const f = await fsaFromCoords(pos.coords.latitude, pos.coords.longitude)
        setLocating(false)
        if (f) { setFsa(f); setFsaConfirmed(true) }
        else setAskFsa(true)
      },
      () => { setLocating(false); setAskFsa(true) },
      { timeout: 8000, maximumAge: 600000 }
    )
  }, [])

  // Fire the cache-warming prefetch as soon as we have vehicle + FSA, so the
  // heavy market fetch overlaps with the customer finishing the form.
  const tryPrefetch = useCallback((veh, f) => {
    if (prefetched.current || !f) return
    const body = veh.vin
      ? { vin: veh.vin, postal: f, dealer: DEALER }
      : { year: veh.year, make: veh.make, model: veh.model, trim: veh.trim, postal: f, dealer: DEALER }
    if (!veh.vin && !(veh.year && veh.make && veh.model)) return
    prefetched.current = true
    fetch(`${API_BASE}/api/offer/prefetch`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }).catch(() => { prefetched.current = false })
  }, [])

  // Decode VIN → lock the field, show the vehicle, start prefetch.
  async function decodeVin(vinArg) {
    const v = (typeof vinArg === 'string' ? vinArg : vin).toUpperCase().trim()
    if (v.length !== 17) { setError('Please enter a full 17-character VIN.'); return }
    setError(''); setDecoding(true)
    try {
      const r = await fetch(`${API_BASE}/api/vin/${v}`).then(x => x.json())
      if (r.success && r.data && (r.data.make || r.data.model)) {
        const veh = { vin: v, year: r.data.year || '', make: r.data.make || '', model: r.data.model || '', trim: r.data.trim || '' }
        setVehicle(veh); setVinLocked(true)
        if (fsa) tryPrefetch(veh, fsa)
      } else {
        setError("We couldn't find that VIN. Double-check it, or enter your vehicle details instead.")
      }
    } catch {
      setError('Something went wrong looking up that VIN. Please try again.')
    } finally { setDecoding(false) }
  }

  // YMMT path → build vehicle, prefetch.
  function confirmYmmt() {
    if (!(year && make && model)) { setError('Please choose year, make, and model.'); return }
    const veh = { vin: '', year, make, model, trim }
    setVehicle(veh)
    if (fsa) tryPrefetch(veh, fsa)
  }

  function confirmFsa() {
    const f = fsa.replace(/\s+/g, '').toUpperCase().slice(0, 3)
    if (!/^[A-Z]\d[A-Z]$/.test(f)) { setError('Please enter the first 3 characters of your postal code (e.g. M6H).'); return }
    setError(''); setFsa(f); setFsaConfirmed(true); setAskFsa(false)
    if (vehicle) tryPrefetch(vehicle, f)
  }

  async function submit() {
    setError('')
    if (!name.trim()) { setError('Please enter your name.'); return }
    if (!email.trim() && !phone.trim()) { setError('Please enter an email or phone number so we can send your offer.'); return }
    if (!fsa) { setError('We need your area to check your local market.'); setAskFsa(true); return }
    setSubmitting(true)
    const body = {
      ...(vehicle.vin ? { vin: vehicle.vin } : { year: vehicle.year, make: vehicle.make, model: vehicle.model, trim: vehicle.trim }),
      postal: fsa, odometer: odometer || null,
      accident: accident === true,
      accidentAmount: accident === true && accidentAmount ? Number(accidentAmount) : null,
      customerName: name.trim(), customerEmail: email.trim(), customerPhone: phone.trim(),
      website: hp, // honeypot — real users leave this empty
      // Appraiser info (does not affect the offer)
      conditionOpinion: conditionOpinion || null,
      knownIssues: knownIssues.trim() || null,
      tireCondition: tireCondition || null,
      brakeCondition: brakeCondition || null,
      ownership: ownership || null,
      lienHolder: (ownership === 'financed' || ownership === 'leased') ? (lienHolder.trim() || null) : null,
      lienBalance: (ownership === 'financed' || ownership === 'leased') && lienBalance ? Number(lienBalance) : null,
      photos,
      dealer: DEALER,
    }
    try {
      const r = await fetch(`${API_BASE}/api/leads`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      const d = await r.json()
      if (!r.ok) { setError(d.error || 'Something went wrong. Please try again.'); setSubmitting(false); return }
      setResult(d); setStep('result')
    } catch {
      setError('Something went wrong submitting your details. Please try again.')
    } finally { setSubmitting(false) }
  }

  // Compress + add uploaded photos (cap at 12).
  async function onPhotos(e) {
    const files = Array.from(e.target.files || [])
    if (!files.length) return
    setPhotoBusy(true)
    try {
      const out = []
      for (const f of files.slice(0, 12)) {
        try { out.push(await compressImage(f)) } catch {}
      }
      setPhotos(prev => [...prev, ...out].slice(0, 12))
    } finally { setPhotoBusy(false); e.target.value = '' }
  }
  const removePhoto = i => setPhotos(prev => prev.filter((_, idx) => idx !== i))

  // ── styles ──
  const wrap = { maxWidth: 440, margin: '0 auto', padding: 20, color: C.textDark }
  const card = { background: C.card, borderRadius: 16, padding: 24, boxShadow: '0 4px 24px rgba(28,45,94,0.10)', border: `1px solid ${C.border}` }
  const label = { display: 'block', fontSize: 13, fontWeight: 600, color: C.textMid, marginBottom: 6 }
  const input = { width: '100%', padding: '12px 14px', fontSize: 15, border: `1px solid ${C.borderStr}`, borderRadius: 10, outline: 'none', fontFamily: 'inherit', color: C.textDark }
  const onAccent = (() => {
    const hex = String(C.teal || '').replace('#', '')
    if (hex.length !== 6) return '#fff'
    const [r, g, b] = [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16))
    // Relative luminance — a light accent needs dark text, not white.
    return (0.299 * r + 0.587 * g + 0.114 * b) > 150 ? (C.navyDeep || C.navy || '#111') : '#fff'
  })()
  const btn = { width: '100%', padding: '14px 16px', fontSize: 16, fontWeight: 700, background: C.teal, color: onAccent, border: 'none', borderRadius: 10, cursor: 'pointer' }
  const btnGhost = { ...btn, background: '#fff', color: C.navy, border: `1.5px solid ${C.borderStr}` }
  const errBox = error ? <div style={{ background: C.redBg || 'rgba(197,48,48,0.08)', color: C.red, padding: '10px 12px', borderRadius: 8, fontSize: 13, marginTop: 12 }}>{error}</div> : null

  // Step metadata for the progress indicator.
  const STEPS = ['vehicle', 'details', 'contact']
  const stepIdx = STEPS.indexOf(step)
  const stepLabel = { vehicle: 'Your vehicle', details: 'Condition', contact: 'Your details', result: 'Your estimate' }[step] || ''

  // In focus mode the sheet owns the viewport: fixed header, scrollable body.
  const shellStyle = immersive
    ? { position: 'fixed', inset: 0, zIndex: 9999, background: C.card, display: 'flex', flexDirection: 'column' }
    : wrap
  const cardStyle = immersive
    ? { display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, background: C.card }
    : card

  return (
    <div id="widget-root">
      {scanning && (
        <VINScanner
          onVINDetected={v => {
            const clean = (v || '').toUpperCase().trim()
            setVin(clean); setError('')
            // Scanned VINs go straight to lookup — one less tap, and the
            // customer sees their vehicle confirmed immediately.
            if (clean.length === 17) decodeVin(clean)
          }}
          onClose={() => setScanning(false)}
        />
      )}
      <div style={shellStyle}>
        <div style={cardStyle}>
          {/* Header — compact and pinned while focused, so the customer always
              knows where they are without scrolling up to find out. */}
          {immersive ? (
            <div style={{ flexShrink: 0, padding: '14px 16px 10px', borderBottom: `1px solid ${C.border}`, background: C.card }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 16, fontWeight: 800, color: C.navy, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{stepLabel}</div>
                  {step !== 'result' && (
                    <div style={{ fontSize: 12, color: C.textLight, marginTop: 2 }}>Step {stepIdx + 1} of {STEPS.length}</div>
                  )}
                </div>
                <button onClick={() => setFocusMode(false)} aria-label="Close"
                  style={{ flexShrink: 0, width: 34, height: 34, borderRadius: 17, border: `1px solid ${C.border}`, background: '#fff', color: C.textMid, fontSize: 18, lineHeight: 1, cursor: 'pointer' }}>×</button>
              </div>
              {step !== 'result' && (
                <div style={{ display: 'flex', gap: 5, marginTop: 10 }}>
                  {STEPS.map((sName, i) => (
                    <div key={sName} style={{ flex: 1, height: 3, borderRadius: 2, background: i <= stepIdx ? SEL : C.border }} />
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div style={{ textAlign: 'center', marginBottom: 20 }}>
              <div style={{ fontSize: 20, fontWeight: 800, color: C.navy }}>{B.title}</div>
              <div style={{ fontSize: 13, color: C.textLight, marginTop: 4 }}>{B.subtitle}</div>
            </div>
          )}

          {/* Scrollable body — only the current step lives in here. */}
          <div ref={bodyRef} style={immersive
            ? { flex: 1, minHeight: 0, overflowY: 'auto', WebkitOverflowScrolling: 'touch', padding: '16px 16px calc(20px + env(safe-area-inset-bottom))' }
            : undefined}>

          {/* ── STEP: VEHICLE ── */}
          {step === 'vehicle' && (
            <div>
              {/* Mode toggle */}
              <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
                <button onClick={() => setVinMode(true)} style={{ flex: 1, padding: '8px', fontSize: 13, fontWeight: 600, borderRadius: 8, cursor: 'pointer', border: `1px solid ${vinMode ? SEL : C.border}`, background: vinMode ? SELBG : '#fff', color: vinMode ? C.navy : C.textMid }}>Enter VIN</button>
                <button onClick={() => setVinMode(false)} style={{ flex: 1, padding: '8px', fontSize: 13, fontWeight: 600, borderRadius: 8, cursor: 'pointer', border: `1px solid ${!vinMode ? SEL : C.border}`, background: !vinMode ? SELBG : '#fff', color: !vinMode ? C.navy : C.textMid }}>No VIN? Pick your car</button>
              </div>

              {vinMode ? (
                <div>
                  <label style={label}>Vehicle Identification Number (VIN)</label>
                  {!vinLocked ? (
                    <>
                      {/* Scan first — typing 17 characters off a windshield is
                          the single most error-prone step in this form. */}
                      <button
                        onClick={() => { setError(''); setScanning(true) }}
                        style={{ ...btn, background: '#fff', color: C.navy, border: `1.5px solid ${SEL}`, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, marginBottom: 10 }}>
                        <span style={{ fontSize: 18 }}>📷</span> Scan my VIN with the camera
                      </button>
                      <div style={{ fontSize: 12, color: C.textMid, background: SELBG, border: `1px solid ${SEL}33`, borderRadius: 8, padding: '10px 12px', marginBottom: 14, lineHeight: 1.5 }}>
                        Point your camera at the VIN — it reads the <strong>printed number</strong>,
                        so there's no barcode to find. Look on the driver's-side dashboard through
                        the windshield, the sticker in the driver's door jamb, or your insurance slip.
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '0 0 12px' }}>
                        <div style={{ flex: 1, height: 1, background: C.border }} />
                        <span style={{ fontSize: 11, color: C.textLight, fontWeight: 600 }}>OR TYPE IT</span>
                        <div style={{ flex: 1, height: 1, background: C.border }} />
                      </div>
                      <input style={input} value={vin} onChange={e => setVin(e.target.value.toUpperCase())} placeholder="17-character VIN" maxLength={17} inputMode="text" autoCapitalize="characters" autoCorrect="off" spellCheck={false} />
                      <div style={{ fontSize: 11, color: C.textLight, margin: '6px 0 14px' }}>Found on your dashboard, driver's door, or insurance.</div>
                      <button style={btn} onClick={decodeVin} disabled={decoding}>{decoding ? 'Looking up…' : 'Continue'}</button>
                    </>
                  ) : (
                    <div style={{ background: C.greenBg, border: `1px solid ${C.green}`, borderRadius: 10, padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ color: C.green, fontSize: 18 }}>✓</span>
                      <div>
                        <div style={{ fontWeight: 700, color: C.navy }}>{vehicle.year} {vehicle.make} {vehicle.model}</div>
                        {vehicle.trim && <div style={{ fontSize: 12, color: C.textMid }}>{vehicle.trim}</div>}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div style={{ display: 'grid', gap: 12 }}>
                  <div>
                    <label style={label}>Year</label>
                    <select style={input} value={year} onChange={e => { setYear(e.target.value); setModel('') }}>
                      <option value="">Select year</option>
                      {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={label}>Make</label>
                    <select style={input} value={make} onChange={e => { setMake(e.target.value); setModel('') }}>
                      <option value="">Select make</option>
                      {MAKES.map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={label}>Model {loadingModels && <span style={{ color: C.textLight, fontWeight: 400 }}>loading…</span>}</label>
                    {models.length > 0 ? (
                      <select style={input} value={model} onChange={e => setModel(e.target.value)} disabled={!make}>
                        <option value="">Select model</option>
                        {models.map(m => <option key={m} value={m}>{m}</option>)}
                      </select>
                    ) : (
                      // Fallback to text if NHTSA returns nothing for this year+make,
                      // so no vehicle is ever un-submittable.
                      <input style={input} value={model} onChange={e => setModel(e.target.value)}
                        placeholder={make ? (loadingModels ? 'Loading models…' : 'Type your model') : 'Choose make first'} disabled={!make} />
                    )}
                  </div>
                  <div>
                    <label style={label}>Trim <span style={{ color: C.textLight, fontWeight: 400 }}>(optional)</span></label>
                    <input style={input} value={trim} onChange={e => setTrim(e.target.value)} placeholder="e.g. XLE" />
                  </div>
                  {!vehicle && <button style={btn} onClick={confirmYmmt}>Continue</button>}
                </div>
              )}

              {/* Location */}
              {(vinLocked || vehicle) && (
                <div style={{ marginTop: 16 }}>
                  {fsaConfirmed ? (
                    <div style={{ fontSize: 13, color: C.textMid, display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'center' }}>
                      <span>📍</span> Based on your area ({fsa})
                      <button onClick={() => { setFsaConfirmed(false); setAskFsa(true) }} style={{ background: 'none', border: 'none', color: SEL, fontSize: 12, cursor: 'pointer', textDecoration: 'underline' }}>change</button>
                    </div>
                  ) : locating ? (
                    <div style={{ fontSize: 13, color: C.textLight, textAlign: 'center' }}>Finding your local market…</div>
                  ) : askFsa ? (
                    <div>
                      <label style={label}>First 3 of your postal code <span style={{ color: C.textLight, fontWeight: 400 }}>(to check your local market)</span></label>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <input style={{ ...input, flex: 1 }} value={fsa} onChange={e => setFsa(e.target.value.toUpperCase().slice(0, 3))} placeholder="M6H" maxLength={3} />
                        <button style={{ ...btnGhost, width: 'auto', padding: '0 18px' }} onClick={confirmFsa}>OK</button>
                      </div>
                    </div>
                  ) : null}
                </div>
              )}

              {/* Proceed when vehicle + location ready */}
              {(vinLocked || vehicle) && fsaConfirmed && (
                <button style={{ ...btn, marginTop: 16 }} onClick={() => { setError(''); setFocusMode(true); setStep('details') }}>Next</button>
              )}
              {errBox}
            </div>
          )}

          {/* ── STEP: DETAILS ── */}
          {step === 'details' && (
            <div>
              <div>
                <label style={label}>Odometer (km)</label>
                <input style={input} type="number" value={odometer} onChange={e => setOdometer(e.target.value)} placeholder="e.g. 60000" />
              </div>
              <div style={{ marginTop: 16 }}>
                <label style={label}>Has this vehicle been in an accident?</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => setAccident(false)} style={{ flex: 1, padding: 12, borderRadius: 10, cursor: 'pointer', fontWeight: 600, border: `1.5px solid ${accident === false ? SEL : C.border}`, background: accident === false ? SELBG : '#fff', color: C.navy }}>No</button>
                  <button onClick={() => setAccident(true)} style={{ flex: 1, padding: 12, borderRadius: 10, cursor: 'pointer', fontWeight: 600, border: `1.5px solid ${accident === true ? C.orange : C.border}`, background: accident === true ? C.orangeBg : '#fff', color: C.navy }}>Yes</button>
                </div>
              </div>
              {accident === true && (
                <div style={{ marginTop: 14 }}>
                  <label style={label}>Approximate repair claim or estimate amount <span style={{ color: C.textLight, fontWeight: 400 }}>(if known)</span></label>
                  <input style={input} type="number" value={accidentAmount} onChange={e => setAccidentAmount(e.target.value)} placeholder="e.g. 4500" />
                  <div style={{ fontSize: 11, color: C.textLight, marginTop: 6 }}>Leave blank if you're not sure — we'll confirm later.</div>
                </div>
              )}

              {/* Condition opinion */}
              <div style={{ marginTop: 16 }}>
                <label style={label}>How would you rate the overall condition?</label>
                <div style={{ display: 'flex', gap: 6 }}>
                  {['Excellent', 'Good', 'Fair', 'Poor'].map(o => (
                    <button key={o} onClick={() => setConditionOpinion(o)} style={{ flex: 1, padding: '10px 4px', borderRadius: 9, cursor: 'pointer', fontWeight: 600, fontSize: 13, border: `1.5px solid ${conditionOpinion === o ? SEL : C.border}`, background: conditionOpinion === o ? SELBG : '#fff', color: C.navy }}>{o}</button>
                  ))}
                </div>
              </div>

              {/* Known issues */}
              <div style={{ marginTop: 16 }}>
                <label style={label}>Any known damage or mechanical issues? <span style={{ color: C.textLight, fontWeight: 400 }}>(optional)</span></label>
                <textarea style={{ ...input, minHeight: 64, resize: 'vertical' }} value={knownIssues} onChange={e => setKnownIssues(e.target.value)} placeholder="e.g. small dent on rear bumper, AC needs recharge…" />
              </div>

              {/* Tires + brakes */}
              <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
                <div style={{ flex: 1 }}>
                  <label style={label}>Tire condition</label>
                  <select style={input} value={tireCondition} onChange={e => setTireCondition(e.target.value)}>
                    <option value="">Select</option>
                    {['New', 'Good', 'Worn', 'Needs replacing'].map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                </div>
                <div style={{ flex: 1 }}>
                  <label style={label}>Brake condition</label>
                  <select style={input} value={brakeCondition} onChange={e => setBrakeCondition(e.target.value)}>
                    <option value="">Select</option>
                    {['New', 'Good', 'Worn', 'Needs replacing'].map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                </div>
              </div>

              {/* Ownership / lien */}
              <div style={{ marginTop: 16 }}>
                <label style={label}>Do you own it, or is there a loan or lease?</label>
                <div style={{ display: 'flex', gap: 6 }}>
                  {[['owned', 'Owned'], ['financed', 'Financed'], ['leased', 'Leased']].map(([v, l]) => (
                    <button key={v} onClick={() => setOwnership(v)} style={{ flex: 1, padding: '10px 4px', borderRadius: 9, cursor: 'pointer', fontWeight: 600, fontSize: 13, border: `1.5px solid ${ownership === v ? SEL : C.border}`, background: ownership === v ? SELBG : '#fff', color: C.navy }}>{l}</button>
                  ))}
                </div>
              </div>
              {(ownership === 'financed' || ownership === 'leased') && (
                <div style={{ display: 'flex', gap: 12, marginTop: 12 }}>
                  <div style={{ flex: 1.4 }}>
                    <label style={label}>Lender <span style={{ color: C.textLight, fontWeight: 400 }}>(if known)</span></label>
                    <input style={input} value={lienHolder} onChange={e => setLienHolder(e.target.value)} placeholder="e.g. TD Auto Finance" />
                  </div>
                  <div style={{ flex: 1 }}>
                    <label style={label}>Balance owing</label>
                    <input style={input} type="number" value={lienBalance} onChange={e => setLienBalance(e.target.value)} placeholder="$" />
                  </div>
                </div>
              )}

              {/* Photos */}
              <div style={{ marginTop: 16 }}>
                <label style={label}>Photos <span style={{ color: C.textLight, fontWeight: 400 }}>(optional — helps us finalize faster)</span></label>
                <label style={{ ...btnGhost, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, width: 'auto', padding: '10px 16px', cursor: 'pointer' }}>
                  {photoBusy ? 'Processing…' : '📷 Add photos'}
                  <input type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={onPhotos} />
                </label>
                {photos.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
                    {photos.map((p, i) => (
                      <div key={i} style={{ position: 'relative', width: 64, height: 64, borderRadius: 8, overflow: 'hidden', border: `1px solid ${C.border}` }}>
                        <img src={p} style={{ width: '100%', height: '100%', objectFit: 'cover' }} alt="" />
                        <button onClick={() => removePhoto(i)} style={{ position: 'absolute', top: 2, right: 2, background: 'rgba(0,0,0,0.6)', color: '#fff', border: 'none', borderRadius: '50%', width: 18, height: 18, fontSize: 11, cursor: 'pointer', lineHeight: 1 }}>×</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', gap: 8, marginTop: 20 }}>
                <button style={btnGhost} onClick={() => setStep('vehicle')}>Back</button>
                <button style={btn} onClick={() => { setError(''); setFocusMode(true); setStep('contact') }} disabled={accident === null}>Next</button>
              </div>
              {accident === null && <div style={{ fontSize: 12, color: C.textLight, textAlign: 'center', marginTop: 10 }}>Please answer the accident question to continue.</div>}
              {errBox}
            </div>
          )}

          {/* ── STEP: CONTACT ── */}
          {step === 'contact' && (
            <div>
              <div style={{ fontSize: 13, color: C.textMid, marginBottom: 16, textAlign: 'center' }}>Where should we send your offer?</div>
              <div><label style={label}>Your name</label><input style={input} value={name} onChange={e => setName(e.target.value)} placeholder="Full name" /></div>
              <div style={{ marginTop: 14 }}><label style={label}>Email</label><input style={input} type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@email.com" /></div>
              <div style={{ marginTop: 14 }}><label style={label}>Phone</label><input style={input} type="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="(416) 555-0123" /></div>
              {/* Honeypot — hidden from humans, bots tend to fill it. Off-screen + aria-hidden + no autocomplete. */}
              <input type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" value={hp} onChange={e => setHp(e.target.value)} style={{ position: 'absolute', left: '-9999px', width: 1, height: 1, opacity: 0 }} />
              <div style={{ fontSize: 11, color: C.textLight, marginTop: 8 }}>Email or phone — at least one so we can reach you.</div>
              <div style={{ display: 'flex', gap: 8, marginTop: 20 }}>
                <button style={btnGhost} onClick={() => setStep('details')}>Back</button>
                <button style={btn} onClick={submit} disabled={submitting}>{submitting ? 'Getting your offer…' : 'Get my offer'}</button>
              </div>
              {errBox}
            </div>
          )}

          {/* ── STEP: RESULT ── */}
          {step === 'result' && result && (
            <div style={{ textAlign: 'center' }}>
              {result.withheld ? (
                <div>
                  <div style={{ fontSize: 40, marginBottom: 8 }}>👋</div>
                  <div style={{ fontSize: 18, fontWeight: 800, color: C.navy, marginBottom: 10 }}>A specialist will be in touch</div>
                  <div style={{ fontSize: 14, color: C.textMid, lineHeight: 1.5 }}>{result.message}</div>
                </div>
              ) : result.offerRange ? (
                <div>
                  <div style={{ fontSize: 13, color: C.textLight, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1 }}>Your estimated offer</div>
                  <div style={{ fontSize: 30, fontWeight: 800, color: C.green, margin: '8px 0' }}>{fmt(result.offerRange.low)} – {fmt(result.offerRange.high)}</div>
                  <div style={{ fontSize: 13, color: C.textMid, lineHeight: 1.5 }}>This is an estimated range based on current market data. We'll confirm your exact offer after a quick look at your vehicle.</div>
                </div>
              ) : (
                <div>
                  <div style={{ fontSize: 13, color: C.textLight, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1 }}>Your instant offer</div>
                  <div style={{ fontSize: 38, fontWeight: 800, color: C.green, margin: '8px 0' }}>{fmt(result.offer)}</div>
                  <div style={{ fontSize: 13, color: C.textMid, lineHeight: 1.5 }}>Based on current market data. Final offer confirmed after a quick inspection.</div>
                </div>
              )}
              <div style={{ marginTop: 18, padding: '14px', background: C.navyMuted, borderRadius: 10, fontSize: 13, color: C.textMid }}>
                {result.vehicle && <div style={{ fontWeight: 700, color: C.navy, marginBottom: 4 }}>{result.vehicle.year} {result.vehicle.make} {result.vehicle.model}</div>}
                We've received your details — our team will reach out shortly to finalize everything.
              </div>
            </div>
          )}
          </div>{/* /scrollable body */}
        </div>
        {B.footer && !immersive ? <div style={{ textAlign: 'center', fontSize: 11, color: C.textLight, marginTop: 12 }}>{B.footer}</div> : null}
      </div>
    </div>
  )
}

export { Widget }

// Auto-mount only when this file is loaded as the standalone embeddable widget
// (widget.html has #widget-root). When imported by another page (e.g. the
// TradeLane site) there's no #widget-root, so we skip self-mounting and let the
// host page render <Widget /> wherever it wants.
const _widgetRoot = document.getElementById('widget-root')
if (_widgetRoot) ReactDOM.createRoot(_widgetRoot).render(<Widget />)
