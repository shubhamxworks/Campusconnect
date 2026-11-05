const crypto = require('node:crypto');
const express = require('express');

const CATEGORIES = new Set(['Hackathon', 'Workshop', 'Networking', 'Competition', 'Talk']);
const FORMATS = new Set(['In person', 'Online', 'Hybrid']);

function asyncRoute(handler) {
  return (request, response, next) => {
    Promise.resolve(handler(request, response, next)).catch(next);
  };
}

function validateEvent(body) {
  const title = typeof body?.title === 'string' ? body.title.trim() : '';
  const category = typeof body?.category === 'string' ? body.category : '';
  const summary = typeof body?.summary === 'string' ? body.summary.trim() : '';
  const description = typeof body?.description === 'string' ? body.description.trim() : '';
  const venue = typeof body?.venue === 'string' ? body.venue.trim() : '';
  const format = typeof body?.format === 'string' ? body.format : '';
  const organizer = typeof body?.organizer === 'string' ? body.organizer.trim() : '';
  const artwork = typeof body?.artwork === 'string' ? body.artwork.trim() : '✦';
  const tags = Array.isArray(body?.tags)
    ? body.tags
    : typeof body?.tags === 'string'
      ? body.tags.split(',')
      : [];
  const startsAt = typeof body?.startsAt === 'string' ? new Date(body.startsAt) : null;
  const endsAt = typeof body?.endsAt === 'string' ? new Date(body.endsAt) : null;
  const registrationDeadline = typeof body?.registrationDeadline === 'string'
    ? new Date(body.registrationDeadline)
    : null;
  const capacity = Number(body?.capacity);

  if (!title || title.length > 180) {
    return { error: 'Event title is required and must be 180 characters or fewer.' };
  }
  if (!CATEGORIES.has(category)) {
    return { error: 'Choose a supported event category.' };
  }
  if (!summary || summary.length > 300) {
    return { error: 'Event summary is required and must be 300 characters or fewer.' };
  }
  if (!description || description.length > 10000) {
    return { error: 'Event description is required and must be 10,000 characters or fewer.' };
  }
  if (!venue || venue.length > 180) {
    return { error: 'Event venue is required and must be 180 characters or fewer.' };
  }
  if (!FORMATS.has(format)) {
    return { error: 'Choose a supported event format.' };
  }
  if (!organizer || organizer.length > 160) {
    return { error: 'Organizer name is required and must be 160 characters or fewer.' };
  }
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > 100000) {
    return { error: 'Capacity must be a whole number between 1 and 100,000.' };
  }
  if (
    !startsAt || !endsAt || !registrationDeadline
    || !Number.isFinite(startsAt.getTime())
    || !Number.isFinite(endsAt.getTime())
    || !Number.isFinite(registrationDeadline.getTime())
  ) {
    return { error: 'Enter valid event start, end, and registration deadline dates.' };
  }
  if (endsAt < startsAt || registrationDeadline > startsAt) {
    return { error: 'The event must end after it starts, and registration must close before it starts.' };
  }
  if (!Array.isArray(tags) || tags.length > 12) {
    return { error: 'Enter no more than 12 event tags.' };
  }
  const cleanTags = tags.map((tag) => typeof tag === 'string' ? tag.trim() : '');
  if (cleanTags.some((tag) => !tag || tag.length > 40)) {
    return { error: 'Each event tag must be between 1 and 40 characters.' };
  }
  if (!artwork || artwork.length > 40) {
    return { error: 'Event artwork label must be between 1 and 40 characters.' };
  }

  return {
    event: {
      title,
      category,
      summary,
      description,
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      registrationDeadline: registrationDeadline.toISOString(),
      venue,
      format,
      organizer,
      capacity,
      tags: [...new Set(cleanTags)],
      artwork,
    },
  };
}

