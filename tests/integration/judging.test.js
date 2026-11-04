const assert = require('node:assert/strict');
const express = require('express');
const { after, before, test } = require('node:test');
const { isSameOrigin } = require('../../server/routes/auth.routes');
const { createJudgingRouter } = require('../../server/routes/judging.routes');
const { createOrganizerEventRouter } = require('../../server/routes/organizer-event.routes');
const { createResultsRouter } = require('../../server/routes/results.routes');

let server;
let baseUrl;
const events = new Map([
  ['event-one', { id: 'event-one', organizerId: 1, title: 'Build Night' }],
]);
const users = new Map([
  ['judge@example.edu', { id: 2, displayName: 'Judge One', email: 'judge@example.edu' }],
]);
const assignments = new Map();
const submissions = [{
  id: 31,
  teamName: 'Team Alpha',
  projectName: 'Campus Helper',
  description: 'A project description.',
  repositoryUrl: 'https://example.edu/repo',
  demoUrl: '',
}];
const evaluations = new Map();
const publishedEvents = new Set();
const resultNotifications = [];
const resultParticipants = [
  { userId: 10, status: 'registered' },
  { userId: 11, status: 'attended' },
  { userId: 12, status: 'waitlisted' },
  { userId: 13, status: 'cancelled' },
];

const emptyOrganizerRepository = {
  async listForOrganizer() { return []; },
  async listRegistrations() { return []; },
  async markAttended() { return null; },
  async create() { return null; },
  async update() { return null; },
};

const judgingRepository = {
  async listJudgesForOrganizer(organizerId, eventId) {
    const event = events.get(eventId);
    if (!event || event.organizerId !== organizerId) return null;
    return [...(assignments.get(eventId) ?? [])];
  },
  async assignJudge(organizerId, eventId, email) {
    const event = events.get(eventId);
    if (!event || event.organizerId !== organizerId) return null;
    const judge = users.get(email);
    if (!judge) {
      const error = new Error('No judge account was found with that email.');
      error.statusCode = 404;
      throw error;
    }
    const assigned = assignments.get(eventId) ?? [];
    if (!assigned.some((item) => item.id === judge.id)) assigned.push(judge);
    assignments.set(eventId, assigned);
    return judge;
  },
  async removeJudge(organizerId, eventId, judgeId) {
    const event = events.get(eventId);
    if (!event || event.organizerId !== organizerId) return null;
    const assigned = assignments.get(eventId) ?? [];
    const remaining = assigned.filter((judge) => judge.id !== Number(judgeId));
    assignments.set(eventId, remaining);
    return remaining.length !== assigned.length;
  },
  async listAssignedEvents(judgeId) {
    return [...assignments.entries()]
      .filter(([, judges]) => judges.some((judge) => judge.id === judgeId))
      .map(([id]) => ({ id, title: events.get(id).title, startsAt: '2027-01-10T09:00:00.000Z' }));
  },
  async listSubmissionsForJudge(judgeId, eventId) {
    if (!(assignments.get(eventId) ?? []).some((judge) => judge.id === judgeId)) return null;
    return submissions.map((submission) => ({
      ...submission,
      evaluation: evaluations.get(`${eventId}:${submission.id}:${judgeId}`) ?? null,
    }));
  },
  async saveEvaluation(judgeId, eventId, submissionId, evaluation) {
    const isAssigned = (assignments.get(eventId) ?? [])
      .some((judge) => judge.id === judgeId);
    const submission = submissions.find((item) => item.id === Number(submissionId));
    if (!isAssigned || !submission || !events.has(eventId)) return null;
    const saved = { id: 1, ...evaluation, updatedAt: '2027-01-10T10:00:00.000Z' };
    evaluations.set(`${eventId}:${submissionId}:${judgeId}`, saved);
    return saved;
  },
  async listResultsForOrganizer(organizerId, eventId) {
    const event = events.get(eventId);
    if (!event || event.organizerId !== organizerId) return null;
    const results = [...submissions].map((submission, index) => {
      const entries = [...evaluations.entries()]
        .filter(([key]) => key.startsWith(`${eventId}:${submission.id}:`))
        .map(([, value]) => value);
      return {
        rank: index + 1,
        teamName: submission.teamName,
        projectName: submission.projectName,
        averageScore: entries.length
          ? entries.reduce((sum, entry) => sum + entry.score, 0) / entries.length
          : null,
        evaluationCount: entries.length,
      };
    });
    const isPublished = publishedEvents.has(eventId);
    return {
      eventId,
      eventTitle: event.title,
      publishedAt: isPublished ? '2027-01-10T10:00:00.000Z' : null,
      canPublish: results.length > 0 && results.every((result) => result.evaluationCount > 0),
      results,
    };
  },
  async setResultsPublished(organizerId, eventId, published) {
    const result = await this.listResultsForOrganizer(organizerId, eventId);
    if (!result) return null;
    if (published && !result.canPublish) {
      const error = new Error('Every submission must have at least one judge evaluation before results can be published.');
      error.statusCode = 409;
      throw error;
    }
    if (published) {
      if (!publishedEvents.has(eventId)) {
        resultNotifications.push(...resultParticipants
          .filter((participant) => ['registered', 'attended'].includes(participant.status))
          .map((participant) => ({
            userId: participant.userId,
            eventId,
            type: 'results_published',
          })));
      }
      publishedEvents.add(eventId);
    } else {
      publishedEvents.delete(eventId);
    }
    return this.listResultsForOrganizer(organizerId, eventId);
  },
  async listPublishedEvents() {
    return [...publishedEvents].map((id) => ({
      id,
      title: events.get(id).title,
      startsAt: '2027-01-10T09:00:00.000Z',
    }));
  },
  async getPublishedResults(eventId) {
    if (!publishedEvents.has(eventId)) return null;
    return this.listResultsForOrganizer(events.get(eventId).organizerId, eventId);
  },
};

