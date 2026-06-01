const https = require('https');

function httpsRequest(options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
        catch(e) { resolve({ status: res.statusCode, data }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function saveTokensToSupabase(tenantId, tokens, realmId) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
  if (!supabaseUrl || !supabaseKey) return;

  const body = JSON.stringify({
    tenant_id: tenantId,
    qbo_realm_id: realmId,
    qbo_access_token: tokens.access_token,
    qbo_refresh_token: tokens.refresh_token,
    qbo_token_expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString()
  });

  // Upsert into a qbo_connections table
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: new URL(supabaseUrl).hostname,
      path: '/rest/v1/qbo_connections',
      method: 'POST',
      headers: {
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates',
        'Content-Length': Buffer.byteLength(body)
      }
    }, (res) => {
      let d = '';
      res.on('data', chunk => d += chunk);
      res.on('end', () => resolve({ status: res.statusCode }));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

exports.handler = async function(event, context) {
  const { code, state, realmId, error } = event.queryStringParameters || {};

  if (error) {
    return {
      statusCode: 302,
      headers: { Location: `https://trycollectiq.com/app?qbo_error=${error}` },
      body: ''
    };
  }

  if (!code) {
    return { statusCode: 400, body: 'Missing authorization code' };
  }

  // Decode state to get tenantId
  let tenantId = '';
  try {
    const decoded = JSON.parse(Buffer.from(state, 'base64').toString());
    tenantId = decoded.tenantId || '';
  } catch(e) {}

  // Exchange code for tokens
  const clientId = process.env.QBO_CLIENT_ID;
  const clientSecret = process.env.QBO_CLIENT_SECRET;
  const redirectUri = 'https://trycollectiq.com/.netlify/functions/qbo-callback';
  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  const tokenBody = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri
  }).toString();

  const tokenResult = await httpsRequest({
    hostname: 'oauth.platform.intuit.com',
    path: '/oauth2/v1/tokens/bearer',
    method: 'POST',
    headers: {
      'Authorization': `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(tokenBody),
      'Accept': 'application/json'
    }
  }, tokenBody);

  if (tokenResult.status !== 200) {
    console.error('Token exchange failed:', tokenResult.data);
    return {
      statusCode: 302,
      headers: { Location: 'https://trycollectiq.com/app?qbo_error=token_exchange_failed' },
      body: ''
    };
  }

  const tokens = tokenResult.data;

  // Save tokens to Supabase
  if (tenantId) {
    await saveTokensToSupabase(tenantId, tokens, realmId);
  }

  // Redirect back to app with success
  return {
    statusCode: 302,
    headers: { Location: `https://trycollectiq.com/app?qbo_connected=true&realmId=${realmId}` },
    body: ''
  };
};
