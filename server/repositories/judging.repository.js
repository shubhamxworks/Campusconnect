function toUtcIso(value) {
  if (value instanceof Date) {
    return value.toISOString();
  }
  const dateValue = String(value).replace(' ', 'T');
  return new Date(/(?:Z|[+-]\d{2}:\d{2})$/i.test(dateValue) ? dateValue : `${dateValue}Z`).toISOString();
}

function mapEvaluation(row) {
  if (!row?.evaluation_id) {
    return null;
  }
  return {
    id: Number(row.evaluation_id),
    score: Number(row.score),
    feedback: row.feedback,
    updatedAt: toUtcIso(row.updated_at),
  };
}

function mapResult(row, rank) {
  return {
    rank,
    teamName: row.team_name,
    projectName: row.project_name,
    averageScore: row.average_score === null ? null : Number(row.average_score),
    evaluationCount: Number(row.evaluation_count),
  };
}

function createMySqlJudgingRepository(pool, { sendPush = async () => {} } = {}) {
  async function sendPushSafely(userId, notification) {
    try {
      await sendPush(userId, notification);
    } catch (error) {
      console.error('Browser push notification could not be delivered:', error);
    }
  }

  async function loadResults(connection, eventId, { scoredOnly = false } = {}) {
    const [rows] = await connection.execute(
      `SELECT
        t.team_name,
        s.project_name,
        ROUND(AVG(e.score), 2) AS average_score,
        COUNT(e.evaluation_id) AS evaluation_count
       FROM submissions AS s
       INNER JOIN teams AS t
         ON t.team_id = s.team_id AND t.event_id = s.event_id
       LEFT JOIN evaluations AS e ON e.submission_id = s.submission_id
       WHERE s.event_id = $1
       GROUP BY s.submission_id, t.team_name, s.project_name
       ${scoredOnly ? 'HAVING COUNT(e.evaluation_id) > 0' : ''}
       ORDER BY average_score DESC, t.team_name ASC, s.project_name ASC`,
      [eventId],
    );
    return rows.map((row, index) => mapResult(row, index + 1));
  }

  return {
    async assignJudge(organizerId, eventId, email) {
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        const [events] = await connection.execute(
          'SELECT event_id FROM events WHERE event_id = $1 AND organizer_id = $2 LIMIT 1 FOR UPDATE',
          [eventId, organizerId],
        );
        if (events.length === 0) {
          await connection.commit();
          return null;
        }

        const [judges] = await connection.execute(
          `SELECT user_id, display_name, email
           FROM users
           WHERE email = $1 AND role = 'judge'
           LIMIT 1
           FOR UPDATE`,
          [email],
        );
        if (judges.length === 0) {
          const error = new Error('No judge account was found with that email.');
          error.statusCode = 404;
          throw error;
        }
        await connection.execute(
          `INSERT INTO event_judges (event_id, judge_id, assigned_by)
           VALUES ($1, $2, $3)
           ON CONFLICT (event_id, judge_id) DO UPDATE SET assigned_by = EXCLUDED.assigned_by`,
          [eventId, judges[0].user_id, organizerId],
        );
        await connection.commit();
        return {
          id: Number(judges[0].user_id),
          displayName: judges[0].display_name,
          email: judges[0].email,
        };
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    },

    async listJudgesForOrganizer(organizerId, eventId) {
      const [events] = await pool.execute(
        'SELECT event_id FROM events WHERE event_id = $1 AND organizer_id = $2 LIMIT 1',
        [eventId, organizerId],
      );
      if (events.length === 0) {
        return null;
      }

      const [rows] = await pool.execute(
        `SELECT u.user_id, u.display_name, u.email
         FROM event_judges AS ej
         INNER JOIN users AS u ON u.user_id = ej.judge_id
         WHERE ej.event_id = $1
         ORDER BY u.display_name ASC`,
        [eventId],
      );
      return rows.map((row) => ({
        id: Number(row.user_id),
        displayName: row.display_name,
        email: row.email,
      }));
    },

    async removeJudge(organizerId, eventId, judgeId) {
      const [events] = await pool.execute(
        'SELECT event_id FROM events WHERE event_id = $1 AND organizer_id = $2 LIMIT 1',
        [eventId, organizerId],
      );
      if (events.length === 0) {
        return null;
      }
      const [result] = await pool.execute(
        'DELETE FROM event_judges WHERE event_id = $1 AND judge_id = $2',
        [eventId, judgeId],
      );
      return result.affectedRows > 0;
    },

    async listAssignedEvents(judgeId) {
      const [rows] = await pool.execute(
        `SELECT e.event_id, e.title, e.starts_at, e.ends_at,
          COUNT(DISTINCT s.submission_id) AS submission_count,
          COUNT(DISTINCT CASE WHEN mine.evaluation_id IS NOT NULL THEN s.submission_id END) AS evaluated_count
         FROM event_judges AS ej
         INNER JOIN events AS e ON e.event_id = ej.event_id
         LEFT JOIN submissions AS s ON s.event_id = e.event_id
         LEFT JOIN evaluations AS mine
           ON mine.submission_id = s.submission_id AND mine.judge_id = ej.judge_id
         WHERE ej.judge_id = $1
         GROUP BY e.event_id, e.title, e.starts_at, e.ends_at
         ORDER BY e.starts_at ASC`,
        [judgeId],
      );
      return rows.map((row) => ({
        id: row.event_id,
        title: row.title,
        startsAt: toUtcIso(row.starts_at),
        endsAt: toUtcIso(row.ends_at),
        submissionCount: Number(row.submission_count),
        evaluatedCount: Number(row.evaluated_count),
      }));
    },

    async listSubmissionsForJudge(judgeId, eventId) {
      const [assigned] = await pool.execute(
        'SELECT event_id FROM event_judges WHERE event_id = $1 AND judge_id = $2 LIMIT 1',
        [eventId, judgeId],
      );
      if (assigned.length === 0) {
        return null;
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
          s.updated_at AS submitted_at,
          evaluation.evaluation_id,
          evaluation.score,
          evaluation.feedback,
          evaluation.updated_at AS evaluation_updated_at
         FROM submissions AS s
         INNER JOIN teams AS t
           ON t.team_id = s.team_id AND t.event_id = s.event_id
         LEFT JOIN evaluations AS evaluation
           ON evaluation.submission_id = s.submission_id AND evaluation.judge_id = $1
         WHERE s.event_id = $2
         ORDER BY s.created_at ASC, s.submission_id ASC`,
        [judgeId, eventId],
      );
      return rows.map((row) => ({
        id: Number(row.submission_id),
        teamId: Number(row.team_id),
        teamName: row.team_name,
        projectName: row.project_name,
        description: row.description,
        repositoryUrl: row.repository_url,
        demoUrl: row.demo_url,
        submittedAt: toUtcIso(row.submitted_at),
        evaluation: mapEvaluation({
          evaluation_id: row.evaluation_id,
          score: row.score,
          feedback: row.feedback,
          updated_at: row.evaluation_updated_at,
        }),
      }));
    },

    async saveEvaluation(judgeId, eventId, submissionId, { score, feedback }) {
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        const [assigned] = await connection.execute(
          `SELECT s.submission_id
           FROM event_judges AS ej
           INNER JOIN submissions AS s ON s.event_id = ej.event_id
           WHERE ej.event_id = $1 AND ej.judge_id = $2 AND s.submission_id = $3
           LIMIT 1
           FOR UPDATE`,
          [eventId, judgeId, submissionId],
        );
        if (assigned.length === 0) {
          await connection.commit();
          return null;
        }

        await connection.execute(
          `INSERT INTO evaluations (submission_id, judge_id, score, feedback)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (submission_id, judge_id) DO UPDATE SET
             score = EXCLUDED.score,
             feedback = EXCLUDED.feedback,
             updated_at = CURRENT_TIMESTAMP`,
          [submissionId, judgeId, score, feedback],
        );
        const [rows] = await connection.execute(
          `SELECT evaluation_id, score, feedback, updated_at
           FROM evaluations
           WHERE submission_id = $1 AND judge_id = $2
           LIMIT 1`,
          [submissionId, judgeId],
        );
        await connection.commit();
        return mapEvaluation(rows[0]);
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    },

    async listResultsForOrganizer(organizerId, eventId) {
      const [events] = await pool.execute(
        `SELECT event_id, title, results_published_at
         FROM events
         WHERE event_id = $1 AND organizer_id = $2
         LIMIT 1`,
        [eventId, organizerId],
      );
      if (events.length === 0) {
        return null;
      }
      const results = await loadResults(pool, eventId);
      return {
        eventId: events[0].event_id,
        eventTitle: events[0].title,
        publishedAt: events[0].results_published_at
          ? toUtcIso(events[0].results_published_at)
          : null,
        canPublish: results.length > 0 && results.every((result) => result.evaluationCount > 0),
        results,
      };
    },

    async setResultsPublished(organizerId, eventId, published) {
      const connection = await pool.getConnection();
      let notificationRecipients = [];
      try {
        await connection.beginTransaction();
        const [events] = await connection.execute(
          `SELECT event_id, title, results_published_at
           FROM events
           WHERE event_id = $1 AND organizer_id = $2
           LIMIT 1
           FOR UPDATE`,
          [eventId, organizerId],
        );
        if (events.length === 0) {
          await connection.commit();
          return null;
        }

        if (published) {
          const [counts] = await connection.execute(
            `SELECT
              COUNT(DISTINCT s.submission_id) AS submission_count,
              COUNT(DISTINCT CASE
                WHEN e.evaluation_id IS NOT NULL THEN s.submission_id
              END) AS evaluated_submission_count
             FROM submissions AS s
             LEFT JOIN evaluations AS e ON e.submission_id = s.submission_id
             WHERE s.event_id = $1`,
            [eventId],
          );
          const submissionCount = Number(counts[0].submission_count);
          const evaluatedCount = Number(counts[0].evaluated_submission_count);
          if (submissionCount === 0 || submissionCount !== evaluatedCount) {
            const error = new Error(
              'Every submission must have at least one judge evaluation before results can be published.',
            );
            error.statusCode = 409;
            throw error;
          }
        }

        await connection.execute(
          `UPDATE events
           SET results_published_at = CASE WHEN $1 THEN CURRENT_TIMESTAMP ELSE NULL END
           WHERE event_id = $2 AND organizer_id = $3`,
          [published, eventId, organizerId],
        );
        if (published && !events[0].results_published_at) {
          await connection.execute(
            `INSERT INTO notifications (
              user_id, event_id, notification_type, title, message
            )
            SELECT
              r.user_id,
              e.event_id,
              'results_published',
              'Event results are live',
              'Results for ' || e.title || ' are now published. Visit the event leaderboard to see the rankings.'
            FROM registrations AS r
            INNER JOIN events AS e ON e.event_id = r.event_id
            WHERE r.event_id = $1
              AND r.status IN ('registered', 'attended')`,
            [eventId],
          );
          const [recipients] = await connection.execute(
            `SELECT user_id
             FROM registrations
             WHERE event_id = $1 AND status IN ('registered', 'attended')`,
            [eventId],
          );
          notificationRecipients = recipients.map((recipient) => recipient.user_id);
        }
        const results = await loadResults(connection, eventId);
        const [publishedRows] = await connection.execute(
          'SELECT results_published_at FROM events WHERE event_id = $1 LIMIT 1',
          [eventId],
        );
        await connection.commit();
        await Promise.all(notificationRecipients.map((userId) => sendPushSafely(userId, {
          title: 'Event results are live',
          body: `Results for ${events[0].title} are now published. Visit the event leaderboard to see the rankings.`,
          url: `/leaderboard.html?event=${encodeURIComponent(eventId)}`,
        })));
        return {
          eventId: events[0].event_id,
          eventTitle: events[0].title,
          publishedAt: publishedRows[0].results_published_at
            ? toUtcIso(publishedRows[0].results_published_at)
            : null,
          canPublish: results.length > 0 && results.every((result) => result.evaluationCount > 0),
          results,
        };
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    },

    async listPublishedEvents() {
      const [rows] = await pool.execute(
        `SELECT event_id, title, starts_at
         FROM events
         WHERE results_published_at IS NOT NULL
         ORDER BY starts_at DESC, title ASC`,
      );
      return rows.map((row) => ({
        id: row.event_id,
        title: row.title,
        startsAt: toUtcIso(row.starts_at),
      }));
    },

    async getPublishedResults(eventId) {
      const [events] = await pool.execute(
        `SELECT event_id, title, results_published_at
         FROM events
         WHERE event_id = $1 AND results_published_at IS NOT NULL
         LIMIT 1`,
        [eventId],
      );
      if (events.length === 0) {
        return null;
      }
      return {
        eventId: events[0].event_id,
        eventTitle: events[0].title,
        publishedAt: toUtcIso(events[0].results_published_at),
        results: await loadResults(pool, eventId, { scoredOnly: true }),
      };
    },
  };
}

module.exports = { createMySqlJudgingRepository, mapEvaluation, mapResult };
