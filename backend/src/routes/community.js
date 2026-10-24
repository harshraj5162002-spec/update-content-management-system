const crypto = require('node:crypto');
const express = require('express');
const { body, validationResult } = require('express-validator');
const { store } = require('../data/store');
const { saveRecord } = require('../data/persistence');
const { requireAuth, authorize } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/asyncHandler');
const { getRecommendationsForUser, getTrendingArticles, searchArticles, getAuthorStats } = require('../services/analytics');
const { moderateContent } = require('../services/aiService');
const { checkExternalLink } = require('../services/safeLinkCheck');
const { recordAudit } = require('../services/audit');
const { recordAbuse } = require('../services/trust');

const router = express.Router();

function visibleUser(user) {
  if (!user) return null;
  const { passwordHash, email, reputation, ...profile } = user;
  return profile;
}

function ownUser(user) {
  if (!user) return null;
  const { passwordHash, ...profile } = user;
  return profile;
}

function addNotification(userId, type, title) {
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

router.get('/search', (req, res) => {
  const result = searchArticles(store.articles.filter((article) => article.status === 'published'), req.query, store.categories);
  res.json(result);
});

router.get('/trending', (req, res) => {
  res.json({
    items: getTrendingArticles(store.articles, new Date(), store.settings?.trendingWeights, store.engagementEvents),
    generatedAt: new Date().toISOString(),
    scoring: 'Views, engagement velocity, engagement rate, and recency; explanations use measured article metrics.',
  });
});

router.get('/recommendations', requireAuth, (req, res) => {
  const history = store.readingHistory.filter((item) => item.userId === req.user.id);
  const items = getRecommendationsForUser(req.user, store.articles, store.categories, history, 4, req.user.recommendationFeedback || []);
  res.json({ items, generatedBy: 'local interest and engagement ranking' });
});

router.post('/recommendations/feedback', requireAuth, asyncHandler(async (req, res) => {
  const { articleId, helpful } = req.body || {};
  if (typeof helpful !== 'boolean' || !store.articles.some((article) => article.id === articleId && article.status === 'published')) {
    return res.status(400).json({ message: 'A published article and boolean feedback value are required.' });
  }

  const feedback = req.user.recommendationFeedback || [];
  const existing = feedback.find((item) => item.articleId === articleId);
  if (existing) existing.helpful = helpful;
  else feedback.push({ articleId, helpful, createdAt: new Date().toISOString() });
  req.user.recommendationFeedback = feedback.slice(-100);
  await saveRecord('users', req.user);
  res.json({ saved: true });
}));

router.get('/categories', (req, res) => {
  res.json(store.categories.map((category) => ({
    ...category,
    articleCount: store.articles.filter((article) => article.status === 'published' && article.categoryIds?.includes(category.id)).length,
  })));
});

router.get('/categories/:id', (req, res) => {
  const category = store.categories.find((item) => item.id === req.params.id);
  if (!category) return res.status(404).json({ message: 'Category not found.' });
  res.json({
    ...category,
    articles: store.articles.filter((article) => article.status === 'published' && article.categoryIds?.includes(category.id)),
  });
});

router.post('/categories', requireAuth, authorize('admin'), [
  body('name').trim().isLength({ min: 2, max: 80 }),
  body('description').optional().trim().isLength({ max: 500 }),
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  const name = req.body.name.trim();
  if (store.categories.some((category) => category.name.toLowerCase() === name.toLowerCase())) {
    return res.status(409).json({ message: 'A category with this name already exists.' });
  }
  const category = { id: `category-${crypto.randomUUID()}`, name, description: req.body.description || '' };
  store.categories.push(category);
  await saveRecord('categories', category);
  await recordAudit({ actorId: req.user.id, action: 'category.create', targetType: 'category', targetId: category.id, outcome: name });
  res.status(201).json({ category });
}));

