// ============================================================
// CollectIQ — LitReady™ Automated Package Generator
// netlify/functions/litready-generate.js
//
// Generates a complete court-ready documentation package
// directly from live Supabase data (accounts, outreach_log,
// audit_log). Returns print-optimized HTML — open in browser,
// Ctrl+P → Save as PDF for the final court-ready document.
//
// USAGE (GET):
//   /.netlify/functions/litready-generate?tenant=TENANT_ID&account=ACCOUNT_ID&key=YOUR_KEY
//
// SETUP: add LITREADY_KEY to Netlify environment variables
// (Site settings → Environment variables). Any secret string.
// SUPABASE_URL and SUPABASE_SERVICE_KEY already exist (qbo-sync).
// ============================================================

const https = require('https');

function sbGet(path) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: new URL(supabaseUrl).hostname,
      path: `/rest/v1/${path}`,
      method: 'GET',
      headers: {
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json'
      }
    }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { resolve([]); } });
    });
    req.on('error', reject);
    req.end();
  });
}

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const fmtMoney = (n) => '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtDate = (iso) => {
  if (!iso) return '(date not recorded)';
  const d = new Date(iso);
  return isNaN(d) ? esc(iso) : d.toLocaleString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
    hour: 'numeric', minute: '2-digit', timeZoneName: 'short'
  });
};

