const profileForm = document.querySelector('#profile-form');
const profileMessage = document.querySelector('#profile-message');
const profileActions = document.querySelector('#profile-actions');
const displayNameInput = document.querySelector('#display-name');
const emailInput = document.querySelector('#email');
const roleLabel = document.querySelector('#role');
const saveButton = document.querySelector('#save-profile');
const logoutButton = document.querySelector('#logout-button');
const roleWorkspaceLink = document.querySelector('#role-workspace-link');

function showMessage(message, kind = '') {
  profileMessage.hidden = false;
  profileMessage.className = `profile-message${kind ? ` is-${kind}` : ''}`;
  profileMessage.textContent = message;
}

function displayUser(user) {
  displayNameInput.value = user.displayName;
  emailInput.value = user.email;
  roleLabel.textContent = user.role;
  const workspace = {
    admin: ['/admin/dashboard.html', 'Admin workspace'],
    organizer: ['/organizer/dashboard.html', 'Organizer workspace'],
    judge: ['/judge/dashboard.html', 'Judge workspace'],
  }[user.role];
  if (workspace) {
    [roleWorkspaceLink.href, roleWorkspaceLink.textContent] = workspace;
    roleWorkspaceLink.hidden = false;
  } else {
    roleWorkspaceLink.hidden = true;
  }
}

async function saveProfile(event) {
  event.preventDefault();
  saveButton.disabled = true;
  profileMessage.hidden = true;

  try {
    const response = await fetch('/api/auth/profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ displayName: displayNameInput.value }),
    });
    const result = await response.json();
    if (!response.ok) {
      showMessage(result.error || 'Could not save your profile. Please try again.', 'error');
      return;
    }

    displayUser(result.user);
    showMessage('Your display name has been updated.', 'success');
  } catch {
    showMessage('Could not reach CampusConnect. Check your connection and try again.', 'error');
  } finally {
    saveButton.disabled = false;
  }
}

async function signOut() {
  logoutButton.disabled = true;
  try {
    const response = await fetch('/api/auth/logout', { method: 'POST' });
    if (!response.ok) {
      throw new Error('Sign out failed.');
    }
    window.location.assign('/login.html');
  } catch {
    showMessage('Could not sign out. Please try again.', 'error');
    logoutButton.disabled = false;
  }
}

async function initializeProfile() {
  document.querySelectorAll('[data-current-year]').forEach((element) => {
    element.textContent = String(new Date().getFullYear());
  });
  profileForm.addEventListener('submit', saveProfile);
  logoutButton.addEventListener('click', signOut);

  try {
    const response = await fetch('/api/auth/me');
    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.error || 'Could not load your profile.');
    }
    if (!result.user) {
      const next = encodeURIComponent('/profile.html');
      window.location.replace(`/login.html?next=${next}`);
      return;
    }

    displayUser(result.user);
    profileForm.hidden = false;
    profileActions.hidden = false;
  } catch (error) {
    showMessage(error.message || 'Your profile could not be loaded.', 'error');
  }
}

initializeProfile();
