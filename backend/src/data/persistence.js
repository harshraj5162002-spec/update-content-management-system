const models = require('../models');
const { store } = require('./store');

const collectionModels = {
  users: models.User,
  articles: models.Article,
  categories: models.Category,
  comments: models.Comment,
  moderationResults: models.ModerationResult,
  reports: models.Report,
  appeals: models.Appeal,
  notifications: models.Notification,
  readingHistory: models.ReadingHistory,
  bookmarks: models.Bookmark,
  engagementEvents: models.EngagementEvent,
  reputationEvents: models.ReputationEvent,
  abuseEvents: models.AbuseEvent,
  auditLogs: models.AuditLog,
  freshnessAlerts: models.FreshnessAlert,
};

let databaseEnabled = false;

function toRecord(document) {
  const { _id, ...record } = document;
  return { ...record, id: _id };
}

function toDocument(record) {
  const { id, _id, ...fields } = record;
  return { ...fields, _id: id || _id };
}

async function hydrateStore(store) {
  databaseEnabled = true;

  for (const [collection, Model] of Object.entries(collectionModels)) {
    const documents = await Model.find().lean();
    if (documents.length) {
      store[collection] = documents.map(toRecord);
      continue;
    }

    const seedRecords = store[collection] || [];
    if (seedRecords.length) {
      await Model.insertMany(seedRecords.map(toDocument), { ordered: false });
    }
  }

  const settings = await models.SystemSettings.findById('cms-settings').lean();
  if (settings?.value) store.settings = settings.value;
  else await models.SystemSettings.create({ _id: 'cms-settings', value: store.settings });
}

async function saveRecord(collection, record) {
  if (!databaseEnabled) return;

  const Model = collectionModels[collection];
  if (!Model) throw new Error(`Unknown persistence collection: ${collection}`);

  await Model.findByIdAndUpdate(
    record.id,
    { $set: (() => {
      const { id, _id, ...fields } = record;
      return fields;
    })() },
    { upsert: true, runValidators: true, setDefaultsOnInsert: true }
  );
}

async function consumePasswordResetToken(userId, tokenHash, passwordHash, now = new Date()) {
  const user = store.users.find((item) =>
    item.id === userId &&
    item.passwordResetTokenHash === tokenHash &&
    item.passwordResetTokenExpiresAt &&
    new Date(item.passwordResetTokenExpiresAt).getTime() > now.getTime()
  );
  if (!user) return false;

  if (databaseEnabled) {
    const consumed = await models.User.findOneAndUpdate(
      {
        _id: userId,
        passwordResetTokenHash: tokenHash,
        passwordResetTokenExpiresAt: { $gt: now },
      },
      {
        $set: { passwordHash },
        $unset: { passwordResetTokenHash: 1, passwordResetTokenExpiresAt: 1 },
      },
      { new: true, runValidators: true }
    ).lean();
    if (!consumed) return false;
  }

  user.passwordHash = passwordHash;
  delete user.passwordResetTokenHash;
  delete user.passwordResetTokenExpiresAt;
  return true;
}

async function clearPasswordResetToken(userId, tokenHash) {
  const user = store.users.find((item) => item.id === userId && item.passwordResetTokenHash === tokenHash);
  if (!user) return false;

  if (databaseEnabled) {
    const cleared = await models.User.findOneAndUpdate(
      { _id: userId, passwordResetTokenHash: tokenHash },
      { $unset: { passwordResetTokenHash: 1, passwordResetTokenExpiresAt: 1 } },
      { new: true }
    ).lean();
    if (!cleared) return false;
  }

  delete user.passwordResetTokenHash;
  delete user.passwordResetTokenExpiresAt;
  return true;
}

async function deleteRecord(collection, id) {
  if (!databaseEnabled) return;

  const Model = collectionModels[collection];
  if (!Model) throw new Error(`Unknown persistence collection: ${collection}`);

  await Model.findByIdAndDelete(id);
}

async function saveSettings(settings) {
  if (!databaseEnabled) return;
  await models.SystemSettings.findByIdAndUpdate(
    'cms-settings',
    { $set: { value: settings } },
    { upsert: true, runValidators: true, setDefaultsOnInsert: true }
  );
}

module.exports = { hydrateStore, saveRecord, consumePasswordResetToken, clearPasswordResetToken, deleteRecord, saveSettings };
