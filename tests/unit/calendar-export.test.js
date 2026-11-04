const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createCalendarFile, escapeText, foldLine } = require('../../client/js/calendar-export');

test('escapes text fields according to iCalendar text rules', () => {
  assert.equal(escapeText('Build, code; ship\\\nnext'), 'Build\\, code\\; ship\\\\\\nnext');
});

test('creates valid UTC calendar entries and marks waitlisted events tentative', () => {
  const calendar = createCalendarFile([
    {
      id: 'build-night',
      title: 'Build Night',
      summary: 'Make a project',
      venue: 'Innovation Hall',
      startsAt: '2026-11-10T09:30:00.000Z',
      endsAt: '2026-11-10T12:30:00.000Z',
      registration: { status: 'registered' },
    },
    {
      id: 'design-lab',
      title: 'Design Lab',
      startsAt: '2026-11-11T09:00:00.000Z',
      endsAt: '2026-11-11T10:00:00.000Z',
      registration: { status: 'waitlisted' },
    },
  ], new Date('2026-11-01T00:00:00.000Z'));

  assert.match(calendar, /BEGIN:VCALENDAR\r\n/);
  assert.match(calendar, /DTSTAMP:20261101T000000Z/);
  assert.match(calendar, /DTSTART:20261110T093000Z/);
  assert.match(calendar, /SUMMARY:Build Night/);
  assert.match(calendar, /STATUS:CONFIRMED/);
  assert.match(calendar, /STATUS:TENTATIVE/);
  assert.match(calendar, /END:VCALENDAR\r\n$/);
});

test('folds long UTF-8 lines without exceeding the 75-octet limit', () => {
  const folded = foldLine(`SUMMARY:${'CampusConnect 🌱 '.repeat(12)}`);
  const lines = folded.split('\r\n');

  assert.ok(lines.length > 1);
  assert.ok(lines.every((line) => Buffer.byteLength(line, 'utf8') <= 75));
  assert.ok(lines.slice(1).every((line) => line.startsWith(' ')));
});

test('rejects invalid event dates rather than exporting a broken calendar', () => {
  assert.throws(() => createCalendarFile([{
    id: 'invalid',
    startsAt: 'not-a-date',
    endsAt: '2026-11-10T10:00:00Z',
  }]), {
    name: 'TypeError',
    message: 'Calendar event dates must be valid.',
  });
});
