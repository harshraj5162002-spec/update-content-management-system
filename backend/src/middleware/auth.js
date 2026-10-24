const jwt = require('jsonwebtoken');
const { jwtSecret } = require('../config/env');
const { store } = require('../data/store');

function signToken(user) {
  return jwt.sign({ userId: user.id, role: user.role, email: user.email }, jwtSecret, { expiresIn: '7d' });
}

function isActiveUser(user) {
  if (user.status === 'active') return true;
  return user.status === 'restricted' && user.restrictedUntil && new Date(user.restrictedUntil) <= new Date();
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.substring(7) : null;

  if (!token) {
    return res.status(401).json({ message: 'Authentication required.' });
  }

  try {
    const decoded = jwt.verify(token, jwtSecret);
    const user = store.users.find((item) => item.id === decoded.userId);

    if (!user || !isActiveUser(user)) {
      return res.status(401).json({ message: 'Session invalid or user disabled.' });
    }

    if (user.status === 'restricted') {
      user.status = 'active';
      delete user.restrictedUntil;
      delete user.restrictionReason;
    }
    req.user = user;
    next();
  } catch (error) {
    return res.status(401).json({ message: 'Token expired or invalid.' });
  }
}

function optionalAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.substring(7) : null;
  if (!token) return next();

  try {
    const decoded = jwt.verify(token, jwtSecret);
    const user = store.users.find((item) => item.id === decoded.userId && isActiveUser(item));
    if (user) req.user = user;
    return next();
  } catch (error) {
    return next();
  }
}

function authorize(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ message: 'Authentication required.' });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ message: 'Insufficient permissions.' });
    }

    next();
  };
}

module.exports = { requireAuth, optionalAuth, authorize, signToken, isActiveUser };