router.put('/categories/:id', requireAuth, authorize('admin'), [
  body('name').optional().trim().isLength({ min: 2, max: 80 }),
  body('description').optional().trim().isLength({ max: 500 }),
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  const category = store.categories.find((item) => item.id === req.params.id);
  if (!category) return res.status(404).json({ message: 'Category not found.' });
  if (req.body.name) category.name = req.body.name.trim();
  if (req.body.description !== undefined) category.description = req.body.description.trim();
  await saveRecord('categories', category);
  await recordAudit({ actorId: req.user.id, action: 'category.update', targetType: 'category', targetId: category.id, outcome: category.name });
  res.json({ category });
}));

router.delete('/categories/:id', requireAuth, authorize('admin'), asyncHandler(async (req, res) => {
  const category = store.categories.find((item) => item.id === req.params.id);
  if (!category) return res.status(404).json({ message: 'Category not found.' });
  if (store.articles.some((article) => (article.categoryIds || []).includes(category.id))) {
    return res.status(409).json({ message: 'Remove this category from its articles before deleting it.' });
  }
  const { deleteRecord } = require('../data/persistence');
  await deleteRecord('categories', category.id);
  store.categories = store.categories.filter((item) => item.id !== category.id);
  await recordAudit({ actorId: req.user.id, action: 'category.delete', targetType: 'category', targetId: category.id, outcome: 'deleted' });
  res.json({ deleted: true });
}));

router.get('/tags', (req, res) => {
  const counts = new Map();
  for (const article of store.articles.filter((item) => item.status === 'published')) {
    for (const tag of article.tags || []) counts.set(String(tag).trim(), (counts.get(String(tag).trim()) || 0) + 1);
  }
  res.json([...counts.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([name, articleCount]) => ({ name, articleCount })));
});

router.put('/tags/:tag', requireAuth, authorize('admin'), [
  body('name').trim().isLength({ min: 2, max: 50 }),
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  const from = req.params.tag.toLowerCase();
  const to = req.body.name.trim();
  for (const article of store.articles) {
    if ((article.tags || []).some((tag) => String(tag).toLowerCase() === from)) {
      article.tags = article.tags.map((tag) => String(tag).toLowerCase() === from ? to : tag);
      await saveRecord('articles', article);
    }
  }
  await recordAudit({ actorId: req.user.id, action: 'tag.rename', targetType: 'tag', targetId: req.params.tag, outcome: to });
  res.json({ name: to });
}));

router.delete('/tags/:tag', requireAuth, authorize('admin'), asyncHandler(async (req, res) => {
  const tag = req.params.tag.toLowerCase();
  for (const article of store.articles) {
    if ((article.tags || []).some((item) => String(item).toLowerCase() === tag)) {
      article.tags = article.tags.filter((item) => String(item).toLowerCase() !== tag);
      await saveRecord('articles', article);
    }
  }
  await recordAudit({ actorId: req.user.id, action: 'tag.delete', targetType: 'tag', targetId: req.params.tag, outcome: 'removed from articles' });
  res.json({ deleted: true });
}));

router.get('/authors', (req, res) => {
  const authors = store.users
    .filter((user) => ['author', 'admin'].includes(user.role) && user.status === 'active')
    .map((user) => ({
      ...visibleUser(user),
      stats: getAuthorStats(store.articles, user.id),
    }));
  res.json(authors);
});

router.get('/authors/:id', (req, res) => {
  const author = store.users.find((user) => user.id === req.params.id && ['author', 'admin'].includes(user.role));
  if (!author) return res.status(404).json({ message: 'Author not found.' });
  res.json({
    author: visibleUser(author),
    stats: getAuthorStats(store.articles, author.id),
    articles: store.articles.filter((article) => article.authorId === author.id && article.status === 'published'),
  });
});

router.get('/me/profile', requireAuth, (req, res) => {
  res.json({ user: ownUser(req.user) });
});

router.get('/me/analytics', requireAuth, (req, res) => {
  if (!['author', 'admin'].includes(req.user.role)) return res.status(403).json({ message: 'Author analytics are available to authors and admins.' });
  const rangeDays = Math.min(365, Math.max(1, Number(req.query.days) || 30));
  const since = new Date(Date.now() - rangeDays * 24 * 60 * 60 * 1000);
  res.json({ rangeDays, stats: getAuthorStats(store.articles, req.user.id, since, store.engagementEvents) });
});

