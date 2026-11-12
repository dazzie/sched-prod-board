import { fetchIncidents, ack } from './api.js';

const REFRESH_MS = 2000; // R4

const board = document.querySelector('[data-testid="board"]');
const list = document.querySelector('[data-testid="incident-list"]');
const status = document.querySelector('.status');

const rows = new Map(); // incident id -> its <li>, kept across refreshes
const acked = new Map(); // incident id -> { id, ackedAt, receipt }

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
  const mark = el('span', { 'data-testid': 'acked', class: 'acked', title: `acked ${reply.ackedAt}` });
  mark.textContent = `acked ${clockFormat.format(new Date(reply.ackedAt))}`;
  return mark;
}

async function onAck(id, button) {
  button.disabled = true;
  button.textContent = 'Acking…';
  try {
    const reply = await ack(id); // R2
    acked.set(id, reply);
    rows.get(id)?.classList.add('is-acked');
    button.replaceWith(ackedMark(reply));
  } catch (error) {
    console.error(error);
    button.disabled = false;
    button.textContent = 'Ack';
    button.title = `Ack failed: ${error.message}`;
    button.classList.add('failed');
  }
}

function buildRow(incident) {
  const row = el('li', { 'data-testid': 'incident-row', 'data-id': incident.id });
  row.append(
    el('span', { class: 'id' }, incident.id),
    el('span', { class: 'sev' }),
    el('span', { class: 'what' }),
    el('time'),
  );
  const button = el('button', { 'data-testid': 'ack', type: 'button', class: 'ack' }, 'Ack');
  button.addEventListener('click', () => onAck(incident.id, button));
  row.append(button);
  return row;
}

function fillRow(row, incident) {
  row.className = `row ${incident.severity}${acked.has(incident.id) ? ' is-acked' : ''}`;
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
    let row = rows.get(incident.id);
    if (!row) {
      row = buildRow(incident);
      rows.set(incident.id, row);
    }
    fillRow(row, incident);
    if (list.children[index] !== row) list.insertBefore(row, list.children[index] ?? null); // R1
  });

  const empty = board.querySelector('[data-testid="empty"]');
  if (incidents.length === 0 && !empty) {
    board.append(el('p', { 'data-testid': 'empty', class: 'empty' }, 'No incidents tonight.'));
  } else if (incidents.length > 0) {
    empty?.remove();
  }
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
