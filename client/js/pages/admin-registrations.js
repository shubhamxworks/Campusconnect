async function loadAdminRegistrations() {
  const { requireAdmin, requestJson, showMessage, hideMessage, cell, formatDate } = window.CampusConnectAdmin;
  const message = document.querySelector('#admin-message');
  if (!(await requireAdmin())) return;
  const statusFilter = document.querySelector('#registration-status');

  async function render() {
    showMessage(message, 'Loading registrations…');
    const query = statusFilter.value
      ? `?status=${encodeURIComponent(statusFilter.value)}`
      : '';
    try {
      const { registrations } = await requestJson(`/api/admin/registrations${query}`);
      const body = document.querySelector('#registrations-body');
      body.replaceChildren(...registrations.map((registration) => {
        const row = document.createElement('tr');
        cell(row, registration.eventTitle);
        cell(row, registration.displayName);
        cell(row, registration.email);
        cell(row, registration.status);
        cell(row, formatDate(registration.registeredAt));
        return row;
      }));
      if (registrations.length === 0) showMessage(message, 'No registrations match this filter.');
      else hideMessage(message);
    } catch (error) {
      showMessage(message, error.message || 'Registrations could not be loaded.', 'error');
    }
  }

  statusFilter.addEventListener('change', render);
  await render();
}

loadAdminRegistrations();
