// SELENE Habitat tab: a 2D plan of the base with a per-room thermal model, a garden that feeds the crew,
// live device connection, and voice/text control through SELENE. Every number below is an assumption
// we chose and can defend; they are listed on the page itself (Assumptions) and in the README.

const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ---- plan geometry, in metres (the SVG viewBox is also in metres) ----
const ROOMS = [
  { id: 'green',  name: 'Greenhouse',        short: 'Greenhouse', x: 15, y: 1,  w: 12, h: 6, say: /greenhouse|garden|crop|plant|farm/ },
  { id: 'storm',  name: 'Storm shelter',     short: 'Storm shelter', x: 3, y: 1, w: 8,  h: 6, say: /storm|shelter/ },
  { id: 'quart',  name: 'Crew quarters',     short: 'Quarters',   x: 3,  y: 10, w: 10, h: 8, say: /quarters?|sleep|bedroom|pods?|dorm/ },
  { id: 'hub',    name: 'Core hub',          short: 'Core hub',   x: 17, y: 10, w: 8,  h: 8, say: /\bhub\b|core|common/ },
  { id: 'galley', name: 'Galley and wardroom', short: 'Galley',   x: 29, y: 10, w: 10, h: 8, say: /galley|wardroom|kitchen|dining|mess/ },
  { id: 'air',    name: 'Airlock and EVA prep', short: 'Airlock', x: 41, y: 10, w: 3,  h: 8, say: /airlock|\beva\b/ },
  { id: 'med',    name: 'Medical and hygiene', short: 'Medical',  x: 7,  y: 21, w: 8,  h: 6, say: /medical|sick ?bay|hygiene|shower|clinic/ },
  { id: 'gym',    name: 'Exercise',          short: 'Exercise',   x: 17, y: 21, w: 8,  h: 6, say: /exercise|gym|treadmill|workout/ },
  { id: 'sys',    name: 'Systems (air, water, power)', short: 'Systems', x: 29, y: 21, w: 8, h: 6, say: /systems?|eclss|power room|machinery/ },
];
const TUNNELS = [[13,13,4,2],[25,13,4,2],[39,13,2,2],[20,7,2,3],[20,18,2,3],[9,18,2,3],[32,18,2,3],[6,7,2,3]];
const HEIGHT = 3.0;                 // m ceiling
const BAND = [18.3, 26.7];          // ISS cabin band, 65 to 80 degF
const T_BOUND = -20;                // regolith-berm boundary temperature, assumption
const BUDGET_W = 9000;              // electrical power available to heating and cooling, assumption
const CREW = 4, KCAL_NEED = CREW * 2500;   // BVAD: 2500 kcal per person per day
const BED_CAP = 40;                 // m2 of growing bed that fits in the greenhouse

// per-m2 edible biomass (g/day) and energy density (kcal/g) are approximations; sources in README
const CROPS = [
  { k: 'potato',  name: 'Potato',  g: 18.4, kcal: 3.5, lo: 16, hi: 20, area: 14 },
  { k: 'wheat',   name: 'Wheat',   g: 11.3, kcal: 3.5, lo: 20, hi: 23, area: 8 },
  { k: 'tomato',  name: 'Tomato',  g: 9.8,  kcal: 3.0, lo: 22, hi: 26, area: 6 },
  { k: 'lettuce', name: 'Lettuce', g: 7.1,  kcal: 3.0, lo: 18, hi: 22, area: 6 },
  { k: 'soy',     name: 'Soybean', g: 6.0,  kcal: 4.2, lo: 24, hi: 27, area: 6 },
];
const factor = (c, T) => { const d = T < c.lo ? c.lo - T : T > c.hi ? T - c.hi : 0; return Math.max(0, 1 - d / 8); };

// who is where, by hour of day (4 crew). Anything not listed sits in the core hub.
const SCHED = (h) => {
  if (h >= 22 || h < 6) return { quart: 4 };
  if (h < 7)  return { med: 2, quart: 2 };
  if (h < 8)  return { galley: 4 };
  if (h < 12) return { green: 2, sys: 1 };
  if (h < 13) return { galley: 4 };
  if (h < 15) return { green: 1, med: 1 };
  if (h < 17) return { gym: 2, sys: 1 };
  if (h < 18) return { gym: 1 };
  if (h < 19) return { galley: 4 };
  return { galley: 2, quart: 2 };
};

