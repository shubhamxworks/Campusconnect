const searchInput = document.querySelector('#event-search');
const categoryFilters = document.querySelector('#event-categories');
const eventGrid = document.querySelector('#event-grid');
const eventCount = document.querySelector('#event-count');
const eventMessage = document.querySelector('#event-message');
const categoryLabels = new Map([
  ['Hackathon', 'Hackathons'],
  ['Workshop', 'Workshops'],
  ['Networking', 'Networking'],
  ['Competition', 'Competitions'],
  ['Talk', 'Talks'],
]);

let selectedCategory = 'all';
let searchTimer;
let activeRequest;

function formatDate(value, options) {
  return new Intl.DateTimeFormat(undefined, options).format(new Date(value));
}

function eventDateLabel(event) {
  const start = new Date(event.startsAt);
  const end = new Date(event.endsAt);
  const sameDay = start.toDateString() === end.toDateString();
  const date = formatDate(event.startsAt, { month: 'short', day: 'numeric' });
  const startTime = formatDate(event.startsAt, { hour: 'numeric', minute: '2-digit' });
  const endTime = formatDate(event.endsAt, { hour: 'numeric', minute: '2-digit' });

  return `${date} · ${startTime}${sameDay ? `–${endTime}` : ''}`;
}

function createEventCard(event) {
  const link = document.createElement('a');
  link.className = 'event-card';
  link.href = `/event-details.html?id=${encodeURIComponent(event.id)}`;
  link.setAttribute('aria-label', `${event.title}, ${event.category}. View event details.`);

  const artwork = document.createElement('div');
  artwork.className = 'event-card-art';
  artwork.dataset.category = event.category.toLowerCase();
  artwork.setAttribute('aria-hidden', 'true');

  const glyph = document.createElement('span');
  glyph.className = 'event-art-glyph';
  glyph.textContent = event.artwork;
  artwork.append(glyph);

  const category = document.createElement('span');
  category.className = 'event-art-category';
  category.textContent = event.category;
  artwork.append(category);

  const body = document.createElement('div');
  body.className = 'event-card-body';

  const date = document.createElement('p');
  date.className = 'event-date';
  date.textContent = eventDateLabel(event);

  const title = document.createElement('h3');
  title.textContent = event.title;

  const summary = document.createElement('p');
  summary.className = 'event-summary';
  summary.textContent = event.summary;

  const location = document.createElement('p');
  location.className = 'event-location';
  location.textContent = `${event.venue} · ${event.format}`;

  const footer = document.createElement('div');
  footer.className = 'event-card-footer';

  const organizer = document.createElement('span');
  organizer.className = 'event-organizer';
  organizer.textContent = event.organizer;

  const arrow = document.createElement('span');
  arrow.className = 'event-card-arrow';
  arrow.setAttribute('aria-hidden', 'true');
  arrow.textContent = '↗';

  footer.append(organizer, arrow);
  body.append(date, title, summary, location, footer);
  link.append(artwork, body);
  return link;
}

function setMessage(message, isError = false) {
  eventMessage.hidden = false;
  eventMessage.classList.toggle('is-error', isError);
  eventMessage.textContent = message;
}

function renderCategories(categories) {
  const fragment = document.createDocumentFragment();

  const allButton = document.createElement('button');
  allButton.className = `category-chip${selectedCategory === 'all' ? ' is-active' : ''}`;
  allButton.type = 'button';
  allButton.dataset.category = 'all';
  allButton.setAttribute('aria-pressed', String(selectedCategory === 'all'));
  allButton.textContent = 'All events';
  fragment.append(allButton);

  for (const category of categories) {
    const button = document.createElement('button');
    button.className = `category-chip${selectedCategory === category ? ' is-active' : ''}`;
    button.type = 'button';
    button.dataset.category = category;
    button.setAttribute('aria-pressed', String(selectedCategory === category));
    button.textContent = categoryLabels.get(category) ?? category;
    fragment.append(button);
  }

  categoryFilters.replaceChildren(fragment);
}

async function loadEvents() {
  activeRequest?.abort();
  activeRequest = new AbortController();
  const request = activeRequest;
  eventGrid.setAttribute('aria-busy', 'true');
  eventMessage.hidden = true;
  const params = new URLSearchParams();
  const query = searchInput.value.trim();

  if (query) {
    params.set('q', query);
  }
  if (selectedCategory !== 'all') {
    params.set('category', selectedCategory);
  }

  try {
    const response = await fetch(`/api/events?${params.toString()}`, { signal: request.signal });
    if (!response.ok) {
      throw new Error(`Could not load events (${response.status}).`);
    }

    const result = await response.json();
    renderCategories(result.categories);
    eventGrid.replaceChildren(...result.events.map(createEventCard));
    eventCount.textContent = `${result.total} ${result.total === 1 ? 'event' : 'events'}`;

    if (result.events.length === 0) {
      setMessage('No events match that search. Try another keyword or category.');
    }
  } catch (error) {
    if (error.name === 'AbortError') {
      return;
    }
    eventGrid.replaceChildren();
    eventCount.textContent = '';
    setMessage(error.message || 'Events could not be loaded. Please try again.', true);
  } finally {
    if (activeRequest === request) {
      eventGrid.setAttribute('aria-busy', 'false');
    }
  }
}

categoryFilters.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-category]');
  if (!button) {
    return;
  }
  selectedCategory = button.dataset.category;
  loadEvents();
});

searchInput.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(loadEvents, 180);
});

document.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    searchInput.focus();
    searchInput.select();
  }
});

document.querySelectorAll('[data-current-year]').forEach((element) => {
  element.textContent = String(new Date().getFullYear());
});

const initialParams = new URLSearchParams(window.location.search);
const initialCategory = initialParams.get('category');
if (initialCategory && categoryLabels.has(initialCategory)) {
  selectedCategory = initialCategory;
}
searchInput.value = initialParams.get('q') ?? '';
loadEvents();
