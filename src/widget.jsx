import React, { useState, useEffect, useRef, useCallback } from 'react'
import ReactDOM from 'react-dom/client'

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
const C = {
  navy:'#1C2D5E', navyLight:'#2B3F80', navyMuted:'rgba(28,45,94,0.06)',
  teal:'#00B4A6', tealLight:'#00C8B8', tealMuted:'rgba(0,180,166,0.10)',
  card:'#FFFFFF', textDark:'#1C2D5E', textMid:'#4A5568', textLight:'#8C95A0',
  green:'#1A7A4A', greenBg:'rgba(26,122,74,0.08)',
  orange:'#C05621', orangeBg:'rgba(192,86,33,0.08)',
  red:'#C53030', border:'rgba(0,0,0,0.10)', borderStr:'rgba(0,0,0,0.16)',
}

const fmt = n => n != null ? `$${Number(n).toLocaleString('en-CA')}` : ''

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

function Widget() {
  const [step, setStep] = useState('vehicle')     // vehicle → details → contact → result
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

  // Location
  const [fsa, setFsa] = useState('')
  const [fsaConfirmed, setFsaConfirmed] = useState(false)
  const [askFsa, setAskFsa] = useState(false)
  const [locating, setLocating] = useState(false)

  // Details
  const [odometer, setOdometer] = useState('')
  const [accident, setAccident] = useState(null)   // null | true | false
  const [accidentAmount, setAccidentAmount] = useState('')

  // Contact
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')

  // Submission
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const prefetched = useRef(false)

  // Keep the iframe sized to content.
  useEffect(() => { postHeight() })
  useEffect(() => {
    const ro = new ResizeObserver(postHeight)
    ro.observe(document.getElementById('widget-root'))
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
  async function decodeVin() {
    const v = vin.toUpperCase().trim()
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

  // ── styles ──
  const wrap = { maxWidth: 440, margin: '0 auto', padding: 20, color: C.textDark }
  const card = { background: C.card, borderRadius: 16, padding: 24, boxShadow: '0 4px 24px rgba(28,45,94,0.10)', border: `1px solid ${C.border}` }
  const label = { display: 'block', fontSize: 13, fontWeight: 600, color: C.textMid, marginBottom: 6 }
  const input = { width: '100%', padding: '12px 14px', fontSize: 15, border: `1px solid ${C.borderStr}`, borderRadius: 10, outline: 'none', fontFamily: 'inherit', color: C.textDark }
  const btn = { width: '100%', padding: '14px 16px', fontSize: 16, fontWeight: 700, background: C.teal, color: '#fff', border: 'none', borderRadius: 10, cursor: 'pointer' }
  const btnGhost = { ...btn, background: '#fff', color: C.navy, border: `1.5px solid ${C.borderStr}` }
  const errBox = error ? <div style={{ background: C.redBg || 'rgba(197,48,48,0.08)', color: C.red, padding: '10px 12px', borderRadius: 8, fontSize: 13, marginTop: 12 }}>{error}</div> : null

  return (
    <div id="widget-root">
      <div style={wrap}>
        <div style={card}>
          {/* Header */}
          <div style={{ textAlign: 'center', marginBottom: 20 }}>
            <div style={{ fontSize: 20, fontWeight: 800, color: C.navy }}>Get Your Instant Offer</div>
            <div style={{ fontSize: 13, color: C.textLight, marginTop: 4 }}>Tell us about your vehicle — get a real cash offer in seconds.</div>
          </div>

          {/* ── STEP: VEHICLE ── */}
          {step === 'vehicle' && (
            <div>
              {/* Mode toggle */}
              <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
                <button onClick={() => setVinMode(true)} style={{ flex: 1, padding: '8px', fontSize: 13, fontWeight: 600, borderRadius: 8, cursor: 'pointer', border: `1px solid ${vinMode ? C.teal : C.border}`, background: vinMode ? C.tealMuted : '#fff', color: vinMode ? C.navy : C.textMid }}>Enter VIN</button>
                <button onClick={() => setVinMode(false)} style={{ flex: 1, padding: '8px', fontSize: 13, fontWeight: 600, borderRadius: 8, cursor: 'pointer', border: `1px solid ${!vinMode ? C.teal : C.border}`, background: !vinMode ? C.tealMuted : '#fff', color: !vinMode ? C.navy : C.textMid }}>No VIN? Pick your car</button>
              </div>

              {vinMode ? (
                <div>
                  <label style={label}>Vehicle Identification Number (VIN)</label>
                  {!vinLocked ? (
                    <>
                      <input style={input} value={vin} onChange={e => setVin(e.target.value.toUpperCase())} placeholder="17-character VIN" maxLength={17} />
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
                    <select style={input} value={year} onChange={e => setYear(e.target.value)}>
                      <option value="">Select year</option>
                      {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={label}>Make</label>
                    <input style={input} value={make} onChange={e => setMake(e.target.value)} placeholder="e.g. Toyota" />
                  </div>
                  <div>
                    <label style={label}>Model</label>
                    <input style={input} value={model} onChange={e => setModel(e.target.value)} placeholder="e.g. RAV4" />
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
                      <button onClick={() => { setFsaConfirmed(false); setAskFsa(true) }} style={{ background: 'none', border: 'none', color: C.teal, fontSize: 12, cursor: 'pointer', textDecoration: 'underline' }}>change</button>
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
                <button style={{ ...btn, marginTop: 16 }} onClick={() => { setError(''); setStep('details') }}>Next</button>
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
                  <button onClick={() => setAccident(false)} style={{ flex: 1, padding: 12, borderRadius: 10, cursor: 'pointer', fontWeight: 600, border: `1.5px solid ${accident === false ? C.teal : C.border}`, background: accident === false ? C.tealMuted : '#fff', color: C.navy }}>No</button>
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
              <div style={{ display: 'flex', gap: 8, marginTop: 20 }}>
                <button style={btnGhost} onClick={() => setStep('vehicle')}>Back</button>
                <button style={btn} onClick={() => { setError(''); setStep('contact') }} disabled={accident === null}>Next</button>
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
        </div>
        <div style={{ textAlign: 'center', fontSize: 11, color: C.textLight, marginTop: 12 }}>Powered by Vantage</div>
      </div>
    </div>
  )
}

ReactDOM.createRoot(document.getElementById('widget-root')).render(<Widget />)
