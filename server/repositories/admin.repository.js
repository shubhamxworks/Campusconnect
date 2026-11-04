function toUtcIso(value) {
  if (value instanceof Date) return value.toISOString();
  const dateValue = String(value).replace(' ', 'T');
  return new Date(/(?:Z|[+-]\d{2}:\d{2})$/i.test(dateValue) ? dateValue : `${dateValue}Z`).toISOString();
}

function createMySqlAdminRepository(pool) {
  return {
    async getSummary() {
      const [[users], [events], [registrations], [judges]] = await Promise.all([
        pool.execute('SELECT COUNT(*) AS total, SUM(role = ?) AS organizers, SUM(role = ?) AS judges, SUM(role = ?) AS admins FROM users', ['organizer', 'judge', 'admin']),
        pool.execute('SELECT COUNT(*) AS total FROM events'),
        pool.execute(
          `SELECT
            COUNT(*) AS total,
            SUM(status = 'registered') AS registered,
            SUM(status = 'waitlisted') AS waitlisted,
            SUM(status = 'attended') AS attended
           FROM registrations`,
        ),
        pool.execute('SELECT COUNT(*) AS total FROM event_judges'),
      ]);
      return {
        users: {
          total: Number(users[0].total),
          organizers: Number(users[0].organizers || 0),
          judges: Number(users[0].judges || 0),
          admins: Number(users[0].admins || 0),
        },
        events: Number(events[0].total),
        registrations: {
          total: Number(registrations[0].total),
          registered: Number(registrations[0].registered || 0),
          waitlisted: Number(registrations[0].waitlisted || 0),
          attended: Number(registrations[0].attended || 0),
        },
        judgeAssignments: Number(judges[0].total),
      };
    },

    async listUsers({ query = '', role = '' } = {}) {
      const conditions = [];
      const values = [];
      if (query) {
        conditions.push('(display_name LIKE ? OR email LIKE ?)');
        values.push(`%${query}%`, `%${query}%`);
      }
      if (role) {
        conditions.push('role = ?');
        values.push(role);
      }
      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
      const [rows] = await pool.execute(
        `SELECT user_id, email, display_name, role, created_at
         FROM users
         ${where}
         ORDER BY created_at DESC, user_id DESC
         LIMIT 200`,
        values,
      );
      return rows.map((row) => ({
        id: Number(row.user_id),
        email: row.email,
        displayName: row.display_name,
        role: row.role,
        createdAt: toUtcIso(row.created_at),
      }));
    },

    async updateUserRole(actorId, userId, role) {
      if (Number(actorId) === Number(userId)) {
        const error = new Error('You cannot change your own administrator role.');
        error.statusCode = 409;
        throw error;
      }
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        const [users] = await connection.execute(
          `SELECT user_id, email, display_name, role
           FROM users
           WHERE user_id = ?
           LIMIT 1
           FOR UPDATE`,
          [userId],
        );
        if (users.length === 0) {
          await connection.commit();
          return null;
        }
        const current = users[0];
        if (current.role === 'admin' && role !== 'admin') {
          const [admins] = await connection.execute(
            `SELECT user_id
             FROM users
             WHERE role = 'admin'
             FOR UPDATE`,
          );
          if (admins.length <= 1) {
            const error = new Error('The last administrator cannot be demoted.');
            error.statusCode = 409;
            throw error;
          }
        }
        if (current.role !== role) {
          await connection.execute(
            'UPDATE users SET role = ? WHERE user_id = ?',
            [role, userId],
          );
          await connection.execute(
            `INSERT INTO admin_audit_logs (
              actor_id, action, target_type, target_id, details
            ) VALUES (?, 'user.role.updated', 'user', ?, ?)`,
            [actorId, String(userId), JSON.stringify({ from: current.role, to: role, email: current.email })],
          );
        }
        await connection.commit();
        return {
          id: Number(current.user_id),
          email: current.email,
          displayName: current.display_name,
          role,
        };
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    },

    async listEvents() {
      const [rows] = await pool.execute(
        `SELECT
          e.event_id,
          e.title,
          e.category,
          e.starts_at,
          e.ends_at,
          e.capacity,
          u.display_name AS organizer_name,
          u.email AS organizer_email,
          (SELECT COUNT(*) FROM registrations r WHERE r.event_id = e.event_id) AS registration_count,
          (SELECT COUNT(*) FROM submissions s WHERE s.event_id = e.event_id) AS submission_count,
          (SELECT COUNT(*) FROM event_judges j WHERE j.event_id = e.event_id) AS judge_count
         FROM events e
         LEFT JOIN users u ON u.user_id = e.organizer_id
         ORDER BY e.starts_at DESC, e.event_id ASC
         LIMIT 500`,
      );
      return rows.map((row) => ({
        id: row.event_id,
        title: row.title,
        category: row.category,
        startsAt: toUtcIso(row.starts_at),
        endsAt: toUtcIso(row.ends_at),
        capacity: Number(row.capacity),
        organizer: row.organizer_name
          ? { name: row.organizer_name, email: row.organizer_email }
          : null,
        registrationCount: Number(row.registration_count),
        submissionCount: Number(row.submission_count),
        judgeCount: Number(row.judge_count),
      }));
    },

    async listRegistrations(status = '') {
      const values = [];
      const where = status ? 'WHERE r.status = ?' : '';
      if (status) values.push(status);
      const [rows] = await pool.execute(
        `SELECT
          r.registration_id,
          r.event_id,
          e.title AS event_title,
          u.user_id,
          u.display_name,
          u.email,
          r.status,
          r.registered_at
         FROM registrations r
         INNER JOIN events e ON e.event_id = r.event_id
         INNER JOIN users u ON u.user_id = r.user_id
         ${where}
         ORDER BY r.registered_at DESC, r.registration_id DESC
         LIMIT 500`,
        values,
      );
      return rows.map((row) => ({
        id: Number(row.registration_id),
        eventId: row.event_id,
        eventTitle: row.event_title,
        userId: Number(row.user_id),
        displayName: row.display_name,
        email: row.email,
        status: row.status,
        registeredAt: toUtcIso(row.registered_at),
      }));
    },

    async getReports() {
      const [rows] = await pool.execute(
        `SELECT
          e.event_id,
          e.title,
          e.starts_at,
          e.capacity,
          (
            SELECT COUNT(*)
            FROM registrations r
            WHERE r.event_id = e.event_id AND r.status IN ('registered', 'attended')
          ) AS registered_count,
          (
            SELECT COUNT(*)
            FROM registrations r
            WHERE r.event_id = e.event_id AND r.status = 'waitlisted'
          ) AS waitlisted_count,
          (
            SELECT COUNT(*)
            FROM submissions s
            WHERE s.event_id = e.event_id
          ) AS submission_count,
          (
            SELECT COUNT(*)
            FROM event_judges ej
            WHERE ej.event_id = e.event_id
          ) AS judge_count,
          (
            SELECT ROUND(AVG(ev.score), 2)
            FROM submissions s
            INNER JOIN evaluations ev ON ev.submission_id = s.submission_id
            WHERE s.event_id = e.event_id
          ) AS average_score
         FROM events e
         ORDER BY e.starts_at DESC, e.title ASC
         LIMIT 500`,
      );
      return rows.map((row) => ({
        eventId: row.event_id,
        title: row.title,
        startsAt: toUtcIso(row.starts_at),
        capacity: Number(row.capacity),
        registeredCount: Number(row.registered_count),
        waitlistedCount: Number(row.waitlisted_count),
        submissionCount: Number(row.submission_count),
        judgeCount: Number(row.judge_count),
        averageScore: row.average_score === null ? null : Number(row.average_score),
      }));
    },

    async listAuditLogs() {
      const [rows] = await pool.execute(
        `SELECT
          l.audit_log_id,
          l.action,
          l.target_type,
          l.target_id,
          l.details,
          l.created_at,
          u.display_name AS actor_name,
          u.email AS actor_email
         FROM admin_audit_logs l
         LEFT JOIN users u ON u.user_id = l.actor_id
         ORDER BY l.created_at DESC, l.audit_log_id DESC
         LIMIT 200`,
      );
      return rows.map((row) => ({
        id: Number(row.audit_log_id),
        action: row.action,
        targetType: row.target_type,
        targetId: row.target_id,
        details: typeof row.details === 'string' ? JSON.parse(row.details) : row.details,
        createdAt: toUtcIso(row.created_at),
        actor: { name: row.actor_name || 'Deleted administrator', email: row.actor_email || '' },
      }));
    },

    async getSettings() {
      const [[database], [roles]] = await Promise.all([
        pool.execute('SELECT DATABASE() AS name'),
        pool.execute('SELECT role, COUNT(*) AS total FROM users GROUP BY role'),
      ]);
      return {
        database: database[0].name,
        roles: roles.map((row) => ({ role: row.role, count: Number(row.total) })),
        supportedRoles: ['student', 'organizer', 'judge', 'admin'],
      };
    },
  };
}

module.exports = { createMySqlAdminRepository };