const H = {
  sel: 'hub', speed: 60, clock: 8 * 60 * 60,           // simulated seconds since midnight, start 08:00
  over: {},                                            // per-room setpoint overrides
  T: {}, q: {}, harvest: 0, scale: 1, lastTick: 0, bt: null,
};
let SEL;                                               // hooks from the main page

const area = r => r.w * r.h;
const defaultSp = r => r.id === 'green' ? 21 : SEL.S.temp;
const sp = r => (H.over[r.id] ?? defaultSp(r));
const bedArea = () => CROPS.reduce((a, c) => a + c.area, 0);
const hourNow = () => Math.floor(H.clock / 3600) % 24;
const occ = (r, h = hourNow()) => { const s = SCHED(h); if (r.id in s) return s[r.id]; if (r.id === 'hub') return CREW - Object.values(s).reduce((a, b) => a + b, 0); return 0; };

function gain(r) {
  const h = hourNow(), n = occ(r, h);
  let w = n * (r.id === 'gym' ? 350 : 100);            // metabolic heat per person, resting 100 W, exercising 350 W
  const eq = { sys: 2500, hub: 200, med: 150, air: 50, storm: 0, quart: 120 }[r.id] ?? 0;
  w += eq;
  if (r.id === 'galley') w += [7, 12, 18].includes(h) ? 800 : 150;
  if (r.id === 'green' && h >= 6 && h < 22) w += 150 * bedArea();   // LED lighting, all of it ends up as heat
  return w;
}

function initTemps() { for (const r of ROOMS) if (H.T[r.id] == null) H.T[r.id] = sp(r); }

function step(dt) {                                    // dt simulated seconds, <= 60 for stability
  const want = {};
  for (const r of ROOMS) {
    const qmax = r.id === 'green' ? 9000 : area(r) * 60;
    want[r.id] = Math.max(-qmax, Math.min(qmax, 4000 * (sp(r) - H.T[r.id])));
  }
  const elec = id => want[id] >= 0 ? want[id] : -want[id] / 2.5;       // resistive heat COP 1, cooling COP 2.5
  const demand = ROOMS.reduce((a, r) => a + elec(r.id), 0);
  H.scale = demand > BUDGET_W ? BUDGET_W / demand : 1;                  // over budget: every room gets less
  for (const r of ROOMS) {
    const q = want[r.id] * H.scale; H.q[r.id] = q;
    const C = area(r) * 60e3, UA = area(r) * (r.id === 'green' ? 0.5 : 0.35);
    H.T[r.id] += (gain(r) + q - UA * (H.T[r.id] - T_BOUND)) / C * dt;
  }
  const g = CROPS.reduce((a, c) => a + c.area * c.g * c.kcal * factor(c, H.T.green), 0);
  H.harvest += g * dt / 86400;
  H.clock = (H.clock + dt) % 86400;
}
function advance(real) { let t = real * H.speed; while (t > 0) { const d = Math.min(60, t); step(d); t -= d; } }
const elecW = () => ROOMS.reduce((a, r) => a + (H.q[r.id] >= 0 ? H.q[r.id] : -H.q[r.id] / 2.5), 0);
const outBand = r => r.id === 'green' ? false : (H.T[r.id] < BAND[0] || H.T[r.id] > BAND[1]);
const clock = () => { const m = Math.floor(H.clock / 60); return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); };

// ---------------------------------------------------------------- plan drawing
const heat = T => { const d = Math.max(-6, Math.min(6, T - 22)) / 6;
  const a = d < 0 ? [70, 85, 100, 60, 125, 205] : [70, 85, 100, 225, 115, 60], k = Math.abs(d);
  return `rgb(${[0, 1, 2].map(i => Math.round(a[i] + (a[i + 3] - a[i]) * k)).join(',')})`; };
