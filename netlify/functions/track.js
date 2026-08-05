// First-party analytics ingest — no cookies, no third parties, no PII
const https = require('https');

exports.handler = async (event) => {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: cors, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: cors, body: '' };

  try {
    const b = JSON.parse(event.body || '{}');
    const evt = String(b.event || '').slice(0, 60);
    if (!evt) return { statusCode: 400, headers: cors, body: '' };

    const row = {
      event: evt,
      props: (typeof b.props === 'object' && b.props) ? b.props : {},
      page: String(b.page || '').slice(0, 200),
      referrer: String(b.ref || '').slice(0, 300),
      utm_source: String(b.utm_source || '').slice(0, 80),
      utm_medium: String(b.utm_medium || '').slice(0, 80),
      utm_campaign: String(b.utm_campaign || '').slice(0, 120),
      session_id: String(b.sid || '').slice(0, 40)
    };

    const body = JSON.stringify(row);
    await new Promise((resolve, reject) => {
      const req = https.request({
        hostname: new URL(process.env.SUPABASE_URL).hostname,
        path: '/rest/v1/site_events',
        method: 'POST',
        headers: {
          'apikey': process.env.SUPABASE_SERVICE_KEY,
          'Authorization': 'Bearer ' + process.env.SUPABASE_SERVICE_KEY,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal',
          'Content-Length': Buffer.byteLength(body)
        }
      }, res => {
        let d = ''; res.on('data', c => d += c);
        res.on('end', () => (res.statusCode < 300 ? resolve() : reject(new Error('DB ' + res.statusCode + ' ' + d))));
      });
      req.on('error', reject);
      req.write(body); req.end();
    });

    return { statusCode: 204, headers: cors, body: '' };
  } catch (e) {
    console.error('track error:', e.message);
    return { statusCode: 200, headers: cors, body: '' }; // never break the site over analytics
  }
};
