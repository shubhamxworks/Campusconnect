async function loadAdminDashboard() {
  const { requireAdmin, requestJson, showMessage, hideMessage } = window.CampusConnectAdmin;
  const message = document.querySelector('#admin-message');
  if (!(await requireAdmin())) return;
  try {
    const { summary } = await requestJson('/api/admin/summary');
    const cards = [
      ['Accounts', summary.users.total, `${summary.users.organizers} organizers · ${summary.users.judges} judges`],
      ['Events', summary.events, `${summary.judgeAssignments} judge assignments`],
      ['Registrations', summary.registrations.total, `${summary.registrations.registered} active · ${summary.registrations.waitlisted} waitlisted`],
      ['Attendance', summary.registrations.attended, 'Attended registrations'],
      ['Administrators', summary.users.admins, 'Accounts with admin access'],
    ];
    const container = document.querySelector('#admin-summary');
    container.replaceChildren(...cards.map(([label, value, detail]) => {
      const card = document.createElement('article');
      card.className = 'admin-stat';
      const title = document.createElement('span');
      title.textContent = label;
      const count = document.createElement('strong');
      count.textContent = String(value);
      const note = document.createElement('small');
      note.textContent = detail;
      card.append(title, count, note);
      return card;
    }));
    hideMessage(message);
  } catch (error) {
    showMessage(message, error.message || 'Platform summary could not be loaded.', 'error');
  }
}

loadAdminDashboard();
