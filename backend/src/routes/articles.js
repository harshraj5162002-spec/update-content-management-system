const crypto = require('node:crypto');
const express = require('express');
const { body, validationResult } = require('express-validator');
const { store } = require('../data/store');
const { saveRecord, deleteRecord, deleteByArticleId } = require('../data/persistence');
const { requireAuth, authorize } = require('../middleware/auth');
const { moderateContent, suggestImprovements } = require('../services/aiService');
const { getArticleSummary } = require('../services/articleInsights');
const {
  DEFAULT_TRENDING_WEIGHTS,
  getTrendingArticles,
  getRecommendationsForUser,
  getTopicSnapshot,
  getAuthorStats,
  getRelatedArticles,
  searchArticles,
} = require('../services/analytics');
const { recordAudit } = require('../services/audit');
const { asyncHandler } = require('../middleware/asyncHandler');
const { recordAbuse } = require('../services/trust');
const { isValidQuiz, normalizeQuiz } = require('../services/quiz');
const { serializePublicArticle, serializePublicUser } = require('../services/articleSerialization');

const router = express.Router();
function existingCategories(ids) {
  return ids.every((id) => typeof id === 'string' && store.categories.some((category) => category.id === id));
}

const articleStatuses = new Set(['draft', 'pending', 'published', 'quarantined', 'archived', 'rejected', 'changes_requested']);

function canViewPrivateArticle(user, article) {
  return Boolean(user && (user.role === 'admin' || user.id === article.authorId));
}

function updateArticleFields(article, body) {
  if (body.title !== undefined) article.title = body.title;
  if (body.summary !== undefined) article.summary = body.summary;
  if (body.content !== undefined) article.content = body.content;
  if (body.categoryIds !== undefined) article.categoryIds = body.categoryIds;
  if (body.tags !== undefined) article.tags = body.tags.map((tag) => String(tag).trim()).filter(Boolean);
  if (body.coverImage !== undefined) article.coverImage = body.coverImage;
  if (body.quiz !== undefined) article.quiz = normalizeQuiz(body.quiz);
}

function refreshArticleModeration(article) {
  article.moderation = moderateContent(article, store.settings?.moderationThresholds);
  article.updatedAt = new Date().toISOString();
}

const articleDependentCollections = ['comments', 'bookmarks', 'readingHistory', 'freshnessAlerts', 'engagementEvents'];
const MAX_ARTICLE_REVISIONS = 20;

function getRevisionSnapshot(article) {
  return {
    title: article.title,
    summary: article.summary || '',
    content: article.content,
    categoryIds: [...(article.categoryIds || [])],
    tags: [...(article.tags || [])],
    coverImage: article.coverImage || '',
    quiz: article.quiz ? structuredClone(article.quiz) : null,
  };
}

async function recordArticleRevision(article, source, restoredFromVersion) {
  const revisions = store.articleRevisions
    .filter((revision) => revision.articleId === article.id)
    .sort((left, right) => left.version - right.version);
  const snapshot = getRevisionSnapshot(article);
  const latest = revisions[revisions.length - 1];
  if (latest && JSON.stringify(getRevisionSnapshot(latest)) === JSON.stringify(snapshot)) return latest;

  const revision = {
    id: `revision-${crypto.randomUUID()}`,
    articleId: article.id,
    authorId: article.authorId,
    version: (revisions[revisions.length - 1]?.version || 0) + 1,
    ...snapshot,
    source,
    ...(restoredFromVersion ? { restoredFromVersion } : {}),
    createdAt: new Date().toISOString(),
  };
  store.articleRevisions.push(revision);
  await saveRecord('articleRevisions', revision);

  while (revisions.length >= MAX_ARTICLE_REVISIONS) {
    const oldest = revisions.shift();
    store.articleRevisions = store.articleRevisions.filter((item) => item.id !== oldest.id);
    await deleteRecord('articleRevisions', oldest.id);
  }
  return revision;
}