function createOrganizerEventRouter({
  repository,
  judgingRepository,
  requireAuthenticated,
  requireSameOrigin,
}) {
  const router = express.Router();
  const requireRepository = (_request, response, next) => {
    if (!repository) {
      response.status(503).json({ error: 'Organizer event management requires PostgreSQL to be configured.' });
      return;
    }
    next();
  };
  const requireOrganizer = (request, response, next) => {
    if (request.authUser.role !== 'organizer') {
      response.status(403).json({ error: 'Organizer access is required to manage events.' });
      return;
    }
    next();
  };
  const requireOrganizerAuth = [requireAuthenticated, requireOrganizer];

  router.get(
    '/events',
    requireRepository,
    ...requireOrganizerAuth,
    asyncRoute(async (request, response) => {
      response.json({ events: await repository.listForOrganizer(request.authUser.id) });
    }),
  );

  router.get(
    '/events/:eventId/judges',
    requireRepository,
    ...requireOrganizerAuth,
    asyncRoute(async (request, response) => {
      const judges = await judgingRepository.listJudgesForOrganizer(
        request.authUser.id,
        request.params.eventId,
      );
      if (judges === null) {
        response.status(404).json({ error: 'Event not found or you do not have permission to manage it.' });
        return;
      }
      response.json({ judges });
    }),
  );

  router.get(
    '/events/:eventId/results',
    requireRepository,
    ...requireOrganizerAuth,
    asyncRoute(async (request, response) => {
      const results = await judgingRepository.listResultsForOrganizer(
        request.authUser.id,
        request.params.eventId,
      );
      if (results === null) {
        response.status(404).json({ error: 'Event not found or you do not have permission to view results.' });
        return;
      }
      response.json({ results });
    }),
  );

  router.patch(
    '/events/:eventId/results',
    requireRepository,
    requireSameOrigin,
    ...requireOrganizerAuth,
    asyncRoute(async (request, response) => {
      if (typeof request.body?.published !== 'boolean') {
        response.status(400).json({ error: 'Published must be true or false.' });
        return;
      }
      const results = await judgingRepository.setResultsPublished(
        request.authUser.id,
        request.params.eventId,
        request.body.published,
      );
      if (results === null) {
        response.status(404).json({ error: 'Event not found or you do not have permission to manage results.' });
        return;
      }
      response.json({ results });
    }),
  );

  router.post(
    '/events/:eventId/judges',
    requireRepository,
    requireSameOrigin,
    ...requireOrganizerAuth,
    asyncRoute(async (request, response) => {
      const email = typeof request.body?.email === 'string'
        ? request.body.email.trim().toLowerCase()
        : '';
      if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        response.status(400).json({ error: 'Enter a valid judge email address.' });
        return;
      }
      const judge = await judgingRepository.assignJudge(
        request.authUser.id,
        request.params.eventId,
        email,
      );
      if (judge === null) {
        response.status(404).json({ error: 'Event not found or you do not have permission to manage it.' });
        return;
      }
      response.status(201).json({ judge });
    }),
  );

  router.delete(
    '/events/:eventId/judges/:judgeId',
    requireRepository,
    requireSameOrigin,
    ...requireOrganizerAuth,
    asyncRoute(async (request, response) => {
      if (!/^[1-9]\d*$/.test(request.params.judgeId)) {
        response.status(400).json({ error: 'Judge id must be a positive integer.' });
        return;
      }
      const removed = await judgingRepository.removeJudge(
        request.authUser.id,
        request.params.eventId,
        request.params.judgeId,
      );
      if (removed === null) {
        response.status(404).json({ error: 'Event not found or you do not have permission to manage it.' });
        return;
      }
      if (!removed) {
        response.status(404).json({ error: 'Judge assignment not found.' });
        return;
      }
      response.status(204).end();
    }),
  );

  router.get(
    '/events/:eventId/registrations',
    requireRepository,
    ...requireOrganizerAuth,
    asyncRoute(async (request, response) => {
      const registrations = await repository.listRegistrations(
        request.authUser.id,
        request.params.eventId,
      );
      if (registrations === null) {
        response.status(404).json({ error: 'Event not found or you do not have permission to view its registrations.' });
        return;
      }
      response.json({ registrations });
    }),
  );

  router.patch(
    '/events/:eventId/registrations/:registrationId/attended',
    requireRepository,
    requireSameOrigin,
    ...requireOrganizerAuth,
    asyncRoute(async (request, response) => {
      if (!/^[1-9]\d*$/.test(request.params.registrationId)) {
        response.status(400).json({ error: 'Registration id must be a positive integer.' });
        return;
      }
      const registration = await repository.markAttended(
        request.authUser.id,
        request.params.eventId,
        request.params.registrationId,
      );
      if (registration === null) {
        response.status(404).json({ error: 'Event not found or you do not have permission to manage it.' });
        return;
      }
      if (!registration) {
        response.status(404).json({ error: 'Registration not found for this event.' });
        return;
      }
      response.json({ registration });
    }),
  );

  router.post(
    '/events',
    requireRepository,
    requireSameOrigin,
    ...requireOrganizerAuth,
    asyncRoute(async (request, response) => {
      const { event, error } = validateEvent(request.body);
      if (error) {
        response.status(400).json({ error });
        return;
      }

      const base = event.title
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 72) || 'campus-event';
      event.id = `${base}-${crypto.randomBytes(4).toString('hex')}`;

      try {
        response.status(201).json({
          event: await repository.create(request.authUser.id, event),
        });
      } catch (createError) {
        if (createError.code === '23505') {
          response.status(409).json({ error: 'An event with that identifier already exists. Try again.' });
          return;
        }
        throw createError;
      }
    }),
  );

  router.put(
    '/events/:eventId',
    requireRepository,
    requireSameOrigin,
    ...requireOrganizerAuth,
    asyncRoute(async (request, response) => {
      const { event, error } = validateEvent(request.body);
      if (error) {
        response.status(400).json({ error });
        return;
      }
      const updated = await repository.update(request.authUser.id, request.params.eventId, event);
      if (!updated) {
        response.status(404).json({ error: 'Event not found or you do not have permission to edit it.' });
        return;
      }
      response.json({ event: updated });
    }),
  );

  return router;
}

module.exports = { createOrganizerEventRouter, validateEvent };
