(function exposeCalendarExport(root) {
  function escapeText(value) {
    return String(value ?? '')
      .replace(/\\/g, '\\\\')
      .replace(/\r\n|\r|\n/g, '\\n')
      .replace(/,/g, '\\,')
      .replace(/;/g, '\\;');
  }

  function foldLine(line) {
    const encoder = new TextEncoder();
    const lines = [];
    let current = '';
    let byteLength = 0;
    let limit = 75;

    for (const character of line) {
      const characterLength = encoder.encode(character).length;
      if (byteLength + characterLength > limit && current) {
        lines.push(current);
        current = ' ';
        byteLength = 1;
        limit = 75;
      }
      current += character;
      byteLength += characterLength;
    }

    lines.push(current);
    return lines.join('\r\n');
  }

  function formatUtcDate(value) {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) {
      throw new TypeError('Calendar event dates must be valid.');
    }
    return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  }

  function createCalendarFile(events, generatedAt = new Date()) {
    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//CampusConnect//Student Schedule//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
    ];

    for (const event of events) {
      lines.push(
        'BEGIN:VEVENT',
        `UID:${escapeText(event.id)}@campusconnect`,
        `DTSTAMP:${formatUtcDate(generatedAt)}`,
        `DTSTART:${formatUtcDate(event.startsAt)}`,
        `DTEND:${formatUtcDate(event.endsAt)}`,
        `SUMMARY:${escapeText(event.title)}`,
        `DESCRIPTION:${escapeText(event.summary || event.description || '')}`,
        `LOCATION:${escapeText(event.venue || '')}`,
        `STATUS:${event.registration?.status === 'waitlisted' ? 'TENTATIVE' : 'CONFIRMED'}`,
        'END:VEVENT',
      );
    }

    lines.push('END:VCALENDAR');
    return `${lines.map(foldLine).join('\r\n')}\r\n`;
  }

  const calendarExport = { createCalendarFile, escapeText, foldLine };
  root.CampusConnectCalendar = calendarExport;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = calendarExport;
  }
}(globalThis));
