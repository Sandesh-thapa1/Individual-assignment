export const $ = (id) => document.getElementById(id);

export const on = (id, event, action) => {
  $(id).addEventListener(event, action);
};

export function element(tag, text, className) {
  const item = document.createElement(tag);
  if (text !== undefined) item.textContent = text;
  if (className) item.className = className;
  return item;
}
