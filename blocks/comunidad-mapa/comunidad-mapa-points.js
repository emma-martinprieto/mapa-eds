/*
 * comunidad-mapa "datos" mode: one point per country of the ranking. The first four pulse
 * (ring-a + ring-b + dot-center), the rest are static. Each point is a button with a tooltip
 * (country name and active users); lines go from Madrid to the pulsing countries.
 */
import { countryPosition, toMapPercent } from './comunidad-mapa-geo.js';

const PULSE_COUNT = 4;
const PULSE_DELAYS = [0, 1.75, 3.5, 5.25];
const PULSE_CYCLE = 7;
const FADE_DURATION = 400;
const LINE_STAGGER = 0.3;
const MADRID = [40.4, -3.7];
const TOOLTIP_GAP = 8;
const EDGE_GAP = 4;

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const formatUsers = (value) => Math.round(value).toLocaleString('es-ES');

function el(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text) element.textContent = text;
  return element;
}

function nextFrame(callback) {
  requestAnimationFrame(() => requestAnimationFrame(callback));
}

function fadeOut(element) {
  element.classList.add('is-leaving');
  element.setAttribute('aria-hidden', 'true');
  element.setAttribute('tabindex', '-1');
  setTimeout(() => element.remove(), reducedMotion() ? 0 : FADE_DURATION);
}

/**
 * Countries by active users, highest first, limited to those that can be placed on the map.
 * Rows of the same country are added up.
 * @param {object[]} rows Rows with country (ISO alpha-2) and active_users
 * @param {number} maxPoints Maximum number of points
 * @returns {{code: string, value: number, position: number[], pulse: boolean, delay: number}[]}
 */
function rank(rows, maxPoints) {
  const totals = new Map();
  rows.forEach((row) => {
    const code = String((row && row.country) || '').trim().toUpperCase();
    const value = Number(row && row.active_users);
    if (!/^[A-Z]{2}$/.test(code) || !Number.isFinite(value) || value <= 0) return;
    totals.set(code, (totals.get(code) || 0) + value);
  });
  return [...totals]
    .sort((a, b) => b[1] - a[1])
    .map(([code, value]) => ({ code, value, position: countryPosition(code) }))
    .filter(({ position }) => position)
    .slice(0, maxPoints)
    .map((entry, i) => ({
      ...entry,
      pulse: i < PULSE_COUNT,
      delay: i < PULSE_COUNT ? PULSE_DELAYS[i] : null,
    }));
}

/**
 * Creates the "datos" mode controller.
 * @param {object} parts Map parts
 * @param {Element} parts.viewport Map viewport (holds the tooltip)
 * @param {Element} parts.map Map element (holds the points)
 * @param {SVGSVGElement} parts.lines Lines layer
 * @param {number} parts.maxPoints Maximum number of points
 * @returns {{update: function(object[]): number}} Updates the points; returns how many it shows
 */
