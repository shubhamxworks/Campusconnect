const detailsContainer = document.querySelector('#event-details');
const detailsMessage = document.querySelector('#details-message');
const eventId = new URLSearchParams(window.location.search).get('id');

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

function formatDate(value, options) {
  return new Intl.DateTimeFormat(undefined, options).format(new Date(value));
}

function formatEventDate(event) {
  const start = new Date(event.startsAt);
  const end = new Date(event.endsAt);
  const dateOptions = { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' };
  const timeOptions = { hour: 'numeric', minute: '2-digit' };
  const date = formatDate(event.startsAt, dateOptions);
  const startTime = formatDate(event.startsAt, timeOptions);
  const endTime = formatDate(event.endsAt, timeOptions);
  const sameDay = start.toDateString() === end.toDateString();

  return `${date} · ${startTime}${sameDay ? `–${endTime}` : ` – ${formatDate(event.endsAt, dateOptions)} ${endTime}`}`;
}

function renderEvent(event) {
  document.title = `${event.title} — CampusConnect`;

  const hero = makeElement('section', 'details-hero');
  const artwork = makeElement('div', 'details-art');
  artwork.dataset.category = event.category.toLowerCase();
  artwork.setAttribute('aria-hidden', 'true');
  artwork.append(makeElement('span', 'details-art-glyph', event.artwork));

  const intro = makeElement('div', 'details-intro');
  intro.append(
    makeElement('span', 'details-category', event.category),
    makeElement('h1', '', event.title),
    makeElement('p', 'details-summary', event.summary),
  );
  hero.append(artwork, intro);

  const content = makeElement('div', 'details-content');
  const about = makeElement('section', 'details-about');
  about.append(makeElement('p', 'eyebrow', 'A little more about it'), makeElement('h2', '', 'Come curious.'));
  about.append(makeElement('p', 'details-description', event.description));

  const tagList = makeElement('ul', 'event-tags');
  for (const tag of event.tags) {
    tagList.append(makeElement('li', '', tag));
  }
  about.append(tagList);

  const info = makeElement('aside', 'details-info');
  info.setAttribute('aria-label', 'Event information');
  const information = [
    ['When', formatEventDate(event)],
    ['Where', event.venue],
    ['Hosted by', event.organizer],
    ['Format', event.format],
    ['Registration closes', formatDate(event.registrationDeadline, { month: 'long', day: 'numeric', year: 'numeric' })],
    ['Places', `${Math.max(0, event.capacity - event.registeredCount)} of ${event.capacity} remaining`],
  ];

  for (const [label, value] of information) {
    const row = makeElement('div', 'details-info-row');
    row.append(makeElement('span', 'details-info-label', label), makeElement('strong', '', value));
    info.append(row);
  }

  const registrationControl = makeElement('div', 'registration-control');
  registrationControl.id = 'registration-control';
  registrationControl.setAttribute('aria-live', 'polite');
  registrationControl.append(makeElement('p', 'registration-note', 'Checking registration options…'));
  info.append(registrationControl);
  const teamLink = makeElement('a', 'registration-button', 'Find teammates');
  teamLink.href = `/team.html?event=${encodeURIComponent(event.id)}`;
  info.append(teamLink);
  const submissionLink = makeElement('a', 'registration-button is-secondary', 'Submit team project');
  submissionLink.href = `/submissions.html?event=${encodeURIComponent(event.id)}`;
  info.append(submissionLink);
  content.append(about, info);
  detailsContainer.replaceChildren(hero, content);
  loadRegistration(event, registrationControl);
}

function registrationButton(label, className, onClick) {
  const button = makeElement('button', className, label);
  button.type = 'button';
  button.addEventListener('click', onClick);
  return button;
}

function renderRegistration(event, control, user, registration, notice = '') {
  control.replaceChildren();
  const appendNotice = () => {
    if (notice) {
      control.append(makeElement('p', 'registration-note', notice));
    }
  };

  if (!user) {
    control.append(
      makeElement('p', 'registration-note', 'Sign in with your student account to register for this event.'),
    );
    const signIn = makeElement('a', 'registration-button', 'Sign in to register');
    const next = `/event-details.html?id=${encodeURIComponent(event.id)}`;
    signIn.href = `/login.html?next=${encodeURIComponent(next)}`;
    control.append(signIn);
    return;
  }

  const status = registration?.status;
  if (status === 'registered') {
    control.append(makeElement('p', 'registration-state is-registered', 'You’re registered for this event.'));
    control.append(registrationButton('Cancel registration', 'registration-button is-secondary', () => {
      updateRegistration(event, control, 'DELETE');
    }));
    appendNotice();
    return;
  }

  if (status === 'waitlisted') {
    control.append(makeElement('p', 'registration-state is-waitlisted', 'You’re on the waitlist for this event.'));
    control.append(registrationButton('Leave waitlist', 'registration-button is-secondary', () => {
      updateRegistration(event, control, 'DELETE');
    }));
    appendNotice();
    return;
  }

  if (status === 'attended') {
    control.append(makeElement('p', 'registration-state is-registered', 'Your attendance is recorded for this event.'));
    appendNotice();
    return;
  }

  control.append(makeElement('p', 'registration-note', 'Reserve your place at this campus event.'));
  control.append(registrationButton('Register for event', 'registration-button', () => {
    updateRegistration(event, control, 'POST');
  }));

  appendNotice();
}

async function loadRegistration(event, control) {
  try {
    const userResponse = await fetch('/api/auth/me');
    if (!userResponse.ok) {
      throw new Error('Could not check your sign-in status.');
    }

    const { user } = await userResponse.json();
    if (!user) {
      renderRegistration(event, control, null, null);
      return;
    }

    const response = await fetch(`/api/events/${encodeURIComponent(event.id)}/registration`);
    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.error || 'Could not load your registration.');
    }
    renderRegistration(event, control, user, result.registration, result.message);
  } catch (error) {
    control.replaceChildren(makeElement(
      'p',
      'registration-note is-error',
      error.message || 'Registration details could not be loaded.',
    ));
  }
}

