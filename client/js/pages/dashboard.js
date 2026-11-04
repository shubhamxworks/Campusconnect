const dashboardGreeting = document.querySelector('#dashboard-greeting');
const dashboardMessage = document.querySelector('#dashboard-message');
const myEventsList = document.querySelector('#my-events-list');
const upcomingCount = document.querySelector('#upcoming-count');
const waitlistCount = document.querySelector('#waitlist-count');
const attendedCount = document.querySelector('#attended-count');

function formatEventDate(event) {
  const start = new Date(event.startsAt);
  const end = new Date(event.endsAt);
  const sameDay = start.toDateString() === end.toDateString();
  const date = new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(start);
  const time = new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });

  return `${date} · ${time.format(start)}${sameDay ? `–${time.format(end)}` : ''}`;
}

function makeElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) {
    element.className = className;
  }
  if (text) {
    element.textContent = text;
  }
  return element;
}

function createRegistrationCard(event) {
  const article = makeElement('article', 'my-event-card');
  const artwork = makeElement('div', 'my-event-art', event.artwork);
  artwork.dataset.category = event.category.toLowerCase();
  artwork.setAttribute('aria-hidden', 'true');

  const content = makeElement('div', 'my-event-content');
  const metadata = makeElement('div', 'my-event-metadata');
  metadata.append(
    makeElement('span', 'my-event-category', event.category),
    makeElement('span', `my-event-status is-${event.registration.status}`, event.registration.status),
  );
  const title = makeElement('h3', '', event.title);
  const date = makeElement('p', 'my-event-date', formatEventDate(event));
  const venue = makeElement('p', 'my-event-venue', `${event.venue} · ${event.format}`);
  const summary = makeElement('p', 'my-event-summary', event.summary);
  const detailsLink = makeElement('a', 'my-event-link', 'View event details');
  detailsLink.href = `/event-details.html?id=${encodeURIComponent(event.id)}`;
  detailsLink.setAttribute('aria-label', `View details for ${event.title}`);

  content.append(metadata, title, date, venue, summary, detailsLink);
  article.append(artwork, content);
  return article;
}

function showEmptyState() {
  const emptyState = makeElement('div', 'dashboard-empty-state');
  emptyState.append(
    makeElement('span', 'dashboard-empty-icon', '✦'),
    makeElement('h3', '', 'Your next great thing starts here.'),
    makeElement('p', '', 'You haven’t registered for an event yet. Find something that sparks your interest.'),
  );
  const discoverLink = makeElement('a', 'dashboard-empty-link', 'Explore campus events');
  discoverLink.href = '/events.html';
  emptyState.append(discoverLink);
  myEventsList.replaceChildren(emptyState);
}

async function loadMyEvents() {
  document.querySelectorAll('[data-current-year]').forEach((element) => {
    element.textContent = String(new Date().getFullYear());
  });

  try {
    const userResponse = await fetch('/api/auth/me');
    const currentUser = await userResponse.json();
    if (!userResponse.ok) {
      throw new Error(currentUser.error || 'Could not verify your account.');
    }
    if (!currentUser.user) {
      const next = encodeURIComponent('/dashboard.html');
      window.location.replace(`/login.html?next=${next}`);
      return;
    }

    dashboardGreeting.textContent = `Hi ${currentUser.user.displayName}, your registrations and waitlist updates are all in one place.`;
    const response = await fetch('/api/my-events');
    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.error || 'Could not load your registrations.');
    }

    const events = result.events;
    const now = Date.now();
    upcomingCount.textContent = String(events.filter((event) =>
      event.registration.status !== 'attended' && Date.parse(event.startsAt) >= now,
    ).length);
    waitlistCount.textContent = String(events.filter((event) =>
      event.registration.status === 'waitlisted',
    ).length);
    attendedCount.textContent = String(events.filter((event) =>
      event.registration.status === 'attended',
    ).length);
    myEventsList.setAttribute('aria-busy', 'false');
    dashboardMessage.hidden = true;

    if (events.length === 0) {
      showEmptyState();
      return;
    }

    myEventsList.replaceChildren(...events.map(createRegistrationCard));
  } catch (error) {
    myEventsList.setAttribute('aria-busy', 'false');
    dashboardMessage.classList.add('is-error');
    dashboardMessage.textContent = error.message || 'Your registrations could not be loaded.';
  }
}

loadMyEvents();