export default function createPoints({
  viewport, map, lines, maxPoints,
}) {
  const startTime = performance.now();
  const lang = document.documentElement.lang || 'es';
  let displayNames = null;
  try {
    displayNames = new Intl.DisplayNames([lang, 'es'], { type: 'region' });
  } catch {
    // Without Intl.DisplayNames the code is shown
  }
  const nameOf = (code) => {
    try {
      return (displayNames && displayNames.of(code)) || code;
    } catch {
      return code;
    }
  };

  const points = new Map();
  let linesKey = '';
  let active = null;

  /* Tooltip */
  const tooltip = el('div', 'comunidad-mapa-tooltip');
  tooltip.setAttribute('aria-hidden', 'true');
  tooltip.hidden = true;
  const tooltipName = el('strong');
  const tooltipValue = el('span');
  tooltip.append(tooltipName, tooltipValue);
  viewport.append(tooltip);

  const hide = () => {
    tooltip.hidden = true;
    active = null;
  };

  const show = (button) => {
    const point = points.get(button.dataset.code);
    if (!point || point.button !== button) return;
    active = button;
    tooltipName.textContent = nameOf(point.entry.code);
    tooltipValue.textContent = `${formatUsers(point.entry.value)} usuarios activos`;
    tooltip.hidden = false;

    const area = viewport.getBoundingClientRect();
    const dot = button.getBoundingClientRect();
    const half = tooltip.offsetWidth / 2;
    const x = dot.left + dot.width / 2 - area.left;
    const above = dot.top - area.top - tooltip.offsetHeight - TOOLTIP_GAP;
    const top = above >= 0 ? above : dot.bottom - area.top + TOOLTIP_GAP;
    const left = Math.min(Math.max(x, half + EDGE_GAP), area.width - half - EDGE_GAP);
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
  };

  const pointOf = (target) => (target instanceof Element
    ? target.closest('.comunidad-mapa-point')
    : null);
  map.addEventListener('pointerover', (event) => {
    const button = pointOf(event.target);
    if (button && event.pointerType !== 'touch') show(button);
  });
  map.addEventListener('pointerout', (event) => {
    const button = pointOf(event.target);
    const leftPoint = button && !button.contains(event.relatedTarget);
    if (leftPoint && document.activeElement !== button) hide();
  });
  map.addEventListener('focusin', (event) => {
    const button = pointOf(event.target);
    if (button) show(button);
  });
  map.addEventListener('focusout', hide);
  map.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') hide();
  });
  // Touch: a tap shows the tooltip; a tap anywhere else hides it
  document.addEventListener('click', (event) => {
    const button = pointOf(event.target);
    if (button && map.contains(button)) show(button);
    else if (active) hide();
  });

  /* Points */

  // Pulses keep the 1.75 s stagger between them even when they appear at different times
  const phase = (delay) => {
    const elapsed = (performance.now() - startTime) / 1000;
    return `${((((delay - elapsed) % PULSE_CYCLE) + PULSE_CYCLE) % PULSE_CYCLE) - PULSE_CYCLE}s`;
  };

  const label = (button, { code, value }) => {
    button.setAttribute('aria-label', `${nameOf(code)}: ${formatUsers(value)} usuarios activos`);
  };

  const createPoint = (entry) => {
    const button = el('button', `comunidad-mapa-point${entry.pulse ? ' is-pulse' : ''} is-entering`);
    button.type = 'button';
    button.dataset.code = entry.code;
    button.style.left = `${entry.position[0].toFixed(2)}%`;
    button.style.top = `${entry.position[1].toFixed(2)}%`;
    label(button, entry);

    const wrap = el('span', `dot-wrap${entry.pulse ? '' : ' dot-static'}`);
    wrap.setAttribute('aria-hidden', 'true');
    if (entry.pulse) {
      wrap.style.setProperty('--dd', phase(entry.delay));
      wrap.append(el('span', 'ring-a'), el('span', 'ring-b'));
    }
    wrap.append(el('span', 'dot-center'));
    button.append(wrap);
    return button;
  };

  /* Lines from Madrid to the pulsing countries */
  const updateLines = (ranking) => {
    const targets = ranking.filter(({ pulse, code }) => pulse && code !== 'ES');
    const key = targets.map(({ code }) => code).join(',');
    if (key === linesKey) return;
    linesKey = key;

    lines.querySelectorAll('.comunidad-mapa-line').forEach(fadeOut);
    const { width, height } = lines.viewBox.baseVal;
    const toBox = ([x, y]) => [(x / 100) * width, (y / 100) * height];
    const [x1, y1] = toBox(toMapPercent(...MADRID, false));
    const added = targets.map(({ position }, i) => {
      const [x2, y2] = toBox(position);
      const lift = Math.hypot(x2 - x1, y2 - y1) * 0.2;
      const cx = (x1 + x2) / 2;
      const cy = Math.min(y1, y2) - lift;
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', `M${x1.toFixed(1)} ${y1.toFixed(1)}Q${cx.toFixed(1)} ${cy.toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)}`);
      path.setAttribute('pathLength', '1');
      path.setAttribute('class', `comunidad-mapa-line is-new${i === 0 ? ' comunidad-mapa-line-strong' : ''}`);
      path.style.setProperty('--line-delay', `${(i * LINE_STAGGER).toFixed(1)}s`);
      lines.append(path);
      return path;
    });
    nextFrame(() => added.forEach((path) => path.classList.remove('is-new')));
  };

  return {
    update(rows) {
      const ranking = rank(rows, maxPoints);
      if (!ranking.length) return 0;

      // The design's dots, shown while there was no data
      map.querySelectorAll('.is-fallback').forEach(fadeOut);
      lines.querySelectorAll('.is-fallback').forEach((line) => line.remove());

      const next = new Map(ranking.map((entry) => [entry.code, entry]));
      points.forEach((point, code) => {
        const entry = next.get(code);
        if (entry && entry.pulse === point.entry.pulse && entry.delay === point.entry.delay) return;
        if (active === point.button) hide();
        fadeOut(point.button);
        points.delete(code);
      });

      const added = [];
      ranking.forEach((entry) => {
        const point = points.get(entry.code);
        if (point) {
          point.entry = entry;
          label(point.button, entry);
          if (active === point.button) show(point.button);
          return;
        }
        const button = createPoint(entry);
        points.set(entry.code, { button, entry });
        map.append(button);
        added.push(button);
      });
      nextFrame(() => added.forEach((button) => button.classList.remove('is-entering')));

      updateLines(ranking);
      return ranking.length;
    },
  };
}
