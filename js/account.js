import {$, on} from './utils.js';
import {api, saveUser, API, UPLOADS} from './api.js';

export let user = null;

function showAvatar(id, value) {
  const image = $(id);
  if (!image) return;

  image.onload = null;
  image.onerror = null;
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
  ['login', 'register'].forEach((name) => {
    $(`${name}-button`).hidden = Boolean(user);
  });

  ['profile', 'logout'].forEach((name) => {
    $(`${name}-button`).hidden = !user;
  });

  $('account-name').textContent = user?.username || '';

  showAvatar('header-avatar', user?.avatar);
  showAvatar('profile-avatar', user?.avatar);

  if (!user) $('favourite-only').checked = false;

  window.dispatchEvent(new Event('account-change'));
}

function logout() {
  user = null;
  sessionStorage.removeItem('restaurantToken');
  renderAccount();
}

async function refreshUser() {
  const data = await api('/users/token', {auth: true});
  const account = data.data || data;

  if (!account?._id) throw new Error('Please log in again.');

  user = account;
  renderAccount();
}

async function signIn(username, password) {
  const data = await api('/auth/login', {
    method: 'POST',
    body: JSON.stringify({username, password}),
  });

  if (!data.token) {
    throw new Error('Login failed. Check your account details.');
  }

  sessionStorage.setItem('restaurantToken', data.token);

  try {
    await refreshUser();
  } catch (error) {
    logout();
    throw error;
  }
}

export function openAccount(mode) {
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
    const fields = $('profile-form').elements;
    fields.username.value = user.username || '';
    fields.email.value = user.email || '';
    fields.password.value = '';
  }

  if (!$('account-dialog').open) {
    $('account-dialog').showModal();
  }
}

function showActivationLink(value) {
  $('activation-link').hidden = true;
  if (!value) return;

  try {
    const url = new URL(value, API);
    if (url.protocol !== 'https:') return;

    $('activation-link').href = url.href;
    $('activation-link').hidden = false;
  } catch {
    $('activation-link').hidden = true;
  }
}

function handleForm(id, action) {
  on(id, 'submit', async (event) => {
    event.preventDefault();

    const form = event.currentTarget;
    const button = form.querySelector('button[type="submit"]');

    button.disabled = true;
    $('account-status').textContent = '';

    try {
      await action(form);
    } catch (error) {
      $('account-status').textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });
}

async function register(form) {
  const username = form.elements.username.value.trim();
  const password = form.elements.password.value;
  const email = form.elements.email.value.trim();
  let result;

  try {
    result = await api('/users', {
      method: 'POST',
      body: JSON.stringify({username, password, email}),
    });

    if (!result.data?._id) {
      throw new Error(result.message || 'Registration failed.');
    }
  } catch (error) {
    // The server may save the account before its email step fails.
    if (
      !/535/.test(error.message) ||
      !/authentication failed|invalid login/i.test(error.message)
    ) {
      throw error;
    }
  }

  form.reset();

  if (result?.data?.activated === false) {
    openAccount('login');
    $('login-form').elements.username.value = username;
    $('account-status').textContent = 'Activate your account, then log in.';
    showActivationLink(result.activationUrl);
    return;
  }

  try {
    await signIn(username, password);
    $('account-dialog').close();
    $('status').textContent = '';
  } catch {
    openAccount('login');
    $('login-form').elements.username.value = username;
    $('account-status').textContent =
      'Automatic login failed. Please try logging in.';
    showActivationLink(result?.activationUrl);
  }
}

async function editProfile(form) {
  const fields = form.elements;
  const updates = {
    username: fields.username.value.trim(),
    email: fields.email.value.trim(),
  };

  if (fields.password.value) {
    updates.password = fields.password.value;
  }

  await saveUser(updates);
  fields.password.value = '';

  try {
    await refreshUser();
    $('account-status').textContent = 'Profile updated.';
  } catch {
    $('account-status').textContent = 'Update sent. Please log in again.';
  }
}

async function uploadPhoto(form) {
  const file = form.elements.avatar.files[0];

  if (!file?.type.startsWith('image/')) {
    throw new Error('Choose an image.');
  }

  if (file.size > 5 * 1024 * 1024) {
    throw new Error('Choose an image under 5 MB.');
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
  $('account-status').textContent = 'Photo updated.';
}

export async function saveFavourite(id) {
  await saveUser({favouriteRestaurant: id});

  if (user) {
    user.favouriteRestaurant = id;
    renderAccount();
  }
}

export async function restoreAccount() {
  if (!sessionStorage.getItem('restaurantToken')) return;

  try {
    await refreshUser();
  } catch {
    logout();
  }
}

export function initAccount() {
  window.addEventListener('session-expired', logout);

  handleForm('register-form', register);
  handleForm('profile-form', editProfile);
  handleForm('avatar-form', uploadPhoto);

  handleForm('login-form', async (form) => {
    await signIn(
      form.elements.username.value.trim(),
      form.elements.password.value
    );

    form.reset();
    $('account-dialog').close();
    $('status').textContent = '';
  });

  on('check-username', 'click', async () => {
    const username = $('register-form').elements.username.value.trim();

    if (!username) {
      $('account-status').textContent = 'Enter a username first.';
      return;
    }

    try {
      const data = await api(
        `/users/available/${encodeURIComponent(username)}`
      );

      $('account-status').textContent = data.available
        ? 'Username available.'
        : 'Username already taken.';
    } catch {
      $('account-status').textContent = 'Could not check username.';
    }
  });

  ['login', 'register', 'profile'].forEach((mode) => {
    on(`${mode}-button`, 'click', () => openAccount(mode));
  });

  on('logout-button', 'click', () => {
    logout();
    $('status').textContent = '';
  });

  on('close-dialog', 'click', () => {
    $('account-dialog').close();
  });

  on('account-dialog', 'close', () => {
    ['login-form', 'register-form', 'profile-form'].forEach((id) => {
      $(id).elements.password.value = '';
    });
  });

  renderAccount();
}
