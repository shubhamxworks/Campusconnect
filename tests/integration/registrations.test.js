const assert = require('node:assert/strict');
const express = require('express');
const { after, before, test } = require('node:test');
const { isSameOrigin } = require('../../server/routes/auth.routes');
const { createRegistrationRouter } = require('../../server/routes/registration.routes');

const registrations = new Map();
let server;
let baseUrl;

const repository = {
  async eventExists(eventId) {
    return eventId === 'test-event';
  },
  async get(eventId, userId) {
    return eventId === 'test-event'
      ? registrations.get(`${eventId}:${userId}`) ?? null
      : null;
  },
  async register(eventId, userId) {
    if (eventId !== 'test-event') {
      return null;
    }
    const key = `${eventId}:${userId}`;
    const existing = registrations.get(key);
    if (existing) {
      return { registration: existing, created: false };
    }
    const registration = { status: userId === 2 || userId === 4 ? 'waitlisted' : 'registered' };
    registrations.set(key, registration);
    return { registration, created: true };
  },
  async cancel(eventId, userId) {
    if (eventId !== 'test-event') {
      return null;
    }
    const key = `${eventId}:${userId}`;
    const registration = registrations.get(key);
    if (!registration || registration.status === 'cancelled') {
      return { registration: registration ?? null, cancelled: false, promotedWaitlist: false };
    }
    const wasRegistered = registration.status === 'registered';
    registration.status = 'cancelled';
    let promotedWaitlist = false;
    if (wasRegistered) {
      for (const [waitlistKey, waitlisted] of registrations) {
        if (waitlisted.status === 'waitlisted' && waitlistKey.startsWith(`${eventId}:`)) {
          waitlisted.status = 'registered';
          promotedWaitlist = true;
          break;
        }
      }
    }
    return { registration, cancelled: true, promotedWaitlist };
  },
};

function requireAuthenticated(request, response, next) {
  const userId = Number(request.get('x-test-user'));
  if (!Number.isSafeInteger(userId) || userId < 1) {
    response.status(401).json({ error: 'Sign in to register for events.', signInUrl: '/login.html' });
    return;
  }
  request.authUser = { id: userId };
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
  registrations.clear();
  const app = express();
  app.use(express.json());
  app.use(
    '/api/events',
    createRegistrationRouter({
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

function headers(userId, includeOrigin = true) {
  const result = { 'x-test-user': String(userId) };
  if (includeOrigin) {
    result.Origin = baseUrl;
  }
  return result;
}

test('requires a signed-in student and same-origin mutation requests', async () => {
  const anonymous = await fetch(`${baseUrl}/api/events/test-event/registration`);
  assert.equal(anonymous.status, 401);

  const crossOrigin = await fetch(`${baseUrl}/api/events/test-event/registration`, {
    method: 'POST',
    headers: { ...headers(1, false), 'Content-Type': 'application/json' },
    body: '{}',
  });
  assert.equal(crossOrigin.status, 403);
});

test('registers, returns registration status, and cancels a student registration', async () => {
  const registration = await fetch(`${baseUrl}/api/events/test-event/registration`, {
    method: 'POST',
    headers: { ...headers(1), 'Content-Type': 'application/json' },
    body: '{}',
  });
  assert.equal(registration.status, 201);
  assert.equal((await registration.json()).registration.status, 'registered');

  const current = await fetch(`${baseUrl}/api/events/test-event/registration`, {
    headers: headers(1, false),
  });
  assert.equal((await current.json()).registration.status, 'registered');

  const cancellation = await fetch(`${baseUrl}/api/events/test-event/registration`, {
    method: 'DELETE',
    headers: headers(1),
  });
  assert.equal(cancellation.status, 200);
  assert.equal((await cancellation.json()).registration.status, 'cancelled');

  const noRegistration = await fetch(`${baseUrl}/api/events/test-event/registration`, {
    method: 'DELETE',
    headers: headers(3),
  });
  assert.equal(noRegistration.status, 404);
});

test('returns waitlist status and event not-found errors', async () => {
  const waitlisted = await fetch(`${baseUrl}/api/events/test-event/registration`, {
    method: 'POST',
    headers: { ...headers(2), 'Content-Type': 'application/json' },
    body: '{}',
  });
  assert.equal(waitlisted.status, 201);
  assert.equal((await waitlisted.json()).registration.status, 'waitlisted');

  const secondWaitlisted = await fetch(`${baseUrl}/api/events/test-event/registration`, {
    method: 'POST',
    headers: { ...headers(4), 'Content-Type': 'application/json' },
    body: '{}',
  });
  assert.equal(secondWaitlisted.status, 201);

  const leaveWaitlist = await fetch(`${baseUrl}/api/events/test-event/registration`, {
    method: 'DELETE',
    headers: headers(2),
  });
  assert.equal(leaveWaitlist.status, 200);
  assert.equal((await leaveWaitlist.json()).promotedWaitlist, false);

  const registered = await fetch(`${baseUrl}/api/events/test-event/registration`, {
    method: 'POST',
    headers: { ...headers(3), 'Content-Type': 'application/json' },
    body: '{}',
  });
  assert.equal(registered.status, 201);

  const cancellation = await fetch(`${baseUrl}/api/events/test-event/registration`, {
    method: 'DELETE',
    headers: headers(3),
  });
  assert.equal(cancellation.status, 200);
  const cancellationResult = await cancellation.json();
  assert.equal(cancellationResult.promotedWaitlist, true);
  assert.match(cancellationResult.message, /waitlist has been promoted/);

  const promotedStudent = await fetch(`${baseUrl}/api/events/test-event/registration`, {
    headers: headers(4, false),
  });
  assert.equal((await promotedStudent.json()).registration.status, 'registered');

  const missing = await fetch(`${baseUrl}/api/events/missing-event/registration`, {
    method: 'POST',
    headers: { ...headers(1), 'Content-Type': 'application/json' },
    body: '{}',
  });
  assert.equal(missing.status, 404);
});
