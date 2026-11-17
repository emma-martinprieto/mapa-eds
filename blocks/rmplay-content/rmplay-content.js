import { readBlockConfig } from '../../scripts/aem.js';

// Vesper Front Office API (Deltatre). Staging values: change both for production.
const API_BASE_URL = 'https://realmadrid.api.onvesper-staging.com';
const API_KEY = '16d40380-cf6c-4b9a-99e4-64082887e08d';
const API_REALM = 'dce.realmadrid';
const API_APP = 'vesper';

const RMPLAY_URL = 'https://play.realmadrid.com';
const TOKEN_STORAGE_KEY = 'rmplay.guest';
const DEFAULT_LANG = 'es';
const DEFAULT_ITEMS = 10;
const MAX_ITEMS = 25; // API limit for rpp
const ROWS_PER_PAGE = 10; // API limit for bpp
const MAX_SECTION_PAGES = 5;
// The image host serves resized copies when "original" in the URL is replaced by WIDTHxHEIGHT.
// It crops from the centre to that exact size, so each field is asked in its own orientation,
// horizontal ones first: playlists bring a horizontal coverUrl and a portrait smallCoverUrl.
const IMAGE_FIELDS = [
  { field: 'thumbnailUrl', size: '640x360' },
  { field: 'coverUrl', size: '640x360' },
  { field: 'smallCoverUrl', size: '480x640' },
];
// Images narrower than this are shown whole over a blurred copy instead of cropped
const MIN_COVER_RATIO = 1.5;

const PATH_BY_TYPE = { VOD: 'interstitial', LIVE: 'live', PLAYLIST: 'playlist' };
const ACCESS_LABELS = {
  DENIED: 'Suscríbete para verlo',
  GRANTED_ON_SIGN_IN: 'Inicia sesión para verlo',
  GRANTED_ON_SIGN: 'Inicia sesión para verlo',
  // RM Play also asks for an account for these
  GRANTED: 'Ver en RM Play',
};
const ICON_PATHS = {
  lock: 'M7 10V7a5 5 0 0 1 10 0v3h1a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V11a1 1 0 0 1 1-1h1Zm2 0h6V7a3 3 0 0 0-6 0v3Z',
  play: 'M8 5.5v13a1 1 0 0 0 1.5.86l11-6.5a1 1 0 0 0 0-1.72l-11-6.5A1 1 0 0 0 8 5.5Z',
};
const UTM_PARAMS = { utm_source: 'realmadrid.com', utm_medium: 'landing' };

/* Guest tokens, shared by every rmplay-content block on the page */

let tokens = null;
let checkinPromise = null;
let refreshPromise = null;

function readStoredTokens() {
  try {
    const stored = JSON.parse(localStorage.getItem(TOKEN_STORAGE_KEY));
    if (stored && stored.authorisationToken && stored.refreshToken) return stored;
  } catch {
    // Storage blocked or corrupted: tokens then live only in memory
  }
  return null;
}

function storeTokens(newTokens) {
  tokens = newTokens;
  try {
    if (newTokens) localStorage.setItem(TOKEN_STORAGE_KEY, JSON.stringify(newTokens));
    else localStorage.removeItem(TOKEN_STORAGE_KEY);
  } catch {
    // Storage blocked: keep the tokens in memory only
  }
  return newTokens;
}

function apiHeaders(extra = {}) {
  return {
    Realm: API_REALM,
    app: API_APP,
    'x-api-key': API_KEY,
    'Accept-Language': document.documentElement.lang || DEFAULT_LANG,
    ...extra,
  };
}

function guestCheckin() {
  if (!checkinPromise) {
    checkinPromise = (async () => {
      const resp = await fetch(`${API_BASE_URL}/api/v2/login/guest/checkin`, {
        method: 'POST',
        headers: apiHeaders(),
      });
      if (!resp.ok) throw new Error(`Guest check-in: HTTP ${resp.status}`);
      const { authorisationToken, refreshToken } = await resp.json();
      return storeTokens({ authorisationToken, refreshToken });
    })().finally(() => {
      checkinPromise = null;
    });
  }
  return checkinPromise;
}

async function getTokens() {
  if (refreshPromise) return refreshPromise;
  if (!tokens) tokens = readStoredTokens();
  return tokens || guestCheckin();
}

/**
 * Gets new tokens after a 401. Every request that failed with the same token waits for a
 * single refresh call. The token is never refreshed before a 401: the API answers 429.
 * @param {string} expiredToken Authorisation token that got the 401
 * @returns {Promise<{authorisationToken: string, refreshToken: string}>} Valid tokens
 */
