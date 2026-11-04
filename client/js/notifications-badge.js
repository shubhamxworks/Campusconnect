async function updateNotificationsBadge() {
  const link = document.querySelector('.site-nav a[href="/notifications.html"]');
  if (!link) return;

  try {
    const response = await fetch('/api/notifications');
    if (response.status === 401) return;
    if (!response.ok) {
      throw new Error(`Could not load notification count (${response.status}).`);
    }

    const { unreadCount } = await response.json();
    if (!Number.isInteger(unreadCount) || unreadCount <= 0) return;

    const badge = document.createElement('span');
    badge.className = 'notification-count-badge';
    badge.textContent = unreadCount > 99 ? '99+' : String(unreadCount);
    badge.setAttribute('aria-label', `${unreadCount} unread`);
    link.append(' ', badge);
    link.setAttribute(
      'aria-label',
      unreadCount === 1 ? 'Notifications, 1 unread' : `Notifications, ${unreadCount} unread`,
    );
  } catch (error) {
    console.error('Notification badge could not be updated:', error);
  }
}

updateNotificationsBadge();
