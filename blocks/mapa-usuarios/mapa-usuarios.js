const LOCAL_HOSTNAMES = ['localhost', '127.0.0.1'];
const LOCAL_API_URL = 'http://127.0.0.1:7676/api/usuarios-activos';
const API_URL = '/api/usuarios-activos';
const DEFAULT_LANG = 'es';
const COLOR_STEPS = 5;
const MAP_LOAD_MARGIN = '200px 0px';
const REFRESH_SECONDS = 60;
const FETCH_TIMEOUT_MS = 30000;

function createParagraph(className, text, role) {
  const p = document.createElement('p');
  p.className = className;
  p.textContent = text;
  if (role) p.setAttribute('role', role);
  return p;
}

/**
 * Creates the locale-aware formatters used by the table, the legend and the map.
 * @param {string} lang Locale
 * @returns {{getCountryName: function(string): string, formatNumber: function(number): string}}
 */
function createFormatters(lang) {
  const displayNames = new Intl.DisplayNames(lang, { type: 'region' });
  const numberFormat = new Intl.NumberFormat(lang);
  return {
    getCountryName: (code) => {
      try {
        return displayNames.of(code);
      } catch {
        // Intl.DisplayNames.of() throws a RangeError on malformed codes
        return code;
      }
    },
    formatNumber: (value) => numberFormat.format(value),
  };
}

/**
 * Rounds to two significant digits so the legend shows readable limits.
 * @param {number} value Positive number
 * @returns {number} Rounded integer
 */
function roundLimit(value) {
  const magnitude = Math.max(1, 10 ** (Math.floor(Math.log10(value)) - 1));
  return Math.round(value / magnitude) * magnitude;
}

/**
 * Builds a color scale with logarithmic ranges between the lowest and highest value.
 * @param {number[]} values Active users
 * @returns {{min: number, max: number, limits: number[], getStep: function(number): number,
 *   getRangeStep: function(number): number}} The scale. Limits are the lower bound of each range
 *   but the first one. Steps go from 1 to COLOR_STEPS, spread out when there are fewer ranges.
 */
function buildScale(values) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const low = Math.max(min, 1);
  const candidates = Array.from({ length: COLOR_STEPS - 1 }, (_, i) => {
    const position = (i + 1) / COLOR_STEPS;
    return roundLimit(10 ** (Math.log10(low) + (Math.log10(max) - Math.log10(low)) * position));
  });
  const limits = max > 0 ? [...new Set(candidates)].filter((l) => l > min && l <= max) : [];

  const getRangeStep = (range) => (limits.length
    ? 1 + Math.round((range * (COLOR_STEPS - 1)) / limits.length)
    : COLOR_STEPS);
  const getStep = (value) => {
    const range = limits.findIndex((limit) => value < limit);
    return getRangeStep(range === -1 ? limits.length : range);
  };

  return {
    min, max, limits, getStep, getRangeStep,
  };
}

function createLegendItem(text, step) {
  const item = document.createElement('li');
  const swatch = document.createElement('span');
  swatch.className = `mapa-usuarios-swatch${step ? ` mapa-usuarios-step-${step}` : ''}`;
  item.append(swatch, text);
  return item;
}

/**
 * Builds the legend, with one entry per range plus the "no data" one.
 * @param {object|null} scale The color scale, or null if no country has data
 * @param {function(number): string} formatNumber Number formatter
 * @returns {HTMLDivElement} The legend
 */
function buildLegend(scale, formatNumber) {
  const legend = document.createElement('div');
  legend.className = 'mapa-usuarios-legend';
  legend.append(createParagraph('mapa-usuarios-legend-title', 'Usuarios activos'));

  const list = document.createElement('ul');
  if (scale) {
    const {
      min, max, limits, getRangeStep,
    } = scale;
    if (!limits.length) {
      const label = min === max
        ? formatNumber(min)
        : `${formatNumber(min)}–${formatNumber(max)}`;
      list.append(createLegendItem(label, getRangeStep(0)));
    }
    limits.forEach((limit, i) => {
      if (i === 0) list.append(createLegendItem(`< ${formatNumber(limit)}`, getRangeStep(0)));
      const next = limits[i + 1];
      const label = next
        ? `${formatNumber(limit)}–${formatNumber(next - 1)}`
        : `≥ ${formatNumber(limit)}`;
      list.append(createLegendItem(label, getRangeStep(i + 1)));
    });
  }
  list.append(createLegendItem('Sin datos'));
  legend.append(list);
  return legend;
}

/**
 * Builds the table of active users per country.
 * @param {Array<{country: string, active_users: number}>} rows API rows
 * @param {object} formatters Locale-aware formatters
 * @returns {HTMLTableElement} The table
 */
function buildTable(rows, { getCountryName, formatNumber }) {
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
    row.insertCell().textContent = getCountryName(country);
    row.insertCell().textContent = formatNumber(activeUsers);
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

  const formatted = new Intl.DateTimeFormat(lang, { dateStyle: 'long', timeStyle: 'short' }).format(date);
  return createParagraph('mapa-usuarios-updated', `Actualizado: ${formatted}`);
}