router.put('/me/profile', requireAuth, [
  body('name').optional().trim().isLength({ min: 2, max: 80 }),
  body('bio').optional().trim().isLength({ max: 500 }),
  body('preferences').optional().isArray({ max: 20 }),
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const validCategoryIds = new Set(store.categories.map((category) => category.id));
  if (req.body.preferences?.some((id) => !validCategoryIds.has(id))) {
    return res.status(400).json({ message: 'Preferences must reference existing categories.' });
  }
  for (const field of ['name', 'bio', 'preferences']) {
    if (req.body[field] !== undefined) req.user[field] = req.body[field];
  }
  if (req.body.name) req.user.avatar = req.body.name.trim().slice(0, 2).toUpperCase();
  await saveRecord('users', req.user);
  res.json({ user: visibleUser(req.user) });
}));

router.get('/me/bookmarks', requireAuth, (req, res) => {
  const bookmarks = store.bookmarks.filter((item) => item.userId === req.user.id);
  const items = bookmarks
    .map((bookmark) => store.articles.find((article) => article.id === bookmark.articleId && article.status === 'published'))
    .filter(Boolean);
  res.json({ items });
});

router.get('/me/history', requireAuth, (req, res) => {
  const items = store.readingHistory
    .filter((entry) => entry.userId === req.user.id)
    .sort((a, b) => new Date(b.readAt) - new Date(a.readAt))
    .map((entry) => ({
      ...entry,
      article: store.articles.find((article) => article.id === entry.articleId && article.status === 'published'),
    }))
    .filter((entry) => entry.article);
  res.json({ items });
});

router.get('/me/reading-insights', requireAuth, (req, res) => {
  const history = store.readingHistory.filter((entry) => entry.userId === req.user.id);
  const articlesById = new Map(store.articles.map((article) => [article.id, article]));
  const visibleHistory = history.filter((entry) => articlesById.get(entry.articleId)?.status === 'published');
  const categories = new Map();

  for (const entry of visibleHistory) {
    const article = articlesById.get(entry.articleId);
    for (const categoryId of article.categoryIds || []) categories.set(categoryId, (categories.get(categoryId) || 0) + 1);
  }

  const timeline = [];
  for (let offset = 6; offset >= 0; offset -= 1) {
    const date = new Date();
    date.setUTCHours(0, 0, 0, 0);
    date.setUTCDate(date.getUTCDate() - offset);
    const key = date.toISOString().slice(0, 10);
    timeline.push({
      date: key,
      reads: visibleHistory.filter((entry) => String(entry.readAt).slice(0, 10) === key).length,
    });
  }

  const readMinutes = visibleHistory.reduce((total, entry) => {
    const article = articlesById.get(entry.articleId);
    const wordCount = String(article?.content || '').trim().split(/\s+/).filter(Boolean).length;
    return total + Math.ceil((wordCount * (entry.progress || 25) / 100) / 220);
  }, 0);

  res.json({
    articlesRead: visibleHistory.length,
    completed: visibleHistory.filter((entry) => entry.progress >= 80).length,
    estimatedMinutes: readMinutes,
    topCategories: [...categories.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([id, reads]) => ({ name: store.categories.find((category) => category.id === id)?.name || id, reads })),
    timeline,
  });
});

router.patch('/me/history/:articleId', requireAuth, [
  body('progress').isInt({ min: 0, max: 100 }),
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  const entry = store.readingHistory.find((item) => item.userId === req.user.id && item.articleId === req.params.articleId);
  if (!entry) return res.status(404).json({ message: 'Reading history entry not found.' });
  entry.progress = Number(req.body.progress);
  entry.readAt = new Date().toISOString();
  await saveRecord('readingHistory', entry);
  res.json({ entry });
}));

router.get('/me/notifications', requireAuth, (req, res) => {
  const items = store.notifications
    .filter((notification) => notification.userId === req.user.id)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json({ items, unreadCount: items.filter((item) => !item.read).length });
});

