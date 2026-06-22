import React from 'react'
import ReactDOM from 'react-dom/client'
import { Widget } from './widget.jsx'

// ── TradeLane — consumer "sell us your car" site ──────────────────────────────
// Standalone public homepage (its own build entry → /tradelane.html). A car
// owner lands here, gets an estimate, and the submission flows into the Vantage
// Leads inbox via the shared backend. Reuses the existing <Widget /> quote
// engine (VIN decode, condition, photos, instant offer) wrapped in a marketing
// page. Trust-first, "let's figure it out together" positioning — not an
// instant-offer gimmick. Brand palette mirrors Vantage (navy/teal).

const C = {
  navy: '#1C2D5E', navyLight: '#2B3F80', navyDeep: '#16244C',
  navyMuted: 'rgba(28,45,94,0.06)',
  teal: '#00B4A6', tealLight: '#00C8B8', tealMuted: 'rgba(0,180,166,0.10)',
  card: '#FFFFFF', textDark: '#1C2D5E', textMid: '#4A5568', textLight: '#8C95A0',
  bg: '#F7F9FC', border: 'rgba(0,0,0,0.10)',
}

const FONT = "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"

function scrollToQuote(e) {
  e?.preventDefault?.()
  const el = document.getElementById('quote')
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

function Logo({ light }) {
  const main = light ? '#fff' : C.navy
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
      <div style={{
        width: 30, height: 30, borderRadius: 8, background: C.teal,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontWeight: 800, color: '#fff', fontSize: 17, letterSpacing: -0.5,
      }}>T</div>
      <span style={{ fontWeight: 800, fontSize: 19, color: main, letterSpacing: -0.4 }}>
        Trade<span style={{ color: C.teal }}>Lane</span>
      </span>
    </div>
  )
}

