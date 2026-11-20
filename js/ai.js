// SELENE AI mode: connects SELENE to Claude or free AI (Gemini, Llama via Groq/OpenRouter, Chrome's Gemini Nano).
// The onboard rules still run every command and the crisis check; the AI writes the reply using SELENE's live data.
// Settings are shared with LUNA-X AI (same site, same storage key), so a key remembered in one works in the other.

const SETTINGS_KEY = 'luna-ai-providers-v1';
const MODE_KEY = 'selene-ai-mode';
const SDK_URL = 'https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@1.6.0/+esm';

const PROVIDERS = {
  claude: { name: 'Claude', org: 'Anthropic', color: '#d97757', free: false, model: 'claude-opus-5-5', keyUrl: 'https://console.anthropic.com/settings/keys', shape: [/^sk-ant-/, 'Claude keys start with sk-ant-'] },
  gemini: { name: 'Gemini', org: 'Google', color: '#4f8cff', free: true, model: 'gemini-2.5-flash', keyUrl: 'https://aistudio.google.com/apikey', shape: [/^AIza/, 'Gemini keys start with AIza'] },
  groq: { name: 'Groq Llama', org: 'Groq', color: '#f55036', free: true, kind: 'openai', base: 'https://api.groq.com/openai/v1', model: 'meta-llama/llama-4-scout-17b-16e-instruct', keyUrl: 'https://console.groq.com/keys', shape: [/^gsk_/, 'Groq keys start with gsk_'] },
  meta: { name: 'Meta Llama', org: 'OpenRouter', color: '#a78bfa', free: true, kind: 'openai', base: 'https://openrouter.ai/api/v1', model: 'meta-llama/llama-4-maverick:free', keyUrl: 'https://openrouter.ai/keys', shape: [/^sk-or-/, 'OpenRouter keys start with sk-or-'] },
  openai: { name: 'OpenAI', org: 'OpenAI', color: '#10a37f', free: false, kind: 'openai', base: 'https://api.openai.com/v1', model: 'gpt-4.1-mini', keyUrl: 'https://platform.openai.com/api-keys', shape: [/^sk-/, 'OpenAI keys start with sk-'] },
  chrome: { name: 'Gemini Nano', org: 'Chrome, on device', color: '#34d399', free: true, nokey: true },
};
const ORDER = ['claude', 'gemini', 'groq', 'meta', 'openai', 'chrome'];
const CLAUDE_MODELS = { 'claude-opus-5-5': 'Claude Opus 5.5 (best)', 'claude-sonnet-5-5': 'Claude Sonnet 5.5 (balanced)', 'claude-haiku-5-5': 'Claude Haiku 5.5 (fastest, cheapest)' };

