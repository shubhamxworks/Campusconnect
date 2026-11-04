const express = require('express');

function asyncRoute(handler) {
  return (request, response, next) => {
    Promise.resolve(handler(request, response, next)).catch(next);
  };
}

function createMyEventsRouter({ repository, requireAuthenticated }) {
  const router = express.Router();

  router.get(
    '/',
    requireAuthenticated,
    asyncRoute(async (request, response) => {
      if (!repository) {
        response.status(503).json({ error: 'Your event registrations require MySQL to be configured.' });
        return;
      }

      response.json({ events: await repository.listForUser(request.authUser.id) });
    }),
  );

  return router;
}

module.exports = { createMyEventsRouter };
