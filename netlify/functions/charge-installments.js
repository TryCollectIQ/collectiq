// CollectIQ — Daily installment charger
// Netlify Scheduled Function: runs daily, charges due payment-plan installments
// off-session using the saved card, routes funds to the connected account,
// updates plan_schedules + accounts + audit_log via the Supabase service key.

const https = require('https');

const STRIPE_KEY = process.env.STRIPE_SECRET_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

function stripeRequest(path, method, params) {
  return new Promise((resolve) => {
    const data = params ? new URLSearchParams(flatten(params)).toString() : null;
    const req = https.request({
      hostname: 'api.stripe.com',
      path, method,
      headers: {
        'Authorization': `Bearer ${STRIPE_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    }, (res) => { let b = ''; res.on('data', c => b += c); res.on('end', () => { try { resolve({ status: res.statusCode, data: JSON.parse(b) }); } catch { resolve({ status: res.statusCode, data: {} }); } }); });
    req.on('error', () => resolve({ status: 0, data: {} }));
    if (data) req.write(data);
    req.end();
  });
}

// Stripe expects bracket notation for nested params
function flatten(obj, prefix = '', out = {}) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}[${k}]` : k;
    if (v !== null && typeof v === 'object') flatten(v, key, out);
    else out[key] = String(v);
  }
  return out;
}

function sbReq(method, path, bodyObj) {
  return new Promise((resolve) => {
    const data = bodyObj ? JSON.stringify(bodyObj) : null;
    const req = https.request({
      hostname: new URL(SUPABASE_URL).hostname,
      path: '/rest/v1/' + path,
      method,
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': method === 'GET' ? 'count=none' : 'return=minimal'
      }
    }, (res) => { let b = ''; res.on('data', c => b += c); res.on('end', () => { try { resolve({ status: res.statusCode, data: b ? JSON.parse(b) : null }); } catch { resolve({ status: res.statusCode, data: null }); } }); });
    req.on('error', () => resolve({ status: 0, data: null }));
    if (data) req.write(data);
    req.end();
  });
}

exports.handler = async function () {
  if (!STRIPE_KEY || !SUPABASE_URL || !SUPABASE_KEY) {
    console.log('Missing env config; aborting.');
    return { statusCode: 500, body: 'Missing config' };
  }

  const nowIso = new Date().toISOString();
  const due = await sbReq('GET', `plan_schedules?status=eq.active&next_charge_at=lte.${encodeURIComponent(nowIso)}&select=*`);
  const plans = Array.isArray(due.data) ? due.data : [];
  console.log(`Installments due: ${plans.length}`);

  for (const plan of plans) {
    const amountCents = Math.round(Number(plan.installment_amount) * 100);
    const fee = Math.round(amountCents * 0.02);
    const n = (plan.paid_count || 0) + 1;

    const pi = await stripeRequest('/v1/payment_intents', 'POST', {
      amount: amountCents,
      currency: 'usd',
      customer: plan.stripe_customer_id,
      payment_method: plan.payment_method_id,
      off_session: 'true',
      confirm: 'true',
      application_fee_amount: fee,
      transfer_data: { destination: plan.connected_account_id },
      metadata: {
        platform: 'collectiq',
        payment_type: 'plan_installment',
        installment_number: String(n),
        plan_schedule_id: String(plan.id),
        invoice_id: plan.invoice_id || '',
        tenant_id: plan.tenant_id,
        account_row_id: plan.account_row_id || ''
      }
    });

    if (pi.status === 200 && pi.data && pi.data.status === 'succeeded') {
      const finished = n >= plan.months;
      const next = new Date(); next.setMonth(next.getMonth() + 1);
      await sbReq('PATCH', `plan_schedules?id=eq.${plan.id}`, finished
        ? { paid_count: n, status: 'completed' }
        : { paid_count: n, next_charge_at: next.toISOString() });
      if (finished && plan.account_row_id) {
        await sbReq('PATCH', `accounts?id=eq.${plan.account_row_id}`, { status: 'RECOVERED' });
      }
      await sbReq('POST', 'audit_log', {
        tenant_id: plan.tenant_id,
        actor: 'AutoPay',
        action_type: 'payment',
        description: `Installment ${n} of ${plan.months} charged: $${Number(plan.installment_amount).toLocaleString()} — ${plan.invoice_id || ''} — ${plan.debtor_name || plan.debtor_email || 'debtor'}${finished ? ' — PLAN COMPLETE, account recovered' : ''}`
      });
      console.log(`Charged installment ${n}/${plan.months} for plan ${plan.id}`);
    } else {
      const errMsg = (pi.data && pi.data.error && pi.data.error.message) || 'charge failed';
      await sbReq('PATCH', `plan_schedules?id=eq.${plan.id}`, { status: 'past_due' });
      await sbReq('POST', 'audit_log', {
        tenant_id: plan.tenant_id,
        actor: 'AutoPay',
        action_type: 'payment_failed',
        description: `Installment ${n} of ${plan.months} FAILED: $${Number(plan.installment_amount).toLocaleString()} — ${plan.invoice_id || ''} — ${errMsg}. Plan marked past due; manual follow-up needed.`
      });
      console.log(`FAILED installment for plan ${plan.id}: ${errMsg}`);
    }
  }

  return { statusCode: 200, body: JSON.stringify({ processed: plans.length }) };
};

// Netlify scheduled function config: run daily
exports.config = { schedule: '@daily' };
