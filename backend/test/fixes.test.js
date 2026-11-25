const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { store } = require('../src/data/store');
const authRoutes = require('../src/routes/auth');
const articleRoutes = require('../src/routes/articles');
const communityRoutes = require('../src/routes/community');
const moderationRoutes = require('../src/routes/moderation');
const { optionalAuth, signToken } = require('../src/middleware/auth');

const mutableCollections = [
  'users', 'articles', 'comments', 'bookmarks', 'readingHistory', 'engagementEvents',
  'notifications', 'auditLogs', 'reputationEvents', 'freshnessAlerts', 'moderationResults',
];

async function withServer(run) {
  const snapshot = Object.fromEntries(mutableCollections.map((name) => [name, structuredClone(store[name])]));
  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRoutes);
  app.use('/api/articles', optionalAuth, articleRoutes);
  app.use('/api/moderation', moderationRoutes);
  app.use('/api', communityRoutes);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}/api`;

  async function request(path, { method = 'GET', token, body } = {}) {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, payload: await response.json().catch(() => ({})) };
  }

  const tokens = {
    admin: signToken(store.users.find((user) => user.id === 'u-admin')),
    author: signToken(store.users.find((user) => user.id === 'u-author')),
    reader: signToken(store.users.find((user) => user.id === 'u-reader')),
  };

  try {
    await run({ request, tokens });
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    for (const name of mutableCollections) store[name] = snapshot[name];
  }
}

const baseArticle = {
  title: 'Regression test article',
  summary: 'Used by regression tests.',
  content: 'This is a regression test article body with enough characters to be valid.',
  tags: [],
  categoryIds: [],
  views: 0,
  likes: 0,
  shares: 0,
  comments: 0,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  moderation: { riskScore: 4, status: 'approved', reasons: [] },
};

test('category detail never exposes quiz answers', async () => {
  await withServer(async ({ request }) => {
    store.articles.push({
      ...baseArticle,
      id: 'a-quiz',
      authorId: 'u-author',
      status: 'published',
      publishedAt: new Date().toISOString(),
      categoryIds: ['ai'],
      quiz: { questions: [{ prompt: 'Pick the right one?', options: ['One', 'Two'], correctOptionIndex: 1 }] },
    });
    const response = await request('/categories/ai');
    assert.equal(response.status, 200);
    const article = response.payload.articles.find((item) => item.id === 'a-quiz');
    assert.ok(article);
    assert.equal('correctOptionIndex' in article.quiz.questions[0], false);
  });
});

test('admins can approve, reject and remove comments; others cannot', async () => {
  await withServer(async ({ request, tokens }) => {
    const article = store.articles.find((item) => item.id === 'a-1');
    const before = article.comments;
    store.comments.push(
      { id: 'c-pending', articleId: 'a-1', authorId: 'u-reader', body: 'Pending comment', status: 'pending', createdAt: new Date().toISOString() },
      { id: 'c-reject', articleId: 'a-1', authorId: 'u-reader', body: 'Rejected comment', status: 'pending', createdAt: new Date().toISOString() },
    );

    const listed = await request('/moderation/comments', { token: tokens.admin });
    assert.equal(listed.status, 200);
    assert.ok(listed.payload.items.some((item) => item.id === 'c-pending'));
    assert.equal((await request('/moderation/comments', { token: tokens.reader })).status, 403);
    assert.equal((await request('/moderation/comments/c-pending', { method: 'PATCH', token: tokens.reader, body: { decision: 'approve' } })).status, 403);

    const approved = await request('/moderation/comments/c-pending', { method: 'PATCH', token: tokens.admin, body: { decision: 'approve' } });
    assert.equal(approved.status, 200);
    assert.equal(approved.payload.comment.status, 'published');
    assert.equal(article.comments, before + 1);
    assert.equal((await request('/moderation/comments/c-pending', { method: 'PATCH', token: tokens.admin, body: { decision: 'approve' } })).status, 409);

    const removed = await request('/moderation/comments/c-pending', { method: 'PATCH', token: tokens.admin, body: { decision: 'remove' } });
    assert.equal(removed.status, 200);
    assert.equal(removed.payload.comment.status, 'removed');
    assert.equal(article.comments, before);

    const rejected = await request('/moderation/comments/c-reject', { method: 'PATCH', token: tokens.admin, body: { decision: 'reject' } });
    assert.equal(rejected.status, 200);
    assert.equal(rejected.payload.comment.status, 'rejected');
    assert.equal(article.comments, before);
  });
});

test('an admin cannot publish their own article through the edit endpoint', async () => {
  await withServer(async ({ request, tokens }) => {
    store.articles.push({ ...baseArticle, id: 'a-admin-own', authorId: 'u-admin', status: 'pending' });
    const response = await request('/articles/a-admin-own', { method: 'PUT', token: tokens.admin, body: { status: 'published' } });
    assert.equal(response.status, 403);
    assert.equal(store.articles.find((item) => item.id === 'a-admin-own').status, 'pending');
  });
});

test('a user share counts once per article', async () => {
  await withServer(async ({ request, tokens }) => {
    const article = store.articles.find((item) => item.id === 'a-1');
    const before = article.shares;
    assert.equal((await request('/articles/a-1/engagement', { method: 'POST', token: tokens.reader, body: { type: 'share' } })).status, 200);
    assert.equal((await request('/articles/a-1/engagement', { method: 'POST', token: tokens.reader, body: { type: 'share' } })).status, 200);
    assert.equal(article.shares, before + 1);
  });
});

test('the same reputation reason is rejected twice on one day', async () => {
  await withServer(async ({ request, tokens }) => {
    const body = { delta: 1, reason: 'Helpful contribution' };
    assert.equal((await request('/moderation/users/u-reader/reputation', { method: 'POST', token: tokens.admin, body })).status, 200);
    assert.equal((await request('/moderation/users/u-reader/reputation', { method: 'POST', token: tokens.admin, body })).status, 409);
  });
});

test('deleting an article removes its comments, bookmarks, history and engagement', async () => {
  await withServer(async ({ request, tokens }) => {
    store.articles.push({ ...baseArticle, id: 'a-delete', authorId: 'u-author', status: 'draft' });
    store.comments.push({ id: 'c-delete', articleId: 'a-delete', authorId: 'u-reader', body: 'Comment', status: 'published', createdAt: new Date().toISOString() });
    store.bookmarks.push({ id: 'b-delete', userId: 'u-reader', articleId: 'a-delete', createdAt: new Date().toISOString() });
    store.readingHistory.push({ id: 'h-delete', userId: 'u-reader', articleId: 'a-delete', readAt: new Date().toISOString(), progress: 10 });
    store.engagementEvents.push({ id: 'e-delete', userId: 'u-reader', articleId: 'a-delete', type: 'view', createdAt: new Date().toISOString() });

    const response = await request('/articles/a-delete', { method: 'DELETE', token: tokens.author });
    assert.equal(response.status, 200);
    for (const name of ['comments', 'bookmarks', 'readingHistory', 'engagementEvents']) {
      assert.equal(store[name].some((item) => item.articleId === 'a-delete'), false, `${name} still references the deleted article`);
    }
  });
});

test('failed logins are rate limited without exhausting the password-reset or OAuth limits', async () => {
  await withServer(async ({ request }) => {
    const attempt = () => request('/auth/login', { method: 'POST', body: { email: 'nobody@example.com', password: 'WrongPass123!', role: 'reader' } });
    for (let count = 0; count < 20; count += 1) assert.equal((await attempt()).status, 401);
    assert.equal((await attempt()).status, 429);

    assert.notEqual((await request('/auth/password-reset/request', { method: 'POST', body: { email: 'nobody@example.com' } })).status, 429);
    assert.notEqual((await request('/auth/oauth/google?role=reader')).status, 429);
  });
});

test('public article responses hide the author email, reviewer notes and private moderation data', async () => {
  await withServer(async ({ request }) => {
    const article = store.articles.find((item) => item.id === 'a-1');
    article.review = { reviewerId: 'u-admin', feedback: 'Internal reviewer note' };
    article.moderation = { ...article.moderation, reasons: ['internal reason'], overriddenBy: 'u-admin' };

    const response = await request('/articles/a-1');
    assert.equal(response.status, 200);
    assert.equal('email' in response.payload.author, false);
    assert.equal('preferences' in response.payload.author, false);
    assert.equal('reputation' in response.payload.author, false);
    assert.equal('review' in response.payload, false);
    assert.equal('aiSummaryCache' in response.payload, false);
    assert.equal('overriddenBy' in response.payload.moderation, false);
    assert.equal('reasons' in response.payload.moderation, false);
    assert.equal(typeof response.payload.moderation.riskScore, 'number');
  });
});

test('public comment authors and author profiles expose only public profile fields', async () => {
  await withServer(async ({ request }) => {
    store.users.find((user) => user.id === 'u-reader').recommendationFeedback = [{ articleId: 'a-1', helpful: false }];
    store.comments.push({ id: 'c-public', articleId: 'a-1', authorId: 'u-reader', body: 'A public comment', status: 'published', createdAt: new Date().toISOString() });

    const comments = await request('/articles/a-1/comments');
    const author = comments.payload.items.find((item) => item.id === 'c-public').author;
    assert.deepEqual(Object.keys(author).sort(), ['avatar', 'bio', 'id', 'name', 'role']);

    const authors = await request('/authors');
    assert.equal(authors.status, 200);
    for (const profile of authors.payload) {
      for (const field of ['email', 'preferences', 'reputation', 'recommendationFeedback', 'restrictionReason']) {
        assert.equal(field in profile, false, `${field} should not be public`);
      }
    }
  });
});

test('author statistics never expose quiz answers or review notes on public endpoints', async () => {
  await withServer(async ({ request }) => {
    store.articles.push({
      ...baseArticle,
      id: 'a-stats-quiz',
      authorId: 'u-author',
      status: 'published',
      publishedAt: new Date().toISOString(),
      review: { reviewerId: 'u-admin', feedback: 'Internal reviewer note' },
      quiz: { questions: [{ prompt: 'Pick the right one?', options: ['One', 'Two'], correctOptionIndex: 1 }] },
    });
    store.engagementEvents.push({ id: 'e-stats', userId: 'u-reader', articleId: 'a-stats-quiz', type: 'view', createdAt: new Date().toISOString() });

    const profile = await request('/authors/u-author');
    assert.equal(profile.status, 200);
    const topArticle = profile.payload.stats.topArticles.find((item) => item.id === 'a-stats-quiz');
    assert.ok(topArticle);
    assert.equal('correctOptionIndex' in topArticle.quiz.questions[0], false);
    assert.equal('review' in topArticle, false);

    const list = await request('/authors');
    const listed = list.payload.find((item) => item.id === 'u-author').stats.topArticles.find((item) => item.id === 'a-stats-quiz');
    assert.equal('correctOptionIndex' in listed.quiz.questions[0], false);
  });
});

test('saving the profile keeps returning the account email to its owner', async () => {
  await withServer(async ({ request, tokens }) => {
    const response = await request('/me/profile', { method: 'PUT', token: tokens.reader, body: { bio: 'Updated bio' } });
    assert.equal(response.status, 200);
    assert.equal(response.payload.user.email, 'reader@signalcms.dev');
    assert.equal(response.payload.user.bio, 'Updated bio');
    assert.equal('passwordHash' in response.payload.user, false);
  });
});

test('article cover images must be http(s) URLs and categories must exist', async () => {
  await withServer(async ({ request, tokens }) => {
    const valid = {
      title: 'Validation test article',
      content: 'This article body is long enough to pass the content validation rules.',
    };
    const badCover = await request('/articles', { method: 'POST', token: tokens.author, body: { ...valid, coverImage: 'javascript:alert(1)' } });
    assert.equal(badCover.status, 400);
    const badCategory = await request('/articles', { method: 'POST', token: tokens.author, body: { ...valid, categoryIds: ['does-not-exist'] } });
    assert.equal(badCategory.status, 400);
    const longTag = await request('/articles', { method: 'POST', token: tokens.author, body: { ...valid, tags: ['x'.repeat(51)] } });
    assert.equal(longTag.status, 400);
    const ok = await request('/articles', { method: 'POST', token: tokens.author, body: { ...valid, coverImage: 'https://example.com/cover.png', categoryIds: ['ai'], tags: ['ok'] } });
    assert.equal(ok.status, 201);
  });
});
