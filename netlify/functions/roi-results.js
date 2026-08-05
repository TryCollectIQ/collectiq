// ROI Results Email — sends prospect their calculation + notifies founder (lead capture)
const https = require('https');

function sgSend(payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const req = https.request({
      hostname: 'api.sendgrid.com',
      path: '/v3/mail/send',
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + process.env.SENDGRID_API_KEY,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => (res.statusCode < 300 ? resolve(d) : reject(new Error('SendGrid ' + res.statusCode + ': ' + d))));
    });
    req.on('error', reject);
    req.write(body); req.end();
  });
}

exports.handler = async (event) => {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: cors, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: cors, body: 'Method not allowed' };

  try {
    const { email, inputs, results } = JSON.parse(event.body || '{}');
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'Valid email required' }) };
    }
    const esc = s => String(s || '').replace(/[<>&"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]));
    const row = (k, v, hi) => `<tr><td style="padding:9px 14px;border-bottom:1px solid #eee;color:#6b6b67;font-size:13px;">${k}</td><td style="padding:9px 14px;border-bottom:1px solid #eee;text-align:right;font-weight:${hi?'700':'500'};font-size:${hi?'16px':'13px'};color:${hi?'#c84b1f':'#1a1a18'};">${esc(v)}</td></tr>`;

    const resultsHtml = `
<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;">
  <div style="background:#0c0c0b;border-radius:14px 14px 0 0;padding:28px 30px;text-align:center;">
    <div style="color:#f4f0e8;font-size:22px;font-weight:700;">Collect<span style="color:#c84b1f;">IQ</span></div>
    <div style="color:#b9b4a8;font-size:12px;margin-top:4px;letter-spacing:.05em;">YOUR RECOVERY POTENTIAL — CALCULATED</div>
  </div>
  <div style="border:1px solid #e8e4dc;border-top:none;border-radius:0 0 14px 14px;padding:26px 30px;background:#fff;">
    <div style="text-align:center;margin-bottom:20px;">
      <div style="font-size:13px;color:#6b6b67;">Estimated additional revenue recovered per year</div>
      <div style="font-size:38px;font-weight:800;color:#1a6644;">${esc(results.bigNum || '—')}</div>
    </div>
    <table style="width:100%;border-collapse:collapse;margin-bottom:18px;">
      ${row('Annual AR outstanding', inputs.ar)}
      ${row('Average days overdue', inputs.days)}
      ${row('Current collection rate', inputs.rate)}
      ${row('Industry', inputs.industry)}
      ${row('Without CollectIQ', results.without)}
      ${row('With CollectIQ AI (modeled)', results.withAI)}
      ${row('Net ROI', results.roi, true)}
      ${row('Payback period', results.payback)}
      ${row('Hours saved per week', results.hours)}
    </table>
    <div style="text-align:center;margin:22px 0 8px;">
      <a href="https://trycollectiq.com/#pricing" style="background:#c84b1f;color:#fff;text-decoration:none;padding:13px 30px;border-radius:9px;font-weight:700;font-size:15px;display:inline-block;">Start recovering — 30-day free trial &rarr;</a>
      <div style="font-size:11.5px;color:#9a958a;margin-top:9px;">No credit card required &middot; Founding rates locked for life &middot; $99/mo</div>
    </div>
    <div style="font-size:10.5px;color:#9a958a;line-height:1.5;margin-top:16px;border-top:1px solid #eee;padding-top:12px;">Estimates are illustrative projections based on published industry benchmarks for B2B AR automation. Actual results vary. CollectIQ makes no guarantee of specific recovery outcomes. &middot; CollectIQ Technologies LLC &middot; Dania Beach, FL &middot; <a href="mailto:hello@trycollectiq.com" style="color:#c84b1f;">hello@trycollectiq.com</a></div>
  </div>
</div>`;

    // 1) Results to the prospect
    await sgSend({
      personalizations: [{ to: [{ email }] }],
      from: { email: 'hello@trycollectiq.com', name: 'CollectIQ' },
      reply_to: { email: 'hello@trycollectiq.com', name: 'Kinecia Wheeler' },
      subject: 'Your CollectIQ recovery estimate: ' + (results.bigNum || 'calculated'),
      content: [{ type: 'text/html', value: resultsHtml }]
    });

    // 2) Lead alert to founder
    await sgSend({
      personalizations: [{ to: [{ email: 'hello@trycollectiq.com' }] }],
      from: { email: 'hello@trycollectiq.com', name: 'CollectIQ Lead Alert' },
      subject: '🔥 ROI LEAD: ' + email + ' — ' + (results.bigNum || '') + ' potential',
      content: [{ type: 'text/html', value:
        '<div style="font-family:Arial;max-width:520px;"><h2 style="color:#c84b1f;">New ROI calculator lead</h2>' +
        '<p><strong>Email:</strong> ' + esc(email) + '</p>' +
        '<p><strong>Their numbers:</strong> AR ' + esc(inputs.ar) + ' · ' + esc(inputs.days) + ' overdue · ' + esc(inputs.rate) + ' current rate · ' + esc(inputs.industry) + '</p>' +
        '<p><strong>Shown potential:</strong> ' + esc(results.bigNum) + ' recovery · ROI ' + esc(results.roi) + '</p>' +
        '<p style="color:#1a6644;font-weight:700;">Follow up within 24h while it\'s hot.</p></div>' }]
    });

    return { statusCode: 200, headers: cors, body: JSON.stringify({ ok: true }) };
  } catch (err) {
    console.error('roi-results error:', err.message);
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: 'Send failed' }) };
  }
};
