const express = require('express');

const PROJECT_NAME_MAX_LENGTH = 100;
const DESCRIPTION_MAX_LENGTH = 5000;
const URL_MAX_LENGTH = 2048;

function asyncRoute(handler) {
  return (request, response, next) => {
    Promise.resolve(handler(request, response, next)).catch(next);
  };
}

function isOptionalWebUrl(value) {
  if (!value) {
    return true;
  }
  if (value.length > URL_MAX_LENGTH) {
    return false;
  }

  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password;
  } catch {
    return false;
  }
}

function createSubmissionRouter({ repository, requireAuthenticated, requireSameOrigin }) {
  const router = express.Router();
  const requireRepository = (_request, response, next) => {
    if (!repository) {
      response.status(503).json({ error: 'Project submissions require MySQL to be configured.' });
      return;
    }
    next();
  };
  const requireStudent = (request, response, next) => {
    if (request.authUser.role !== 'student') {
      response.status(403).json({ error: 'Only signed-in students can manage project submissions.' });
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
      const submission = await repository.getForUser(request.params.eventId, request.authUser.id);
      if (submission === undefined) {
        response.status(404).json({ error: 'Event not found.' });
        return;
      }
      if (submission === false) {
        response.status(403).json({ error: 'Join a team for this event before submitting a project.' });
        return;
      }
      response.json({ submission });
    }),
  );

  router.put(
    '/:eventId',
    requireRepository,
    requireSameOrigin,
    ...requireStudentAuth,
    asyncRoute(async (request, response) => {
      const projectName = typeof request.body?.projectName === 'string'
        ? request.body.projectName.trim()
        : '';
      const description = typeof request.body?.description === 'string'
        ? request.body.description.trim()
        : '';
      const repositoryUrl = typeof request.body?.repositoryUrl === 'string'
        ? request.body.repositoryUrl.trim()
        : '';
      const demoUrl = typeof request.body?.demoUrl === 'string'
        ? request.body.demoUrl.trim()
        : '';

      if (!projectName || projectName.length > PROJECT_NAME_MAX_LENGTH) {
        response.status(400).json({
          error: `Project name must be between 1 and ${PROJECT_NAME_MAX_LENGTH} characters.`,
        });
        return;
      }
      if (!description || description.length > DESCRIPTION_MAX_LENGTH) {
        response.status(400).json({
          error: `Project description must be between 1 and ${DESCRIPTION_MAX_LENGTH} characters.`,
        });
        return;
      }
      if (!isOptionalWebUrl(repositoryUrl) || !isOptionalWebUrl(demoUrl)) {
        response.status(400).json({ error: 'Project links must be valid HTTP or HTTPS URLs.' });
        return;
      }

      const submission = await repository.saveForUser(request.params.eventId, request.authUser.id, {
        projectName,
        description,
        repositoryUrl,
        demoUrl,
      });
      if (submission === undefined) {
        response.status(404).json({ error: 'Event not found.' });
        return;
      }
      if (submission === false) {
        response.status(403).json({ error: 'Join a team for this event before submitting a project.' });
        return;
      }
      response.json({ submission });
    }),
  );

  return router;
}

module.exports = { createSubmissionRouter, isOptionalWebUrl };
