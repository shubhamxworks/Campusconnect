const eventSelect = document.querySelector('#submission-event');
const message = document.querySelector('#submission-message');
const submissionForm = document.querySelector('#submission-form');
const teamRequired = document.querySelector('#team-required');
const saveButton = document.querySelector('#save-submission');

function showMessage(text, kind = '') {
  message.hidden = false;
  message.className = `submission-message${kind ? ` is-${kind}` : ''}`;
  message.textContent = text;
}

function resetSubmissionForm() {
  submissionForm.hidden = true;
  teamRequired.hidden = true;
  submissionForm.reset();
}

function fillSubmission(submission) {
  if (!submission) {
    submissionForm.reset();
    saveButton.textContent = 'Submit project';
    return;
  }

  document.querySelector('#submission-team').textContent = `Submitting as ${submission.teamName}`;
  document.querySelector('#project-name').value = submission.projectName;
  document.querySelector('#project-description').value = submission.description;
  document.querySelector('#repository-url').value = submission.repositoryUrl;
  document.querySelector('#demo-url').value = submission.demoUrl;
  saveButton.textContent = 'Update submission';
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

async function loadSubmission() {
  resetSubmissionForm();
  const eventId = eventSelect.value;
  if (!eventId) {
    message.hidden = true;
    return;
  }

  message.hidden = true;
  try {
    const { submission } = await requestJson(`/api/submissions/${encodeURIComponent(eventId)}`);
    const { team } = await requestJson(`/api/teams/${encodeURIComponent(eventId)}`);
    document.querySelector('#submission-team').textContent = `Submitting as ${team.name}`;
    if (submission) {
      fillSubmission(submission);
      document.querySelector('#submission-team').textContent = `Submitting as ${team.name}`;
    } else {
      fillSubmission(null);
    }

    const teamUrl = `/team.html?event=${encodeURIComponent(eventId)}`;
    document.querySelector('#submission-team-link').href = teamUrl;
    teamRequired.hidden = true;
    submissionForm.hidden = false;
  } catch (error) {
    if (error.status === 403) {
      const teamUrl = `/team.html?event=${encodeURIComponent(eventId)}`;
      document.querySelector('#team-required-link').href = teamUrl;
      teamRequired.hidden = false;
      showMessage('A team is required for this event.', 'error');
      return;
    }
    showMessage(error.message || 'Could not load your project submission.', 'error');
  }
}

async function saveSubmission(event) {
  event.preventDefault();
  const eventId = eventSelect.value;
  if (!eventId) {
    showMessage('Choose an event before submitting a project.', 'error');
    return;
  }

  saveButton.disabled = true;
  message.hidden = true;
  try {
    const { submission } = await requestJson(`/api/submissions/${encodeURIComponent(eventId)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectName: document.querySelector('#project-name').value,
        description: document.querySelector('#project-description').value,
        repositoryUrl: document.querySelector('#repository-url').value,
        demoUrl: document.querySelector('#demo-url').value,
      }),
    });
    document.querySelector('#submission-team').textContent = `Submitting as ${submission.teamName}`;
    fillSubmission(submission);
    showMessage('Your team project submission has been saved.', 'success');
  } catch (error) {
    showMessage(error.message || 'Could not save your project submission.', 'error');
  } finally {
    saveButton.disabled = false;
  }
}

async function initializeSubmissions() {
  document.querySelectorAll('[data-current-year]').forEach((element) => {
    element.textContent = String(new Date().getFullYear());
  });
  submissionForm.addEventListener('submit', saveSubmission);
  eventSelect.addEventListener('change', loadSubmission);

  try {
    const { user } = await requestJson('/api/auth/me');
    if (!user) {
      window.location.replace(`/login.html?next=${encodeURIComponent('/submissions.html')}`);
      return;
    }
    if (user.role !== 'student') {
      showMessage('Project submissions are available to student accounts.', 'error');
      return;
    }

    const { events } = await requestJson('/api/events');
    eventSelect.replaceChildren(new Option('Choose an event', ''));
    for (const event of events) {
      eventSelect.add(new Option(event.title, event.id));
    }
    eventSelect.disabled = false;

    const selectedEvent = new URLSearchParams(window.location.search).get('event');
    if (selectedEvent && events.some((event) => event.id === selectedEvent)) {
      eventSelect.value = selectedEvent;
      await loadSubmission();
    } else {
      showMessage('Choose an event to view or submit your team project.');
    }
  } catch (error) {
    showMessage(error.message || 'Project submissions could not be loaded.', 'error');
  }
}

initializeSubmissions();
