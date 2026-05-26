import { computeFinanceModel } from '../lib/funnel/iq-finance-model.ts';
import { applyFinanceModelOverride } from '../lib/funnel/iq-full-report-schema.ts';

const finance = computeFinanceModel({
  marketData: {
    geocode: { state: 'CA' },
    acs_context: {
      county: { name: 'Sacramento County, California', median_household_income_usd: 72000 },
      tract_data_available: false,
    },
  },
  businessType: 'Bubble Tea',
  location: 'Sacramento, CA',
});

// Pretend the LLM emitted hallucinated numbers and a thin cost_breakdown.
const llmReport = {
  one_line_conclusion: 'Promising mid-tier boba opportunity.',
  competitors: [{ name: 'Boba Guys', similarity: 'direct' }],
  risk_audit: {
    decision_tier: 'caution',
    overall_score: 62,
    break_even_revenue_monthly_usd: 12345, // LLM hallucination
    safe_revenue_monthly_usd: 23456, // LLM hallucination
    cost_breakdown: [
      { item: 'Rent', amount_usd: 1, note: 'guess' },
      { item: 'Labor', amount_usd: 2, note: 'guess' },
    ],
  },
};

const out = applyFinanceModelOverride(llmReport, finance);

console.assert(
  out.risk_audit.break_even_revenue_monthly_usd === finance.break_even_revenue_monthly_usd,
  'break_even should be overridden to deterministic value, got ' +
    out.risk_audit.break_even_revenue_monthly_usd,
);
console.assert(
  out.risk_audit.safe_revenue_monthly_usd === finance.safe_revenue_monthly_usd,
  'safe_revenue should be overridden',
);
console.assert(
  Array.isArray(out.risk_audit.cost_breakdown) && out.risk_audit.cost_breakdown.length >= 8,
  'cost_breakdown should be replaced with the 8-row deterministic table, got ' +
    out.risk_audit.cost_breakdown.length,
);
console.assert(out._finance_model_applied === true, 'flag should be set');
console.assert(
  out._finance_model_snapshot.cuisine_archetype === finance.cuisine_archetype,
  'snapshot stored',
);
console.assert(
  Array.isArray(out._warnings) && out._warnings.some((w) => w.includes('deterministic D-4')),
  'warning appended',
);
// Preserved fields
console.assert(out.risk_audit.decision_tier === 'caution', 'decision_tier preserved');
console.assert(out.risk_audit.overall_score === 62, 'overall_score preserved');
console.assert(out.one_line_conclusion === 'Promising mid-tier boba opportunity.', 'top-level preserved');
console.assert(Array.isArray(out.competitors) && out.competitors[0].name === 'Boba Guys', 'competitors preserved');

console.log('✓ override smoke passed');
console.log('  hallucinated $12,345 → forced $' + out.risk_audit.break_even_revenue_monthly_usd.toLocaleString('en-US'));
console.log('  hallucinated $23,456 → forced $' + out.risk_audit.safe_revenue_monthly_usd.toLocaleString('en-US'));
console.log('  cost_breakdown rows: ' + out.risk_audit.cost_breakdown.length);
console.log('  warning: ' + out._warnings[out._warnings.length - 1]);

// Null-finance-model passthrough
const passthrough = applyFinanceModelOverride(llmReport, null);
console.assert(
  passthrough.risk_audit.break_even_revenue_monthly_usd === 12345,
  'null finance model must not touch LLM numbers',
);
console.assert(passthrough._finance_model_applied !== true, 'flag must NOT be set when no model');
console.log('✓ null-passthrough OK (LLM numbers preserved when finance_model missing)');
