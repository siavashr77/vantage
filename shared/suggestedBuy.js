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

  // 1) Target retail = market mid × dealer's position.
  const targetRetail = Math.round(mid * (positionPct / 100));
  reasons.push(`Retail target ${fmt(targetRetail)} (${positionPct}% of market mid ${fmt(mid)})`);

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

  return {
    suggested,
    targetRetail,
    gross,
    recon,
    reasons,
    confidence: confidenceFrom(a),
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