async function removeArticleDependents(articleId) {
  for (const collection of [...articleDependentCollections, 'articleRevisions']) {
    store[collection] = store[collection].filter((item) => item.articleId !== articleId);
    await deleteByArticleId(collection, articleId);
  }
}

function getVisibleArticles(user) {
  return store.articles.filter((article) =>
    article.status === 'published' || canViewPrivateArticle(user, article)
  );
}

router.get('/', (req, res) => {
  const { status, authorId, categoryId, tag, q, sort, page, limit } = req.query;
  let articles = getVisibleArticles(req.user);

  if (status) {
    if (!articleStatuses.has(String(status))) {
      return res.status(400).json({ message: 'Unsupported article status.' });
    }
    articles = articles.filter((article) => article.status === status);
  }

  if (authorId) articles = articles.filter((article) => article.authorId === authorId);
  if (categoryId) articles = articles.filter((article) => (article.categoryIds || []).includes(categoryId));

  if (q || tag || sort) {
    const result = searchArticles(articles, { q, categoryId, tag, sort, page, limit }, store.categories);
    return res.json({
      ...result,
      items: result.items.map((article) => canViewPrivateArticle(req.user, article) ? article : serializePublicArticle(article)),
    });
  }

  const safePage = Math.max(1, Math.floor(Number(page) || 1));
  const safeLimit = Math.min(50, Math.max(1, Math.floor(Number(limit) || 12)));
  articles.sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt));
  res.json({
    items: articles.slice((safePage - 1) * safeLimit, safePage * safeLimit)
      .map((article) => canViewPrivateArticle(req.user, article) ? article : serializePublicArticle(article)),
    count: articles.length,
    page: safePage,
    pages: Math.ceil(articles.length / safeLimit),
  });
});

router.get('/home', (req, res) => {
  const published = store.articles.filter((article) => article.status === 'published');
  const history = req.user ? store.readingHistory.filter((item) => item.userId === req.user.id) : [];
  const weights = store.settings?.trendingWeights || DEFAULT_TRENDING_WEIGHTS;
  const trending = getTrendingArticles(published, new Date(), weights, store.engagementEvents);

  res.json({
    featured: published.slice(0, 3).map(serializePublicArticle),
    trending: trending.map(serializePublicArticle),
    recommendations: getRecommendationsForUser(req.user || null, published, store.categories, history, 4, req.user?.recommendationFeedback || []).map(serializePublicArticle),
    categories: store.categories,
    topics: getTopicSnapshot(published, store.categories),
  });
});

router.get('/:id/analytics', requireAuth, (req, res) => {
  const article = store.articles.find((item) => item.id === req.params.id);
  if (!article) return res.status(404).json({ message: 'Article not found.' });
  if (!canViewPrivateArticle(req.user, article)) {
    return res.status(403).json({ message: 'Private analytics are not available to this user.' });
  }

  const rangeDays = Math.min(365, Math.max(1, Number(req.query.days) || 30));
  const since = new Date(Date.now() - rangeDays * 24 * 60 * 60 * 1000);
  res.json({
    articleId: article.id,
    rangeDays,
    stats: {
      views: article.views || 0,
      likes: article.likes || 0,
      shares: article.shares || 0,
      comments: article.comments || 0,
      engagementRate: Number((((article.likes || 0) + (article.shares || 0) + (article.comments || 0)) / Math.max(1, article.views || 0) * 100).toFixed(2)),
    },
    authorStats: getAuthorStats(store.articles, article.authorId, since, store.engagementEvents),
  });
});

router.get('/:id/revisions', requireAuth, authorize('author', 'admin'), (req, res) => {
  const article = store.articles.find((item) => item.id === req.params.id);
  if (!article) return res.status(404).json({ message: 'Article not found.' });
  if (!canViewPrivateArticle(req.user, article)) return res.status(403).json({ message: 'You are not allowed to view this article history.' });
  const items = store.articleRevisions
    .filter((revision) => revision.articleId === article.id)
    .sort((left, right) => right.version - left.version);
  res.json({ items });
});

