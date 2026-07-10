const https = require('https');

function stripeRequest(path, method, params) {
  // Build URL-encoded body for Stripe API
  function encode(obj, prefix) {
    const parts = [];
    for (const key in obj) {
      if (obj.hasOwnProperty(key)) {
        const fullKey = prefix ? `${prefix}[${key}]` : key;
        const val = obj[key];
        if (val !== null && typeof val === 'object') {
          parts.push(encode(val, fullKey));
        } else {
          parts.push(encodeURIComponent(fullKey) + '=' + encodeURIComponent(val));
        }
      }
    }
    return parts.join('&');
  }

  const payload = params ? encode(params) : '';

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.stripe.com',
      path,
      method,
      headers: {
        'Authorization': 'Bearer ' + process.env.STRIPE_SECRET_KEY,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(payload)
      }
    }, (res) => {
      let d = '';
      res.on('data', chunk => d += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(d) });
        } catch(e) {
          resolve({ status: res.statusCode, data: d });
        }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

exports.handler = async function(event, context) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: 'Method Not Allowed' };

  try {
    const body = JSON.parse(event.body);
    const { action } = body;

    if (action === 'create_account') {
      const { email, tenantId } = body;

      // Create Stripe Express account
      const result = await stripeRequest('/v1/accounts', 'POST', {
        type: 'express',
        email: email,
        capabilities: {
          card_payments: { requested: true },
          transfers: { requested: true }
        },
        metadata: {
          tenant_id: tenantId || 'unknown',
          platform: 'collectiq'
        }
      });

      console.log('Create account result:', result.status, JSON.stringify(result.data).slice(0, 200));

      if (result.status !== 200) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: result.data.error?.message || 'Failed to create account' })
        };
      }

      const stripeAccountId = result.data.id;

      // Create onboarding link
      const linkResult = await stripeRequest('/v1/account_links', 'POST', {
        account: stripeAccountId,
        refresh_url: 'https://trycollectiq.com/connect/refresh',
        return_url: 'https://trycollectiq.com/connect/success',
        type: 'account_onboarding'
      });

      console.log('Account link result:', linkResult.status);

      if (linkResult.status !== 200) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Failed to create onboarding link', details: linkResult.data })
        };
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          accountId: stripeAccountId,
          onboardingUrl: linkResult.data.url
        })
      };
    }

    if (action === 'get_dashboard_link') {
      const { accountId } = body;
      const result = await stripeRequest(`/v1/accounts/${accountId}/login_links`, 'POST', {});
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ url: result.data.url })
      };
    }

    if (action === 'create_payment_intent') {
      const { amount, currency, connectedAccountId, invoiceId, debtorEmail, paymentType, settlementPct, offerDays, originalAmount, planMonths } = body;
      const amountCents = Math.round(parseFloat(amount) * 100);
      const platformFee = Math.round(amountCents * 0.02);

      const result = await stripeRequest('/v1/payment_intents', 'POST', {
        amount: amountCents,
        currency: currency || 'usd',
        automatic_payment_methods: { enabled: true },
        application_fee_amount: platformFee,
        transfer_data: { destination: connectedAccountId },
        receipt_email: debtorEmail,
        metadata: {
          invoice_id: invoiceId,
          platform: 'collectiq',
          payment_type: paymentType || 'full',
          settlement_pct: String(settlementPct || 0),
          offer_days: String(offerDays || 0),
          original_amount: String(originalAmount || amount),
          plan_months: String(planMonths || 0)
        }
      });

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          clientSecret: result.data.client_secret,
          paymentIntentId: result.data.id,
          platformFee: platformFee / 100
        })
      };
    }

    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Unknown action: ' + action }) };

  } catch (err) {
    console.error('Function error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