function refreshTokens(expiredToken) {
  if (refreshPromise) return refreshPromise;

  // Another request, or another tab, may have replaced the expired token already
  const current = readStoredTokens() || tokens;
  if (!current) return guestCheckin();
  if (current.authorisationToken !== expiredToken) {
    tokens = current;
    return Promise.resolve(current);
  }

  refreshPromise = (async () => {
    const resp = await fetch(`${API_BASE_URL}/api/v2/token/refresh`, {
      method: 'POST',
      headers: apiHeaders({
        Authorization: `Bearer ${expiredToken}`,
        'Content-Type': 'application/json',
      }),
      body: JSON.stringify({ refreshToken: current.refreshToken }),
    });
    if (resp.status === 403 || resp.status === 404) {
      storeTokens(null);
      return guestCheckin();
    }
    if (!resp.ok) {
      // Unusable tokens (for example 400 when they are corrupted): the next load checks in again
      storeTokens(null);
      throw new Error(`Token refresh: HTTP ${resp.status}`);
    }
    const { authorisationToken, refreshToken } = await resp.json();
    return storeTokens({ authorisationToken, refreshToken: refreshToken || current.refreshToken });
  })().finally(() => {
    refreshPromise = null;
  });
  return refreshPromise;
}

/**
 * GET request to the API with the guest token, retried once after refreshing it on a 401.
 * @param {string} path Path and query string
 * @returns {Promise<object>} Response body
 */
async function apiGet(path) {
  const request = (token) => fetch(`${API_BASE_URL}${path}`, {
    headers: apiHeaders({ Authorization: `Bearer ${token}` }),
  });

  const { authorisationToken } = await getTokens();
  let resp = await request(authorisationToken);
  if (resp.status === 401) {
    const refreshed = await refreshTokens(authorisationToken);
    resp = await request(refreshed.authorisationToken);
  }
  if (!resp.ok) throw new Error(`GET ${path}: HTTP ${resp.status}`);
  return resp.json();
}

/* Content */

async function fetchBucket(exid, items) {
  return [await apiGet(`/api/v4/content/bucket/${encodeURIComponent(exid)}?rpp=${items}`)];
}

/**
 * Fetches every row of a section, following the API paging (10 rows per page at most).
 * @param {string} section Section name
 * @param {number} items Cards per row
 * @returns {Promise<object[]>} The rows
 */
async function fetchSection(section, items) {
  const rows = [];
  let lastSeen = '';
  let page = 0;
  while (page < MAX_SECTION_PAGES) {
    const params = new URLSearchParams({ bpp: ROWS_PER_PAGE, rpp: items });
    if (lastSeen) params.set('lastSeen', lastSeen);
    // Pages depend on each other: each request needs the lastSeen of the previous one
    // eslint-disable-next-line no-await-in-loop
    const { buckets = [], paging = {} } = await apiGet(`/api/v4/content/${encodeURIComponent(section)}?${params}`);
    rows.push(...buckets);
    if (!paging.moreDataAvailable || !paging.lastSeen) break;
    lastSeen = paging.lastSeen;
    page += 1;
  }
  return rows;
}

/* Rendering */

function createElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text) element.textContent = text;
  return element;
}

function getCardUrl({ type, id }, campaign) {
  const path = PATH_BY_TYPE[type];
  const url = new URL(path && id != null ? `${RMPLAY_URL}/${path}/${encodeURIComponent(id)}` : `${RMPLAY_URL}/home`);
  if (campaign) {
    Object.entries(UTM_PARAMS).forEach(([key, value]) => url.searchParams.set(key, value));
    url.searchParams.set('utm_campaign', campaign);
  }
  return url.href;
}

function createIcon(name, className) {
  const svgNs = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNs, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', className);
  const path = document.createElementNS(svgNs, 'path');
  path.setAttribute('d', ICON_PATHS[name]);
  svg.append(path);
  return svg;
}

/**
 * Formats a duration in seconds as m:ss or h:mm:ss.
 * @param {number} seconds Duration
 * @returns {string} Formatted duration, or an empty string if there is none
 */
function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '';
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

/**
 * Creates the card image from the first available field, resized in that field's orientation.
 * When the image is not horizontal enough to fill 16:9, it is shown whole over a blurred copy.
 * @param {object} item Content item
 * @param {Element} media Image container
 * @returns {HTMLImageElement|null} The image
 */
