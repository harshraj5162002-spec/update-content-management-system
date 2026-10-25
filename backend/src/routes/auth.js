const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('node:crypto');
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');
const { store } = require('../data/store');
const { saveRecord, consumePasswordResetToken, clearPasswordResetToken } = require('../data/persistence');
const { recordAudit } = require('../services/audit');
const { sendPasswordResetEmail, isEmailConfigured } = require('../services/email');
const { isOAuthConfigured, createOAuthRequest, consumeOAuthState, matchesOAuthState, getOAuthIdentity, OAuthError } = require('../services/oauth');
const { asyncHandler } = require('../middleware/asyncHandler');
const { requireAuth, signToken, isActiveUser } = require('../middleware/auth');
const { frontendUrl, nodeEnv } = require('../config/env');

const router = express.Router();
const pendingAccountEmails = new Set();
const resetRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many password reset attempts. Please try again later.' },
});

function publicUser(user) {
  const safeUser = { ...user };
  for (const field of ['passwordHash', 'passwordResetTokenHash', 'passwordResetTokenExpiresAt', 'oauthProviders']) {
    delete safeUser[field];
  }
  return safeUser;
}

function readCookie(req, name) {
  const entry = (req.headers.cookie || '').split(';').map((cookie) => cookie.trim()).find((cookie) => cookie.startsWith(`${name}=`));
  return entry ? entry.slice(name.length + 1) : '';
}

async function createUserForEmail(email, createUser) {
  if (pendingAccountEmails.has(email) || store.users.some((user) => user.email.toLowerCase() === email)) return null;
  pendingAccountEmails.add(email);
  try {
    if (store.users.some((user) => user.email.toLowerCase() === email)) return null;
    const user = await createUser();
    store.users.push(user);
    try {
      await saveRecord('users', user);
    } catch (error) {
      const index = store.users.findIndex((candidate) => candidate.id === user.id);
      if (index !== -1) store.users.splice(index, 1);
      if (error.code === 11000) return null;
      throw error;
    }
    return user;
  } finally {
    pendingAccountEmails.delete(email);
  }
}

router.post(
  '/signup',
  [
    body('name').trim().isLength({ min: 2 }).withMessage('Name must contain at least 2 characters.'),
    body('email').trim().isEmail().withMessage('A valid email is required.'),
    body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters.'),
    body('role').optional().isIn(['reader', 'author']).withMessage('Role must be reader or author.'),
  ],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { name, password } = req.body;
    const role = req.body.role || 'reader';
    const email = req.body.email.trim().toLowerCase();
    const user = await createUserForEmail(email, async () => ({
      id: `u-${crypto.randomUUID()}`,
      name: name.trim(),
      email,
      passwordHash: await bcrypt.hash(password, 10),
      role,
      status: 'active',
      bio: 'New member of Signal CMS',
      avatar: name.trim().slice(0, 2).toUpperCase(),
      preferences: [],
      reputation: 75,
      createdAt: new Date().toISOString(),
    }));
    if (!user) return res.status(409).json({ message: 'Account already exists for this email.' });
    await recordAudit({ actorId: user.id, action: 'auth.signup', targetType: 'user', targetId: user.id, outcome: 'created' });
    const token = signToken(user);

    res.status(201).json({ token, user: publicUser(user) });
  })
);