router.get('/:id', (req, res) => {
  const article = store.articles.find((item) => item.id === req.params.id);
  if (!article) return res.status(404).json({ message: 'Article not found.' });
  if (article.status !== 'published' && !canViewPrivateArticle(req.user, article)) {
    return res.status(404).json({ message: 'Article not found.' });
  }

  if (article.status === 'published') {
    const viewerId = req.user?.id || `anon:${req.ip}`;
    const recentView = store.engagementEvents.find((event) =>
      event.articleId === article.id &&
      event.type === 'view' &&
      event.userId === viewerId &&
      Date.now() - new Date(event.createdAt).getTime() < 24 * 60 * 60 * 1000
    );

    if (!recentView) {
      article.views = (article.views || 0) + 1;
      const event = {
        id: `event-${crypto.randomUUID()}`,
        userId: viewerId,
        articleId: article.id,
        type: 'view',
        createdAt: new Date().toISOString(),
      };
      store.engagementEvents.push(event);
      saveRecord('articles', article).catch((error) => console.error('Failed to save article view:', error));
      saveRecord('engagementEvents', event).catch((error) => console.error('Failed to save engagement event:', error));

      if (req.user) {
        const history = store.readingHistory.find((item) => item.userId === req.user.id && item.articleId === article.id);
        if (history) {
          history.readAt = event.createdAt;
          saveRecord('readingHistory', history).catch((error) => console.error('Failed to save reading history:', error));
        } else {
          const record = { id: `history-${crypto.randomUUID()}`, userId: req.user.id, articleId: article.id, readAt: event.createdAt, progress: 0 };
          store.readingHistory.push(record);
          saveRecord('readingHistory', record).catch((error) => console.error('Failed to save reading history:', error));
        }
      }
    }
  }

  const author = serializePublicUser(store.users.find((user) => user.id === article.authorId));
  const recommendations = getRelatedArticles(article, store.articles);
  res.json({
    ...(canViewPrivateArticle(req.user, article) ? article : serializePublicArticle(article)),
    author,
    aiInsights: getArticleSummary(article),
    suggestions: canViewPrivateArticle(req.user, article) ? suggestImprovements(article) : [],
    related: recommendations.map(serializePublicArticle),
    recommendationReasons: recommendations.map(({ id, relatedReasons }) => ({ articleId: id, reasons: relatedReasons })),
  });
});

router.post('/:id/quiz/attempt', (req, res) => {
  const article = store.articles.find((item) => item.id === req.params.id && item.status === 'published');
  if (!article) return res.status(404).json({ message: 'Article not found.' });
  if (!article.quiz?.questions?.length) return res.status(404).json({ message: 'This article does not have a quiz.' });

  const { answers } = req.body || {};
  if (
    !Array.isArray(answers) ||
    answers.length !== article.quiz.questions.length ||
    answers.some((answer, index) =>
      !Number.isInteger(answer) || answer < 0 || answer >= article.quiz.questions[index].options.length
    )
  ) {
    return res.status(400).json({ message: 'Select one valid option for every quiz question.' });
  }

  const results = article.quiz.questions.map((question, index) => ({
    selectedOptionIndex: answers[index],
    correctOptionIndex: question.correctOptionIndex,
    isCorrect: answers[index] === question.correctOptionIndex,
  }));
  const score = results.filter((result) => result.isCorrect).length;
  res.json({ score, total: results.length, results });
});

