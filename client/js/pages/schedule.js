const scheduleList = document.querySelector('#schedule-list');
const scheduleMessage = document.querySelector('#schedule-message');
const scheduleSummary = document.querySelector('#schedule-summary');
const exportButton = document.querySelector('#export-calendar');

let upcomingEvents = [];

function makeElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function formatEventDate(event) {
  const start = new Date(event.startsAt);
  const end = new Date(event.endsAt);
  const sameDay = start.toDateString() === end.toDateString();
  const date = new Intl.DateTimeFormat(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(start);
  const endDate = sameDay
    ? ''
    : new Intl.DateTimeFormat(undefined, {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    }).format(end);
  const time = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
  return `${date} · ${time.format(start)}–${sameDay ? '' : `${endDate} `}${time.format(end)}`;
}

function formatDay(value) {
  return new Intl.DateTimeFormat(undefined, {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(value));
}

function showMessage(text, kind = '') {
  scheduleMessage.hidden = false;
  scheduleMessage.className = `schedule-message${kind ? ` is-${kind}` : ''}`;
  scheduleMessage.textContent = text;
}

function createEventCard(event) {
  const card = makeElement('article', 'schedule-event-card');
  const date = makeElement('time', 'schedule-event-date');
  date.dateTime = event.startsAt;
  date.append(
    makeElement('strong', '', formatDay(event.startsAt)),
    makeElement('span', '', new Intl.DateTimeFormat(undefined, {
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(event.startsAt))),
  );
  const content = makeElement('div', 'schedule-event-content');
  const meta = makeElement('div', 'schedule-event-meta');
  meta.append(
    makeElement('span', 'schedule-category', event.category),
    makeElement('span', `schedule-status is-${event.registration.status}`, event.registration.status),
  );
  const title = makeElement('h2', '', event.title);
  const details = makeElement('p', 'schedule-event-details', formatEventDate(event));
  const venue = makeElement('p', 'schedule-event-venue', `${event.venue} · ${event.format}`);
  const actions = makeElement('div', 'schedule-event-actions');
  const eventLink = makeElement('a', '', 'View event');
  eventLink.href = `/event-details.html?id=${encodeURIComponent(event.id)}`;
  actions.append(eventLink);
  content.append(meta, title, details, venue, actions);
  card.append(date, content);
  return card;
}

function renderSchedule(events) {
  const now = Date.now();
  upcomingEvents = events
    .filter((event) => ['registered', 'waitlisted'].includes(event.registration.status))
    .filter((event) => Date.parse(event.endsAt) >= now)
    .sort((first, second) => Date.parse(first.startsAt) - Date.parse(second.startsAt));

  scheduleSummary.textContent = upcomingEvents.length === 1
    ? '1 upcoming event'
    : `${upcomingEvents.length} upcoming events`;
  exportButton.disabled = upcomingEvents.length === 0;
  scheduleList.setAttribute('aria-busy', 'false');

  if (upcomingEvents.length === 0) {
    showMessage('No upcoming registered or waitlisted events. Explore events to plan your next campus experience.');
    const explore = makeElement('a', 'schedule-explore', 'Discover events');
    explore.href = '/events.html';
    scheduleMessage.append(' ', explore);
    scheduleList.replaceChildren();
    return;
  }

  scheduleMessage.hidden = true;
  scheduleList.replaceChildren(...upcomingEvents.map(createEventCard));
}

async function initialize() {
  document.querySelectorAll('[data-current-year]').forEach((element) => {
    element.textContent = String(new Date().getFullYear());
  });
  exportButton.addEventListener('click', () => {
    if (upcomingEvents.length === 0) return;
    try {
      const calendarFile = window.CampusConnectCalendar.createCalendarFile(upcomingEvents);
      const blob = new Blob([calendarFile], { type: 'text/calendar;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'campusconnect-schedule.ics';
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (error) {
      showMessage(error.message || 'Could not export your calendar.', 'error');
    }
  });

  try {
    const userResponse = await fetch('/api/auth/me');
    const currentUser = await userResponse.json();
    if (!userResponse.ok) {
      throw new Error(currentUser.error || 'Could not verify your account.');
    }
    if (!currentUser.user) {
      window.location.replace(`/login.html?next=${encodeURIComponent('/schedule.html')}`);
      return;
    }

    const response = await fetch('/api/my-events');
    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.error || 'Could not load your schedule.');
    }
    renderSchedule(result.events);
  } catch (error) {
    scheduleList.setAttribute('aria-busy', 'false');
    showMessage(error.message || 'Your schedule could not be loaded.', 'error');
  }
}

initialize();
