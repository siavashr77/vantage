# Vantage — Technical Handover

**Audience:** incoming senior engineer taking ownership through to production.
**Scope:** you own the whole system. This doc is a map + the prioritized path to production, not a tutorial. It's blunt about what's solid and what's missing.

---

## 1. What Vantage is

Used-car dealer **inventory + appraisal** web app, plus a **public customer-facing trade-in widget** that feeds leads back to the dealer. Built for a single dealership today; multi-store is a future direction (see parked permissions).

Three deployed pieces:

```
  Customer ──► Widget (Netlify, /widget.html)  ─┐
                                                 ├─► Backend API (Railway, Node/Express) ──► Postgres (Railway)
  Dealer staff ──► Vantage app (Netlify, /)  ───┘                │
                                                                  └─► External: VinAudit (market comps, PAID),
                                                                      NHTSA (VIN decode, free), Anthropic (AI descriptions)
```

- **Frontend:** React + Vite, deployed on Netlify. Two entry points (multi-page Vite build): the main app (`index.html` → `src/App.jsx`) and the standalone widget (`widget.html` → `src/widget.jsx`).
- **Backend:** single-file Node/Express (`server.js`) on Railway. Auto-deploys on push to `main`.
- **DB:** Postgres on Railway. Three tables (§6).

**Repo:** `github.com/siavashr77/vantage`, branch `main`. Push → both hosts auto-deploy (~1–2 min Railway, ~2 min Netlify).

---

## 2. Frontend orientation (you're backend-leaning, so just the map)

- **`src/App.jsx`** is the entire dealer app in one large file (~3.7k lines). Components are defined top-to-bottom (helpers, then feature components, then the root `Vantage()` at the bottom). Palette object `C` near the top. It's monolithic by choice for iteration speed — splitting it is optional cleanup, not required.
- **`src/widget.jsx`** is the standalone public widget — self-contained, its own small bundle. Does NOT import the main app.
- **`shared/suggestedBuy.js`** is the **offer engine**, imported by BOTH the frontend (appraisal page) and the backend (`server.js`). Single source of truth for the buy-price math — change it once, both sides update. Don't fork this.
- **Routing:** `react-router-dom`, set up in `src/main.jsx` (`BrowserRouter`). Routes are derived from the URL inside `App.jsx` via a `useEffect` on `location.pathname` that syncs URL ↔ a `page` state var. Navigation goes through a `goto(page, record)` helper. Netlify `public/_redirects` has the SPA catch-all + a widget rule (order matters — widget first).
- **State/persistence:** ⚠ **the dealer app stores appraisals, inventory, dealer settings, and the current user in `localStorage`** (keys: `vantage_appraisals`, `vantage_vehicles`, `vantage_dealer`, `vantage_user`). This is the single biggest architectural limitation — see §3 and §7. Leads are the exception: they're server-side in Postgres.

---

## 3. Status: done vs. what's left for you

**Done & live (built and tested):**
- Customer trade-in widget: VIN decode/lock or YMMT, geolocation→FSA, full question set (km, accident, condition, issues, tires, brakes, ownership/lien, photos), instant offer / ±3% range / specialist routing.
- Offer engine (`shared/suggestedBuy.js`): market-comp pricing, price↔km mileage regression, price-tiered gross, confidence tiers, accident deduction. Identical on frontend + backend.
- 24h market cache + background prefetch (cuts paid VinAudit calls, makes offers instant).
- Customer Leads inbox: urgency-sorted, differentiated cards, "work this lead" → pre-filled appraisal, dismiss.
- Duplicate-VIN detector (active appraisals + inventory).
- URL routing for every page + `/appraisal/:id`, `/inventory/:id`, `/lead/:id`.
- User permissions (Tier 1, UI-level — see §5).
- Security hardening (rate limiting, helmet, CORS allowlist, team-key gate, input validation, honeypot — see §5).

**Left for you (parked deliberately, in rough priority order):**
1. **Real authentication** — there is NO user login today. The "acting as" user picker is just a dropdown; permissions are UI-level only. This is the #1 production blocker. (§5)
2. **Move dealer data off `localStorage` to the backend/DB** — appraisals, inventory, dealer settings. Until this is done, that data is per-browser and per-device, deep links to appraisals/inventory only resolve on the browser that created them, and there's no real multi-user/multi-device story. (§7)
3. **Activate the security env vars** you've been handed (CORS allowlist + team key) — coded and ready, just need to be set in prod. (§5, §8)
4. **Bot protection on the widget** — honeypot is in; add a managed CAPTCHA (e.g. Cloudflare Turnstile) before serious public traffic.
5. **Production secrets management, WAF/DDoS, audit logging, backups** — infra-level, your call on tooling (this is presumably the AWS migration).
6. **Real Carfax Canada B2B integration** — stubbed; the offer engine already has the hook to factor claim amounts once real data flows.

