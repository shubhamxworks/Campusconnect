const eventSelect = document.querySelector('#event-select');
const judgeForm = document.querySelector('#judge-form');
const message = document.querySelector('#judges-message');
const judgeList = document.querySelector('#judge-list');

function showMessage(text, kind = '') {
  message.hidden = false;
  message.className = `organizer-message${kind ? ` is-${kind}` : ''}`;
  message.textContent = text;
}

async function requestJson(url, options) {
  const response = await fetch(url, options);
  const result = response.status === 204 ? {} : await response.json();
  if (!response.ok) {
    throw new Error(result.error || 'The request could not be completed.');
  }
  return result;
}

async function loadJudges() {
  if (!eventSelect.value) {
    judgeList.replaceChildren();
    showMessage('Create an event before assigning judges.');
    return;
  }
  const { judges } = await requestJson(
    `/api/organizer/events/${encodeURIComponent(eventSelect.value)}/judges`,
  );
  judgeList.replaceChildren();
  if (judges.length === 0) {
    showMessage('No judges are assigned to this event yet.');
    return;
  }
  for (const judge of judges) {
    const item = document.createElement('article');
    item.className = 'judge-person';
    const identity = document.createElement('div');
    const name = document.createElement('strong');
    name.textContent = judge.displayName;
    const email = document.createElement('p');
    email.textContent = judge.email;
    identity.append(name, email);
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'organizer-secondary';
    remove.textContent = 'Remove';
    remove.setAttribute('aria-label', `Remove ${judge.displayName} from this event`);
    remove.addEventListener('click', async () => {
      remove.disabled = true;
      try {
        await requestJson(
          `/api/organizer/events/${encodeURIComponent(eventSelect.value)}/judges/${judge.id}`,
          { method: 'DELETE' },
        );
        await loadJudges();
        showMessage('Judge assignment removed.', 'success');
      } catch (error) {
        showMessage(error.message, 'error');
        remove.disabled = false;
      }
    });
    item.append(identity, remove);
    judgeList.append(item);
  }
  message.hidden = true;
}

async function initialize() {
  document.querySelectorAll('[data-current-year]').forEach((element) => {
    element.textContent = String(new Date().getFullYear());
  });
  eventSelect.addEventListener('change', () => {
    loadJudges().catch((error) => showMessage(error.message, 'error'));
  });
  judgeForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const submit = judgeForm.querySelector('button[type="submit"]');
    submit.disabled = true;
    try {
      await requestJson(
        `/api/organizer/events/${encodeURIComponent(eventSelect.value)}/judges`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: document.querySelector('#judge-email').value }),
        },
      );
      judgeForm.reset();
      await loadJudges();
      showMessage('Judge assigned to this event.', 'success');
    } catch (error) {
      showMessage(error.message, 'error');
    } finally {
      submit.disabled = false;
    }
  });

  try {
    const { user } = await requestJson('/api/auth/me');
    if (!user) {
      window.location.replace(`/login.html?next=${encodeURIComponent('/organizer/judges.html')}`);
      return;
    }
    if (user.role !== 'organizer') {
      showMessage('An organizer account is required to manage event judges.', 'error');
      judgeForm.hidden = true;
      return;
    }
    const { events } = await requestJson('/api/organizer/events');
    eventSelect.replaceChildren(...events.map((event) => {
      const option = document.createElement('option');
      option.value = event.id;
      option.textContent = event.title;
      return option;
    }));
    const selectedEvent = new URLSearchParams(window.location.search).get('event');
    if (events.some((event) => event.id === selectedEvent)) {
      eventSelect.value = selectedEvent;
    }
    if (events.length === 0) {
      eventSelect.disabled = true;
      judgeForm.hidden = true;
      showMessage('Create an event before assigning judges.');
      return;
    }
    await loadJudges();
  } catch (error) {
    showMessage(error.message || 'Event judges could not be loaded.', 'error');
  }
}

initialize();
