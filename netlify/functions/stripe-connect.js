const https = require('https');

function stripeRequest(path, method, data) {
  const payload = data ? new URLSearchParams(data).toString() : '';
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
      res.on('end', () => resolve({ status: res.statusCode, data: JSON.parse(d) }));
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
    const { action, email, accountId, tenantId } = JSON.parse(event.body);

    if (action === 'create_account') {
      // Create a Stripe Express connected account for the client
      const result = await stripeRequest('/v1/accounts', 'POST', {
        type: 'express',
        email: email,
        capabilities: {
          'card_payments[requested]': 'true',
          'transfers[requested]': 'true'
        },
        business_type: 'company',
        'metadata[tenant_id]': tenantId,
        'metadata[collectiq_email]': email
      });

      if (result.status !== 200) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: result.data.error?.message || 'Failed to create account' }) };
      }

      const stripeAccountId = result.data.id;

      // Create onboarding link
      const linkResult = await stripeRequest('/v1/account_links', 'POST', {
        account: stripeAccountId,
        refresh_url: 'https://trycollectiq.com/connect/refresh',
        return_url: 'https://trycollectiq.com/connect/success',
        type: 'account_onboarding'
      });

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
      // Get express dashboard link for connected account
      const result = await stripeRequest(
        `/v1/accounts/${accountId}/login_links`,
        'POST',
        {}
      );
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ url: result.data.url })
      };
    }

    if (action === 'create_payment_intent') {
      const { amount, currency, connectedAccountId, invoiceId, debtorEmail } = JSON.parse(event.body);
      const amountCents = Math.round(parseFloat(amount) * 100);
      const platformFee = Math.round(amountCents * 0.02); // 2% platform fee

      const result = await stripeRequest('/v1/payment_intents', 'POST', {
        amount: amountCents,
        currency: currency || 'usd',
        'automatic_payment_methods[enabled]': 'true',
        application_fee_amount: platformFee,
        'transfer_data[destination]': connectedAccountId,
        receipt_email: debtorEmail,
        'metadata[invoice_id]': invoiceId,
        'metadata[platform]': 'collectiq'
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

    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Unknown action' }) };

  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
