// Command palette (Ctrl+K): search every tool, shape, generator, example and setting by name.
import { h } from './ui.js';
import { SHAPES, icon } from './shapes.js';

export function install(app) {
  app.actions = app.actions || [];
  app.addAction = (a) => { app.actions.push(a); };

  const core = [
    ['New design', 'File', () => app.cmd('new')], ['Open project…', 'File', () => app.cmd('open'), 'Ctrl O'], ['Save project', 'File', () => app.cmd('save'), 'Ctrl S'],
    ['Import STL, OBJ or 3MF…', 'File', () => app.cmd('import')], ['Open G-code file…', 'File', () => app.openGcode?.()],
    ['Export STL', 'Export', () => app.export('stl'), 'Ctrl E'], ['Export 3MF with colours', 'Export', () => app.export('3mf')], ['Export OBJ', 'Export', () => app.export('obj')],
    ['Export selection as STL', 'Export', () => app.export('sel-stl')], ['Export each part as STL (zip)', 'Export', () => app.export('parts')],
    ['Undo', 'Edit', () => app.cmd('undo'), 'Ctrl Z'], ['Redo', 'Edit', () => app.cmd('redo'), 'Ctrl Shift Z'], ['Select all', 'Edit', () => app.cmd('selectAll'), 'Ctrl A'],
    ['Duplicate', 'Edit', () => app.cmd('duplicate'), 'Ctrl D'], ['Delete', 'Edit', () => app.cmd('delete'), 'Del'], ['Group (cut holes)', 'Edit', () => app.cmd('group'), 'Ctrl G'],
    ['Ungroup', 'Edit', () => app.cmd('ungroup'), 'Ctrl Shift G'], ['Hole ↔ solid', 'Edit', () => app.cmd('toggleHole'), 'H'], ['Turn 90°', 'Edit', () => app.cmd('rotZ'), 'R'],
    ['Drop to plate', 'Edit', () => app.cmd('drop'), 'D'], ['Split into parts', 'Edit', () => app.cmd('split')], ['Freeze as mesh', 'Edit', () => app.cmd('bake')],
    ['Measure', 'View', () => app.view.setMeasure(!app.view.measure), 'M'], ['Fit view', 'View', () => app.view.fit(), 'F'],
    ['Top view', 'View', () => app.view.setView('top'), '7'], ['Front view', 'View', () => app.view.setView('front'), '1'], ['Right view', 'View', () => app.view.setView('right'), '3'], ['Isometric view', 'View', () => app.view.setView('iso'), '0'],
    ['Design workspace', 'Workspace', () => app.setMode('design')], ['Prepare to print workspace', 'Workspace', () => app.setMode('prepare')], ['G-code preview workspace', 'Workspace', () => app.setMode('preview')],
    ['Theme: match system', 'Appearance', () => app.setAppearance({ theme: 'system' })], ['Theme: light', 'Appearance', () => app.setAppearance({ theme: 'light' })], ['Theme: dark', 'Appearance', () => app.setAppearance({ theme: 'dark' })],
    ['Keyboard shortcuts', 'Help', () => app.showHelp(), '?'],
  ];
  for (const [label, group, run, keys] of core) app.addAction({ label, group, run, keys });
  app.on('ready', () => {
    for (const s of SHAPES) app.addAction({ label: s.label, group: s.hole ? 'Hole' : 'Shape', run: () => { app.setMode('design'); app.addShape(s.kind); }, iconHtml: icon(s.icon) });
  });

  const dlg = h('dialog', { class: 'palette', 'aria-label': 'Search tools' });
  const input = h('input', { type: 'search', placeholder: 'Search shapes, generators, tools, settings…', 'aria-label': 'Search', autocomplete: 'off', spellcheck: 'false' });
  const list = h('ul', { class: 'pal-list', role: 'listbox' });
  const foot = h('div', { class: 'pal-foot' }, h('span', {}, h('kbd', {}, '↑'), h('kbd', {}, '↓'), ' move'), h('span', {}, h('kbd', {}, 'Enter'), ' run'), h('span', {}, h('kbd', {}, 'Esc'), ' close'));
  dlg.append(h('div', { class: 'pal-input' }, h('span', { html: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/></svg>' }), input), list, foot);
  document.body.append(dlg);
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
  let shown = [], active = 0;

  const score = (a, q) => {
    if (!q) return 1; const t = `${a.label} ${a.group}`.toLowerCase(); const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    let sc = 0; for (const w of words) { const i = t.indexOf(w); if (i < 0) return 0; sc += i === 0 ? 4 : t[i - 1] === ' ' ? 3 : 1; }
    return sc + (a.label.toLowerCase().startsWith(words[0]) ? 3 : 0);
  };
  function render() {
    const q = input.value.trim();
    shown = app.actions.map((a) => ({ a, s: score(a, q) })).filter((x) => x.s > 0).sort((x, y) => y.s - x.s).slice(0, q ? 40 : 60).map((x) => x.a);
    active = Math.min(active, Math.max(0, shown.length - 1));
    list.replaceChildren(...(shown.length ? shown.map((a, i) => h('li', { role: 'option', 'aria-selected': String(i === active), onmousemove: () => { if (active !== i) { active = i; mark(); } }, onclick: () => run(a) },
      h('span', { class: 'pal-ic', html: a.iconHtml || '' }), h('span', { class: 'pal-label' }, a.label), h('span', { class: 'pal-group' }, a.group), a.keys ? h('kbd', {}, a.keys) : null))
      : [h('li', { class: 'pal-empty' }, `Nothing matches “${q}”.`)]));
  }
  function mark() { [...list.children].forEach((li, i) => li.setAttribute('aria-selected', String(i === active))); list.children[active]?.scrollIntoView({ block: 'nearest' }); }
  function run(a) { dlg.close(); setTimeout(() => a.run(), 0); }
  input.addEventListener('input', () => { active = 0; render(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(shown.length - 1, active + 1); mark(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(0, active - 1); mark(); }
    else if (e.key === 'Enter') { e.preventDefault(); if (shown[active]) run(shown[active]); }
    e.stopPropagation();
  });
  app.openPalette = () => { if (dlg.open) return; input.value = ''; active = 0; render(); dlg.showModal(); input.focus(); };
  document.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); if (dlg.open) dlg.close(); else app.openPalette(); } });
}
