import { NextResponse } from 'next/server';
import { iqGetReport } from '@/lib/funnel/iq-repository';
import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';

export const runtime = 'nodejs';
export const maxDuration = 60;

type FullShape = Record<string, unknown>;

function pickStr(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v : undefined;
}

function pickStrArr(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

function pdfDashboardTable(full: FullShape): string {
  const d = full.dashboard;
  if (!d || typeof d !== 'object') return '';
  const obj = d as Record<string, unknown>;
  const keys = ['overall_score', 'foot_traffic_index', 'competition_intensity', 'payback_months', 'recommendation'];
  const cells = keys
    .map((k) => {
      const val = obj[k];
      if (val === undefined || val === null || val === '') return '';
      return `<tr><td style="padding:8px;border:1px solid #e5e7eb;font-weight:600;">${escapeHtml(k)}</td><td style="padding:8px;border:1px solid #e5e7eb;">${escapeHtml(String(val))}</td></tr>`;
    })
    .join('');
  if (!cells) return '';
  return `<div class="section"><h2>Key metrics</h2><table style="width:100%;border-collapse:collapse;font-size:10pt;">${cells}</table></div>`;
}

function pdfCompetitorsTable(full: FullShape): string {
  const rows = Array.isArray(full.competitors) ? full.competitors : [];
  if (rows.length === 0) return '';
  const head = `<tr><th style="text-align:left;padding:6px;border:1px solid #e5e7eb;">#</th><th style="text-align:left;padding:6px;border:1px solid #e5e7eb;">Name</th><th style="padding:6px;border:1px solid #e5e7eb;">mi</th><th style="padding:6px;border:1px solid #e5e7eb;">Cat</th><th style="padding:6px;border:1px solid #e5e7eb;">★</th><th style="padding:6px;border:1px solid #e5e7eb;">Threat</th></tr>`;
  const body = rows
    .map((row, i) => {
      const r = row as Record<string, unknown>;
      return `<tr>
        <td style="padding:6px;border:1px solid #e5e7eb;">${i + 1}</td>
        <td style="padding:6px;border:1px solid #e5e7eb;">${escapeHtml(String(r.name ?? ''))}</td>
        <td style="padding:6px;border:1px solid #e5e7eb;">${escapeHtml(String(r.distance_mi ?? ''))}</td>
        <td style="padding:6px;border:1px solid #e5e7eb;">${escapeHtml(String(r.category ?? ''))}</td>
        <td style="padding:6px;border:1px solid #e5e7eb;">${escapeHtml(String(r.rating ?? ''))}</td>
        <td style="padding:6px;border:1px solid #e5e7eb;">${escapeHtml(String(r.threat_level ?? ''))}</td>
      </tr>`;
    })
    .join('');
  return `<div class="section"><h2>Competitor matrix</h2><table style="width:100%;border-collapse:collapse;font-size:9pt;">${head}${body}</table></div>`;
}

function pdfRiskMatrixTable(full: FullShape): string {
  const rows = Array.isArray(full.risk_matrix) ? full.risk_matrix : [];
  if (rows.length === 0) return '';
  const head = `<tr><th style="text-align:left;padding:6px;border:1px solid #e5e7eb;">Risk</th><th style="padding:6px;border:1px solid #e5e7eb;">P</th><th style="padding:6px;border:1px solid #e5e7eb;">Impact</th><th style="padding:6px;border:1px solid #e5e7eb;">Mitigation</th></tr>`;
  const body = rows
    .map((row) => {
      const r = row as Record<string, unknown>;
      return `<tr>
        <td style="padding:6px;border:1px solid #e5e7eb;">${escapeHtml(String(r.risk ?? ''))}</td>
        <td style="padding:6px;border:1px solid #e5e7eb;">${escapeHtml(String(r.probability ?? ''))}</td>
        <td style="padding:6px;border:1px solid #e5e7eb;">${escapeHtml(String(r.financial_impact ?? ''))}</td>
        <td style="padding:6px;border:1px solid #e5e7eb;">${escapeHtml(String(r.mitigation ?? ''))}</td>
      </tr>`;
    })
    .join('');
  return `<div class="section"><h2>Risk matrix</h2><table style="width:100%;border-collapse:collapse;font-size:9pt;">${head}${body}</table></div>`;
}

function generatePdfHtml(report: {
  id: string;
  location: string;
  business_type: string | null;
  headline: string;
  full: FullShape;
}): string {
  const { location, business_type, headline, full } = report;
  const date = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
    
    * { margin: 0; padding: 0; box-sizing: border-box; }
    
    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
      font-size: 11pt;
      line-height: 1.6;
      color: #1a1a1a;
      padding: 60px;
      max-width: 800px;
      margin: 0 auto;
    }
    
    .header {
      text-align: center;
      border-bottom: 3px solid #059669;
      padding-bottom: 30px;
      margin-bottom: 40px;
    }
    
    .logo {
      font-size: 24pt;
      font-weight: 700;
      color: #059669;
      letter-spacing: -0.5px;
    }
    
    .subtitle {
      font-size: 10pt;
      color: #666;
      text-transform: uppercase;
      letter-spacing: 2px;
      margin-top: 5px;
    }
    
    .report-title {
      font-size: 20pt;
      font-weight: 700;
      margin: 30px 0 15px;
      color: #111;
    }
    
    .meta {
      font-size: 10pt;
      color: #666;
    }
    
    .meta span { margin: 0 15px; }
    
    .executive-box {
      background: linear-gradient(135deg, #ecfdf5 0%, #d1fae5 100%);
      border-left: 4px solid #059669;
      padding: 25px;
      margin: 30px 0;
      border-radius: 0 8px 8px 0;
    }
    
    .executive-box h2 {
      font-size: 12pt;
      font-weight: 600;
      color: #047857;
      margin-bottom: 10px;
      text-transform: uppercase;
      letter-spacing: 1px;
    }
    
    .verdict-box {
      background: #f0fdf4;
      border: 2px solid #059669;
      padding: 20px;
      margin: 25px 0;
      border-radius: 8px;
      text-align: center;
    }
    
    .verdict-box h3 {
      font-size: 14pt;
      font-weight: 700;
      color: #047857;
    }
    
    .section {
      margin: 30px 0;
      page-break-inside: avoid;
    }
    
    .section h2 {
      font-size: 13pt;
      font-weight: 600;
      color: #111;
      border-bottom: 2px solid #e5e7eb;
      padding-bottom: 8px;
      margin-bottom: 15px;
    }
    
    .section p {
      color: #374151;
      margin-bottom: 12px;
    }
    
    .list {
      margin: 15px 0;
    }
    
    .list-item {
      display: flex;
      align-items: flex-start;
      margin-bottom: 12px;
    }
    
    .list-number {
      width: 24px;
      height: 24px;
      background: #059669;
      color: white;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 10pt;
      font-weight: 600;
      flex-shrink: 0;
      margin-right: 12px;
    }
    
    .list-number.risk { background: #dc2626; }
    .list-number.warning { background: #d97706; }
    .list-number.action { background: #2563eb; }
    
    .list-content {
      flex: 1;
      color: #374151;
    }
    
    .two-column {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 25px;
    }
    
    .column-box {
      background: #f9fafb;
      border: 1px solid #e5e7eb;
      padding: 20px;
      border-radius: 8px;
    }
    
    .column-box h3 {
      font-size: 11pt;
      font-weight: 600;
      color: #374151;
      margin-bottom: 12px;
    }
    
    .revenue-box {
      background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%);
      border: 2px solid #d97706;
      padding: 20px;
      margin: 25px 0;
      border-radius: 8px;
      text-align: center;
    }
    
    .revenue-box h3 {
      font-size: 11pt;
      color: #92400e;
      margin-bottom: 8px;
    }
    
    .revenue-box p {
      font-size: 14pt;
      font-weight: 700;
      color: #78350f;
    }
    
    .footer {
      margin-top: 50px;
      padding-top: 20px;
      border-top: 1px solid #e5e7eb;
      text-align: center;
      font-size: 9pt;
      color: #9ca3af;
    }
    
    .confidential {
      background: #fef2f2;
      border: 1px solid #fecaca;
      padding: 10px 15px;
      border-radius: 4px;
      font-size: 9pt;
      color: #991b1b;
      text-align: center;
      margin-top: 20px;
    }
    
    @page {
      margin: 0;
      size: A4;
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="logo">RestaurantIQ</div>
    <div class="subtitle">Location Intelligence Report</div>
    <h1 class="report-title">${escapeHtml(headline)}</h1>
    <div class="meta">
      <span>📍 ${escapeHtml(location)}</span>
      ${business_type ? `<span>🍽️ ${escapeHtml(business_type)}</span>` : ''}
      <span>📅 ${date}</span>
    </div>
  </div>

  ${pdfDashboardTable(full)}
  ${pdfCompetitorsTable(full)}

  ${pickStr(full.executive_summary) ? `
  <div class="executive-box">
    <h2>Executive Summary</h2>
    <p>${escapeHtml(pickStr(full.executive_summary)!)}</p>
  </div>
  ` : ''}

  ${pickStr(full.final_verdict) ? `
  <div class="verdict-box">
    <h3>✅ Final Verdict</h3>
    <p style="margin-top: 10px; font-size: 12pt;">${escapeHtml(pickStr(full.final_verdict)!)}</p>
  </div>
  ` : ''}

  <div class="two-column">
    ${pickStr(full.trade_area_analysis) ? `
    <div class="column-box">
      <h3>📍 Trade Area Analysis</h3>
      <p>${escapeHtml(pickStr(full.trade_area_analysis)!)}</p>
    </div>
    ` : ''}
    ${pickStr(full.demographic_profile) ? `
    <div class="column-box">
      <h3>👥 Demographic Profile</h3>
      <p>${escapeHtml(pickStr(full.demographic_profile)!)}</p>
    </div>
    ` : ''}
  </div>

  ${pickStr(full.competition_landscape) ? `
  <div class="section">
    <h2>🏪 Competition Landscape</h2>
    <p>${escapeHtml(pickStr(full.competition_landscape)!)}</p>
  </div>
  ` : ''}

  ${pickStr(full.revenue_estimate) ? `
  <div class="revenue-box">
    <h3>💰 Revenue Estimate</h3>
    <p>${escapeHtml(pickStr(full.revenue_estimate)!)}</p>
  </div>
  ` : ''}

  ${pdfRiskMatrixTable(full)}

  ${pickStrArr(full.risks).length > 0 ? `
  <div class="section">
    <h2>⚠️ Top Risks</h2>
    <div class="list">
      ${pickStrArr(full.risks).map((r, i) => `
      <div class="list-item">
        <div class="list-number risk">${i + 1}</div>
        <div class="list-content">${escapeHtml(r)}</div>
      </div>
      `).join('')}
    </div>
  </div>
  ` : ''}

  ${pickStrArr(full.opportunities).length > 0 ? `
  <div class="section">
    <h2>💡 Opportunities</h2>
    <div class="list">
      ${pickStrArr(full.opportunities).map((o, i) => `
      <div class="list-item">
        <div class="list-number">${i + 1}</div>
        <div class="list-content">${escapeHtml(o)}</div>
      </div>
      `).join('')}
    </div>
  </div>
  ` : ''}

  ${pickStrArr(full.failure_scenarios).length > 0 ? `
  <div class="section">
    <h2>🚨 Failure Scenarios</h2>
    <div class="list">
      ${pickStrArr(full.failure_scenarios).map((f, i) => `
      <div class="list-item">
        <div class="list-number warning">${i + 1}</div>
        <div class="list-content">${escapeHtml(f)}</div>
      </div>
      `).join('')}
    </div>
  </div>
  ` : ''}

  ${pickStr(full.differentiation_strategy) ? `
  <div class="section">
    <h2>🎯 Differentiation Strategy</h2>
    <p>${escapeHtml(pickStr(full.differentiation_strategy)!)}</p>
  </div>
  ` : ''}

  ${pickStrArr(full.action_plan).length > 0 ? `
  <div class="section">
    <h2>📝 90-Day Action Plan</h2>
    <div class="list">
      ${pickStrArr(full.action_plan).map((a, i) => `
      <div class="list-item">
        <div class="list-number action">${i + 1}</div>
        <div class="list-content">${escapeHtml(a)}</div>
      </div>
      `).join('')}
    </div>
  </div>
  ` : ''}

  <div class="footer">
    <p>Generated by RestaurantIQ.ai • ${date}</p>
    <p>Confidence Level: ${escapeHtml(pickStr(full.confidence) || 'N/A')}</p>
  </div>
  
  <div class="confidential">
    CONFIDENTIAL - This report is prepared exclusively for the purchaser and should not be distributed without permission.
  </div>
</body>
</html>`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const report = await iqGetReport(id);
    if (!report) {
      return NextResponse.json({ error: 'Report not found' }, { status: 404 });
    }

    if (!report.paid) {
      return NextResponse.json({ error: 'Report not paid' }, { status: 403 });
    }

    const full = (report.full_report_json || {}) as FullShape;
    const html = generatePdfHtml({
      id: report.id,
      location: report.location,
      business_type: report.business_type,
      headline: report.headline,
      full,
    });

    let browser;
    try {
      browser = await puppeteer.launch({
        args: chromium.args,
        defaultViewport: { width: 1200, height: 1600 },
        executablePath: await chromium.executablePath(),
        headless: true,
      });
    } catch {
      browser = await puppeteer.launch({
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
        defaultViewport: { width: 1200, height: 1600 },
        headless: true,
      });
    }

    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    
    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '0', right: '0', bottom: '0', left: '0' },
    });

    await browser.close();

    const filename = `RestaurantIQ-Report-${id.slice(0, 8)}.pdf`;

    return new NextResponse(Buffer.from(pdfBuffer), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    console.error('[api/iq/report/pdf]', error);
    return NextResponse.json(
      { error: 'Failed to generate PDF' },
      { status: 500 }
    );
  }
}
