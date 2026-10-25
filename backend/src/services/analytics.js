const DEFAULT_TRENDING_WEIGHTS = Object.freeze({
  views: 0.2,
  likes: 2,
  shares: 3,
  comments: 3,
  velocity: 8,
  recency: 10,
});

function normalizeTrendingWeights(weights = DEFAULT_TRENDING_WEIGHTS) {
  if (!weights || typeof weights !== 'object') weights = DEFAULT_TRENDING_WEIGHTS;
  const normalized = {};
  for (const [key, fallback] of Object.entries(DEFAULT_TRENDING_WEIGHTS)) {
    const value = Number(weights[key]);
    normalized[key] = Number.isFinite(value) ? Math.min(20, Math.max(0, value)) : fallback;
  }
  return normalized;
}

function hoursSince(date, now) {
  const timestamp = new Date(date || now).getTime();
  if (!Number.isFinite(timestamp)) return 24;
  return Math.max(1, (now.getTime() - timestamp) / (1000 * 60 * 60));
}

function scoreArticle(article, now = new Date(), weights = DEFAULT_TRENDING_WEIGHTS, recentInteractions = 0) {
  weights = normalizeTrendingWeights(weights);
  const ageHours = hoursSince(article.publishedAt || article.createdAt, now);
  const views = Math.max(0, Number(article.views) || 0);
  const likes = Math.max(0, Number(article.likes) || 0);
  const shares = Math.max(0, Number(article.shares) || 0);
  const comments = Math.max(0, Number(article.comments) || 0);
  const recentEngagement = likes + shares * 1.5 + comments * 1.5;
  const engagementPerView = recentEngagement / Math.max(1, views);
  const velocity = recentEngagement / Math.max(1, ageHours / 12);
  const recency = Math.max(0, 48 - ageHours) / 48;

  return Math.round(
    Math.log1p(views) * weights.views +
    likes * weights.likes +
    shares * weights.shares +
    comments * weights.comments +
    Math.log1p(velocity) * weights.velocity +
    Math.log1p(recentInteractions) * weights.velocity * 0.5 +
    recency * weights.recency +
    Math.min(engagementPerView, 1) * 10
  );
}

function getTrendingArticles(articles, now = new Date(), weights = DEFAULT_TRENDING_WEIGHTS, engagementEvents = []) {
  const recentCutoff = now.getTime() - 7 * 24 * 60 * 60 * 1000;
  return articles
    .filter((article) => article.status === 'published')
    .map((article) => {
      const ageHours = hoursSince(article.publishedAt || article.createdAt, now);
      const recentInteractions = engagementEvents.filter((event) =>
        event.articleId === article.id &&
        event.type !== 'view' &&
        new Date(event.createdAt).getTime() >= recentCutoff
      ).length;

      return {
        ...article,
        score: scoreArticle(article, now, weights, recentInteractions),
        trendingReasons: [
          `${(article.views || 0).toLocaleString()} reads`,
          `${recentInteractions} tracked interactions in the last 7 days`,
          `published ${Math.max(1, Math.floor(ageHours / 24))}d ago`,
        ],
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);
}

function getTopicSnapshot(articles, categories = [], now = new Date()) {
  const published = articles.filter((article) => article.status === 'published');
  const recent = published.filter((article) => hoursSince(article.publishedAt || article.createdAt, now) <= 30 * 24);
  const categoryNames = new Map(categories.map((category) => [category.id, category.name]));
  const categoryCounts = new Map();
  const keywordCounts = new Map();

  for (const article of recent) {
    for (const categoryId of article.categoryIds || []) {
      const key = categoryNames.get(categoryId) || categoryId;
      categoryCounts.set(key, (categoryCounts.get(key) || 0) + 1);
    }

    for (const tag of article.tags || []) {
      const key = String(tag).trim().toLowerCase();
      if (key) keywordCounts.set(key, (keywordCounts.get(key) || 0) + 1);
    }
  }

  return {
    windowDays: 30,
    categories: [...categoryCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, count]) => ({ name, count, signal: 'measured' })),
    keywords: [...keywordCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([name, count]) => ({ name, count, signal: 'measured' })),
  };
}

