// AI: describe a part (or give a picture) and get something printable back.
// Each platform keeps its own key in this browser; keys are sent only to that platform (or your own relay).
import { h, row } from './ui.js';
import { runScript } from './script.js';
import { free } from './kernel.js';
import { parseSTL, parseGLB, scaleToSize } from './io.js';

const KEY = 'printforge.ai';
export const PLATFORMS = {
  claude: { label: 'Claude', by: 'Anthropic API', out: 'code', inputs: ['text'], model: 'claude-sonnet-5-5', free: 'Pay as you go', best: 'Exact parts with editable sizes', keyUrl: 'https://console.anthropic.com/settings/keys', keyHint: 'sk-ant-…' },
  gemini: { label: 'Gemini', by: 'Google AI Studio', out: 'code', inputs: ['text'], model: 'gemini-flash-latest', free: 'Free tier with daily limits', best: 'Exact parts with editable sizes, at no cost', keyUrl: 'https://aistudio.google.com/apikey', keyHint: 'AIza…' },
  zoo: { label: 'Zoo Text-to-CAD', by: 'zoo.dev', out: 'mesh', inputs: ['text'], free: 'Free monthly developer credit', best: 'Mechanical parts: brackets, mounts, gears', keyUrl: 'https://zoo.dev/docs/developer-tools/api/authentication', keyHint: 'api-…', relay: true },
  tripo: { label: 'Tripo3D', by: 'tripo3d.com', out: 'mesh', inputs: ['text', 'image'], free: 'Free credits when you sign up', best: 'Figures, props, miniatures, organic shapes', keyUrl: 'https://developers.tripo3d.com/en/docs/quick-start', keyHint: 'tsk_…', relay: true },
  hf: { label: 'TRELLIS', by: 'Hugging Face Spaces', out: 'mesh', inputs: ['image'], free: 'Free community GPU (a few minutes a day)', best: 'Turn a photo of an object into a model', keyUrl: 'https://huggingface.co/settings/tokens', keyHint: 'hf_…', keyLabel: 'Hugging Face token', keyOptional: true, space: 'trellis-community/TRELLIS' },
  openai: { label: 'OpenAI-compatible', by: 'OpenAI, OpenRouter, Groq, Ollama, LM Studio', out: 'code', inputs: ['text'], model: '', base: 'https://api.openai.com/v1', free: 'Depends on the service; local models are free', best: 'Any chat model, including ones on your own computer', keyUrl: '', keyHint: 'sk-… (not needed for local models)', keyLabel: 'API key', keyOptional: true },
};

