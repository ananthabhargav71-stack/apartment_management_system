const NAV_ITEMS = [
  ['index.html', 'Dashboard'],
  ['residents.html', 'Residents'],
  ['visitors.html', 'Visitors'],
  ['visits.html', 'Visits']
];

function renderNav() {
  const current = location.pathname.split('/').pop() || 'index.html';
  const links = NAV_ITEMS.map(([href, label]) =>
    `<a href="${href}" class="${href === current ? 'active' : ''}">${label}</a>`
  ).join('');
  document.getElementById('navbar').innerHTML =
    `<div class="brand">Apartment Visitor Management</div><div class="links">${links}</div>`;
}

// talks to the backend; throws an Error with the server's message on failure
async function api(url, method = 'GET', body) {
  const opts = { method, headers: {} };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(url, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Something went wrong.');
  return data;
}

function toast(message, type = 'ok') {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.className = `${type} show`;
  clearTimeout(el._timer);
  el._timer = setTimeout(() => el.classList.remove('show'), 3000);
}

// escape text before putting it in innerHTML, so typed names can't inject HTML
function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// "2026-10-22 09:30:00" -> "22 Oct 2026, 09:30"
function fmtDate(dt) {
  if (!dt) return '-';
  const [d, t] = dt.split(' ');
  const [y, m, day] = d.split('-');
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${day} ${months[+m - 1]} ${y}, ${t.slice(0, 5)}`;
}

function badge(status) {
  return `<span class="badge ${status === 'Checked In' ? 'badge-in' : 'badge-out'}">${esc(status)}</span>`;
}

// client-side checks (the server repeats them, so don't remove those)
const isPhone = p => /^\d{10}$/.test(p);
const isEmail = e => !e || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

document.addEventListener('DOMContentLoaded', renderNav);