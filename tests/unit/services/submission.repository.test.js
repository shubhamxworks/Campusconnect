const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createMySqlSubmissionRepository } = require('../../../server/repositories/submission.repository');

const submissionRow = {
  submission_id: 7,
  team_id: 4,
  team_name: 'Bright Ideas',
  project_name: 'Campus Compass',
  description: 'A guide to campus resources.',
  repository_url: 'https://example.com/repo',
  demo_url: '',
  submitted_by: 12,
  created_at: '2026-11-01 10:00:00.000',
  updated_at: '2026-11-02 12:30:00.000',
};

function createPool({ eventExists = true, teamExists = true } = {}) {
  const calls = [];
  const connection = {
    async beginTransaction() {
      calls.push({ type: 'begin' });
    },
    async commit() {
      calls.push({ type: 'commit' });
    },
    async rollback() {
      calls.push({ type: 'rollback' });
    },
    release() {
      calls.push({ type: 'release' });
    },
    async execute(sql, values = []) {
      calls.push({ type: 'execute', sql, values });
      if (sql.includes('FROM events')) {
        return [eventExists ? [{ event_id: values[0] }] : []];
      }
      if (sql.includes('FROM teams AS t')) {
        return [teamExists ? [{ team_id: 4 }] : []];
      }
      if (sql.includes('FROM submissions AS s')) {
        return [[{ ...submissionRow }]];
      }
      if (sql.startsWith('INSERT INTO submissions')) {
        return [{ affectedRows: 1 }];
      }
      throw new Error(`Unexpected connection query: ${sql}`);
    },
  };
  return {
    calls,
    async getConnection() {
      return connection;
    },
    async execute(sql, values = []) {
      return connection.execute(sql, values);
    },
  };
}

test('reads only a submission belonging to the signed-in user’s event team', async () => {
  const pool = createPool();
  const repository = createMySqlSubmissionRepository(pool);

  const result = await repository.getForUser('event-1', 12);

  assert.deepEqual(result, {
    id: 7,
    teamId: 4,
    teamName: 'Bright Ideas',
    projectName: 'Campus Compass',
    description: 'A guide to campus resources.',
    repositoryUrl: 'https://example.com/repo',
    demoUrl: '',
    submittedBy: 12,
    submittedAt: '2026-11-01T10:00:00.000Z',
    updatedAt: '2026-11-02T12:30:00.000Z',
  });
  assert.deepEqual(pool.calls[1].values, ['event-1', 12]);
  assert.match(pool.calls[1].sql, /tm\.user_id = \$2/);
});

test('returns distinct missing-event and missing-team results', async () => {
  const missingEvent = createMySqlSubmissionRepository(createPool({ eventExists: false }));
  assert.equal(await missingEvent.getForUser('missing', 12), undefined);

  const missingTeam = createMySqlSubmissionRepository(createPool({ teamExists: false }));
  assert.equal(await missingTeam.getForUser('event-1', 12), false);
});

test('saves one team submission transactionally using parameterized SQL', async () => {
  const pool = createPool();
  const repository = createMySqlSubmissionRepository(pool);
  const saved = await repository.saveForUser('event-1', 12, {
    projectName: 'Campus Compass',
    description: 'A guide to campus resources.',
    repositoryUrl: 'https://example.com/repo',
    demoUrl: '',
  });

  assert.equal(saved.projectName, 'Campus Compass');
  assert.equal(pool.calls[0].type, 'begin');
  assert.equal(pool.calls.at(-2).type, 'commit');
  assert.equal(pool.calls.at(-1).type, 'release');
  const insert = pool.calls.find((call) => call.sql?.startsWith('INSERT INTO submissions'));
  assert.deepEqual(insert.values, [
    'event-1',
    4,
    12,
    'Campus Compass',
    'A guide to campus resources.',
    'https://example.com/repo',
    '',
  ]);
  assert.match(insert.sql, /ON CONFLICT \(event_id, team_id\) DO UPDATE/);
});

test('does not save when the student has no team for the event', async () => {
  const pool = createPool({ teamExists: false });
  const repository = createMySqlSubmissionRepository(pool);

  assert.equal(await repository.saveForUser('event-1', 12, {
    projectName: 'Campus Compass',
    description: 'A guide to campus resources.',
    repositoryUrl: '',
    demoUrl: '',
  }), false);
  assert.equal(pool.calls.some((call) => call.sql?.startsWith('INSERT INTO submissions')), false);
  assert.equal(pool.calls.at(-2).type, 'commit');
});