router.post(
  '/',
  requireAuth,
  authorize('author', 'admin'),
  [
    body('title').trim().isLength({ min: 4, max: 180 }).withMessage('Article title must be between 4 and 180 characters.'),
    body('content').trim().isLength({ min: 30, max: 100000 }).withMessage('Content should be between 30 and 100000 characters.'),
    body('summary').optional().isString().isLength({ max: 500 }),
    body('tags').optional().isArray({ max: 20 }),
    body('tags.*').optional().isString().isLength({ max: 50 }).withMessage('Each tag can contain at most 50 characters.'),
    body('categoryIds').optional().isArray({ max: 10 }).custom(existingCategories).withMessage('Choose existing categories.'),
    body('coverImage').optional({ checkFalsy: true }).isURL({ protocols: ['http', 'https'], require_protocol: true }).withMessage('Cover image must be a valid http(s) URL.'),
    body('quiz').optional({ nullable: true }).custom(isValidQuiz).withMessage('Quiz must contain 1-20 questions, each with 2-6 options and a valid correct answer.'),
  ],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    const recentArticles = store.articles.filter((article) =>
      article.authorId === req.user.id && new Date(article.createdAt).getTime() >= oneHourAgo
    );
    if (recentArticles.length >= 10) {
      await recordAbuse({ userId: req.user.id, type: 'article-frequency', details: 'More than 10 article drafts created in one hour.', severity: 'medium' });
      return res.status(429).json({ message: 'Article creation limit reached. Try again later.' });
    }
    const repeated = store.articles.find((article) =>
      article.authorId === req.user.id &&
      article.title.trim().toLowerCase() === req.body.title.trim().toLowerCase() &&
      Date.now() - new Date(article.createdAt).getTime() < 7 * 24 * 60 * 60 * 1000
    );
    if (repeated) {
      await recordAbuse({ userId: req.user.id, type: 'repeated-article', details: `Repeated article title: ${req.body.title}`, severity: 'low' });
      return res.status(409).json({ message: 'You already have an article with this title.' });
    }

    const moderation = moderateContent(req.body, store.settings?.moderationThresholds);
    const now = new Date().toISOString();
    const article = {
      id: `a-${crypto.randomUUID()}`,
      title: req.body.title.trim(),
      summary: req.body.summary?.trim() || '',
      content: req.body.content.trim(),
      categoryIds: req.body.categoryIds || [],
      tags: (req.body.tags || []).map((tag) => String(tag).trim()).filter(Boolean),
      authorId: req.user.id,
      status: 'draft',
      coverImage: req.body.coverImage || '',
      quiz: normalizeQuiz(req.body.quiz),
      views: 0,
      likes: 0,
      shares: 0,
      comments: 0,
      createdAt: now,
      updatedAt: now,
      moderation,
    };

    store.articles.push(article);
    await saveRecord('articles', article);
    await recordAudit({ actorId: req.user.id, action: 'article.create', targetType: 'article', targetId: article.id, outcome: moderation.status });
    res.status(201).json({ article });
  })
);

router.post('/:id/submit', requireAuth, authorize('author', 'admin'), asyncHandler(async (req, res) => {
  const article = store.articles.find((item) => item.id === req.params.id);
  if (!article) return res.status(404).json({ message: 'Article not found.' });
  if (!canViewPrivateArticle(req.user, article)) return res.status(403).json({ message: 'You can only submit your own content.' });
  if (!['draft', 'quarantined', 'rejected', 'changes_requested'].includes(article.status)) {
    return res.status(409).json({ message: 'Only drafts and reviewable articles can be submitted.' });
  }

  const duplicate = store.articles.find((candidate) =>
    candidate.id !== article.id &&
    candidate.status !== 'archived' &&
    candidate.title.trim().toLowerCase() === article.title.trim().toLowerCase()
  );
  if (duplicate) return res.status(409).json({ message: 'An article with this title already exists.', duplicateId: duplicate.id });

  article.moderation = moderateContent(article, store.settings?.moderationThresholds);
  delete article.aiSummaryCache;
  article.status = article.moderation.status === 'quarantined' ? 'quarantined' : 'pending';
  article.updatedAt = new Date().toISOString();
  article.review = { submittedAt: article.updatedAt };
  await saveRecord('articles', article);
  await recordArticleRevision(article, 'submission');
  await recordAudit({ actorId: req.user.id, action: 'article.submit', targetType: 'article', targetId: article.id, reason: article.moderation.reasons.join('; '), outcome: article.status });
  res.json({ article, moderation: article.moderation });
}));

