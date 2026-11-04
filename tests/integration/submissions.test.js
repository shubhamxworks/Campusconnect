const assert = require('node:assert/strict');
const express = require('express');
const { after, before, test } = require('node:test');
const { isSameOrigin } = require('../../server/routes/auth.routes');
const { createSubmissionRouter } = require('../../server/routes/submission.routes');

let server;
let baseUrl;
let saved;
let teamMembership = true;

const repository = {
  async getForUser(eventId) {
    if (eventId === 'missing-event') {
      return undefined;
    }
    if (!teamMembership) {
      return false;
    }
    return saved;
  },
  async saveForUser(eventId, userId, submission) {
    if (eventId === 'missing-event') {
      return undefined;
    }
    if (!teamMembership) {
      return false;
    }
    saved = {
      id: 1,
      teamId: 5,
      teamName: 'Campus Builders',
      submittedBy: userId,
      ...submission,
    };
    return saved;
  },
};

function requireAuthenticated(request, response, next) {
  const userId = Number(request.get('x-test-user'));
  if (!Number.isSafeInteger(userId) || userId < 1) {
    response.status(401).json({ error: 'Sign in to manage project submissions.' });
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

before(async () => {
  saved = null;
  teamMembership = true;
  const app = express();
  app.use(express.json());
  app.use(
    '/api/submissions',
    createSubmissionRouter({
      repository,
      requireAuthenticated,
      requireSameOrigin,
    }),
  );
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

function headers(userId, includeOrigin = true, role = 'student') {
  const result = {
    'x-test-user': String(userId),
    'x-test-role': role,
    'Content-Type': 'application/json',
  };
  if (includeOrigin) {
    result.Origin = baseUrl;
  }
  return result;
}

test('requires a signed-in student and same-origin project updates', async () => {
  const anonymous = await fetch(`${baseUrl}/api/submissions/event-1`);
  assert.equal(anonymous.status, 401);

  const organizer = await fetch(`${baseUrl}/api/submissions/event-1`, {
    headers: headers(2, true, 'organizer'),
  });
  assert.equal(organizer.status, 403);

  const crossOrigin = await fetch(`${baseUrl}/api/submissions/event-1`, {
    method: 'PUT',
    headers: { ...headers(1, false), Origin: 'https://other.example' },
    body: JSON.stringify({ projectName: 'Campus Compass', description: 'A project.' }),
  });
  assert.equal(crossOrigin.status, 403);
});

test('validates project fields, saves a team submission, and returns it for the team', async () => {
  const invalidUrl = await fetch(`${baseUrl}/api/submissions/event-1`, {
    method: 'PUT',
    headers: headers(1),
    body: JSON.stringify({
      projectName: 'Campus Compass',
      description: 'A guide to campus resources.',
      demoUrl: 'javascript:alert(1)',
    }),
  });
  assert.equal(invalidUrl.status, 400);

  const invalidDescription = await fetch(`${baseUrl}/api/submissions/event-1`, {
    method: 'PUT',
    headers: headers(1),
    body: JSON.stringify({ projectName: 'Campus Compass', description: ' ' }),
  });
  assert.equal(invalidDescription.status, 400);

  const update = await fetch(`${baseUrl}/api/submissions/event-1`, {
    method: 'PUT',
    headers: headers(1),
    body: JSON.stringify({
      projectName: ' Campus Compass ',
      description: ' A guide to campus resources. ',
      repositoryUrl: 'https://example.com/repo',
    }),
  });
  assert.equal(update.status, 200);
  const result = await update.json();
  assert.equal(result.submission.projectName, 'Campus Compass');
  assert.equal(result.submission.description, 'A guide to campus resources.');
  assert.equal(result.submission.submittedBy, 1);

  const current = await fetch(`${baseUrl}/api/submissions/event-1`, {
    headers: { 'x-test-user': '3' },
  });
  assert.equal((await current.json()).submission.teamName, 'Campus Builders');
});

test('requires team membership and reports missing events', async () => {
  teamMembership = false;
  const noTeam = await fetch(`${baseUrl}/api/submissions/event-1`, {
    headers: { 'x-test-user': '1' },
  });
  assert.equal(noTeam.status, 403);

  const missing = await fetch(`${baseUrl}/api/submissions/missing-event`, {
    headers: { 'x-test-user': '1' },
  });
  assert.equal(missing.status, 404);
});
