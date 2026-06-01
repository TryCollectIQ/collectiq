exports.handler = async function(event, context) {
  const clientId = process.env.QBO_CLIENT_ID;
  const redirectUri = 'https://trycollectiq.com/.netlify/functions/qbo-callback';
  const scope = 'com.intuit.quickbooks.accounting';
  const state = Buffer.from(JSON.stringify({
    tenantId: event.queryStringParameters?.tenantId || '',
    ts: Date.now()
  })).toString('base64');

  const authUrl = new URL('https://appcenter.intuit.com/connect/oauth2');
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', scope);
  authUrl.searchParams.set('state', state);

  return {
    statusCode: 302,
    headers: { Location: authUrl.toString() },
    body: ''
  };
};
