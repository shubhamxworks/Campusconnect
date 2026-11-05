const express = require('express');

const TEAM_NAME_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N} '&-]*$/u;
const INVITATION_CODE_PATTERN = /^[A-F0-9]{32}$/;

function asyncRoute(handler) {
  return (request, response, next) => {
    Promise.resolve(handler(request, response, next)).catch(next);
  };
}

function createTeamRouter({ repository, requireAuthenticated, requireSameOrigin }) {
  const router = express.Router();
  const requireRepository = (_request, response, next) => {
    if (!repository) {
      response.status(503).json({ error: 'Team management requires PostgreSQL to be configured.' });
      return;
    }
    next();
  };
  const requireStudent = (request, response, next) => {
    if (request.authUser.role !== 'student') {
      response.status(403).json({ error: 'Only signed-in students can manage teams.' });
      return;
    }
    next();
  };
  const requireStudentAuth = [requireAuthenticated, requireStudent];

  router.get(
    '/:eventId',
    requireRepository,
    ...requireStudentAuth,
    asyncRoute(async (request, response) => {
      const team = await repository.getCurrentTeam(request.params.eventId, request.authUser.id);
      if (team === undefined) {
        response.status(404).json({ error: 'Event not found.' });
        return;
      }
      response.json({ team });
    }),
  );

  router.post(
    '/:eventId',
    requireRepository,
    requireSameOrigin,
    ...requireStudentAuth,
    asyncRoute(async (request, response) => {
      const name = typeof request.body?.name === 'string' ? request.body.name.trim() : '';
      if (
        name.length < 2
        || name.length > 50
        || !TEAM_NAME_PATTERN.test(name)
        || / {2,}/.test(name)
      ) {
        response.status(400).json({
          error: 'Team name must be 2–50 characters using letters, numbers, spaces, apostrophes, ampersands, or hyphens.',
        });
        return;
      }

      const team = await repository.createTeam(request.params.eventId, request.authUser.id, name);
      if (team === undefined) {
        response.status(404).json({ error: 'Event not found.' });
        return;
      }
      response.status(201).json({ team });
    }),
  );

  router.post(
    '/:eventId/join',
    requireRepository,
    requireSameOrigin,
    ...requireStudentAuth,
    asyncRoute(async (request, response) => {
      const invitationCode = typeof request.body?.invitationCode === 'string'
        ? request.body.invitationCode.trim().toUpperCase()
        : '';
      if (!INVITATION_CODE_PATTERN.test(invitationCode)) {
        response.status(400).json({ error: 'Enter a valid 32-character invitation code.' });
        return;
      }

      const team = await repository.joinTeam(
        request.params.eventId,
        request.authUser.id,
        invitationCode,
      );
      if (team === undefined) {
        response.status(404).json({ error: 'Event not found.' });
        return;
      }
      response.json({ team });
    }),
  );

  router.delete(
    '/:eventId',
    requireRepository,
    requireSameOrigin,
    ...requireStudentAuth,
    asyncRoute(async (request, response) => {
      const left = await repository.leaveTeam(request.params.eventId, request.authUser.id);
      if (left === undefined) {
        response.status(404).json({ error: 'Event not found.' });
        return;
      }
      if (!left) {
        response.status(404).json({ error: 'You are not on a team for this event.' });
        return;
      }
      response.json({ team: null });
    }),
  );

  return router;
}

module.exports = { createTeamRouter };
