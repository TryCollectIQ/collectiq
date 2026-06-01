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

async function getTokens(tenantId) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
  
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: new URL(supabaseUrl).hostname,
      path: `/rest/v1/qbo_connections?tenant_id=eq.${tenantId}&limit=1`,
      method: 'GET',
      headers: {
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json'
      }
    }, (res) => {
      let d = '';
      res.on('data', chunk => d += chunk);
      res.on('end', () => {
        try {
          const rows = JSON.parse(d);
          resolve(rows?.[0] || null);
        } catch(e) { resolve(null); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function refreshToken(connection) {
  const clientId = process.env.QBO_CLIENT_ID;
  const clientSecret = process.env.QBO_CLIENT_SECRET;
  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: connection.qbo_refresh_token
  }).toString();

  const result = await httpsRequest({
    hostname: 'oauth.platform.intuit.com',
    path: '/oauth2/v1/tokens/bearer',
    method: 'POST',
    headers: {
      'Authorization': `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(body),
      'Accept': 'application/json'
    }
  }, body);

  return result.status === 200 ? result.data : null;
}

async function queryQBO(realmId, accessToken, query) {
  const encodedQuery = encodeURIComponent(query);
  return httpsRequest({
    hostname: 'quickbooks.api.intuit.com',
    path: `/v3/company/${realmId}/query?query=${encodedQuery}&minorversion=65`,
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Accept': 'application/json'
    }
  });
}

async function saveAccountsToSupabase(tenantId, accounts) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
  if (!accounts.length) return 0;

  const body = JSON.stringify(accounts);
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: new URL(supabaseUrl).hostname,
      path: '/rest/v1/accounts',
      method: 'POST',
      headers: {
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=ignore-duplicates',
        'Content-Length': Buffer.byteLength(body)
      }
    }, (res) => {
      let d = '';
      res.on('data', chunk => d += chunk);
      res.on('end', () => resolve(res.statusCode));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

exports.handler = async function(event, context) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: 'Method Not Allowed' };

  try {
    const { tenantId } = JSON.parse(event.body);
    if (!tenantId) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing tenantId' }) };

    // Get stored tokens
    let connection = await getTokens(tenantId);
    if (!connection) return { statusCode: 404, headers, body: JSON.stringify({ error: 'QuickBooks not connected. Please connect QuickBooks first.' }) };

    // Refresh token if expired
    const now = new Date();
    const expiresAt = new Date(connection.qbo_token_expires_at);
    if (now >= expiresAt) {
      const newTokens = await refreshToken(connection);
      if (!newTokens) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Token refresh failed. Please reconnect QuickBooks.' }) };
      connection.qbo_access_token = newTokens.access_token;
      connection.qbo_refresh_token = newTokens.refresh_token;
    }

    const { qbo_realm_id: realmId, qbo_access_token: accessToken } = connection;

    // Query overdue invoices from QuickBooks
    const invoiceQuery = "SELECT * FROM Invoice WHERE Balance > '0' MAXRESULTS 200";
    const invoiceResult = await queryQBO(realmId, accessToken, invoiceQuery);

    if (invoiceResult.status !== 200) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Failed to fetch invoices from QuickBooks', details: invoiceResult.data }) };
    }

    const invoices = invoiceResult.data?.QueryResponse?.Invoice || [];
    
    // Query customers for email addresses
    const customerQuery = "SELECT * FROM Customer WHERE Active = true MAXRESULTS 200";
    const customerResult = await queryQBO(realmId, accessToken, customerQuery);
    const customers = customerResult.data?.QueryResponse?.Customer || [];
    
    // Build customer email lookup
    const customerEmails = {};
    customers.forEach(c => {
      if (c.PrimaryEmailAddr?.Address) {
        customerEmails[c.Id] = c.PrimaryEmailAddr.Address;
      }
    });

    // Convert invoices to CollectIQ account format
    const today = new Date();
    const accountsToSave = [];
    const importedAccounts = [];

    invoices.forEach(inv => {
      if (!inv.Balance || inv.Balance <= 0) return;
      
      const dueDate = inv.DueDate ? new Date(inv.DueDate) : new Date();
      const daysOverdue = Math.max(0, Math.floor((today - dueDate) / (1000 * 60 * 60 * 24)));
      const balance = parseFloat(inv.Balance) || 0;
      
      // AI risk score
      const risk = Math.min(99, Math.max(10, Math.round(
        (balance / 5000) * 20 + (daysOverdue / 90) * 60 + Math.random() * 10
      )));

      const customerName = inv.CustomerRef?.name || 'Unknown Customer';
      const customerId = inv.CustomerRef?.value;
      const email = customerEmails[customerId] || '';

      const account = {
        tenant_id: tenantId,
        name: customerName,
        email,
        balance,
        risk_score: risk,
        status: daysOverdue > 0 ? 'OVERDUE' : 'PENDING',
        days_overdue: daysOverdue
      };

      accountsToSave.push(account);
      importedAccounts.push({ name: customerName, balance, daysOverdue, risk });
    });

    // Save to Supabase
    if (accountsToSave.length > 0) {
      await saveAccountsToSupabase(tenantId, accountsToSave);
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        imported: accountsToSave.length,
        accounts: importedAccounts
      })
    };

  } catch(err) {
    console.error('QBO sync error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
