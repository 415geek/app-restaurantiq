// D-4 finance-model smoke test
import { computeFinanceModel, formatFinanceModelForAnchors } from '../lib/funnel/iq-finance-model.ts';

const cases = [
  {
    name: 'Bubble tea · no user rent · MCOL county (ACS county MHI=$72k, CA)',
    input: {
      marketData: {
        geocode: { state: 'CA' },
        acs_context: {
          county: { name: 'Sacramento County, California', median_household_income_usd: 72000 },
          tract_data_available: false,
        },
        commercial_listings: { count: 0, listings: [] },
      },
      businessType: 'Bubble Tea',
      location: '123 Elm St, Sacramento, CA',
    },
  },
  {
    name: 'Bubble tea · user rent + sqft · HCOL Metro (SF tract MHI=$140k)',
    input: {
      marketData: {
        geocode: { state: 'CA' },
        acs_context: {
          county: { name: 'San Francisco County, California', median_household_income_usd: 145000 },
          tract_data_available: true,
          tract: { median_household_income_usd: 140000 },
        },
        user_inputs: { monthly_rent_usd: 9000, sqft: 800 },
      },
      businessType: 'Bubble Tea Shop',
      location: '500 Market St, San Francisco, CA',
    },
  },
  {
    name: 'Fast casual · listings median rent fallback · MCOL (TX county MHI=$70k)',
    input: {
      marketData: {
        geocode: { state: 'TX' },
        acs_context: {
          county: { name: 'Travis County, Texas', median_household_income_usd: 70000 },
          tract_data_available: false,
        },
        commercial_listings: {
          count: 3,
          listings: [
            { monthlyRent: 5500 },
            { monthlyRent: 6000 },
            { monthlyRent: 6500 },
          ],
        },
      },
      businessType: 'Chipotle-style bowl shop',
      location: '789 Main, Austin, TX',
    },
  },
  {
    name: 'No business type · no ACS · no listings (worst-case fallback)',
    input: {
      marketData: null,
      businessType: '',
      location: 'unknown',
    },
  },
];

for (const c of cases) {
  console.log('\n=== ' + c.name + ' ===');
  const m = computeFinanceModel(c.input);
  console.log('archetype     :', m.cuisine_archetype_label_en);
  console.log('rent/mo       : $' + m.monthly_rent_usd.toLocaleString('en-US'), '(' + m.rent_source + ')');
  console.log('  evidence    :', m.rent_evidence);
  console.log('labor/mo      : $' + m.monthly_labor_usd.toLocaleString('en-US'));
  console.log('  evidence    :', m.labor_evidence);
  console.log('other fixed   : $' + m.monthly_other_fixed_usd.toLocaleString('en-US'));
  console.log('fixed total   : $' + m.fixed_total_monthly_usd.toLocaleString('en-US'));
  console.log('variable rate :', (m.total_variable_rate * 100).toFixed(1) + '%',
    '(food', (m.food_cost_pct * 100).toFixed(0) + '%, paper', (m.paper_pct * 100).toFixed(1) + '%, cc', (m.cc_fees_pct * 100).toFixed(1) + '%, delivery', (m.delivery_blended_pct * 100).toFixed(1) + '%)');
  console.log('contribution  :', (m.contribution_margin_rate * 100).toFixed(1) + '%');
  console.log('break-even/mo : $' + m.break_even_revenue_monthly_usd.toLocaleString('en-US'),
    ' daily=$' + m.break_even_daily_revenue_usd, ' covers=' + m.daily_covers_needed_breakeven);
  console.log('safe rev/mo   : $' + m.safe_revenue_monthly_usd.toLocaleString('en-US'),
    ' daily=$' + m.safe_daily_revenue_usd, ' covers=' + m.daily_covers_needed_safe);
  console.log('avg ticket    : $' + m.avg_ticket_usd);
  console.log('confidence    :', m.confidence, '-', m.confidence_reasons.join(', '));
  console.log('citations     :', m.citations.join(' '));
  console.log('cost_breakdown:');
  for (const row of m.cost_breakdown) {
    console.log('  -', row.item.padEnd(22), '$' + row.amount_usd.toLocaleString('en-US'));
  }
}

// Sanity asserts on the deterministic outputs (cases[0])
const m0 = computeFinanceModel(cases[0].input);
console.assert(m0.cuisine_archetype === 'bubble_tea', 'expected bubble_tea archetype');
console.assert(m0.break_even_revenue_monthly_usd > 20_000 && m0.break_even_revenue_monthly_usd < 80_000,
  'case0 break-even should be in $20k–$80k band, got ' + m0.break_even_revenue_monthly_usd);
console.assert(m0.safe_revenue_monthly_usd > m0.break_even_revenue_monthly_usd, 'safe must exceed break-even');
const m1 = computeFinanceModel(cases[1].input);
console.assert(m1.rent_source === 'user_input', 'case1 must use user_input rent');
console.assert(m1.monthly_rent_usd === 9000, 'case1 rent must equal user input');
const m2 = computeFinanceModel(cases[2].input);
console.assert(m2.rent_source === 'commercial_listings_median', 'case2 must use listings median');
console.assert(m2.monthly_rent_usd === 6000, 'case2 rent must equal median = $6000 (3 listings 5500/6000/6500)');

const sample = computeFinanceModel(cases[0].input);
console.log('\n=== ANCHOR BLOCK (zh) ===');
console.log(formatFinanceModelForAnchors(sample, 'zh'));

console.log('\n✓ smoke asserts passed');
