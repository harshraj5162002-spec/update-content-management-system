const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const authRoutes = require('../src/routes/auth');
const { backendUrl } = require('../src/config/env');
const { createOAuthRequest, consumeOAuthState, matchesOAuthState } = require('../src/services/oauth');

test('OAuth state binds provider and selected role and can only be consumed once', () => {
  const request = createOAuthRequest('google', 'author');
  const authorizationUrl = new URL(request.authorizationUrl);
  const state = authorizationUrl.searchParams.get('state');
  const stateEntry = consumeOAuthState(state);

  assert.equal(authorizationUrl.searchParams.get('code_challenge_method'), 'S256');
  assert.ok(authorizationUrl.searchParams.get('code_challenge'));
  assert.equal(authorizationUrl.searchParams.get('redirect_uri'), `${backendUrl}/api/auth/oauth/google/callback`);
  assert.equal(stateEntry.provider, 'google');
  assert.equal(stateEntry.role, 'author');
  assert.match(stateEntry.codeVerifier, /^[A-Za-z0-9_-]+$/);
  assert.equal(consumeOAuthState(state), null);
  assert.equal(matchesOAuthState(state, state), true);
  assert.equal(matchesOAuthState(state, `${state}x`), false);
  assert.equal(matchesOAuthState(state, ''), false);
});

test('OAuth provider discovery and callback reject missing state safely', async () => {
  const app = express();
  app.use('/api/auth', authRoutes);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}/api/auth`;

  try {
    const providersResponse = await fetch(`${baseUrl}/oauth/providers`);
    const providers = await providersResponse.json();
    assert.equal(typeof providers.google, 'boolean');
    assert.equal(typeof providers.github, 'boolean');

    const callbackResponse = await fetch(`${baseUrl}/oauth/google/callback?code=untrusted`, { redirect: 'manual' });
    assert.equal(callbackResponse.status, 302);
    const destination = new URL(callbackResponse.headers.get('location'));
    assert.equal(destination.pathname, '/auth');
    assert.match(destination.searchParams.get('oauth_error'), /could not be verified/i);
    assert.equal(destination.hash, '');
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
