'use strict';

const API = 'https://media2.edu.metropolia.fi/restaurant/api/v1';
const UPLOADS = 'https://media2.edu.metropolia.fi/restaurant/uploads/';
const $ = (id) => document.getElementById(id);

let restaurants = [];
let selectedRestaurant = null;
let nearestId = '';
let menuController = null;
let user = null;
let token = sessionStorage.getItem('restaurantToken') || '';

// Create HTML elements safely.
function element(tag, text, className) {
  const item = document.createElement(tag);

  if (text !== undefined) item.textContent = text;
  if (className) item.className = className;

  return item;
}

// Shared API request function.
async function api(path, options = {}) {
  const {auth = false, ...settings} = options;
  const headers = new Headers(settings.headers);

  if (auth) {
    if (!token) throw new Error('Please log in first.');
    headers.set('Authorization', `Bearer ${token}`);
  }

  if (typeof settings.body === 'string') {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(`${API}${path}`, {
    ...settings,
    headers,
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    if (auth && [401, 403].includes(response.status)) {
      logout();
    }

    throw new Error(
      data?.message || data?.error || `Server error ${response.status}`
    );
  }

  if (data === null) {
    throw new Error('The server returned an unreadable response.');
  }

  return data;
}

// Restaurants and filters

function favouriteId() {
  const favourite = user?.favouriteRestaurant;

  return typeof favourite === 'object' ? favourite?._id : favourite;
}

function fillFilter(id, field, label) {
  $(id).replaceChildren(new Option(label, ''));

  const values = [
    ...new Set(
      restaurants.map((restaurant) => restaurant[field]).filter(Boolean)
    ),
  ].sort((a, b) => a.localeCompare(b));

  values.forEach((value) => {
    $(id).add(new Option(value, value));
  });
}

function renderRestaurants() {
  const search = $('search').value.trim().toLowerCase();

  const filtered = restaurants.filter(
    (restaurant) =>
      restaurant.name.toLowerCase().includes(search) &&
      (!$('city').value || restaurant.city === $('city').value) &&
      (!$('provider').value || restaurant.company === $('provider').value) &&
      (!$('favourite-only').checked || restaurant._id === favouriteId())
  );

  $('count').textContent = filtered.length;
  $('restaurant-list').replaceChildren();

  filtered.forEach((restaurant) => {
    const card = element('button', undefined, 'restaurant-card');
    card.type = 'button';

    card.setAttribute(
      'aria-pressed',
      String(restaurant._id === selectedRestaurant?._id)
    );

    card.classList.toggle('nearest', restaurant._id === nearestId);

    card.append(
      element('strong', restaurant.name),
      element(
        'small',
        [restaurant.address, restaurant.city].filter(Boolean).join(', ')
      ),
      element('small', restaurant.company || 'Provider unavailable')
    );

    if (restaurant._id === favouriteId()) {
      card.append(element('small', '♥ Your favourite'));
    }

    if (restaurant._id === nearestId) {
      card.append(element('small', 'Nearest restaurant'));
    }

    if (Number.isFinite(restaurant.distance)) {
      card.append(
        element('small', `${restaurant.distance.toFixed(1)} km away`)
      );
    }

    card.addEventListener('click', () => {
      selectRestaurant(restaurant);
    });

    $('restaurant-list').append(card);
  });

  if (!filtered.length) {
    $('restaurant-list').append(
      element('p', 'No matching restaurants. Try different filters.')
    );
  }

  window.restaurantMap.update(
    filtered,
    selectedRestaurant?._id,
    nearestId,
    selectRestaurant
  );
}

function renderFavouriteButton() {
  const saved = selectedRestaurant && selectedRestaurant._id === favouriteId();

  $('favourite-button').textContent = saved
    ? '♥ Saved Favourite'
    : '♡ Save as Favourite';

  $('favourite-button').disabled = !selectedRestaurant;
}

function selectRestaurant(restaurant) {
  selectedRestaurant = restaurant;

  $('restaurant-name').textContent = restaurant.name;
  $('restaurant-company').textContent = restaurant.company || '';
  $('restaurant-info').replaceChildren();

  const details = [
    ['Address', restaurant.address],
    ['City', restaurant.city],
    ['Phone', restaurant.phone],
  ];

  details.forEach(([label, value]) => {
    const paragraph = element('p');

    paragraph.append(
      element('strong', `${label}: `),
      document.createTextNode(value || 'Not provided')
    );

    $('restaurant-info').append(paragraph);
  });

  renderFavouriteButton();
  renderRestaurants();
  window.restaurantMap.focus(restaurant);
  loadMenus();
}

async function loadRestaurants() {
  $('status').textContent = 'Loading restaurants...';
  $('retry-button').hidden = true;
  $('nearest-button').disabled = true;

  try {
    const data = await api('/restaurants');
    const list = Array.isArray(data) ? data : data.restaurants;

    if (!Array.isArray(list)) {
      throw new Error('Unexpected restaurant response.');
    }

    restaurants = list
      .filter((restaurant) => restaurant._id && restaurant.name)
      .sort((a, b) => a.name.localeCompare(b.name));

    fillFilter('city', 'city', 'All Cities');
    fillFilter('provider', 'company', 'All Providers');

    renderRestaurants();

    $('status').textContent = `${restaurants.length} restaurants loaded.`;
    $('nearest-button').disabled = !restaurants.length;

    if (restaurants.length) {
      selectRestaurant(restaurants[0]);
    }
  } catch (error) {
    $('status').textContent = `Could not load restaurants. ${error.message}`;
    $('retry-button').hidden = false;
  }
}

// Prices and menu tables

function splitPrices(value) {
  const text = String(value || '').trim();
  const prices = {
    student: '—',
    staff: '—',
    visitor: '—',
  };

  if (!text) return {prices, raw: ''};

  const parts = text.split('/');

  for (const part of parts) {
    const amount = part.match(/\d+(?:[.,]\d+)?\s*€/);
    let category = '';

    if (/\bstudent\b/i.test(part)) {
      category = 'student';
    } else if (/\bstaff\b/i.test(part)) {
      category = 'staff';
    } else if (/\b(visitor|guest)\b/i.test(part)) {
      category = 'visitor';
    }

    // Keep unfamiliar price formats unchanged.
    if (!category || !amount || prices[category] !== '—') {
      return {prices: null, raw: text};
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

  const parsed = courses.map((course) => splitPrices(course.price));

  const hasCategories = parsed.some(
    (item) =>
      item.prices && Object.values(item.prices).some((price) => price !== '—')
  );

  const hasOtherPrices = parsed.some((item) => item.raw);
  const wrapper = element('div', undefined, 'menu-table-wrapper');
  const table = element('table', undefined, 'menu-table');
  const head = element('thead');
  const heading = element('tr');
  const body = element('tbody');

  const labels = ['Dish'];

  if (hasCategories) {
    labels.push('Student', 'Staff', 'Visitor');
  }

  if (hasOtherPrices || !hasCategories) {
    labels.push('Price');
  }

  labels.forEach((label) => {
    const cell = element('th', label);
    cell.scope = 'col';
    heading.append(cell);
  });

  head.append(heading);

  courses.forEach((course, index) => {
    const row = element('tr');
    const dish = element('td', undefined, 'dish');
    const price = parsed[index];

    dish.append(
      element('strong', course.name || 'Unnamed dish'),
      element('p', course.diets || '', 'diets')
    );

    row.append(dish);

    if (hasCategories) {
      ['student', 'staff', 'visitor'].forEach((category) => {
        row.append(element('td', price.prices?.[category] || '—', 'amount'));
      });
    }

    if (hasOtherPrices || !hasCategories) {
      row.append(element('td', price.raw || '—', 'raw-price'));
    }

    body.append(row);
  });

  table.append(head, body);
  wrapper.append(table);
  container.append(wrapper);
}

// Weekly calendar

function finlandToday() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Helsinki',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());

  const part = (name) => parts.find((item) => item.type === name).value;

  return `${part('year')}-${part('month')}-${part('day')}`;
}

function calendarParts(value) {
  const text = String(value || 'Date unavailable').trim();

  // Example: Monday 28 September
  const writtenDate = text.match(
    /^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\s+(\d{1,2})\s+([A-Za-z]+)/i
  );

  if (writtenDate) {
    return [
      writtenDate[1].slice(0, 3).toUpperCase(),
      `${Number(writtenDate[2])} ${writtenDate[3].slice(0, 3).toUpperCase()}`,
    ];
  }

  // Example: 2026-09-28
  if (/^\d{4}-\d{2}-\d{2}(?:$|T)/.test(text)) {
    const date = new Date(`${text.slice(0, 10)}T12:00:00`);

    if (!Number.isNaN(date.getTime())) {
      return [
        date
          .toLocaleDateString('en-GB', {
            weekday: 'short',
          })
          .toUpperCase(),

        date
          .toLocaleDateString('en-GB', {
            day: 'numeric',
            month: 'short',
          })
          .toUpperCase(),
      ];
    }
  }

  return [text, ''];
}

function renderWeek(days) {
  const calendar = $('week-calendar');
  const content = $('weekly-content');

  calendar.replaceChildren();
  content.replaceChildren();

  if (!Array.isArray(days) || days.length === 0) {
    content.append(element('p', 'No weekly menu available.'));
    return;
  }

  function showDay(index) {
    const selectedDay = days[index];

    calendar.querySelectorAll('button').forEach((button, i) => {
      button.setAttribute('aria-pressed', String(i === index));
    });

    // Use the date and meals from the same selected day.
    renderCourses(content, selectedDay.courses);

    content.prepend(element('h4', selectedDay.date || 'Date unavailable'));
  }

  days.forEach((day, index) => {
    const button = element('button');
    const [weekday, date] = calendarParts(day.date);

    button.type = 'button';
    button.setAttribute('aria-pressed', 'false');
    button.setAttribute(
      'aria-label',
      `Show menu for ${day.date || 'day ' + (index + 1)}`
    );

    button.append(element('strong', weekday));

    if (date) {
      button.append(element('span', date));
    }

    button.addEventListener('click', () => showDay(index));
    calendar.append(button);
  });

  const todayISO = finlandToday();
  const todayLabel = calendarParts(todayISO).join(' ');

  const todayIndex = days.findIndex((day) => {
    const date = String(day.date || '').trim();

    if (/^\d{4}-\d{2}-\d{2}/.test(date)) {
      return date.slice(0, 10) === todayISO;
    }

    return calendarParts(date).join(' ') === todayLabel;
  });

  showDay(todayIndex >= 0 ? todayIndex : 0);
}

async function loadMenus() {
  if (!selectedRestaurant) return;

  menuController?.abort();
  menuController = new AbortController();

  const signal = menuController.signal;
  const id = encodeURIComponent(selectedRestaurant._id);
  const language = $('language').value;

  $('today-label').textContent = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Helsinki',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(new Date());

  $('week-calendar').replaceChildren();

  async function load(type) {
    const container = $(`${type}-content`);
    container.replaceChildren(element('p', 'Loading menu...'));

    try {
      const data = await api(`/restaurants/${type}/${id}/${language}`, {
        signal,
      });

      if (signal.aborted) return;

      if (type === 'daily') {
        renderCourses(container, data.courses);
      } else {
        renderWeek(data.days);
      }
    } catch (error) {
      if (signal.aborted) return;

      container.replaceChildren(
        element('p', `Could not load menu. ${error.message}`)
      );

      const retry = element('button', 'Retry menu');
      retry.type = 'button';
      retry.addEventListener('click', loadMenus);
      container.append(retry);
    }
  }

  await Promise.all([load('daily'), load('weekly')]);
}

// Account display

function showAvatar(id, value) {
  const image = $(id);
  image.hidden = true;
  image.removeAttribute('src');

  if (!value) return;

  try {
    const url = new URL(value, UPLOADS);

    if (url.origin !== new URL(API).origin) return;

    image.onload = () => {
      image.hidden = false;
    };

    image.onerror = () => {
      image.hidden = true;
    };

    image.src = url.href;
  } catch {
    image.hidden = true;
  }
}

function renderAccount() {
  $('login-button').hidden = Boolean(user);
  $('register-button').hidden = Boolean(user);
  $('profile-button').hidden = !user;
  $('logout-button').hidden = !user;
  $('account-name').textContent = user?.username || '';

  showAvatar('header-avatar', user?.avatar);
  showAvatar('profile-avatar', user?.avatar);

  if (!user) {
    $('favourite-only').checked = false;
  }

  renderFavouriteButton();
  renderRestaurants();
}

function logout() {
  token = '';
  user = null;
  sessionStorage.removeItem('restaurantToken');
  renderAccount();
}

async function refreshUser() {
  const data = await api('/users/token', {auth: true});
  const currentUser = data.data || data;

  if (!currentUser?._id) {
    throw new Error('Could not read your account.');
  }

  user = currentUser;
  renderAccount();
}

function openAccount(mode) {
  $('account-status').textContent = '';
  $('activation-link').hidden = true;

  $('login-form').hidden = mode !== 'login';
  $('register-form').hidden = mode !== 'register';
  $('profile-section').hidden = mode !== 'profile';

  $('dialog-title').textContent = {
    login: 'Login',
    register: 'Register',
    profile: 'Your Profile',
  }[mode];

  if (mode === 'profile' && user) {
    const form = $('profile-form');

    form.elements.username.value = user.username || '';
    form.elements.email.value = user.email || '';
    form.elements.password.value = '';
  }

  if (!$('account-dialog').open) {
    $('account-dialog').showModal();
  }
}

async function submitAccount(form, action) {
  const button = form.querySelector('button[type="submit"]');

  button.disabled = true;
  $('account-status').textContent = 'Please wait...';

  try {
    await action();
  } catch (error) {
    $('account-status').textContent = error.message;
  } finally {
    button.disabled = false;
  }
}

async function signIn(username, password) {
  const data = await api('/auth/login', {
    method: 'POST',
    body: JSON.stringify({username, password}),
  });

  if (!data.token) {
    throw new Error(data.message || 'Login failed.');
  }

  token = data.token;
  sessionStorage.setItem('restaurantToken', token);

  try {
    await refreshUser();
  } catch (error) {
    logout();
    throw error;
  }
}

function showActivationLink(value) {
  if (!value) return;

  try {
    const url = new URL(value, API);

    if (url.protocol === 'https:') {
      $('activation-link').href = url.href;
      $('activation-link').hidden = false;
    }
  } catch {
    $('activation-link').hidden = true;
  }
}

// Login and registration

$('login-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const form = event.currentTarget;

  submitAccount(form, async () => {
    await signIn(
      form.elements.username.value.trim(),
      form.elements.password.value
    );

    form.reset();
    $('account-dialog').close();
    $('status').textContent = `Welcome, ${user.username}.`;
  });
});

$('register-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const form = event.currentTarget;

  submitAccount(form, async () => {
    const username = form.elements.username.value.trim();
    const password = form.elements.password.value;

    $('activation-link').hidden = true;

    const result = await api('/users', {
      method: 'POST',
      body: JSON.stringify({
        username,
        password,
        email: form.elements.email.value.trim(),
      }),
    });

    if (!result.data?._id) {
      throw new Error(result.message || 'Registration failed.');
    }

    form.reset();

    // Follow activation requirements returned by the server.
    if (result.data.activated === false) {
      openAccount('login');
      $('login-form').elements.username.value = username;

      $('account-status').textContent =
        'Account created. Complete activation, then log in.';

      showActivationLink(result.activationUrl);
      return;
    }

    try {
      await signIn(username, password);
      $('account-dialog').close();

      $('status').textContent =
        `Welcome, ${user.username}! Your account is ready.`;
    } catch (error) {
      openAccount('login');
      $('login-form').elements.username.value = username;

      $('account-status').textContent =
        `Account created, but automatic login could not finish. ${error.message}`;

      showActivationLink(result.activationUrl);
    }
  });
});

$('check-username').addEventListener('click', async () => {
  const username = $('register-form').elements.username.value.trim();

  if (!username) {
    $('account-status').textContent = 'Enter a username first.';
    return;
  }

  try {
    const data = await api(`/users/available/${encodeURIComponent(username)}`);

    $('account-status').textContent = data.available
      ? 'This username is available.'
      : 'This username is already taken.';
  } catch (error) {
    $('account-status').textContent = error.message;
  }
});

// Profile editing

$('profile-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const form = event.currentTarget;

  submitAccount(form, async () => {
    const updates = {
      username: form.elements.username.value.trim(),
      email: form.elements.email.value.trim(),
    };

    if (form.elements.password.value) {
      updates.password = form.elements.password.value;
    }

    await api('/users', {
      method: 'PUT',
      auth: true,
      body: JSON.stringify(updates),
    });

    form.elements.password.value = '';

    try {
      await refreshUser();
      $('account-status').textContent = 'Profile updated.';
    } catch {
      $('account-status').textContent =
        'The update was sent, but your profile could not be reloaded. Try logging in again.';
    }
  });
});

