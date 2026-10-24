const { users, articles, categories, comments, notifications } = require('./seedData');

const store = {
  users: [...users],
  articles: [...articles],
  categories: [...categories],
  comments: [...comments],
  notifications: [...notifications],
  reports: [],
  appeals: [],
  moderationResults: [],
  readingHistory: [],
  engagementEvents: [],
  reputationEvents: [],
  abuseEvents: [],
  auditLogs: [],
  freshnessAlerts: [],
  bookmarks: [],
  settings: {
    moderationThresholds: { autoApprove: 29, review: 69 },
    trendingWeights: { views: 0.2, likes: 2, shares: 3, comments: 3, velocity: 8, recency: 10 },
  },
};

module.exports = { store };