router.post(
  '/login',
  [
    body('email').trim().isEmail().withMessage('A valid email is required.'),
    body('password').notEmpty().withMessage('Password is required.'),
    body('role').isIn(['reader', 'author', 'admin']).withMessage('Choose the role assigned to your account.'),
  ],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const email = req.body.email.trim().toLowerCase();
    const { password } = req.body;
    const user = store.users.find((item) => item.email.toLowerCase() === email.toLowerCase());
    if (!user) {
      return res.status(401).json({ message: 'Invalid credentials.' });
    }
    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      return res.status(401).json({ message: 'Invalid credentials.' });
    }

    if (user.role !== req.body.role) {
      return res.status(403).json({ message: 'The selected role does not match this account.' });
    }

    if (!isActiveUser(user)) {
      return res.status(403).json({ message: 'Account is not active.' });
    }

    if (user.status === 'restricted') {
      user.status = 'active';
      delete user.restrictedUntil;
      delete user.restrictionReason;
      await saveRecord('users', user);
    }

    const token = signToken(user);
    await recordAudit({ actorId: user.id, action: 'auth.login', targetType: 'user', targetId: user.id, outcome: 'success' });
    res.json({ token, user: publicUser(user) });
  })
);

router.get('/oauth/providers', (req, res) => {
  res.json({ google: isOAuthConfigured('google'), github: isOAuthConfigured('github') });
});

router.get('/oauth/:provider', resetRateLimit, asyncHandler(async (req, res) => {
  const { provider } = req.params;
  if (!['google', 'github'].includes(provider)) return res.status(404).json({ message: 'OAuth provider not supported.' });
  if (!isOAuthConfigured(provider)) return res.status(503).json({ message: `${provider} sign-in is not configured.` });
  const role = ['reader', 'author', 'admin'].includes(req.query.role) ? req.query.role : '';
  if (!role) return res.status(400).json({ message: 'Choose the role assigned to your account.' });
  const request = createOAuthRequest(provider, role);
  res.cookie(`signal_oauth_state_${provider}`, request.state, {
    httpOnly: true,
    secure: nodeEnv === 'production',
    sameSite: 'lax',
    maxAge: 10 * 60 * 1000,
    path: `/api/auth/oauth/${provider}/callback`,
  });
  res.redirect(request.authorizationUrl);
}));

router.get('/oauth/:provider/callback', asyncHandler(async (req, res) => {
  const { provider } = req.params;
  const callbackUrl = new URL('/auth', frontendUrl);
  const cookieName = `signal_oauth_state_${provider}`;
  const queryState = typeof req.query.state === 'string' ? req.query.state : '';
  if (!matchesOAuthState(queryState, readCookie(req, cookieName))) {
    callbackUrl.searchParams.set('oauth_error', 'OAuth sign-in could not be verified. Please try again.');
    return res.redirect(callbackUrl.toString());
  }
  const state = consumeOAuthState(queryState);
  res.clearCookie(cookieName, {
    httpOnly: true,
    secure: nodeEnv === 'production',
    sameSite: 'lax',
    path: `/api/auth/oauth/${provider}/callback`,
  });
  if (!state || state.provider !== provider || !req.query.code || req.query.error) {
    callbackUrl.searchParams.set('oauth_error', 'OAuth sign-in could not be verified. Please try again.');
    return res.redirect(callbackUrl.toString());
  }

  try {
    const identity = await getOAuthIdentity(provider, String(req.query.code), state.codeVerifier);
    if (
      typeof identity.subject !== 'string' || !identity.subject.trim() ||
      typeof identity.email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identity.email) ||
      !identity.emailVerified
    ) {
      callbackUrl.searchParams.set('oauth_error', 'The provider did not supply a valid identity with a verified email address.');
      return res.redirect(callbackUrl.toString());
    }
    const verifiedEmail = identity.email.trim().toLowerCase();
    const displayName = typeof identity.name === 'string' ? identity.name.trim().slice(0, 80) : '';
    let user = store.users.find((candidate) => candidate.oauthProviders?.[provider] === identity.subject);
    if (user) {
      if (user.role !== state.role) {
        callbackUrl.searchParams.set('oauth_error', `This account uses the ${user.role} role. Choose that role to sign in.`);
        return res.redirect(callbackUrl.toString());
      }
      if (!isActiveUser(user)) {
        callbackUrl.searchParams.set('oauth_error', 'This account is not active.');
        return res.redirect(callbackUrl.toString());
      }
    } else {
      const existingEmail = store.users.find((candidate) => candidate.email.toLowerCase() === verifiedEmail);
      if (existingEmail) {
        callbackUrl.searchParams.set('oauth_error', 'An account already uses this email. Sign in with that account before linking a provider.');
        return res.redirect(callbackUrl.toString());
      }
      if (state.role === 'admin') {
        callbackUrl.searchParams.set('oauth_error', 'Administrator accounts cannot be created through social sign-in.');
        return res.redirect(callbackUrl.toString());
      }
      user = await createUserForEmail(verifiedEmail, async () => ({
        id: `u-${crypto.randomUUID()}`,
        name: displayName || verifiedEmail.split('@')[0],
        email: verifiedEmail,
        passwordHash: await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 10),
        oauthProviders: { [provider]: identity.subject },
        role: state.role,
        status: 'active',
        bio: 'New member of Signal CMS',
        avatar: (displayName || verifiedEmail).slice(0, 2).toUpperCase(),
        preferences: [],
        reputation: 75,
        createdAt: new Date().toISOString(),
      }));
      if (!user) {
        callbackUrl.searchParams.set('oauth_error', 'An account already uses this email. Sign in with that account before linking a provider.');
        return res.redirect(callbackUrl.toString());
      }
      await recordAudit({ actorId: user.id, action: 'auth.oauth.signup', targetType: 'user', targetId: user.id, outcome: provider });
    }
    const token = signToken(user);
    callbackUrl.hash = new URLSearchParams({ token }).toString();
    return res.redirect(callbackUrl.toString());
  } catch (error) {
    if (!(error instanceof OAuthError)) throw error;
    callbackUrl.searchParams.set('oauth_error', error.message);
    return res.redirect(callbackUrl.toString());
  }
}));

