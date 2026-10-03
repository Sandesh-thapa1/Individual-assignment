import {$, on, element} from './utils.js';
import {api} from './api.js';
import {user, openAccount, saveFavourite} from './account.js';
import {loadMenus} from './menus.js';

let restaurants = [];
let selectedRestaurant = null;
let nearestId = '';

function favouriteId() {
  const favourite = user?.favouriteRestaurant;
  return typeof favourite === 'object' ? favourite?._id : favourite;
}

function fillFilter(id, field, label) {
  $(id).replaceChildren(new Option(label, ''));

  [...new Set(restaurants.map((r) => r[field]).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b))
    .forEach((value) => $(id).add(new Option(value, value)));
}

function renderRestaurants() {
  const search = $('search').value.trim().toLowerCase();

  const filtered = restaurants.filter(
    (r) =>
      r.name.toLowerCase().includes(search) &&
      (!$('city').value || r.city === $('city').value) &&
      (!$('provider').value || r.company === $('provider').value) &&
      (!$('favourite-only').checked || r._id === favouriteId())
  );

  $('count').textContent = filtered.length;
  $('restaurant-list').replaceChildren();

  filtered.forEach((r) => {
    const card = element('button', undefined, 'restaurant-card');
    card.type = 'button';

    card.setAttribute(
      'aria-pressed',
      String(r._id === selectedRestaurant?._id)
    );

    card.classList.toggle('nearest', r._id === nearestId);

    card.append(
      element('strong', r.name),
      element('small', [r.address, r.city].filter(Boolean).join(', ')),
      element('small', r.company || 'Provider unavailable')
    );

    if (r._id === favouriteId()) {
      card.append(element('small', '♥ Your favourite'));
    }

    if (r._id === nearestId) {
      card.append(element('small', 'Nearest restaurant'));
    }

    if (Number.isFinite(r.distance)) {
      card.append(element('small', `${r.distance.toFixed(1)} km away`));
    }

    card.addEventListener('click', () => selectRestaurant(r));
    $('restaurant-list').append(card);
  });

  if (!filtered.length) {
    $('restaurant-list').append(element('p', 'No matching restaurants.'));
  }

  window.restaurantMap?.update(
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

  ['address', 'city', 'phone'].forEach((field) => {
    const paragraph = element('p');
    const label = field[0].toUpperCase() + field.slice(1);

    paragraph.append(
      element('strong', `${label}: `),
      document.createTextNode(restaurant[field] || 'Not provided')
    );

    $('restaurant-info').append(paragraph);
  });

  renderFavouriteButton();
  renderRestaurants();
  window.restaurantMap?.focus(restaurant);
  loadMenus(restaurant._id);
}

export async function loadRestaurants() {
  $('status').textContent = 'Loading restaurants...';
  $('retry-button').hidden = true;
  $('nearest-button').disabled = true;

  try {
    const data = await api('/restaurants');
    const list = Array.isArray(data) ? data : data.restaurants;

    if (!Array.isArray(list)) {
      throw new Error('Invalid restaurant data.');
    }

    restaurants = list
      .filter((r) => r._id && r.name)
      .sort((a, b) => a.name.localeCompare(b.name));

    fillFilter('city', 'city', 'All Cities');
    fillFilter('provider', 'company', 'All Providers');
    renderRestaurants();

    $('status').textContent = '';
    $('nearest-button').disabled = !restaurants.length;

    if (restaurants.length) {
      selectRestaurant(restaurants[0]);
    }
  } catch {
    $('status').textContent = 'Could not load restaurants. Please retry.';
    $('retry-button').hidden = false;
  }
}

function distanceKm([longitude, latitude], position) {
  const rad = (value) => (value * Math.PI) / 180;

  const value =
    Math.sin(rad(latitude - position.latitude) / 2) ** 2 +
    Math.cos(rad(position.latitude)) *
      Math.cos(rad(latitude)) *
      Math.sin(rad(longitude - position.longitude) / 2) ** 2;

  return 12742 * Math.asin(Math.sqrt(Math.min(1, value)));
}

function findNearest() {
  if (!navigator.geolocation) {
    $('status').textContent = 'Location is not supported by your browser.';
    return;
  }

  $('nearest-button').disabled = true;
  $('status').textContent = 'Finding your location...';

  navigator.geolocation.getCurrentPosition(
    (position) => {
      restaurants.forEach((r) => {
        const coordinates = r.location?.coordinates;

        r.distance = window.restaurantMap?.validCoordinates(coordinates)
          ? distanceKm(coordinates, position.coords)
          : Infinity;
      });

      restaurants.sort((a, b) => a.distance - b.distance);

      const nearest = restaurants.find((r) => Number.isFinite(r.distance));

      if (nearest) {
        nearestId = nearest._id;

        ['search', 'city', 'provider'].forEach((id) => {
          $(id).value = '';
        });

        $('favourite-only').checked = false;
        selectRestaurant(nearest);

        $('status').textContent =
          `Nearest: ${nearest.name}, ` +
          `${nearest.distance.toFixed(1)} km in a straight line.`;
      } else {
        $('status').textContent = 'No restaurant coordinates available.';
      }

      $('nearest-button').disabled = false;
    },
    () => {
      $('status').textContent =
        'Location unavailable. Check browser location permission.';
      $('nearest-button').disabled = false;
    },
    {timeout: 10000, maximumAge: 60000}
  );
}

export function initRestaurants() {
  window.addEventListener('account-change', () => {
    renderRestaurants();
    renderFavouriteButton();
  });

  ['search', 'city', 'provider'].forEach((id) => {
    on(id, id === 'search' ? 'input' : 'change', renderRestaurants);
  });

  on('favourite-only', 'change', () => {
    if ($('favourite-only').checked && !user) {
      $('favourite-only').checked = false;
      openAccount('login');
    }

    renderRestaurants();
  });

  on('favourite-button', 'click', async () => {
    if (!user) return openAccount('login');

    if (!selectedRestaurant || selectedRestaurant._id === favouriteId()) {
      return;
    }

    const id = selectedRestaurant._id;
    $('favourite-button').disabled = true;

    try {
      await saveFavourite(id);
    } catch {
      $('status').textContent = 'Could not save favourite.';
    } finally {
      renderFavouriteButton();
    }
  });

  on('nearest-button', 'click', findNearest);
  on('retry-button', 'click', loadRestaurants);
}