exports.handler = async function (event) {
  const headers = { 'Content-Type': 'text/html; charset=utf-8' };
  try {
    const q = event.queryStringParameters || {};
    const { tenant, account, key } = q;

    // Simple access control
    if (!process.env.LITREADY_KEY || key !== process.env.LITREADY_KEY) {
      return { statusCode: 401, headers, body: '<h3>Unauthorized — missing or invalid key.</h3>' };
    }
    if (!tenant || !account) {
      return { statusCode: 400, headers, body: '<h3>Missing required parameters: tenant, account.</h3>' };
    }

    // ---- Pull live data ----
    const raw = await Promise.all([
      sbGet(`accounts?id=eq.${encodeURIComponent(account)}&tenant_id=eq.${encodeURIComponent(tenant)}&limit=1`),
      sbGet(`outreach_log?account_id=eq.${encodeURIComponent(account)}&tenant_id=eq.${encodeURIComponent(tenant)}`),
      sbGet(`audit_log?tenant_id=eq.${encodeURIComponent(tenant)}&limit=500`),
      sbGet(`tenants?id=eq.${encodeURIComponent(tenant)}&limit=1`)
    ]);
    // Coerce everything to arrays — PostgREST returns error OBJECTS on bad queries
    const asArr = (x) => Array.isArray(x) ? x : [];
    const acctRows = asArr(raw[0]);
    const byDate = (a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0);
    const outreach = asArr(raw[1]).sort(byDate);
    const audit = asArr(raw[2]).sort(byDate);
    const tenantRows = asArr(raw[3]);

    const acct = acctRows && acctRows[0];
    if (!acct) {
      return { statusCode: 404, headers, body: '<h3>Account not found for this tenant.</h3>' };
    }

    const creditor = (tenantRows && tenantRows[0] && (tenantRows[0].company_name || tenantRows[0].name)) || 'Creditor (CollectIQ Customer)';

    // Audit entries that mention this account by name
    const acctAudit = (audit || []).filter(a =>
      a.description && acct.name && a.description.toLowerCase().includes(String(acct.name).toLowerCase())
    );

    const genDate = new Date().toLocaleString('en-US', { year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
    const pkgId = 'LR-' + Date.now().toString(36).toUpperCase();

    // ---- Build exhibits ----
    let exhibitNum = 0;
    const exhibitRows = (outreach || []).map(o => {
      exhibitNum++;
      return `
      <div class="exhibit">
        <div class="ex-head">
          <span class="ex-num">EXHIBIT ${exhibitNum}</span>
          <span class="ex-meta">${esc((o.channel || 'COMMUNICATION').toUpperCase())} · ${fmtDate(o.created_at)} · Status: ${esc(o.status || 'sent')}</span>
        </div>
        ${o.subject ? `<div class="ex-subj">Subject: ${esc(o.subject)}</div>` : ''}
        <div class="ex-body">${esc(o.body || '(content not recorded)')}</div>
      </div>`;
    }).join('');

    const auditRows = acctAudit.map(a => `
      <tr><td>${fmtDate(a.created_at)}</td><td>${esc(a.action_type || '')}</td><td>${esc(a.actor || 'System')}</td><td>${esc(a.description || '')}</td></tr>
    `).join('');

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<title>LitReady Package ${pkgId} — ${esc(acct.name)}</title>
<style>
  @media print { .no-print { display: none !important; } body { margin: 0; } .page { page-break-after: always; } }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Georgia, 'Times New Roman', serif; color: #1a1a1a; line-height: 1.6; background: #fff; padding: 40px 50px; max-width: 850px; margin: 0 auto; }
  .print-bar { background: #0F1923; color: #fff; padding: 14px 20px; border-radius: 8px; margin-bottom: 30px; font-family: Arial, sans-serif; font-size: 14px; display: flex; justify-content: space-between; align-items: center; }
  .print-bar button { background: #C8490A; color: #fff; border: none; padding: 10px 22px; border-radius: 6px; font-weight: bold; cursor: pointer; font-size: 14px; }
  h1 { font-size: 26px; text-align: center; letter-spacing: 0.02em; margin-bottom: 4px; }
  .doc-sub { text-align: center; font-size: 13px; color: #555; margin-bottom: 6px; }
  .doc-id { text-align: center; font-family: monospace; font-size: 12px; color: #777; margin-bottom: 30px; }
  hr.rule { border: none; border-top: 2px solid #1a1a1a; margin: 20px 0; }
  h2 { font-size: 16px; text-transform: uppercase; letter-spacing: 0.08em; border-bottom: 1px solid #999; padding-bottom: 6px; margin: 34px 0 14px; }
  table.summary { width: 100%; border-collapse: collapse; font-size: 14px; }
  table.summary td { padding: 8px 10px; border: 1px solid #ccc; vertical-align: top; }
  table.summary td:first-child { width: 240px; font-weight: bold; background: #f4f4f2; }
  .exhibit { border: 1px solid #bbb; border-radius: 4px; margin-bottom: 18px; page-break-inside: avoid; }
  .ex-head { background: #f0f0ee; padding: 8px 14px; display: flex; justify-content: space-between; font-family: Arial, sans-serif; font-size: 11.5px; }
  .ex-num { font-weight: bold; letter-spacing: 0.06em; }
  .ex-meta { color: #555; }
  .ex-subj { padding: 10px 14px 0; font-weight: bold; font-size: 13.5px; }
  .ex-body { padding: 10px 14px 14px; font-size: 13.5px; white-space: pre-wrap; }
  table.audit { width: 100%; border-collapse: collapse; font-size: 12.5px; }
  table.audit th, table.audit td { border: 1px solid #ccc; padding: 6px 9px; text-align: left; }
  table.audit th { background: #f4f4f2; font-family: Arial, sans-serif; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; }
  .cert { border: 2px solid #1a1a1a; padding: 18px 22px; margin-top: 36px; font-size: 13px; }
  .cert-title { font-weight: bold; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 8px; font-size: 13px; }
  .guide { background: #f8f8f6; border: 1px solid #ddd; border-radius: 6px; padding: 18px 22px; font-size: 13.5px; }
  .guide li { margin: 6px 0 6px 18px; }
  .disclaimer { margin-top: 30px; font-size: 10.5px; color: #666; border-top: 1px solid #ccc; padding-top: 14px; font-family: Arial, sans-serif; line-height: 1.5; }
</style>
</head>
<body>

<div class="print-bar no-print">
  <span>LitReady™ Package generated — review below, then save as PDF.</span>
  <button onclick="window.print()">Print / Save as PDF</button>
</div>

<h1>ACCOUNT DOCUMENTATION PACKAGE</h1>
<div class="doc-sub">Prepared for potential demand, small-claims, or attorney review purposes</div>
<div class="doc-id">Package ${pkgId} · Generated ${genDate} · LitReady™ by CollectIQ</div>
<hr class="rule"/>

<h2>Section A — Case Summary</h2>
<table class="summary">
  <tr><td>Creditor</td><td>${esc(creditor)}</td></tr>
  <tr><td>Debtor / Account Name</td><td>${esc(acct.name)}</td></tr>
  <tr><td>Debtor Contact on File</td><td>${esc(acct.email || '(none recorded)')}</td></tr>
  <tr><td>Outstanding Balance</td><td><strong>${fmtMoney(acct.balance)}</strong></td></tr>
  <tr><td>Days Overdue (at generation)</td><td>${esc(acct.days_overdue != null ? acct.days_overdue + ' days' : '(not recorded)')}</td></tr>
  <tr><td>Account Status</td><td>${esc(acct.status || '(not recorded)')}</td></tr>
  <tr><td>Total Documented Outreach Attempts</td><td>${(outreach || []).length}</td></tr>
  <tr><td>First Documented Contact</td><td>${(outreach && outreach[0]) ? fmtDate(outreach[0].created_at) : '(none recorded)'}</td></tr>
  <tr><td>Most Recent Documented Contact</td><td>${(outreach && outreach.length) ? fmtDate(outreach[outreach.length - 1].created_at) : '(none recorded)'}</td></tr>
</table>

<h2>Section B — Communication Chronology (Numbered Exhibits)</h2>
${exhibitRows || '<p><em>No outreach records found for this account.</em></p>'}

<h2>Section C — System Activity Record</h2>
${auditRows ? `<table class="audit"><tr><th>Timestamp</th><th>Type</th><th>Actor</th><th>Description</th></tr>${auditRows}</table>` : '<p><em>No additional audit entries reference this account.</em></p>'}

<h2>Section D — Next-Step Reference (Informational Only)</h2>
<div class="guide">
  <strong>For the creditor and/or their licensed attorney:</strong>
  <ul>
    <li>This package may accompany a demand letter drafted by the creditor or their attorney.</li>
    <li>Small-claims monetary limits vary by state (e.g., Florida: $8,000). Verify the current threshold and filing procedure with the court in the debtor's jurisdiction.</li>
    <li>An attorney will typically also request: the original invoice(s), any signed contract or rate confirmation, and proof of delivery/performance. Attach those documents to this package.</li>
    <li>All decisions regarding demand letters, filings, or litigation rest solely with the creditor and their counsel.</li>
  </ul>
</div>

<div class="cert">
  <div class="cert-title">Record Generation Certificate</div>
  This documentation package was generated automatically from CollectIQ platform records on ${genDate} (Package ID ${pkgId}). The communication and activity entries above were recorded contemporaneously in the ordinary course of business at the date and time each event occurred, and are reproduced here without alteration.
</div>

<div class="disclaimer">
  LitReady™ is a documentation service of CollectIQ Technologies LLC. CollectIQ is not a law firm and does not provide legal advice. This package organizes existing account records for the creditor's use; it does not constitute a legal filing, demand, or threat. Small-claims information is provided for general reference only. © ${new Date().getFullYear()} CollectIQ Technologies LLC · trycollectiq.com
</div>

</body>
</html>`;

    return { statusCode: 200, headers, body: html };

  } catch (err) {
    return { statusCode: 500, headers, body: `<h3>LitReady generation error: ${esc(err.message)}</h3>` };
  }
};
