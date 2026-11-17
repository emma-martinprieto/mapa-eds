/*
 * Comunidad mapa: "La Pasión que une al Mundo". Decorative world map with pulsing dots,
 * a live counter and three stats. Positions come from the Figma frame ComunidadGlobal_Hero
 * (1911x958), where the map image sits at x 191, y 253, 1572x536.
 */

const MAP_IMAGE = 'world-dots.svg';
const MAP_FRAME = {
  left: 191, top: 253, width: 1572, height: 536,
};

// [x, y] in Figma frame pixels, converted to percentages of the map image
const PULSE_DOTS = [
  { zone: 'europa', at: [810, 392], delay: '0s' },
  { zone: 'usa', at: [401, 417], delay: '1.75s' },
  { zone: 'oceania', at: [1525, 650], delay: '3.5s' },
  { zone: 'brasil', at: [559, 590], delay: '5.25s' },
];
// size: "center" is the same dot as the pulsing ones; "small" and "medium" are the smaller
// static dots of the design
const STATIC_DOTS = [
  { zone: 'africa-oeste', at: [756, 507], size: 'center' },
  { zone: 'mexico', at: [326, 487], size: 'center' },
  { zone: 'africa-este', at: [1036, 567], size: 'small' },
  { zone: 'oriente-medio', at: [1174, 489], size: 'small' },
  { zone: 'asia-china', at: [1360, 428], size: 'small' },
  { zone: 'asia-shanghai', at: [1376, 452], size: 'medium' },
  { zone: 'asia-japon', at: [1453, 361], size: 'small' },
  { zone: 'usa-oeste', at: [290, 416], size: 'small' },
  { zone: 'canada-oeste', at: [329, 386], size: 'small' },
  { zone: 'europa-norte', at: [870, 348], size: 'small' },
];
// Quadratic curves between dots, in frame pixels: [from, control, to, strong]
const LINES = [
  [[401, 417], [600, 280], [810, 392], false], // USA → Europa
  [[326, 487], [500, 560], [810, 392], false], // México → Europa
  [[810, 392], [1010, 395], [1174, 489], false], // Europa → Oriente Medio
  [[810, 392], [1130, 220], [1453, 361], true], // Europa → Japón
];

const DEFAULTS = {
  titulo: 'La Pasión que une al Mundo',
  destacado: 'Mundo',
  subtitulo: 'Millones de madridistas comparten una misma historia, desde cualquier rincón del planeta.',
  datos: '',
  respaldo: '',
  'simular-directo': 'no',
  frase: 'DONDE HAYA UN MADRIDISTA, ESTÁ EL REAL MADRID.',
  'stat-1': '21M+ | Madridistas | en todo el mundo',
  'stat-2': '+ 150 | Países Unidos | En un mismo sentimiento',
  'stat-3': '+1.5M | Beneficios | Disfrutados',
};

// Material Icons (Apache License 2.0), 24x24
const STAT_ICONS = [
  // group
  'M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z',
  // language
  'M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zm6.93 6h-2.95c-.32-1.25-.78-2.45-1.38-3.56 1.84.63 3.37 1.91 4.33 3.56zM12 4.04c.83 1.2 1.48 2.53 1.91 3.96h-3.82c.43-1.43 1.08-2.76 1.91-3.96zM4.26 14C4.1 13.36 4 12.69 4 12s.1-1.36.26-2h3.38c-.08.66-.14 1.32-.14 2 0 .68.06 1.34.14 2H4.26zm.82 2h2.95c.32 1.25.78 2.45 1.38 3.56-1.84-.63-3.37-1.9-4.33-3.56zm2.95-8H5.08c.96-1.66 2.49-2.93 4.33-3.56C8.81 5.55 8.35 6.75 8.03 8zM12 19.96c-.83-1.2-1.48-2.53-1.91-3.96h3.82c-.43 1.43-1.08 2.76-1.91 3.96zM14.34 14H9.66c-.09-.66-.16-1.32-.16-2 0-.68.07-1.35.16-2h4.68c.09.65.16 1.32.16 2 0 .68-.07 1.34-.16 2zm.25 5.56c.6-1.11 1.06-2.31 1.38-3.56h2.95c-.96 1.65-2.49 2.93-4.33 3.56zM16.36 14c.08-.66.14-1.32.14-2 0-.68-.06-1.34-.14-2h3.38c.16.64.26 1.31.26 2s-.1 1.36-.26 2h-3.38z',
  // favorite
  'M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z',
];

