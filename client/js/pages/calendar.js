const monthHeading = document.querySelector('#calendar-month');
const calendarDays = document.querySelector('#calendar-days');
const calendarMessage = document.querySelector('#calendar-message');
const selectedDayHeading = document.querySelector('#selected-day-heading');
const dayEventList = document.querySelector('#day-event-list');
const previousMonthButton = document.querySelector('#previous-month');
const nextMonthButton = document.querySelector('#next-month');

const monthFormatter = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' });
const dateFormatter = new Intl.DateTimeFormat(undefined, {
  weekday: 'long',
  month: 'long',
  day: 'numeric',
  year: 'numeric',
});
const timeFormatter = new Intl.DateTimeFormat(undefined, {
  hour: 'numeric',
  minute: '2-digit',
  timeZoneName: 'short',
});
const eventTimeFormatter = new Intl.DateTimeFormat(undefined, {
  hour: 'numeric',
  minute: '2-digit',
});

const today = new Date();
let displayedMonth = new Date(today.getFullYear(), today.getMonth(), 1);
let selectedDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());
let events = [];

function dateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function parseLocalDateKey(key) {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function eventDays(event) {
  const start = new Date(event.startsAt);
  const end = new Date(event.endsAt);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) {
    return [];
  }

  const finalDay = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  if (
    end.getHours() === 0 &&
    end.getMinutes() === 0 &&
    end.getSeconds() === 0 &&
    end.getMilliseconds() === 0
  ) {
    finalDay.setDate(finalDay.getDate() - 1);
  }

  const days = [];
  const day = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  while (day <= finalDay) {
    days.push(dateKey(day));
    day.setDate(day.getDate() + 1);
  }
  return days;
}

function eventsByDay() {
  const grouped = new Map();
  for (const event of events) {
    for (const key of eventDays(event)) {
      if (!grouped.has(key)) {
        grouped.set(key, []);
      }
      grouped.get(key).push(event);
    }
  }

  for (const dayEvents of grouped.values()) {
    dayEvents.sort((first, second) => Date.parse(first.startsAt) - Date.parse(second.startsAt));
  }
  return grouped;
}

function renderCalendar() {
  monthHeading.textContent = monthFormatter.format(displayedMonth);
  selectedDayHeading.textContent = dateFormatter.format(selectedDate);

  const firstWeekday = new Date(displayedMonth.getFullYear(), displayedMonth.getMonth(), 1).getDay();
  const dayCount = new Date(displayedMonth.getFullYear(), displayedMonth.getMonth() + 1, 0).getDate();
  const groupedEvents = eventsByDay();
  const fragment = document.createDocumentFragment();
  const rowCount = Math.ceil((firstWeekday + dayCount) / 7);

  for (let week = 0; week < rowCount; week += 1) {
    const row = document.createElement('tr');
    for (let weekday = 0; weekday < 7; weekday += 1) {
      const cell = document.createElement('td');
      const dayNumber = week * 7 + weekday - firstWeekday + 1;
      if (dayNumber < 1 || dayNumber > dayCount) {
        cell.setAttribute('aria-hidden', 'true');
        row.append(cell);
        continue;
      }

      const date = new Date(displayedMonth.getFullYear(), displayedMonth.getMonth(), dayNumber);
      const key = dateKey(date);
      const dayEvents = groupedEvents.get(key) ?? [];
      const button = document.createElement('button');
      button.className = 'calendar-day';
      button.type = 'button';
      button.dataset.date = key;
      button.setAttribute('aria-pressed', String(key === dateKey(selectedDate)));
      button.setAttribute(
        'aria-label',
        `${dateFormatter.format(date)}${dayEvents.length ? `, ${dayEvents.length} ${dayEvents.length === 1 ? 'event' : 'events'}` : ', no events'}`,
      );
      if (key === dateKey(selectedDate)) {
        button.classList.add('is-selected');
      }
      if (key === dateKey(today)) {
        button.classList.add('is-today');
      }

      const number = document.createElement('span');
      number.className = 'day-number';
      number.textContent = String(dayNumber);
      button.append(number);

      if (dayEvents.length > 0) {
        const count = document.createElement('span');
        count.className = 'day-event-count';
        count.setAttribute('aria-hidden', 'true');
        count.textContent = `${dayEvents.length} ${dayEvents.length === 1 ? 'event' : 'events'}`;
        button.append(count);
      }

      cell.append(button);
      row.append(cell);
    }
    fragment.append(row);
  }

  calendarDays.replaceChildren(fragment);
  renderSelectedDay(groupedEvents.get(dateKey(selectedDate)) ?? []);
}

function createEventCard(event) {
  const article = document.createElement('article');
  article.className = 'day-event';

  const time = document.createElement('p');
  time.className = 'day-event-time';
  time.textContent = timeFormatter.format(new Date(event.startsAt));
  const endTime = document.createElement('span');
  endTime.textContent = `until ${timeFormatter.format(new Date(event.endsAt))}`;
  time.append(endTime);

  const details = document.createElement('div');
  details.className = 'day-event-details';
  const title = document.createElement('h3');
  title.textContent = event.title;
  const location = document.createElement('p');
  location.className = 'day-event-meta';
  location.textContent = `${event.venue} · ${event.format}`;
  details.append(title, location);

  const category = document.createElement('span');
  category.className = 'day-event-category';
  category.textContent = event.category;

  const link = document.createElement('a');
  link.className = 'day-event-link';
  link.href = `/event-details.html?id=${encodeURIComponent(event.id)}`;
  link.setAttribute('aria-label', `View details for ${event.title}`);
  link.append(article);
  article.append(time, details, category);
  return link;
}

function renderSelectedDay(dayEvents) {
  if (dayEvents.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'calendar-empty';
    empty.textContent = 'There are no events scheduled for this day. Choose another date to explore the calendar.';
    dayEventList.replaceChildren(empty);
    return;
  }

  dayEventList.replaceChildren(...dayEvents.map(createEventCard));
}

function changeMonth(offset) {
  const day = selectedDate.getDate();
  displayedMonth = new Date(displayedMonth.getFullYear(), displayedMonth.getMonth() + offset, 1);
  const lastDay = new Date(displayedMonth.getFullYear(), displayedMonth.getMonth() + 1, 0).getDate();
  selectedDate = new Date(displayedMonth.getFullYear(), displayedMonth.getMonth(), Math.min(day, lastDay));
  renderCalendar();
}

calendarDays.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-date]');
  if (!button) {
    return;
  }
  selectedDate = parseLocalDateKey(button.dataset.date);
  renderCalendar();
});

previousMonthButton.addEventListener('click', () => changeMonth(-1));
nextMonthButton.addEventListener('click', () => changeMonth(1));

document.querySelectorAll('[data-current-year]').forEach((element) => {
  element.textContent = String(new Date().getFullYear());
});

async function loadEvents() {
  dayEventList.setAttribute('aria-busy', 'true');
  calendarMessage.hidden = true;
  try {
    const response = await fetch('/api/events');
    if (!response.ok) {
      throw new Error(`Could not load events (${response.status}).`);
    }
    const result = await response.json();
    if (!Array.isArray(result.events)) {
      throw new Error('The event list could not be read.');
    }
    events = result.events;
    renderCalendar();
  } catch (error) {
    events = [];
    renderCalendar();
    calendarMessage.hidden = false;
    calendarMessage.textContent = error.message || 'Events could not be loaded. Please try again.';
  } finally {
    dayEventList.setAttribute('aria-busy', 'false');
  }
}

renderCalendar();
loadEvents();
