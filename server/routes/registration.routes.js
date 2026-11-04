const express = require('express');

function asyncRoute(handler) {
  return (request, response, next) => {
    Promise.resolve(handler(request, response, next)).catch(next);
  };
}

function createRegistrationRouter({ repository, requireAuthenticated, requireSameOrigin }) {
  const router = express.Router();
  const requireRepository = (request, response, next) => {
    if (!repository) {
      response.status(503).json({ error: 'Event registration requires MySQL to be configured.' });
      return;
    }
    next();
  };

  router.get(
    '/:eventId/registration',
    requireRepository,
    requireAuthenticated,
    asyncRoute(async (request, response) => {
      const registration = await repository.get(request.params.eventId, request.authUser.id);
      if (registration === null && !(await repository.eventExists?.(request.params.eventId))) {
        response.status(404).json({ error: 'Event not found' });
        return;
      }
      response.json({ registration });
    }),
  );

  router.post(
    '/:eventId/registration',
    requireRepository,
    requireSameOrigin,
    requireAuthenticated,
    asyncRoute(async (request, response) => {
      const result = await repository.register(request.params.eventId, request.authUser.id);
      if (result === null) {
        response.status(404).json({ error: 'Event not found' });
        return;
      }
      response.status(result.created ? 201 : 200).json({
        registration: result.registration,
        message: result.registration.status === 'waitlisted'
          ? 'This event is full. You have been added to the waitlist.'
          : result.registration.status === 'attended'
            ? 'This event has already been marked as attended.'
            : result.created
              ? 'You are registered for this event.'
              : 'You are already registered for this event.',
      });
    }),
  );

  router.delete(
    '/:eventId/registration',
    requireRepository,
    requireSameOrigin,
    requireAuthenticated,
    asyncRoute(async (request, response) => {
      const result = await repository.cancel(request.params.eventId, request.authUser.id);
      if (result === null) {
        response.status(404).json({ error: 'Event not found' });
        return;
      }
      if (!result.registration) {
        response.status(404).json({ error: 'You do not have a registration for this event.' });
        return;
      }
      response.json({
        registration: result.registration,
        promotedWaitlist: Boolean(result.promotedWaitlist),
        message: !result.cancelled
          ? 'Your registration was already cancelled.'
          : result.promotedWaitlist
            ? 'Your registration has been cancelled. The next student on the waitlist has been promoted.'
            : 'Your registration has been cancelled.',
      });
    }),
  );

  return router;
}

module.exports = { createRegistrationRouter };