export function loadCfg() {
  let c = {}; try { c = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { c = {}; }
  const cfg = { platform: 'gemini', keys: {}, models: {}, base: '', space: '', relay: '', size: 60, ...c };
  // settings from v3 (one provider + one key)
  if (c.provider && !c.keys) { const pid = c.provider === 'anthropic' ? 'claude' : 'openai'; cfg.platform = pid; if (c.key) cfg.keys[pid] = c.key; if (c.model) cfg.models[pid] = c.model; delete cfg.provider; delete cfg.key; delete cfg.model; }
  return cfg;
}
export const saveCfg = (c) => { try { localStorage.setItem(KEY, JSON.stringify(c)); } catch { /* private mode */ } };

export const SYSTEM = `You design parts for FDM 3D printing by writing JavaScript for PrintForge's code models.
Units are millimetres. Z is up. The plate is z = 0. Angles are in degrees.

Available functions (nothing else, no imports, no DOM):
- params({ name: [default, min, max, step], flag: true, label: 'text', style: { options: ['a','b'], value: 'a' } }) returns the values and turns each one into a control the user can edit. Put every important size in params with sensible ranges.
- Solids: box(w, d, h, r=0) is centred on X/Y and sits on z=0 (r rounds the vertical edges); cyl(d, h, sides=64) and cone(d1, d2, h) stand on z=0 centred; ball(d) is centred at the origin; gear(module, teeth, h, bore=0); thread(d, pitch, length).
- 2D: rect(w, d, r=0), circle(d), poly([[x,y],...]); then extrude(shape2d, h, { twist, scale }) or revolve(shape2d, angle=360) (revolve uses x as radius, y becomes z).
- Combine: union(a, b, ...), subtract(a, b, c, ...), intersect(a, b), hull(a, b, ...), repeat(n, (i) => solid).
- Methods on solids: .translate([x,y,z]), .rotate([x,y,z]) in degrees, .scale([x,y,z]), .mirror([1,0,0]).
- Maths: sin, cos, tan (degrees), sqrt, min, max, abs, round, floor, ceil, PI. Normal JavaScript (const, let, for, arrays) works.
- The code must end with: return <solid>; (an array of solids is unioned).

Design for printing:
- A flat face on the plate, walls at least 1.2 mm, no overhangs steeper than 45° unless unavoidable (use chamfers or teardrop shapes).
- Clearance of 0.2–0.4 mm for parts that fit together. M3 clearance hole 3.4 mm, M4 4.5 mm, M5 5.5 mm. Holes cut with subtract() should extend 1 mm past each face.
- Keep it one connected solid unless the user asks for several parts; if several, place them side by side on the plate with a gap.

Reply with one short sentence describing the part, then a single \`\`\`js code block. No other text.`;

// ---------------------------------------------------------------- networking
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function net(cfg, pid, url, opts = {}) {
  const viaRelay = PLATFORMS[pid].relay && cfg.relay;
  const target = viaRelay ? `${cfg.relay.replace(/\/+$/, '')}/?url=${encodeURIComponent(url)}` : url;
  try { return await fetch(target, opts); }
  catch (e) {
    if (PLATFORMS[pid].relay && !cfg.relay) throw new Error(`Your browser couldn't reach ${PLATFORMS[pid].label}. This service may not accept calls straight from a web page. Set up the free relay (More settings → Relay) and try again.`);
    throw new Error(`Couldn't reach ${PLATFORMS[pid].label}${viaRelay ? ' through your relay' : ''}. Check your internet connection${viaRelay ? ' and the relay address' : ''}.`);
  }
}
async function jsonOf(res, pid) {
  let data = null; try { data = await res.json(); } catch { /* not JSON */ }
  if (!res.ok) {
    const msg = data?.error?.message || data?.message || data?.error_message || (typeof data?.error === 'string' ? data.error : '') || `HTTP ${res.status}`;
    if (res.status === 401 || res.status === 403) throw new Error(`${PLATFORMS[pid].label} refused the key (${msg}). Check it in the AI settings.`);
    if (res.status === 429) throw new Error(`${PLATFORMS[pid].label} says you've hit a usage limit (${msg}). Wait a bit, or check your plan.`);
    if (res.status === 402) throw new Error(`${PLATFORMS[pid].label} says there aren't enough credits on your account (${msg}).`);
    throw new Error(`${PLATFORMS[pid].label} said: ${msg}`);
  }
  return data;
}
const keyOf = (cfg, pid) => (cfg.keys[pid] || '').trim();
function needKey(cfg, pid) { const k = keyOf(cfg, pid); if (!k && !PLATFORMS[pid].keyOptional) throw new Error(`Add your ${PLATFORMS[pid].label} key first.`); return k; }

// ---------------------------------------------------------------- text → code model (Claude, Gemini, OpenAI-compatible)
export async function askModel(cfg, pid, messages) {
  const p = PLATFORMS[pid]; const key = needKey(cfg, pid); const model = (cfg.models[pid] || p.model || '').trim();
  if (!model) throw new Error('Type a model name in the AI settings.');
  if (pid === 'claude') {
    const res = await net(cfg, pid, 'https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' }, body: JSON.stringify({ model, max_tokens: 4000, system: SYSTEM, messages }) });
    const d = await jsonOf(res, pid); return (d.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
  }
  if (pid === 'gemini') {
    const res = await net(cfg, pid, `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({ systemInstruction: { parts: [{ text: SYSTEM }] }, contents: messages.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })), generationConfig: { maxOutputTokens: 8192 } }) });
    const d = await jsonOf(res, pid); const parts = d.candidates?.[0]?.content?.parts || [];
    const text = parts.filter((x) => !x.thought).map((x) => x.text || '').join('');
    if (!text) throw new Error(`Gemini sent back no text${d.candidates?.[0]?.finishReason ? ` (${d.candidates[0].finishReason})` : ''}. Try again or reword the request.`);
    return text;
  }
  const base = (cfg.base || p.base).replace(/\/+$/, '');
  const res = await net(cfg, pid, `${base}/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}) }, body: JSON.stringify({ model, max_tokens: 4000, messages: [{ role: 'system', content: SYSTEM }, ...messages] }) });
  const d = await jsonOf(res, pid); return d.choices?.[0]?.message?.content || '';
}
export async function listGeminiModels(cfg) {
  const res = await net(cfg, 'gemini', 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', { headers: { 'x-goog-api-key': needKey(cfg, 'gemini') } });
  const d = await jsonOf(res, 'gemini');
  return (d.models || []).filter((m) => (m.supportedGenerationMethods || []).includes('generateContent')).map((m) => m.name.replace(/^models\//, ''));
}
const extractCode = (text) => { const m = /```(?:js|javascript)?\s*\n([\s\S]*?)```/i.exec(text); return (m ? m[1] : text).trim(); };

export async function generatePart(cfg, pid, request, current, onStatus = () => {}) {
  const first = current ? `Here is the current model:\n\`\`\`js\n${current}\n\`\`\`\nChange it as follows, keeping the params() controls where possible: ${request}` : `Design this part: ${request}`;
  const messages = [{ role: 'user', content: first }];
  for (let attempt = 0; attempt < 3; attempt++) {
    onStatus(attempt ? 'Fixing an error in the model…' : `Designing with ${PLATFORMS[pid].label}…`);
    const reply = await askModel(cfg, pid, messages); if (!reply) throw new Error('The AI sent back an empty answer.');
    const code = extractCode(reply); const summary = reply.split('```')[0].trim().split('\n')[0].slice(0, 200);
    try {
      const { man, schema } = runScript(code); const b = man.boundingBox(); const size = [0, 1, 2].map((i) => b.max[i] - b.min[i]); free(man);
      if (size.some((v) => !(v > 0))) throw new Error('The model came out empty.');
      return { code, schema, summary, size };
    } catch (e) {
      messages.push({ role: 'assistant', content: reply }, { role: 'user', content: `That code fails in PrintForge with: ${e.message}\nSend the corrected full code in one js block.` });
    }
  }
  throw new Error('The AI could not produce a working model. Try describing the part differently or more simply.');
}

// ---------------------------------------------------------------- text → CAD (Zoo)
const b64ToBuf = (b64) => { const s = atob(b64); const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u.buffer; };
export async function zooTextToCad(cfg, prompt, onStatus) {
  const auth = { authorization: `Bearer ${needKey(cfg, 'zoo')}` };
  onStatus('Sending to Zoo…');
  const start = await jsonOf(await net(cfg, 'zoo', 'https://api.zoo.dev/ai/text-to-cad/stl', { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ prompt }) }), 'zoo');
  let job = start; const t0 = Date.now();
  while (!['completed', 'failed'].includes(job.status)) {
    if (Date.now() - t0 > 6 * 60e3) throw new Error('Zoo is taking longer than 6 minutes. Try again later.');
    onStatus(`Zoo is designing the part (${job.status || 'queued'}, ${Math.round((Date.now() - t0) / 1000)} s)…`); await sleep(3000);
    job = await jsonOf(await net(cfg, 'zoo', `https://api.zoo.dev/user/text-to-cad/${job.id}`, { headers: auth }), 'zoo');
  }
  if (job.status === 'failed') throw new Error(`Zoo couldn't make this part: ${job.error || 'no reason given'}. Describe a mechanical part with sizes, for example “a 40 mm L-bracket with two M4 holes”.`);
  const name = Object.keys(job.outputs || {}).find((k) => /\.stl$/i.test(k)); if (!name) throw new Error('Zoo finished but sent no STL file.');
  const part = parseSTL(b64ToBuf(job.outputs[name]));
  let m = 0; for (const x of part.v) m = Math.max(m, Math.abs(x)); if (m > 0 && m < 1) for (let i = 0; i < part.v.length; i++) part.v[i] *= 1000; // metres → mm
  return { parts: [{ name: 'Zoo part', ...part }], note: job.code ? 'Zoo also wrote KCL code for this part, which you can open in Zoo Design Studio.' : '' };
}

// ---------------------------------------------------------------- text or image → mesh (Tripo3D)
const TRIPO = 'https://openapi.tripo3d.com/v3';
async function tripoCall(cfg, path, opts = {}) {
  const res = await net(cfg, 'tripo', TRIPO + path, { ...opts, headers: { authorization: `Bearer ${needKey(cfg, 'tripo')}`, ...(opts.body && !(opts.body instanceof FormData) ? { 'content-type': 'application/json' } : {}), ...(opts.headers || {}) } });
  const d = await jsonOf(res, 'tripo'); if (d.code && d.code !== 0) throw new Error(`Tripo3D said: ${d.message || d.msg || `error ${d.code}`}`); return d.data;
}
async function tripoWait(cfg, id, what, onStatus) {
  const t0 = Date.now();
  for (;;) {
    const d = await tripoCall(cfg, `/tasks/${id}`);
    if (d.status === 'success') return d;
    if (['failed', 'cancelled', 'banned', 'expired', 'unknown'].includes(d.status)) throw new Error(`Tripo3D ${what} ${d.status}.`);
    if (Date.now() - t0 > 8 * 60e3) throw new Error('Tripo3D is taking longer than 8 minutes. Try again later.');
    onStatus(`Tripo3D: ${what} ${d.progress != null ? `${Math.round(d.progress)}%` : '…'}`); await sleep(2500);
  }
}
export async function tripoGenerate(cfg, { prompt, image }, onStatus) {
  let task;
  if (image) {
    onStatus('Uploading the picture to Tripo3D…'); const fd = new FormData(); fd.append('file', image, image.name || 'image.png');
    const up = await tripoCall(cfg, '/files', { method: 'POST', body: fd });
    task = await tripoCall(cfg, '/generation/image-to-model', { method: 'POST', body: JSON.stringify({ input: up.file_token, model: cfg.models.tripoImage || 'P2-20260801' }) });
  } else task = await tripoCall(cfg, '/generation/text-to-model', { method: 'POST', body: JSON.stringify({ prompt, model: cfg.models.tripo || 'v3.1-20260211' }) });
  await tripoWait(cfg, task.task_id, 'making the model', onStatus);
  onStatus('Tripo3D: converting to STL for printing…');
  const conv = await tripoCall(cfg, '/models/convert', { method: 'POST', body: JSON.stringify({ input: task.task_id, format: 'STL' }) });
  const done = await tripoWait(cfg, conv.task_id, 'converting to STL', onStatus);
  const url = done.output?.model_url; if (!url) throw new Error('Tripo3D finished but sent no file.');
  onStatus('Downloading the model…');
  const res = await net(cfg, 'tripo', url); if (!res.ok) throw new Error(`Couldn't download the model (HTTP ${res.status}). Links expire after 5 minutes; try again.`);
  const buf = await res.arrayBuffer(); const head = new Uint8Array(buf, 0, 4);
  const parts = head[0] === 0x67 && head[1] === 0x6c && head[2] === 0x54 && head[3] === 0x46 ? parseGLB(buf, 'Tripo model') : [{ name: 'Tripo model', ...parseSTL(buf) }];
  return { parts, scale: true };
}

// ---------------------------------------------------------------- image → mesh (TRELLIS on Hugging Face)
let gradio = null;
async function gradioClient() { gradio ||= await import('https://cdn.jsdelivr.net/npm/@gradio/client@2.1.0/+esm'); return gradio; }
export async function trellisGenerate(cfg, image, onStatus) {
  if (!image) throw new Error('Choose a picture of the object first.');
  onStatus('Connecting to the TRELLIS Space (it may need a minute to wake up)…');
  let G; try { G = await gradioClient(); } catch { throw new Error('Couldn\'t load the Hugging Face connector. Check your internet connection.'); }
  const space = (cfg.space || PLATFORMS.hf.space).trim(); const token = keyOf(cfg, 'hf');
  const wrap = (e) => { const m = String(e?.message || e?.title || e || ''); if (/quota|ZeroGPU|exceeded/i.test(m)) return new Error(`The free GPU time on Hugging Face is used up for now (${m.slice(0, 160)}). Add a free Hugging Face token for more, or try later.`); return new Error(`TRELLIS said: ${m.slice(0, 300) || 'something went wrong'}`); };
  let client; try { client = await G.Client.connect(space, token ? { hf_token: token } : {}); } catch (e) { throw new Error(`Couldn't open the Space “${space}”: ${e?.message || e}`); }
  try {
    try { await client.predict('/start_session', {}); } catch { /* older versions don't have it */ }
    onStatus('TRELLIS: preparing the picture…');
    let img = G.handle_file(image);
    try { const pre = await client.predict('/preprocess_image', { image: img }); if (pre?.data?.[0]) img = pre.data[0]; } catch { /* use the original */ }
    onStatus('TRELLIS: building the 3D model (about a minute)…');
    await client.predict('/image_to_3d', { image: img, multiimages: [], seed: 0, ss_guidance_strength: 7.5, ss_sampling_steps: 12, slat_guidance_strength: 3, slat_sampling_steps: 12, multiimage_algo: 'stochastic' });
    onStatus('TRELLIS: exporting the mesh…');
    const out = await client.predict('/extract_glb', { mesh_simplify: 0.95, texture_size: 512 });
    const file = (out?.data || []).find((x) => x && (x.url || x.path) && /\.glb/i.test(x.url || x.path || '')) || out?.data?.[1] || out?.data?.[0];
    const url = file?.url || file; if (!url || typeof url !== 'string') throw new Error('no model file came back');
    onStatus('Downloading the model…');
    const res = await fetch(url, token ? { headers: { authorization: `Bearer ${token}` } } : {}); if (!res.ok) throw new Error(`download failed (HTTP ${res.status})`);
    return { parts: parseGLB(await res.arrayBuffer(), 'TRELLIS model'), scale: true };
  } catch (e) { throw wrap(e); }
}

// ---------------------------------------------------------------- window
const IDEAS = {
  code: ['A wall hook for a 25 mm broom handle with two screw holes', 'A box for 4 AA batteries with a sliding lid', 'A desk cable organiser with 5 slots for 6 mm cables', 'A replacement knob for a 6 mm D-shaft, 30 mm wide'],
  zoo: ['An L-bracket 40 mm on each side, 4 mm thick, with two M4 holes per side', 'A spur gear with 24 teeth, module 1.5, 8 mm bore', 'A NEMA 17 motor mount plate with slots for belt tension'],
  tripo: ['A small dragon miniature sitting on a rock', 'A cartoon owl pencil holder', 'A low-poly fox figurine'],
};

export function openAI(app) {
  const cfg = loadCfg(); const s = app.scene; const sel = s.selected(); const target = sel.length === 1 && sel[0].kind === 'script' ? sel[0] : null;
  if (target && PLATFORMS[cfg.platform].out !== 'code') cfg.platform = 'gemini';
  let pid = cfg.platform; let mode = 'text'; let image = null; let busy = false;
  const body = h('div', { class: 'ai-main' }); const list = h('div', { class: 'ai-platforms', role: 'radiogroup', 'aria-label': 'AI platform' });
  const status = h('div', { class: 'ai-status', role: 'status' });
  const goBtn = h('button', { class: 'btn primary', onclick: () => go() });
  const renderList = () => list.replaceChildren(...Object.entries(PLATFORMS).map(([id, p]) => h('button', { class: 'ai-plat', role: 'radio', 'aria-checked': String(id === pid), disabled: target && p.out !== 'code' ? true : null, title: target && p.out !== 'code' ? 'Only the editable-model platforms can change a code model' : null, onclick: () => { pid = id; cfg.platform = id; saveCfg(cfg); if (!p.inputs.includes(mode)) mode = p.inputs[0]; renderList(); render(); } },
    h('span', { class: 'ap-top' }, h('b', {}, p.label), h('span', { class: `ap-tag ${p.out}` }, p.out === 'code' ? 'Editable model' : 'Mesh')),
    h('span', { class: 'ap-by' }, p.by), h('span', { class: 'ap-free' }, p.free), cfg.keys[id] ? h('span', { class: 'ap-key' }, 'Key saved') : null)));
  const prompt = h('textarea', { rows: 4, class: 'ai-prompt', onkeydown: (e) => { e.stopPropagation(); if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) go(); } });
  const imgPrev = h('img', { class: 'ai-img', alt: '' });
  const imgIn = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', onchange: (e) => { image = e.target.files[0] || null; if (image) { imgPrev.src = URL.createObjectURL(image); imgPrev.hidden = false; } } });
  imgPrev.hidden = true;
  function render() {
    const p = PLATFORMS[pid]; const code = p.out === 'code';
    if (!p.inputs.includes(mode)) mode = p.inputs[0];
    prompt.placeholder = target && code ? `How should “${target.name}” change? For example: make it 10 mm taller and add a third screw hole` : pid === 'zoo' ? 'Describe a mechanical part with its sizes.' : pid === 'tripo' ? 'Describe the object: what it is, its style and pose.' : 'Describe the part: what it is for, the main sizes, and anything it must fit.';
    goBtn.textContent = target && code ? 'Change model' : 'Make it';
    const keyIn = h('input', { type: 'password', value: cfg.keys[pid] || '', autocomplete: 'off', placeholder: p.keyHint, 'aria-label': `${p.label} key`, onchange: (e) => { cfg.keys[pid] = e.target.value.trim(); saveCfg(cfg); renderList(); }, onkeydown: (e) => e.stopPropagation() });
    const keyRow = h('div', { class: 'ai-key' }, h('label', {}, `${p.keyLabel || `${p.label} key`}${p.keyOptional ? ' (optional)' : ''}`), keyIn, p.keyUrl ? h('a', { href: p.keyUrl, target: '_blank', rel: 'noopener' }, 'Get a key') : null);
    const seg = p.inputs.length > 1 ? h('div', { class: 'seg', style: { maxWidth: '260px' } }, ...p.inputs.map((m) => h('button', { 'aria-pressed': String(mode === m), onclick: () => { mode = m; render(); } }, m === 'text' ? 'Describe it' : 'From a picture'))) : null;
    const ideas = IDEAS[code ? 'code' : pid];
    const sizeRow = !code && pid !== 'zoo' ? row('Largest side (mm)', h('input', { type: 'number', class: 'num', min: 5, max: 300, value: cfg.size, onchange: (e) => { cfg.size = Math.max(5, Math.min(300, +e.target.value || 60)); saveCfg(cfg); }, onkeydown: (e) => e.stopPropagation() })) : null;
    // advanced
    const adv = [];
    if (code) adv.push(row('Model', h('input', { type: 'text', value: cfg.models[pid] || '', placeholder: p.model || 'model name, e.g. llama3.1', list: 'aiModels', onchange: (e) => { cfg.models[pid] = e.target.value.trim(); saveCfg(cfg); }, onkeydown: (e) => e.stopPropagation() })));
    if (pid === 'gemini') adv.push(h('button', { class: 'btn', onclick: async (e) => { e.target.disabled = true; try { const ms = await listGeminiModels(cfg); dl.replaceChildren(...ms.map((m) => h('option', { value: m }))); status.className = 'ai-status ok'; status.textContent = `${ms.length} Gemini models available. Click the Model box to pick one.`; } catch (err) { status.className = 'ai-status bad'; status.textContent = err.message; } e.target.disabled = false; } }, 'List my Gemini models'));
    if (pid === 'openai') adv.push(row('Server address', h('input', { type: 'text', value: cfg.base, placeholder: p.base, onchange: (e) => { cfg.base = e.target.value.trim(); saveCfg(cfg); }, onkeydown: (e) => e.stopPropagation() })));
    if (pid === 'hf') adv.push(row('Space', h('input', { type: 'text', value: cfg.space, placeholder: p.space, onchange: (e) => { cfg.space = e.target.value.trim(); saveCfg(cfg); }, onkeydown: (e) => e.stopPropagation() })));
    if (p.relay) adv.push(row('Relay (optional)', h('input', { type: 'text', value: cfg.relay, placeholder: 'https://printforge-relay.<you>.workers.dev', onchange: (e) => { cfg.relay = e.target.value.trim(); saveCfg(cfg); }, onkeydown: (e) => e.stopPropagation() })),
      h('p', { class: 'note' }, 'Some services don\'t accept calls straight from a web page. A relay passes them on for you. You can run your own for free on Cloudflare in a few minutes: see docs/AI-PLATFORMS.md.'));
    adv.push(h('p', { class: 'note' }, 'Each key stays in this browser only and is sent only to its own service (or your relay). Usage is billed or counted by that service.'));
    adv.push(h('button', { class: 'btn', onclick: () => { delete cfg.keys[pid]; saveCfg(cfg); render(); renderList(); } }, `Forget the ${p.label} key`));
    const dl = h('datalist', { id: 'aiModels' });
    body.replaceChildren(...[
      h('div', { class: 'ai-head' }, h('h4', {}, p.label), h('p', { class: 'note' }, `Best for: ${p.best}. ${code ? 'You get a code model whose sizes you can change in the panel.' : 'You get a mesh you can scale, cut and combine with other shapes.'}`)),
      keyRow, seg,
      mode === 'image' ? h('div', { class: 'ai-image' }, imgIn, imgPrev, h('p', { class: 'note' }, 'One object on a plain background works best.')) : prompt,
      mode === 'text' && ideas && !(target && code) ? h('div', { class: 'ai-ideas' }, ...ideas.map((t) => h('button', { onclick: () => { prompt.value = t; prompt.focus(); } }, t))) : null,
      sizeRow, status, h('details', { class: 'ai-settings' }, h('summary', {}, 'More settings'), ...adv), dl].filter(Boolean));
    if (!cfg.keys[pid] && !p.keyOptional) setTimeout(() => keyIn.focus(), 30);
  }
  async function go() {
    if (busy) return; const p = PLATFORMS[pid]; const text = prompt.value.trim();
    if (mode === 'text' && !text) { prompt.focus(); return; }
    if (mode === 'image' && !image) { status.className = 'ai-status bad'; status.textContent = 'Choose a picture first.'; return; }
    busy = true; goBtn.disabled = true; status.className = 'ai-status work';
    const on = (m) => { status.textContent = m; };
    try {
      if (p.out === 'code') {
        const r = await generatePart(cfg, pid, text, target?.params._code, on);
        const vals = {}; for (const f of r.schema) vals[f.key] = (target && target.params[f.key] !== undefined && target.params._schema?.some((x) => x.key === f.key)) ? target.params[f.key] : f.def;
        const params = { _code: r.code, _schema: r.schema, ...vals }; app.setMode('design');
        if (target) app.setParams(target, params, 'change with AI'); else app.addShape('script', params, { name: nameFrom(text) });
        status.className = 'ai-status ok'; status.textContent = `${r.summary || 'Done.'} ${r.size.map((v) => v.toFixed(0)).join(' × ')} mm. ${r.schema.length === 1 ? 'Its setting is' : `Its ${r.schema.length} settings are`} in the panel on the right.`;
      } else {
        const r = pid === 'zoo' ? await zooTextToCad(cfg, text, on) : pid === 'tripo' ? await tripoGenerate(cfg, mode === 'image' ? { image } : { prompt: text }, on) : await trellisGenerate(cfg, image, on);
        if (r.scale) scaleToSize(r.parts, cfg.size);
        const label = mode === 'image' && image ? image.name.replace(/\.[^.]+$/, '') : nameFrom(text);
        r.parts.forEach((q, i) => { q.name = r.parts.length > 1 ? `${label} ${i + 1}` : label; });
        app.setMode('design'); on('Checking the mesh…'); const added = app.addParts(r.parts, `add ${p.label} model`);
        if (!added.length) throw new Error('The model could not be added to the plate.');
        const b = s.selectionBox(added); status.className = 'ai-status ok';
        status.textContent = `Added “${label}”, ${[0, 1, 2].map((i) => (b.max[i] - b.min[i]).toFixed(0)).join(' × ')} mm. ${r.note || 'Resize it in the panel on the right, then run Prepare to print.'}`;
      }
      app.toast(target && p.out === 'code' ? 'Model changed' : 'Added to the plate');
    } catch (e) { status.className = 'ai-status bad'; status.textContent = e.message; }
    finally { busy = false; goBtn.disabled = false; }
  }
  renderList(); render();
  const d = app.modal(target ? `Change “${target.name}” with AI` : 'Make it with AI', h('div', { class: 'ai-wrap' }, list, body),
    h('div', { class: 'modal-foot' }, h('span', { class: 'note', style: { marginRight: 'auto' } }, 'Check the result in Prepare to print before printing.'), h('button', { class: 'btn', onclick: () => d.close() }, 'Close'), goBtn));
  d.classList.add('wide');
  setTimeout(() => prompt.focus(), 50);
}
function nameFrom(t) { const w = t.replace(/^(a|an|the)\s+/i, '').split(/\s+/).slice(0, 4).join(' '); return (w.charAt(0).toUpperCase() + w.slice(1)) || 'AI part'; }

export function install(app) {
  app.openAI = () => openAI(app);
  app.addAction({ label: 'Make a part with AI', group: 'AI', run: () => openAI(app) });
  app.addAction({ label: 'Picture to 3D model with AI', group: 'AI', run: () => { const c = loadCfg(); if (!PLATFORMS[c.platform].inputs.includes('image')) { c.platform = 'hf'; saveCfg(c); } openAI(app); } });
  app.addAction({ label: 'Change the selected code model with AI', group: 'AI', run: () => openAI(app) });
}