function getRecommendationsForUser(user, articles, categories = [], readingHistory = [], limit = 4, feedback = []) {
  const published = articles.filter((article) => article.status === 'published');
  const historyIds = new Set(readingHistory.map((item) => item.articleId));
  const dislikedIds = new Set(feedback.filter((item) => item.helpful === false).map((item) => item.articleId));
  if (!user) {
    return published
      .slice()
      .sort((a, b) => scoreArticle(b) - scoreArticle(a))
      .slice(0, limit)
      .map((article) => ({ ...article, recommendationReasons: ['Popular with readers'] }));
  }

  const preferredIds = new Set(user.preferences || []);
  const preferredNames = new Set(
    categories.filter((category) => preferredIds.has(category.id)).map((category) => category.name.toLowerCase())
  );
  const historyArticles = articles.filter((article) => historyIds.has(article.id));
  for (const article of historyArticles) {
    for (const categoryId of article.categoryIds || []) preferredIds.add(categoryId);
    for (const tag of article.tags || []) preferredNames.add(String(tag).toLowerCase());
  }

  return published
    .filter((article) => !historyIds.has(article.id) && !dislikedIds.has(article.id))
    .map((article) => {
      const matchedCategories = (article.categoryIds || []).filter((id) => preferredIds.has(id)).length;
      const matchedTags = (article.tags || []).filter((tag) => preferredNames.has(String(tag).toLowerCase())).length;
      const likedBefore = feedback.some((item) => item.articleId === article.id && item.helpful);
      const reasons = [];
      if (matchedCategories) reasons.push(`${matchedCategories} matching interest${matchedCategories === 1 ? '' : 's'}`);
      if (matchedTags) reasons.push(`${matchedTags} shared topic${matchedTags === 1 ? '' : 's'}`);
      if (!reasons.length) reasons.push('Popular with readers');

      return {
        ...article,
        recommendationScore: matchedCategories * 25 + matchedTags * 12 + Math.min(article.likes || 0, 300) * 0.05 + (likedBefore ? 15 : 0),
        recommendationReasons: reasons,
      };
    })
    .sort((a, b) => b.recommendationScore - a.recommendationScore)
    .slice(0, limit);
}

function getRelatedArticles(article, articles, limit = 4) {
  const sourceCategories = new Set(article.categoryIds || []);
  const sourceTags = new Set((article.tags || []).map((tag) => String(tag).toLowerCase()));
  const sourceWords = new Set(`${article.title || ''} ${article.summary || ''}`.toLowerCase().match(/[a-z0-9]{4,}/g) || []);

  return articles
    .filter((candidate) => candidate.id !== article.id && candidate.status === 'published')
    .map((candidate) => {
      const sharedCategories = (candidate.categoryIds || []).filter((id) => sourceCategories.has(id)).length;
      const sharedTags = (candidate.tags || []).filter((tag) => sourceTags.has(String(tag).toLowerCase())).length;
      const candidateWords = `${candidate.title || ''} ${candidate.summary || ''}`.toLowerCase().match(/[a-z0-9]{4,}/g) || [];
      const sharedWords = candidateWords.filter((word) => sourceWords.has(word)).length;
      const score = sharedCategories * 4 + sharedTags * 3 + sharedWords;
      return {
        ...candidate,
        relatedScore: score,
        relatedReasons: [
          ...(sharedCategories ? [`${sharedCategories} shared categor${sharedCategories === 1 ? 'y' : 'ies'}`] : []),
          ...(sharedTags ? [`${sharedTags} shared topic${sharedTags === 1 ? '' : 's'}`] : []),
        ],
      };
    })
    .filter((item) => item.relatedScore > 0)
    .sort((a, b) => b.relatedScore - a.relatedScore)
    .slice(0, limit);
}

function searchArticles(articles, { q = '', categoryId = '', tag = '', sort = 'relevance', page = 1, limit = 12 } = {}, categories = []) {
  const query = String(q).trim().toLowerCase();
  const queryTokens = [...new Set(query.split(/[^a-z0-9]+/).filter((token) => token.length > 1))];
  const normalizedTag = String(tag).trim().toLowerCase();
  const categoryNames = new Map(categories.map((category) => [category.id, category.name]));
  const searchableText = (article) => [
    article.title,
    article.summary,
    article.content,
    ...(article.tags || []),
    ...(article.categoryIds || []).map((id) => categoryNames.get(id) || id),
  ].join(' ').toLowerCase();
  const matches = articles.filter((article) => {
    if (article.status !== 'published') return false;
    if (categoryId && !(article.categoryIds || []).includes(categoryId)) return false;
    if (normalizedTag && !(article.tags || []).some((item) => String(item).toLowerCase() === normalizedTag)) return false;
    if (!query) return true;

    const searchable = searchableText(article);
    return searchable.includes(query) || (queryTokens.length > 0 && queryTokens.every((token) => searchable.includes(token)));
  });

  if (sort === 'popular') {
    matches.sort((a, b) => (b.views || 0) - (a.views || 0));
  } else if (sort === 'newest') {
    matches.sort((a, b) => new Date(b.publishedAt || b.createdAt) - new Date(a.publishedAt || a.createdAt));
  } else if (query) {
    const relevance = (article) => {
      const title = String(article.title || '').toLowerCase();
      const summary = String(article.summary || '').toLowerCase();
      const searchable = searchableText(article);
      return (title.includes(query) ? 100 : 0) +
        (summary.includes(query) ? 30 : 0) +
        (searchable.includes(query) ? 10 : 0) +
        queryTokens.reduce((score, token) => score + (title.includes(token) ? 12 : summary.includes(token) ? 4 : 1), 0);
    };
    matches.sort((a, b) => relevance(b) - relevance(a) || scoreArticle(b) - scoreArticle(a));
  } else {
    matches.sort((a, b) => scoreArticle(b) - scoreArticle(a));
  }

  const safePage = Math.max(1, Math.floor(Number(page) || 1));
  const safeLimit = Math.min(50, Math.max(1, Math.floor(Number(limit) || 12)));
  return {
    items: matches.slice((safePage - 1) * safeLimit, safePage * safeLimit),
    count: matches.length,
    page: safePage,
    pages: Math.ceil(matches.length / safeLimit),
    suggestions: query && !matches.length
      ? [...articles.flatMap((article) => article.tags || []).reduce((counts, item) => {
        const tagValue = String(item).trim();
        const tag = tagValue.toLowerCase();
        const overlap = queryTokens.some((token) => tag.includes(token) || token.includes(tag));
        if (tagValue && overlap) counts.set(tagValue, (counts.get(tagValue) || 0) + 1);
        return counts;
      }, new Map()).entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, 5)
        .map(([name]) => name)
      : [],
  };
}

