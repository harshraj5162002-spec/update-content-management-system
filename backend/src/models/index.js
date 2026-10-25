const mongoose = require('mongoose');

const { Schema } = mongoose;

function createModel(name, fields, indexes = []) {
  const schema = new Schema(
    {
      _id: { type: String, required: true },
      ...fields,
    },
    { strict: false, versionKey: false }
  );

  for (const index of indexes) {
    schema.index(...index);
  }

  return mongoose.models[name] || mongoose.model(name, schema);
}

const User = createModel('User', {
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true },
  role: { type: String, enum: ['admin', 'author', 'reader'], default: 'reader' },
  status: { type: String, default: 'active' },
  preferences: { type: [String], default: [] },
  passwordResetTokenHash: { type: String, default: undefined },
  passwordResetTokenExpiresAt: { type: Date, default: undefined },
  oauthProviders: { type: Schema.Types.Mixed, default: undefined },
  createdAt: { type: Date, default: undefined },
}, [[{ email: 1 }, { unique: true }], [{ role: 1, status: 1 }]]);

const Article = createModel('Article', {
  title: { type: String, required: true, trim: true },
  summary: { type: String, default: '' },
  content: { type: String, required: true },
  authorId: { type: String, required: true, index: true },
  status: { type: String, enum: ['draft', 'pending', 'published', 'quarantined', 'archived', 'rejected', 'changes_requested'], default: 'draft', index: true },
  categoryIds: { type: [String], default: [] },
  tags: { type: [String], default: [] },
  views: { type: Number, default: 0 },
  likes: { type: Number, default: 0 },
  shares: { type: Number, default: 0 },
  comments: { type: Number, default: 0 },
  moderation: { type: Schema.Types.Mixed, default: {} },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
}, [[{ status: 1, publishedAt: -1 }], [{ authorId: 1, status: 1 }], [{ categoryIds: 1 }]]);

const Category = createModel('Category', {
  name: { type: String, required: true, trim: true },
  description: { type: String, default: '' },
}, [[{ name: 1 }, { unique: true }]]);

const Comment = createModel('Comment', {
  articleId: { type: String, required: true, index: true },
  authorId: { type: String, required: true, index: true },
  body: { type: String, required: true },
  status: { type: String, default: 'published' },
  createdAt: { type: Date, default: Date.now },
});

const ModerationResult = createModel('ModerationResult', {
  status: { type: String, required: true, index: true },
  riskScore: { type: Number, min: 0, max: 100, required: true },
  reasons: { type: [String], default: [] },
  actor: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now },
});

const Report = createModel('Report', {
  reporterId: { type: String, required: true, index: true },
  targetType: { type: String, enum: ['article', 'comment', 'user'], required: true },
  targetId: { type: String, required: true, index: true },
  reason: { type: String, required: true },
  details: { type: String, default: '' },
  status: { type: String, default: 'open', index: true },
  createdAt: { type: Date, default: Date.now },
});

const Appeal = createModel('Appeal', {
  articleId: { type: String, required: true, index: true },
  authorId: { type: String, required: true, index: true },
  reason: { type: String, required: true },
  status: { type: String, default: 'open', index: true },
  decision: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now },
});

const Notification = createModel('Notification', {
  userId: { type: String, required: true, index: true },
  type: { type: String, default: 'system' },
  title: { type: String, required: true },
  read: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
});

const ReadingHistory = createModel('ReadingHistory', {
  userId: { type: String, required: true, index: true },
  articleId: { type: String, required: true, index: true },
  readAt: { type: Date, default: Date.now },
  progress: { type: Number, min: 0, max: 100, default: 0 },
}, [[{ userId: 1, articleId: 1 }, { unique: true }]]);

const Bookmark = createModel('Bookmark', {
  userId: { type: String, required: true, index: true },
  articleId: { type: String, required: true, index: true },
  createdAt: { type: Date, default: Date.now },
}, [[{ userId: 1, articleId: 1 }, { unique: true }]]);

const EngagementEvent = createModel('EngagementEvent', {
  userId: { type: String, default: 'anonymous', index: true },
  articleId: { type: String, required: true, index: true },
  type: { type: String, enum: ['view', 'like', 'share', 'bookmark', 'comment'], required: true },
  createdAt: { type: Date, default: Date.now, index: true },
}, [[{ userId: 1, articleId: 1, type: 1 }, { unique: true, partialFilterExpression: { type: { $in: ['like', 'bookmark'] } } }]]);

const ReputationEvent = createModel('ReputationEvent', {
  eventKey: { type: String, required: true, unique: true },
  userId: { type: String, required: true, index: true },
  actorId: { type: String, default: '' },
  reason: { type: String, required: true },
  delta: { type: Number, required: true },
  createdAt: { type: Date, default: Date.now },
});

const AbuseEvent = createModel('AbuseEvent', {
  userId: { type: String, required: true, index: true },
  type: { type: String, required: true, index: true },
  details: { type: String, default: '' },
  severity: { type: String, enum: ['low', 'medium', 'high'], default: 'low' },
  createdAt: { type: Date, default: Date.now, index: true },
});

const AuditLog = createModel('AuditLog', {
  actorId: { type: String, required: true, index: true },
  action: { type: String, required: true, index: true },
  targetType: { type: String, default: '' },
  targetId: { type: String, default: '' },
  reason: { type: String, default: '' },
  outcome: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now, index: true },
});

const FreshnessAlert = createModel('FreshnessAlert', {
  articleId: { type: String, required: true, index: true },
  authorId: { type: String, required: true, index: true },
  status: { type: String, default: 'open' },
  reason: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
}, [[{ articleId: 1, status: 1 }]]);

const SystemSettings = createModel('SystemSettings', {
  value: { type: Schema.Types.Mixed, required: true },
});

module.exports = {
  User,
  Article,
  Category,
  Comment,
  ModerationResult,
  Report,
  Appeal,
  Notification,
  ReadingHistory,
  Bookmark,
  EngagementEvent,
  ReputationEvent,
  AbuseEvent,
  AuditLog,
  FreshnessAlert,
  SystemSettings,
};
