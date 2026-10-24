const test = require('node:test');
const assert = require('node:assert/strict');
const {
  getTrendingArticles,
  getRecommendationsForUser,
  getAuthorStats,
  searchArticles,
} = require('../src/services/analytics');
const { moderateContent, generateGeminiAITool } = require('../src/services/aiService');
const { corsOrigins } = require('../src/config/env');

const articles = [
  {
    id: 'a1',
    title: 'AI workflow basics',
    status: 'published',
    views: 1400,
    likes: 120,
    shares: 90,
    comments: 50,
    categoryIds: ['ai'],
    tags: ['workflow', 'editing'],
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 2).toISOString(),
    publishedAt: new Date(Date.now() - 1000 * 60 * 60 * 12).toISOString(),
  },
  {
    id: 'a2',
    title: 'Design trust systems',
    status: 'published',
    views: 800,
    likes: 60,
    shares: 50,
    comments: 30,
    categoryIds: ['design'],
    tags: ['trust', 'ux'],
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 9).toISOString(),
    publishedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 3).toISOString(),
  },
];

test('development CORS allowlist includes the Vite frontend port 5175', () => {
  assert.ok(corsOrigins.includes('http://localhost:5175'));
});

test('trending articles rank by engagement and recency', () => {
  const trending = getTrendingArticles(articles);
  assert.ok(trending.length >= 2);
  assert.ok(trending[0].score >= trending[1].score);
});

test('recommendations prefer matching user interests', () => {
  const recommendations = getRecommendationsForUser({ preferences: ['ai'] }, articles, []);
  assert.ok(recommendations[0].id === 'a1');
});

test('recommendations exclude dismissed and already-read articles', () => {
  const recommendations = getRecommendationsForUser(
    { preferences: ['ai'] },
    articles,
    [],
    [{ articleId: 'a2' }],
    4,
    [{ articleId: 'a1', helpful: false }],
  );
  assert.deepEqual(recommendations, []);
});

test('search matches all query terms, ranks titles, and hides non-published articles', () => {
  const results = searchArticles([
    ...articles,
    { id: 'draft', title: 'AI workflow basics', status: 'draft', tags: ['private'] },
  ], { q: 'AI workflow' });
  assert.deepEqual(results.items.map((article) => article.id), ['a1']);
});

test('author date ranges include recent engagement on older published stories', () => {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const stats = getAuthorStats([
    { id: 'old', authorId: 'writer', status: 'published', publishedAt: '2020-01-01T00:00:00.000Z' },
  ], 'writer', since, [
    { articleId: 'old', type: 'view', createdAt: new Date().toISOString() },
    { articleId: 'old', type: 'share', createdAt: new Date().toISOString() },
  ]);
  assert.equal(stats.views, 1);
  assert.equal(stats.shares, 1);
  assert.equal(stats.publishedArticles, 0);
  assert.equal(stats.timeline.length, 7);
  assert.equal(stats.timeline.at(-1).views, 1);
});

test('moderation flags promotional content and returns a risk score', () => {
  const result = moderateContent({
    title: 'Buy now',
    summary: 'Get free money today',
    content: 'This is a promotional article with click here and crypto pump recommendations.',
    tags: ['promo'],
  });

  assert.ok(result.riskScore >= 40);
  assert.equal(result.status, 'review');
  assert.ok(result.reasons.length > 0);
});

test('moderation supports a zero auto-approval threshold', () => {
  const result = moderateContent({}, { autoApprove: 0, review: 100 });
  assert.equal(result.status, 'review');
  assert.equal(result.thresholds.autoApprove, 0);
});

test('Gemini tool requests return parsed JSON and keep the API key in a header', async () => {
  let requestUrl;
  let requestOptions;
  const result = await generateGeminiAITool('summary', { title: 'A title' }, [], {
    apiKey: 'test-key',
    model: 'test-model',
    fetchImpl: async (url, options) => {
      requestUrl = url;
      requestOptions = options;
      return {
        ok: true,
        json: async () => ({
          candidates: [{ content: { parts: [{ text: '{"summary":"A concise summary","keyTakeaways":["Point one"]}' }] } }],
        }),
      };
    },
  });

  assert.match(requestUrl, /test-model:generateContent$/);
  assert.equal(requestUrl.includes('test-key'), false);
  assert.equal(requestOptions.headers['x-goog-api-key'], 'test-key');
  assert.equal(JSON.parse(requestOptions.body).generationConfig.responseMimeType, 'application/json');
  assert.equal(result.summary, 'A concise summary');
  assert.equal(result.confidence, 'AI-generated');
  assert.equal(result.generatedBy, 'Gemini (test-model)');
});

test('Gemini API errors are surfaced without exposing provider response details', async () => {
  await assert.rejects(
    generateGeminiAITool('writing', {}, [], {
      apiKey: 'test-key',
      fetchImpl: async () => ({ ok: false, status: 401 }),
    }),
    { code: 'GEMINI_API_ERROR', message: /HTTP 401/ },
  );
});
