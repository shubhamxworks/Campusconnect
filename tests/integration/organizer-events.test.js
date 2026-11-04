const assert = require('node:assert/strict');
const express = require('express');
const { after, before, test } = require('node:test');
const { isSameOrigin } = require('../../server/routes/auth.routes');
const { createOrganizerEventRouter } = require('../../server/routes/organizer-event.routes');

let server;
let baseUrl;
const events = new Map();
const registrations = new Map();
let nextEventId = 1;

const repository = {
  async listForOrganizer(organizerId) {
    return [...events.values()].filter((event) => event.organizerId === organizerId);
  },
  async create(organizerId, event) {
    const created = { ...event, id: `${event.id}-${nextEventId++}`, organizerId };
    events.set(created.id, created);
    return created;
  },
  async update(organizerId, eventId, event) {
    const existing = events.get(eventId);
    if (!existing || existing.organizerId !== organizerId) {
      return null;
    }
    const updated = { ...existing, ...event };
    events.set(eventId, updated);
    return updated;
  },
  async listRegistrations(organizerId, eventId) {
    const event = events.get(eventId);
    if (!event || event.organizerId !== organizerId) {
      return null;
    }
    return [...(registrations.get(eventId) ?? [])];
  },
  async markAttended(organizerId, eventId, registrationId) {
    const event = events.get(eventId);
    if (!event || event.organizerId !== organizerId) {
      return null;
    }
    const registration = (registrations.get(eventId) ?? [])
      .find((item) => item.id === Number(registrationId));
    if (!registration) {
      return false;
    }
    if (registration.status !== 'registered' && registration.status !== 'attended') {
      const error = new Error('Only registered attendees can be marked as attended.');
      error.statusCode = 409;
      throw error;
    }
    registration.status = 'attended';
    return { id: registration.id, status: registration.status, registeredAt: registration.registeredAt };
  },
};

