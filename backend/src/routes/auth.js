const express = require('express');
const bcrypt = require('bcryptjs');
const { body, validationResult } = require('express-validator');
const { store } = require('../data/store');
const { saveRecord } = require('../data/persistence');
const { recordAudit } = require('../services/audit');
const { asyncHandler } = require('../middleware/asyncHandler');
const { requireAuth, signToken, isActiveUser } = require('../middleware/auth');

const router = express.Router();

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
    const existing = store.users.find((user) => user.email.toLowerCase() === email);
    if (existing) {
      return res.status(409).json({ message: 'Account already exists for this email.' });
    }

    const user = {
      id: `u-${require('node:crypto').randomUUID()}`,
      name: name.trim(),
      email,
      passwordHash: await bcrypt.hash(password, 10),
      role,
      status: 'active',
      bio: 'New member of Signal CMS',
      avatar: name.trim().slice(0, 2).toUpperCase(),
      preferences: [],
      reputation: 75,
    };

    store.users.push(user);
    await saveRecord('users', user);
    await recordAudit({ actorId: user.id, action: 'auth.signup', targetType: 'user', targetId: user.id, outcome: 'created' });
    const token = signToken(user);

    res.status(201).json({ token, user: { ...user, passwordHash: undefined } });
  })
);

router.post(
  '/login',
  [body('email').trim().isEmail().withMessage('A valid email is required.'), body('password').notEmpty().withMessage('Password is required.')],
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
    res.json({ token, user: { ...user, passwordHash: undefined } });
  })
);

router.get('/me', requireAuth, (req, res) => {
  const { passwordHash, ...safeUser } = req.user;
  res.json({ user: safeUser });
});

module.exports = router;
