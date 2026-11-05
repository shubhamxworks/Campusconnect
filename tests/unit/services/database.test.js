const assert = require('node:assert/strict');
const { test } = require('node:test');
const { normalizeResult } = require('../../../server/config/database');

test('preserves PostgreSQL SELECT rows in repository tuple shape', () => {
  const rows = [{ user_id: '7' }];
  const fields = [{ name: 'user_id' }];
  assert.deepEqual(normalizeResult({
    command: 'SELECT',
    rows,
    fields,
    rowCount: 1,
  }), [rows, fields]);
});

test('returns affected-row and insert-id metadata for PostgreSQL mutations', () => {
  const fields = [{ name: 'user_id' }];
  assert.deepEqual(normalizeResult({
    command: 'INSERT',
    rows: [{ user_id: '7' }],
    fields,
    rowCount: 1,
  }), [{
    affectedRows: 1,
    insertId: '7',
    rows: [{ user_id: '7' }],
  }, fields]);
});
