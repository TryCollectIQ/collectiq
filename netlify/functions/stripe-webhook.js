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

// Update subscription status in Supabase
async function updateSubscriptionStatus(email, status, subscriptionId) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
  if (!supabaseUrl || !supabaseKey) return;

  return new Promise((resolve, reject) => {
    const req = https.request({
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
            const updateBody = JSON.stringify({
              subscription_status: status,
              stripe_subscription_id: subscriptionId || null
            });
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
              let d = '';
              updateRes.on('data', chunk => d += chunk);
              updateRes.on('end', () => resolve({ status: updateRes.statusCode }));
            });
            updateReq.on('error', reject);
            updateReq.write(updateBody);
            updateReq.end();
          } else {
            resolve({ status: 404 });
          }
        } catch(e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.end();
  });
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


    // ── DEBTOR PAYMENT RECEIVED: close the loop in the database ──
    if (stripeEvent.type === 'payment_intent.succeeded') {
      const pi = stripeEvent.data.object;
      const md = pi.metadata || {};
      if (md.platform === 'collectiq' && md.tenant_id) {
        const supabaseUrl = process.env.SUPABASE_URL;
        const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
        const sbReq = (method, path, bodyObj) => new Promise((resolve) => {
          const data = bodyObj ? JSON.stringify(bodyObj) : null;
          const req = https.request({
            hostname: new URL(supabaseUrl).hostname,
            path: '/rest/v1/' + path,
            method,
            headers: {
              'apikey': supabaseKey,
              'Authorization': `Bearer ${supabaseKey}`,
              'Content-Type': 'application/json',
              'Prefer': 'return=minimal'
            }
          }, (res) => { let b=''; res.on('data',c=>b+=c); res.on('end',()=>resolve({status:res.statusCode, body:b})); });
          req.on('error', ()=>resolve({status:0}));
          if (data) req.write(data);
          req.end();
        });

        const amountPaid = (pi.amount_received || pi.amount || 0) / 100;
        const ptype = md.payment_type || 'full';

        // 1. Update the account row
        if (md.account_row_id) {
          const newStatus = ptype === 'plan' ? 'PLAN' : 'RECOVERED';
          await sbReq('PATCH', `accounts?id=eq.${md.account_row_id}`, { status: newStatus });
        }

        // 2. Audit trail
        await sbReq('POST', 'audit_log', {
          tenant_id: md.tenant_id,
          actor: 'Debtor Portal',
          action_type: 'payment',
          description: `Payment received: $${amountPaid.toLocaleString()} (${ptype}${ptype==='plan' ? `, installment 1 of ${md.plan_months}` : ''}) — ${md.invoice_id || 'no invoice ref'} — ${md.debtor_name || md.debtor_email || 'debtor'}`
        });

        // 3. Payment plans: schedule the remaining installments
        if (ptype === 'plan' && pi.customer && parseInt(md.plan_months) > 1) {
          const next = new Date(); next.setMonth(next.getMonth() + 1);
          await sbReq('POST', 'plan_schedules', {
            tenant_id: md.tenant_id,
            account_row_id: md.account_row_id || null,
            invoice_id: md.invoice_id || '',
            debtor_name: md.debtor_name || '',
            debtor_email: md.debtor_email || '',
            stripe_customer_id: pi.customer,
            payment_method_id: pi.payment_method || '',
            connected_account_id: md.connected_account || '',
            installment_amount: parseFloat(md.installment_amount || amountPaid),
            total_amount: parseFloat(md.original_amount || 0),
            months: parseInt(md.plan_months),
            paid_count: 1,
            next_charge_at: next.toISOString(),
            status: 'active'
          });
        }

        console.log(`CollectIQ payment recorded: $${amountPaid} ${ptype} tenant=${md.tenant_id}`);
        return { statusCode: 200, headers, body: JSON.stringify({ received: true, recorded: true }) };
      }
      return { statusCode: 200, headers, body: JSON.stringify({ received: true }) };
    }

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
      
      // Also update subscription status to active
      await updateSubscriptionStatus(email, 'active', session.subscription);

      return { statusCode: 200, headers, body: JSON.stringify({ received: true, plan, billing }) };
    }

    if (stripeEvent.type === 'customer.subscription.deleted') {
      const subscription = stripeEvent.data.object;
      const email = subscription.metadata?.email;
      if (email) {
        await updateUserPlan(email, 'STARTER', 'monthly');
        await updateSubscriptionStatus(email, 'canceled', null);
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