router.post('/notifications/:id/read', requireAuth, asyncHandler(async (req, res) => {
  const notification = store.notifications.find((item) => item.id === req.params.id);
  if (!notification) return res.status(404).json({ message: 'Notification not found.' });
  if (notification.userId !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ message: 'You cannot change this notification.' });
  notification.read = true;
  await saveRecord('notifications', notification);
  res.json({ notification });
}));

router.patch('/notifications/:id/read', requireAuth, asyncHandler(async (req, res) => {
  const notification = store.notifications.find((item) => item.id === req.params.id);
  if (!notification) return res.status(404).json({ message: 'Notification not found.' });
  if (notification.userId !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ message: 'You cannot change this notification.' });
  notification.read = true;
  await saveRecord('notifications', notification);
  res.json({ notification });
}));

router.post('/articles/:id/comments', requireAuth, [
  body('body').trim().isLength({ min: 2, max: 5000 }),
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  const article = store.articles.find((item) => item.id === req.params.id && item.status === 'published');
  if (!article) return res.status(404).json({ message: 'Article not found.' });
  const normalizedBody = req.body.body.trim().toLowerCase();
  const repeats = store.comments.filter((comment) =>
    comment.authorId === req.user.id &&
    comment.body.trim().toLowerCase() === normalizedBody &&
    Date.now() - new Date(comment.createdAt).getTime() < 24 * 60 * 60 * 1000
  );
  if (repeats.length) {
    await recordAbuse({ userId: req.user.id, type: 'repeated-comment', details: 'Repeated comment text submitted within 24 hours.', severity: 'low' });
    return res.status(429).json({ message: 'This comment was already submitted recently.' });
  }

  const comment = {
    id: `comment-${crypto.randomUUID()}`,
    articleId: article.id,
    authorId: req.user.id,
    body: req.body.body.trim(),
    status: 'published',
    moderation: moderateContent({ content: req.body.body }, store.settings?.moderationThresholds),
    createdAt: new Date().toISOString(),
  };
  if (comment.moderation.status !== 'approved') comment.status = 'pending';
  store.comments.push(comment);
  if (comment.status === 'published') article.comments = (article.comments || 0) + 1;
  await saveRecord('comments', comment);
  await saveRecord('articles', article);
  if (comment.status !== 'published') {
    await addNotification(article.authorId, 'moderation', 'A comment is waiting for review.');
  } else {
    const event = {
      id: `event-${crypto.randomUUID()}`,
      userId: req.user.id,
      articleId: article.id,
      type: 'comment',
      createdAt: comment.createdAt,
    };
    store.engagementEvents.push(event);
    await saveRecord('engagementEvents', event);
  }
  res.status(201).json({ comment });
}));

router.get('/articles/:id/comments', (req, res) => {
  const article = store.articles.find((item) => item.id === req.params.id && item.status === 'published');
  if (!article) return res.status(404).json({ message: 'Article not found.' });
  const comments = store.comments
    .filter((item) => item.articleId === article.id && item.status === 'published')
    .map((item) => ({ ...item, author: visibleUser(store.users.find((user) => user.id === item.authorId)) }));
  res.json({ items: comments });
});

router.post('/reports', requireAuth, [
  body('targetType').isIn(['article', 'comment', 'user']),
  body('targetId').trim().isLength({ min: 1, max: 120 }),
  body('reason').trim().isLength({ min: 3, max: 80 }),
  body('details').optional().trim().isLength({ max: 2000 }),
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  const { targetType, targetId, reason } = req.body;
  const targetExists = targetType === 'article'
    ? store.articles.some((item) => item.id === targetId)
    : targetType === 'comment'
      ? store.comments.some((item) => item.id === targetId)
      : store.users.some((item) => item.id === targetId);
  if (!targetExists) return res.status(404).json({ message: 'Reported item not found.' });

  const duplicate = store.reports.find((report) =>
    report.reporterId === req.user.id && report.targetType === targetType &&
    report.targetId === targetId && report.status === 'open'
  );
  if (duplicate) return res.status(409).json({ message: 'You already have an open report for this item.' });

  const report = {
    id: `report-${crypto.randomUUID()}`,
    reporterId: req.user.id,
    targetType,
    targetId,
    reason,
    details: req.body.details || '',
    status: 'open',
    createdAt: new Date().toISOString(),
  };
  store.reports.push(report);
  await saveRecord('reports', report);
  await recordAudit({ actorId: req.user.id, action: 'report.create', targetType, targetId, reason, outcome: 'open' });
  res.status(201).json({ report });
}));

