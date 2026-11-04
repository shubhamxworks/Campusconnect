const assert = require('node:assert/strict');
const express = require('express');
const { after, before, test } = require('node:test');
const { isSameOrigin } = require('../../server/routes/auth.routes');
const { createTeamRouter } = require('../../server/routes/team.routes');
const { TeamError } = require('../../server/repositories/team.repository');

const teams = new Map();
let server;
let baseUrl;
const team = {
  id: 8,
  eventId: 'test-event',
  eventTitle: 'Campus Build',
  name: 'Bright Ideas',
  invitationCode: 'A'.repeat(32),
  members: [{ id: 1, name: 'Student One' }],
};

const repository = {
  async getCurrentTeam(eventId, userId) {
    if (eventId !== 'test-event') return undefined;
    return teams.get(userId) || null;
  },
  async createTeam(eventId, userId, name) {
    if (eventId !== 'test-event') return undefined;
    if (teams.has(userId)) throw new TeamError('You already belong to a team for this event.', 409);
    const createdTeam = { ...team, name, members: [{ id: userId, name: 'Student One' }] };
    teams.set(userId, createdTeam);
    return createdTeam;
  },
  async joinTeam(eventId, userId, invitationCode) {
    if (eventId !== 'test-event') return undefined;
    if (invitationCode !== team.invitationCode) {
      throw new TeamError('Invitation code was not found for this event.', 404);
    }
    if (teams.has(userId)) throw new TeamError('You already belong to another team for this event.', 409);
    const joinedTeam = {
      ...team,
      members: [...team.members, { id: userId, name: 'Student One' }],
    };
    teams.set(userId, joinedTeam);
    return joinedTeam;
  },
  async leaveTeam(eventId, userId) {
    if (eventId !== 'test-event') return undefined;
    return teams.delete(userId);
  },
};

function requireAuthenticated(request, response, next) {
  const userId = Number(request.get('x-test-user'));
  if (!Number.isSafeInteger(userId) || userId < 1) {
    response.status(401).json({ error: 'Sign in to manage teams.' });
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
  teams.clear();
  const app = express();
  app.use(express.json());
  app.use(
    '/api/teams',
    createTeamRouter({ repository, requireAuthenticated, requireSameOrigin }),
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
  const result = { 'x-test-user': String(userId), 'x-test-role': role };
  if (includeOrigin) result.Origin = baseUrl;
  return result;
}

test('requires a signed-in student and same-origin mutations', async () => {
  const anonymous = await fetch(`${baseUrl}/api/teams/test-event`);
  assert.equal(anonymous.status, 401);

  const organizer = await fetch(`${baseUrl}/api/teams/test-event`, {
    headers: headers(7, true, 'organizer'),
  });
  assert.equal(organizer.status, 403);

  const crossOrigin = await fetch(`${baseUrl}/api/teams/test-event`, {
    method: 'POST',
    headers: { ...headers(1, false), 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Bright Ideas' }),
  });
  assert.equal(crossOrigin.status, 403);
});

test('creates, views, and leaves a team; rejects invalid team names', async () => {
  const invalid = await fetch(`${baseUrl}/api/teams/test-event`, {
    method: 'POST',
    headers: { ...headers(1), 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: '  ' }),
  });
  assert.equal(invalid.status, 400);

  const created = await fetch(`${baseUrl}/api/teams/test-event`, {
    method: 'POST',
    headers: { ...headers(1), 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Bright Ideas' }),
  });
  assert.equal(created.status, 201);
  const createdResult = await created.json();
  assert.equal(createdResult.team.name, 'Bright Ideas');
  assert.match(createdResult.team.invitationCode, /^[A-F0-9]{32}$/);

  const current = await fetch(`${baseUrl}/api/teams/test-event`, { headers: headers(1, false) });
  assert.equal((await current.json()).team.members[0].name, 'Student One');

  const left = await fetch(`${baseUrl}/api/teams/test-event`, {
    method: 'DELETE',
    headers: headers(1),
  });
  assert.equal(left.status, 200);
  assert.equal((await left.json()).team, null);
});

test('joins by invitation code and rejects invalid codes and missing events', async () => {
  const invalidCode = await fetch(`${baseUrl}/api/teams/test-event/join`, {
    method: 'POST',
    headers: { ...headers(2), 'Content-Type': 'application/json' },
    body: JSON.stringify({ invitationCode: 'bad' }),
  });
  assert.equal(invalidCode.status, 400);

  const joined = await fetch(`${baseUrl}/api/teams/test-event/join`, {
    method: 'POST',
    headers: { ...headers(2), 'Content-Type': 'application/json' },
    body: JSON.stringify({ invitationCode: team.invitationCode.toLowerCase() }),
  });
  assert.equal(joined.status, 200);
  assert.equal((await joined.json()).team.id, team.id);

  const missing = await fetch(`${baseUrl}/api/teams/missing-event`, { headers: headers(3, false) });
  assert.equal(missing.status, 404);
});
