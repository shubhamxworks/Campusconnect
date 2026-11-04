async function loadAdminEvents() {
  const { requireAdmin, requestJson, showMessage, hideMessage, cell, formatDate } = window.CampusConnectAdmin;
  const message = document.querySelector('#admin-message');
  if (!(await requireAdmin())) return;
  try {
    const { events } = await requestJson('/api/admin/events');
    const body = document.querySelector('#events-body');
    body.replaceChildren(...events.map((event) => {
      const row = document.createElement('tr');
      cell(row, event.title);
      cell(row, `${event.category} · ${formatDate(event.startsAt)}`);
      cell(row, event.organizer ? `${event.organizer.name} · ${event.organizer.email}` : 'No organizer assigned');
      cell(row, `${event.registrationCount} / ${event.capacity}`);
      cell(row, String(event.submissionCount));
      cell(row, String(event.judgeCount));
      return row;
    }));
    if (events.length === 0) showMessage(message, 'No events have been created yet.');
    else hideMessage(message);
  } catch (error) {
    showMessage(message, error.message || 'Events could not be loaded.', 'error');
  }
}

loadAdminEvents();
