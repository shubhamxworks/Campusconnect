async function loadAdminSettings() {
  const { requireAdmin, requestJson, showMessage, hideMessage } = window.CampusConnectAdmin;
  const message = document.querySelector('#admin-message');
  if (!(await requireAdmin())) return;
  try {
    const [{ settings }, health] = await Promise.all([
      requestJson('/api/admin/settings'),
      requestJson('/api/health'),
    ]);
    const entries = [
      ['Database', settings.database],
      ['Event data source', health.dataSource],
      ['Local account authentication', health.localAuthEnabled ? 'Enabled' : 'Disabled'],
      ['Google sign-in', health.googleSignInEnabled ? 'Enabled' : 'Disabled'],
      ...settings.roles.map(({ role, count }) => [`${role[0].toUpperCase()}${role.slice(1)} accounts`, String(count)]),
      ['Supported account roles', settings.supportedRoles.join(', ')],
    ];
    const list = document.querySelector('#settings-list');
    list.replaceChildren(...entries.flatMap(([label, value]) => {
      const term = document.createElement('dt');
      term.textContent = label;
      const description = document.createElement('dd');
      description.textContent = value;
      return [term, description];
    }));
    hideMessage(message);
  } catch (error) {
    showMessage(message, error.message || 'Settings could not be loaded.', 'error');
  }
}

loadAdminSettings();
