const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createMySqlAdminRepository } = require('../../../server/repositories/admin.repository');

function createAdminPool({ admins = [1, 2], targetRole = 'student' } = {}) {
  const queries = [];
  let commits = 0;
  let rollbacks = 0;
  const connection = {
    async beginTransaction() {},
    async commit() { commits += 1; },
    async rollback() { rollbacks += 1; },
    release() {},
    async execute(sql, values = []) {
      queries.push({ sql, values });
      if (sql.includes('SELECT user_id, email, display_name, role')) {
        return [[{
          user_id: 8,
          email: 'account@example.edu',
          display_name: 'Campus Account',
          role: targetRole,
        }]];
      }
      if (sql.includes("WHERE role = 'admin'")) {
        return [admins.map((userId) => ({ user_id: userId }))];
      }
      if (sql.startsWith('UPDATE users')) return [{ affectedRows: 1 }];
      if (sql.includes('INSERT INTO admin_audit_logs')) return [{ affectedRows: 1 }];
      throw new Error(`Unexpected transaction query: ${sql}`);
    },
  };
  return {
    queries,
    connection,
    get commits() { return commits; },
    get rollbacks() { return rollbacks; },
    async getConnection() { return connection; },
  };
}

test('updates account roles and writes audit entries in the same transaction', async () => {
  const pool = createAdminPool();
  const repository = createMySqlAdminRepository(pool);

  const user = await repository.updateUserRole(1, 8, 'judge');

  assert.equal(user.role, 'judge');
  assert.equal(pool.commits, 1);
  assert.equal(pool.rollbacks, 0);
  const updateIndex = pool.queries.findIndex((query) => query.sql.startsWith('UPDATE users'));
  const auditIndex = pool.queries.findIndex((query) => query.sql.includes('INSERT INTO admin_audit_logs'));
  assert.ok(updateIndex >= 0);
  assert.ok(auditIndex > updateIndex);
  assert.deepEqual(pool.queries[auditIndex].values, [
    1,
    '8',
    JSON.stringify({ from: 'student', to: 'judge', email: 'account@example.edu' }),
  ]);
});

test('prevents demoting the last admin and rejects self role changes', async () => {
  const lastAdminPool = createAdminPool({ admins: [8], targetRole: 'admin' });
  const lastAdminRepository = createMySqlAdminRepository(lastAdminPool);
  await assert.rejects(lastAdminRepository.updateUserRole(1, 8, 'student'), {
    statusCode: 409,
    message: 'The last administrator cannot be demoted.',
  });
  assert.equal(lastAdminPool.queries.some((query) => query.sql.startsWith('UPDATE users')), false);
  assert.equal(lastAdminPool.rollbacks, 1);

  const repository = createMySqlAdminRepository(createAdminPool());
  await assert.rejects(repository.updateUserRole(1, 1, 'student'), {
    statusCode: 409,
    message: 'You cannot change your own administrator role.',
  });
});
