const eventSelect = document.querySelector('#leaderboard-event');
const message = document.querySelector('#leaderboard-message');
const resultsBody = document.querySelector('#leaderboard-body');
const metadata = document.querySelector('#leaderboard-meta');

function showMessage(text, kind = '') {
  message.hidden = false;
  message.className = `organizer-message${kind ? ` is-${kind}` : ''}`;
  message.textContent = text;
}

async function requestJson(url) {
  const response = await fetch(url);
  const result = await response.json();
  if (!response.ok) {
    throw new Error(result.error || 'The request could not be completed.');
  }
  return result;
}

function appendCell(row, value) {
  const cell = document.createElement('td');
  cell.textContent = value;
  row.append(cell);
}

async function loadResults() {
  const id = eventSelect.value;
  resultsBody.replaceChildren();
  metadata.textContent = '';
  if (!id) {
    showMessage('There are no published event results yet.');
    return;
  }
  try {
    const { results } = await requestJson(`/api/results/events/${encodeURIComponent(id)}`);
    metadata.textContent = `Published ${new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(results.publishedAt))}.`;
    resultsBody.replaceChildren(...results.results.map((result) => {
      const row = document.createElement('tr');
      appendCell(row, String(result.rank));
      appendCell(row, result.teamName);
      appendCell(row, result.projectName);
      appendCell(row, result.averageScore === null ? 'Not scored' : `${result.averageScore.toFixed(2)} / 100`);
      appendCell(row, String(result.evaluationCount));
      return row;
    }));
    if (results.results.length === 0) {
      showMessage('No team submissions are listed in this leaderboard.');
    } else {
      message.hidden = true;
    }
  } catch (error) {
    showMessage(error.message, 'error');
  }
}

async function initialize() {
  document.querySelectorAll('[data-current-year]').forEach((element) => {
    element.textContent = String(new Date().getFullYear());
  });
  eventSelect.addEventListener('change', loadResults);
  try {
    const { events } = await requestJson('/api/results/events');
    const requestedEvent = new URLSearchParams(window.location.search).get('event');
    eventSelect.replaceChildren(...events.map((event) => {
      const option = document.createElement('option');
      option.value = event.id;
      option.textContent = event.title;
      return option;
    }));
    if (events.some((event) => event.id === requestedEvent)) {
      eventSelect.value = requestedEvent;
    }
    if (events.length === 0) {
      eventSelect.disabled = true;
      showMessage('There are no published event results yet.');
      return;
    }
    await loadResults();
  } catch (error) {
    showMessage(error.message || 'Published results could not be loaded.', 'error');
  }
}

initialize();
