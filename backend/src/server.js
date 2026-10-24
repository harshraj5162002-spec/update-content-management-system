const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const morgan = require('morgan');
const { connectDb } = require('./config/db');
const { port, corsOrigins } = require('./config/env');
const { store } = require('./data/store');
const { hydrateStore } = require('./data/persistence');
const authRoutes = require('./routes/auth');
const articleRoutes = require('./routes/articles');
const moderationRoutes = require('./routes/moderation');
const aiRoutes = require('./routes/ai');
const communityRoutes = require('./routes/community');
const { optionalAuth } = require('./middleware/auth');
const { getTrendingArticles, getRecommendationsForUser, getTopicSnapshot } = require('./services/analytics');
const { serializePublicArticle } = require('./services/articleSerialization');

const app = express();

app.use(cors({
  origin(origin, callback) {
    if (!origin || corsOrigins.includes(origin)) return callback(null, true);
    return callback(null, false);
  },
  credentials: true,
}));
app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(express.json({ limit: '1mb' }));
app.use(morgan('dev'));
app.use(
  rateLimit({
    windowMs: 60 * 1000,
    max: 200,
    standardHeaders: true,
    legacyHeaders: false,
  })
);

app.use('/api/auth', authRoutes);
app.use('/api/articles', optionalAuth, articleRoutes);
app.use('/api/moderation', moderationRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api', communityRoutes);

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime(), mode: require('mongoose').connection.readyState === 1 ? 'mongodb' : 'demo' });
});

app.get('/api/dashboard', (req, res) => {
  const trending = getTrendingArticles(store.articles, new Date(), store.settings?.trendingWeights, store.engagementEvents);
  const recommendations = getRecommendationsForUser(null, store.articles, store.categories);
  const topics = getTopicSnapshot(store.articles);

  res.json({
    metrics: {
      totalArticles: store.articles.length,
      published: store.articles.filter((article) => article.status === 'published').length,
      drafts: store.articles.filter((article) => article.status === 'draft').length,
      authors: new Set(store.articles.map((article) => article.authorId)).size,
    },
    trending: trending.map(serializePublicArticle),
    recommendations: recommendations.map(serializePublicArticle),
    topics,
  });
});

app.use((error, req, res, next) => {
  console.error(error);
  res.status(500).json({ message: 'Internal server error.' });
});

async function start() {
  const connected = await connectDb();
  if (connected) await hydrateStore(store);
  app.listen(port, () => {
    console.log(`Signal CMS API running on port ${port}`);
  });
}

start();

module.exports = app;