// Simple original glyphs in each provider's colour (not official logos); same as LUNA-X
const ICON = {
  claude: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round">' + Array.from({ length: 8 }, (_, i) => { const a = (i * Math.PI) / 4; return `<line x1="${(12 + 3 * Math.cos(a)).toFixed(1)}" y1="${(12 + 3 * Math.sin(a)).toFixed(1)}" x2="${(12 + 10 * Math.cos(a)).toFixed(1)}" y2="${(12 + 10 * Math.sin(a)).toFixed(1)}"/>`; }).join('') + '</svg>',
  gemini: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 1.5C12.6 7.4 16.6 11.4 22.5 12 16.6 12.6 12.6 16.6 12 22.5 11.4 16.6 7.4 12.6 1.5 12 7.4 11.4 11.4 7.4 12 1.5Z"/></svg>',
  openai: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"><path d="M12 2.5 20.2 7.2v9.6L12 21.5 3.8 16.8V7.2Z"/><circle cx="12" cy="12" r="3"/></svg>',
  meta: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 12c-2.2-3.4-4-5-6-5-2.3 0-3.5 2.5-3.5 5s1.2 5 3.5 5c2 0 3.8-1.6 6-5Zm0 0c2.2-3.4 4-5 6-5 2.3 0 3.5 2.5 3.5 5s-1.2 5-3.5 5c-2 0-3.8-1.6-6-5Z"/></svg>',
  groq: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M13.5 1.5 4 13.5h6.5L9.5 22.5 20 9.5h-6.5Z"/></svg>',
  chrome: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 2.5v3M15 2.5v3M9 18.5v3M15 18.5v3M2.5 9h3M2.5 15h3M18.5 9h3M18.5 15h3"/></svg>',
};

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* ---------- settings (shared with LUNA-X) ---------- */
function loadSettings() {
  let s = {};
  try { s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') || {}; } catch { /* storage blocked */ }
  for (const id of ORDER) s[id] = { enabled: false, key: '', model: PROVIDERS[id].model || '', base: PROVIDERS[id].base || '', remember: false, ...(s[id] || {}) };
  return s;
}
function saveSettings() {
  let stored = {};
  try { stored = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') || {}; } catch { /* ignore */ }
  for (const [id, v] of Object.entries(settings)) stored[id] = { ...(stored[id] || {}), ...v, key: v.remember ? v.key : '' };
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(stored)); } catch { /* ignore */ }
}
const settings = loadSettings();
let aiMode = true;
try { aiMode = localStorage.getItem(MODE_KEY) !== 'off'; } catch { /* ignore */ }
const verified = new Set();
const isConnected = (id) => { const v = settings[id]; if (!v?.enabled) return false; if (PROVIDERS[id].nokey) return true; if (id === 'claude') return !!(v.key || v.proxy); return !!v.key; };
const connected = () => ORDER.filter(isConnected);

/* ---------- provider calls ---------- */
let sdk = null, claudeClient = null, claudeSig = '';
async function claude(system, messages) {
  const c = settings.claude;
  const sig = c.key + '|' + (c.proxy || '');
  if (!claudeClient || sig !== claudeSig) {
    sdk = sdk || (await import(SDK_URL)).default;
    claudeClient = new sdk({ apiKey: c.key || 'via-proxy', baseURL: c.proxy || undefined, dangerouslyAllowBrowser: true, maxRetries: 1 });
    claudeSig = sig;
  }
  const model = CLAUDE_MODELS[c.model] ? c.model : 'claude-opus-5-5';
  const msg = await claudeClient.messages.create({ model, max_tokens: 4000, thinking: { type: 'adaptive' }, output_config: { effort: 'low' }, system, messages });
  if (msg.stop_reason === 'refusal') throw new Error('Claude declined this one');
  const text = msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
  if (!text) throw new Error('Claude sent an empty reply');
  return text;
}
async function gemini(system, messages) {
  const v = settings.gemini;
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(v.model || PROVIDERS.gemini.model)}:generateContent`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': v.key },
    body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents: messages.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })), generationConfig: { maxOutputTokens: 1200 } }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error?.message || `Gemini error ${r.status}`);
  const text = (j.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('').trim();
  if (!text) throw new Error('Gemini sent an empty reply');
  return text;
}
async function openaiCompat(id, system, messages) {
  const v = settings[id], p = PROVIDERS[id];
  const r = await fetch(`${(v.base || p.base).replace(/\/$/, '')}/chat/completions`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${v.key}` },
    body: JSON.stringify({ model: v.model || p.model, max_tokens: 1200, messages: [{ role: 'system', content: system }, ...messages] }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error?.message || `${p.name} error ${r.status}`);
  const text = (j.choices?.[0]?.message?.content || '').trim();
  if (!text) throw new Error(`${p.name} sent an empty reply`);
  return text;
}
async function chrome(system, messages) {
  const LM = window.LanguageModel;
  if (!LM) throw new Error('Gemini Nano needs a recent desktop Chrome');
  const s = await LM.create({ initialPrompts: [{ role: 'system', content: system }, ...messages.slice(0, -1)] });
  try { return (await s.prompt(messages.at(-1).content)).trim(); } finally { s.destroy?.(); }
}
function call(id, system, messages) {
  if (id === 'claude') return claude(system, messages);
  if (id === 'gemini') return gemini(system, messages);
  if (id === 'chrome') return chrome(system, messages);
  return openaiCompat(id, system, messages);
}
function friendly(id, err) {
  const m = String(err?.message || err);
  if (id === 'claude') {
    if (/credit balance/i.test(m)) return 'The Claude account has no API credits. Add credits at console.anthropic.com → Billing (a Claude.ai chat plan does not include API credits).';
    if (err?.status === 401 || /authentication|invalid x-api-key/i.test(m)) return 'Claude rejected the key. Copy the whole key (starts with sk-ant-api) from console.anthropic.com → API keys.';
    if (err?.status === 429) return 'Rate limited. Wait a moment and try again.';
    if (/Failed to fetch|Connection error|network/i.test(m)) return 'Could not reach Claude (network or proxy).';
  }
  return m.slice(0, 180);
}