function requireAuthenticated(request, response, next) {
  const userId = Number(request.get('x-test-user'));
  if (!Number.isSafeInteger(userId) || userId < 1) {
    response.status(401).json({ error: 'Sign in is required.' });
    return;
  }
  request.authUser = {
    id: userId,
    role: request.get('x-test-role') || 'student',
  };
  next();
}

function requireSameOrigin(request, response, next) {
  if (!isSameOrigin(request)) {
    response.status(403).json({ error: 'Request origin could not be verified.' });
    return;
  }
  next();
}

function headers(userId, role, origin = baseUrl) {
  return {
    'x-test-user': String(userId),
    'x-test-role': role,
    Origin: origin,
    'Content-Type': 'application/json',
  };
}

before(async () => {
  assignments.clear();
  evaluations.clear();
  publishedEvents.clear();
  resultNotifications.length = 0;
  const app = express();
  app.use(express.json());
  app.use('/api/organizer', createOrganizerEventRouter({
    repository: emptyOrganizerRepository,
    judgingRepository,
    requireAuthenticated,
    requireSameOrigin,
  }));
  app.use('/api/judging', createJudgingRouter({
    repository: judgingRepository,
    requireAuthenticated,
    requireSameOrigin,
  }));
  app.use('/api/results', createResultsRouter(judgingRepository));
  app.use((error, _request, response, _next) => {
    response.status(error.statusCode || 500).json({ error: error.message });
  });
  await new Promise((resolve, reject) => {
    server = app.listen(0, '127.0.0.1', resolve);
    server.once('error', reject);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server.closeAllConnections();
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

test('organizer can only assign judge accounts to events they own', async () => {
  const forbidden = await fetch(`${baseUrl}/api/organizer/events/event-one/judges`, {
    method: 'POST',
    headers: headers(9, 'organizer'),
    body: JSON.stringify({ email: 'judge@example.edu' }),
  });
  assert.equal(forbidden.status, 404);

  const notJudge = await fetch(`${baseUrl}/api/organizer/events/event-one/judges`, {
    method: 'POST',
    headers: headers(1, 'organizer'),
    body: JSON.stringify({ email: 'student@example.edu' }),
  });
  assert.equal(notJudge.status, 404);

  const invalidEmail = await fetch(`${baseUrl}/api/organizer/events/event-one/judges`, {
    method: 'POST',
    headers: headers(1, 'organizer'),
    body: JSON.stringify({ email: 'not-an-email' }),
  });
  assert.equal(invalidEmail.status, 400);

  const assigned = await fetch(`${baseUrl}/api/organizer/events/event-one/judges`, {
    method: 'POST',
    headers: headers(1, 'organizer'),
    body: JSON.stringify({ email: 'JUDGE@example.edu' }),
  });
  assert.equal(assigned.status, 201);
  assert.equal((await assigned.json()).judge.id, 2);

  const list = await fetch(`${baseUrl}/api/organizer/events/event-one/judges`, {
    headers: headers(1, 'organizer'),
  });
  assert.equal((await list.json()).judges.length, 1);
});

test('judges can evaluate assigned submissions only, with bounded scores and required feedback', async () => {
  const unscoredResults = await fetch(`${baseUrl}/api/organizer/events/event-one/results`, {
    headers: headers(1, 'organizer'),
  });
  assert.equal((await unscoredResults.json()).results.canPublish, false);

  const earlyPublish = await fetch(`${baseUrl}/api/organizer/events/event-one/results`, {
    method: 'PATCH',
    headers: headers(1, 'organizer'),
    body: JSON.stringify({ published: true }),
  });
  assert.equal(earlyPublish.status, 409);

  const student = await fetch(`${baseUrl}/api/judging/events`, {
    headers: headers(2, 'student'),
  });
  assert.equal(student.status, 403);

  const unassigned = await fetch(`${baseUrl}/api/judging/events/event-one/submissions`, {
    headers: headers(3, 'judge'),
  });
  assert.equal(unassigned.status, 404);

  const invalidScore = await fetch(`${baseUrl}/api/judging/events/event-one/submissions/31/evaluation`, {
    method: 'PUT',
    headers: headers(2, 'judge'),
    body: JSON.stringify({ score: 101, feedback: 'Good work.' }),
  });
  assert.equal(invalidScore.status, 400);

  const missingFeedback = await fetch(`${baseUrl}/api/judging/events/event-one/submissions/31/evaluation`, {
    method: 'PUT',
    headers: headers(2, 'judge'),
    body: JSON.stringify({ score: 90, feedback: ' ' }),
  });
  assert.equal(missingFeedback.status, 400);

  const saved = await fetch(`${baseUrl}/api/judging/events/event-one/submissions/31/evaluation`, {
    method: 'PUT',
    headers: headers(2, 'judge'),
    body: JSON.stringify({ score: 90, feedback: 'Clear and useful project.' }),
  });
  assert.equal(saved.status, 200);
  assert.equal((await saved.json()).evaluation.score, 90);

  const updated = await fetch(`${baseUrl}/api/judging/events/event-one/submissions/31/evaluation`, {
    method: 'PUT',
    headers: headers(2, 'judge'),
    body: JSON.stringify({ score: 95, feedback: 'Excellent iteration.' }),
  });
  assert.equal((await updated.json()).evaluation.score, 95);

  const listed = await fetch(`${baseUrl}/api/judging/events/event-one/submissions`, {
    headers: headers(2, 'judge'),
  });
  const [submission] = (await listed.json()).submissions;
  assert.equal(submission.evaluation.feedback, 'Excellent iteration.');

  const published = await fetch(`${baseUrl}/api/organizer/events/event-one/results`, {
    method: 'PATCH',
    headers: headers(1, 'organizer'),
    body: JSON.stringify({ published: true }),
  });
  assert.equal(published.status, 200);
  assert.ok((await published.json()).results.publishedAt);
  assert.deepEqual(resultNotifications.map((notification) => notification.userId), [10, 11]);

  await fetch(`${baseUrl}/api/organizer/events/event-one/results`, {
    method: 'PATCH',
    headers: headers(1, 'organizer'),
    body: JSON.stringify({ published: true }),
  });
  assert.equal(resultNotifications.length, 2, 'repeating publish must not send duplicate notifications');

  const publicResults = await fetch(`${baseUrl}/api/results/events/event-one`);
  assert.equal(publicResults.status, 200);
  const leaderboard = (await publicResults.json()).results;
  assert.equal(leaderboard.results[0].averageScore, 95);
  assert.equal(leaderboard.results[0].evaluationCount, 1);

  const unpublished = await fetch(`${baseUrl}/api/organizer/events/event-one/results`, {
    method: 'PATCH',
    headers: headers(1, 'organizer'),
    body: JSON.stringify({ published: false }),
  });
  assert.equal((await unpublished.json()).results.publishedAt, null);
  const hiddenResults = await fetch(`${baseUrl}/api/results/events/event-one`);
  assert.equal(hiddenResults.status, 404);
});

test('only the event owner can remove a judge assignment', async () => {
  const forbidden = await fetch(`${baseUrl}/api/organizer/events/event-one/judges/2`, {
    method: 'DELETE',
    headers: headers(9, 'organizer'),
  });
  assert.equal(forbidden.status, 404);

  const removed = await fetch(`${baseUrl}/api/organizer/events/event-one/judges/2`, {
    method: 'DELETE',
    headers: headers(1, 'organizer'),
  });
  assert.equal(removed.status, 204);

  const inaccessible = await fetch(`${baseUrl}/api/judging/events/event-one/submissions`, {
    headers: headers(2, 'judge'),
  });
  assert.equal(inaccessible.status, 404);
});