router.post('/:id/revisions/:revisionId/restore', requireAuth, authorize('author', 'admin'), asyncHandler(async (req, res) => {
  const article = store.articles.find((item) => item.id === req.params.id);
  if (!article) return res.status(404).json({ message: 'Article not found.' });
  if (!canViewPrivateArticle(req.user, article)) return res.status(403).json({ message: 'You are not allowed to restore this article history.' });
  const revision = store.articleRevisions.find((item) =>
    item.id === req.params.revisionId && item.articleId === article.id
  );
  if (!revision) return res.status(404).json({ message: 'Article revision not found.' });

  const restoredFromVersion = revision.version;
  Object.assign(article, getRevisionSnapshot(revision));
  article.updatedAt = new Date().toISOString();
  article.review = { submittedAt: article.updatedAt, restoredFromVersion };
  article.moderation = moderateContent(article, store.settings?.moderationThresholds);
  article.status = article.moderation.status === 'quarantined' ? 'quarantined' : 'pending';
  delete article.publishedAt;
  await saveRecord('articles', article);
  const restoredRevision = await recordArticleRevision(article, 'restore', restoredFromVersion);
  await recordAudit({ actorId: req.user.id, action: 'article.revision.restore', targetType: 'article', targetId: article.id, outcome: `revision ${restoredFromVersion}` });
  res.json({ article, revision: restoredRevision });
}));

router.put('/:id/autosave', requireAuth, authorize('author', 'admin'), [
  body('title').optional().trim().isLength({ min: 4, max: 180 }),
  body('content').optional().trim().isLength({ min: 30, max: 100000 }),
  body('summary').optional().isString().isLength({ max: 500 }),
  body('tags').optional().isArray({ max: 20 }),
  body('tags.*').optional().isString().isLength({ max: 50 }).withMessage('Each tag can contain at most 50 characters.'),
  body('categoryIds').optional().isArray({ max: 10 }).custom(existingCategories).withMessage('Choose existing categories.'),
  body('coverImage').optional({ checkFalsy: true }).isURL({ protocols: ['http', 'https'], require_protocol: true }).withMessage('Cover image must be a valid http(s) URL.'),
  body('quiz').optional({ nullable: true }).custom(isValidQuiz).withMessage('Quiz must contain 1-20 questions, each with 2-6 options and a valid correct answer.'),
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  if (req.body.status !== undefined) return res.status(400).json({ message: 'Autosave cannot change article status.' });

  const article = store.articles.find((item) => item.id === req.params.id);
  if (!article) return res.status(404).json({ message: 'Article not found.' });
  if (!canViewPrivateArticle(req.user, article)) return res.status(403).json({ message: 'You can only autosave your own content.' });
  if (!['draft', 'quarantined', 'rejected', 'changes_requested'].includes(article.status)) {
    return res.status(409).json({ message: 'Only drafts and returned articles can be autosaved.' });
  }

  updateArticleFields(article, req.body);
  refreshArticleModeration(article);
  await saveRecord('articles', article);
  res.json({ article });
}));

router.put('/:id', requireAuth, authorize('author', 'admin'), (req, res, next) => {
  const article = store.articles.find((item) => item.id === req.params.id);
  if (!article) return res.status(404).json({ message: 'Article not found.' });
  if (!canViewPrivateArticle(req.user, article)) return res.status(403).json({ message: 'You can only edit your own content.' });
  if (req.body.status && req.user.role !== 'admin') {
    return res.status(403).json({ message: 'Use the submit action to change article workflow status.' });
  }
  if (req.body.status === 'published' && article.authorId === req.user.id) {
    return res.status(403).json({ message: 'You cannot publish your own article. Another administrator must approve it.' });
  }
  return next();
}, [
  body('title').optional().trim().isLength({ min: 4, max: 180 }),
  body('content').optional().trim().isLength({ min: 30, max: 100000 }),
  body('summary').optional().isString().isLength({ max: 500 }),
  body('tags').optional().isArray({ max: 20 }),
  body('tags.*').optional().isString().isLength({ max: 50 }).withMessage('Each tag can contain at most 50 characters.'),
  body('categoryIds').optional().isArray({ max: 10 }).custom(existingCategories).withMessage('Choose existing categories.'),
  body('coverImage').optional({ checkFalsy: true }).isURL({ protocols: ['http', 'https'], require_protocol: true }).withMessage('Cover image must be a valid http(s) URL.'),
  body('quiz').optional({ nullable: true }).custom(isValidQuiz).withMessage('Quiz must contain 1-20 questions, each with 2-6 options and a valid correct answer.'),
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const article = store.articles.find((item) => item.id === req.params.id);
  updateArticleFields(article, req.body);
  if (req.body.status && req.user.role === 'admin' && articleStatuses.has(req.body.status)) article.status = req.body.status;
  if (article.status === 'published' && !article.publishedAt) article.publishedAt = new Date().toISOString();
  if (req.user.role !== 'admin' && article.status === 'published') {
    article.status = 'pending';
    article.review = { ...(article.review || {}), submittedAt: new Date().toISOString() };
    delete article.publishedAt;
  }
  refreshArticleModeration(article);
  await saveRecord('articles', article);
  await recordAudit({ actorId: req.user.id, action: 'article.update', targetType: 'article', targetId: article.id, outcome: article.status });
  res.json({ article });
}));

