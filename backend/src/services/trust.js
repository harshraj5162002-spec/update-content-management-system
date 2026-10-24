const crypto = require('node:crypto');
const { store } = require('../data/store');
const { saveRecord } = require('../data/persistence');

async function recordAbuse({ userId, type, details, severity = 'low' }) {
  const event = {
    id: `abuse-${crypto.randomUUID()}`,
    userId,
    type,
    details: String(details || '').slice(0, 500),
    severity,
    createdAt: new Date().toISOString(),
  };
  store.abuseEvents.push(event);
  await saveRecord('abuseEvents', event);
  return event;
}

async function adjustReputation({ user, actorId, reason, delta }) {
  const eventKey = `${user.id}:${actorId}:${reason.trim().toLowerCase()}`;
  const existing = store.reputationEvents.find((event) => event.eventKey === eventKey);
  if (existing) return { event: existing, user, duplicate: true };

  const event = {
    id: `reputation-${crypto.randomUUID()}`,
    eventKey,
    userId: user.id,
    actorId,
    reason: reason.trim(),
    delta,
    createdAt: new Date().toISOString(),
  };
  user.reputation = Math.max(0, Math.min(100, (Number(user.reputation) || 50) + delta));
  store.reputationEvents.push(event);
  await saveRecord('reputationEvents', event);
  await saveRecord('users', user);
  return { event, user, duplicate: false };
}

module.exports = { recordAbuse, adjustReputation };