async function updateRegistration(event, control, method) {
  const button = control.querySelector('button');
  if (button) {
    button.disabled = true;
  }

  try {
    const response = await fetch(`/api/events/${encodeURIComponent(event.id)}/registration`, {
      method,
      headers: method === 'POST' ? { 'Content-Type': 'application/json' } : {},
    });
    const result = await response.json();
    if (response.status === 401) {
      const next = `/event-details.html?id=${encodeURIComponent(event.id)}`;
      window.location.assign(`/login.html?next=${encodeURIComponent(next)}`);
      return;
    }
    if (!response.ok) {
      throw new Error(result.error || 'Could not update your registration.');
    }

    const userResponse = await fetch('/api/auth/me');
    const { user } = await userResponse.json();
    renderRegistration(event, control, user, result.registration);
  } catch (error) {
    control.append(makeElement(
      'p',
      'registration-note is-error',
      error.message || 'Could not update your registration.',
    ));
    if (button) {
      button.disabled = false;
    }
  }
}

async function loadEvent() {
  detailsContainer.setAttribute('aria-busy', 'true');

  if (!eventId) {
    detailsMessage.hidden = false;
    detailsMessage.textContent = 'Choose an event from the discovery page to see its details.';
    detailsContainer.setAttribute('aria-busy', 'false');
    return;
  }

  try {
    const response = await fetch(`/api/events/${encodeURIComponent(eventId)}`);
    if (response.status === 404) {
      detailsMessage.hidden = false;
      detailsMessage.textContent = 'We could not find that event. It may have been removed.';
      return;
    }
    if (!response.ok) {
      throw new Error(`Could not load event details (${response.status}).`);
    }

    const { event } = await response.json();
    renderEvent(event);
  } catch (error) {
    detailsMessage.hidden = false;
    detailsMessage.classList.add('is-error');
    detailsMessage.textContent = error.message || 'Event details could not be loaded. Please try again.';
  } finally {
    detailsContainer.setAttribute('aria-busy', 'false');
  }
}

document.querySelectorAll('[data-current-year]').forEach((element) => {
  element.textContent = String(new Date().getFullYear());
});

loadEvent();
