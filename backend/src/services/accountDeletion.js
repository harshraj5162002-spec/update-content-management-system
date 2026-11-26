const { store } = require('../data/store');
const { saveRecord, deleteRecord, deleteByArticleId, deleteByField } = require('../data/persistence');
const { recordAudit } = require('./audit');

async function purgeUserAccount(user, actorId, reason) {
  const ownedArticles = store.articles.filter((article) => article.authorId === user.id);
  const articleDependentCollections = ['comments', 'bookmarks', 'readingHistory', 'freshnessAlerts', 'engagementEvents', 'appeals', 'articleRevisions'];
  for (const article of ownedArticles) {
    await deleteRecord('articles', article.id);
    for (const collection of articleDependentCollections) {
      store[collection] = store[collection].filter((item) => item.articleId !== article.id);
      await deleteByArticleId(collection, article.id);
    }
    store.reports = store.reports.filter((report) => report.targetType !== 'article' || report.targetId !== article.id);
    await deleteByField('reports', 'targetId', article.id, { targetType: 'article' });
  }
  store.articles = store.articles.filter((article) => article.authorId !== user.id);

  const userComments = store.comments.filter((comment) => comment.authorId === user.id);
  for (const comment of userComments) {
    if (comment.status !== 'published') continue;
    const article = store.articles.find((item) => item.id === comment.articleId);
    if (article) {
      article.comments = Math.max(0, (article.comments || 0) - 1);
      await saveRecord('articles', article);
    }
  }

  for (const event of store.engagementEvents.filter((item) => item.userId === user.id)) {
    const article = store.articles.find((item) => item.id === event.articleId);
    if (!article) continue;
    if (event.type === 'like') article.likes = Math.max(0, (article.likes || 0) - 1);
    if (event.type === 'share') article.shares = Math.max(0, (article.shares || 0) - 1);
    if (event.type === 'like' || event.type === 'share') await saveRecord('articles', article);
  }

  const userScopedCollections = [
    ['comments', 'authorId'],
    ['bookmarks', 'userId'],
    ['readingHistory', 'userId'],
    ['engagementEvents', 'userId'],
    ['notifications', 'userId'],
    ['reputationEvents', 'userId'],
    ['abuseEvents', 'userId'],
    ['freshnessAlerts', 'authorId'],
    ['appeals', 'authorId'],
    ['reports', 'reporterId'],
  ];
  for (const [collection, field] of userScopedCollections) {
    store[collection] = store[collection].filter((item) => item[field] !== user.id);
    await deleteByField(collection, field, user.id);
  }

  const reportsAboutUser = store.reports.filter((report) => report.targetType === 'user' && report.targetId === user.id);
  store.reports = store.reports.filter((report) => report.targetType !== 'user' || report.targetId !== user.id);
  for (const report of reportsAboutUser) await deleteRecord('reports', report.id);

  await deleteRecord('users', user.id);
  store.users = store.users.filter((item) => item.id !== user.id);
  await recordAudit({
    actorId: actorId || 'system',
    action: 'user.delete.purge',
    targetType: 'user',
    targetId: user.id,
    reason,
    outcome: 'deleted',
  });
}

async function purgeExpiredAccounts(now = new Date()) {
  const expiredUsers = store.users.filter((user) =>
    user.status === 'deleted' &&
    user.deletionExpiresAt &&
    new Date(user.deletionExpiresAt).getTime() <= now.getTime()
  );
  for (const user of expiredUsers) {
    await purgeUserAccount(user, user.deletedBy, 'Account recovery period expired.');
  }
  return expiredUsers.length;
}

module.exports = { purgeUserAccount, purgeExpiredAccounts };