router.post('/appeals', requireAuth, [
  body('articleId').trim().isLength({ min: 1, max: 120 }),
  body('reason').trim().isLength({ min: 5, max: 2000 }),
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  const article = store.articles.find((item) => item.id === req.body.articleId && item.authorId === req.user.id);
  if (!article) return res.status(404).json({ message: 'Your article was not found.' });
  if (!['quarantined', 'pending'].includes(article.status)) {
    return res.status(409).json({ message: 'Only articles awaiting moderation can be appealed.' });
  }
  const duplicate = store.appeals.find((item) => item.articleId === article.id && item.authorId === req.user.id && item.status === 'open');
  if (duplicate) return res.status(409).json({ message: 'An appeal is already open for this article.' });

  const appeal = {
    id: `appeal-${crypto.randomUUID()}`,
    articleId: article.id,
    authorId: req.user.id,
    reason: req.body.reason.trim(),
    status: 'open',
    decision: '',
    createdAt: new Date().toISOString(),
  };
  store.appeals.push(appeal);
  await saveRecord('appeals', appeal);
  await addNotification(store.users.find((user) => user.role === 'admin')?.id, 'moderation', 'A new article appeal needs review.');
  await recordAudit({ actorId: req.user.id, action: 'appeal.create', targetType: 'article', targetId: article.id, reason: appeal.reason, outcome: 'open' });
  res.status(201).json({ appeal });
}));

router.get('/me/freshness', requireAuth, (req, res) => {
  const items = store.freshnessAlerts
    .filter((alert) => alert.authorId === req.user.id || req.user.role === 'admin')
    .map((alert) => ({ ...alert, title: store.articles.find((article) => article.id === alert.articleId)?.title || 'Article unavailable' }));
  res.json({ items });
});

router.post('/freshness/check', requireAuth, asyncHandler(async (req, res) => {
  const articles = store.articles.filter((article) =>
    article.status === 'published' && (article.authorId === req.user.id || req.user.role === 'admin')
  );
  const alerts = [];
  const urlsToCheck = [];

  for (const article of articles) {
    const ageDays = Math.floor((Date.now() - new Date(article.updatedAt || article.publishedAt || article.createdAt).getTime()) / (24 * 60 * 60 * 1000));
    if (ageDays >= 180 && !store.freshnessAlerts.some((alert) => alert.articleId === article.id && alert.status === 'open')) {
      const alert = {
        id: `freshness-${crypto.randomUUID()}`,
        articleId: article.id,
        authorId: article.authorId,
        status: 'open',
        reason: `This article has not been updated for ${ageDays} days.`,
        createdAt: new Date().toISOString(),
      };
      store.freshnessAlerts.push(alert);
      await saveRecord('freshnessAlerts', alert);
      alerts.push(alert);
      await addNotification(article.authorId, 'freshness', `Freshness review needed: ${article.title}`);
    }

    const urls = String(article.content || '').match(/https?:\/\/[^\s<>"')\]]+/g) || [];
    for (const url of [...new Set(urls)].slice(0, 10)) {
      urlsToCheck.push({ articleId: article.id, url });
    }
  }

  const linkChecks = [];
  for (const item of urlsToCheck.slice(0, 20)) {
    linkChecks.push({ articleId: item.articleId, ...(await checkExternalLink(item.url)) });
  }

  await recordAudit({ actorId: req.user.id, action: 'freshness.check', targetType: 'article', reason: 'Manual freshness and public-link check', outcome: `${alerts.length} alerts, ${linkChecks.length} links checked` });
  res.json({ alerts, linkChecks, checkedAt: new Date().toISOString() });
}));

module.exports = router;
