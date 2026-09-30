'use strict';

window.restaurantMap = (() => {
  const map = document.getElementById('map');
  const tiles = document.getElementById('map-tiles');
  const markers = document.getElementById('map-markers');

  let centre = [24.94, 60.17];
  let zoom = 10;
  let restaurants = [];
  let selectedId = '';
  let nearestId = '';
  let onSelect = () => {};

  function validCoordinates(coordinates) {
    return (
      Array.isArray(coordinates) &&
      coordinates.length >= 2 &&
      coordinates.slice(0, 2).every(Number.isFinite) &&
      Math.abs(coordinates[0]) <= 180 &&
      Math.abs(coordinates[1]) <= 90
    );
  }

  // Convert longitude and latitude into map pixels.
  function project(coordinates) {
    const size = 256 * 2 ** zoom;
    const latitude = Math.max(-85, Math.min(85, coordinates[1]));
    const radians = (latitude * Math.PI) / 180;

    return [
      ((coordinates[0] + 180) / 360) * size,
      ((1 - Math.log(Math.tan(radians) + 1 / Math.cos(radians)) / Math.PI) /
        2) *
        size,
    ];
  }

  function draw() {
    const width = map.clientWidth;
    const height = map.clientHeight;
    const [x, y] = project(centre);
    const left = x - width / 2;
    const top = y - height / 2;
    const tileCount = 2 ** zoom;

    tiles.replaceChildren();
    markers.replaceChildren();

    for (
      let column = Math.floor(left / 256);
      column <= Math.floor((left + width) / 256);
      column++
    ) {
      for (
        let row = Math.floor(top / 256);
        row <= Math.floor((top + height) / 256);
        row++
      ) {
        if (row < 0 || row >= tileCount) continue;

        const image = document.createElement('img');
        const tileX = ((column % tileCount) + tileCount) % tileCount;

        image.className = 'map-tile';
        image.alt = '';
        image.draggable = false;
        image.src = `https://tile.openstreetmap.org/${zoom}/${tileX}/${row}.png`;
        image.style.left = `${column * 256 - left}px`;
        image.style.top = `${row * 256 - top}px`;

        tiles.append(image);
      }
    }

    restaurants.forEach((restaurant) => {
      if (!validCoordinates(restaurant.location?.coordinates)) return;

      const [pointX, pointY] = project(restaurant.location.coordinates);
      const markerX = pointX - left;
      const markerY = pointY - top;

      if (markerX < 0 || markerX > width || markerY < 0 || markerY > height)
        return;

      const marker = document.createElement('button');

      marker.type = 'button';
      marker.className = 'map-marker';
      marker.textContent = '●';
      marker.title = restaurant.name;
      marker.setAttribute('aria-label', `Select ${restaurant.name}`);
      marker.style.left = `${markerX}px`;
      marker.style.top = `${markerY}px`;

      marker.classList.toggle('selected', restaurant._id === selectedId);
      marker.classList.toggle('nearest', restaurant._id === nearestId);

      marker.addEventListener('click', () => onSelect(restaurant));
      markers.append(marker);
    });
  }

  function pan(dx, dy) {
    const [x, y] = project(centre);
    const size = 256 * 2 ** zoom;
    const longitude = ((x + dx) / size) * 360 - 180;

    const latitude =
      (Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + dy)) / size))) * 180) /
      Math.PI;

    centre = [
      ((((longitude + 180) % 360) + 360) % 360) - 180,
      Math.max(-85, Math.min(85, latitude)),
    ];

    draw();
  }

  document.getElementById('zoom-in').addEventListener('click', () => {
    zoom = Math.min(18, zoom + 1);
    draw();
  });

  document.getElementById('zoom-out').addEventListener('click', () => {
    zoom = Math.max(3, zoom - 1);
    draw();
  });

  const directions = {
    north: [0, -180],
    south: [0, 180],
    west: [-180, 0],
    east: [180, 0],
  };

  Object.entries(directions).forEach(([direction, movement]) => {
    document
      .getElementById(`map-${direction}`)
      .addEventListener('click', () => pan(...movement));
  });

  document.getElementById('map-centre').addEventListener('click', () => {
    const restaurant = restaurants.find((item) => item._id === selectedId);

    if (validCoordinates(restaurant?.location?.coordinates)) {
      centre = restaurant.location.coordinates;
      draw();
    }
  });

  new ResizeObserver(draw).observe(map);

  return {
    validCoordinates,

    update(list, currentId, closestId, callback) {
      restaurants = list;
      selectedId = currentId || '';
      nearestId = closestId || '';
      onSelect = callback;
      draw();
    },

    focus(restaurant) {
      if (validCoordinates(restaurant.location?.coordinates)) {
        centre = restaurant.location.coordinates;
        draw();
      }
    },
  };
})();
