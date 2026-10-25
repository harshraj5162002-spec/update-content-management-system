const crypto = require('node:crypto');
const express = require('express');
const { body, validationResult } = require('express-validator');
const { requireAuth, authorize } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/asyncHandler');
const { store } = require('../data/store');
const { saveRecord, saveSettings } = require('../data/persistence');
const { moderateContent, detectTopics, DEFAULT_MODERATION_THRESHOLDS } = require('../services/aiService');
const { recordAudit } = require('../services/audit');
const { adjustReputation } = require('../services/trust');
const { normalizeTrendingWeights } = require('../services/analytics');

const router = express.Router();
router.use(requireAuth, authorize('admin'));

function addNotification(userId, type, title) {
  if (!userId) return Promise.resolve();
  const notification = {
    id: `notification-${crypto.randomUUID()}`,
    userId,
    type,
    title,
    read: false,
    createdAt: new Date().toISOString(),
  };
  store.notifications.push(notification);
  return saveRecord('notifications', notification);
}

router.get('/dashboard', (req, res) => {
  const rangeDays = Number(req.query.days) || 30;
  if (![7, 30, 90].includes(rangeDays)) {
    return res.status(400).json({ message: 'Dashboard analytics support 7, 30, or 90 day ranges.' });
  }
  const since = new Date(Date.now() - rangeDays * 24 * 60 * 60 * 1000);
  const timeline = [];
  for (let offset = rangeDays - 1; offset >= 0; offset -= 1) {
    const date = new Date();
    date.setUTCHours(0, 0, 0, 0);
    date.setUTCDate(date.getUTCDate() - offset);
    const key = date.toISOString().slice(0, 10);
    timeline.push({ date: key, users: 0, moderation: 0, reports: 0, appeals: 0 });
  }
  const timelineByDate = new Map(timeline.map((entry) => [entry.date, entry]));
  const addTimelineEvent = (dateValue, key) => {
    const date = new Date(dateValue);
    if (!Number.isFinite(date.getTime()) || date < since) return;
    const entry = timelineByDate.get(date.toISOString().slice(0, 10));
    if (entry) entry[key] += 1;
  };
  const recentAudit = store.auditLogs.filter((event) => new Date(event.createdAt) >= since);
  for (const user of store.users) addTimelineEvent(user.createdAt, 'users');
  for (const event of recentAudit) {
    if (event.action.startsWith('article.review.') || event.action.startsWith('moderation.')) {
      addTimelineEvent(event.createdAt, 'moderation');
    }
  }
  for (const report of store.reports) addTimelineEvent(report.createdAt, 'reports');
  for (const appeal of store.appeals) addTimelineEvent(appeal.createdAt, 'appeals');
  const approved = store.articles.filter((article) => article.moderation?.status === 'approved' && article.status === 'published').length;
  const review = store.articles.filter((article) => article.status === 'pending').length;
  const blocked = store.articles.filter((article) => article.status === 'quarantined').length;
  const openReports = store.reports.filter((report) => report.status === 'open').length;
  const openAppeals = store.appeals.filter((appeal) => appeal.status === 'open').length;
  const recentAbuse = store.abuseEvents.filter((event) => new Date(event.createdAt) >= since).length;
  const moderated = store.moderationResults.length;
  const articleStatuses = ['draft', 'pending', 'published', 'quarantined', 'rejected', 'changes_requested', 'archived']
    .map((status) => ({ status, count: store.articles.filter((article) => article.status === status).length }));
  const reportsByStatus = ['open', 'resolved', 'dismissed']
    .map((status) => ({ status, count: store.reports.filter((report) => report.status === status).length }));
  const appealsByStatus = ['open', 'approved', 'upheld']
    .map((status) => ({ status, count: store.appeals.filter((appeal) => appeal.status === status).length }));
  const userRoles = ['reader', 'author', 'admin']
    .map((role) => ({ role, count: store.users.filter((user) => user.role === role).length }));

  res.json({
    rangeDays,
    overview: { approved, review, blocked, moderated, openReports, openAppeals, recentAbuse },
    analytics: {
      timeline,
      articleStatuses,
      reportsByStatus,
      appealsByStatus,
      userRoles,
      hasUserHistory: store.users.some((user) => user.createdAt && new Date(user.createdAt) >= since),
      hasModerationActivity: recentAudit.some((event) => event.action.startsWith('article.review.') || event.action.startsWith('moderation.')),
      hasReportActivity: store.reports.some((report) => report.createdAt && new Date(report.createdAt) >= since),
      hasAppealActivity: store.appeals.some((appeal) => appeal.createdAt && new Date(appeal.createdAt) >= since),
    },
    riskDistribution: [
      { label: 'Low risk', value: approved },
      { label: 'Requires review', value: review },
      { label: 'Quarantined', value: blocked },
    ],
    topics: detectTopics(store.articles),
    recentEvents: store.auditLogs.slice(-10).reverse(),
    thresholds: store.settings?.moderationThresholds || DEFAULT_MODERATION_THRESHOLDS,
  });
});

