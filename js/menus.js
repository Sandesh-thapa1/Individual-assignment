import {$, on, element} from './utils.js';
import {api} from './api.js';

let restaurantId;
let controller;

function splitPrices(value) {
  const raw = String(value || '').trim();
  const prices = {student: '—', staff: '—', visitor: '—'};

  if (!raw) return {prices, raw: ''};

  for (const part of raw.split('/')) {
    let category;

    if (/student|opiskelija/i.test(part)) category = 'student';
    else if (/staff|henkilökunta/i.test(part)) category = 'staff';
    else if (/visitor|guest|vierailija/i.test(part)) category = 'visitor';

    const amount = part.match(/\d+(?:[.,]\d+)?\s*€/);

    if (!category || !amount || prices[category] !== '—') {
      return {prices: null, raw};
    }

    prices[category] = amount[0].replace(/\s*€$/, ' €');
  }

  return {prices, raw: ''};
}

function renderCourses(container, courses) {
  container.replaceChildren();

  if (!Array.isArray(courses) || !courses.length) {
    container.append(element('p', 'No menu available for this day.'));
    return;
  }

  const prices = courses.map((course) => splitPrices(course.price));

  const categories = prices.some(
    (p) => p.prices && Object.values(p.prices).some((value) => value !== '—')
  );

  const otherPrices = prices.some((p) => p.raw) || !categories;
  const wrapper = element('div', undefined, 'menu-table-wrapper');
  const table = element('table', undefined, 'menu-table');
  const head = element('thead');
  const heading = element('tr');
  const body = element('tbody');
  const labels = ['Dish'];

  if (categories) labels.push('Student', 'Staff', 'Visitor');
  if (otherPrices) labels.push('Price');

  labels.forEach((label) => {
    const cell = element('th', label);
    cell.scope = 'col';
    heading.append(cell);
  });

  head.append(heading);

  courses.forEach((course, index) => {
    const row = element('tr');
    const dish = element('td', undefined, 'dish');
    const price = prices[index];

    dish.append(
      element('strong', course.name || 'Unnamed dish'),
      element('p', course.diets || '', 'diets')
    );

    row.append(dish);

    const values = categories
      ? ['student', 'staff', 'visitor'].map((key) => price.prices?.[key] || '—')
      : [];

    values.forEach((value) => {
      const cell = element('td', value, 'amount');
      cell.style.whiteSpace = 'nowrap';
      row.append(cell);
    });

    if (otherPrices) {
      const cell = element('td', price.raw || '—', 'raw-price');
      cell.style.whiteSpace = 'nowrap';
      row.append(cell);
    }

    body.append(row);
  });

  table.append(head, body);
  wrapper.append(table);
  container.append(wrapper);
}

function calendarParts(value) {
  const text = String(value || '').trim();

  if (/^\d{4}-\d{2}-\d{2}(?:$|T)/.test(text)) {
    const date = new Date(`${text.slice(0, 10)}T12:00:00Z`);

    if (!Number.isNaN(date.getTime())) {
      return [
        date.toLocaleDateString('en-GB', {
          weekday: 'short',
          timeZone: 'UTC',
        }),
        date.toLocaleDateString('en-GB', {
          day: 'numeric',
          month: 'short',
          timeZone: 'UTC',
        }),
      ].map((part) => part.toUpperCase());
    }
  }

  const written = text.match(
    /^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\s+(\d{1,2})\s+([A-Za-z]+)/i
  );

  return written
    ? [
        written[1].slice(0, 3).toUpperCase(),
        `${Number(written[2])} ${written[3].slice(0, 3).toUpperCase()}`,
      ]
    : [text || 'Date unavailable', ''];
}

function renderWeek(days) {
  console.table(
    days?.map((day, index) => ({
      menu: index + 1,
      date: day.date,
    }))
  );
  const calendar = $('week-calendar');
  const content = $('weekly-content');

  calendar.replaceChildren();
  content.replaceChildren();

  if (!Array.isArray(days) || !days.length) {
    content.append(element('p', 'No weekly menu available.'));
    return;
  }

  const labels = days.map((day) => calendarParts(day.date));
  const keys = labels.map((parts) => parts.join(' '));

  const uncertain = keys.map(
    (key, i) =>
      !days[i].date || keys.filter((other) => other === key).length > 1
  );

  function showDay(index) {
    calendar.querySelectorAll('button').forEach((button, i) => {
      button.setAttribute('aria-pressed', String(i === index));
    });

    renderCourses(content, days[index].courses);

    content.prepend(
      element(
        'h4',
        uncertain[index]
          ? `Menu ${index + 1} — date unconfirmed`
          : days[index].date
      )
    );
  }

  days.forEach((day, index) => {
    const button = element('button');
    button.type = 'button';

    button.append(
      element(
        'strong',
        uncertain[index] ? `Menu ${index + 1}` : labels[index][0]
      ),
      element('span', uncertain[index] ? 'Date unconfirmed' : labels[index][1])
    );

    button.addEventListener('click', () => showDay(index));
    calendar.append(button);
  });

  const today = new Date()
    .toLocaleDateString('en-GB', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      timeZone: 'Europe/Helsinki',
    })
    .replace(',', '')
    .toUpperCase();

  const index = keys.findIndex((key, i) => !uncertain[i] && key === today);

  showDay(index < 0 ? 0 : index);
}

export async function loadMenus(id = restaurantId) {
  restaurantId = id;
  if (!id) return;

  controller?.abort();
  controller = new AbortController();

  const signal = controller.signal;
  const language = encodeURIComponent($('language').value);

  $('today-label').textContent = new Date().toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'Europe/Helsinki',
  });

  $('week-calendar').replaceChildren();

  await Promise.all(
    ['daily', 'weekly'].map(async (type) => {
      const container = $(`${type}-content`);
      container.replaceChildren(element('p', 'Loading menu...'));

      try {
        const data = await api(
          `/restaurants/${type}/${encodeURIComponent(id)}/${language}`,
          {signal}
        );

        if (signal.aborted) return;

        if (type === 'daily') {
          renderCourses(container, data.courses);
        } else {
          renderWeek(data.days);
        }
      } catch {
        if (signal.aborted) return;

        const retry = element('button', 'Retry menu');
        retry.type = 'button';
        retry.addEventListener('click', () => loadMenus());

        container.replaceChildren(element('p', 'Could not load menu.'), retry);
      }
    })
  );
}

export function initMenus() {
  on('language', 'change', () => loadMenus());

  ['daily', 'weekly'].forEach((type) => {
    on(`${type}-button`, 'click', () => {
      ['daily', 'weekly'].forEach((panel) => {
        $(`${panel}-panel`).hidden = panel !== type;
        $(`${panel}-button`).setAttribute(
          'aria-pressed',
          String(panel === type)
        );
      });
    });
  });
}
