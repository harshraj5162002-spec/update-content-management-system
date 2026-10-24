const crypto = require('node:crypto');
const { generateSummary } = require('./aiService');
const { saveRecord } = require('../data/persistence');

function getArticleSummary(article, regenerate = false) {
  const contentHash = crypto.createHash('sha256').update(article.content || '').digest('hex');
  if (!regenerate && article.aiSummaryCache?.contentHash === contentHash) {
    return article.aiSummaryCache.result;
  }

  const result = generateSummary(article);
  article.aiSummaryCache = { contentHash, result, generatedAt: new Date().toISOString() };
  saveRecord('articles', article).catch((error) => console.error('Failed to cache article summary:', error));
  return result;
}

module.exports = { getArticleSummary };
