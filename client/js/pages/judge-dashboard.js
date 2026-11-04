const message = document.querySelector('#judge-message');
const eventList = document.querySelector('#assigned-events');
const submissionHeading = document.querySelector('#submission-heading');
const submissionList = document.querySelector('#submission-list');

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

function formatDate(value) {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(value));
}

function createSubmissionCard(submission) {
  const card = document.createElement('article');
  card.className = 'judge-submission-card';
  const title = document.createElement('h3');
  title.textContent = submission.projectName;
  const team = document.createElement('p');
  team.className = 'judge-team-name';
  team.textContent = submission.teamName;
  const description = document.createElement('p');
  description.textContent = submission.description;
  card.append(title, team, description);
  const links = document.createElement('div');
  links.className = 'submission-links';
  for (const [label, url] of [['Repository', submission.repositoryUrl], ['Demo', submission.demoUrl]]) {
    if (!url) continue;
    const link = document.createElement('a');
    link.href = url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = label;
    links.append(link);
  }
  if (links.childElementCount > 0) card.append(links);

  const form = document.createElement('form');
  form.className = 'evaluation-form';
  const scoreLabel = document.createElement('label');
  scoreLabel.textContent = 'Score (0–100)';
  const score = document.createElement('input');
  score.type = 'number';
  score.name = 'score';
  score.min = '0';
  score.max = '100';
  score.step = '1';
  score.required = true;
  score.value = submission.evaluation ? String(submission.evaluation.score) : '';
  scoreLabel.append(score);
  const feedbackLabel = document.createElement('label');
  feedbackLabel.textContent = 'Feedback';
  const feedback = document.createElement('textarea');
  feedback.name = 'feedback';
  feedback.rows = 3;
  feedback.maxLength = 2000;
  feedback.required = true;
  feedback.value = submission.evaluation?.feedback || '';
  feedbackLabel.append(feedback);
  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.className = 'organizer-primary';
  submit.textContent = submission.evaluation ? 'Update evaluation' : 'Save evaluation';
  form.append(scoreLabel, feedbackLabel, submit);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    submit.disabled = true;
    try {
      await requestJson(
        `/api/judging/events/${encodeURIComponent(submission.eventId)}/submissions/${submission.id}/evaluation`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ score: Number(score.value), feedback: feedback.value }),
        },
      );
      showMessage(`Evaluation saved for ${submission.teamName}.`, 'success');
      submit.textContent = 'Update evaluation';
    } catch (error) {
      showMessage(error.message, 'error');
    } finally {
      submit.disabled = false;
    }
  });
  card.append(form);
  return card;
}

async function loadSubmissions(event) {
  submissionHeading.textContent = event.title;
  submissionList.replaceChildren();
  showMessage(`Loading submissions for ${event.title}…`);
  try {
    const { submissions } = await requestJson(
      `/api/judging/events/${encodeURIComponent(event.id)}/submissions`,
    );
    if (submissions.length === 0) {
      showMessage('No team submissions have been received for this event.');
      return;
    }
    submissionList.replaceChildren(...submissions.map((submission) => {
      submission.eventId = event.id;
      return createSubmissionCard(submission);
    }));
    message.hidden = true;
  } catch (error) {
    showMessage(error.message, 'error');
  }
}

async function initialize() {
  document.querySelectorAll('[data-current-year]').forEach((element) => {
    element.textContent = String(new Date().getFullYear());
  });
  try {
    const { user } = await requestJson('/api/auth/me');
    if (!user) {
      window.location.replace(`/login.html?next=${encodeURIComponent('/judge/dashboard.html')}`);
      return;
    }
    if (user.role !== 'judge') {
      showMessage('A judge account is required to review submissions.', 'error');
      return;
    }
    const { events } = await requestJson('/api/judging/events');
    eventList.replaceChildren();
    if (events.length === 0) {
      showMessage('No events have been assigned to your judge account yet.');
      return;
    }
    for (const assignedEvent of events) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'assigned-event';
      const title = document.createElement('strong');
      title.textContent = assignedEvent.title;
      const status = document.createElement('span');
      status.textContent = `${assignedEvent.evaluatedCount} / ${assignedEvent.submissionCount} scored · ${formatDate(assignedEvent.startsAt)}`;
      button.append(title, status);
      button.addEventListener('click', () => loadSubmissions(assignedEvent));
      eventList.append(button);
    }
    await loadSubmissions(events[0]);
  } catch (error) {
    showMessage(error.message || 'Judge events could not be loaded.', 'error');
  }
}

initialize();
