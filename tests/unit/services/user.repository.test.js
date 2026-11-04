const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createUserRepository } = require('../../../server/repositories/user.repository');

test('updates a user display name with parameterized SQL and returns the user', async () => {
  const queries = [];
  const pool = {
    async execute(sql, values) {
      queries.push({ sql, values });
      if (sql.startsWith('SELECT user_id')) {
        return [[{
          user_id: 7,
          email: 'student@example.edu',
          display_name: 'Updated Student',
          role: 'student',
        }]];
      }
      return [{ affectedRows: 1 }];
    },
  };
  const users = createUserRepository(pool);

  const user = await users.updateDisplayName(7, 'Updated Student');

  assert.deepEqual(user, {
    id: 7,
    email: 'student@example.edu',
    displayName: 'Updated Student',
    role: 'student',
  });
  assert.deepEqual(queries, [
    {
      sql: 'UPDATE users SET display_name = ? WHERE user_id = ?',
      values: ['Updated Student', 7],
    },
    {
      sql: 'SELECT user_id, email, display_name, role FROM users WHERE user_id = ? LIMIT 1',
      values: [7],
    },
  ]);
});

test('returns null when the user no longer exists during a profile update', async () => {
  const pool = {
    async execute(sql) {
      if (sql.startsWith('SELECT user_id')) {
        return [[]];
      }
      return [{ affectedRows: 0 }];
    },
  };

  assert.equal(await createUserRepository(pool).updateDisplayName(7, 'Updated Student'), null);
});
