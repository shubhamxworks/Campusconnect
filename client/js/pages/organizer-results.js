const message = document.querySelector('#results-message');
const resultsBody = document.querySelector('#results-body');
const publishButton = document.querySelector('#publish-results');
const publishStatus = document.querySelector('#publish-status');
const eventTitle = document.querySelector('#results-event-title');
const eventId = new URLSearchParams(window.location.search).get('event');

let resultsPublished = false;

function showMessage(text, kind = '') {
  message.hidden = false;
  message.className = `organizer-message${kind ? ` is-${kind}` : ''}`;
  message.textContent = text;
}

async function requestJson(url, options) {
  const response = await fetch(url, options);
  const result = await response.json();
  if (!response.ok) {
    throw new Error(result.error || 'The request could not be completed.');
  }
  return result;
}

function addCell(row, value) {
  const cell = document.createElement('td');
  cell.textContent = value;
  row.append(cell);
}

function renderResults(results) {
  eventTitle.textContent = results.eventTitle;
  resultsPublished = Boolean(results.publishedAt);
  publishButton.textContent = resultsPublished ? 'Unpublish results' : 'Publish results';
  publishButton.disabled = !resultsPublished && !results.canPublish;
  publishStatus.textContent = resultsPublished
    ? `Published ${new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(results.publishedAt))}.`
    : results.canPublish
      ? 'All submissions have at least one judge score and are ready to publish.'
      : 'Each submitted project needs at least one judge score before results can be published.';

  resultsBody.replaceChildren(...results.results.map((result) => {
    const row = document.createElement('tr');
    addCell(row, String(result.rank));
    addCell(row, result.teamName);
    addCell(row, result.projectName);
    addCell(row, result.evaluationCount ? `${result.averageScore.toFixed(2)} / 100` : 'Not scored');
    addCell(row, String(result.evaluationCount));
    return row;
  }));
  if (results.results.length === 0) {
    showMessage('No team submissions are available for this event yet.');
  } else {
    message.hidden = true;
  }
}

async function loadResults() {
  if (!eventId) {
    showMessage('Choose an event from the organizer dashboard to review its results.', 'error');
    return;
  }
  const { results } = await requestJson(
    `/api/organizer/events/${encodeURIComponent(eventId)}/results`,
  );
  renderResults(results);
}

async function initialize() {
  document.querySelectorAll('[data-current-year]').forEach((element) => {
    element.textContent = String(new Date().getFullYear());
  });
  publishButton.addEventListener('click', async () => {
    publishButton.disabled = true;
    try {
      const { results } = await requestJson(
        `/api/organizer/events/${encodeURIComponent(eventId)}/results`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ published: !resultsPublished }),
        },
      );
      renderResults(results);
      showMessage(
        results.publishedAt ? 'Results are now public.' : 'Results are no longer public.',
        'success',
      );
    } catch (error) {
      showMessage(error.message, 'error');
      publishButton.disabled = false;
    }
  });

  try {
    const { user } = await requestJson('/api/auth/me');
    if (!user) {
      window.location.replace(`/login.html?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
      return;
    }
    if (user.role !== 'organizer') {
      showMessage('An organizer account is required to manage results.', 'error');
      return;
    }
    await loadResults();
  } catch (error) {
    showMessage(error.message || 'Event results could not be loaded.', 'error');
  }
}

initialize();
