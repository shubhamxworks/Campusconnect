function toUtcIso(value) {
  if (value instanceof Date) {
    return value.toISOString();
  }

  const dateValue = String(value).replace(' ', 'T');
  return new Date(
    /(?:Z|[+-]\d{2}:\d{2})$/i.test(dateValue) ? dateValue : `${dateValue}Z`,
  ).toISOString();
}

function mapSubmission(row) {
  if (!row) {
    return null;
  }

  return {
    id: Number(row.submission_id),
    teamId: Number(row.team_id),
    teamName: row.team_name,
    projectName: row.project_name,
    description: row.description,
    repositoryUrl: row.repository_url,
    demoUrl: row.demo_url,
    submittedBy: Number(row.submitted_by),
    submittedAt: toUtcIso(row.created_at),
    updatedAt: toUtcIso(row.updated_at),
  };
}

function createMySqlSubmissionRepository(pool) {
  async function loadSubmission(connection, eventId, teamId) {
    const [rows] = await connection.execute(
      `SELECT
        s.submission_id,
        s.team_id,
        t.team_name,
        s.project_name,
        s.description,
        s.repository_url,
        s.demo_url,
        s.submitted_by,
        s.created_at,
        s.updated_at
       FROM submissions AS s
       INNER JOIN teams AS t
         ON t.team_id = s.team_id AND t.event_id = s.event_id
       WHERE s.event_id = $1 AND s.team_id = $2
       LIMIT 1`,
      [eventId, teamId],
    );
    return mapSubmission(rows[0]);
  }

  return {
    async getForUser(eventId, userId) {
      const [eventRows] = await pool.execute(
        'SELECT event_id FROM events WHERE event_id = $1 LIMIT 1',
        [eventId],
      );
      if (eventRows.length === 0) {
        return undefined;
      }

      const [teamRows] = await pool.execute(
        `SELECT t.team_id
         FROM teams AS t
         INNER JOIN team_members AS tm
           ON tm.team_id = t.team_id AND tm.event_id = t.event_id
         WHERE t.event_id = $1 AND tm.user_id = $2
         LIMIT 1`,
        [eventId, userId],
      );
      if (teamRows.length === 0) {
        return false;
      }

      const [rows] = await pool.execute(
        `SELECT
          s.submission_id,
          s.team_id,
          t.team_name,
          s.project_name,
          s.description,
          s.repository_url,
          s.demo_url,
          s.submitted_by,
          s.created_at,
          s.updated_at
         FROM submissions AS s
         INNER JOIN teams AS t
           ON t.team_id = s.team_id AND t.event_id = s.event_id
         WHERE s.event_id = $1 AND s.team_id = $2
         LIMIT 1`,
        [eventId, teamRows[0].team_id],
      );
      return mapSubmission(rows[0]);
    },

    async saveForUser(eventId, userId, submission) {
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();

        const [eventRows] = await connection.execute(
          'SELECT event_id FROM events WHERE event_id = $1 LIMIT 1 FOR UPDATE',
          [eventId],
        );
        if (eventRows.length === 0) {
          await connection.commit();
          return undefined;
        }

        const [teamRows] = await connection.execute(
          `SELECT t.team_id
           FROM teams AS t
           INNER JOIN team_members AS tm
             ON tm.team_id = t.team_id AND tm.event_id = t.event_id
           WHERE t.event_id = $1 AND tm.user_id = $2
           LIMIT 1
           FOR UPDATE`,
          [eventId, userId],
        );
        if (teamRows.length === 0) {
          await connection.commit();
          return false;
        }

        const teamId = teamRows[0].team_id;
        await connection.execute(
          `INSERT INTO submissions (
            event_id,
            team_id,
            submitted_by,
            project_name,
            description,
            repository_url,
            demo_url
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7)
          ON CONFLICT (event_id, team_id) DO UPDATE SET
            submitted_by = EXCLUDED.submitted_by,
            project_name = EXCLUDED.project_name,
            description = EXCLUDED.description,
            repository_url = EXCLUDED.repository_url,
            demo_url = EXCLUDED.demo_url,
            updated_at = CURRENT_TIMESTAMP`,
          [
            eventId,
            teamId,
            userId,
            submission.projectName,
            submission.description,
            submission.repositoryUrl,
            submission.demoUrl,
          ],
        );

        const saved = await loadSubmission(connection, eventId, teamId);
        await connection.commit();
        return saved;
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    },
  };
}

module.exports = { createMySqlSubmissionRepository, mapSubmission };
