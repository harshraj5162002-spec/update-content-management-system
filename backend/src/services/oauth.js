const crypto = require('node:crypto');
const { backendUrl, oauth } = require('../config/env');

const pendingStates = new Map();
const stateLifetimeMs = 10 * 60 * 1000;

class OAuthError extends Error {}

function isOAuthConfigured(provider) {
  if (provider === 'google') return Boolean(oauth.googleClientId && oauth.googleClientSecret);
  if (provider === 'github') return Boolean(oauth.githubClientId && oauth.githubClientSecret);
  return false;
}

function createOAuthRequest(provider, role) {
  const state = crypto.randomBytes(32).toString('hex');
  const codeVerifier = crypto.randomBytes(32).toString('base64url');
  const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
  for (const [key, entry] of pendingStates) {
    if (entry.expiresAt <= Date.now()) pendingStates.delete(key);
  }
  pendingStates.set(state, { provider, role, codeVerifier, expiresAt: Date.now() + stateLifetimeMs });

  const callbackUrl = `${backendUrl}/api/auth/oauth/${provider}/callback`;
  const authorizationUrl = provider === 'google'
    ? new URL('https://accounts.google.com/o/oauth2/v2/auth')
    : new URL('https://github.com/login/oauth/authorize');
  authorizationUrl.search = new URLSearchParams({
    client_id: provider === 'google' ? oauth.googleClientId : oauth.githubClientId,
    redirect_uri: callbackUrl,
    response_type: 'code',
    scope: provider === 'google' ? 'openid email profile' : 'read:user user:email',
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  }).toString();
  return { authorizationUrl: authorizationUrl.toString(), state };
}

function consumeOAuthState(state) {
  if (typeof state !== 'string') return null;
  const entry = pendingStates.get(state);
  pendingStates.delete(state);
  if (!entry || entry.expiresAt <= Date.now()) return null;
  return entry;
}

function matchesOAuthState(queryState, cookieState) {
  if (typeof queryState !== 'string' || typeof cookieState !== 'string' || !queryState || queryState.length !== cookieState.length) {
    return false;
  }
  return crypto.timingSafeEqual(Buffer.from(queryState), Buffer.from(cookieState));
}

async function fetchJson(url, options) {
  let response;
  try {
    response = await fetch(url, { ...options, signal: AbortSignal.timeout(15000) });
  } catch {
    throw new OAuthError('Could not contact the sign-in provider. Please try again.');
  }
  if (!response.ok) throw new OAuthError('The sign-in provider could not verify your account.');
  try {
    const payload = await response.json();
    if (!payload || typeof payload !== 'object') throw new Error('Invalid JSON payload.');
    return payload;
  } catch {
    throw new OAuthError('The sign-in provider returned an invalid response.');
  }
}

async function getOAuthIdentity(provider, code, codeVerifier) {
  const callbackUrl = `${backendUrl}/api/auth/oauth/${provider}/callback`;
  if (provider === 'google') {
    const tokenPayload = await fetchJson('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: oauth.googleClientId,
        client_secret: oauth.googleClientSecret,
        redirect_uri: callbackUrl,
        grant_type: 'authorization_code',
        code_verifier: codeVerifier,
      }),
    });
    if (!tokenPayload.access_token) throw new OAuthError('The sign-in provider did not return an access token.');
    const profile = await fetchJson('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { Authorization: `Bearer ${tokenPayload.access_token}` },
    });
    if (Array.isArray(profile)) throw new OAuthError('The sign-in provider returned an invalid profile.');
    return {
      subject: profile.sub,
      email: profile.email,
      emailVerified: profile.email_verified === true,
      name: profile.name,
    };
  }

  const tokenPayload = await fetchJson('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: oauth.githubClientId,
      client_secret: oauth.githubClientSecret,
      redirect_uri: callbackUrl,
      code_verifier: codeVerifier,
    }),
  });
  if (!tokenPayload.access_token) throw new OAuthError('The sign-in provider did not return an access token.');
  const headers = {
    Authorization: `Bearer ${tokenPayload.access_token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'Signal-CMS',
  };
  const [profile, emails] = await Promise.all([
    fetchJson('https://api.github.com/user', { headers }),
    fetchJson('https://api.github.com/user/emails', { headers }),
  ]);
  if (Array.isArray(profile) || !Array.isArray(emails)) {
    throw new OAuthError('The sign-in provider returned an invalid profile.');
  }
  const verifiedEmail = emails.find((entry) => entry.primary && entry.verified)?.email
    || emails.find((entry) => entry.verified)?.email;
  return {
    subject: String(profile.id || ''),
    email: verifiedEmail,
    emailVerified: Boolean(verifiedEmail),
    name: profile.name || profile.login,
  };
}

module.exports = { OAuthError, isOAuthConfigured, createOAuthRequest, consumeOAuthState, matchesOAuthState, getOAuthIdentity };