const rc = (x, y, w, h, c, extra = '') => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${c}" ${extra}/>`;
const FUR = {
  quart: r => [0, 1, 2, 3].map(i => `${rc(.5 + i * 2.4, .5, 2.1, 2.2, '#2b3642', 'stroke="#5d6b79" stroke-width=".08" rx=".15"')}${rc(.7 + i * 2.4, .7, 1.7, .6, '#8a97a4', 'rx=".1"')}`).join('') + rc(.6, 6, 3, .9, '#2b3642', 'stroke="#5d6b79" stroke-width=".08"'),
  hub: r => `<circle cx="4" cy="4" r="1.3" fill="#2b3642" stroke="#5d6b79" stroke-width=".08"/>` + [[1,1],[7,1],[1,7],[7,7]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r=".45" fill="#3a4654"/>`).join(''),
  galley: r => rc(1, .4, 8, .8, '#2b3642', 'stroke="#5d6b79" stroke-width=".08"') + rc(2, 3.2, 6, 1.5, '#2b3642', 'stroke="#5d6b79" stroke-width=".08" rx=".2"') + [2.6, 4.2, 5.8, 7.2].map(x => `<circle cx="${x}" cy="2.6" r=".3" fill="#3a4654"/><circle cx="${x}" cy="5.3" r=".3" fill="#3a4654"/>`).join(''),
  green: r => [1, 2.6, 4.2].map(y => rc(1, y, 10, 1, '#1f4a2c', 'stroke="#3fb950" stroke-width=".06" rx=".15"') + `<line x1="1" x2="11" y1="${y - .2}" y2="${y - .2}" stroke="#e3e8a0" stroke-width=".08" stroke-dasharray=".4 .3"/>`).join(''),
  med: r => rc(.6, .6, 2.1, .9, '#2b3642', 'stroke="#5d6b79" stroke-width=".08"') + rc(4.2, .6, 3, 1.6, '#2b3642', 'stroke="#5d6b79" stroke-width=".08"') + rc(5.6, 3.8, 1.8, 1.8, '#26303b', 'stroke="#5aa9d6" stroke-width=".08"'),
  gym: r => rc(.8, .8, 2.2, .9, '#2b3642', 'stroke="#5d6b79" stroke-width=".08"') + `<circle cx="5.5" cy="1.4" r=".7" fill="none" stroke="#5d6b79" stroke-width=".1"/>` + rc(1, 3.6, 5, 1.2, '#26303b', 'stroke="#5d6b79" stroke-width=".08"'),
  sys: r => [0, 1, 2, 3, 4].map(i => rc(.6 + i * 1.5, .5, 1.1, 2.4, '#26303b', 'stroke="#7d93a8" stroke-width=".07"')).join('') + rc(.6, 4, 6.5, 1.2, '#26303b', 'stroke="#e3a92b" stroke-width=".07"'),
  air: r => rc(.35, .6, 2.3, 2.6, '#26303b', 'stroke="#5d6b79" stroke-width=".08"') + `<circle cx="1.5" cy="1.9" r=".7" fill="none" stroke="#5d6b79" stroke-width=".08"/>` + [0, 1, 2].map(i => `<circle cx="${.8 + i * .7}" cy="5.3" r=".28" fill="#8a97a4"/>`).join(''),
  storm: r => rc(.35, .35, 7.3, 5.3, 'none', 'stroke="#3cc8f0" stroke-width=".35" opacity=".55"') + rc(1.2, 2.6, 5.6, .8, '#26303b', 'stroke="#5d6b79" stroke-width=".08"'),
};
function planSVG() {
  const door = (t, k) => { const [x, y, w, h] = t; return w > h ? rc(x - .15, y + .25, w + .3, h - .5, '#10161c') : rc(x + .25, y - .15, w - .5, h + .3, '#10161c'); };
  let s = `<svg viewBox="-1 -1 46 30" role="img" aria-label="Floor plan of the lunar habitat. Click a room to select it.">`;
  s += `<defs><pattern id="hg" width="1" height="1" patternUnits="userSpaceOnUse"><path d="M1 0H0V1" fill="none" stroke="#1a222b" stroke-width=".04"/></pattern></defs>${rc(-1, -1, 46, 30, 'url(#hg)')}`;
  for (const t of TUNNELS) s += rc(t[0], t[1], t[2], t[3], '#18202a', 'stroke="#6b7a89" stroke-width=".2"');
  for (const r of ROOMS) {
    const T = H.T[r.id], sel = r.id === H.sel, bad = outBand(r), n = occ(r);
    s += `<g class="room" data-r="${r.id}" tabindex="0" role="button" aria-label="${esc(r.name)}, ${T.toFixed(1)} degrees Celsius">`;
    s += `<rect class="fill" x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" rx=".5" fill="${heat(T)}" fill-opacity=".55" stroke="${sel ? '#ffc94d' : bad ? '#e5484d' : '#aab4be'}" stroke-width="${sel ? .4 : .28}"/>`;
    s += `<g transform="translate(${r.x},${r.y})" opacity=".9">${FUR[r.id](r)}</g>`;
    const cx = r.x + r.w / 2, vertical = r.w < 4;
    s += `<text x="${cx}" y="${r.y + r.h - (vertical ? 3.4 : 2.1)}" text-anchor="middle" font-size="${vertical ? .8 : .95}" fill="#e3e8ee" stroke="#10161c" stroke-width=".25" paint-order="stroke">${esc(r.short)}</text>`;
    s += `<text x="${cx}" y="${r.y + r.h - (vertical ? 2 : .6)}" text-anchor="middle" font-size="${vertical ? 1 : 1.35}" font-weight="600" fill="#fff" stroke="#10161c" stroke-width=".25" paint-order="stroke">${T.toFixed(1)}°</text>`;
    for (let i = 0; i < n; i++) s += `<circle cx="${r.x + r.w - .7 - (i % 4) * .6}" cy="${r.y + .6 + Math.floor(i / 4) * .6}" r=".24" fill="#ffc94d"/>`;
    s += `</g>`;
  }
  TUNNELS.forEach(t => s += door(t));
  s += `<g stroke="#e3e8ee" stroke-width=".12" fill="#e3e8ee" font-size=".75"><path d="M1 27.2H6M1 26.9V27.5M6 26.9V27.5"/><text x="3.5" y="26.5" text-anchor="middle" stroke="none">5 m</text></g>`;
  s += `<text x="44" y="-.2" text-anchor="end" font-size=".8" fill="#93a0ad">Overhead view, north up. Walls are shielded by a regolith berm.</text></svg>`;
  return s;
}