router.post('/password-reset/request', resetRateLimit, [
  body('email').trim().isEmail().withMessage('A valid email is required.'),
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  if (!isEmailConfigured()) {
    return res.status(503).json({ message: 'Password reset email is unavailable. Contact the site administrator.' });
  }

  const email = req.body.email.trim().toLowerCase();
  const user = store.users.find((item) => item.email.toLowerCase() === email);
  if (user) {
    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    user.passwordResetTokenHash = tokenHash;
    user.passwordResetTokenExpiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    try {
      await saveRecord('users', user);
      await sendPasswordResetEmail(user.email, token);
    } catch {
      try {
        await clearPasswordResetToken(user.id, tokenHash);
      } catch {
        console.error('Password-reset token cleanup failed.');
      }
      console.error('Password-reset request could not be completed.');
    }
  }

  res.json({ message: 'If an account exists for that email, password reset instructions have been sent.' });
}));

router.post('/password-reset/confirm', resetRateLimit, [
  body('token').isString().isLength({ min: 64, max: 64 }).withMessage('The reset link is invalid or expired.'),
  body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters.'),
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ message: 'The reset link is invalid or expired.', errors: errors.array() });

  const tokenHash = crypto.createHash('sha256').update(req.body.token).digest('hex');
  const user = store.users.find((item) =>
    item.passwordResetTokenHash === tokenHash &&
    item.passwordResetTokenExpiresAt &&
    new Date(item.passwordResetTokenExpiresAt).getTime() > Date.now()
  );
  if (!user) return res.status(400).json({ message: 'The reset link is invalid or expired.' });

  const passwordHash = await bcrypt.hash(req.body.password, 10);
  const consumed = await consumePasswordResetToken(user.id, tokenHash, passwordHash);
  if (!consumed) return res.status(400).json({ message: 'The reset link is invalid or expired.' });
  await recordAudit({ actorId: user.id, action: 'auth.password.reset', targetType: 'user', targetId: user.id, outcome: 'success' });
  res.json({ message: 'Password updated. You can now sign in with your new password.' });
}));

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

module.exports = router;