function Header() {
  return (
    <header style={{
      position: 'sticky', top: 0, zIndex: 50, background: 'rgba(255,255,255,0.92)',
      backdropFilter: 'blur(8px)', borderBottom: `1px solid ${C.border}`,
    }}>
      <div style={{
        maxWidth: 1080, margin: '0 auto', padding: '12px 20px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <Logo />
        <button onClick={scrollToQuote} style={{
          background: C.teal, color: '#fff', border: 'none', borderRadius: 8,
          padding: '9px 18px', fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: FONT,
        }}>Get my estimate</button>
      </div>
    </header>
  )
}

function Hero() {
  return (
    <section style={{
      background: `linear-gradient(160deg, ${C.navy} 0%, ${C.navyDeep} 100%)`,
      color: '#fff', padding: '64px 20px 72px',
    }}>
      <div style={{ maxWidth: 1080, margin: '0 auto', textAlign: 'center' }}>
        <div style={{
          display: 'inline-block', background: 'rgba(0,180,166,0.18)', color: C.tealLight,
          borderRadius: 20, padding: '6px 14px', fontSize: 13, fontWeight: 600, marginBottom: 22,
        }}>Sell your car the easy way</div>
        <h1 style={{
          fontSize: 'clamp(30px, 5vw, 46px)', fontWeight: 800, lineHeight: 1.12,
          letterSpacing: -1, margin: '0 auto 18px', maxWidth: 720,
        }}>
          Thinking of selling your car?<br />
          <span style={{ color: C.tealLight }}>Let's figure it out together.</span>
        </h1>
        <p style={{
          fontSize: 'clamp(16px, 2.5vw, 19px)', color: 'rgba(255,255,255,0.82)',
          maxWidth: 560, margin: '0 auto 32px', lineHeight: 1.55,
        }}>
          Tell us about your vehicle and get a real estimate — no pressure, no obligation.
          We're a local team that pays fairly and makes selling simple.
        </p>
        <button onClick={scrollToQuote} style={{
          background: C.teal, color: '#fff', border: 'none', borderRadius: 10,
          padding: '15px 34px', fontSize: 17, fontWeight: 700, cursor: 'pointer',
          fontFamily: FONT, boxShadow: '0 8px 24px rgba(0,180,166,0.35)',
        }}>Get my estimate →</button>
        <div style={{
          marginTop: 20, fontSize: 13.5, color: 'rgba(255,255,255,0.6)',
          display: 'flex', gap: 18, justifyContent: 'center', flexWrap: 'wrap',
        }}>
          <span>✓ Free estimate</span>
          <span>✓ No obligation</span>
          <span>✓ Local & friendly</span>
        </div>
      </div>
    </section>
  )
}

function HowItWorks() {
  const steps = [
    { n: '1', t: 'Tell us about your car', d: 'Enter your VIN or vehicle details and a few quick facts. Takes about a minute.' },
    { n: '2', t: 'Get a real estimate', d: 'We check the live market for cars like yours and show you a fair number — or have a specialist follow up.' },
    { n: '3', t: "We make selling simple", d: "Like the estimate? We'll handle the details and make buying your car painless." },
  ]
  return (
    <section style={{ padding: '60px 20px', background: C.bg }}>
      <div style={{ maxWidth: 1080, margin: '0 auto' }}>
        <h2 style={{
          textAlign: 'center', fontSize: 'clamp(24px, 4vw, 32px)', fontWeight: 800,
          color: C.navy, letterSpacing: -0.6, marginBottom: 8,
        }}>How it works</h2>
        <p style={{ textAlign: 'center', color: C.textMid, fontSize: 16, marginBottom: 40 }}>
          Three simple steps. No haggling games.
        </p>
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 20,
        }}>
          {steps.map(s => (
            <div key={s.n} style={{
              background: '#fff', border: `1px solid ${C.border}`, borderRadius: 14,
              padding: '28px 24px', textAlign: 'center',
            }}>
              <div style={{
                width: 46, height: 46, borderRadius: 12, background: C.tealMuted, color: C.teal,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontWeight: 800, fontSize: 20, margin: '0 auto 16px',
              }}>{s.n}</div>
              <div style={{ fontWeight: 700, fontSize: 18, color: C.navy, marginBottom: 8 }}>{s.t}</div>
              <div style={{ color: C.textMid, fontSize: 15, lineHeight: 1.55 }}>{s.d}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

function QuoteSection() {
  return (
    <section id="quote" style={{ padding: '60px 20px 70px', background: '#fff', scrollMarginTop: 64 }}>
      <div style={{ maxWidth: 620, margin: '0 auto' }}>
        <h2 style={{
          textAlign: 'center', fontSize: 'clamp(24px, 4vw, 32px)', fontWeight: 800,
          color: C.navy, letterSpacing: -0.6, marginBottom: 8,
        }}>Get your estimate</h2>
        <p style={{ textAlign: 'center', color: C.textMid, fontSize: 16, marginBottom: 28 }}>
          A few quick questions. Only your name and a way to reach you are required —
          everything else helps us get you a sharper number.
        </p>
        <div style={{
          background: C.bg, border: `1px solid ${C.border}`, borderRadius: 16, padding: '8px 8px 4px',
        }}>
          {/* Render the shared quote engine as a normal component. We deliberately
              do NOT use id="widget-root" here — that id triggers the widget's own
              self-mount (for the standalone /widget.html), which would double-mount
              and blank out. As a full-page component it just renders inline. */}
          <div id="tradelane-quote"><Widget /></div>
        </div>
      </div>
    </section>
  )
}

function Why() {
  const points = [
    { t: 'A fair, market-based number', d: 'Your estimate is built from real listings of cars like yours — not a lowball anchor to negotiate up from.' },
    { t: 'No pressure, ever', d: "An estimate is just that. There's zero obligation to sell, and we won't hound you." },
    { t: 'Real people, locally', d: "You're dealing with an actual local team, not a faceless call centre. We'll talk it through." },
    { t: 'We handle the hassle', d: 'Paperwork, payout, lien details — if you sell to us, we make the process painless.' },
  ]
  return (
    <section style={{ padding: '60px 20px', background: C.bg }}>
      <div style={{ maxWidth: 1080, margin: '0 auto' }}>
        <h2 style={{
          textAlign: 'center', fontSize: 'clamp(24px, 4vw, 32px)', fontWeight: 800,
          color: C.navy, letterSpacing: -0.6, marginBottom: 40,
        }}>Why sell to us</h2>
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 18,
        }}>
          {points.map(p => (
            <div key={p.t} style={{
              background: '#fff', border: `1px solid ${C.border}`, borderRadius: 14, padding: '24px 22px',
            }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                <div style={{
                  flexShrink: 0, width: 26, height: 26, borderRadius: 7, background: C.tealMuted,
                  color: C.teal, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontWeight: 800, fontSize: 15,
                }}>✓</div>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 16.5, color: C.navy, marginBottom: 6 }}>{p.t}</div>
                  <div style={{ color: C.textMid, fontSize: 14.5, lineHeight: 1.55 }}>{p.d}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

function FinalCta() {
  return (
    <section style={{
      background: `linear-gradient(160deg, ${C.navy} 0%, ${C.navyDeep} 100%)`,
      color: '#fff', padding: '56px 20px', textAlign: 'center',
    }}>
      <h2 style={{ fontSize: 'clamp(24px, 4vw, 34px)', fontWeight: 800, letterSpacing: -0.6, marginBottom: 14 }}>
        Ready to see what your car's worth?
      </h2>
      <p style={{ color: 'rgba(255,255,255,0.8)', fontSize: 17, marginBottom: 28, maxWidth: 480, margin: '0 auto 28px' }}>
        Get your free estimate in about a minute. No obligation.
      </p>
      <button onClick={scrollToQuote} style={{
        background: C.teal, color: '#fff', border: 'none', borderRadius: 10,
        padding: '15px 34px', fontSize: 17, fontWeight: 700, cursor: 'pointer', fontFamily: FONT,
      }}>Get my estimate →</button>
    </section>
  )
}

function Footer() {
  return (
    <footer style={{ background: C.navyDeep, color: 'rgba(255,255,255,0.6)', padding: '36px 20px' }}>
      <div style={{
        maxWidth: 1080, margin: '0 auto', display: 'flex', flexWrap: 'wrap',
        gap: 16, alignItems: 'center', justifyContent: 'space-between',
      }}>
        <Logo light />
        <div style={{ fontSize: 13, lineHeight: 1.6 }}>
          © {new Date().getFullYear()} TradeLane · We buy cars from local owners.<br />
          Estimates are not a binding offer and may be adjusted after a vehicle inspection.
        </div>
      </div>
    </footer>
  )
}

function TradeLane() {
  return (
    <div style={{ fontFamily: FONT, color: C.textDark, background: '#fff' }}>
      <Header />
      <Hero />
      <HowItWorks />
      <QuoteSection />
      <Why />
      <FinalCta />
      <Footer />
    </div>
  )
}

ReactDOM.createRoot(document.getElementById('root')).render(<TradeLane />)
