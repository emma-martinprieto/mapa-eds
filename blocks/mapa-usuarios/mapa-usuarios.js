const LOCAL_HOSTNAMES = ['localhost', '127.0.0.1'];
const LOCAL_API_URL = 'http://127.0.0.1:7676/api/usuarios-activos';
const API_URL = '/api/usuarios-activos';
const DEFAULT_LANG = 'es';

/**
 * Translates an ISO 3166-1 alpha-2 code, falling back to the code itself.
 * Intl.DisplayNames.of() throws a RangeError on malformed codes.
 * @param {Intl.DisplayNames} displayNames Region name formatter
 * @param {string} code Country code
 * @returns {string} Country name
 */
function getCountryName(displayNames, code) {
  try {
    return displayNames.of(code);
  } catch {
    return code;
  }
}

/**
 * Builds the table of active users per country.
 * @param {Array<{country: string, active_users: number}>} rows API rows
 * @param {string} lang Locale for country names and numbers
 * @returns {HTMLTableElement} The table
 */
function buildTable(rows, lang) {
  const displayNames = new Intl.DisplayNames(lang, { type: 'region' });
  const numberFormat = new Intl.NumberFormat(lang);

  const table = document.createElement('table');

  const headerRow = table.createTHead().insertRow();
  ['País', 'Usuarios activos'].forEach((label) => {
    const th = document.createElement('th');
    th.scope = 'col';
    th.textContent = label;
    headerRow.append(th);
  });

  const tbody = table.createTBody();
  rows.forEach(({ country, active_users: activeUsers }) => {
    const row = tbody.insertRow();
    row.insertCell().textContent = getCountryName(displayNames, country);
    row.insertCell().textContent = numberFormat.format(activeUsers);
  });

  return table;
}

/**
 * Builds the "last updated" line.
 * @param {string} updatedAt ISO 8601 date
 * @param {string} lang Locale for the date
 * @returns {HTMLParagraphElement|null} The line, or null if the date is missing or invalid
 */
function buildUpdatedAt(updatedAt, lang) {
  const date = new Date(updatedAt);
  if (Number.isNaN(date.getTime())) return null;

  const p = document.createElement('p');
  p.className = 'mapa-usuarios-updated';
  const formatted = new Intl.DateTimeFormat(lang, { dateStyle: 'long', timeStyle: 'short' }).format(date);
  p.textContent = `Actualizado: ${formatted}`;
  return p;
}

/**
 * Fetches the data and replaces the block content with the result.
 * @param {Element} block The block element
 * @param {string} url API URL
 */
async function loadData(block, url) {
  try {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

    const { updated_at: updatedAt, data } = await resp.json();
    if (!Array.isArray(data)) throw new Error('Unexpected response: "data" is not an array');

    const lang = document.documentElement.lang || DEFAULT_LANG;
    const updated = buildUpdatedAt(updatedAt, lang);
    const table = buildTable(data, lang);
    block.replaceChildren(...(updated ? [updated, table] : [table]));
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('mapa-usuarios: failed to load data', error);
    const message = document.createElement('p');
    message.className = 'mapa-usuarios-status';
    message.setAttribute('role', 'alert');
    message.textContent = 'No se han podido cargar los datos.';
    block.replaceChildren(message);
  }
}

export default function decorate(block) {
  const url = LOCAL_HOSTNAMES.includes(window.location.hostname) ? LOCAL_API_URL : API_URL;

  const loading = document.createElement('p');
  loading.className = 'mapa-usuarios-status';
  loading.setAttribute('role', 'status');
  loading.textContent = 'Cargando datos…';
  block.replaceChildren(loading);

  // Not awaited on purpose: aem.js keeps the section hidden until decorate() resolves,
  // so awaiting would hide the loading message and hold back the following sections.
  loadData(block, url);
}