/**
 * Creates the block's view. It keeps the same canvas and disclosure across refreshes, so new
 * data doesn't make the map flicker, lose its focus or close the table.
 * @param {Element} block The block element
 * @param {string} lang Locale
 * @returns {function({updatedAt: string, rows: Array}): void} Shows a set of data
 */
function createView(block, lang) {
  const formatters = createFormatters(lang);

  const canvas = document.createElement('div');
  canvas.className = 'mapa-usuarios-canvas';
  canvas.append(createParagraph('mapa-usuarios-status', 'Cargando mapa…', 'status'));

  const tableDetails = document.createElement('details');
  tableDetails.className = 'mapa-usuarios-details';
  const summary = document.createElement('summary');
  summary.textContent = 'Ver como tabla';
  tableDetails.append(summary);

  let updated = null;
  let legend = null;
  let table = null;
  let note = null;
  let mapOptions = null;
  let updateMap = null;
  let mapFailed = false;

  const paintMap = () => {
    if (!updateMap) return;
    const notDrawn = updateMap(mapOptions);
    note?.remove();
    note = null;
    if (notDrawn.length) {
      const names = notDrawn.map(formatters.getCountryName).join(', ');
      note = createParagraph('mapa-usuarios-note', `Sin forma en el mapa (ver la tabla): ${names}.`);
      legend.after(note);
    }
  };

  // Loads the map only when it approaches the viewport. If it fails, the table takes its place.
  const loadMap = async () => {
    try {
      const { default: renderMap } = await import('./mapa-usuarios-map.js');
      updateMap = await renderMap(canvas);
      paintMap();
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('mapa-usuarios: failed to load map', error);
      mapFailed = true;
      updateMap = null;
      canvas.replaceWith(createParagraph('mapa-usuarios-status', 'No se ha podido cargar el mapa.', 'alert'));
      legend.remove();
      tableDetails.open = true;
    }
  };

  return ({ updatedAt, rows }) => {
    const values = new Map();
    rows.forEach(({ country, active_users: activeUsers }) => {
      if (country && Number.isFinite(activeUsers) && activeUsers >= 0) {
        values.set(String(country).toUpperCase(), activeUsers);
      }
    });
    const scale = values.size ? buildScale([...values.values()]) : null;
    mapOptions = {
      values,
      getStep: scale ? scale.getStep : () => COLOR_STEPS,
      ...formatters,
    };

    const newUpdated = buildUpdatedAt(updatedAt, lang);
    const newLegend = buildLegend(scale, formatters.formatNumber);
    const newTable = buildTable(rows, formatters);

    if (!table) {
      tableDetails.append(newTable);
      block.replaceChildren(...(newUpdated ? [newUpdated] : []), canvas, newLegend, tableDetails);

      const observer = new IntersectionObserver((entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        loadMap();
      }, { rootMargin: MAP_LOAD_MARGIN });
      observer.observe(canvas);
    } else {
      table.replaceWith(newTable);
      if (!mapFailed) legend.replaceWith(newLegend);
      updated?.remove();
      if (newUpdated) block.prepend(newUpdated);
    }

    updated = newUpdated;
    legend = newLegend;
    table = newTable;
    paintMap();
  };
}

/**
 * Fetches the data from the API.
 * @param {string} url API URL
 * @returns {Promise<{updatedAt: string, rows: Array}>} The data
 */
async function fetchData(url) {
  const resp = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

  const { updated_at: updatedAt, data } = await resp.json();
  if (!Array.isArray(data)) throw new Error('Unexpected response: "data" is not an array');
  return { updatedAt, rows: data };
}

export default function decorate(block) {
  const url = LOCAL_HOSTNAMES.includes(window.location.hostname) ? LOCAL_API_URL : API_URL;
  const lang = document.documentElement.lang || DEFAULT_LANG;
  let showData = null;

  block.replaceChildren(createParagraph('mapa-usuarios-status', 'Cargando datos…', 'status'));

  const refresh = async () => {
    // A hidden tab doesn't ask for more data once it has some.
    if (!showData || !document.hidden) {
      try {
        const result = await fetchData(url);
        showData ??= createView(block, lang);
        showData(result);
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error('mapa-usuarios: failed to load data', error);
        // A failed refresh keeps the last data on screen. A later one can still recover the block.
        if (!showData) {
          block.replaceChildren(createParagraph('mapa-usuarios-status', 'No se han podido cargar los datos.', 'alert'));
        }
      }
    }
    // Scheduled after each response, so requests never overlap.
    setTimeout(refresh, REFRESH_SECONDS * 1000);
  };

  // Not awaited on purpose: aem.js keeps the section hidden until decorate() resolves,
  // so awaiting would hide the loading message and hold back the following sections.
  refresh();
}