// ---------------------------------------------------------------- cards
function roomCard() {
  const r = ROOMS.find(x => x.id === H.sel), T = H.T[r.id], q = H.q[r.id] || 0, s = sp(r);
  const ok = r.id === 'green' ? true : !outBand(r);
  const mode = Math.abs(q) < 20 ? 'holding' : q > 0 ? 'heating' : 'cooling';
  return `<h3>${esc(r.name)}</h3>
  <div class="big">${T.toFixed(1)} °C <span class="tag ${ok ? 'ok' : 'warn'}">${ok ? (r.id === 'green' ? 'crop band set by crops' : 'in range') : T < BAND[0] ? 'too cold' : 'too warm'}</span></div>
  <div class="stepper" role="group" aria-label="Setpoint"><button data-sp="-.5" aria-label="Lower setpoint">−</button><b>${s.toFixed(1)} °C</b><button data-sp=".5" aria-label="Raise setpoint">+</button><button class="btn" data-sp="reset" ${H.over[r.id] == null ? 'disabled' : ''}>Reset</button></div>
  <div class="kv"><span>Setpoint</span><div>${H.over[r.id] == null ? (r.id === 'green' ? 'greenhouse default' : 'follows habitat default') : 'set by you'}</div>
  <span>HVAC</span><div>${mode}, ${Math.abs(q).toFixed(0)} W thermal, ${(q >= 0 ? q : -q / 2.5).toFixed(0)} W electric</div>
  <span>Internal heat</span><div>${gain(r).toFixed(0)} W from ${occ(r)} crew and equipment</div>
  <span>Floor area</span><div>${area(r)} m², ${(area(r) * HEIGHT).toFixed(0)} m³</div></div>
  ${H.scale < 1 ? `<p class="warn">Power limit: rooms are getting ${(H.scale * 100).toFixed(0)}% of the heating and cooling they asked for.</p>` : ''}`;
}
function totalsCard() {
  const e = elecW(), bad = ROOMS.filter(outBand), cold = ROOMS.filter(r => r.id === 'green' && false);
  return `<h3>Habitat climate</h3>
  <div class="kv"><span>Simulated time</span><div>${clock()} <select id="hSpeed" aria-label="Simulation speed"><option value="60">1 s = 1 min</option><option value="600">1 s = 10 min</option><option value="3600">1 s = 1 h</option></select></div>
  <span>Heating and cooling power</span><div>${(e / 1000).toFixed(2)} of ${(BUDGET_W / 1000).toFixed(0)} kW</div></div>
  <div class="track"><i style="width:${Math.min(100, e / BUDGET_W * 100)}%;background:${e > BUDGET_W * .9 ? 'var(--caut)' : 'var(--ok)'}"></i></div>
  <div class="kv"><span>Habitat default</span><div><button class="btn" data-def="-.5" aria-label="Lower default">−</button> <b>${SEL.S.temp.toFixed(1)} °C</b> <button class="btn" data-def=".5" aria-label="Raise default">+</button></div></div>
  ${bad.length ? `<ul class="al">${bad.map(r => `<li class="warn">${esc(r.name)} is ${H.T[r.id] < BAND[0] ? 'below' : 'above'} the ${BAND[0]} to ${BAND[1]} °C cabin band (${H.T[r.id].toFixed(1)} °C).</li>`).join('')}</ul>` : '<p class="ok">All crew rooms are inside the 18.3 to 26.7 °C cabin band.</p>'}`;
}
function gardenCard() {
  const T = H.T.green; let kcal = 0, g = 0;
  const rows = CROPS.map(c => { const f = factor(c, T), gd = c.area * c.g * f, kc = gd * c.kcal; kcal += kc; g += gd;
    return `<tr><td>${c.name}</td><td><input type="range" min="0" max="${BED_CAP}" step="1" value="${c.area}" data-crop="${c.k}" aria-label="${c.name} bed area"></td><td>${c.area} m²</td><td>${gd.toFixed(0)} g</td><td>${kc.toFixed(0)}</td><td class="${f > .85 ? 'ok' : f > .5 ? 'caut' : 'warn'}">${(f * 100).toFixed(0)}%</td></tr>`; }).join('');
  const lights = 150 * bedArea();
  return `<h3>Garden: how much of the crew's food it grows</h3>
  <table><thead><tr><th>Crop</th><th>Bed area</th><th></th><th>Edible, per day</th><th>kcal/day</th><th>Temp. factor</th></tr></thead><tbody>${rows}</tbody></table>
  <div class="kv"><span>Beds used</span><div>${bedArea()} of ${BED_CAP} m² (${(bedArea() / BED_CAP * 100).toFixed(0)}%)</div>
  <span>Food from the garden</span><div><b>${kcal.toFixed(0)} kcal/day = ${(kcal / KCAL_NEED * 100).toFixed(0)}%</b> of what ${CREW} crew need (${KCAL_NEED} kcal)</div>
  <span>Grown so far</span><div>${H.harvest.toFixed(0)} kcal this session</div>
  <span>Lighting load</span><div>${(lights / 1000).toFixed(1)} kW of LEDs for 16 h a day. The greenhouse cooling has to remove all of it.</div></div>
  <p class="note">The whole greenhouse is held at one temperature (now ${T.toFixed(1)} °C), so crops with different best ranges trade off. Change the greenhouse setpoint and watch the temperature factors move. Real life support grows only part of the diet; the rest is stored food.</p>`;
}
function deviceCard() {
  const live = SEL.S.live && Date.now() - SEL.S.live.t < 30000;
  const bt = 'bluetooth' in navigator;
  return `<h3>Connect a device</h3>
  <div class="hr">${live ? SEL.S.live.hr + ' bpm' : '— bpm'}</div><div class="sub" id="hDev">${live ? 'Live from ' + esc(SEL.S.live.src) + ' for ' + esc(SEL.S.liveFor) + '. Shown on the Dashboard.' : 'No device connected.'}</div>
  <div class="chips" style="margin-top:10px"><button class="btn" id="hBt" ${bt ? '' : 'disabled'}>Connect Bluetooth heart-rate device</button>
  <label class="btn" style="cursor:pointer">Import Apple Health export.xml<input id="hXml" type="file" accept=".xml,text/xml" hidden></label></div>
  <p class="note">${bt ? 'Works with any strap or watch that broadcasts heart rate over standard Bluetooth (Polar, Wahoo, Garmin in broadcast mode, many Wear OS watches). The reading goes to whoever is selected in the crew bar.' : 'This browser has no Web Bluetooth. Use Chrome or Edge on a PC or Android phone.'}
  <br><b>Apple Watch:</b> Apple does not let a website read the watch directly, and Web Bluetooth does not exist on iPhone Safari. Two ways in: export your data (Health app, profile picture, Export All Health Data, unzip, pick <code>export.xml</code> above), or use a free heart-rate broadcasting app on the watch so it appears as a Bluetooth sensor. We have tested neither with a real Apple Watch.</p>`;
}
function askCard() {
  return `<h3>Ask SELENE about the habitat</h3>
  <form class="ask" id="hAsk"><input id="hIn" placeholder="Try: set the greenhouse to 22 degrees" autocomplete="off" aria-label="Ask SELENE"><button class="btn" type="submit">Ask</button><button class="btn" type="button" id="hMic" aria-label="Speak">Speak</button></form>
  <div class="say" id="hSay" aria-live="polite">${esc(H.last || 'SELENE can change any room, report temperatures and tell you how much food the garden is growing.')}</div>
  <div class="chips">${['How warm is the galley?', 'Set the quarters to 20 degrees', 'How much food do we grow?', 'Which rooms are out of range?', 'Make the greenhouse 23 degrees'].map(t => `<button data-q="${esc(t)}">${esc(t)}</button>`).join('')}</div>`;
}
const ASSUME = `<h3>Assumptions</h3><p class="note" style="margin-top:0">Cabin band 18.3 to 26.7 °C (ISS, NASA). Wall boundary ${T_BOUND} °C (buried in regolith, insulated). Heat loss 0.35 W per K per m² of floor (0.5 for the greenhouse). Thermal mass 60 kJ/K per m². People give off 100 W resting, 350 W exercising. Resistive heating COP 1, cooling COP 2.5. Heating and cooling share ${BUDGET_W / 1000} kW; if the rooms ask for more, every room is cut back equally. Garden yields are edible biomass per m² from NASA's life support baseline (potato 18.4, wheat 11.3, tomato 9.8, lettuce 7.1, soy 6.0 g/day), lighting 150 W/m². Crop temperature bands and kcal per gram are rounded textbook values. The room layout is our concept, not a flight design.</p>`;