router.get('/abuse', (req, res) => {
  const items = store.abuseEvents.slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json({ items, count: items.length });
});

router.get('/articles', (req, res) => {
  const status = req.query.status ? String(req.query.status) : '';
  const items = store.articles
    .filter((article) => !status || article.status === status)
    .sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt));
  res.json({ items, count: items.length });
});

router.get('/users', (req, res) => {
  const items = store.users.map((user) => ({
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    status: user.status,
    reputation: user.reputation,
    restrictedUntil: user.restrictedUntil,
    isCurrentUser: user.id === req.user.id,
  }));
  res.json({ items });
});

router.patch('/users/:id/role', [
  body('role').isIn(['admin', 'author', 'reader']),
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  if (req.params.id === req.user.id) return res.status(409).json({ message: 'You cannot change your own role.' });
  const user = store.users.find((item) => item.id === req.params.id);
  if (!user) return res.status(404).json({ message: 'User not found.' });
  const previousRole = user.role;
  user.role = req.body.role;
  await saveRecord('users', user);
  await recordAudit({ actorId: req.user.id, action: 'user.role.update', targetType: 'user', targetId: user.id, reason: `Role changed from ${previousRole} to ${user.role}`, outcome: user.role });
  res.json({ user: { id: user.id, name: user.name, role: user.role } });
}));

router.post('/users/:id/reputation', [
  body('delta').isInt({ min: -10, max: 10 }).custom((delta) => delta !== 0),
  body('reason').trim().isLength({ min: 3, max: 500 }),
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  const user = store.users.find((item) => item.id === req.params.id);
  if (!user) return res.status(404).json({ message: 'User not found.' });
  const result = await adjustReputation({ user, actorId: req.user.id, reason: req.body.reason, delta: Number(req.body.delta) });
  if (result.duplicate) return res.status(409).json({ message: 'This reputation event has already been recorded.' });
  await recordAudit({ actorId: req.user.id, action: 'reputation.adjust', targetType: 'user', targetId: user.id, reason: req.body.reason, outcome: `${result.event.delta}` });
  res.json({ reputation: user.reputation, event: result.event });
}));

router.get('/queue', (req, res) => {
  const items = store.articles
    .filter((article) => ['pending', 'quarantined'].includes(article.status))
    .map((article) => ({
      ...article,
      author: (() => {
        const user = store.users.find((item) => item.id === article.authorId);
        if (!user) return null;
        const {
          passwordHash,
          passwordResetTokenHash,
          passwordResetTokenExpiresAt,
          oauthProviders,
          email,
          ...safeUser
        } = user;
        return safeUser;
      })(),
    }));
  res.json({ items, count: items.length });
});

router.post(
  '/review',
  [
    body('title').optional().isString().isLength({ max: 180 }),
    body('summary').optional().isString().isLength({ max: 500 }),
    body('content').optional().isString().isLength({ max: 100000 }),
    body('tags').optional().isArray({ max: 20 }),
  ],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    const result = moderateContent(req.body || {}, store.settings?.moderationThresholds);
    const record = {
      id: `moderation-${crypto.randomUUID()}`,
      status: result.status,
      riskScore: result.riskScore,
      reasons: result.reasons,
      actor: req.user.id,
      targetId: '',
      createdAt: new Date().toISOString(),
    };

    store.moderationResults.push(record);
    await saveRecord('moderationResults', record);
    await recordAudit({ actorId: req.user.id, action: 'moderation.analyze', reason: result.reasons.join('; '), outcome: result.status });
    res.json({ result, record });
  })
);

