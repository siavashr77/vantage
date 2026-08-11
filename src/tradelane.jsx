import React from 'react'
import ReactDOM from 'react-dom/client'
import { Widget } from './widget.jsx'

// ── TradeLane — consumer "sell us your car" site ──────────────────────────────
// Standalone public homepage (its own build entry → /tradelane.html). A car
// owner lands here, gets an estimate, and the submission flows into the Vantage
// Leads inbox via the shared backend. Reuses the existing <Widget /> quote
// engine (VIN decode, condition, photos, instant offer) wrapped in a marketing
// page. Trust-first, "let's figure it out together" positioning — not an
// TradeLane brand palette, sampled from the logo: a deep marine blue with a
// warm yellow. The key names are kept as navy/teal so the shared quote widget
// picks the brand up without a rewrite — only the values changed.

const C = {
  navy: '#044A7E', navyLight: '#0A5F9E', navyDeep: '#023656',
  navyMuted: 'rgba(4,74,126,0.06)',
  // The yellow is the accent — used sparingly on calls to action and rules,
  // where it does the same job as the bars above and below the wordmark.
  teal: '#F6BD0D', tealLight: '#FFD34D', tealMuted: 'rgba(246,189,13,0.12)',
  card: '#FFFFFF', textDark: '#04304F', textMid: '#4A5568', textLight: '#8C95A0',
  bg: '#F6F9FC', border: 'rgba(0,0,0,0.10)',
}

const FONT = "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"

function scrollToQuote(e) {
  e?.preventDefault?.()
  const el = document.getElementById('quote')
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

function LogoMark({ size = 32, light }) {
  // A "lane" mark: a rounded square holding two forward-converging road lines
  // (a lane narrowing toward the horizon) with a motion chevron — suggests a
  // road/trade route and forward momentum. Navy tile, teal lane.
  const tile = light ? '#FFFFFF' : C.navy
  const lane = C.teal
  const accent = light ? C.navy : '#FFFFFF'
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <rect width="48" height="48" rx="11" fill={tile} />
      {/* Outer lane edges converging upward (perspective road) */}
      <path d="M12 38 L21 12 L27 12 L36 38" stroke={lane} strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      {/* Dashed centre line */}
      <path d="M24 35 L24 30 M24 26 L24 22 M24 18 L24 15" stroke={accent} strokeWidth="2.6" strokeLinecap="round" />
      {/* Forward motion chevron at the horizon */}
      <path d="M20 13 L24 8 L28 13" stroke={lane} strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  )
}

function Logo({ light, height = 34 }) {
  // The real wordmark: lowercase "tradelane" between two yellow rules. Drawn as
  // SVG rather than an image file so it stays crisp at any size and can invert
  // on a dark background without a second asset.
  const word = light ? '#FFFFFF' : C.navy
  const rule = light ? '#FFD34D' : C.teal
  return (
    <svg height={height} viewBox="0 0 543 176" role="img" aria-label="tradelane"
         style={{ display: 'block' }} xmlns="http://www.w3.org/2000/svg">
      <title>tradelane</title>
      <rect x="60" y="18" width="423" height="13" rx="2" fill={rule} />
      <rect x="60" y="146" width="423" height="13" rx="2" fill={rule} />
      <text x="271.5" y="112" fontFamily={FONT} fontSize="86" fontWeight="700"
            letterSpacing="-1.5" fill={word} textAnchor="middle">tradelane</text>
    </svg>
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
          background: C.teal, color: C.navyDeep, border: 'none', borderRadius: 8,
          padding: '9px 18px', fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: FONT,
        }}>Get my estimate</button>
      </div>
    </header>
  )
}