let hViewEl;
function focusKey() { const a = document.activeElement; if (!a || !hViewEl.contains(a)) return null; for (const k of ['sp', 'def', 'q', 'r']) if (a.dataset && a.dataset[k] !== undefined) return `[data-${k}="${a.dataset[k]}"]`; return a.id ? '#' + a.id : null; }
function draw(full, force = true) {
  if (!hViewEl || hViewEl.hidden) return;
  const fk = force ? focusKey() : null, busy = !force && hViewEl.contains(document.activeElement) && document.activeElement !== hViewEl;
  if (full || !hViewEl.dataset.built) {
    hViewEl.dataset.built = 1;
    hViewEl.innerHTML = `<section class="card plan"><h3>Habitat plan</h3><div id="hPlan"></div><p class="sub">Colour shows temperature: blue is cool, orange is warm. Yellow dots are crew. Click a room.</p></section>
      <section class="card" id="hRoom"></section><section class="card" id="hTot"></section>
      <section class="card full" id="hGarden"></section><section class="card" id="hDevC"></section><section class="card" id="hAskC"></section><section class="card full">${ASSUME}</section>`;
    $('#hAskC').innerHTML = askCard(); $('#hDevC').innerHTML = deviceCard(); $('#hGarden').innerHTML = gardenCard(); wire();
  }
  $('#hPlan').innerHTML = planSVG(); if (!busy || !$('#hRoom').contains(document.activeElement)) $('#hRoom').innerHTML = roomCard();
  const sp0 = $('#hSpeed'); const had = sp0 && document.activeElement === sp0;
  if (!had && !(busy && $('#hTot').contains(document.activeElement))) { $('#hTot').innerHTML = totalsCard(); const s = $('#hSpeed'); if (s) s.value = H.speed; }
  const act = document.activeElement;
  if (!(act && act.dataset && act.dataset.crop)) $('#hGarden').innerHTML = gardenCard();
  if (fk) { const el = $(fk, hViewEl); if (el && !el.disabled) el.focus({ preventScroll: true }); }
}
function wire() {
  hViewEl.addEventListener('click', e => {
    const room = e.target.closest('[data-r]'); if (room) { H.sel = room.dataset.r; draw(); return; }
    const spb = e.target.closest('[data-sp]'); if (spb) { const r = ROOMS.find(x => x.id === H.sel);
      if (spb.dataset.sp === 'reset') delete H.over[r.id]; else setSp(r, sp(r) + +spb.dataset.sp); draw(); return; }
    const df = e.target.closest('[data-def]'); if (df) { SEL.S.temp = Math.min(26, Math.max(18, SEL.S.temp + +df.dataset.def)); SEL.render(); draw(); return; }
    const q = e.target.closest('[data-q]'); if (q) { SEL.ask(q.dataset.q); return; }
    if (e.target.id === 'hBt') connectBt(); if (e.target.id === 'hMic') SEL.listen(true);
  });
  hViewEl.addEventListener('keydown', e => { const room = e.target.closest && e.target.closest('[data-r]'); if (room && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); H.sel = room.dataset.r; draw(); } });
  hViewEl.addEventListener('input', e => { const k = e.target.dataset && e.target.dataset.crop; if (!k) return;
    const c = CROPS.find(x => x.k === k), others = bedArea() - c.area; c.area = Math.min(+e.target.value, BED_CAP - others); e.target.value = c.area;
    const row = e.target.closest('tr'); row.cells[2].textContent = c.area + ' m²'; });
  hViewEl.addEventListener('change', e => { if (e.target.id === 'hSpeed') H.speed = +e.target.value; if (e.target.dataset.crop) draw(); if (e.target.id === 'hXml' && e.target.files[0]) importXml(e.target.files[0]); });
  hViewEl.addEventListener('submit', e => { if (e.target.id === 'hAsk') { e.preventDefault(); const i = $('#hIn'); if (i.value.trim()) { SEL.ask(i.value); i.value = ''; } } });
}
function setSp(r, v) { const lim = r.id === 'green' ? [15, 30] : [18, 26]; H.over[r.id] = Math.round(Math.min(lim[1], Math.max(lim[0], v)) * 2) / 2; }