function getAuthorStats(articles, authorId, since = null, engagementEvents = []) {
  const timelineDays = since
    ? Math.max(1, Math.round((Date.now() - since.getTime()) / (24 * 60 * 60 * 1000)))
    : 30;
  const authored = articles.filter((article) => article.authorId === authorId);
  const allPublished = authored.filter((article) => article.status === 'published');
  const published = allPublished.filter((article) =>
    !since || new Date(article.publishedAt || article.createdAt) >= since
  );
  const publishedIds = new Set(allPublished.map((article) => article.id));
  const trackedEvents = engagementEvents.filter((event) =>
    publishedIds.has(event.articleId) && (!since || new Date(event.createdAt) >= since)
  );
  const countEvents = (type) => trackedEvents.filter((event) => event.type === type).length;
  const engagementByArticle = new Map();
  for (const event of trackedEvents) {
    const metrics = engagementByArticle.get(event.articleId) || { views: 0, likes: 0, shares: 0, comments: 0 };
    const metric = `${event.type}s`;
    if (Object.hasOwn(metrics, metric)) metrics[metric] += 1;
    engagementByArticle.set(event.articleId, metrics);
  }
  const views = since ? countEvents('view') : published.reduce((sum, article) => sum + (article.views || 0), 0);
  const likes = since ? countEvents('like') : published.reduce((sum, article) => sum + (article.likes || 0), 0);
  const shares = since ? countEvents('share') : published.reduce((sum, article) => sum + (article.shares || 0), 0);
  const comments = since ? countEvents('comment') : published.reduce((sum, article) => sum + (article.comments || 0), 0);

  return {
    totalArticles: authored.length,
    publishedArticles: published.length,
    statusBreakdown: ['draft', 'pending', 'published', 'quarantined', 'rejected', 'changes_requested', 'archived']
      .map((status) => ({ status, count: authored.filter((article) => article.status === status).length })),
    views,
    likes,
    shares,
    comments,
    engagementRate: Number(((likes + shares + comments) / Math.max(1, views) * 100).toFixed(2)),
    topArticles: allPublished.slice().map((article) => ({
      ...article,
      analytics: engagementByArticle.get(article.id) || { views: 0, likes: 0, shares: 0, comments: 0 },
    })).sort((a, b) => {
      const aMetrics = a.analytics;
      const bMetrics = b.analytics;
      const aScore = aMetrics.views + aMetrics.likes * 2 + aMetrics.shares * 3 + aMetrics.comments * 3;
      const bScore = bMetrics.views + bMetrics.likes * 2 + bMetrics.shares * 3 + bMetrics.comments * 3;
      return bScore - aScore || scoreArticle(b) - scoreArticle(a);
    }).slice(0, 5),
    topics: getTopicSnapshot(allPublished).keywords.slice(0, 5),
    activityTracked: !since || trackedEvents.length > 0,
    timeline: buildEngagementTimeline(allPublished, trackedEvents, timelineDays),
  };
}

function buildEngagementTimeline(articles, engagementEvents, days = 30) {
  const dates = new Map();
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const date = new Date();
    date.setUTCHours(0, 0, 0, 0);
    date.setUTCDate(date.getUTCDate() - offset);
    const key = date.toISOString().slice(0, 10);
    dates.set(key, { date: key, views: 0, likes: 0, shares: 0, comments: 0 });
  }

  const publishedIds = new Set(articles.map((article) => article.id));
  for (const event of engagementEvents) {
    if (!publishedIds.has(event.articleId)) continue;
    const key = new Date(event.createdAt).toISOString().slice(0, 10);
    const entry = dates.get(key);
    const metric = `${event.type}s`;
    if (entry && Object.hasOwn(entry, metric)) entry[metric] += 1;
  }
  return [...dates.values()];
}

module.exports = {
  DEFAULT_TRENDING_WEIGHTS,
  normalizeTrendingWeights,
  getTrendingArticles,
  getTopicSnapshot,
  getRecommendationsForUser,
  getRelatedArticles,
  searchArticles,
  getAuthorStats,
  buildEngagementTimeline,
  scoreArticle,
};
