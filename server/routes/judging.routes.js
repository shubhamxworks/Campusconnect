const express = require('express');

function asyncRoute(handler) {
  return (request, response, next) => {
    Promise.resolve(handler(request, response, next)).catch(next);
  };
}

function createJudgingRouter({ repository, requireAuthenticated, requireSameOrigin }) {
  const router = express.Router();
  const requireJudge = (request, response, next) => {
    if (request.authUser.role !== 'judge') {
      response.status(403).json({ error: 'Judge access is required.' });
      return;
    }
    next();
  };
  const requireJudgeAuth = [requireAuthenticated, requireJudge];

  router.get(
    '/events',
    ...requireJudgeAuth,
    asyncRoute(async (request, response) => {
      response.json({ events: await repository.listAssignedEvents(request.authUser.id) });
    }),
  );

  router.get(
    '/events/:eventId/submissions',
    ...requireJudgeAuth,
    asyncRoute(async (request, response) => {
      const submissions = await repository.listSubmissionsForJudge(
        request.authUser.id,
        request.params.eventId,
      );
      if (submissions === null) {
        response.status(404).json({ error: 'You are not assigned to judge this event.' });
        return;
      }
      response.json({ submissions });
    }),
  );

  router.put(
    '/events/:eventId/submissions/:submissionId/evaluation',
    requireSameOrigin,
    ...requireJudgeAuth,
    asyncRoute(async (request, response) => {
      if (!/^[1-9]\d*$/.test(request.params.submissionId)) {
        response.status(400).json({ error: 'Submission id must be a positive integer.' });
        return;
      }
      const score = request.body?.score;
      const feedback = typeof request.body?.feedback === 'string'
        ? request.body.feedback.trim()
        : '';
      if (!Number.isInteger(score) || score < 0 || score > 100) {
        response.status(400).json({ error: 'Score must be a whole number from 0 to 100.' });
        return;
      }
      if (!feedback || feedback.length > 2000) {
        response.status(400).json({ error: 'Feedback is required and must be 2,000 characters or fewer.' });
        return;
      }

      const evaluation = await repository.saveEvaluation(
        request.authUser.id,
        request.params.eventId,
        request.params.submissionId,
        { score, feedback },
      );
      if (!evaluation) {
        response.status(404).json({ error: 'Submission not found or you are not assigned to judge it.' });
        return;
      }
      response.json({ evaluation });
    }),
  );

  return router;
}

module.exports = { createJudgingRouter };
