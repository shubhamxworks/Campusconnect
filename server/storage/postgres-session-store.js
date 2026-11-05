const session = require('express-session');

class PostgresSessionStore extends session.Store {
  constructor(pool, { pruneInterval = 15 * 60 * 1000 } = {}) {
    super();
    this.pool = pool;
    this.pruneTimer = setInterval(() => {
      this.prune().catch((error) => {
        console.error('Expired session cleanup failed:', error);
      });
    }, pruneInterval);
    this.pruneTimer.unref();
  }

  async get(sessionId, callback) {
    try {
      const [rows] = await this.pool.execute(
        'SELECT session_data, expires_at FROM user_sessions WHERE session_id = $1 LIMIT 1',
        [sessionId],
      );
      if (rows.length === 0) {
        callback(null, null);
        return;
      }

      if (Number(rows[0].expires_at) <= Date.now()) {
        await this.destroy(sessionId, callback);
        return;
      }

      callback(null, JSON.parse(rows[0].session_data));
    } catch (error) {
      callback(error);
    }
  }

  async set(sessionId, sessionData, callback = () => {}) {
    try {
      const expiresAt = this.getExpiration(sessionData);
      await this.pool.execute(
        `INSERT INTO user_sessions (session_id, expires_at, session_data)
         VALUES ($1, $2, $3)
         ON CONFLICT (session_id) DO UPDATE
         SET expires_at = EXCLUDED.expires_at, session_data = EXCLUDED.session_data`,
        [sessionId, expiresAt, JSON.stringify(sessionData)],
      );
      callback(null);
    } catch (error) {
      callback(error);
    }
  }

  async touch(sessionId, sessionData, callback = () => {}) {
    try {
      await this.pool.execute(
        'UPDATE user_sessions SET expires_at = $1 WHERE session_id = $2',
        [this.getExpiration(sessionData), sessionId],
      );
      callback(null);
    } catch (error) {
      callback(error);
    }
  }

  async destroy(sessionId, callback = () => {}) {
    try {
      await this.pool.execute('DELETE FROM user_sessions WHERE session_id = $1', [sessionId]);
      callback(null);
    } catch (error) {
      callback(error);
    }
  }

  async prune() {
    await this.pool.execute('DELETE FROM user_sessions WHERE expires_at <= $1', [Date.now()]);
  }

  close() {
    clearInterval(this.pruneTimer);
  }

  getExpiration(sessionData) {
    const expires = sessionData.cookie?.expires;
    if (expires) {
      return new Date(expires).getTime();
    }

    return Date.now() + (sessionData.cookie?.maxAge ?? 8 * 60 * 60 * 1000);
  }
}

module.exports = {
  PostgresSessionStore,
};
