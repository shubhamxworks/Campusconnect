const express = require('express');

const ROLES = new Set(['student', 'organizer', 'judge', 'admin']);
const REGISTRATION_STATUSES = new Set(['registered', 'waitlisted', 'attended', 'cancelled']);

function asyncRoute(handler) {
  return (request, response, next) => {
    Promise.resolve(handler(request, response, next)).catch(next);
  };
}

function createAdminRouter({ repository, requireAuthenticated, requireSameOrigin }) {
  const router = express.Router();
  const requireRepository = (_request, response, next) => {
    if (!repository) {
      response.status(503).json({ error: 'Admin tools require PostgreSQL to be configured.' });
      return;
    }
    next();
  };
  const requireAdmin = (request, response, next) => {
    if (request.authUser.role !== 'admin') {
      response.status(403).json({ error: 'Administrator access is required.' });
      return;
    }
    next();
  };
  const adminOnly = [requireRepository, requireAuthenticated, requireAdmin];

  router.get('/summary', ...adminOnly, asyncRoute(async (_request, response) => {
    response.json({ summary: await repository.getSummary() });
  }));

  router.get('/users', ...adminOnly, asyncRoute(async (request, response) => {
    const query = typeof request.query.q === 'string' ? request.query.q.trim() : '';
    const role = typeof request.query.role === 'string' ? request.query.role : '';
    if (query.length > 120) {
      response.status(400).json({ error: 'Search must be 120 characters or fewer.' });
      return;
    }
    if (role && !ROLES.has(role)) {
      response.status(400).json({ error: 'Choose a supported account role.' });
      return;
    }
    response.json({ users: await repository.listUsers({ query, role }) });
  }));

  router.patch(
    '/users/:userId/role',
    requireRepository,
    requireSameOrigin,
    requireAuthenticated,
    requireAdmin,
    asyncRoute(async (request, response) => {
      if (!/^[1-9]\d*$/.test(request.params.userId)) {
        response.status(400).json({ error: 'User id must be a positive integer.' });
        return;
      }
      const { role } = request.body || {};
      if (typeof role !== 'string' || !ROLES.has(role)) {
        response.status(400).json({ error: 'Choose a supported account role.' });
        return;
      }
      const user = await repository.updateUserRole(
        request.authUser.id,
        request.params.userId,
        role,
      );
      if (!user) {
        response.status(404).json({ error: 'User not found.' });
        return;
      }
      response.json({ user });
    }),
  );

  router.get('/events', ...adminOnly, asyncRoute(async (_request, response) => {
    response.json({ events: await repository.listEvents() });
  }));

  router.get('/registrations', ...adminOnly, asyncRoute(async (request, response) => {
    const status = typeof request.query.status === 'string' ? request.query.status : '';
    if (status && !REGISTRATION_STATUSES.has(status)) {
      response.status(400).json({ error: 'Choose a supported registration status.' });
      return;
    }
    response.json({ registrations: await repository.listRegistrations(status) });
  }));

  router.get('/reports', ...adminOnly, asyncRoute(async (_request, response) => {
    response.json({ reports: await repository.getReports() });
  }));

  router.get('/audit-logs', ...adminOnly, asyncRoute(async (_request, response) => {
    response.json({ logs: await repository.listAuditLogs() });
  }));

  router.get('/settings', ...adminOnly, asyncRoute(async (_request, response) => {
    response.json({ settings: await repository.getSettings() });
  }));

  return router;
}

module.exports = { createAdminRouter, REGISTRATION_STATUSES, ROLES };
