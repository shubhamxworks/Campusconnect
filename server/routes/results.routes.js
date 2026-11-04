const express = require('express');

function asyncRoute(handler) {
  return (request, response, next) => {
    Promise.resolve(handler(request, response, next)).catch(next);
  };
}

function createResultsRouter(repository) {
  const router = express.Router();
  const requireRepository = (_request, response, next) => {
    if (!repository) {
      response.status(503).json({ error: 'Event results require MySQL to be configured.' });
      return;
    }
    next();
  };

  router.get(
    '/events',
    requireRepository,
    asyncRoute(async (_request, response) => {
      response.json({ events: await repository.listPublishedEvents() });
    }),
  );

  router.get(
    '/events/:eventId',
    requireRepository,
    asyncRoute(async (request, response) => {
      const results = await repository.getPublishedResults(request.params.eventId);
      if (!results) {
        response.status(404).json({ error: 'Published results were not found.' });
        return;
      }
      response.json({ results });
    }),
  );

  return router;
}

module.exports = { createResultsRouter };