const SVG_NS = 'http://www.w3.org/2000/svg';
const COUNT_START_DELAY = 400;
const COUNT_DURATION = 1200;
const SIMULATION_INTERVAL = 1000;
const REVEAL_THRESHOLD = 0.15;

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function el(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text) element.textContent = text;
  return element;
}

function svgEl(tag, attrs = {}) {
  const element = document.createElementNS(SVG_NS, tag);
  Object.entries(attrs).forEach(([key, value]) => element.setAttribute(key, value));
  return element;
}

/* Configuration */

function toKey(text) {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Reads the key/value table authored in DA. Keys ignore case and accents ("Título" = "titulo").
 * @param {Element} block The block element
 * @returns {object} Configuration with the design defaults for missing keys
 */
function readConfig(block) {
  const config = { ...DEFAULTS };
  [...block.children].forEach((row) => {
    const [keyCell, valueCell] = row.children;
    if (!keyCell || !valueCell) return;
    const key = toKey(keyCell.textContent);
    const link = valueCell.querySelector('a[href]');
    const value = key === 'datos' && link
      ? link.href
      : [...valueCell.querySelectorAll('p')].map((p) => p.textContent).join(' ') || valueCell.textContent;
    if (value.trim()) config[key] = value.trim();
  });
  return config;
}

function parseNumber(value) {
  if (typeof value === 'number') return value;
  const digits = String(value ?? '').replace(/[^\d-]/g, '');
  return digits ? Number(digits) : NaN;
}

const isOn = (value) => ['si', 'sí', 'yes', 'true', '1', 'on'].includes(String(value).trim().toLowerCase());

/* Live counter */

/**
 * Sums active_users from the JSON. Accepts { data: [...] } and EDS sheets, including
 * multi-sheet files (first sheet) and numbers stored as text.
 * @param {string} url JSON URL
 * @returns {Promise<number>} Total active users
 */
async function fetchTotal(url) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const json = await resp.json();
  const sheet = Array.isArray(json.data) ? json : json[(json[':names'] || [])[0]];
  const rows = sheet && Array.isArray(sheet.data) ? sheet.data : null;
  if (!rows) throw new Error('Unexpected JSON: no "data" array');
  return rows.reduce((total, row) => {
    const value = Number(row && row.active_users);
    return Number.isFinite(value) ? total + value : total;
  }, 0);
}

async function getCount({ datos, respaldo }) {
  const fallback = parseNumber(respaldo);
  if (datos) {
    try {
      return await fetchTotal(datos);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('comunidad-mapa: failed to load the counter data, using the fallback', error);
    }
  }
  return Number.isFinite(fallback) ? fallback : null;
}

const formatCount = (value) => Math.round(value).toLocaleString('es-ES');

// cubic-bezier(0, 0, 0.2, 1) as a function of time, solved for x with Newton's method
function easeOut(t) {
  const x1 = 0; const x2 = 0.2; const y1 = 0; const y2 = 1;
  const bezier = (u, a, b) => 3 * a * u * (1 - u) ** 2 + 3 * b * u ** 2 * (1 - u) + u ** 3;
  const slope = (u, a, b) => 3 * a * (1 - u) ** 2
    + 6 * (b - a) * u * (1 - u)
    + 3 * (1 - b) * u ** 2;
  let u = t;
  for (let i = 0; i < 6; i += 1) {
    const d = slope(u, x1, x2);
    if (Math.abs(d) < 1e-6) break;
    u -= (bezier(u, x1, x2) - t) / d;
  }
  return bezier(Math.min(Math.max(u, 0), 1), y1, y2);
}

