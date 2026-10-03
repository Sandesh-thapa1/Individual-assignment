export const API = 'https://media2.edu.metropolia.fi/restaurant/api/v1';

export const UPLOADS = 'https://media2.edu.metropolia.fi/restaurant/uploads/';

export async function api(path, options = {}) {
  const {auth = false, ...settings} = options;
  const headers = new Headers(settings.headers);

  if (auth) {
    const token = sessionStorage.getItem('restaurantToken');

    if (!token) throw new Error('Please log in first.');

    headers.set('Authorization', `Bearer ${token}`);
  }

  if (typeof settings.body === 'string') {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(API + path, {...settings, headers});
  const data = await response.json().catch(() => null);

  if (!response.ok || data?.error) {
    if (auth && [401, 403].includes(response.status)) {
      window.dispatchEvent(new Event('session-expired'));
    }

    throw new Error(
      data?.message || data?.error || 'Request failed. Please retry.'
    );
  }

  if (!data) throw new Error('The server returned an empty response.');

  return data;
}

export function saveUser(updates) {
  return api('/users', {
    method: 'PUT',
    auth: true,
    body: JSON.stringify(updates),
  });
}
