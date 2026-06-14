// ─────────────────────────────────────────────────────────────────────────
// SHARED OFFER BRAIN — single source of truth for the suggested-buy number.
//
// Imported by BOTH the browser app (src/App.jsx, via Vite) and the backend
// (server.js, via Node). Keeping the math in ONE file guarantees the widget's
// instant offer and Vantage's appraisal page produce the identical number.
//
// Plain ESM, no React/Node-specific dependencies — safe in either context.
// ─────────────────────────────────────────────────────────────────────────

// Money formatter used in the plain-English rationale (matches the client's fmt).
export const fmt = n => n ? `$${Number(n).toLocaleString('en-CA')}` : '—';

// Makes that carry more reconditioning risk (higher parts/labour).
export const LUXURY_MAKES = new Set(['land rover','range rover','jaguar','bmw','mercedes-benz','mercedes','audi','porsche','lexus','infiniti','acura','cadillac','volvo','genesis','maserati','bentley','tesla','lincoln','alfa romeo']);

// Confidence from comp depth.
export function confidenceFrom(a) {
  const n = Number(a.activeComps) || (a._comps ? a._comps.length : 0);
  if (n >= 12) return 'High';
  if (n >= 6) return 'Medium';
  return 'Low';
}

// ── History / accident adjustment ───────────────────────────────────────
// The canonical rule for pulling the buy down on reported accidents is the
// claim-$ rule (per incident):
//   claim/estimate < $3,000  → −$500
//   claim/estimate ≥ $3,000  → −⅓ of the amount
//   (if both a claim AND an estimate exist for one incident, use the CLAIM)
// This is the SAME math as the widget's accidentDeduction — unified here so
// there is one accident rule everywhere.
//
// DATA SOURCE, best-available:
//   • Real Carfax with per-incident claim amounts  → exact claim-$ rule (primary)
//   • Carfax reports not-clean but NO claim amounts → −5% of target retail (fallback)
//   • Clean / no Carfax                             → 0
//
// Until real Carfax Canada integration lands, no claim amounts flow in, so this
// returns the −5% fallback exactly as before — current numbers are UNCHANGED.
//
// `carfax` shape (future): { clean: boolean, incidents?: [{ claim?: number, estimate?: number }] }
export function historyAdjustment(carfax, targetRetail) {
  if (!carfax || carfax.clean !== false) return 0;

  // PRIMARY: real per-incident claim/estimate dollars (when Carfax provides them).
  const incidents = Array.isArray(carfax.incidents) ? carfax.incidents : [];
  const withAmounts = incidents.filter(i => {
    const v = Number(i && (i.claim != null ? i.claim : i.estimate));
    return Number.isFinite(v) && v > 0;
  });
  if (withAmounts.length > 0) {
    let total = 0;
    for (const i of withAmounts) {
      // Use the CLAIM value when both claim and estimate exist for an incident.
      const amt = Number(i.claim != null ? i.claim : i.estimate);
      total += amt < 3000 ? 500 : Math.round(amt / 3);
    }
    return -total;
  }

  // FALLBACK: Carfax flags issues but gives no claim amounts → flat −5%.
  return -Math.round(targetRetail * 0.05);
}

