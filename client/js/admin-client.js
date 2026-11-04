(function exposeAdminClient(root) {
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

  async function requireAdmin() {
    try {
      const { user } = await requestJson('/api/auth/me');
      if (!user) {
        root.location.replace(`/login.html?next=${encodeURIComponent(root.location.pathname)}`);
        return null;
      }
      if (user.role !== 'admin') {
        const message = document.querySelector('#admin-message');
        if (message) {
          message.className = 'admin-message is-error';
          message.textContent = 'An administrator account is required to view this page.';
        }
        document.querySelectorAll('.admin-panel, .admin-summary, .admin-shortcuts')
          .forEach((element) => { element.hidden = true; });
        return null;
      }
      return user;
    } catch (error) {
      const message = document.querySelector('#admin-message');
      if (message) {
        showMessage(message, error.message || 'Administrator access could not be verified.', 'error');
      }
      return null;
    }
  }

  function showMessage(element, text, kind = '') {
    element.hidden = false;
    element.className = `admin-message${kind ? ` is-${kind}` : ''}`;
    element.textContent = text;
  }

  function hideMessage(element) {
    element.hidden = true;
  }

  function cell(row, text) {
    const item = document.createElement('td');
    item.textContent = text ?? '';
    row.append(item);
    return item;
  }

  function formatDate(value) {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(value));
  }

  document.querySelectorAll('[data-current-year]').forEach((element) => {
    element.textContent = String(new Date().getFullYear());
  });

  root.CampusConnectAdmin = { requestJson, requireAdmin, showMessage, hideMessage, cell, formatDate };
}(globalThis));
