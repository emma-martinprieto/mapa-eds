/*
 * comunidad-mapa "datos" mode: one point per country of the ranking. The first four pulse
 * (ring-a + ring-b + dot-center), the rest are static. Each point is a button with a tooltip
 * (country name and active users); lines go from Madrid to the first countries of the ranking.
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
const RESIZE_DELAY = 200;

/* Line curves */

// Candidate curvatures, as a fraction of the line length, in order of preference.
// Negative bends towards the top of the map (like flight routes), positive towards the bottom.
const CURVE_BENDS = [-0.18, 0.18, -0.1, 0.1, -0.28, 0.28];
const CURVE_SAMPLES = 24;
// Lines share their start (Madrid): crossings that close to it do not count
const CROSSING_START = 0.15;
// Space kept around the live card and the title, in pixels
const OBSTACLE_MARGIN = 12;

const quadPoint = (from, control, to, t) => {
  const u = 1 - t;
  return [0, 1].map((k) => u * u * from[k] + 2 * u * t * control[k] + t * t * to[k]);
};

const sampleCurve = (from, control, to) => Array.from(
  { length: CURVE_SAMPLES + 1 },
  (_, i) => quadPoint(from, control, to, i / CURVE_SAMPLES),
);

const orientation = (a, b, c) => Math.sign(
  (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]),
);
const segmentsCross = (a, b, c, d) => orientation(a, b, c) !== orientation(a, b, d)
  && orientation(c, d, a) !== orientation(c, d, b);

function countCrossings(first, second) {
  const start = Math.ceil(CURVE_SAMPLES * CROSSING_START);
  let crossings = 0;
  for (let i = start; i < first.length - 1; i += 1) {
    for (let j = start; j < second.length - 1; j += 1) {
      if (segmentsCross(first[i], first[i + 1], second[j], second[j + 1])) crossings += 1;
    }
  }
  return crossings;
}

/**
 * Chooses the curve of a line: the preferred curvature that does not run under the obstacles
 * and crosses the fewest of the lines already drawn.
 * @param {number[]} from Start, in line-layer units
 * @param {number[]} to End, in line-layer units
 * @param {{x0: number, x1: number, y0: number, y1: number}[]} obstacles Boxes to avoid
 * @param {number[][][]} others Sampled curves of the other lines
 * @returns {{control: number[], points: number[][]}} Control point and sampled curve
 */
function chooseCurve(from, to, obstacles, others) {
  const length = Math.hypot(to[0] - from[0], to[1] - from[1]) || 1;
  // Unit normal pointing to the bottom of the map
  let nx = -(to[1] - from[1]) / length;
  let ny = (to[0] - from[0]) / length;
  if (ny < 0) { nx = -nx; ny = -ny; }

  let best = null;
  CURVE_BENDS.forEach((bend, preference) => {
    const control = [
      (from[0] + to[0]) / 2 + nx * bend * length,
      (from[1] + to[1]) / 2 + ny * bend * length,
    ];
    const points = sampleCurve(from, control, to);
    const hidden = points.filter(([x, y]) => obstacles
      .some((box) => x >= box.x0 && x <= box.x1 && y >= box.y0 && y <= box.y1)).length;
    const crossings = others.reduce((total, other) => total + countCrossings(points, other), 0);
    const score = hidden * 100 + crossings * 10 + preference;
    if (!best || score < best.score) best = { score, control, points };
  });
  return best;
}

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
 * @param {number} parts.maxLines Maximum number of lines from Madrid
 * @param {{element: Element, text: boolean}[]} parts.obstacles What the lines must not run
 *   under: the element's box, or only its text when text is true
 * @returns {{update: function(object[]): number}} Updates the points; returns how many it shows
 */
export default function createPoints({
  viewport, map, lines, maxPoints, maxLines, obstacles,
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

  /* Lines from Madrid to the first countries of the ranking (Spain excluded) */
  const { width: boxWidth, height: boxHeight } = lines.viewBox.baseVal;
  const toBox = ([x, y]) => [(x / 100) * boxWidth, (y / 100) * boxHeight];
  const origin = toBox(toMapPercent(...MADRID, false));
  const linesByCode = new Map();

  // Obstacles in line-layer units, from their current place on screen. Text obstacles use the
  // box of each line of text, not the element, which has empty space around the words.
  const obstacleRects = ({ element, text }) => {
    if (!text) return [element.getBoundingClientRect()];
    const range = document.createRange();
    range.selectNodeContents(element);
    return [...range.getClientRects()];
  };
  const obstacleBoxes = () => {
    const area = map.getBoundingClientRect();
    if (!area.width || !area.height) return [];
    const sx = boxWidth / area.width;
    const sy = boxHeight / area.height;
    return obstacles.flatMap(obstacleRects)
      .filter((rect) => rect.width && rect.height)
      .map((rect) => ({
        x0: (rect.left - area.left - OBSTACLE_MARGIN) * sx,
        x1: (rect.right - area.left + OBSTACLE_MARGIN) * sx,
        y0: (rect.top - area.top - OBSTACLE_MARGIN) * sy,
        y1: (rect.bottom - area.top + OBSTACLE_MARGIN) * sy,
      }));
  };

  const drawCurve = (line, boxes, others) => {
    const to = toBox(line.entry.position);
    const { control, points: curve } = chooseCurve(origin, to, boxes, others);
    const f = (v) => v.toFixed(1);
    line.path.setAttribute('d', `M${f(origin[0])} ${f(origin[1])}Q${f(control[0])} ${f(control[1])} ${f(to[0])} ${f(to[1])}`);
    line.curve = curve;
  };

  const updateLines = (ranking) => {
    const targets = ranking.filter(({ code }) => code !== 'ES').slice(0, maxLines);
    const wanted = new Set(targets.map(({ code }) => code));
    linesByCode.forEach((line, code) => {
      if (wanted.has(code)) return;
      fadeOut(line.path);
      linesByCode.delete(code);
    });

    // Lines that stay keep their curve; new ones avoid them, the card and the title
    const boxes = obstacleBoxes();
    const added = [];
    targets.forEach((entry, i) => {
      let line = linesByCode.get(entry.code);
      if (!line) {
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('pathLength', '1');
        path.setAttribute('class', 'comunidad-mapa-line is-new');
        path.style.setProperty('--line-delay', `${(added.length * LINE_STAGGER).toFixed(1)}s`);
        line = { path, entry };
        drawCurve(line, boxes, [...linesByCode.values()].map(({ curve }) => curve));
        linesByCode.set(entry.code, line);
        lines.append(path);
        added.push(path);
      }
      line.path.classList.toggle('comunidad-mapa-line-strong', i === 0);
    });
    nextFrame(() => added.forEach((path) => path.classList.remove('is-new')));
  };

  // The card and the title move with the layout: choose the curves again, without redrawing
  let resizeTimer = 0;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      const boxes = obstacleBoxes();
      const done = [];
      linesByCode.forEach((line) => {
        drawCurve(line, boxes, done.map(({ curve }) => curve));
        done.push(line);
      });
    }, RESIZE_DELAY);
  });

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
