import {initMenus} from './menus.js';
import {initAccount, restoreAccount} from './account.js';
import {initRestaurants, loadRestaurants} from './restaurants.js';

async function start() {
  initMenus();
  initRestaurants();
  initAccount();

  await loadRestaurants();
  await restoreAccount();
}

start();
