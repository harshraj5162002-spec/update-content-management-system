const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const crypto = require('node:crypto');
const { store } = require('../src/data/store');
const authRoutes = require('../src/routes/auth');
const articleRoutes = require('../src/routes/articles');
const communityRoutes = require('../src/routes/community');
const moderationRoutes = require('../src/routes/moderation');
const aiRoutes = require('../src/routes/ai');
const { optionalAuth, signToken } = require('../src/middleware/auth');

test('reader and author signup, login, and article permissions work end to end', async () => {
  const originalUsers = store.users;
  const originalArticles = store.articles;
  const originalAuditLogs = store.auditLogs;
  const originalEngagementEvents = store.engagementEvents;
  const originalReadingHistory = store.readingHistory;
  const originalNotifications = store.notifications;
  const originalModerationResults = store.moderationResults;
  store.users = structuredClone(originalUsers);
  store.articles = [...originalArticles];
  store.auditLogs = [...originalAuditLogs];
  store.engagementEvents = [...originalEngagementEvents];
  store.readingHistory = [...originalReadingHistory];
  store.notifications = [...originalNotifications];
  store.moderationResults = [...originalModerationResults];

  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRoutes);
  app.use('/api/articles', optionalAuth, articleRoutes);
  app.use('/api', communityRoutes);
  app.use('/api/moderation', moderationRoutes);
  app.use('/api/ai', aiRoutes);
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
    return { status: response.status, payload: await response.json() };
  }

  try {
    const readerSignup = await request('/auth/signup', {
      method: 'POST',
      body: { name: 'Test Reader', email: 'test-reader@example.com', password: 'ReaderPass123!', role: 'reader' },
    });
    assert.equal(readerSignup.status, 201);
    assert.equal(readerSignup.payload.user.role, 'reader');
    const [duplicateSignupA, duplicateSignupB] = await Promise.all([
      request('/auth/signup', {
        method: 'POST',
        body: { name: 'Duplicate One', email: 'duplicate-reader@example.com', password: 'ReaderPass123!', role: 'reader' },
      }),
      request('/auth/signup', {
        method: 'POST',
        body: { name: 'Duplicate Two', email: 'duplicate-reader@example.com', password: 'ReaderPass123!', role: 'reader' },
      }),
    ]);
    assert.deepEqual([duplicateSignupA.status, duplicateSignupB.status].sort(), [201, 409]);
    assert.equal(store.users.filter((user) => user.email === 'duplicate-reader@example.com').length, 1);
    const readerLogin = await request('/auth/login', {
      method: 'POST',
      body: { email: 'test-reader@example.com', password: 'ReaderPass123!', role: 'reader' },
    });
    assert.equal(readerLogin.status, 200);
    assert.equal(readerLogin.payload.user.role, 'reader');
    assert.equal('passwordHash' in readerLogin.payload.user, false);
    const readerRecord = store.users.find((user) => user.id === readerSignup.payload.user.id);
    readerRecord.passwordResetTokenHash = 'private-reset-hash';
    readerRecord.passwordResetTokenExpiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    readerRecord.oauthProviders = { github: 'private-provider-id' };
    const readerProfile = await request('/me/profile', { token: readerLogin.payload.token });
    assert.equal(readerProfile.status, 200);
    assert.equal('passwordResetTokenHash' in readerProfile.payload.user, false);
    assert.equal('oauthProviders' in readerProfile.payload.user, false);
    const missingLoginRole = await request('/auth/login', {
      method: 'POST',
      body: { email: 'test-reader@example.com', password: 'ReaderPass123!' },
    });
    assert.equal(missingLoginRole.status, 400);
    const incorrectReaderRole = await request('/auth/login', {
      method: 'POST',
      body: { email: 'test-reader@example.com', password: 'ReaderPass123!', role: 'author' },
    });
    assert.equal(incorrectReaderRole.status, 403);
    const readerAnalyticsDenied = await request('/me/analytics?days=7', { token: readerLogin.payload.token });
    assert.equal(readerAnalyticsDenied.status, 403);
    const readerInsights = await request('/me/reading-insights?days=30', { token: readerLogin.payload.token });
    assert.equal(readerInsights.status, 200);
    assert.equal(readerInsights.payload.rangeDays, 30);
    assert.equal(readerInsights.payload.timeline.length, 30);
    assert.equal(readerInsights.payload.estimateOnly, true);
    const readerCopilot = await request('/ai/assistant', {
      method: 'POST',
      token: readerLogin.payload.token,
      body: { message: 'Suggest a title', article: { title: 'Short title', content: 'A short article draft with enough text.' } },
    });
    assert.equal(readerCopilot.status, 403);

    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetUser = store.users.find((user) => user.email === 'test-reader@example.com');
    resetUser.passwordResetTokenHash = crypto.createHash('sha256').update(resetToken).digest('hex');
    resetUser.passwordResetTokenExpiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const resetResponse = await request('/auth/password-reset/confirm', {
      method: 'POST',
      body: { token: resetToken, password: 'NewReaderPass456!' },
    });
    assert.equal(resetResponse.status, 200);
    assert.equal('passwordResetTokenHash' in resetUser, false);
    const resetReuse = await request('/auth/password-reset/confirm', {
      method: 'POST',
      body: { token: resetToken, password: 'AnotherReaderPass789!' },
    });
    assert.equal(resetReuse.status, 400);
    const expiredToken = crypto.randomBytes(32).toString('hex');
    resetUser.passwordResetTokenHash = crypto.createHash('sha256').update(expiredToken).digest('hex');
    resetUser.passwordResetTokenExpiresAt = new Date(Date.now() - 1000).toISOString();
    const expiredReset = await request('/auth/password-reset/confirm', {
      method: 'POST',
      body: { token: expiredToken, password: 'ExpiredPass123!' },
    });
    assert.equal(expiredReset.status, 400);
    const resetLogin = await request('/auth/login', {
      method: 'POST',
      body: { email: 'test-reader@example.com', password: 'NewReaderPass456!', role: 'reader' },
    });
    assert.equal(resetLogin.status, 200);
    assert.equal('passwordResetTokenHash' in resetLogin.payload.user, false);
    const concurrentToken = crypto.randomBytes(32).toString('hex');
    resetUser.passwordResetTokenHash = crypto.createHash('sha256').update(concurrentToken).digest('hex');
    resetUser.passwordResetTokenExpiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const concurrentReset = await Promise.all([
      request('/auth/password-reset/confirm', {
        method: 'POST',
        body: { token: concurrentToken, password: 'ConcurrentPass111!' },
      }),
      request('/auth/password-reset/confirm', {
        method: 'POST',
        body: { token: concurrentToken, password: 'ConcurrentPass222!' },
      }),
    ]);
    assert.deepEqual(concurrentReset.map((response) => response.status).sort(), [200, 400]);

    const authorSignup = await request('/auth/signup', {
      method: 'POST',
      body: { name: 'Test Author', email: 'test-author@example.com', password: 'AuthorPass123!', role: 'author' },
    });
    assert.equal(authorSignup.status, 201);
    assert.equal(authorSignup.payload.user.role, 'author');
    const authorLogin = await request('/auth/login', {
      method: 'POST',
      body: { email: 'test-author@example.com', password: 'AuthorPass123!', role: 'author' },
    });
    assert.equal(authorLogin.status, 200);
    assert.equal(authorLogin.payload.user.role, 'author');
    const authorAnalytics = await request('/me/analytics?days=7', { token: authorLogin.payload.token });
    assert.equal(authorAnalytics.status, 200);
    assert.equal(authorAnalytics.payload.rangeDays, 7);
    assert.equal(authorAnalytics.payload.stats.timeline.length, 7);
    assert.ok(Array.isArray(authorAnalytics.payload.stats.statusBreakdown));
    const invalidReaderRange = await request('/me/reading-insights?days=14', { token: readerLogin.payload.token });
    assert.equal(invalidReaderRange.status, 400);
    const authorCopilot = await request('/ai/assistant', {
      method: 'POST',
      token: authorLogin.payload.token,
      body: { message: 'Suggest a title', article: { title: 'Short title', content: 'A short article draft with enough text.' } },
    });
    assert.equal(authorCopilot.status, 200);
    assert.equal(authorCopilot.payload.action, 'title');
    assert.ok(authorCopilot.payload.suggestions.some((suggestion) => suggestion.type === 'title'));
    assert.match(authorCopilot.payload.note, /requires administrator approval/i);

    const publishedArticle = await request('/articles/a-1', { token: readerLogin.payload.token });
    assert.equal(publishedArticle.status, 200);

    const articleInput = {
      title: 'A New Editorial Test Story',
      summary: 'A test story summary.',
      content: 'This is a valid article body with enough words to satisfy the publishing system validation.',
      tags: ['test'],
      quiz: {
        questions: [{
          prompt: 'Which option is correct?',
          options: ['First answer', 'Second answer'],
          correctOptionIndex: 1,
        }],
      },
    };
    const readerCreate = await request('/articles', {
      method: 'POST',
      token: readerLogin.payload.token,
      body: articleInput,
    });
    assert.equal(readerCreate.status, 403);

    const readerEdit = await request('/articles/a-1', {
      method: 'PUT',
      token: readerLogin.payload.token,
      body: { title: 'A Reader Cannot Edit This' },
    });
    assert.equal(readerEdit.status, 403);
    const readerDelete = await request('/articles/a-1', {
      method: 'DELETE',
      token: readerLogin.payload.token,
    });
    assert.equal(readerDelete.status, 403);

    const invalidQuiz = await request('/articles', {
      method: 'POST',
      token: authorLogin.payload.token,
      body: {
        title: 'An Invalid Quiz Article',
        content: articleInput.content,
        quiz: { questions: [{ prompt: 'Which option is correct?', options: ['Only one'], correctOptionIndex: 0 }] },
      },
    });
    assert.equal(invalidQuiz.status, 400);

    const authorCreate = await request('/articles', {
      method: 'POST',
      token: authorLogin.payload.token,
      body: articleInput,
    });
    assert.equal(authorCreate.status, 201);
    const articleId = authorCreate.payload.article.id;
    assert.equal(authorCreate.payload.article.quiz.questions[0].correctOptionIndex, 1);

    const authorEdit = await request(`/articles/${articleId}`, {
      method: 'PUT',
      token: authorLogin.payload.token,
      body: { title: 'An Updated Editorial Test Story' },
    });
    assert.equal(authorEdit.status, 200);
    const authorSubmit = await request(`/articles/${articleId}/submit`, {
      method: 'POST',
      token: authorLogin.payload.token,
      body: {},
    });
    assert.equal(authorSubmit.status, 200);
    assert.equal(authorSubmit.payload.article.status, 'pending');
    const authorRecord = store.users.find((user) => user.id === authorSignup.payload.user.id);
    authorRecord.passwordResetTokenHash = 'pending-reset-hash';
    authorRecord.passwordResetTokenExpiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    authorRecord.oauthProviders = { google: 'private-provider-id' };
    const admin = store.users.find((user) => user.role === 'admin');
    const reviewQueue = await request('/moderation/queue', { token: signToken(admin) });
    const pendingAuthor = reviewQueue.payload.items.find((item) => item.id === articleId).author;
    assert.equal('passwordResetTokenHash' in pendingAuthor, false);
    assert.equal('oauthProviders' in pendingAuthor, false);
    assert.equal('passwordHash' in pendingAuthor, false);
    const hiddenWhilePending = await request(`/articles/${articleId}`);
    assert.equal(hiddenWhilePending.status, 404);
    const hiddenQuizAttempt = await request(`/articles/${articleId}/quiz/attempt`, {
      method: 'POST',
      body: { answers: [1] },
    });
    assert.equal(hiddenQuizAttempt.status, 404);
    const publishedBeforeReview = await request('/articles?status=published');
    assert.equal(publishedBeforeReview.payload.items.some((item) => item.id === articleId), false);

    const authorApproval = await request(`/moderation/articles/${articleId}/decision`, {
      method: 'POST',
      token: authorLogin.payload.token,
      body: { decision: 'approve', reason: 'Attempted self approval.' },
    });
    assert.equal(authorApproval.status, 403);
    const adminDashboard = await request('/moderation/dashboard?days=7', { token: signToken(admin) });
    assert.equal(adminDashboard.status, 200);
    assert.equal(adminDashboard.payload.analytics.timeline.length, 7);
    assert.ok(Array.isArray(adminDashboard.payload.analytics.articleStatuses));
    assert.equal(adminDashboard.payload.analytics.hasUserHistory, true);
    assert.ok(adminDashboard.payload.analytics.timeline.reduce((total, day) => total + day.users, 0) >= 2);
    assert.equal((await request('/moderation/dashboard', { token: readerLogin.payload.token })).status, 403);
    assert.equal((await request('/moderation/dashboard?days=14', { token: signToken(admin) })).status, 400);
    const adminCopilot = await request('/ai/assistant', {
      method: 'POST',
      token: signToken(admin),
      body: { message: 'Run a moderation risk analysis', article: { title: 'A review title', content: 'An ordinary editorial article draft.' } },
    });
    assert.equal(adminCopilot.status, 200);
    assert.equal(adminCopilot.payload.action, 'moderation');
    assert.match(adminCopilot.payload.text, /advisory signal/i);

    const adminApproval = await request(`/moderation/articles/${articleId}/decision`, {
      method: 'POST',
      token: signToken(admin),
      body: { decision: 'approve', reason: 'Reviewed and approved.' },
    });
    assert.equal(adminApproval.status, 200);
    assert.equal(adminApproval.payload.article.status, 'published');

    const publicArticle = await request(`/articles/${articleId}`);
    assert.deepEqual(publicArticle.payload.quiz.questions[0], {
      prompt: 'Which option is correct?',
      options: ['First answer', 'Second answer'],
    });
    const publishedArticles = await request('/articles?status=published');
    assert.equal('correctOptionIndex' in publishedArticles.payload.items.find((item) => item.id === articleId).quiz.questions[0], false);
    const searchResults = await request('/search?q=Editorial%20Test%20Story');
    assert.equal('correctOptionIndex' in searchResults.payload.items.find((item) => item.id === articleId).quiz.questions[0], false);
    const authorArticles = await request(`/authors/${authorSignup.payload.user.id}`);
    assert.equal('correctOptionIndex' in authorArticles.payload.articles.find((item) => item.id === articleId).quiz.questions[0], false);

    const invalidAttempt = await request(`/articles/${articleId}/quiz/attempt`, {
      method: 'POST',
      body: { answers: [9] },
    });
    assert.equal(invalidAttempt.status, 400);
    const quizAttempt = await request(`/articles/${articleId}/quiz/attempt`, {
      method: 'POST',
      body: { answers: [1] },
    });
    assert.equal(quizAttempt.status, 200);
    assert.equal(quizAttempt.payload.score, 1);
    assert.equal(quizAttempt.payload.total, 1);

    const authorEditPublished = await request(`/articles/${articleId}`, {
      method: 'PUT',
      token: authorLogin.payload.token,
      body: { title: 'An Updated Editorial Test Story' },
    });
    assert.equal(authorEditPublished.status, 200);
    assert.equal(authorEditPublished.payload.article.status, 'pending');
    assert.equal((await request(`/articles/${articleId}`)).status, 404);

    const requestChanges = await request(`/moderation/articles/${articleId}/decision`, {
      method: 'POST',
      token: signToken(admin),
      body: { decision: 'request_changes', reason: 'Please add a source for the central claim.' },
    });
    assert.equal(requestChanges.status, 200);
    assert.equal(requestChanges.payload.article.status, 'changes_requested');
    const authorReview = await request(`/articles/${articleId}`, { token: authorLogin.payload.token });
    assert.equal(authorReview.payload.review.feedback, 'Please add a source for the central claim.');

    const resubmission = await request(`/articles/${articleId}/submit`, {
      method: 'POST',
      token: authorLogin.payload.token,
      body: {},
    });
    assert.equal(resubmission.status, 200);
    assert.equal(resubmission.payload.article.status, 'pending');

    const elevatedSignup = await request('/auth/signup', {
      method: 'POST',
      body: { name: 'Not Admin', email: 'not-admin@example.com', password: 'ReaderPass123!', role: 'admin' },
    });
    assert.equal(elevatedSignup.status, 400);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    store.users = originalUsers;
    store.articles = originalArticles;
    store.auditLogs = originalAuditLogs;
    store.engagementEvents = originalEngagementEvents;
    store.readingHistory = originalReadingHistory;
    store.notifications = originalNotifications;
    store.moderationResults = originalModerationResults;
  }
});