// Profile picture upload

$('avatar-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const form = event.currentTarget;

  submitAccount(form, async () => {
    const file = form.elements.avatar.files[0];

    if (!file || !file.type.startsWith('image/')) {
      throw new Error('Choose an image file.');
    }

    if (file.size > 5 * 1024 * 1024) {
      throw new Error('Choose an image smaller than 5 MB.');
    }

    const body = new FormData();
    body.append('avatar', file);

    const data = await api('/users/avatar', {
      method: 'POST',
      auth: true,
      body,
    });

    if (data.data?.avatar && user) {
      user.avatar = data.data.avatar;
      renderAccount();
    } else {
      await refreshUser();
    }

    form.reset();
    $('account-status').textContent = 'Profile picture updated.';
  });
});

// Favourite restaurant

$('favourite-button').addEventListener('click', async () => {
  if (!user) {
    openAccount('login');
    $('account-status').textContent = 'Log in to save your favourite.';
    return;
  }

  if (!selectedRestaurant) return;

  if (selectedRestaurant._id === favouriteId()) {
    $('status').textContent = 'This is already your favourite restaurant.';
    return;
  }

  const restaurant = selectedRestaurant;
  $('favourite-button').disabled = true;

  try {
    await api('/users', {
      method: 'PUT',
      auth: true,
      body: JSON.stringify({
        favouriteRestaurant: restaurant._id,
      }),
    });

    if (user) {
      user.favouriteRestaurant = restaurant._id;
      renderAccount();
    }

    $('status').textContent = `${restaurant.name} saved as your favourite.`;
  } catch (error) {
    $('status').textContent = error.message;
  } finally {
    renderFavouriteButton();
  }
});