/* ---------- SELENE's AI answer ---------- */
const SYSTEM = `You are SELENE, the crew health AI in the Project ARES lunar habitat, a NASA HUNCH student project. You work beside LUNA-X, the habitat's command AI: you sense and care for the crew (vitals, sleep, hydration, exercise, radiation, brainwaves, mood and camera check-ins), LUNA-X runs the habitat.
You are talking with one crew member. Each message comes with SELENE's live data and what SELENE's onboard system already did.
Rules:
- Use only the numbers in the live data. Never invent readings.
- The onboard system performs actions (logging water, exercise or sleep, lights, music, breathing, scheduling, check-ins). If it handled the message, confirm what it did in your own words. Never claim an action it did not take.
- Be warm, calm and brief: 1 to 4 short sentences, plain speech (your reply is read aloud), no markdown, no lists.
- You are not a medical device and never diagnose. For medical worries, suggest the flight surgeon.
- If the onboard reply ends with "Was that helpful?", end yours with exactly "Was that helpful?".
- This is a simulated demo; the crew data is simulated.`;

const history = [];
function context(SEL) {
  const { S, phys, brain, exterior } = SEL;
  const p = phys(), b = brain(), e = exterior(), d = p.d;
  const pick = (o, ks) => Object.fromEntries(ks.filter((k) => o[k] != null).map((k) => [k, o[k]]));
  return {
    crew_member: S.aid,
    vitals: pick(d, ['heart_rate', 'spo2', 'hrv_ms', 'skin_temp_c', 'systolic_bp', 'diastolic_bp', 'balance_score']),
    today: { exercise_min: Math.round(p.ex), resistive_min: Math.round(p.res), water_ml: Math.round(p.water), sleep_h: p.sleep, goals: 'exercise 120 min, water 2500 ml, sleep 8 h' },
    health_status: p.status, flags: p.flags.map((f) => f[1]),
    brainwaves: b.st, mood_checkin: S.checkin[S.aid]?.status || 'none today',
    habitat: { lighting: S.light, temp_c: S.temp, sound: S.sound || 'off', o2_pct: d.o2_pct, ppco2_mmhg: d.ppco2_mmhg },
    radiation_msv: d.radiation_msv, outside: { notes: e.notes, eva_ok: e.eva_ok },
    schedule: S.sched.slice(-4), monitoring_paused: S.paused,
  };
}

