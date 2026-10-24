const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { store } = require('../src/data/store');
const authRoutes = require('../src/routes/auth');
const articleRoutes = require('../src/routes/articles');
const communityRoutes = require('../src/routes/community');

test('reader and author signup, login, and article permissions work end to end', async () => {
  const originalUsers = store.users;
  const originalArticles = store.articles;
  const originalAuditLogs = store.auditLogs;
  const originalEngagementEvents = store.engagementEvents;
  const originalReadingHistory = store.readingHistory;
  store.users = [...originalUsers];
  store.articles = [...originalArticles];
  store.auditLogs = [...originalAuditLogs];
  store.engagementEvents = [...originalEngagementEvents];
  store.readingHistory = [...originalReadingHistory];

  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRoutes);
  app.use('/api/articles', articleRoutes);
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
    return { status: response.status, payload: await response.json() };
  }

  try {
    const readerSignup = await request('/auth/signup', {
      method: 'POST',
      body: { name: 'Test Reader', email: 'test-reader@example.com', password: 'ReaderPass123!', role: 'reader' },
    });
    assert.equal(readerSignup.status, 201);
    assert.equal(readerSignup.payload.user.role, 'reader');
    const readerLogin = await request('/auth/login', {
      method: 'POST',
      body: { email: 'test-reader@example.com', password: 'ReaderPass123!' },
    });
    assert.equal(readerLogin.status, 200);
    assert.equal(readerLogin.payload.user.role, 'reader');

    const authorSignup = await request('/auth/signup', {
      method: 'POST',
      body: { name: 'Test Author', email: 'test-author@example.com', password: 'AuthorPass123!', role: 'author' },
    });
    assert.equal(authorSignup.status, 201);
    assert.equal(authorSignup.payload.user.role, 'author');
    const authorLogin = await request('/auth/login', {
      method: 'POST',
      body: { email: 'test-author@example.com', password: 'AuthorPass123!' },
    });
    assert.equal(authorLogin.status, 200);
    assert.equal(authorLogin.payload.user.role, 'author');

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
    assert.equal(authorSubmit.payload.article.status, 'published');

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
  }
});
