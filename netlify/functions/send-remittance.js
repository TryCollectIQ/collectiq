// CollectIQ — Remittance Package Delivery
// Debtor requests W-9 & remittance details from the payment portal;
// this function looks up the tenant's stored remittance profile (service key)
// and emails the package to the debtor, CCs the owner, and logs to audit.

const https = require('https');

function sbGet(path) {
  return new Promise((resolve) => {
    const req = https.request({
      hostname: new URL(process.env.SUPABASE_URL).hostname,
      path: '/rest/v1/' + path,
      method: 'GET',
      headers: {
        'apikey': process.env.SUPABASE_SERVICE_KEY,
        'Authorization': 'Bearer ' + process.env.SUPABASE_SERVICE_KEY,
        'Content-Type': 'application/json'
      }
    }, (res) => { let b=''; res.on('data',c=>b+=c); res.on('end',()=>{ try{resolve(JSON.parse(b));}catch{resolve(null);} }); });
    req.on('error', ()=>resolve(null));
    req.end();
  });
}

function sbPost(path, bodyObj) {
  return new Promise((resolve) => {
    const data = JSON.stringify(bodyObj);
    const req = https.request({
      hostname: new URL(process.env.SUPABASE_URL).hostname,
      path: '/rest/v1/' + path,
      method: 'POST',
      headers: {
        'apikey': process.env.SUPABASE_SERVICE_KEY,
        'Authorization': 'Bearer ' + process.env.SUPABASE_SERVICE_KEY,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      }
    }, (res) => { let b=''; res.on('data',c=>b+=c); res.on('end',()=>resolve(res.statusCode)); });
    req.on('error', ()=>resolve(0));
    req.write(data); req.end();
  });
}

function sendMail(payload) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload);
    const req = https.request({
      hostname: 'api.sendgrid.com',
      path: '/v3/mail/send',
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + process.env.SENDGRID_API_KEY,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    }, (res) => { let b=''; res.on('data',c=>b+=c); res.on('end',()=>resolve({status:res.statusCode, body:b})); });
    req.on('error', reject);
    req.write(data); req.end();
  });
}

exports.handler = async function(event) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: 'Method Not Allowed' };

  try {
    const { tenantId, debtorEmail, debtorName, invoiceId } = JSON.parse(event.body);
    if (!tenantId || !debtorEmail) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing tenantId or debtorEmail' }) };
    }
    // Basic email shape check
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(debtorEmail)) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid email' }) };
    }

    const rows = await sbGet(`tenants?id=eq.${encodeURIComponent(tenantId)}&select=name,remit_profile`);
    const tenant = rows && rows[0];
    if (!tenant) return { statusCode: 404, headers, body: JSON.stringify({ error: 'Unknown tenant' }) };
    if (!tenant.remit_profile) {
      return { statusCode: 409, headers, body: JSON.stringify({ error: 'not_configured' }) };
    }

    let rp = {};
    try { rp = JSON.parse(tenant.remit_profile); } catch { rp = {}; }
    const company = tenant.name || 'the creditor';

    const row = (k, v) => v ? `<tr><td style="padding:7px 10px;background:#f5f3f0;font-weight:bold;font-size:12px;white-space:nowrap;">${k}</td><td style="padding:7px 10px;font-size:12px;">${v}</td></tr>` : '';
    const html = `
<div style="font-family:Arial,sans-serif;max-width:620px;margin:0 auto;padding:24px;">
  <div style="margin-bottom:18px;"><strong style="font-size:18px;">${company}</strong><div style="font-size:12px;color:#78716c;">Remittance Information${invoiceId ? ' — ' + invoiceId : ''}</div></div>
  <table style="border-collapse:collapse;width:100%;border:1px solid #e0dcd5;">
    ${row('Beneficiary / Payee', company)}
    ${row('Bank Name', rp.bank)}
    ${row('Bank Address', rp.bank_addr)}
    ${row('Routing (ACH)', rp.ach)}
    ${row('Routing (Wire)', rp.wire)}
    ${row('Account Number', rp.account)}
    ${row('Account Type', rp.acct_type || 'Business Checking')}
    ${row('Payment Reference', 'Please include invoice number' + (invoiceId ? ' ' + invoiceId : '') + ' on all payments')}
  </table>
  ${rp.w9_url ? `<p style="font-size:13px;"><strong>W-9:</strong> <a href="${rp.w9_url}">Download our completed IRS Form W-9</a></p>` : '<p style="font-size:13px;"><strong>W-9:</strong> Reply to this email and we will send our completed IRS Form W-9 promptly.</p>'}
  <p style="font-size:12px;color:#57534e;"><strong>Payment note:</strong> Bank payments initiated within an active early-resolution offer window qualify for the same discount shown on your payment page.</p>
  <p style="font-size:11px;color:#78716c;border-top:1px solid #e8e4dd;padding-top:10px;"><strong>Security notice:</strong> These banking details will never be changed by email alone. If you receive any notice of changed payment instructions, verify by phone with ${company} before sending funds.</p>
  <div style="font-size:10px;color:#a8a29e;margin-top:14px;">Delivered via CollectIQ on behalf of ${company}</div>
</div>`;

    const payload = {
      personalizations: [{
        to: [{ email: debtorEmail, name: debtorName || debtorEmail }],
        ...(rp.owner_email ? { cc: [{ email: rp.owner_email }] } : {}),
        subject: `Remittance details${invoiceId ? ' — ' + invoiceId : ''} — ${company}`
      }],
      from: { email: 'hello@trycollectiq.com', name: company + ' (via CollectIQ)' },
      ...(rp.owner_email ? { reply_to: { email: rp.owner_email, name: company } } : {}),
      content: [{ type: 'text/html', value: html }]
    };

    const result = await sendMail(payload);
    if (result.status !== 202) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'send_failed', details: result.body }) };
    }

    await sbPost('audit_log', {
      tenant_id: tenantId,
      actor: 'Debtor Portal',
      action_type: 'email',
      description: `Remittance package emailed to ${debtorEmail}${invoiceId ? ' — ' + invoiceId : ''}`
    });

    return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