// Nearest restaurant

function distanceKm(coordinates, position) {
  const radians = (value) => (value * Math.PI) / 180;

  const latitudeDifference = radians(coordinates[1] - position.latitude);

  const longitudeDifference = radians(coordinates[0] - position.longitude);

  const value =
    Math.sin(latitudeDifference / 2) ** 2 +
    Math.cos(radians(position.latitude)) *
      Math.cos(radians(coordinates[1])) *
      Math.sin(longitudeDifference / 2) ** 2;

  return 6371 * 2 * Math.asin(Math.sqrt(Math.min(1, value)));
}

$('nearest-button').addEventListener('click', () => {
  if (!navigator.geolocation) {
    $('status').textContent = 'Your browser does not support location access.';
    return;
  }

  $('nearest-button').disabled = true;
  $('status').textContent = 'Finding your location...';

  navigator.geolocation.getCurrentPosition(
    (position) => {
      restaurants.forEach((restaurant) => {
        const coordinates = restaurant.location?.coordinates;

        restaurant.distance = window.restaurantMap.validCoordinates(coordinates)
          ? distanceKm(coordinates, position.coords)
          : Infinity;
      });

      restaurants.sort((a, b) => a.distance - b.distance);

      const nearest = restaurants.find((restaurant) =>
        Number.isFinite(restaurant.distance)
      );

      if (nearest) {
        nearestId = nearest._id;

        $('search').value = '';
        $('city').value = '';
        $('provider').value = '';
        $('favourite-only').checked = false;

        selectRestaurant(nearest);

        $('status').textContent =
          `Nearest: ${nearest.name}, ${nearest.distance.toFixed(1)} km away. ` +
          'This is a straight-line distance.';
      } else {
        $('status').textContent = 'No restaurant coordinates available.';
      }

      $('nearest-button').disabled = false;
    },
    (error) => {
      $('status').textContent =
        `Could not get your location. ${error.message} ` +
        'Allow location access and use HTTPS or localhost.';

      $('nearest-button').disabled = false;
    },
    {
      timeout: 10000,
      maximumAge: 60000,
    }
  );
});

