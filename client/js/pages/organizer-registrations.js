const eventId = new URLSearchParams(window.location.search).get('event');
const registrationsBody = document.querySelector('#registrations-body');
const message = document.querySelector('#registrations-message');
const statusFilter = document.querySelector('#status-filter');
let registrations = [];

function showMessage(text, kind = '') {
  message.hidden = false;
  message.className = `organizer-message${kind ? ` is-${kind}` : ''}`;
  message.textContent = text;
}

function makeElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) {
    element.className = className;
  }
  if (text !== undefined) {
    element.textContent = text;
  }
  return element;
}

function formatRegistrationDate(value) {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value));
}

async function requestJson(url, options) {
  const response = await fetch(url, options);
  const result = await response.json();
  if (!response.ok) {
    const error = new Error(result.error || 'The request could not be completed.');
    error.status = response.status;
    throw error;
  }
  return result;
}

function updateCounts() {
  for (const status of ['registered', 'waitlisted', 'attended', 'cancelled']) {
    const count = registrations.filter((registration) => registration.status === status).length;
    document.querySelector(`#${status}-count`).textContent = String(count);
  }
}

function renderRegistrations() {
  const visible = statusFilter.value === 'all'
    ? registrations
    : registrations.filter((registration) => registration.status === statusFilter.value);
  const rows = visible.map((registration) => {
    const row = document.createElement('tr');
    row.append(
      makeElement('td', '', registration.displayName),
      makeElement('td', '', registration.email),
    );
    const statusCell = document.createElement('td');
    statusCell.append(makeElement(
      'span',
      `registration-status is-${registration.status}`,
      registration.status,
    ));
    row.append(statusCell);
    row.append(makeElement('td', '', formatRegistrationDate(registration.registeredAt)));
    const actions = document.createElement('td');

    if (registration.status === 'registered') {
      const markAttended = makeElement('button', 'mark-attended-button', 'Mark attended');
      markAttended.type = 'button';
      markAttended.addEventListener('click', () => markRegistrationAttended(registration, markAttended));
      actions.append(markAttended);
    } else {
      actions.textContent = '—';
    }

    row.append(actions);
    return row;
  });
  registrationsBody.replaceChildren(...rows);

  if (visible.length === 0) {
    showMessage(
      registrations.length === 0
        ? 'No registrations for this event yet.'
        : 'No registrations match this status filter.',
    );
  } else {
    message.hidden = true;
  }
}

async function loadRegistrations() {
  if (!eventId) {
    showMessage('Open this page from an event in your organizer dashboard.', 'error');
    return;
  }
  document.querySelector('#event-link').href = '/organizer/dashboard.html';

  try {
    const [{ events }, result] = await Promise.all([
      requestJson('/api/organizer/events'),
      requestJson(`/api/organizer/events/${encodeURIComponent(eventId)}/registrations`),
    ]);
    const event = events.find((item) => item.id === eventId);
    if (!event) {
      throw new Error('You do not have permission to manage this event.');
    }
    document.querySelector('#event-title').textContent = `${event.title} · ${event.registeredCount} registered attendees`;
    registrations = result.registrations;
    updateCounts();
    renderRegistrations();
  } catch (error) {
    showMessage(error.message || 'Registrations could not be loaded.', 'error');
  }
}

async function markRegistrationAttended(registration, button) {
  button.disabled = true;
  try {
    const result = await requestJson(
      `/api/organizer/events/${encodeURIComponent(eventId)}/registrations/${registration.id}/attended`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      },
    );
    registration.status = result.registration.status;
    updateCounts();
    renderRegistrations();
    showMessage(`${registration.displayName} marked as attended.`, 'success');
  } catch (error) {
    button.disabled = false;
    showMessage(error.message || 'Attendance could not be updated.', 'error');
  }
}

document.querySelectorAll('[data-current-year]').forEach((element) => {
  element.textContent = String(new Date().getFullYear());
});
statusFilter.addEventListener('change', renderRegistrations);

async function initialize() {
  try {
    const { user } = await requestJson('/api/auth/me');
    if (!user) {
      window.location.replace(`/login.html?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
      return;
    }
    if (user.role !== 'organizer') {
      showMessage('An organizer account is required to view registrations.', 'error');
      return;
    }
    await loadRegistrations();
  } catch (error) {
    showMessage(error.message || 'Registrations could not be loaded.', 'error');
  }
}

initialize();
