const https = require('https');

// Verify Stripe webhook signature
function verifyStripeSignature(payload, sigHeader, secret) {
  const crypto = require('crypto');
  const parts = sigHeader.split(',');
  let timestamp = '';
  let signature = '';
  
  for (const part of parts) {
    if (part.startsWith('t=')) timestamp = part.slice(2);
    if (part.startsWith('v1=')) signature = part.slice(3);
  }
  
  const signedPayload = `${timestamp}.${payload}`;
  const expectedSig = crypto
    .createHmac('sha256', secret)
    .update(signedPayload)
    .digest('hex');
  
  return expectedSig === signature;
}

// Update user plan in Supabase
async function updateUserPlan(email, plan, billing) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
  
  if (!supabaseUrl || !supabaseKey) {
    console.log('Supabase env vars not set');
    return;
  }

  const body = JSON.stringify({ plan, billing });
  
  return new Promise((resolve, reject) => {
    const url = new URL(`${supabaseUrl}/rest/v1/tenants`);
    
    // First find the user's tenant
    const findReq = https.request({
      hostname: new URL(supabaseUrl).hostname,
      path: `/rest/v1/users?email=eq.${encodeURIComponent(email)}&select=tenant_id`,
      method: 'GET',
      headers: {
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json'
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', async () => {
        try {
          const users = JSON.parse(data);
          if (users && users.length > 0) {
            const tenantId = users[0].tenant_id;
            
            // Update the tenant plan
            const updateBody = JSON.stringify({ plan: plan.toUpperCase(), billing });
            const updateReq = https.request({
              hostname: new URL(supabaseUrl).hostname,
              path: `/rest/v1/tenants?id=eq.${tenantId}`,
              method: 'PATCH',
              headers: {
                'apikey': supabaseKey,
                'Authorization': `Bearer ${supabaseKey}`,
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(updateBody)
              }
            }, (updateRes) => {
              let updateData = '';
              updateRes.on('data', chunk => updateData += chunk);
              updateRes.on('end', () => resolve({ status: updateRes.statusCode, data: updateData }));
            });
            updateReq.on('error', reject);
            updateReq.write(updateBody);
            updateReq.end();
          } else {
            resolve({ status: 404, data: 'User not found' });
          }
        } catch (e) {
          reject(e);
        }
      });
    });
    findReq.on('error', reject);
    findReq.end();
  });
}

exports.handler = async function(event, context) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: 'Method Not Allowed' };
  }

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const sigHeader = event.headers['stripe-signature'];

  // Verify webhook signature if secret is set
  if (webhookSecret && sigHeader) {
    const isValid = verifyStripeSignature(event.body, sigHeader, webhookSecret);
    if (!isValid) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid signature' }) };
    }
  }

  try {
    const stripeEvent = JSON.parse(event.body);
    console.log('Stripe event:', stripeEvent.type);

    if (stripeEvent.type === 'checkout.session.completed') {
      const session = stripeEvent.data.object;
      const email = session.customer_email || session.metadata?.email;
      const priceId = session.metadata?.priceId || '';

      if (!email) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'No email in session' }) };
      }

      // Determine plan from price ID
      let plan = 'STARTER';
      let billing = 'monthly';

      if (priceId.includes('growth') || priceId === 'https://buy.stripe.com/4gM4gBejT2tBbeWeW624001' || priceId === 'https://buy.stripe.com/9B64gBcbL9W3aaS4hs24000') {
        plan = 'GROWTH';
      }
      if (priceId.includes('annual') || priceId === 'https://buy.stripe.com/9B64gBcbL9W3aaS4hs24000' || priceId === 'https://buy.stripe.com/eVqeVfb7H0ltgzgaFQ24003') {
        billing = 'annual';
      }

      console.log(`Updating ${email} to ${plan} ${billing}`);
      await updateUserPlan(email, plan, billing);

      return { statusCode: 200, headers, body: JSON.stringify({ received: true, plan, billing }) };
    }

    if (stripeEvent.type === 'customer.subscription.deleted') {
      const subscription = stripeEvent.data.object;
      const email = subscription.metadata?.email;
      if (email) {
        await updateUserPlan(email, 'STARTER', 'monthly');
      }
      return { statusCode: 200, headers, body: JSON.stringify({ received: true }) };
    }

    // Return 200 for all other events
    return { statusCode: 200, headers, body: JSON.stringify({ received: true }) };

  } catch (err) {
    console.error('Webhook error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
