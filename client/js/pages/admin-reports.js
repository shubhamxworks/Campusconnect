async function loadAdminReports() {
  const { requireAdmin, requestJson, showMessage, hideMessage, cell, formatDate } = window.CampusConnectAdmin;
  const message = document.querySelector('#admin-message');
  if (!(await requireAdmin())) return;
  try {
    const { reports } = await requestJson('/api/admin/reports');
    const body = document.querySelector('#reports-body');
    body.replaceChildren(...reports.map((report) => {
      const row = document.createElement('tr');
      cell(row, report.title);
      cell(row, formatDate(report.startsAt));
      cell(row, String(report.capacity));
      cell(row, String(report.registeredCount));
      cell(row, String(report.waitlistedCount));
      cell(row, String(report.submissionCount));
      cell(row, String(report.judgeCount));
      cell(row, report.averageScore === null ? '—' : report.averageScore.toFixed(2));
      return row;
    }));
    if (reports.length === 0) showMessage(message, 'No event reports are available yet.');
    else hideMessage(message);
  } catch (error) {
    showMessage(message, error.message || 'Reports could not be loaded.', 'error');
  }
}

loadAdminReports();
