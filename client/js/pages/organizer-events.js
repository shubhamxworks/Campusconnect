const eventList = document.querySelector('#organizer-event-list');
const message = document.querySelector('#organizer-message');
const editor = document.querySelector('#event-editor');
const eventForm = document.querySelector('#event-form');
const editorTitle = document.querySelector('#event-editor-title');
const saveButton = document.querySelector('#save-event');

let currentEventId = null;

function showMessage(text, kind = '') {
  message.hidden = false;
  message.className = `organizer-message${kind ? ` is-${kind}` : ''}`;
  message.textContent = text;
}

function formatEventDate(value) {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value));
}

function toLocalDateTime(value) {
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function setEventForm(event) {
  eventForm.reset();
  if (!event) {
    currentEventId = null;
    editorTitle.textContent = 'Create an event';
    saveButton.textContent = 'Create event';
    return;
  }

  currentEventId = event.id;
  editorTitle.textContent = 'Edit event';
  saveButton.textContent = 'Save changes';
  document.querySelector('#event-title').value = event.title;
  document.querySelector('#event-category').value = event.category;
  document.querySelector('#event-format').value = event.format;
  document.querySelector('#event-summary').value = event.summary;
  document.querySelector('#event-description').value = event.description;
  document.querySelector('#event-start').value = toLocalDateTime(event.startsAt);
  document.querySelector('#event-end').value = toLocalDateTime(event.endsAt);
  document.querySelector('#event-deadline').value = toLocalDateTime(event.registrationDeadline);
  document.querySelector('#event-venue').value = event.venue;
  document.querySelector('#event-capacity').value = String(event.capacity);
  document.querySelector('#event-organizer').value = event.organizer;
  document.querySelector('#event-tags').value = event.tags.join(', ');
}

function createEventCard(event) {
  const card = document.createElement('article');
  card.className = 'organizer-event-card';
  const details = document.createElement('div');
  const title = document.createElement('h3');
  title.textContent = event.title;
  const metadata = document.createElement('p');
  metadata.textContent = `${formatEventDate(event.startsAt)} · ${event.registeredCount} registered`;
  details.append(title, metadata);
  const edit = document.createElement('button');
  edit.type = 'button';
  edit.textContent = 'Edit';
  edit.setAttribute('aria-label', `Edit ${event.title}`);
  edit.addEventListener('click', () => {
    setEventForm(event);
    editor.hidden = false;
    editor.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  const actions = document.createElement('div');
  actions.className = 'organizer-event-actions';
  const registrations = document.createElement('a');
  registrations.className = 'organizer-registrations-link';
  registrations.href = `/organizer/registrations.html?event=${encodeURIComponent(event.id)}`;
  registrations.textContent = 'Registrations';
  const judges = document.createElement('a');
  judges.className = 'organizer-registrations-link';
  judges.href = `/organizer/judges.html?event=${encodeURIComponent(event.id)}`;
  judges.textContent = 'Judges';
  const results = document.createElement('a');
  results.className = 'organizer-registrations-link';
  results.href = `/organizer/results.html?event=${encodeURIComponent(event.id)}`;
  results.textContent = 'Results';
  actions.append(registrations, judges, results, edit);
  card.append(details, actions);
  return card;
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

async function loadEvents() {
  const { events } = await requestJson('/api/organizer/events');
  eventList.replaceChildren(...events.map(createEventCard));
  if (events.length === 0) {
    showMessage('You have not created any events yet. Create one to get started.');
    return;
  }
  message.hidden = true;
}

function readForm() {
  return {
    title: document.querySelector('#event-title').value,
    category: document.querySelector('#event-category').value,
    format: document.querySelector('#event-format').value,
    summary: document.querySelector('#event-summary').value,
    description: document.querySelector('#event-description').value,
    startsAt: new Date(document.querySelector('#event-start').value).toISOString(),
    endsAt: new Date(document.querySelector('#event-end').value).toISOString(),
    registrationDeadline: new Date(document.querySelector('#event-deadline').value).toISOString(),
    venue: document.querySelector('#event-venue').value,
    capacity: Number(document.querySelector('#event-capacity').value),
    organizer: document.querySelector('#event-organizer').value,
    tags: document.querySelector('#event-tags').value
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean),
    artwork: '✦',
  };
}

async function saveEvent(event) {
  event.preventDefault();
  saveButton.disabled = true;
  message.hidden = true;
  try {
    const creating = !currentEventId;
    const method = currentEventId ? 'PUT' : 'POST';
    const url = currentEventId
      ? `/api/organizer/events/${encodeURIComponent(currentEventId)}`
      : '/api/organizer/events';
    await requestJson(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(readForm()),
    });
    await loadEvents();
    showMessage(creating ? 'Your event has been created.' : 'Your event has been updated.', 'success');
    editor.hidden = true;
    setEventForm(null);
  } catch (error) {
    showMessage(error.message || 'Could not save your event.', 'error');
  } finally {
    saveButton.disabled = false;
  }
}

async function initialize() {
  document.querySelectorAll('[data-current-year]').forEach((element) => {
    element.textContent = String(new Date().getFullYear());
  });
  document.querySelector('#new-event').addEventListener('click', () => {
    setEventForm(null);
    editor.hidden = false;
    editor.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  document.querySelector('#close-editor').addEventListener('click', () => {
    editor.hidden = true;
  });
  document.querySelector('#cancel-editor').addEventListener('click', () => {
    editor.hidden = true;
  });
  eventForm.addEventListener('submit', saveEvent);

  try {
    const { user } = await requestJson('/api/auth/me');
    if (!user) {
      window.location.replace(`/login.html?next=${encodeURIComponent('/organizer/dashboard.html')}`);
      return;
    }
    if (user.role !== 'organizer') {
      showMessage('An organizer account is required to manage events.', 'error');
      return;
    }

    await loadEvents();
  } catch (error) {
    showMessage(error.message || 'Organizer events could not be loaded.', 'error');
  }
}

initialize();
