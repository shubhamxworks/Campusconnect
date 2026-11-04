function toUser(row) {
  if (!row) {
    return null;
  }

  return {
    id: Number(row.user_id),
    email: row.email,
    displayName: row.display_name,
    role: row.role,
  };
}

function createUserRepository(pool) {
  return {
    async findById(id) {
      const [rows] = await pool.execute(
        'SELECT user_id, email, display_name, role FROM users WHERE user_id = ? LIMIT 1',
        [id],
      );
      return toUser(rows[0]);
    },

    async updateDisplayName(id, displayName) {
      await pool.execute(
        'UPDATE users SET display_name = ? WHERE user_id = ?',
        [displayName, id],
      );
      return this.findById(id);
    },

    async findByEmailForLogin(email) {
      const [rows] = await pool.execute(
        'SELECT user_id, email, display_name, role, password_hash FROM users WHERE email = ? LIMIT 1',
        [email],
      );
      if (!rows[0]) {
        return null;
      }

      return {
        ...toUser(rows[0]),
        passwordHash: rows[0].password_hash,
      };
    },

    async createLocalUser({ email, displayName, passwordHash }) {
      const [result] = await pool.execute(
        `INSERT INTO users (email, display_name, password_hash, role)
         VALUES (?, ?, ?, 'student')`,
        [email, displayName, passwordHash],
      );
      return {
        id: Number(result.insertId),
        email,
        displayName,
        role: 'student',
      };
    },

    async findOrCreateFromGoogle({ subject, email, displayName, emailVerified }) {
      if (!subject || !email || !displayName || emailVerified !== true) {
        throw new Error('A verified Google email and profile are required to sign in.');
      }

      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();

        const [subjectRows] = await connection.execute(
          'SELECT user_id, email, display_name, role FROM users WHERE google_subject = ? LIMIT 1 FOR UPDATE',
          [subject],
        );
        if (subjectRows.length > 0) {
          await connection.execute(
            'UPDATE users SET email = ?, display_name = ? WHERE user_id = ?',
            [email, displayName, subjectRows[0].user_id],
          );
          await connection.commit();
          return toUser({
            ...subjectRows[0],
            email,
            display_name: displayName,
          });
        }

        const [emailRows] = await connection.execute(
          'SELECT user_id, google_subject, email, display_name, role FROM users WHERE email = ? LIMIT 1 FOR UPDATE',
          [email],
        );
        if (emailRows.length > 0) {
          if (emailRows[0].google_subject) {
            throw new Error('This email is already linked to another Google account.');
          }

          await connection.execute(
            'UPDATE users SET google_subject = ?, display_name = ? WHERE user_id = ?',
            [subject, displayName, emailRows[0].user_id],
          );
          await connection.commit();
          return toUser({
            ...emailRows[0],
            display_name: displayName,
          });
        }

        const [result] = await connection.execute(
          `INSERT INTO users (google_subject, email, display_name, role)
           VALUES (?, ?, ?, 'student')`,
          [subject, email, displayName],
        );
        await connection.commit();
        return {
          id: Number(result.insertId),
          email,
          displayName,
          role: 'student',
        };
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    },
  };
}

module.exports = { createUserRepository };
