import { fetchIncidents, ack } from './api.js';

const REFRESH_MS = 2000; // R4

const list = document.querySelector('[data-testid="incident-list"]');
const panel = document.querySelector('[data-testid="incident-panel"]');
const panelHint = document.querySelector('.panel-hint');
const status = document.querySelector('.status');

const rows = new Map(); // incident id -> its <li>, kept across refreshes
const known = new Map(); // incident id -> the incident as the API last gave it
const acked = new Map(); // incident id -> { id, ackedAt, receipt }
const failed = new Map(); // incident id -> why its last ack failed
const acking = new Set(); // incident ids with an ack on its way
let openId = null; // the incident the panel shows

// R5: the viewer's own locale decides the order (dd/mm or mm/dd), the viewer's own zone decides the time.
const locales = navigator.languages?.length ? [...navigator.languages] : undefined;
const timeFormat = new Intl.DateTimeFormat(locales, {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  timeZoneName: 'short',
});
const clockFormat = new Intl.DateTimeFormat(locales, { hour: '2-digit', minute: '2-digit', second: '2-digit' });

function localTime(iso) {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : timeFormat.format(date);
}

function el(tag, props = {}, text) {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(props)) node.setAttribute(name, value);
  if (text !== undefined) node.textContent = text;
  return node;
}

function ackedMark(reply) {
  return el('span', { 'data-testid': 'acked', class: 'acked', title: `acked ${reply.ackedAt}` }, `acked ${clockFormat.format(new Date(reply.ackedAt))}`);
}

// --- the incident panel (R2) --------------------------------------------------------------------------
// The panel is tied to an incident id, not to a place in the list. Its Ack sends the id the panel names,
// so a list that moves cannot change which incident gets the ack.

function renderPanel() {
  const incident = openId ? known.get(openId) : null;
  panel.hidden = !incident;
  panelHint.hidden = Boolean(incident);
  for (const [id, row] of rows) {
    if (id === openId) row.setAttribute('aria-current', 'true');
    else row.removeAttribute('aria-current');
  }
  if (!incident) return;

  const reply = acked.get(incident.id);
  const time = el('time', { datetime: incident.openedAt }, localTime(incident.openedAt));
  const opened = el('p', { class: 'panel-opened' }, 'opened ');
  opened.append(time);
  const close = el('button', { type: 'button', class: 'panel-close', 'aria-label': 'Close the panel' }, '×');
  close.addEventListener('click', () => openPanel(null));

  panel.dataset.id = incident.id;
  panel.replaceChildren(
    close,
    el('h2', { class: 'panel-id' }, incident.id),
    el('p', { class: `panel-sev ${incident.severity}` }, incident.severity),
    el('p', { class: 'panel-what' }, `${incident.service} · ${incident.region}`),
    el('p', { class: 'panel-summary' }, incident.summary),
    opened,
  );

  if (reply) {
    panel.append(ackedMark(reply));
  } else {
    const busy = acking.has(incident.id);
    const button = el('button', { 'data-testid': 'panel-ack', type: 'button', class: 'ack' }, busy ? `Acking ${incident.id}…` : `Ack ${incident.id}`);
    button.disabled = busy;
    button.addEventListener('click', () => onAck(incident.id));
    panel.append(button);
    if (failed.has(incident.id)) panel.append(el('p', { class: 'panel-error', role: 'alert' }, `Ack failed: ${failed.get(incident.id)}`));
  }
}

function openPanel(id) {
  openId = id;
  renderPanel();
}

async function onAck(id) {
  if (acking.has(id) || acked.has(id)) return;
  acking.add(id);
  failed.delete(id);
  renderPanel();
  try {
    const reply = await ack(id); // R2: the id the panel names
    acked.set(id, reply);
    const row = rows.get(id);
    if (row && !row.querySelector('[data-testid="acked"]')) {
      row.classList.add('is-acked');
      row.append(ackedMark(reply));
    }
  } catch (error) {
    console.error(error);
    failed.set(id, error.message);
  } finally {
    acking.delete(id);
    renderPanel();
  }
}

// --- the list (R1) ------------------------------------------------------------------------------------

function buildRow(incident) {
  // A row has no Ack of its own. It opens the panel for its incident (click, Enter or Space).
  const row = el('li', { 'data-testid': 'incident-row', 'data-id': incident.id, tabindex: '0', role: 'button' });
  row.append(el('span', { class: 'id' }, incident.id), el('span', { class: 'sev' }), el('span', { class: 'what' }), el('time'));
  row.addEventListener('click', () => openPanel(incident.id));
  row.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    openPanel(incident.id);
  });
  return row;
}

function fillRow(row, incident) {
  row.className = `row ${incident.severity}${acked.has(incident.id) ? ' is-acked' : ''}`;
  row.setAttribute('aria-label', `Open ${incident.id}`);
  row.querySelector('.sev').textContent = incident.severity;
  row.querySelector('.what').textContent = `${incident.service} · ${incident.region} · ${incident.summary}`;
  const time = row.querySelector('time');
  time.setAttribute('datetime', incident.openedAt); // the full UTC value stays here
  time.textContent = localTime(incident.openedAt);
}

/** Puts the list in the API's order (newest first), keeping the rows that are already on screen. */
function render(incidents) {
  document.querySelector('[data-testid="loader"]')?.remove(); // R3

  const current = new Set(incidents.map((incident) => incident.id));
  for (const [id, row] of rows) {
    if (!current.has(id)) {
      row.remove();
      rows.delete(id);
    }
  }

  incidents.forEach((incident, index) => {
    known.set(incident.id, incident);
    let row = rows.get(incident.id);
    if (!row) {
      row = buildRow(incident);
      rows.set(incident.id, row);
    }
    fillRow(row, incident);
    if (list.children[index] !== row) list.insertBefore(row, list.children[index] ?? null); // R1: live, at the top
  });

  const empty = document.querySelector('[data-testid="empty"]');
  if (incidents.length === 0 && !empty) {
    list.after(el('p', { 'data-testid': 'empty', class: 'empty' }, 'No incidents tonight.'));
  } else if (incidents.length > 0) {
    empty?.remove();
  }

  refreshPanelText();
}

// A refresh updates the panel's text in place. It never replaces the panel's Ack button, so a press and
// its release always land on the same button.
function refreshPanelText() {
  const incident = openId ? known.get(openId) : null;
  if (!incident || panel.hidden) return;
  panel.querySelector('.panel-sev').className = `panel-sev ${incident.severity}`;
  panel.querySelector('.panel-sev').textContent = incident.severity;
  panel.querySelector('.panel-what').textContent = `${incident.service} · ${incident.region}`;
  panel.querySelector('.panel-summary').textContent = incident.summary;
  const time = panel.querySelector('time');
  time.setAttribute('datetime', incident.openedAt);
  time.textContent = localTime(incident.openedAt);
}

async function refresh() {
  try {
    const page = await fetchIncidents();
    render(page.incidents);
    status.textContent = `· updated ${clockFormat.format(new Date(page.updatedAt))}`;
    status.classList.remove('stale');
  } catch (error) {
    console.error(error);
    const loader = document.querySelector('[data-testid="loader"]');
    if (loader) loader.textContent = 'Loading incidents… (the incident API did not answer; retrying)';
    status.textContent = '· refresh failed; retrying';
    status.classList.add('stale');
  } finally {
    setTimeout(refresh, REFRESH_MS); // R4: the next refresh starts 2 s after this one ends, so they never overlap
  }
}

refresh();