---

## 4. API surface

Base URL (prod): `https://vantage-production-99d7.up.railway.app`

| Method | Route | Public? | Purpose | Notes |
|---|---|---|---|---|
| GET | `/api/health` | public | health/config check | |
| GET | `/api/vin/:vin` | public | VIN decode (NHTSA) | strict rate limit |
| GET | `/api/market/:vin` | public | market comps by VIN (VinAudit) | **PAID**, strict limit, cached |
| GET | `/api/market-by-spec` | public | market comps by YMMT | **PAID**, strict limit, cached |
| POST | `/api/offer/prefetch` | public | warm the market cache | strict limit |
| POST | `/api/leads` | **public** | widget lead submission + offer | strict limit, validated, honeypot |
| POST | `/api/fees` | public | dealer fee lookup | strict limit |
| POST | `/api/claude` | public | AI listing descriptions (Anthropic) | **PAID**, strict limit |
| GET | `/api/carfax/:vin` | public | Carfax (stubbed) | strict limit |
| **GET** | **`/api/leads`** | **PRIVATE** | read all leads | **`requireTeamKey`** — returns customer PII |
| **PATCH** | **`/api/leads/:id`** | **PRIVATE** | update lead status | **`requireTeamKey`** |

"Strict limit" = 15 req/min/IP; everything else under `/api/` = 120 req/min/IP. See §5.

⚠ Several public endpoints trigger **paid** third-party calls (VinAudit, Anthropic). Rate limiting + caching are the only cost controls today. Watch this.

---

## 5. Security model — READ THIS

**What's in place (this is hardening, not a fortress):**

- **Rate limiting** (`express-rate-limit`): general 120/min/IP across `/api/`, strict 15/min/IP on the costly/public endpoints. `trust proxy` is set for Railway. Primary defense against cost-draining abuse.
- **Helmet** security headers.
- **CORS allowlist** via `ALLOWED_ORIGIN` (comma-separated origins). **Currently UNSET → CORS is open.** Set it to lock the API to your Netlify domain(s).
- **Team-API-key gate** (`requireTeamKey`) on the private lead endpoints. Frontend sends `x-vantage-key`; key comes from `TEAM_API_KEY` (backend) / `VITE_TEAM_KEY` (frontend). **Currently UNSET → gate is OPEN, meaning `GET /api/leads` is publicly readable and exposes customer PII.** Activating this is high priority (§8).
- **Input validation** + length caps + VIN/postal format checks on the public lead endpoint.
- **Honeypot** field on the widget (`website`); filled = silently dropped.

**What this does NOT do — where your work starts:**

- **No real authentication.** The team key is a single shared secret shipped in the frontend bundle. It stops other websites and casual/anonymous access to the lead DB, but a determined attacker can extract it from the client. It is an *interim* control, explicitly not a substitute for per-user auth.
- **No per-user server-side authorization.** The permission system (Settings → Staff & Permissions) is **UI-level only** — it hides/disables controls in the browser. The backend does not check who's calling or what they're allowed to do. Anyone who can reach the API (with the team key, once set) can do anything the API allows. Real enforcement = server-side sessions + per-request authz, which is the auth rebuild.
- Permission definitions (the `PERMISSIONS` array in `App.jsx`) are a clean spec to carry into real auth — the UI gating maps 1:1 to checks you'll move server-side. Two permissions ("Wholesale Buyer", "Enterprise Transfer Manager") are parked placeholders for multi-store features that don't exist yet.

**Boot logs** print the security posture (CORS open/restricted, team gate open/enabled, rate limiting) — check Railway logs after deploy to confirm what's active.

---

## 6. Data model

**Postgres (Railway), tables auto-created on boot in `server.js`:**

- **`pending_leads`** — customer widget submissions. Columns include: vehicle (`vin, year, make, model, trim, odometer, postal`), customer (`customer_name, customer_email, customer_phone`), offer (`offer_amount, base_offer, accident_deduction, offer_breakdown, market_mid, confidence, thin_market`), customer-reported detail (`condition_opinion, known_issues, tire_condition, brake_condition, ownership, lien_holder, lien_balance, photos` [JSONB, compressed data-URLs]), and `status` (`pending`/`converted`/`dismissed`), `source`, `created_at`. New columns are added via idempotent `ALTER ... ADD COLUMN IF NOT EXISTS` on boot.
- **`market_cache`** — 24h cache of VinAudit results, keyed by VIN-or-spec + FSA. Cuts paid lookups.
- **`dealer_fees`** — dealer fee ledger (used by `/api/fees`).

**localStorage (frontend, per-browser) — the migration target:**
`vantage_appraisals`, `vantage_vehicles`, `vantage_dealer`, `vantage_user`. Moving these server-side (with real auth) is the core of productionizing — it's what unlocks multi-user, multi-device, shareable deep links, and real authorization.