router.post('/articles/:id/decision', [
  body('decision').isIn(['approve', 'reject', 'request_changes', 'quarantine']),
  body('reason').trim().isLength({ min: 3, max: 1000 }),
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  const article = store.articles.find((item) => item.id === req.params.id);
  if (!article) return res.status(404).json({ message: 'Article not found.' });
  if (!['pending', 'quarantined'].includes(article.status)) {
    return res.status(409).json({ message: 'Only submissions awaiting review can receive a moderation decision.' });
  }
  if (req.body.decision === 'approve' && article.authorId === req.user.id) {
    return res.status(403).json({ message: 'You cannot approve your own article.' });
  }

  const previousStatus = article.status;
  const nextStatus = {
    approve: 'published',
    reject: 'rejected',
    request_changes: 'changes_requested',
    quarantine: 'quarantined',
  }[req.body.decision];
  article.status = nextStatus;
  article.updatedAt = new Date().toISOString();
  article.review = {
    ...(article.review || {}),
    reviewerId: req.user.id,
    decision: req.body.decision,
    feedback: req.body.reason.trim(),
    reviewedAt: article.updatedAt,
  };
  article.moderation = {
    ...(article.moderation || {}),
    status: req.body.decision === 'approve' ? 'approved' : req.body.decision === 'request_changes' ? 'review' : 'blocked',
    riskScore: article.moderation?.riskScore ?? 0,
    reasons: article.moderation?.reasons || [],
    adminOverride: true,
    overrideReason: req.body.reason.trim(),
    overriddenBy: req.user.id,
    overriddenAt: article.updatedAt,
  };
  if (nextStatus === 'published' && !article.publishedAt) article.publishedAt = article.updatedAt;
  await saveRecord('articles', article);

  const record = {
    id: `moderation-${crypto.randomUUID()}`,
    status: article.moderation.status,
    riskScore: article.moderation.riskScore,
    reasons: [req.body.reason.trim()],
    actor: req.user.id,
    targetId: article.id,
    previousStatus,
    createdAt: new Date().toISOString(),
  };
  store.moderationResults.push(record);
  await saveRecord('moderationResults', record);
  const notificationText = {
    approve: 'approved and published',
    reject: 'rejected',
    request_changes: 'returned with requested changes',
    quarantine: 'quarantined',
  }[req.body.decision];
  await addNotification(article.authorId, 'moderation', `Your article “${article.title}” was ${notificationText}.`);
  await recordAudit({ actorId: req.user.id, action: `article.review.${req.body.decision}`, targetType: 'article', targetId: article.id, reason: req.body.reason, outcome: nextStatus });
  res.json({ article, record });
}));

router.get('/reports', (req, res) => {
  res.json({ items: store.reports.slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)) });
});

router.patch('/reports/:id', [
  body('status').isIn(['resolved', 'dismissed']),
  body('decision').optional().trim().isLength({ max: 1000 }),
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  const report = store.reports.find((item) => item.id === req.params.id);
  if (!report) return res.status(404).json({ message: 'Report not found.' });
  report.status = req.body.status;
  report.decision = req.body.decision || '';
  report.reviewedBy = req.user.id;
  report.reviewedAt = new Date().toISOString();
  await saveRecord('reports', report);
  await recordAudit({ actorId: req.user.id, action: 'report.review', targetType: report.targetType, targetId: report.targetId, reason: report.decision, outcome: report.status });
  res.json({ report });
}));

router.get('/appeals', (req, res) => {
  res.json({ items: store.appeals.slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)) });
});

