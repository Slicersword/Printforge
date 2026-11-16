// Send to printer: upload the G-code that is open in G-code preview to OctoPrint or Klipper (Moonraker),
// and optionally start the print. Talks straight to the printer on your network; nothing goes through a server.
import { h, row } from './ui.js';

const KEY = 'printforge.printer';
const load = () => { for (const st of [sessionStorage, localStorage]) { try { const v = JSON.parse(st.getItem(KEY) || 'null'); if (v) return v; } catch { /* ignore */ } } return { type: 'moonraker', host: '', key: '', remember: false }; };
const save = (c) => {
  // The API key is only kept for this tab unless you tick "Remember on this computer".
  try { sessionStorage.setItem(KEY, JSON.stringify(c)); if (c.remember) localStorage.setItem(KEY, JSON.stringify(c)); else localStorage.removeItem(KEY); } catch { /* storage unavailable */ }
};
const base = (host) => { let h2 = host.trim().replace(/\/+$/, ''); if (!/^https?:\/\//i.test(h2)) h2 = `http://${h2}`; return h2; };
/** A page served over https can't call an http:// address (browsers block "mixed content"). */
export const blockedByHttps = (host) => location.protocol === 'https:' && base(host).startsWith('http://') && !/^http:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(base(host));

async function call(c, path, opts = {}) {
  const headers = { ...(opts.headers || {}) }; if (c.key) headers['X-Api-Key'] = c.key;
  let res;
  try { res = await fetch(base(c.host) + path, { ...opts, headers, mode: 'cors' }); }
  catch {
    if (blockedByHttps(c.host)) throw new Error('mixed');
    throw new Error(`The printer didn’t answer at ${base(c.host)}. Check the address, that this device is on the same network, and that ${c.type === 'octoprint' ? 'OctoPrint allows CORS (Settings → API → Allow Cross Origin Resource Sharing)' : 'Moonraker lists this site in cors_domains (moonraker.conf)'}.`);
  }
  if (res.status === 401 || res.status === 403) throw new Error('The printer refused the API key. Check it and try again.');
  if (!res.ok) throw new Error(`The printer answered with an error (HTTP ${res.status}).`);
  return res.json().catch(() => ({}));
}
export async function testPrinter(c) {
  if (c.type === 'octoprint') { const v = await call(c, '/api/version'); return `OctoPrint ${v.server || ''}`.trim(); }
  const v = await call(c, '/server/info'); return `Klipper (Moonraker) ${v.result?.klippy_state ? `· ${v.result.klippy_state}` : ''}`.trim();
}
export async function sendToPrinter(c, name, text, start) {
  const fd = new FormData(); const file = new File([text], name.replace(/\.gcode\.3mf$|\.3mf$/i, '.gcode'), { type: 'text/x.gcode' });
  if (c.type === 'octoprint') { fd.append('file', file); fd.append('select', 'true'); fd.append('print', String(!!start)); return call(c, '/api/files/local', { method: 'POST', body: fd }); }
  fd.append('file', file); fd.append('root', 'gcodes'); fd.append('print', String(!!start)); return call(c, '/server/files/upload', { method: 'POST', body: fd });
}

export function openPrinterDialog(app) {
  const g = app.gcode; const c = load(); const status = h('p', { class: 'note pl-status', role: 'status' });
  const setStatus = (t, kind = '') => { status.className = `note pl-status ${kind}`; status.replaceChildren(...(Array.isArray(t) ? t : [t])); };
  const mixedHelp = () => [h('b', {}, 'Your browser blocks this connection. '), 'PrintForge is on a secure (https) page and your printer uses plain http, which browsers don’t allow together. Options: ',
    h('br'), '• Download the G-code and upload it on the printer’s own page (button below).', h('br'), '• Or run PrintForge from your own computer (open it at http://localhost), where sending works.', h('br'), '• Or give the printer an https address (for example through a reverse proxy).'];
  const fields = h('div', { class: 'maker-side' },
    row('Printer software', h('select', { onchange: (e) => { c.type = e.target.value; render(); } }, h('option', { value: 'moonraker', selected: c.type === 'moonraker' }, 'Klipper (Moonraker, Mainsail, Fluidd)'), h('option', { value: 'octoprint', selected: c.type === 'octoprint' }, 'OctoPrint'))),
    row('Printer address', h('input', { type: 'text', value: c.host, placeholder: '192.168.1.50 or printer.local', onkeydown: (e) => e.stopPropagation(), oninput: (e) => { c.host = e.target.value; } })),
    row('API key', h('input', { type: 'password', value: c.key, autocomplete: 'off', placeholder: '', onkeydown: (e) => e.stopPropagation(), oninput: (e) => { c.key = e.target.value; } })),
    h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: c.remember, onchange: (e) => { c.remember = e.target.checked; } }), 'Remember on this computer (otherwise only for this tab)'));
  const hint = h('p', { class: 'note' });
  const render = () => { hint.textContent = c.type === 'octoprint' ? 'OctoPrint: the API key is under Settings → Application Keys (or API). Turn on “Allow Cross Origin Resource Sharing” in Settings → API.' : 'Moonraker: an API key is only needed if you turned on authorization. Add this site to cors_domains in moonraker.conf.'; };
  render();
  const guard = () => { if (!c.host.trim()) { setStatus('Type the printer’s address first.', 'bad'); return false; } save(c); if (blockedByHttps(c.host)) { setStatus(mixedHelp(), 'bad'); return false; } return true; };
  const test = async () => { if (!guard()) return; setStatus('Connecting…'); try { setStatus(`Connected: ${await testPrinter(c)}.`, 'ok'); } catch (e) { setStatus(e.message === 'mixed' ? mixedHelp() : e.message, 'bad'); } };
  const send = async (start) => {
    if (!g?.text) { setStatus('Open a sliced G-code file in G-code preview first.', 'bad'); return; }
    if (!guard()) return;
    if (start && !window.confirm(`Start printing “${g.name}” on ${base(c.host)} now? Check the plate is clear first.`)) return;
    setStatus(start ? 'Sending and starting the print…' : 'Sending…');
    try { await sendToPrinter(c, g.name, g.text, start); setStatus(start ? `Sent ${g.name}. The printer is starting.` : `Sent ${g.name} to the printer. Start it from the printer’s page when ready.`, 'ok'); }
    catch (e) { setStatus(e.message === 'mixed' ? mixedHelp() : e.message, 'bad'); }
  };
  const download = () => { if (!g?.text) return; const a = h('a', { href: URL.createObjectURL(new Blob([g.text], { type: 'text/plain' })), download: g.name.replace(/\.gcode\.3mf$|\.3mf$/i, '.gcode') }); a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 3000); if (c.host.trim()) window.open(base(c.host), '_blank', 'noopener'); };
  const d = app.modal('Send to printer', h('p', { class: 'note' }, g?.data ? `File: ${g.name}` : 'Open a sliced G-code file in G-code preview first; this sends that file.'), fields, hint, status,
    h('div', { class: 'modal-foot' }, h('button', { class: 'btn', onclick: test }, 'Test connection'), h('button', { class: 'btn', onclick: download, title: 'Download the G-code and open the printer’s page' }, 'Download and open printer page'),
      h('button', { class: 'btn', onclick: () => send(false) }, 'Send'), h('button', { class: 'btn primary', onclick: () => send(true) }, 'Send and print')));
  return d;
}

export function install(app) {
  app.openPrinter = () => openPrinterDialog(app);
  app.addAction({ label: 'Send to printer (OctoPrint / Klipper)', group: 'Print', run: () => openPrinterDialog(app) });
}
