const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createMySqlTeamRepository, TeamError } = require('../../../server/repositories/team.repository');

function createPool({ membershipRows = [], teamId = 12 } = {}) {
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
      if (sql.includes('FROM events')) return [[{ event_id: values[0], title: 'Build Day' }], []];
      if (sql.includes('FROM team_members') && sql.includes('SELECT team_id')) {
        return [membershipRows, []];
      }
      if (sql.includes('FROM teams') && sql.includes('SELECT team_id')) {
        return [[{ team_id: teamId }], []];
      }
      if (sql.includes('INSERT INTO teams')) return [{ insertId: teamId }, []];
      if (sql.includes('SELECT t.team_id')) {
        return [[{
          team_id: teamId,
          event_id: 'event-1',
          team_name: 'Build Crew',
          invitation_code: values[1] || 'B'.repeat(32),
          event_title: 'Build Day',
        }], []];
      }
      if (sql.includes('SELECT u.user_id')) return [[{ user_id: 5, display_name: 'Alex' }], []];
      return [{ affectedRows: 1 }, []];
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

test('creates a team and its creator membership transactionally with parameterized SQL', async () => {
  const pool = createPool();
  const repository = createMySqlTeamRepository(pool);
  const maliciousLookingEventId = "event-1' OR 1=1 --";
  const team = await repository.createTeam(maliciousLookingEventId, 5, 'Build Crew');

  assert.equal(team.id, 12);
  assert.equal(team.members[0].name, 'Alex');
  assert.equal(pool.calls[0].type, 'begin');
  assert.equal(pool.calls.at(-2).type, 'commit');
  assert.equal(pool.calls.at(-1).type, 'release');
  const lockQuery = pool.calls.find((call) => call.sql?.includes('FROM events'));
  assert.equal(lockQuery.values[0], maliciousLookingEventId);
  assert.equal(lockQuery.sql.includes(maliciousLookingEventId), false);
  const insertQuery = pool.calls.find((call) => call.sql?.includes('INSERT INTO teams'));
  assert.match(insertQuery.values[2], /^[A-F0-9]{32}$/);
  assert.deepEqual(insertQuery.values.slice(0, 2), [maliciousLookingEventId, 'Build Crew']);
  assert.ok(pool.calls.some((call) => call.sql?.includes('INSERT INTO team_members')));
});

test('rolls back a join when the student already belongs to a different team', async () => {
  const pool = createPool({ membershipRows: [{ team_id: 99 }] });
  const repository = createMySqlTeamRepository(pool);

  await assert.rejects(
    repository.joinTeam('event-1', 5, 'A'.repeat(32)),
    (error) => error instanceof TeamError && error.statusCode === 409,
  );
  assert.ok(pool.calls.some((call) => call.type === 'rollback'));
  assert.equal(pool.calls.some((call) => call.type === 'commit'), false);
  assert.equal(pool.calls.at(-1).type, 'release');
});