function requireAuthenticated(request, response, next) {
  const userId = Number(request.get('x-test-user'));
  if (!Number.isSafeInteger(userId) || userId < 1) {
    response.status(401).json({ error: 'Sign in to manage events.' });
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

function validEvent(overrides = {}) {
  return {
    title: 'Campus Build Night',
    category: 'Hackathon',
    summary: 'Build something useful.',
    description: 'A campus night to make and share projects.',
    startsAt: '2027-01-10T09:00:00.000Z',
    endsAt: '2027-01-10T18:00:00.000Z',
    registrationDeadline: '2027-01-09T23:59:00.000Z',
    venue: 'Innovation Hall',
    format: 'In person',
    organizer: 'Builders Club',
    capacity: 80,
    tags: ['Teams', 'Prizes'],
    ...overrides,
  };
}

function headers(userId, role = 'organizer', origin = baseUrl) {
  return {
    'x-test-user': String(userId),
    'x-test-role': role,
    Origin: origin,
    'Content-Type': 'application/json',
  };
}

before(async () => {
  events.clear();
  registrations.clear();
  nextEventId = 1;
  const app = express();
  app.use(express.json());
  app.use(
    '/api/organizer',
    createOrganizerEventRouter({
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

test('requires organizer role and same-origin event mutations', async () => {
  const anonymous = await fetch(`${baseUrl}/api/organizer/events`);
  assert.equal(anonymous.status, 401);

  const student = await fetch(`${baseUrl}/api/organizer/events`, {
    headers: headers(4, 'student'),
  });
  assert.equal(student.status, 403);

  const wrongOrigin = await fetch(`${baseUrl}/api/organizer/events`, {
    method: 'POST',
    headers: headers(4, 'organizer', 'https://other.example'),
    body: JSON.stringify(validEvent()),
  });
  assert.equal(wrongOrigin.status, 403);
});

test('creates an event, lists it for its organizer, and prevents another organizer editing it', async () => {
  const create = await fetch(`${baseUrl}/api/organizer/events`, {
    method: 'POST',
    headers: headers(4),
    body: JSON.stringify(validEvent()),
  });
  assert.equal(create.status, 201);
  const created = (await create.json()).event;
  assert.match(created.id, /^campus-build-night-[a-f0-9]{8}-1$/);

  const ownEvents = await fetch(`${baseUrl}/api/organizer/events`, {
    headers: headers(4),
  });
  assert.equal((await ownEvents.json()).events.length, 1);
  const otherEvents = await fetch(`${baseUrl}/api/organizer/events`, {
    headers: headers(5),
  });
  assert.equal((await otherEvents.json()).events.length, 0);

  const forbiddenEdit = await fetch(`${baseUrl}/api/organizer/events/${created.id}`, {
    method: 'PUT',
    headers: headers(5),
    body: JSON.stringify(validEvent({ title: 'Unauthorized edit' })),
  });
  assert.equal(forbiddenEdit.status, 404);

  const edit = await fetch(`${baseUrl}/api/organizer/events/${created.id}`, {
    method: 'PUT',
    headers: headers(4),
    body: JSON.stringify(validEvent({ title: 'Updated Build Night' })),
  });
  assert.equal(edit.status, 200);
  assert.equal((await edit.json()).event.title, 'Updated Build Night');
});

test('validates required fields, event time ranges, capacity, and tag limits', async () => {
  const invalidCases = [
    validEvent({ title: ' ' }),
    validEvent({ category: 'Party' }),
    validEvent({ capacity: 0 }),
    validEvent({ endsAt: '2027-01-10T08:59:00.000Z' }),
    validEvent({ registrationDeadline: '2027-01-10T10:00:00.000Z' }),
    validEvent({ tags: Array.from({ length: 13 }, (_, index) => `Tag ${index}`) }),
  ];

  for (const payload of invalidCases) {
    const response = await fetch(`${baseUrl}/api/organizer/events`, {
      method: 'POST',
      headers: headers(4),
      body: JSON.stringify(payload),
    });
    assert.equal(response.status, 400);
  }
});

test('lists event registrations and allows only the owner to mark attendance', async () => {
  const createdResponse = await fetch(`${baseUrl}/api/organizer/events`, {
    method: 'POST',
    headers: headers(11),
    body: JSON.stringify(validEvent()),
  });
  const event = (await createdResponse.json()).event;
  registrations.set(event.id, [{
    id: 21,
    status: 'registered',
    registeredAt: '2026-11-01T10:00:00.000Z',
    displayName: 'Student One',
    email: 'student@example.edu',
  }]);

  const list = await fetch(`${baseUrl}/api/organizer/events/${event.id}/registrations`, {
    headers: headers(11),
  });
  assert.equal(list.status, 200);
  assert.equal((await list.json()).registrations[0].displayName, 'Student One');

  const notOwner = await fetch(`${baseUrl}/api/organizer/events/${event.id}/registrations`, {
    headers: headers(12),
  });
  assert.equal(notOwner.status, 404);

  const crossOrigin = await fetch(
    `${baseUrl}/api/organizer/events/${event.id}/registrations/21/attended`,
    {
      method: 'PATCH',
      headers: headers(11, 'organizer', 'https://other.example'),
      body: '{}',
    },
  );
  assert.equal(crossOrigin.status, 403);

  const marked = await fetch(
    `${baseUrl}/api/organizer/events/${event.id}/registrations/21/attended`,
    {
      method: 'PATCH',
      headers: headers(11),
      body: '{}',
    },
  );
  assert.equal(marked.status, 200);
  assert.equal((await marked.json()).registration.status, 'attended');

  const invalidId = await fetch(
    `${baseUrl}/api/organizer/events/${event.id}/registrations/invalid/attended`,
    {
      method: 'PATCH',
      headers: headers(11),
      body: '{}',
    },
  );
  assert.equal(invalidId.status, 400);
});