router.delete('/:id', requireAuth, authorize('author', 'admin'), asyncHandler(async (req, res) => {
  const article = store.articles.find((item) => item.id === req.params.id);
  if (!article) return res.status(404).json({ message: 'Article not found.' });
  if (!canViewPrivateArticle(req.user, article)) return res.status(403).json({ message: 'You are not allowed to delete this article.' });

  await deleteRecord('articles', article.id);
  store.articles = store.articles.filter((item) => item.id !== article.id);
  await removeArticleDependents(article.id);
  await recordAudit({ actorId: req.user.id, action: 'article.delete', targetType: 'article', targetId: article.id, outcome: 'deleted' });
  res.json({ message: 'Article removed.' });
}));

router.post('/:id/engagement', requireAuth, asyncHandler(async (req, res) => {
  const article = store.articles.find((item) => item.id === req.params.id && item.status === 'published');
  if (!article) return res.status(404).json({ message: 'Article not found.' });

  const { type } = req.body || {};
  if (!['like', 'share', 'bookmark'].includes(type)) return res.status(400).json({ message: 'Unsupported engagement type.' });
  const duplicate = store.engagementEvents.find((event) =>
    event.userId === req.user.id && event.articleId === article.id && event.type === type
  );

  if (type === 'share' && duplicate) {
    // A user's share counts once per article so the counter cannot be inflated by repeated clicks.
    return res.json({ active: true, article });
  }

  if (type === 'like' || type === 'bookmark') {
    if (duplicate) {
      store.engagementEvents = store.engagementEvents.filter((event) => event.id !== duplicate.id);
      await deleteRecord('engagementEvents', duplicate.id);
      if (type === 'like') article.likes = Math.max(0, article.likes - 1);
      else {
        const bookmark = store.bookmarks.find((item) => item.userId === req.user.id && item.articleId === article.id);
        store.bookmarks = store.bookmarks.filter((item) => item.userId !== req.user.id || item.articleId !== article.id);
        if (bookmark) await deleteRecord('bookmarks', bookmark.id);
      }
      await saveRecord('articles', article);
      return res.json({ active: false, article });
    }
  }

  const event = {
    id: `event-${crypto.randomUUID()}`,
    userId: req.user.id,
    articleId: article.id,
    type,
    createdAt: new Date().toISOString(),
  };
  store.engagementEvents.push(event);
  await saveRecord('engagementEvents', event);
  if (type === 'like') article.likes = (article.likes || 0) + 1;
  if (type === 'share') article.shares = (article.shares || 0) + 1;
  if (type === 'bookmark') {
    const bookmark = { id: `bookmark-${crypto.randomUUID()}`, userId: req.user.id, articleId: article.id, createdAt: event.createdAt };
    store.bookmarks.push(bookmark);
    await saveRecord('bookmarks', bookmark);
  }
  await saveRecord('articles', article);
  res.json({ active: true, article });
}));

module.exports = router;