function animateCount(element, target) {
  return new Promise((resolve) => {
    element.setAttribute('aria-busy', 'true');
    const start = performance.now();
    const frame = (now) => {
      const t = Math.min((now - start) / COUNT_DURATION, 1);
      element.textContent = formatCount(target * easeOut(t));
      if (t < 1) {
        requestAnimationFrame(frame);
      } else {
        element.removeAttribute('aria-busy');
        resolve();
      }
    };
    requestAnimationFrame(frame);
  });
}

function simulateLive(element, initial) {
  let value = initial;
  // The first value is announced; announcing every second would flood screen readers
  element.setAttribute('aria-live', 'off');
  setInterval(() => {
    value += 1 + Math.floor(Math.random() * 5);
    element.textContent = formatCount(value);
  }, SIMULATION_INTERVAL);
}

/**
 * Shows the counter once the card is visible: 400 ms later it counts from 0 to the value.
 * @param {Element} count Number element
 * @param {Promise<void>} cardVisible Resolves when the card enters the viewport
 * @param {object} config Block configuration
 */
async function startCounter(count, cardVisible, config) {
  const [value] = await Promise.all([getCount(config), cardVisible]);
  if (value === null) {
    count.hidden = true;
    return;
  }
  count.classList.remove('is-pending');
  if (reducedMotion()) {
    count.textContent = formatCount(value);
  } else {
    count.textContent = formatCount(0);
    await new Promise((resolve) => { setTimeout(resolve, COUNT_START_DELAY); });
    await animateCount(count, value);
  }
  if (isOn(config['simular-directo'])) simulateLive(count, value);
}

/* Map */

const toPercent = ([x, y]) => [
  ((x - MAP_FRAME.left) / MAP_FRAME.width) * 100,
  ((y - MAP_FRAME.top) / MAP_FRAME.height) * 100,
];

function placeDot(dot, at) {
  const [left, top] = toPercent(at);
  dot.style.left = `${left.toFixed(2)}%`;
  dot.style.top = `${top.toFixed(2)}%`;
}

function buildLines() {
  const svg = svgEl('svg', {
    class: 'comunidad-mapa-lines',
    viewBox: `0 0 ${MAP_FRAME.width} ${MAP_FRAME.height}`,
    'aria-hidden': 'true',
    focusable: 'false',
  });
  const local = ([x, y]) => `${x - MAP_FRAME.left} ${y - MAP_FRAME.top}`;
  LINES.forEach(([from, control, to, strong], i) => {
    const path = svgEl('path', {
      d: `M${local(from)}Q${local(control)} ${local(to)}`,
      pathLength: '1',
      class: `comunidad-mapa-line${strong ? ' comunidad-mapa-line-strong' : ''}`,
    });
    path.style.setProperty('--line-delay', `${(i * 0.3).toFixed(1)}s`);
    svg.append(path);
  });
  return svg;
}

function buildMap() {
  const viewport = el('div', 'comunidad-mapa-viewport');
  viewport.setAttribute('aria-hidden', 'true');
  const map = el('div', 'comunidad-mapa-map');

  const img = el('img');
  img.src = `${window.hlx?.codeBasePath || ''}/blocks/comunidad-mapa/${MAP_IMAGE}`;
  img.alt = '';
  img.width = 1442;
  img.height = 492;
  img.loading = 'lazy';
  map.append(img, buildLines());

  PULSE_DOTS.forEach(({ zone, at, delay }) => {
    const wrap = el('div', `dot-wrap dot-${zone}`);
    wrap.style.setProperty('--dd', delay);
    wrap.append(el('div', 'ring-a'), el('div', 'ring-b'), el('div', 'dot-center'));
    placeDot(wrap, at);
    map.append(wrap);
  });
  STATIC_DOTS.forEach(({ zone, at, size }) => {
    const wrap = el('div', `dot-wrap dot-static dot-${zone}`);
    wrap.append(el('div', size === 'center' ? 'dot-center' : `dot-${size}`));
    placeDot(wrap, at);
    map.append(wrap);
  });

  viewport.append(map);
  return viewport;
}

