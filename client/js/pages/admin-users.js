async function loadAdminUsers() {
  const { requireAdmin, requestJson, showMessage, hideMessage, cell, formatDate } = window.CampusConnectAdmin;
  const message = document.querySelector('#admin-message');
  const body = document.querySelector('#users-body');
  const filterForm = document.querySelector('#user-filters');
  const search = document.querySelector('#user-search');
  const roleFilter = document.querySelector('#role-filter');
  const currentUser = await requireAdmin();
  if (!currentUser) return;

  async function renderUsers() {
    showMessage(message, 'Loading accounts…');
    const params = new URLSearchParams();
    if (search.value.trim()) params.set('q', search.value.trim());
    const role = filterForm.dataset.roleFilter || roleFilter.value;
    if (role) params.set('role', role);
    try {
      const { users } = await requestJson(`/api/admin/users?${params}`);
      body.replaceChildren(...users.map((user) => {
        const row = document.createElement('tr');
        cell(row, user.displayName);
        cell(row, user.email);
        const roleCell = cell(row, '');
        const select = document.createElement('select');
        select.className = 'admin-role-select';
        for (const [value, label] of [
          ['student', 'Student'],
          ['organizer', 'Organizer'],
          ['judge', 'Judge'],
          ['admin', 'Admin'],
        ]) {
          const option = document.createElement('option');
          option.value = value;
          option.textContent = label;
          select.append(option);
        }
        select.value = user.role;
        const isCurrentUser = user.id === currentUser.id;
        select.disabled = isCurrentUser;
        select.setAttribute('aria-label', `Role for ${user.displayName}`);
        roleCell.append(select);
        cell(row, formatDate(user.createdAt));
        const actionCell = cell(row, '');
        const save = document.createElement('button');
        save.className = 'admin-button compact';
        save.type = 'button';
        save.textContent = 'Save role';
        save.disabled = isCurrentUser;
        save.addEventListener('click', async () => {
          save.disabled = true;
          try {
            await requestJson(`/api/admin/users/${user.id}/role`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ role: select.value }),
            });
            await renderUsers();
            showMessage(message, `Updated role for ${user.displayName}.`, 'success');
          } catch (error) {
            showMessage(message, error.message, 'error');
            save.disabled = false;
          }
        });
        actionCell.append(save);
        return row;
      }));
      if (users.length === 0) {
        showMessage(message, 'No accounts match your search.');
      } else {
        hideMessage(message);
      }
    } catch (error) {
      showMessage(message, error.message || 'Accounts could not be loaded.', 'error');
    }
  }

  filterForm.addEventListener('submit', (event) => {
    event.preventDefault();
    renderUsers();
  });
  await renderUsers();
}

loadAdminUsers().catch((error) => {
  window.CampusConnectAdmin.showMessage(
    document.querySelector('#admin-message'),
    error.message || 'Admin user tools could not be loaded.',
    'error',
  );
});
