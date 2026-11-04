async function loadAdminAuditLogs() {
  const { requireAdmin, requestJson, showMessage, hideMessage, cell, formatDate } = window.CampusConnectAdmin;
  const message = document.querySelector('#admin-message');
  if (!(await requireAdmin())) return;
  try {
    const { logs } = await requestJson('/api/admin/audit-logs');
    const body = document.querySelector('#audit-body');
    body.replaceChildren(...logs.map((entry) => {
      const row = document.createElement('tr');
      cell(row, formatDate(entry.createdAt));
      cell(row, `${entry.actor.name}${entry.actor.email ? ` · ${entry.actor.email}` : ''}`);
      cell(row, entry.action);
      cell(row, `${entry.targetType} ${entry.targetId}`);
      cell(row, JSON.stringify(entry.details));
      return row;
    }));
    if (logs.length === 0) showMessage(message, 'No administrator actions have been recorded yet.');
    else hideMessage(message);
  } catch (error) {
    showMessage(message, error.message || 'Audit logs could not be loaded.', 'error');
  }
}

loadAdminAuditLogs();