// ── Price ↔ mileage pattern (market-derived) ────────────────────────────
// Find the relationship between price and km IN THE ACTUAL COMP SET, then read
// it at the appraised car's km to get a mileage-correct value. The market itself
// tells us what a km is worth for this exact vehicle — no guessed per-km rate.
//
// Returns:
//   { price, basis, confidence, slope, compCount, kmInRange, note }
//   • price       — predicted price at subjectKm (or median fallback)
//   • basis       — 'regression' | 'median' (how price was derived)
//   • confidence  — 'High' | 'Medium' | 'Low'
//   • kmInRange   — is subjectKm within the comps' km spread?
//
// Confidence is LOW when the subject km isn't close to the comps (extrapolation)
// or too few comps carry usable km — i.e. the pattern is guessing.
export function priceAtMileage(comps, subjectKm, medianMid) {
  const km = Number(subjectKm);
  // Usable points: both price and mileage present and sane.
  const pts = (comps || [])
    .map(c => ({ x: Number(c.mileage), y: Number(c.price) }))
    .filter(p => Number.isFinite(p.x) && p.x > 0 && Number.isFinite(p.y) && p.y > 0);

  const MIN_PTS = 6;               // below this, regression isn't reliable
  const fallback = (note) => ({
    price: Number(medianMid) || null, basis: 'median',
    confidence: (Number(comps?.length) || 0) >= 12 ? 'High' : (Number(comps?.length) || 0) >= MIN_PTS ? 'Medium' : 'Low',
    slope: null, compCount: pts.length, kmInRange: null, note,
  });

  // No subject km, or too few usable points → fall back to the median mid.
  if (!Number.isFinite(km) || km <= 0) return fallback('no odometer — using median market price');
  if (pts.length < MIN_PTS) return fallback('too few comps with mileage — using median market price');

  // Least-squares linear fit: y = a + b·x  (b = $/km, expected negative).
  const n = pts.length;
  const sx = pts.reduce((s, p) => s + p.x, 0);
  const sy = pts.reduce((s, p) => s + p.y, 0);
  const sxx = pts.reduce((s, p) => s + p.x * p.x, 0);
  const sxy = pts.reduce((s, p) => s + p.x * p.y, 0);
  const denom = n * sxx - sx * sx;
  if (denom === 0) return fallback('comps have no mileage spread — using median market price');
  const slope = (n * sxy - sx * sy) / denom;
  const intercept = (sy - slope * sx) / n;

  // Fit strength (R²) — how well km explains price. Weak fit → shrink toward median.
  const meanY = sy / n;
  let ssTot = 0, ssRes = 0;
  for (const p of pts) {
    const pred = intercept + slope * p.x;
    ssTot += (p.y - meanY) ** 2;
    ssRes += (p.y - pred) ** 2;
  }
  const r2 = ssTot > 0 ? 1 - ssRes / ssTot : 0;

  // Where does the subject km sit relative to the comps?
  const xs = pts.map(p => p.x).sort((a, b) => a - b);
  const kmMin = xs[0], kmMax = xs[xs.length - 1];
  const span = kmMax - kmMin || 1;
  // "Close to market" = within the comp range, or within ~15% of the span beyond it.
  const tol = span * 0.15;
  const kmInRange = km >= kmMin - tol && km <= kmMax + tol;
  // Extreme = well outside the comp range (your 200,000km case with low-km comps).
  const extreme = km < kmMin - span * 0.5 || km > kmMax + span * 0.5;

  let predicted = Math.round(intercept + slope * km);
  // Guard: a wild/positive slope or nonsensical prediction → fall back to median.
  if (!Number.isFinite(predicted) || predicted <= 0) return fallback('mileage pattern unreliable — using median market price');

  // Confidence: needs a real fit AND the subject km near the comps.
  let confidence = 'High';
  if (extreme || r2 < 0.15) confidence = 'Low';
  else if (!kmInRange || r2 < 0.4 || n < 12) confidence = 'Medium';

  // Weak-but-usable fit: blend toward median so a spurious slope can't dominate.
  if (r2 < 0.15 && Number(medianMid) > 0) {
    predicted = Math.round(0.5 * predicted + 0.5 * Number(medianMid));
  }

  return {
    price: predicted, basis: 'regression', confidence, slope,
    compCount: n, kmInRange,
    note: extreme
      ? 'appraised mileage is far outside comparable listings — value extrapolated, low confidence'
      : kmInRange ? 'mileage-matched to comparable market'
      : 'appraised mileage near edge of comparable range',
  };
}

