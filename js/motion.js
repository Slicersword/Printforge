// Interface motion that needs a little script (the rest is CSS in app.css, "motion" section):
// - a thumb that slides to the selected button in the mode switch and the tab rows
// - the loading screen's mark, printed bottom-up one layer at a time as the engine loads
const calm = () => !!(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || document.documentElement.dataset.motion === 'off');

/** A highlight that glides to whichever button is selected (aria-selected / aria-pressed) inside `box`. */
export function slidingThumb(box, kind) {
  if (!box || box._thumb) return;
  const thumb = document.createElement('span'); thumb.className = `thumb thumb-${kind}`; thumb.setAttribute('aria-hidden', 'true');
  box._thumb = thumb; box.classList.add('has-thumb');
  const place = () => {
    if (!thumb.isConnected) box.prepend(thumb);
    const on = box.querySelector('[aria-selected="true"], [aria-pressed="true"]');
    if (!on || !on.offsetWidth) { thumb.style.opacity = '0'; return; }
    thumb.style.opacity = '1';
    thumb.style.width = `${on.offsetWidth}px`; thumb.style.height = `${on.offsetHeight}px`;
    thumb.style.transform = `translate(${on.offsetLeft}px, ${on.offsetTop}px)`;
  };
  new MutationObserver(() => requestAnimationFrame(place)).observe(box, { subtree: true, childList: true, attributes: true, attributeFilter: ['aria-selected', 'aria-pressed', 'hidden', 'class'] });
  new ResizeObserver(place).observe(box);
  place(); requestAnimationFrame(() => { place(); box.classList.add('thumb-ready'); }); // no slide on the first paint
}

/** Loading screen: the mark prints up to `f` (0–1) in whole layers, the nozzle line riding on top. */
const LAYERS = 18;
export function printProgress(f) {
  const el = document.getElementById('printMark'); if (!el) return;
  const k = Math.max(0, Math.min(LAYERS, Math.ceil(f * LAYERS))); const top = 54, bottom = 52, h = 36; // part spans y 16..52
  const clip = el.querySelector('#pmClip rect'); const y = bottom - (h * k) / LAYERS;
  clip.setAttribute('y', String(y)); clip.setAttribute('height', String(bottom - y + 0.01));
  el.style.setProperty('--nozzle', `${((y - 2) / 64) * 100}%`); el.dataset.done = k >= LAYERS ? '1' : '';
  void top;
}

export function setMotion(on) {
  try { localStorage.setItem('pf-motion', on ? 'on' : 'off'); } catch { /* private mode */ }
  document.documentElement.dataset.motion = on ? 'on' : 'off'; document.documentElement.classList.toggle('calm', calm());
}
export function installMotion() {
  try { if (localStorage.getItem('pf-motion') === 'off') document.documentElement.dataset.motion = 'off'; } catch { /* private mode */ }
  slidingThumb(document.querySelector('.modes'), 'pill');
  document.querySelectorAll('.left .tabs').forEach((t) => slidingThumb(t, 'line'));
  // tab rows are rebuilt as the library grows: catch new ones
  const left = document.querySelector('.left');
  if (left) new MutationObserver(() => left.querySelectorAll('.tabs').forEach((t) => slidingThumb(t, 'line'))).observe(left, { childList: true, subtree: true });
  if (calm()) document.documentElement.classList.add('calm');
  window.matchMedia?.('(prefers-reduced-motion: reduce)').addEventListener?.('change', () => document.documentElement.classList.toggle('calm', calm()));
}
