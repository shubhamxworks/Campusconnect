const assert = require('node:assert/strict');
const { after, before, test } = require('node:test');
const app = require('../../server/app');

let server;
let baseUrl;

before(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

test('lists upcoming events and available categories', async () => {
  const healthResponse = await fetch(`${baseUrl}/api/health`);
  assert.deepEqual(await healthResponse.json(), {
    status: 'ok',
    dataSource: 'sample',
    googleSignInEnabled: false,
    localAuthEnabled: false,
  });

  const response = await fetch(`${baseUrl}/api/events`);
  const result = await response.json();

  assert.equal(response.status, 200);
  assert.equal(result.total, 6);
  assert.deepEqual(result.categories, ['Competition', 'Hackathon', 'Networking', 'Talk', 'Workshop']);
  assert.deepEqual(
    result.events.map((event) => event.id),
    [
      'campus-innovation-jam',
      'design-for-good-sprint',
      'founders-and-friends',
      'open-source-weekend',
      'student-startup-showcase',
      'future-of-learning-talk',
    ],
  );
});

test('filters events by category and searchable event content', async () => {
  const response = await fetch(`${baseUrl}/api/events?category=Hackathon&q=mentor`);
  const result = await response.json();

  assert.equal(response.status, 200);
  assert.equal(result.total, 1);
  assert.equal(result.events[0].id, 'campus-innovation-jam');
});

test('returns event details or a clear not-found response', async () => {
  const found = await fetch(`${baseUrl}/api/events/campus-innovation-jam`);
  const foundResult = await found.json();

  assert.equal(found.status, 200);
  assert.equal(foundResult.event.title, 'Campus Innovation Jam');

  const missing = await fetch(`${baseUrl}/api/events/unknown-event`);
  assert.equal(missing.status, 404);
  assert.deepEqual(await missing.json(), { error: 'Event not found' });
});

test('reports local login and Google sign-in as unavailable without a MySQL auth configuration', async () => {
  const configResponse = await fetch(`${baseUrl}/api/auth/config`);
  assert.deepEqual(await configResponse.json(), {
    googleSignInEnabled: false,
    localAuthEnabled: false,
  });

  const currentUserResponse = await fetch(`${baseUrl}/api/auth/me`);
  assert.deepEqual(await currentUserResponse.json(), { user: null });

  const googleResponse = await fetch(`${baseUrl}/api/auth/google`, { redirect: 'manual' });
  assert.equal(googleResponse.status, 503);
  assert.deepEqual(await googleResponse.json(), { error: 'Google sign-in is not configured.' });

  const loginPage = await fetch(`${baseUrl}/login.html`);
  assert.equal(loginPage.status, 200);
  const loginHtml = await loginPage.text();
  assert.match(loginHtml, /Sign in/);
  assert.match(loginHtml, /Create account/);
});
