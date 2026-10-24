const models = require('../models');

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

module.exports = { hydrateStore, saveRecord, deleteRecord, saveSettings };