// Filters

['search', 'city', 'provider'].forEach((id) => {
  $(id).addEventListener(
    id === 'search' ? 'input' : 'change',
    renderRestaurants
  );
});

$('favourite-only').addEventListener('change', () => {
  if ($('favourite-only').checked && !user) {
    $('favourite-only').checked = false;

    openAccount('login');
    $('account-status').textContent = 'Log in to view your favourite.';
    return;
  }

  renderRestaurants();
});

// Switch between daily and weekly panels.

['daily', 'weekly'].forEach((type) => {
  $(`${type}-button`).addEventListener('click', () => {
    const showDaily = type === 'daily';

    $('daily-panel').hidden = !showDaily;
    $('weekly-panel').hidden = showDaily;

    $('daily-button').setAttribute('aria-pressed', String(showDaily));

    $('weekly-button').setAttribute('aria-pressed', String(!showDaily));
  });
});

// Other page controls

$('language').addEventListener('change', loadMenus);
$('retry-button').addEventListener('click', loadRestaurants);

$('login-button').addEventListener('click', () => {
  openAccount('login');
});

$('register-button').addEventListener('click', () => {
  openAccount('register');
});

$('profile-button').addEventListener('click', () => {
  openAccount('profile');
});

$('logout-button').addEventListener('click', () => {
  logout();
  $('status').textContent = 'You are logged out.';
});

$('close-dialog').addEventListener('click', () => {
  $('account-dialog').close();
});

$('account-dialog').addEventListener('close', () => {
  $('login-form').elements.password.value = '';
  $('register-form').elements.password.value = '';
  $('profile-form').elements.password.value = '';
});

// Start the app.

async function initialise() {
  renderAccount();
  await loadRestaurants();

  if (token) {
    try {
      await refreshUser();
    } catch {
      logout();

      $('status').textContent =
        'Your previous login could not be restored. Please log in again.';
    }
  }
}

initialise();
