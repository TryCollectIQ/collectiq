const https = require('https');

exports.handler = async function(event, context) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    const { to, toName, subject, body, fromName } = JSON.parse(event.body);

    if (!to || !subject || !body) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing required fields' }) };
    }

    const emailData = JSON.stringify({
      personalizations: [{ to: [{ email: to, name: toName || to }], subject }],
      from: { email: 'hello@trycollectiq.com', name: fromName || 'CollectIQ' },
      reply_to: { email: 'hello@trycollectiq.com', name: 'CollectIQ' },
      content: [{
        type: 'text/html',
        value: '<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;"><div style="margin-bottom:24px;"><strong style="font-size:18px;">Collect<span style="color:#c2410c;">IQ</span></strong></div><div style="font-size:14px;line-height:1.7;color:#1c1917;">' + body.replace(/\n/g, '<br/>') + '</div><hr style="margin:24px 0;border:none;border-top:1px solid #e8e4dd;"/><div style="font-size:11px;color:#a8a29e;">Sent via CollectIQ &nbsp;·&nbsp; <a href="https://trycollectiq.com" style="color:#a8a29e;">trycollectiq.com</a></div></div>'
      }]
    });

    const result = await new Promise((resolve, reject) => {
      const req = require('https').request({
        hostname: 'api.sendgrid.com',
        path: '/v3/mail/send',
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + process.env.SENDGRID_API_KEY,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(emailData)
        }
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve({ status: res.statusCode, data }));
      });
      req.on('error', reject);
      req.write(emailData);
      req.end();
    });

    if (result.status === 202) {
      return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
    } else {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'SendGrid error', details: result.data }) };
    }

  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