function createImage(item, media) {
  const source = IMAGE_FIELDS.find(({ field }) => item[field]);
  if (!source) return null;
  const original = item[source.field];

  const img = document.createElement('img');
  img.loading = 'lazy';
  img.alt = item.title || '';
  img.width = 640;
  img.height = 360;
  const resized = original.replace('/original/', `/${source.size}/`);
  if (resized !== original) {
    img.addEventListener('error', () => { img.src = original; }, { once: true });
  }
  img.addEventListener('load', () => {
    if (img.naturalWidth / img.naturalHeight >= MIN_COVER_RATIO) return;
    media.style.setProperty('--rmplay-content-backdrop', `url("${img.currentSrc.replaceAll('"', '%22')}")`);
    media.classList.add('rmplay-content-media-contain');
  });
  img.src = resized;
  return img;
}

function createMedia(item) {
  const media = createElement('div', 'rmplay-content-media');
  const img = createImage(item, media);
  if (img) media.append(img);

  const play = createElement('span', 'rmplay-content-play');
  play.append(createIcon('play', 'rmplay-content-icon'));
  media.append(play);

  if (item.type === 'PLAYLIST') {
    media.append(createElement('span', 'rmplay-content-badge rmplay-content-badge-type', 'Playlist'));
  }
  if (item.accessLevel === 'DENIED') {
    const lock = createElement('span', 'rmplay-content-badge rmplay-content-badge-lock');
    lock.append(createIcon('lock', 'rmplay-content-icon'));
    media.append(lock);
  }
  const duration = formatDuration(item.duration);
  if (duration) {
    media.append(createElement('span', 'rmplay-content-badge rmplay-content-badge-duration', duration));
  }
  return media;
}

function createCard(item, campaign) {
  const link = createElement('a', 'rmplay-content-card');
  link.href = getCardUrl(item, campaign);

  const body = createElement('div', 'rmplay-content-body');
  body.append(createElement('span', 'rmplay-content-title', item.title));
  const label = ACCESS_LABELS[item.accessLevel];
  if (label) {
    const variant = item.accessLevel === 'DENIED' ? 'subscribe' : 'account';
    body.append(createElement('span', `rmplay-content-access rmplay-content-access-${variant}`, label));
  }
  link.append(createMedia(item), body);

  const li = document.createElement('li');
  li.append(link);
  return li;
}

/**
 * Builds a row of cards, or null if none of its items can be shown.
 * @param {object} row Bucket returned by the API
 * @param {number} items Maximum number of cards
 * @param {string} campaign utm_campaign value, if any
 * @returns {HTMLElement|null} The row
 */
function createRow(row, items, campaign) {
  const visible = (row.contentList || [])
    .filter((item) => item && item.accessLevel !== 'GEOBLOCKED')
    .slice(0, items);
  if (!visible.length) return null;

  const section = createElement('section', 'rmplay-content-row');
  const title = (row.rowTypeData && row.rowTypeData.title) || row.name;
  if (title) section.append(createElement('h2', 'rmplay-content-row-title', title));
  const list = createElement('ul', 'rmplay-content-list');
  list.append(...visible.map((item) => createCard(item, campaign)));
  section.append(list);
  return section;
}

function createStatus(text, role) {
  const p = createElement('p', 'rmplay-content-status', text);
  p.setAttribute('role', role);
  return p;
}

/**
 * Reads the authored configuration. A cell with several paragraphs counts as its first one.
 * @param {Element} block The block element
 * @returns {{bucket: string, section: string, items: number, campaign: string}} Configuration
 */
function getConfig(block) {
  const config = readBlockConfig(block);
  const value = (key) => {
    const raw = Array.isArray(config[key]) ? config[key][0] : config[key];
    return (raw || '').trim();
  };
  const items = Number.parseInt(value('items'), 10);
  return {
    bucket: value('bucket'),
    section: value('section'),
    items: items > 0 ? Math.min(items, MAX_ITEMS) : DEFAULT_ITEMS,
    campaign: value('campaign'),
  };
}

async function loadContent(block, {
  bucket, section, items, campaign,
}) {
  try {
    if (!bucket && !section) throw new Error('Missing "Bucket" or "Section" in the block configuration');
    const rows = bucket ? await fetchBucket(bucket, items) : await fetchSection(section, items);
    const elements = rows.map((row) => createRow(row, items, campaign)).filter(Boolean);
    block.replaceChildren(...(elements.length
      ? elements
      : [createStatus('No hay contenido disponible en este momento.', 'status')]));
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('rmplay-content: failed to load content', error);
    block.replaceChildren(createStatus('No se ha podido cargar el contenido de RM Play.', 'alert'));
  }
}

export default function decorate(block) {
  const config = getConfig(block);
  block.replaceChildren(createStatus('Cargando contenido…', 'status'));

  // Not awaited on purpose: aem.js keeps the section hidden until decorate() resolves,
  // so awaiting would hide the loading message and hold back the following sections.
  loadContent(block, config);
}
