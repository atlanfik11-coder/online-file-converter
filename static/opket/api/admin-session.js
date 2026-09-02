const { issueAdminSessionToken, verifyAdminPassword, verifyAdminSessionToken } = require('./_lib/admin-auth');

function readAdminSessionToken(req, body = {}) {
  const authHeader = String(req.headers?.authorization || '').trim();
  if (authHeader.toLowerCase().startsWith('bearer ')) {
    return authHeader.slice(7).trim();
  }
  return String(body.sessionToken || req.headers?.['x-opket-admin-session'] || '').trim();
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');

  if (req.method === 'GET') {
    const verification = verifyAdminSessionToken(readAdminSessionToken(req));
    if (!verification.ok) {
      return res.status(401).json({ ok: false, error: verification.error || 'admin_unauthorized' });
    }
    return res.status(200).json({ ok: true });
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const body = typeof req.body === 'object' && req.body ? req.body : {};
  const password = String(body.password || '').trim();
  if (!verifyAdminPassword(password)) {
    return res.status(401).json({ ok: false, error: 'admin_unauthorized' });
  }

  return res.status(200).json({
    ok: true,
    sessionToken: issueAdminSessionToken()
  });
};