router.patch('/appeals/:id', [
  body('decision').isIn(['approve', 'uphold']),
  body('reason').trim().isLength({ min: 3, max: 1000 }),
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  const appeal = store.appeals.find((item) => item.id === req.params.id);
  if (!appeal) return res.status(404).json({ message: 'Appeal not found.' });
  if (appeal.status !== 'open') return res.status(409).json({ message: 'Appeal has already been reviewed.' });
  const article = store.articles.find((item) => item.id === appeal.articleId);
  if (!article) return res.status(404).json({ message: 'Appealed article no longer exists.' });
  if (req.body.decision === 'approve' && article.authorId === req.user.id) {
    return res.status(403).json({ message: 'You cannot approve your own article.' });
  }

  appeal.status = req.body.decision === 'approve' ? 'approved' : 'upheld';
  appeal.decision = req.body.reason.trim();
  appeal.reviewedBy = req.user.id;
  appeal.reviewedAt = new Date().toISOString();
  if (req.body.decision === 'approve') {
    article.status = 'published';
    article.publishedAt = new Date().toISOString();
    article.updatedAt = article.publishedAt;
    article.review = {
      ...(article.review || {}),
      reviewerId: req.user.id,
      decision: 'approve',
      feedback: appeal.decision,
      reviewedAt: article.updatedAt,
    };
    article.moderation = { ...(article.moderation || {}), status: 'approved', adminOverride: true, overrideReason: appeal.decision, overriddenBy: req.user.id };
    await saveRecord('articles', article);
  }
  await saveRecord('appeals', appeal);
  await addNotification(appeal.authorId, 'appeal', `Your appeal for “${article.title}” was ${appeal.status}.`);
  await recordAudit({ actorId: req.user.id, action: 'appeal.review', targetType: 'article', targetId: article.id, reason: appeal.decision, outcome: appeal.status });
  res.json({ appeal, article });
}));

router.get('/audit', (req, res) => {
  const page = Math.max(1, Math.floor(Number(req.query.page) || 1));
  const limit = Math.min(100, Math.max(1, Math.floor(Number(req.query.limit) || 25)));
  const entries = store.auditLogs.slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json({ items: entries.slice((page - 1) * limit, page * limit), count: entries.length, page, pages: Math.ceil(entries.length / limit) });
});

router.put('/settings', [
  body('moderationThresholds.autoApprove').optional().isInt({ min: 0, max: 99 }),
  body('moderationThresholds.review').optional().isInt({ min: 1, max: 100 }),
  body('trendingWeights').optional().isObject(),
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  const moderationThresholds = {
    ...DEFAULT_MODERATION_THRESHOLDS,
    ...store.settings?.moderationThresholds,
    ...req.body.moderationThresholds,
  };
  if (moderationThresholds.autoApprove >= moderationThresholds.review) {
    return res.status(400).json({ message: 'Auto-approval threshold must be lower than review threshold.' });
  }

  store.settings = {
    ...store.settings,
    moderationThresholds,
    ...(req.body.trendingWeights ? { trendingWeights: normalizeTrendingWeights(req.body.trendingWeights) } : {}),
  };
  await saveSettings(store.settings);
  await recordAudit({ actorId: req.user.id, action: 'settings.update', reason: 'Updated moderation/trending settings', outcome: 'saved' });
  res.json({ settings: store.settings });
}));

router.put('/users/:id/restriction', [
  body('durationHours').optional().isInt({ min: 1, max: 720 }),
  body('reason').trim().isLength({ min: 3, max: 1000 }),
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  const user = store.users.find((item) => item.id === req.params.id);
  if (!user) return res.status(404).json({ message: 'User not found.' });
  if (user.role === 'admin') return res.status(409).json({ message: 'Administrator accounts cannot be restricted here.' });

  const durationHours = Number(req.body.durationHours) || 24;
  user.status = 'restricted';
  user.restrictedUntil = new Date(Date.now() + durationHours * 60 * 60 * 1000).toISOString();
  user.restrictionReason = req.body.reason.trim();
  await saveRecord('users', user);
  await recordAudit({ actorId: req.user.id, action: 'user.restrict', targetType: 'user', targetId: user.id, reason: user.restrictionReason, outcome: `restricted for ${durationHours}h` });
  res.json({ user: { id: user.id, status: user.status, restrictedUntil: user.restrictedUntil } });
}));

router.delete('/users/:id/restriction', asyncHandler(async (req, res) => {
  const user = store.users.find((item) => item.id === req.params.id);
  if (!user) return res.status(404).json({ message: 'User not found.' });
  user.status = 'active';
  delete user.restrictedUntil;
  delete user.restrictionReason;
  await saveRecord('users', user);
  await recordAudit({ actorId: req.user.id, action: 'user.unrestrict', targetType: 'user', targetId: user.id, outcome: 'active' });
  res.json({ user: { id: user.id, status: user.status } });
}));

module.exports = router;
