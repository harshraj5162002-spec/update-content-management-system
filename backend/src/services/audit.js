const { saveRecord } = require('../data/persistence');
const { store } = require('../data/store');

async function recordAudit({ actorId, action, targetType = '', targetId = '', reason = '', outcome = '' }) {
  const event = {
    id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    actorId,
    action,
    targetType,
    targetId,
    reason,
    outcome,
    createdAt: new Date().toISOString(),
  };

  store.auditLogs.push(event);
  if (store.auditLogs.length > 5000) store.auditLogs.shift();
  await saveRecord('auditLogs', event);
  return event;
}

module.exports = { recordAudit };