function Hero() {
  // Form-first. Visitors arriving here already want a number — making them
  // scroll past marketing to reach the form adds friction exactly where it
  // costs the most. The estimate form IS the hero; the persuasion content
  // lives below for anyone who wants to read it before committing.
  return (
    <section style={{
      background: `linear-gradient(160deg, ${C.navy} 0%, ${C.navyDeep} 100%)`,
      color: '#fff', padding: '40px 20px 48px',
    }}>
      <div style={{
        maxWidth: 1080, margin: '0 auto',
        display: 'flex', flexWrap: 'wrap', gap: 40,
        alignItems: 'center', justifyContent: 'center',
      }}>
        {/* Pitch — deliberately short. One promise, three reassurances. */}
        <div style={{ flex: '1 1 380px', maxWidth: 520, textAlign: 'left' }}>
          <div style={{
            display: 'inline-block', background: 'rgba(246,189,13,0.22)', color: C.tealLight,
            borderRadius: 20, padding: '6px 14px', fontSize: 13, fontWeight: 600, marginBottom: 18,
          }}>Sell your car the easy way</div>
          <h1 style={{
            fontSize: 'clamp(28px, 4.4vw, 42px)', fontWeight: 800, lineHeight: 1.12,
            letterSpacing: -1, margin: '0 0 16px',
          }}>
            What's your car<br />
            <span style={{ color: C.tealLight }}>actually worth?</span>
          </h1>
          <p style={{
            fontSize: 'clamp(15px, 2.2vw, 18px)', color: 'rgba(255,255,255,0.82)',
            margin: '0 0 22px', lineHeight: 1.55, maxWidth: 460,
          }}>
            A real estimate built from live market listings — not a lowball anchor.
            Takes about a minute.
          </p>
          <div style={{
            fontSize: 13.5, color: 'rgba(255,255,255,0.6)',
            display: 'flex', gap: 18, flexWrap: 'wrap',
          }}>
            <span>✓ Free estimate</span>
            <span>✓ No obligation</span>
            <span>✓ Local &amp; friendly</span>
          </div>
        </div>

        {/* The form, immediately usable — no scrolling required. */}
        <div style={{ flex: '1 1 380px', maxWidth: 460, width: '100%' }}>
          <div id="tradelane-quote" style={{
            background: C.bg, borderRadius: 16, boxShadow: '0 18px 50px rgba(0,0,0,0.28)',
            padding: '4px 4px 0',
          }}>
            <Widget theme={{ navy: C.navy, navyLight: C.navyLight, navyDeep: C.navyDeep,
                             navyMuted: C.navyMuted, teal: C.teal, tealLight: C.tealLight,
                             tealMuted: C.tealMuted, textDark: C.textDark }} branding={{
              title: 'Get your estimate',
              subtitle: 'Start with your VIN — or pick your car.',
              footer: '',
            }} />
          </div>
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
  // The form now lives in the hero. This is just a way back to it for anyone
  // who read the whole page first.
  return (
    <section style={{ background: C.bg, padding: '48px 20px' }}>
      <div style={{ maxWidth: 620, margin: '0 auto', textAlign: 'center' }}>
        <h2 style={{ fontSize: 'clamp(22px, 3.4vw, 30px)', fontWeight: 800, color: C.navy, margin: '0 0 12px' }}>
          Ready for your number?
        </h2>
        <p style={{ color: C.textMid, fontSize: 16, margin: '0 0 22px', lineHeight: 1.55 }}>
          A few quick questions. Only your name and a way to reach you are required.
        </p>
        <button onClick={scrollToQuote} style={{
          background: C.teal, color: C.navyDeep, border: 'none', borderRadius: 10,
          padding: '15px 34px', fontSize: 17, fontWeight: 700, cursor: 'pointer',
          fontFamily: FONT, boxShadow: '0 8px 24px rgba(246,189,13,0.35)',
        }}>Get my estimate →</button>
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
        background: C.teal, color: C.navyDeep, border: 'none', borderRadius: 10,
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
      {/* Form-first: the estimate form is in the hero. Everything below is for
          visitors who want to read before they commit, ending in one CTA that
          takes them back up to the form (not two near-identical ones). */}
      <Hero />
      <HowItWorks />
      <Why />
      <QuoteSection />
      <Footer />
    </div>
  )
}

ReactDOM.createRoot(document.getElementById('root')).render(<TradeLane />)
