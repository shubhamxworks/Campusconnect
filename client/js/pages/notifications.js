const notificationList = document.querySelector('#notification-list');
const message = document.querySelector('#notifications-message');
const unreadCount = document.querySelector('#unread-count');
const markAllButton = document.querySelector('#mark-all-read');
const pushToggle = document.querySelector('#push-toggle');
const pushHelp = document.querySelector('#push-help');
let pushConfig;

function showMessage(text, kind = '') {
  message.hidden = false;
  message.className = `notification-message${kind ? ` is-${kind}` : ''}`;
  message.textContent = text;
}

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

function formatCreatedAt(value) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function decodeApplicationServerKey(value) {
  const padded = value + '='.repeat((4 - (value.length % 4)) % 4);
  const decoded = atob(padded.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
}

async function updatePushButton() {
  if (
    !pushConfig?.enabled
    || !('serviceWorker' in navigator)
    || !('PushManager' in window)
    || !('Notification' in window)
  ) {
    pushToggle.disabled = true;
    pushHelp.hidden = false;
    pushHelp.textContent = pushConfig?.enabled
      ? 'This browser does not support push notifications.'
      : 'Browser push is not configured on this server. In-app notifications are still available.';
    return;
  }
  pushHelp.hidden = true;
  const registration = await navigator.serviceWorker.register('/service-worker.js');
  const subscription = await registration.pushManager.getSubscription();
  pushToggle.textContent = subscription ? 'Turn off browser notifications' : 'Enable browser notifications';
  pushToggle.disabled = false;
}

async function togglePush() {
  pushToggle.disabled = true;
  try {
    if (!pushConfig?.enabled) {
      showMessage('Browser push is not configured on this server. In-app notifications remain available.');
      return;
    }
    const registration = await navigator.serviceWorker.register('/service-worker.js');
    let subscription = await registration.pushManager.getSubscription();
    if (subscription) {
      await requestJson('/api/notifications/push-subscription', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: subscription.endpoint }),
      });
      await subscription.unsubscribe();
      showMessage('Browser notifications are turned off.', 'success');
    } else {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        showMessage('Allow notifications in your browser settings to receive event updates.', 'error');
        return;
      }
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: decodeApplicationServerKey(pushConfig.publicKey),
      });
      await requestJson('/api/notifications/push-subscription', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(subscription),
      });
      showMessage('Browser notifications are enabled for event updates.', 'success');
    }
    await updatePushButton();
  } catch (error) {
    showMessage(error.message || 'Browser notification settings could not be updated.', 'error');
  } finally {
    pushToggle.disabled = false;
  }
}

function renderNotification(notification) {
  const card = document.createElement('article');
  card.className = `notification-card${notification.readAt ? ' is-read' : ' is-unread'}`;
  const content = document.createElement('div');
  const title = document.createElement('h2');
  title.textContent = notification.title;
  const body = document.createElement('p');
  body.textContent = notification.message;
  const date = document.createElement('time');
  date.dateTime = notification.createdAt;
  date.textContent = formatCreatedAt(notification.createdAt);
  content.append(title, body, date);
  card.append(content);

  const actions = document.createElement('div');
  actions.className = 'notification-actions';
  if (notification.eventId) {
    const eventLink = document.createElement('a');
    const isResultsNotification = notification.type === 'results_published';
    eventLink.href = isResultsNotification
      ? `/leaderboard.html?event=${encodeURIComponent(notification.eventId)}`
      : `/event-details.html?id=${encodeURIComponent(notification.eventId)}`;
    eventLink.textContent = isResultsNotification ? 'View leaderboard' : 'View event';
    actions.append(eventLink);
  }
  if (!notification.readAt) {
    const markRead = document.createElement('button');
    markRead.type = 'button';
    markRead.textContent = 'Mark as read';
    markRead.setAttribute('aria-label', `Mark ${notification.title} as read`);
    markRead.addEventListener('click', async () => {
      markRead.disabled = true;
      try {
        await requestJson(`/api/notifications/${notification.id}/read`, { method: 'PATCH' });
        await loadNotifications();
      } catch (error) {
        showMessage(error.message, 'error');
        markRead.disabled = false;
      }
    });
    actions.append(markRead);
  }
  if (actions.childElementCount > 0) card.append(actions);
  return card;
}

async function loadNotifications() {
  const { notifications, unreadCount: unread } = await requestJson('/api/notifications');
  unreadCount.textContent = unread === 1 ? '1 unread notification' : `${unread} unread notifications`;
  markAllButton.disabled = unread === 0;
  notificationList.replaceChildren(...notifications.map(renderNotification));
  if (notifications.length === 0) {
    showMessage('You are all caught up. New registration and waitlist updates will appear here.');
  } else {
    message.hidden = true;
  }
}

async function initialize() {
  document.querySelectorAll('[data-current-year]').forEach((element) => {
    element.textContent = String(new Date().getFullYear());
  });
  markAllButton.addEventListener('click', async () => {
    markAllButton.disabled = true;
    try {
      await requestJson('/api/notifications/read-all', { method: 'PATCH' });
      await loadNotifications();
      showMessage('All notifications have been marked as read.', 'success');
    } catch (error) {
      showMessage(error.message, 'error');
      markAllButton.disabled = false;
    }
  });
  pushToggle.addEventListener('click', togglePush);

  try {
    const { user } = await requestJson('/api/auth/me');
    if (!user) {
      window.location.replace(`/login.html?next=${encodeURIComponent('/notifications.html')}`);
      return;
    }
    pushConfig = await requestJson('/api/notifications/push-config');
    await updatePushButton();
    await loadNotifications();
  } catch (error) {
    showMessage(error.message || 'Notifications could not be loaded.', 'error');
  }
}

initialize();
