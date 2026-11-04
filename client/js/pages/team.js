const eventSelect = document.querySelector('#team-event');
const teamMessage = document.querySelector('#team-message');
const teamOptions = document.querySelector('#team-options');
const currentTeamSection = document.querySelector('#current-team');
const createTeamForm = document.querySelector('#create-team-form');
const joinTeamForm = document.querySelector('#join-team-form');
const teamMembers = document.querySelector('#team-members');

function showMessage(message, isError = false) {
  teamMessage.textContent = message;
  teamMessage.classList.toggle('is-error', isError);
  teamMessage.hidden = false;
}

function clearMessage() {
  teamMessage.hidden = true;
  teamMessage.classList.remove('is-error');
  teamMessage.textContent = '';
}

async function requestJson(url, options) {
  const response = await fetch(url, options);
  const result = await response.json();
  if (!response.ok) {
    throw new Error(result.error || 'The request could not be completed.');
  }
  return result;
}

function renderTeam(team) {
  currentTeamSection.hidden = !team;
  teamOptions.hidden = Boolean(team);
  if (!team) {
    return;
  }

  document.querySelector('#current-team-title').textContent = team.name;
  document.querySelector('#team-event-title').textContent = team.eventTitle;
  document.querySelector('#invitation-code').textContent = team.invitationCode;
  document.querySelector('#team-submission-link').href =
    `/submissions.html?event=${encodeURIComponent(team.eventId)}`;
  teamMembers.replaceChildren(...team.members.map((member) => {
    const item = document.createElement('li');
    const avatar = document.createElement('span');
    avatar.className = 'member-avatar';
    avatar.setAttribute('aria-hidden', 'true');
    avatar.textContent = member.name.trim().charAt(0).toUpperCase();
    const name = document.createElement('span');
    name.textContent = member.name;
    item.append(avatar, name);
    return item;
  }));
}

async function loadTeam() {
  clearMessage();
  renderTeam(null);
  const eventId = eventSelect.value;
  if (!eventId) {
    teamOptions.hidden = true;
    return;
  }

  try {
    const { team } = await requestJson(`/api/teams/${encodeURIComponent(eventId)}`);
    renderTeam(team);
  } catch (error) {
    showMessage(error.message, true);
  }
}

async function submitTeamForm(event, endpoint, payload) {
  event.preventDefault();
  clearMessage();
  const eventId = eventSelect.value;
  if (!eventId) {
    showMessage('Choose an event first.', true);
    return;
  }
  const submitButton = event.currentTarget.querySelector('button[type="submit"]');
  submitButton.disabled = true;
  try {
    const result = await requestJson(`/api/teams/${encodeURIComponent(eventId)}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload()),
    });
    renderTeam(result.team);
    showMessage(endpoint === '/join' ? 'You joined the team.' : 'Your team is ready.');
  } catch (error) {
    showMessage(error.message, true);
  } finally {
    submitButton.disabled = false;
  }
}

async function initialize() {
  document.querySelectorAll('[data-current-year]').forEach((element) => {
    element.textContent = String(new Date().getFullYear());
  });

  try {
    const { user } = await requestJson('/api/auth/me');
    if (!user) {
      window.location.replace(`/login.html?next=${encodeURIComponent('/team.html')}`);
      return;
    }

    const { events } = await requestJson('/api/events');
    eventSelect.replaceChildren(new Option('Select an event', ''));
    for (const event of events) {
      eventSelect.add(new Option(event.title, event.id));
    }
    eventSelect.disabled = false;
    const selectedEvent = new URLSearchParams(window.location.search).get('event');
    if (selectedEvent && events.some((event) => event.id === selectedEvent)) {
      eventSelect.value = selectedEvent;
    }
    await loadTeam();
  } catch (error) {
    showMessage(error.message || 'Teams could not be loaded.', true);
  }
}

eventSelect.addEventListener('change', loadTeam);
createTeamForm.addEventListener('submit', (event) => submitTeamForm(
  event,
  '',
  () => ({ name: document.querySelector('#team-name').value }),
));
joinTeamForm.addEventListener('submit', (event) => submitTeamForm(
  event,
  '/join',
  () => ({ invitationCode: document.querySelector('#invitation-input').value }),
));
document.querySelector('#leave-team').addEventListener('click', async () => {
  const eventId = eventSelect.value;
  clearMessage();
  try {
    await requestJson(`/api/teams/${encodeURIComponent(eventId)}`, { method: 'DELETE' });
    renderTeam(null);
    showMessage('You left the team.');
  } catch (error) {
    showMessage(error.message, true);
  }
});

initialize();
