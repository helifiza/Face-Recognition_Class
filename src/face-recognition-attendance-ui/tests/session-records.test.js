import test from 'node:test';
import assert from 'node:assert/strict';
import { api } from '../js/api.js';
import { SessionRecords } from '../js/session-records.js';

test('switching sessions discards a slower response from the previous session', async () => {
  const original = api.attendance;
  const pending = new Map();
  api.attendance = id => new Promise(resolve => pending.set(id, resolve));
  const feed = new SessionRecords(() => {});
  try {
    const first = feed.select('1');
    const second = feed.select('2');
    pending.get('2')([{ student_id: 'second' }]);
    await second;
    pending.get('1')([{ student_id: 'first' }]);
    await first;
    assert.equal(feed.id, '2');
    assert.equal(feed.rows[0].student_id, 'second');
  } finally { feed.destroy(); api.attendance = original; }
});

test('failed reloads preserve records but flag them as stale', async () => {
  const original = api.attendance;
  api.attendance = async () => [{ student_id: 'a' }];
  const feed = new SessionRecords(() => {});
  try {
    await feed.select('1');
    api.attendance = async () => { throw new Error('offline'); };
    await feed.reload();
    assert.equal(feed.rows[0].student_id, 'a');
    assert.equal(feed.error, 'offline');
    await feed.select('');
    assert.equal(feed.rows.length, 0);
    assert.equal(feed.loaded, false);
  } finally { feed.destroy(); api.attendance = original; }
});