// ---------------------------------------------------------------- devices
async function connectBt() {
  const note = t => { const e = $('#hDev'); if (e) e.textContent = t; };
  try {
    note('Choose your device in the browser prompt…');
    const dev = await navigator.bluetooth.requestDevice({ filters: [{ services: ['heart_rate'] }] });
    const srv = await dev.gatt.connect(), ch = await (await srv.getPrimaryService('heart_rate')).getCharacteristic('heart_rate_measurement');
    await ch.startNotifications(); H.bt = dev;
    let last = 0;
    ch.addEventListener('characteristicvaluechanged', ev => { const dv = ev.target.value, hr = dv.getUint8(0) & 1 ? dv.getUint16(1, true) : dv.getUint8(1);
      if (hr < 25 || hr > 230) return;                                  // ignore sensor glitches
      SEL.S.live = { hr, t: Date.now(), src: dev.name || 'Bluetooth sensor' }; SEL.S.liveFor = SEL.S.aid;
      if (Date.now() - last > 1000) { last = Date.now(); SEL.render(); if (!hViewEl.hidden) $('#hDevC').innerHTML = deviceCard(); } });
    dev.addEventListener('gattserverdisconnected', () => { SEL.S.live = null; SEL.render(); note('Device disconnected.'); });
    note('Connected to ' + (dev.name || 'sensor') + '. Waiting for the first reading…');
  } catch (e) { note(e.name === 'NotFoundError' ? 'No device chosen.' : 'Could not connect: ' + (e.message || e.name)); }
}
async function importXml(file) {
  const note = t => { const e = $('#hDev'); if (e) e.textContent = t; };
  note('Reading ' + file.name + '…');
  const re = /<Record type="HKQuantityTypeIdentifierHeartRate"[^>]*?startDate="([^"]+)"[^>]*?value="([\d.]+)"/g;
  let carry = '', n = 0; const recs = [];
  for (let off = 0; off < file.size; off += 16e6) {
    const txt = carry + await file.slice(off, off + 16e6).text(); let m, end = 0; re.lastIndex = 0;
    while ((m = re.exec(txt))) { recs.push([m[1], +m[2]]); end = re.lastIndex; n++; if (recs.length > 50000) recs.splice(0, 25000); }
    carry = txt.slice(Math.max(end, txt.length - 600));
  }
  if (!n) { note('No heart-rate records found. Pick export.xml from the unzipped Apple Health export.'); return; }
  recs.sort((a, b) => a[0] < b[0] ? -1 : 1); const last = recs[recs.length - 1], day = recs.slice(-1440).map(r => r[1]);
  note(`${n.toLocaleString()} heart-rate records. Latest: ${Math.round(last[1])} bpm at ${last[0]}. Recent readings: low ${Math.min(...day)}, average ${Math.round(day.reduce((a, b) => a + b, 0) / day.length)}, high ${Math.max(...day)} bpm. This is stored history, so it is not shown as live.`);
}