async function answer(text, SEL) {
  const t = text.toLowerCase().trim();
  // Safety first and always on the device: crisis and emergency words never wait for an AI.
  if (SEL.CRISIS.test(t) || SEL.EMERG.test(t)) return { text: SEL.reply(text) };
  const local = SEL.reply(text); // runs the command (logging, lights, music…) exactly as before
  const ids = connected();
  if (!aiMode || !ids.length) return { text: local };
  const unmatched = /^I didn't catch a command/.test(local);
  const prompt = `${SEL.S.aid} says: ${text}\n\n[SELENE onboard system: ${unmatched ? 'no command matched; answer the message yourself.' : `already handled it and would say: "${local}"`}]\n[Live data: ${JSON.stringify(context(SEL))}]`;
  const messages = [...history.slice(-8), { role: 'user', content: prompt }];
  for (const id of ids) {
    try {
      let out = await call(id, SYSTEM, messages);
      out = out.replace(/[*#`]/g, '').trim();
      if (/Was that helpful\?$/.test(local) && !/Was that helpful\?$/.test(out)) out += ' Was that helpful?';
      history.push({ role: 'user', content: `${SEL.S.aid} says: ${text}` }, { role: 'assistant', content: out });
      if (!verified.has(id)) { verified.add(id); renderLinks(); }
      return { text: out, via: id };
    } catch (err) {
      console.warn(`SELENE AI: ${id} failed`, err);
      setStatus(id, '✗ ' + friendly(id, err), 'bad');
    }
  }
  return { text: local, via: null, note: 'AI unreachable, onboard reply' };
}

/* ---------- UI ---------- */
let SELref = null;
function injectCSS() {
  const css = `
.ai-links{display:inline-flex;align-items:center;margin-left:10px;vertical-align:middle}.ai-links:empty{display:none}
.ai-lk{display:inline-flex;align-items:center}.ai-lk .w{width:12px;height:2px;background:linear-gradient(90deg,#9fb3c8,var(--c));position:relative;overflow:hidden}
.ai-lk .w::after{content:"";position:absolute;inset:0;width:5px;background:#fff;animation:aiw 1.4s linear infinite}@keyframes aiw{from{transform:translateX(-5px)}to{transform:translateX(12px)}}
.ai-ico{width:24px;height:24px;border-radius:50%;display:inline-grid;place-items:center;border:1.5px solid var(--c);color:var(--c);background:color-mix(in srgb,var(--c) 16%,transparent)}
.ai-ico svg{width:13px;height:13px}.ai-lk.idle .ai-ico{opacity:.55;border-style:dashed}.ai-lk.idle .w::after{display:none}
.ai-tag{margin-left:8px;font:700 10px ui-monospace,monospace;letter-spacing:.12em;color:var(--mut);border:1px solid var(--line);border-radius:4px;padding:2px 6px;white-space:nowrap}
.m .via{display:flex;align-items:center;gap:5px;font-size:11.5px;color:var(--c);margin-bottom:2px}.m .via .ai-ico{width:16px;height:16px;border-width:1px}.m .via .ai-ico svg{width:10px;height:10px}
#aiDlg{margin:auto;max-height:calc(100vh - 32px);max-width:620px;width:calc(100% - 32px);border:1px solid var(--line);border-radius:10px;background:var(--panel);color:var(--txt);padding:0}
#aiDlg::backdrop{background:rgba(0,0,0,.6)}
#aiDlg .hd{display:flex;align-items:center;gap:10px;padding:14px 18px;border-bottom:1px solid var(--line)}#aiDlg .hd h2{font-size:17px;margin:0}
#aiDlg .bd{padding:14px 18px;max-height:70vh;overflow:auto;font-size:14px}
#aiDlg .bd>p{color:var(--mut);margin:0 0 12px;line-height:1.5}
.aip{border:1px solid var(--line);border-radius:8px;padding:10px 12px;margin:0 0 10px}
.aip h4{margin:0 0 6px;font-size:14px;display:flex;align-items:center;gap:8px}.aip h4 small{color:var(--mut);font-weight:400}
.aip .tag{font:700 10px ui-monospace,monospace;padding:1px 6px;border-radius:4px;border:1px solid}.aip .tag.free{color:#34d399;border-color:#34d399}.aip .tag.paid{color:#fbbf24;border-color:#fbbf24}
.aip input[type=password],.aip input[type=text],.aip select{width:100%;box-sizing:border-box;background:var(--page);color:var(--txt);border:1px solid var(--line);border-radius:6px;padding:7px 9px;font:inherit;margin-top:4px}
.aip .row{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:8px;font-size:13px}
.aip .out{font-size:12.5px;color:var(--mut)}.aip .out.ok{color:#34d399}.aip .out.bad{color:#f87171}.aip .out.warn{color:#fbbf24}
.aip a{color:#7cc4ff}.ai-sw input,.aip input[type=checkbox]{width:auto;margin:0}.ai-sw{display:flex;align-items:center;gap:8px;margin:0 0 12px;font-weight:600}
`;
  const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
}
function renderLinks() {
  const ids = connected();
  const tags = ['', 'LINKED', 'DUAL LINK', 'TRIPLE LINK', 'QUAD LINK'];
  const el = document.querySelector('#aiLinks'); if (!el) return;
  el.innerHTML = ids.map((id) => `<span class="ai-lk ${verified.has(id) && aiMode ? '' : 'idle'}" style="--c:${PROVIDERS[id].color}" title="SELENE ⟷ ${esc(PROVIDERS[id].name)}${verified.has(id) ? ' (working ✓)' : ' (not tested yet)'}"><b class="w"></b><span class="ai-ico">${ICON[id]}</span></span>`).join('')
    + (ids.length ? `<span class="ai-tag">${aiMode ? 'SELENE × ' + (ids.length > 4 ? ids.length + '-AI LINK' : tags[ids.length]) : 'AI PAUSED'}</span>` : '');
  const b = document.querySelector('#aiBtn');
  if (b) b.textContent = !ids.length ? 'AI mode: connect' : aiMode ? `AI mode: on · ${PROVIDERS[ids[0]].name}` : 'AI mode: off';
}
function setStatus(id, text, cls = '') { const o = document.querySelector(`#aiDlg [data-p=${id}] .out`); if (o) { o.textContent = text; o.className = 'out ' + cls; } }
function renderDialog() {
  const dlg = document.querySelector('#aiDlg');
  const nano = window.LanguageModel ? 'available in this browser' : 'not available in this browser (needs a recent desktop Chrome)';
  dlg.querySelector('.bd').innerHTML = `
    <p>AI mode lets SELENE talk naturally. Her onboard rules still run every command and the crisis check on this device; the AI writes the reply from her live health data. Connections are shared with <a href="https://jaigod.github.io/LUNA-AI/" target="_blank" rel="noopener">LUNA-X AI</a>: a key saved with “Remember” works in both.</p>
    <label class="ai-sw"><input type="checkbox" id="aiMode" ${aiMode ? 'checked' : ''}> AI mode on (SELENE uses the first connected AI, then the next if one fails)</label>
    ${ORDER.map((id) => {
      const p = PROVIDERS[id], v = settings[id];
      const tag = `<span class="tag ${p.free ? 'free' : 'paid'}">${p.free ? 'FREE' : 'PAID KEY'}</span>`;
      const fields = p.nokey
        ? `<div class="out">No key needed. Status: ${esc(nano)}.</div>`
        : `<label style="font-size:12.5px;color:var(--mut)">API key <a href="${p.keyUrl}" target="_blank" rel="noopener">get ${p.free ? 'a free' : 'a'} key ↗</a><input type="password" data-f="key" value="${esc(v.key)}" autocomplete="off" placeholder="${id === 'claude' ? 'sk-ant-…' : ''}"></label>`
          + (id === 'claude' ? `<label style="font-size:12.5px;color:var(--mut)">Model<select data-f="model">${Object.entries(CLAUDE_MODELS).map(([m, l]) => `<option value="${m}" ${m === v.model ? 'selected' : ''}>${l}</option>`).join('')}</select></label>` : '');
      return `<div class="aip" data-p="${id}"><h4><span class="ai-ico" style="--c:${p.color}">${ICON[id]}</span>${esc(p.name)} <small>${esc(p.org)}</small> ${tag}</h4>${fields}
        <div class="row"><label><input type="checkbox" data-f="enabled" ${v.enabled ? 'checked' : ''}> Enabled</label>${p.nokey ? '' : `<label><input type="checkbox" data-f="remember" ${v.remember ? 'checked' : ''}> Remember on this device</label>`}<button type="button" class="btn ghost" data-test style="padding:4px 10px">Test</button><span class="out"></span></div></div>`;
    }).join('')}
    <p style="font-size:12.5px">Claude and OpenAI need paid API keys. Gemini, Groq and OpenRouter have free keys, and Gemini Nano runs inside Chrome with no key. Keys stay in this browser and go only to their own provider. Anyone using this computer could copy a key from the page, so use keys with spending limits.</p>`;
}
async function test(id) {
  setStatus(id, 'Testing…');
  try {
    const out = await call(id, 'Reply with exactly: SELENE link OK', [{ role: 'user', content: 'Link test' }]);
    verified.add(id); renderLinks();
    setStatus(id, '✓ Connected: ' + out.slice(0, 60) + (PROVIDERS[id].nokey || settings[id].remember ? '' : ' (tick Remember to keep it after a refresh)'), 'ok');
    if (SELref) SELref.say(`${PROVIDERS[id].name} is connected. I can talk with you naturally now, and my onboard safety checks stay on.`, id);
  } catch (err) { setStatus(id, '✗ ' + friendly(id, err), 'bad'); }
}
function wireDialog() {
  const dlg = document.querySelector('#aiDlg');
  dlg.addEventListener('input', (e) => {
    const card = e.target.closest('[data-p]'); if (!card || e.target.dataset.f !== 'key') return;
    const id = card.dataset.p, v = e.target.value.trim(), shape = PROVIDERS[id].shape;
    if (/^https?:|\.com\b|\.ai\b/i.test(v)) { settings[id].key = ''; setStatus(id, '⚠ That is a web link, not a key. Open “get a key”, create one, and paste the long code here.', 'warn'); renderLinks(); return; }
    if (/\s/.test(v)) { setStatus(id, '⚠ The key has a space in it; paste it again.', 'warn'); return; }
    settings[id].key = v; if (v) settings[id].enabled = true;
    card.querySelector('[data-f=enabled]').checked = settings[id].enabled;
    saveSettings(); renderLinks();
    if (v && shape && !shape[0].test(v)) { setStatus(id, `⚠ That doesn't look right: ${shape[1]}.`, 'warn'); return; }
    setStatus(id, v ? 'Key entered. Checking…' : '');
    clearTimeout(card._t); if (v) card._t = setTimeout(() => test(id), 900);
  });
  dlg.addEventListener('change', (e) => {
    if (e.target.id === 'aiMode') { aiMode = e.target.checked; try { localStorage.setItem(MODE_KEY, aiMode ? 'on' : 'off'); } catch { /* ignore */ } renderLinks(); return; }
    const card = e.target.closest('[data-p]'); const f = e.target.dataset.f; if (!card || !f || f === 'key') return;
    const id = card.dataset.p;
    settings[id][f] = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    saveSettings(); renderLinks();
  });
  dlg.addEventListener('click', (e) => { if (e.target.matches('[data-test]')) { const id = e.target.closest('[data-p]').dataset.p; settings[id].enabled = true; dlg.querySelector(`[data-p=${id}] [data-f=enabled]`).checked = true; saveSettings(); renderLinks(); test(id); } });
}

export function init(SEL) {
  SELref = SEL;
  injectCSS();
  const h1 = document.querySelector('header h1');
  h1.insertAdjacentHTML('beforeend', '<span class="ai-links" id="aiLinks" aria-live="polite"></span>');
  const nav = document.querySelector('header nav');
  nav.insertAdjacentHTML('afterbegin', '<a href="https://jaigod.github.io/LUNA-AI/" target="_blank" rel="noopener">LUNA-X AI</a>');
  document.querySelector('.tools').insertAdjacentHTML('afterbegin', '<button type="button" id="aiBtn">AI mode: connect</button>');
  document.body.insertAdjacentHTML('beforeend', '<dialog id="aiDlg" aria-label="Connect AI"><div class="hd"><h2>SELENE AI connection</h2><button type="button" class="btn ghost" id="aiClose" style="margin-left:auto;padding:4px 12px">Close</button></div><div class="bd"></div></dialog>');
  const dlg = document.querySelector('#aiDlg');
  document.querySelector('#aiBtn').onclick = () => { renderDialog(); dlg.showModal(); };
  document.querySelector('#aiClose').onclick = () => dlg.close();
  wireDialog();
  renderLinks();
  return {
    active: () => aiMode && connected().length > 0,
    answer: (t) => answer(t, SEL),
    tag(el, id) {
      if (!el || !id) return;
      const p = PROVIDERS[id];
      const v = document.createElement('div'); v.className = 'via'; v.style.setProperty('--c', p.color);
      v.innerHTML = `<span class="ai-ico">${ICON[id]}</span>SELENE · via ${esc(p.name)}`;
      el.prepend(v);
    },
  };
}