---

## 7. Key decisions & rationale (so you don't re-litigate them)

- **Offer = exact engine number, no consumer softening** (only a declared-accident deduction). Deliberate — soft offers lose customers in this market. Widget withholds the number (routes to specialist) only on thin market or extreme mileage.
- **Mileage handled via market-derived regression** (slope from actual comps), not static per-km rates — more defensible, ties to a future data moat.
- **Shared offer engine** (`shared/suggestedBuy.js`) imported by both sides — prevents logic drift. Keep it that way.
- **Caching over sampling** for market data — full accuracy + speed.
- **Widget questions are info-only** — they do NOT affect the offer, just give the appraiser context. Intentional.
- **localStorage for dealer data** was an iteration-speed choice, always understood as temporary. It's the thing to migrate.
- **Tier-1 (UI) permissions now, real auth later** — see §5.

---

## 8. Env vars & activation steps

**Backend (Railway):**
| Var | Purpose | Status |
|---|---|---|
| `DATABASE_URL` | Postgres (injected by Railway) | set |
| `VINAUDIT_KEY` | market data (paid) | set |
| `ANTHROPIC_KEY` | AI descriptions (paid) | set |
| `PORT` | injected by Railway | set |
| `ALLOWED_ORIGIN` | CORS allowlist, comma-separated origins | ⚠ **UNSET — set in prod** |
| `TEAM_API_KEY` | shared secret for private lead endpoints | ⚠ **UNSET — set in prod** |
| `CARFAX_API_KEY` | Carfax (stubbed) | unset (feature not live) |

**Frontend (Netlify):**
| Var | Purpose | Status |
|---|---|---|
| `VITE_API_URL` | backend base URL | set |
| `VITE_TEAM_KEY` | must match backend `TEAM_API_KEY` | ⚠ **UNSET — set in prod** |

**To activate the team-key gate WITHOUT locking out the dealer app (order matters):**
1. Generate a strong random secret.
2. Set `TEAM_API_KEY` on Railway **and** `VITE_TEAM_KEY` (same value) on Netlify.
3. **Trigger a Netlify rebuild** (Vite inlines env vars at build time — the frontend won't have the key until rebuilt).
4. Verify the Leads inbox still loads (it now sends `x-vantage-key`). Confirm `GET /api/leads` without the header returns 401.

**To lock CORS:** set `ALLOWED_ORIGIN` on Railway to your Netlify origin(s), comma-separated. Note the widget is embedded cross-origin via iframe on dealer sites — the widget's *public* endpoints are reached server-side/anonymously and aren't origin-gated the same way; confirm embedding still works after setting this.

All gates **default open when unset**, so setting them is safe and reversible — nothing breaks until you opt in, and boot logs confirm the active posture.

---

## 9. Deploy & build

- **Deploy:** push to `main` → Railway (backend) + Netlify (frontend) auto-deploy.
- **Frontend build:** `npm install && npm run build` (Vite multi-page → `dist/` with `index.html` + `widget.html` + `embed.js`). After deploy, hard-reload to bust Netlify's aggressive cache.
- **Backend:** `node server.js` (Railway runs this; `node --check server.js` to lint locally).
- **Widget embed:** dealers drop `<script src="https://<host>/embed.js" data-dealer="..."></script>` — injects an auto-resizing iframe pointing at `/widget.html`.

---

## 10. Known issues / tech debt

- ⚠ **A GitHub PAT was pasted repeatedly into the build chat history used to develop this. Rotate/revoke it.** (Owner is aware.)
- **localStorage data model** (§2, §7) — the big one.
- **No real auth / server-side authz** (§5).
- **Security env vars unset** in prod (§8).
- **Geocoding** uses free OpenStreetMap Nominatim (widget FSA lookup) — rate-limited, not for high volume. Swap for a paid geocoder before scale.
- **Carfax** is stubbed.
- **AI-generated vehicle options/descriptions** are unverified — flag as suggested if surfaced to consumers.
- **`App.jsx` is monolithic** — fine, but a refactor target if you prefer.
- **Legal/IP/corporate-opportunity clearance** before public launch is the owner's track, noted here for completeness.

---

## 11. Suggested first moves

1. Rotate the exposed PAT.
2. Set `ALLOWED_ORIGIN` + `TEAM_API_KEY`/`VITE_TEAM_KEY` and rebuild (§8) — closes the open lead-DB hole in minutes.
3. Skim `shared/suggestedBuy.js` (the offer engine) and `server.js` top-to-bottom (it's linear).
4. Plan the auth + localStorage→DB migration together — they're the same project and everything else (multi-user, deep links, real authz, multi-store) depends on it.