/* Text content */

function buildTitle({ titulo, destacado }) {
  const title = el('h2', 'comunidad-mapa-title reveal');
  title.dataset.d = '1';
  const index = destacado ? titulo.lastIndexOf(destacado) : -1;
  if (index < 0) {
    title.textContent = titulo;
  } else {
    title.append(
      titulo.slice(0, index),
      el('span', 'comunidad-mapa-highlight', destacado),
      titulo.slice(index + destacado.length),
    );
  }
  return title;
}

function buildLiveCard() {
  const card = el('div', 'comunidad-mapa-live reveal');
  card.dataset.d = '3';
  const badge = el('p', 'comunidad-mapa-badge');
  const dot = el('span', 'comunidad-mapa-live-dot');
  dot.setAttribute('aria-hidden', 'true');
  badge.append(dot, 'EN VIVO');

  const count = el('p', 'comunidad-mapa-count is-pending', '0');
  count.setAttribute('aria-live', 'polite');
  count.setAttribute('aria-atomic', 'true');

  card.append(badge, count, el('p', 'comunidad-mapa-count-label', 'Madridistas conectados'));
  return { card, count };
}

function buildStats(config) {
  const list = el('ul', 'comunidad-mapa-stats reveal');
  list.dataset.d = '5';
  ['stat-1', 'stat-2', 'stat-3'].forEach((key, i) => {
    const [number = '', text = '', subtext = ''] = config[key].split('|').map((part) => part.trim());
    const item = el('li', 'comunidad-mapa-stat');
    const icon = el('span', 'comunidad-mapa-stat-icon');
    const svg = svgEl('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true', focusable: 'false' });
    svg.append(svgEl('path', { d: STAT_ICONS[i] }));
    icon.append(svg);
    const body = el('p', 'comunidad-mapa-stat-body');
    body.append(el('strong', 'comunidad-mapa-stat-number', number));
    if (text) body.append(el('span', 'comunidad-mapa-stat-text', text));
    if (subtext) body.append(el('span', 'comunidad-mapa-stat-subtext', subtext));
    item.append(icon, body);
    list.append(item);
  });
  return list;
}

/* Reveal on scroll */

/**
 * Adds "is-visible" to each element when it enters the viewport.
 * @param {Element[]} elements Elements to observe
 * @returns {Map<Element, Promise<void>>} Resolves when each element becomes visible
 */
function observeReveal(elements) {
  const resolvers = new Map();
  const visible = new Map(elements.map((element) => [
    element,
    new Promise((resolve) => { resolvers.set(element, resolve); }),
  ]));
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('is-visible');
      resolvers.get(entry.target)();
      observer.unobserve(entry.target);
    });
  }, { threshold: REVEAL_THRESHOLD });
  elements.forEach((element) => observer.observe(element));
  return visible;
}

export default function decorate(block) {
  const config = readConfig(block);

  const stage = el('div', 'comunidad-mapa-stage');
  const intro = el('div', 'comunidad-mapa-intro');
  const subtitle = el('p', 'comunidad-mapa-subtitle reveal', config.subtitulo);
  subtitle.dataset.d = '2';
  intro.append(buildTitle(config), subtitle);

  const { card, count } = buildLiveCard();
  const map = buildMap();
  const glow = el('div', 'comunidad-mapa-glow');
  glow.setAttribute('aria-hidden', 'true');

  const bottom = el('div', 'comunidad-mapa-bottom');
  const phrase = el('p', 'comunidad-mapa-phrase reveal', config.frase);
  phrase.dataset.d = '4';
  bottom.append(phrase, buildStats(config));

  // Mobile follows this order; on desktop the map is positioned behind the text
  stage.append(glow, intro, card, map, bottom);
  block.replaceChildren(stage);

  const revealed = observeReveal([...stage.querySelectorAll('.reveal'), map]);
  startCounter(count, revealed.get(card), config);
}
