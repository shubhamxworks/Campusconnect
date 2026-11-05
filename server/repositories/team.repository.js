const crypto = require('node:crypto');

class TeamError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.name = 'TeamError';
    this.statusCode = statusCode;
  }
}

function mapTeamRow(row, members) {
  return {
    id: Number(row.team_id),
    eventId: row.event_id,
    eventTitle: row.event_title,
    name: row.team_name,
    invitationCode: row.invitation_code,
    members: members.map((member) => ({
      id: Number(member.user_id),
      name: member.display_name,
    })),
  };
}

function createMySqlTeamRepository(pool, { randomBytes = crypto.randomBytes } = {}) {
  async function loadCurrentTeam(connection, eventId, userId) {
    const [teams] = await connection.execute(
      `SELECT t.team_id, t.event_id, t.team_name, t.invitation_code, e.title AS event_title
       FROM teams AS t
       INNER JOIN team_members AS current_member
         ON current_member.team_id = t.team_id AND current_member.event_id = t.event_id
       INNER JOIN events AS e ON e.event_id = t.event_id
       WHERE t.event_id = $1 AND current_member.user_id = $2
       LIMIT 1`,
      [eventId, userId],
    );
    if (teams.length === 0) {
      return null;
    }

    const [members] = await connection.execute(
      `SELECT u.user_id, u.display_name
       FROM team_members AS tm
       INNER JOIN users AS u ON u.user_id = tm.user_id
       WHERE tm.team_id = $1 AND tm.event_id = $2
       ORDER BY tm.joined_at ASC, u.user_id ASC`,
      [teams[0].team_id, eventId],
    );
    return mapTeamRow(teams[0], members);
  }

  async function lockEvent(connection, eventId) {
    const [events] = await connection.execute(
      'SELECT event_id FROM events WHERE event_id = $1 LIMIT 1 FOR UPDATE',
      [eventId],
    );
    return events.length > 0;
  }

  async function transaction(work) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const result = await work(connection);
      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  return {
    async getCurrentTeam(eventId, userId) {
      const team = await loadCurrentTeam(pool, eventId, userId);
      if (team) {
        return team;
      }
      const [events] = await pool.execute(
        'SELECT event_id FROM events WHERE event_id = $1 LIMIT 1',
        [eventId],
      );
      if (events.length === 0) {
        return undefined;
      }
      return null;
    },

    async createTeam(eventId, userId, name) {
      return transaction(async (connection) => {
        if (!(await lockEvent(connection, eventId))) {
          return undefined;
        }

        const [memberships] = await connection.execute(
          `SELECT team_id FROM team_members
           WHERE event_id = $1 AND user_id = $2 LIMIT 1`,
          [eventId, userId],
        );
        if (memberships.length > 0) {
          throw new TeamError('You already belong to a team for this event.', 409);
        }

        const invitationCode = randomBytes(16).toString('hex').toUpperCase();
        const [result] = await connection.execute(
          `INSERT INTO teams (event_id, team_name, invitation_code, created_by)
           VALUES ($1, $2, $3, $4)
           RETURNING team_id`,
          [eventId, name, invitationCode, userId],
        );
        await connection.execute(
          'INSERT INTO team_members (team_id, event_id, user_id) VALUES ($1, $2, $3)',
          [result.rows?.[0]?.team_id ?? result.insertId, eventId, userId],
        );
        return loadCurrentTeam(connection, eventId, userId);
      });
    },

    async joinTeam(eventId, userId, invitationCode) {
      return transaction(async (connection) => {
        if (!(await lockEvent(connection, eventId))) {
          return undefined;
        }

        const [teams] = await connection.execute(
          `SELECT team_id FROM teams
           WHERE event_id = $1 AND invitation_code = $2 LIMIT 1`,
          [eventId, invitationCode],
        );
        if (teams.length === 0) {
          throw new TeamError('Invitation code was not found for this event.', 404);
        }

        const teamId = teams[0].team_id;
        const [memberships] = await connection.execute(
          `SELECT team_id FROM team_members
           WHERE event_id = $1 AND user_id = $2 LIMIT 1`,
          [eventId, userId],
        );
        if (memberships.length > 0) {
          if (String(memberships[0].team_id) === String(teamId)) {
            return loadCurrentTeam(connection, eventId, userId);
          }
          throw new TeamError('You already belong to another team for this event.', 409);
        }

        await connection.execute(
          'INSERT INTO team_members (team_id, event_id, user_id) VALUES ($1, $2, $3)',
          [teamId, eventId, userId],
        );
        return loadCurrentTeam(connection, eventId, userId);
      });
    },

    async leaveTeam(eventId, userId) {
      return transaction(async (connection) => {
        if (!(await lockEvent(connection, eventId))) {
          return undefined;
        }

        const [memberships] = await connection.execute(
          `SELECT team_id FROM team_members
           WHERE event_id = $1 AND user_id = $2 LIMIT 1 FOR UPDATE`,
          [eventId, userId],
        );
        if (memberships.length === 0) {
          return false;
        }

        const teamId = memberships[0].team_id;
        await connection.execute(
          'DELETE FROM team_members WHERE team_id = $1 AND event_id = $2 AND user_id = $3',
          [teamId, eventId, userId],
        );
        const [remainingMembers] = await connection.execute(
          'SELECT user_id FROM team_members WHERE team_id = $1 LIMIT 1',
          [teamId],
        );
        if (remainingMembers.length === 0) {
          await connection.execute(
            'DELETE FROM teams WHERE team_id = $1 AND event_id = $2',
            [teamId, eventId],
          );
        }
        return true;
      });
    },
  };
}

module.exports = { createMySqlTeamRepository, TeamError };
