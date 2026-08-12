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
  // The form's container is #tradelane-quote — targeting #quote matched
  // nothing, so the button appeared to be broken.
  const el = document.getElementById('tradelane-quote')
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
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
  // The wordmark: lowercase "tradelane" between two rules. The viewBox is
  // cropped tight to the artwork — the original screengrab carried ~40% empty
  // padding, so setting a larger height just scaled up whitespace and the mark
  // itself never appeared to grow.
  const word = light ? '#FFFFFF' : C.navy
  const rule = light ? '#FFD34D' : C.teal
  return (
    <svg height={height} viewBox="55 12 433 153" role="img" aria-label="tradelane"
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
  const [open, setOpen] = React.useState(false)
  const jump = (id) => {
    setOpen(false)
    const el = document.getElementById(id)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  return (
    <header style={{ background: '#fff', borderBottom: `1px solid ${C.border}`, position: 'relative' }}>
      <div style={{
        maxWidth: 1120, margin: '0 auto', padding: '18px 20px',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <Logo height={54} />
        <button onClick={() => setOpen(o => !o)} aria-label="Menu" aria-expanded={open}
          style={{
            position: 'absolute', right: 20, top: '50%', transform: 'translateY(-50%)',
            background: 'none', border: 'none', padding: 8, cursor: 'pointer',
            display: 'flex', flexDirection: 'column', gap: 5,
          }}>
          {[0, 1, 2].map(i => (
            <span key={i} style={{ display: 'block', width: 22, height: 2.5, borderRadius: 2, background: C.navy }} />
          ))}
        </button>
      </div>

      {open && (
        <div style={{
          position: 'absolute', right: 16, top: '100%', zIndex: 60,
          background: '#fff', border: `1px solid ${C.border}`, borderRadius: 10,
          boxShadow: '0 10px 34px rgba(0,0,0,0.14)', minWidth: 210, overflow: 'hidden',
        }}>
          {[
            ['Get an estimate', 'tradelane-quote'],
            ['How it works', 'how'],
            ['Common questions', 'faq'],
          ].map(([label, id], i, arr) => (
            <button key={id} onClick={() => jump(id)} style={{
              width: '100%', textAlign: 'left', padding: '13px 16px', background: 'none',
              border: 'none', borderBottom: i < arr.length - 1 ? `1px solid ${C.border}` : 'none',
              fontSize: 14.5, fontWeight: 600, color: C.navy, cursor: 'pointer', fontFamily: FONT,
            }}>{label}</button>
          ))}
        </div>
      )}
    </header>
  )
}

function Hero() {
  // Form-first, but the left column has to hold its own weight — a headline
  // floating in a large empty field is what made this look unfinished. The
  // pitch now carries three concrete points and the two columns align at the
  // top, so they read as one composition rather than two stacked boxes.
  return (
    <section style={{
      background: `linear-gradient(157deg, ${C.navy} 0%, ${C.navyDeep} 100%)`,
      color: '#fff', padding: 'clamp(28px, 5vw, 64px) clamp(18px, 4vw, 28px) clamp(40px, 6vw, 72px)',
    }}>
      <div style={{
        maxWidth: 1120, margin: '0 auto',
        display: 'flex', flexWrap: 'wrap', gap: 'clamp(32px, 5vw, 56px)', alignItems: 'flex-start',
        // see .hero-pitch / .hero-form below for the mobile ordering
      }}>
        <div className="hero-pitch" style={{ flex: '1 1 420px', maxWidth: 520, paddingTop: 4 }}>
          <h1 style={{
            fontSize: 'clamp(34px, 4.6vw, 50px)', fontWeight: 800, lineHeight: 1.08,
            letterSpacing: -1.4, margin: '0 0 20px',
          }}>
            What's your car<br />actually worth?
          </h1>
          <p style={{
            fontSize: 'clamp(16px, 2vw, 19px)', color: 'rgba(255,255,255,0.80)',
            margin: '0 0 32px', lineHeight: 1.6, maxWidth: 460,
          }}>
            A real number built from cars actually listed near you — not a lowball
            anchor designed to get you through the door.
          </p>

          {/* Three concrete points. This is what fills the column honestly,
              rather than padding it with whitespace. */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18, marginBottom: 34 }}>
            {[
              ['Priced off live listings', 'We read what comparable cars are asking today, and what they actually sold for.'],
              ['No obligation, no pressure', 'Take the number to another dealer if you like. We would rather be the honest quote.'],
              ['A local team, not a call centre', 'You deal with the people who will buy the car.'],
            ].map(([title, body]) => (
              <div key={title} style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
                <div style={{
                  flexShrink: 0, width: 7, height: 7, borderRadius: 4,
                  background: C.teal, marginTop: 8,
                }} />
                <div>
                  <div style={{ fontSize: 15.5, fontWeight: 700, marginBottom: 3 }}>{title}</div>
                  <div style={{ fontSize: 14.5, color: 'rgba(255,255,255,0.68)', lineHeight: 1.55 }}>{body}</div>
                </div>
              </div>
            ))}
          </div>

          <div style={{
            fontSize: 13.5, color: 'rgba(255,255,255,0.55)',
            borderTop: '1px solid rgba(255,255,255,0.14)', paddingTop: 18,
          }}>
            Takes about a minute · Free · No obligation
          </div>
        </div>

        <div className="hero-form" style={{ flex: '1 1 400px', maxWidth: 452, width: '100%' }}>
          <div id="tradelane-quote" style={{
            background: C.card, borderRadius: 14,
            boxShadow: '0 20px 60px rgba(0,0,0,0.30)',
          }}>
            <Widget theme={{ navy: C.navy, navyLight: C.navyLight, navyDeep: C.navyDeep,
                             navyMuted: C.navyMuted, teal: C.teal, tealLight: C.tealLight,
                             tealMuted: C.tealMuted, textDark: C.textDark,
                             select: C.navy, selectMuted: 'rgba(4,74,126,0.07)' }} branding={{
              title: 'What is it worth?',
              subtitle: 'Start with your VIN, or pick your car.',
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
    <section style={{ padding: '60px 20px', background: C.bg }} id="how">
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

function FAQ() {
  const items = [
    {
      q: 'How does the Ontario tax saving on a trade-in work?',
      a: `In Ontario you pay HST on a used vehicle you buy. When you trade a car in, you're only taxed on the difference between the price of the car you're buying and the value of the one you're trading. So on a $40,000 car with a $15,000 trade-in, you pay 13% on $25,000 rather than on the full $40,000 — a saving of about $1,950. Sell privately for $15,000 and you don't get that credit, so a private sale has to be roughly $1,950 higher just to break even.`,
    },
    {
      q: "I'm buying from another dealer. Can I still use my TradeLane offer?",
      a: `Yes, and this is where most of the value is. Tell the dealer you're buying from that TradeLane is purchasing your car, and ask them to structure it as a trade-in — they take your vehicle on the deal at our price, and we buy it from them. You get the tax credit on your purchase and our number for your car. It's a routine arrangement between dealers; just mention it before you agree on paperwork, because it's harder to restructure afterwards.`,
    },
    {
      q: 'Is the estimate what you actually pay?',
      a: `It's an honest starting point, not a binding offer. It's built from what comparable cars are listed and sold for right now, based on what you tell us. We confirm it after seeing the car, because condition, tires, service history and accident repairs all move the number — in both directions.`,
    },
    {
      q: 'What if I still owe money on the car?',
      a: `That's normal and not a problem. We deal directly with your lender to pay out the balance. If the car is worth more than you owe, you get the difference; if you owe more than it's worth, the shortfall can often be settled or rolled into your next vehicle. Tell us your lender and payout amount and we'll show you exactly where you stand.`,
    },
    {
      q: 'Do I have to buy a car from you?',
      a: `No. We'll buy your car outright whether or not you're buying anything. Some people sell and walk away, some are buying elsewhere, some end up buying from us. The estimate is the same either way.`,
    },
    {
      q: 'What do I need to bring?',
      a: `Your ownership (vehicle permit), a valid driver's licence, and both sets of keys if you have them. If there's a loan, bring your lender details. If the car is owned by more than one person, everyone on the ownership needs to sign.`,
    },
    {
      q: 'How long does the whole thing take?',
      a: `The estimate takes about a minute. If you decide to go ahead, an inspection is usually 30 to 45 minutes, and payment is typically same or next business day once the paperwork is signed and any lien is cleared.`,
    },
  ]
  const [open, setOpen] = React.useState(0)
  return (
    <section id="faq" style={{ background: '#fff', padding: '64px 20px' }}>
      <div style={{ maxWidth: 760, margin: '0 auto' }}>
        <h2 style={{
          fontSize: 'clamp(24px, 3.6vw, 32px)', fontWeight: 800, color: C.navy,
          margin: '0 0 28px', letterSpacing: -0.6,
        }}>Common questions</h2>
        <div style={{ border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>
          {items.map((it, i) => (
            <div key={i} style={{ borderBottom: i < items.length - 1 ? `1px solid ${C.border}` : 'none' }}>
              <button onClick={() => setOpen(open === i ? -1 : i)}
                aria-expanded={open === i}
                style={{
                  width: '100%', textAlign: 'left', padding: '18px 20px', background: 'none',
                  border: 'none', cursor: 'pointer', fontFamily: FONT,
                  display: 'flex', alignItems: 'flex-start', gap: 14,
                }}>
                <span style={{
                  flex: 1, fontSize: 16, fontWeight: 700, color: C.navy, lineHeight: 1.4,
                }}>{it.q}</span>
                <span style={{
                  flexShrink: 0, fontSize: 20, color: C.textLight, lineHeight: 1,
                  transform: open === i ? 'rotate(45deg)' : 'none', transition: 'transform 0.15s',
                }}>+</span>
              </button>
              {open === i && (
                <div style={{
                  padding: '0 20px 20px', fontSize: 15, lineHeight: 1.65, color: C.textMid,
                }}>{it.a}</div>
              )}
            </div>
          ))}
        </div>
        <div style={{ fontSize: 13.5, color: C.textLight, marginTop: 16, lineHeight: 1.6 }}>
          Tax figures are general guidance for Ontario private buyers, not tax advice.
          Your own situation may differ.
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
      <FAQ />
      <QuoteSection />
      <Footer />

      <style>{`
        @media (max-width: 860px) {
          /* Columns stack on a phone, and the form has to come first —
             otherwise the supporting points push it a full screen down, which
             defeats the point of leading with the form. */
          .hero-form  { order: 1; }
          .hero-pitch { order: 2; }
        }
        @media (max-width: 768px) {
          /* iOS zooms in on any focused field whose text is under 16px and
             never zooms back out, leaving the visitor pinching to recover on
             every question. 16px is the threshold that prevents it. */
          input, select, textarea { font-size: 16px !important; }
        }
      `}</style>
    </div>
  )
}

ReactDOM.createRoot(document.getElementById('root')).render(<TradeLane />)
