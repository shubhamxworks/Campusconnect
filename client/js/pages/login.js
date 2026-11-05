const authContent = document.querySelector('#auth-content');
const authDescription = document.querySelector('#auth-description');
const authForm = document.querySelector('#auth-form');
const authMessage = document.querySelector('#auth-message');
const authTabs = document.querySelector('.auth-tabs');
const titleAccent = document.querySelector('#title-accent');
const loginTab = document.querySelector('#login-tab');
const registerTab = document.querySelector('#register-tab');
const nameField = document.querySelector('#name-field');
const displayNameInput = document.querySelector('#display-name');
const passwordInput = document.querySelector('#password');
const passwordHelp = document.querySelector('#password-help');
const submitButton = document.querySelector('#submit-auth');
const signedInPanel = document.querySelector('#signed-in');
const signedInGreeting = document.querySelector('#signed-in-greeting');
const logoutButton = document.querySelector('#logout-button');
const workspaceLink = document.querySelector('#workspace-link');

let isRegisterMode = false;

function showMessage(text, kind = '') {
  authMessage.hidden = false;
  authMessage.className = `auth-message${kind ? ` is-${kind}` : ''}`;
  authMessage.textContent = text;
}

function setMode(registerMode) {
  isRegisterMode = registerMode;
  loginTab.classList.toggle('is-active', !registerMode);
  loginTab.setAttribute('aria-pressed', String(!registerMode));
  registerTab.classList.toggle('is-active', registerMode);
  registerTab.setAttribute('aria-pressed', String(registerMode));
  nameField.hidden = !registerMode;
  displayNameInput.required = registerMode;
  passwordInput.autocomplete = registerMode ? 'new-password' : 'current-password';
  passwordInput.minLength = registerMode ? 12 : 1;
  passwordHelp.textContent = registerMode
    ? 'Use at least 12 characters.'
    : 'Use your CampusConnect password.';
  submitButton.textContent = registerMode ? 'Create account' : 'Sign in';
  document.querySelector('#login-title').firstChild.textContent = registerMode ? 'Join your ' : 'Welcome ';
  titleAccent.textContent = registerMode ? 'campus.' : 'back.';
  authDescription.textContent = registerMode
    ? 'Create your student account to get started with CampusConnect.'
    : 'Sign in to find events and connect with your campus community.';
  authMessage.hidden = true;
}

function showSignedIn(user) {
  authContent.hidden = true;
  signedInPanel.hidden = false;
  authTabs.hidden = true;
  authDescription.textContent = 'Your CampusConnect account is ready.';
  signedInGreeting.textContent = `You’re signed in as ${user.displayName}.`;
  if (user.role === 'admin') {
    workspaceLink.href = '/admin/dashboard.html';
    workspaceLink.textContent = 'Admin dashboard';
  } else if (user.role === 'organizer') {
    workspaceLink.href = '/organizer/dashboard.html';
    workspaceLink.textContent = 'Organizer workspace';
  } else if (user.role === 'judge') {
    workspaceLink.href = '/judge/dashboard.html';
    workspaceLink.textContent = 'Judge workspace';
  } else {
    workspaceLink.href = '/dashboard.html';
    workspaceLink.textContent = 'My events';
  }
}

async function submitAuth(event) {
  event.preventDefault();
  authMessage.hidden = true;
  submitButton.disabled = true;

  const formData = new FormData(authForm);
  const payload = {
    email: formData.get('email'),
    password: formData.get('password'),
  };
  if (isRegisterMode) {
    payload.displayName = formData.get('displayName');
  }

  try {
    const response = await fetch(`/api/auth/${isRegisterMode ? 'register' : 'login'}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const result = await response.json();

    if (!response.ok) {
      showMessage(result.error || 'We could not complete your request. Please try again.', 'error');
      return;
    }

    authForm.reset();
    const next = new URLSearchParams(window.location.search).get('next');
    if (next?.startsWith('/') && !next.startsWith('//')) {
      window.location.assign(next);
      return;
    }
    showSignedIn(result.user);
  } catch {
    showMessage('Could not reach CampusConnect. Check that the server is running and try again.', 'error');
  } finally {
    submitButton.disabled = false;
  }
}

async function signOut() {
  logoutButton.disabled = true;
  try {
    const response = await fetch('/api/auth/logout', { method: 'POST' });
    if (!response.ok) {
      throw new Error('Sign out failed.');
    }
    signedInPanel.hidden = true;
    authTabs.hidden = false;
    authContent.hidden = false;
    setMode(false);
    showMessage('You have signed out.', 'success');
  } catch {
    showMessage('Could not sign out. Please try again.', 'error');
  } finally {
    logoutButton.disabled = false;
  }
}

async function initializeLogin() {
  document.querySelectorAll('[data-current-year]').forEach((element) => {
    element.textContent = String(new Date().getFullYear());
  });

  loginTab.addEventListener('click', () => setMode(false));
  registerTab.addEventListener('click', () => setMode(true));
  authForm.addEventListener('submit', submitAuth);
  logoutButton.addEventListener('click', signOut);

  try {
    const configResponse = await fetch('/api/auth/config');
    const config = await configResponse.json();
    if (!configResponse.ok) {
      throw new Error(config.error || `Authentication setup check failed (${configResponse.status}).`);
    }
    if (!config.localAuthEnabled) {
      showMessage('Local login needs a PostgreSQL connection and a session secret. Check the authentication setup in the README.');
      return;
    }

    authContent.hidden = false;
    const meResponse = await fetch('/api/auth/me');
    const currentUser = await meResponse.json();
    if (!meResponse.ok) {
      throw new Error(currentUser.error || 'Could not load your account.');
    }
    if (currentUser.user) {
      showSignedIn(currentUser.user);
    }
  } catch (error) {
    showMessage(error.message || 'Sign-in is temporarily unavailable.', 'error');
  }
}

initializeLogin();
