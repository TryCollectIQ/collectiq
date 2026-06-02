const https = require('https');

exports.handler = async function(event, context) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: 'Method Not Allowed' };

  try {
    const { to, body, from } = JSON.parse(event.body);

    if (!to || !body) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing required fields: to, body' }) };
    }

    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const fromNumber = from || process.env.TWILIO_PHONE_NUMBER;

    if (!accountSid || !authToken || !fromNumber) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'Twilio credentials not configured' }) };
    }

    // Format phone number - ensure it has + prefix
    const toFormatted = to.startsWith('+') ? to : '+1' + to.replace(/\D/g, '');

    const payload = new URLSearchParams({
      To: toFormatted,
      From: fromNumber,
      Body: body
    }).toString();

    const credentials = Buffer.from(`${accountSid}:${authToken}`).toString('base64');

    const result = await new Promise((resolve, reject) => {
      const req = https.request({
        hostname: 'api.twilio.com',
        path: `/2010-04-01/Accounts/${accountSid}/Messages.json`,
        method: 'POST',
        headers: {
          'Authorization': `Basic ${credentials}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(payload)
        }
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
          catch(e) { resolve({ status: res.statusCode, data }); }
        });
      });
      req.on('error', reject);
      req.write(payload);
      req.end();
    });

    console.log('Twilio response:', result.status, JSON.stringify(result.data).slice(0, 200));

    if (result.status === 201) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          messageSid: result.data.sid,
          status: result.data.status,
          to: result.data.to
        })
      };
    } else {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          error: result.data.message || 'SMS failed to send',
          code: result.data.code,
          details: result.data
        })
      };
    }

  } catch (err) {
    console.error('Twilio function error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
