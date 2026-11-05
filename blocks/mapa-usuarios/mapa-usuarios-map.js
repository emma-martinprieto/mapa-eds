import ALPHA2_TO_NUMERIC from './country-codes.js';

const D3_GEO_URL = 'https://cdn.jsdelivr.net/npm/d3-geo@3.1.1/+esm';
const TOPOJSON_CLIENT_URL = 'https://cdn.jsdelivr.net/npm/topojson-client@3.1.0/+esm';
const WORLD_ATLAS_URL = 'https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-50m.json';

const SVG_NS = 'http://www.w3.org/2000/svg';
const MAP_WIDTH = 960;
const ANTARCTICA_ID = '010';
const TOOLTIP_GAP = 12;

const NUMERIC_TO_ALPHA2 = Object.fromEntries(
  Object.entries(ALPHA2_TO_NUMERIC).map(([alpha2, numeric]) => [numeric, alpha2]),
);
// Kosovo has no ISO numeric code, so the source leaves its id empty and only its name identifies it
const ALPHA2_BY_SOURCE_NAME = { Kosovo: 'XK' };

function getAlpha2(feature) {
  return NUMERIC_TO_ALPHA2[feature.id] || ALPHA2_BY_SOURCE_NAME[feature.properties.name];
}

async function fetchTopology() {
  const resp = await fetch(WORLD_ATLAS_URL);
  if (!resp.ok) throw new Error(`World atlas: HTTP ${resp.status}`);
  return resp.json();
}

/**
 * Adds the hover, touch and keyboard behaviour shared by all the countries.
 * @param {Element} canvas Positioned element holding the map
 * @param {SVGSVGElement} svg The map
 * @param {WeakMap<Element, {name: string, detail: string}>} countries Tooltip content per path
 */
function addInteraction(canvas, svg, countries) {
  const tooltip = document.createElement('div');
  tooltip.className = 'mapa-usuarios-tooltip';
  tooltip.setAttribute('aria-hidden', 'true');
  tooltip.hidden = true;
  const name = document.createElement('strong');
  const detail = document.createElement('span');
  tooltip.append(name, detail);
  canvas.append(tooltip);

  const highlight = document.createElementNS(SVG_NS, 'path');
  highlight.setAttribute('class', 'mapa-usuarios-highlight');
  svg.append(highlight);

  const hide = () => {
    tooltip.hidden = true;
    highlight.removeAttribute('d');
  };

  const show = (path, clientX, clientY) => {
    const country = countries.get(path);
    name.textContent = country.name;
    detail.textContent = country.detail;
    highlight.setAttribute('d', path.getAttribute('d'));
    tooltip.hidden = false;

    const bounds = canvas.getBoundingClientRect();
    const halfWidth = tooltip.offsetWidth / 2;
    const x = clientX - bounds.left;
    const y = clientY - bounds.top;
    const fitsAbove = y >= tooltip.offsetHeight + TOOLTIP_GAP;
    tooltip.style.left = `${Math.max(halfWidth, Math.min(bounds.width - halfWidth, x))}px`;
    tooltip.style.top = `${fitsAbove ? y - tooltip.offsetHeight - TOOLTIP_GAP : y + TOOLTIP_GAP}px`;
  };

  // Touch has no hover: it uses click, which fires on a tap but not while scrolling the page
  svg.addEventListener('pointermove', (event) => {
    if (event.pointerType === 'touch') return;
    if (countries.has(event.target)) show(event.target, event.clientX, event.clientY);
    else hide();
  });
  svg.addEventListener('pointerleave', (event) => {
    if (event.pointerType !== 'touch') hide();
  });
  document.addEventListener('click', (event) => {
    if (countries.has(event.target)) show(event.target, event.clientX, event.clientY);
    else hide();
  });

  svg.addEventListener('focusin', (event) => {
    if (!event.target.matches(':focus-visible')) return;
    const { left, top, width } = event.target.getBoundingClientRect();
    show(event.target, left + width / 2, top);
  });
  svg.addEventListener('focusout', hide);
  svg.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') hide();
  });
}

/**
 * Draws the world map inside the canvas, once. New data goes through the returned function, so
 * refreshing the data neither downloads the map again nor adds more listeners.
 * @param {Element} canvas Element that receives the map
 * @returns {Promise<function(object): string[]>} Paints the map with its options:
 *   values (Map of active users per alpha-2 code), getStep (color step for a value),
 *   getCountryName (translated name for an alpha-2 code) and formatNumber. It returns the
 *   alpha-2 codes with data that have no shape on the map.
 */
export default async function renderMap(canvas) {
  const [{ geoEqualEarth, geoPath }, { feature }, topology] = await Promise.all([
    import(D3_GEO_URL),
    import(TOPOJSON_CLIENT_URL),
    fetchTopology(),
  ]);

  const features = feature(topology, topology.objects.countries).features
    .filter(({ id }) => id !== ANTARCTICA_ID);
  const collection = { type: 'FeatureCollection', features };
  const path = geoPath(geoEqualEarth().fitWidth(MAP_WIDTH, collection)).digits(1);
  const height = Math.ceil(path.bounds(collection)[1][1]);

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${MAP_WIDTH} ${height}`);
  svg.setAttribute('role', 'group');
  svg.setAttribute('aria-label', 'Mapamundi de usuarios activos por país');

  const countries = new WeakMap();
  const shapes = [];

  features.forEach((country) => {
    const d = path(country);
    if (!d) return;

    const shape = document.createElementNS(SVG_NS, 'path');
    shape.setAttribute('d', d);
    shapes.push({ shape, code: getAlpha2(country), sourceName: country.properties.name });
    svg.append(shape);
  });

  canvas.replaceChildren(svg);

  const update = ({
    values, getStep, getCountryName, formatNumber,
  }) => {
    const drawn = new Set();

    shapes.forEach(({ shape, code, sourceName }) => {
      const countryName = code ? getCountryName(code) : sourceName;
      const hasData = values.has(code);

      countries.set(shape, {
        name: countryName,
        detail: hasData ? `Usuarios activos: ${formatNumber(values.get(code))}` : 'Sin datos',
      });

      if (hasData) {
        drawn.add(code);
        const step = getStep(values.get(code));
        shape.setAttribute('class', `mapa-usuarios-country mapa-usuarios-step-${step}`);
        shape.setAttribute('role', 'img');
        shape.setAttribute('aria-label', `${countryName}: ${formatNumber(values.get(code))} usuarios activos`);
        shape.setAttribute('tabindex', '0');
        shape.removeAttribute('aria-hidden');
      } else {
        shape.setAttribute('class', 'mapa-usuarios-country');
        shape.setAttribute('aria-hidden', 'true');
        shape.removeAttribute('role');
        shape.removeAttribute('aria-label');
        shape.removeAttribute('tabindex');
      }
    });

    return [...values.keys()].filter((code) => !drawn.has(code));
  };

  addInteraction(canvas, svg, countries);

  return update;
}