// ---------------------------------------------------------------- voice and text
const num = t => { const m = t.match(/(\d{2}(?:\.\d)?)\s*(?:degrees|°|c\b|celsius)?/); return m ? +m[1] : null; };
function findRoom(t) { return ROOMS.find(r => r.say.test(t)); }
function reply(raw) {
  const t = raw.toLowerCase(), r = findRoom(t);
  if (/(show|open|go to|see).*(habitat|floor ?plan|map|base)|^habitat$/.test(t)) { SEL.showView('hab'); return 'Here is the habitat plan. Click any room to see and change its temperature.'; }
  if (/out of range|too (hot|cold|warm)|problems?.*(room|habitat)|which rooms/.test(t)) {
    const bad = ROOMS.filter(outBand); return bad.length ? bad.map(x => `${x.name} is ${H.T[x.id].toFixed(1)} °C`).join('; ') + `. The cabin band is ${BAND[0]} to ${BAND[1]} °C.` : `Every crew room is inside the ${BAND[0]} to ${BAND[1]} °C cabin band.`; }
  if (/food|harvest|crops?|grow|garden|yield|calories?/.test(t) && !/set|make|change|warm|cool/.test(t)) {
    const kc = CROPS.reduce((a, c) => a + c.area * c.g * c.kcal * factor(c, H.T.green), 0);
    return `The garden grows about ${kc.toFixed(0)} kcal a day on ${bedArea()} m² of beds at ${H.T.green.toFixed(1)} °C. That is ${(kc / KCAL_NEED * 100).toFixed(0)}% of the ${KCAL_NEED} kcal the crew eats; the rest comes from stored food.`; }
  if (r && /(set|make|change|put|turn|warm|cool|heat|raise|lower).*/.test(t) && num(t) != null) {
    const v = num(t), lim = r.id === 'green' ? [15, 30] : [18, 26];
    if (v < lim[0] || v > lim[1]) return `I can set the ${r.name.toLowerCase()} between ${lim[0]} and ${lim[1]} °C. ${v} is outside that.`;
    setSp(r, v); H.sel = r.id; draw();
    return `${r.name} setpoint is ${v.toFixed(1)} °C. It is ${H.T[r.id].toFixed(1)} °C now and will take a while to get there because the room has a lot of thermal mass.`; }
  if (r && /(warm|cold|hot|cool|temperature|temp|degrees|how)/.test(t)) {
    const q = H.q[r.id] || 0; return `${r.name} is ${H.T[r.id].toFixed(1)} °C with a setpoint of ${sp(r).toFixed(1)} °C, ${Math.abs(q) < 20 ? 'holding' : q > 0 ? 'heating' : 'cooling'}.`; }
  return null;
}

// ---------------------------------------------------------------- init
export function init(S_) {
  SEL = S_; hViewEl = $('#habView'); initTemps();
  window.SELENE_HAB = { reply, show: () => draw(true) };
  const log = $('#log');
  if (log) new MutationObserver(ms => { for (const m of ms) for (const n of m.addedNodes) if (n.classList && n.classList.contains('s') && n.firstChild) { H.last = n.firstChild.textContent; const e = $('#hSay'); if (e) e.textContent = H.last; } }).observe(log, { childList: true });
  let prev = performance.now();
  setInterval(() => { const now = performance.now(), dt = Math.min(2, (now - prev) / 1000); prev = now; advance(dt); draw(false, false); }, 1000);
  document.addEventListener('selene-view', e => { if (e.detail === 'hab') draw(true); });
}