// Appraise BACKWARD from dealer target retail to a suggested purchase price.
// `a`: appraisal/vehicle-shaped object (marketMid, marketDaysSupply, make,
//      optional reconCost/certCost/pack/targetGrossOverride/carfax/activeComps).
// `dealer`: pricing strategy (marketPositionPct, targetGross, avgRecon).
// Returns { suggested, targetRetail, gross, recon, reasons, confidence } or null.
export function computeSuggestedBuy(a, dealer) {
  const mid = Number(a.marketMid);
  if (!mid || mid <= 0) return null;
  const d = dealer || {};
  const positionPct = Number(d.marketPositionPct) || 97;
  // Per-appraisal override takes priority over the dealer default — lets the
  // appraiser demand a higher gross on expensive/slow units.
  const overrideGross = a.targetGrossOverride !== '' && a.targetGrossOverride != null ? Number(a.targetGrossOverride) : null;
  const baseGross = overrideGross != null && overrideGross > 0 ? overrideGross : (Number(d.targetGross) || 2500);
  // Recon: use what's entered on the appraisal; else the dealer's average.
  const reconEntered = a.reconCost !== '' && a.reconCost != null;
  let recon = reconEntered ? Number(a.reconCost) : (Number(d.avgRecon) || 0);
  const otherCosts = Number(a.certCost || 0) + Number(a.pack || 0);

  const reasons = [];

  // 1) Price basis. When we have the comp set AND the subject's odometer, derive
  //    a MILEAGE-MATCHED price from the price↔km pattern in the comps (the market
  //    tells us what this car is worth at its actual km). Otherwise fall back to
  //    the flat market mid (identical to prior behavior).
  let basisPrice = mid;
  let kmConfidence = null;       // 'High'|'Medium'|'Low' from the mileage fit
  let kmNote = null;
  const comps = Array.isArray(a.comps) ? a.comps : null;
  const subjectKm = a.odometer != null && a.odometer !== '' ? Number(a.odometer) : null;
  if (comps && comps.length && Number.isFinite(subjectKm) && subjectKm > 0) {
    const pm = priceAtMileage(comps, subjectKm, mid);
    if (pm && pm.price > 0) {
      basisPrice = pm.price;
      kmConfidence = pm.confidence;
      kmNote = pm.note;
      if (pm.basis === 'regression') {
        reasons.push(`Mileage-matched price ${fmt(basisPrice)} at ${Number(subjectKm).toLocaleString('en-CA')} km (${pm.note})`);
      } else {
        reasons.push(`Using median market price ${fmt(basisPrice)} — ${pm.note}`);
      }
    }
  }

  // Target retail = mileage-matched (or median) price × dealer's position.
  const targetRetail = Math.round(basisPrice * (positionPct / 100));
  reasons.push(`Retail target ${fmt(targetRetail)} (${positionPct}% of ${fmt(basisPrice)})`);

  // 2) Margin scales with how slow the segment is moving. More day-supply =
  //    longer hold = demand more gross to cover carrying cost.
  let gross = baseGross;
  if (overrideGross != null && overrideGross > 0) {
    reasons.push(`Using your ${fmt(overrideGross)} target gross (override)`);
  }
  const mds = Number(a.marketDaysSupply);
  if (Number.isFinite(mds) && mds > 0) {
    if (mds >= 90) { gross = baseGross + 1500; reasons.push(`+$1,500 gross — slow market (${mds}-day supply), longer hold`); }
    else if (mds >= 60) { gross = baseGross + 1000; reasons.push(`+$1,000 gross — softer market (${mds}-day supply)`); }
    else if (mds <= 30) { gross = Math.max(1000, baseGross - 500); reasons.push(`−$500 gross — fast mover (${mds}-day supply), turns quickly`); }
  }

  // 3) Luxury makes carry more reconditioning risk. If the user hasn't entered
  //    their own recon, bump the assumed recon (and flag it either way).
  const isLux = LUXURY_MAKES.has(String(a.make || '').toLowerCase());
  if (isLux) {
    if (!reconEntered) { recon = Math.max(recon, 2500); reasons.push(`Recon assumed ${fmt(recon)} — luxury make, higher recon risk`); }
    else { reasons.push('Luxury make — verify recon covers higher parts/labour'); }
  }

  // 4) History (Carfax): reported accidents/issues pull the buy down. Uses the
  //    claim-$ rule when real claim amounts are available; falls back to −5%
  //    when Carfax only reports not-clean. See historyAdjustment above.
  const historyAdj = historyAdjustment(a.carfax, targetRetail);
  if (historyAdj !== 0) {
    reasons.push(`${fmt(historyAdj)} — reported history issues (Carfax)`);
  }

  // Suggested buy = retail − gross − recon − other costs + history adj.
  const suggested = Math.round(targetRetail - gross - recon - otherCosts + historyAdj);
  if (suggested <= 0) return null;

  // Overall confidence: the comp-count confidence, downgraded if the mileage fit
  // is weak (subject km far from comps / poor pattern). The widget uses kmConfidence
  // to decide whether to show the number or route to a specialist.
  const compConf = confidenceFrom(a);
  const rank = { Low: 0, Medium: 1, High: 2 };
  const overallConfidence = kmConfidence
    ? (rank[kmConfidence] < rank[compConf] ? kmConfidence : compConf)
    : compConf;

  return {
    suggested,
    targetRetail,
    basisPrice,
    gross,
    recon,
    reasons,
    confidence: overallConfidence,
    compConfidence: compConf,
    kmConfidence,           // null when no mileage match was done
    kmNote,
  };
}

// The ONLY consumer-side adjustment (widget): a customer-DECLARED accident.
//   amount < $3,000  → flat −$500
//   amount ≥ $3,000  → −⅓ of the claim/estimate amount
//   declared but no amount → −$500 floor
export function accidentDeduction(declared, amount) {
  if (!declared) return 0;
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) return 500;
  return amt < 3000 ? 500 : Math.round(amt / 3);
}
