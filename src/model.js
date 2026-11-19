// Micturition-cycle simulator — pure model (no DOM).
// Each run is one bladder cycle as seen in the urodynamics lab: filling at a fixed rate (filling cystometry),
// then voiding (pressure–flow + uroflowmetry). Pves = Pabd + Pdet. Values marked "Model" are teaching assumptions.

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export const GAUGES = {
  vol: { unit: 'mL', dec: 0, normal: null, yMin: 0 },
  pdet: { unit: 'cmH₂O', dec: 0, normal: null, yMin: 0 },
  pves: { unit: 'cmH₂O', dec: 0, normal: null, yMin: 0 },
  pabd: { unit: 'cmH₂O', dec: 0, normal: null, yMin: 0 },
  flujo: { unit: 'mL/s', dec: 1, normal: null, yMin: 0 },
  qmax: { unit: 'mL/s', dec: 1, normal: [15, 50], yMin: 0 },
  residuo: { unit: 'mL', dec: 0, normal: null, yMin: 0 },
  rpm: { unit: '%', dec: 0, normal: [0, 10], yMin: 0 },
  fugas: { unit: 'mL', dec: 0, normal: [0, 0], yMin: 0 },
  emg: { unit: '0–3', dec: 1, normal: null, yMin: 0, yMax: 3 },
};

/** Normal adult reference (basis in comments). */
export const NORMAL = {
  infusion: 100,    // mL/min — fast-fill cystometry rate (50–100 mL/min), keeps the void visible on the time axis
  capacidad: 400,   // mL — physiological capacity 350–450 mL
  compliance: 40,   // mL/cmH2O — Pdet rises < 10 cmH2O during filling ("acomodación")
  pmax: 60,         // cmH2O — isovolumetric detrusor pressure (Model)
  ri: 1,            // cmH2O·s/mL — internal "resistance" of the detrusor pump (Model)
  rUretra: 1,       // cmH2O·s/mL — urethral resistance (Model): Q = (Pmax − Popen)/(Ri + R) ≈ 25 mL/s
  popen: 10,        // cmH2O — urethral opening pressure
  pabd: 8,          // cmH2O — resting abdominal pressure
};

const R = (key, min, max, step, def, unit = '', dec = 0) => ({ key, min, max, step, def, unit, dec });
const Ch = (key, options, def) => ({ key, type: 'choice', options, def });
const E = (key, loc, params, tiles, charts, steps, treat = true) => ({ key, loc, unit: 'minutes', tMax: 6, dt: 0.01, treat, params, tiles, charts, steps });

export const ENTITIES = [
  E('normal', 'ciclo', [R('capacidad', 300, 550, 10, 400, 'mL'), R('infusion', 50, 150, 10, 100, 'mL/min')],
    ['vol', 'pdet', 'flujo', 'qmax', 'rpm'], ['vol', 'pdet', 'flujo'],
    ['llenado', 'acomodacion', 'deseo', 'suelo', 'contraccion', 'vaciado'], false),
  E('iuu', 'detrusor', [R('umbral', 100, 350, 10, 200, 'mL'), R('amplitud', 15, 80, 5, 45, 'cmH₂O'), Ch('origen', ['idiopatica', 'neurologica'], 'idiopatica')],
    ['vol', 'pdet', 'fugas', 'qmax'], ['pdet', 'fugas'],
    ['llenado', 'inestable', 'contraccion_inv', 'urgencia', 'fuga']),
  E('iue', 'esfinter', [R('alpp', 20, 120, 5, 50, 'cmH₂O'), R('tos', 40, 160, 10, 110, 'cmH₂O')],
    ['vol', 'pabd', 'pves', 'fugas'], ['pves', 'fugas'],
    ['llenado', 'tos', 'cierre', 'fuga_esfuerzo', 'estable']),
  E('obstruccion', 'uretra', [R('resistencia', 2, 10, 0.5, 6, '×', 1), R('hipertrofia', 1, 2, 0.1, 1.6, '×', 1)],
    ['pdet', 'flujo', 'qmax', 'rpm'], ['pdet', 'flujo'],
    ['llenado', 'contraccion', 'resistencia', 'presion_alta', 'flujo_bajo']),
  E('hipoactivo', 'detrusor', [R('contractilidad', 0.2, 0.9, 0.05, 0.45, '×', 2), R('duracion', 20, 120, 5, 70, 's')],
    ['pdet', 'flujo', 'qmax', 'residuo', 'rpm'], ['pdet', 'flujo'],
    ['llenado', 'contraccion_debil', 'presion_baja', 'flujo_bajo', 'residuo']),
  E('disinergia', 'pontino', [R('cierres', 1, 6, 1, 3, ''), R('intensidad', 30, 100, 5, 70, 'cmH₂O')],
    ['pdet', 'flujo', 'emg', 'rpm'], ['pdet', 'flujo'],
    ['llenado', 'sin_coordinacion', 'contraccion', 'esfinter_cerrado', 'presion_alta', 'flujo_interrumpido']),
  E('suelo_hipertonico', 'suelo', [R('tono', 20, 80, 5, 40, 'cmH₂O'), R('relajacion', 5, 40, 5, 20, 's')],
    ['pdet', 'flujo', 'qmax', 'emg'], ['flujo', 'emg'],
    ['llenado', 'suelo_tenso', 'retraso', 'flujo_bajo']),
  E('edad', 'cortex', [Ch('etapa', ['lactante', 'anciano'], 'anciano')],
    ['vol', 'pdet', 'fugas', 'qmax', 'rpm'], ['vol', 'pdet'],
    ['llenado', 'control_cortical', 'contraccion_inv', 'vaciado']),
];

export function defaults(key) {
  const e = ENTITIES.find(x => x.key === key);
  return Object.fromEntries(e.params.map(p => [p.key, p.def]));
}

/* Bladder engine. cfg describes one patient:
   capacidad, infusion, compliance, pmax, ri, rUretra, popen(tv, t) → opening pressure during voiding,
   fatigue τ (s) of the voiding contraction, waves {umbral, amp} of involuntary contractions,
   alpp (leak point), coughs {from, amp}, emg(t) for the pelvic floor during voiding, reflex (voids at capacity without voluntary hold). */
function cycle(e, cfg, emitSteps) {
  const points = [], events = [], fired = new Set();
  const emit = (t, k, args = []) => { if (fired.has(k)) return; fired.add(k); events.push({ t, key: k, args }); };
  let waveCount = 0, inWave = false, wavePeak = 0, vol = 0, voiding = false, tv = 0, voided = 0, qmax = 0, fugas = 0, done = false, peaked = false, residuo = 0, pdetVoid = 0;
  const n = Math.round(e.tMax / e.dt);
  const dts = e.dt * 60; // seconds per step
  for (let i = 0; i <= n; i++) {
    const t = +(i * e.dt).toFixed(6);
    let pdet = 0, flujo = 0, pabd = cfg.pabd ?? NORMAL.pabd, emg = 0, leak = 0;
    const act = new Set(['llenado']);
    if (!voiding && !done) {
      if (i > 0) vol += cfg.infusion * e.dt;
      pdet = vol / cfg.compliance;
      // involuntary detrusor waves (overactivity)
      if (cfg.waves && vol >= cfg.waves.umbral) {
        const ph = ((t * 60) % cfg.waves.period) / cfg.waves.period;
        const w = ph < 0.35 ? Math.sin(Math.PI * ph / 0.35) : 0;
        pdet += cfg.waves.amp * w;
        if (w > 0.2) { act.add('contraccion_inv'); act.add('urgencia'); emit(t, 'contraccion_inv'); inWave = true; wavePeak = Math.max(wavePeak, w); } else { if (inWave && wavePeak > 0.8) waveCount++; inWave = false; wavePeak = 0; }
      }
      // coughs every 30 s from `from` mL (abdominal leak-point test at ~200 mL)
      if (cfg.coughs && vol >= cfg.coughs.from) {
        const ph = (t * 60) % 30;
        if (ph < 2) { pabd += cfg.coughs.amp * Math.sin(Math.PI * ph / 2); act.add('tos'); }
      }
      emg = cfg.reflex ? 0.3 : 1 + Math.min(1, vol / cfg.capacidad);  // guarding reflex: pelvic floor activity rises with filling
      const pves = pabd + pdet;
      // leaks: detrusor wave above the closing pressure, or Pves above the abdominal leak point
      const closing = cfg.closing ?? 40;
      if (cfg.waves && pdet > closing) leak += (pdet - closing) * 0.15 * dts;
      if (cfg.coughs && pabd > (cfg.pabd ?? NORMAL.pabd) + 5 && pves >= cfg.alpp) leak += (pves - cfg.alpp) * 0.05 * dts;
      if (leak > 0) { leak = Math.min(leak, vol); vol -= leak; fugas += leak; act.add('fuga'); emit(t, cfg.coughs ? 'fuga_esfuerzo' : 'fuga', [Math.round(cfg.alpp ?? 0)]); }
      if (vol >= 150) { act.add('deseo'); emit(t, 'deseo'); }
      if (vol >= cfg.capacidad * 0.6) act.add('acomodacion');
      // the second involuntary contraction cannot be held: it becomes the void (urgency, low functional capacity)
      const urgentVoid = cfg.waves && waveCount >= 1 && wavePeak > 0.5;
      if (vol >= cfg.capacidad || urgentVoid) { voiding = true; tv = 0; emit(t, 'capacidad', [Math.round(vol)]); }
    }
    if (voiding && !done) {
      tv += dts;
      // contraction: ramps up over ~4 s, fades with fatigue τ, weaker at low volume
      const ramp = Math.min(1, tv / 4);
      const fade = cfg.fatigue ? Math.exp(-tv / cfg.fatigue) : 1;
      const volF = Math.min(1, Math.sqrt(vol / 60));
      const force = cfg.pmax * ramp * fade * volF;
      const popen = cfg.popen(tv, t);
      emg = cfg.emg ? cfg.emg(tv) : (tv < 3 ? 0.8 : 0.1);
      flujo = Math.max(0, (force - popen) / (cfg.ri + cfg.rUretra));
      pdet = flujo > 0 ? popen + flujo * cfg.rUretra : force;
      const dv = Math.min(vol, flujo * dts);
      vol -= dv; voided += dv; qmax = Math.max(qmax, flujo);
      pdetVoid = Math.max(pdetVoid, pdet);
      if (flujo > 2) peaked = true;
      act.add('contraccion');
      if (flujo > 0) act.add('vaciado');
      if (vol < 1 || (peaked && flujo < 0.3 && force < (cfg.popenMin ?? popen) + 1 && tv > 8) || tv > 150) {
        done = true; residuo = vol; emit(t, 'fin', [Math.round(qmax), Math.round(residuo)]);
        if (qmax < 10) emit(t, 'qmax_bajo', [Math.round(qmax)]);
        if (voided + residuo > 0 && residuo / (voided + residuo) > 0.2) emit(t, 'residuo', [Math.round(residuo)]);
      }
      if (tv < 6) act.add('suelo');
    }
    if (done) { pdet = 0; flujo = 0; emg = 0.8; }
    const total = voided + residuo;
    const g = { vol, pdet, pabd, pves: pabd + pdet, flujo, qmax, residuo: done ? residuo : 0, rpm: done && total > 0 ? 100 * residuo / total : 0, fugas, emg };
    for (const k of Object.keys(g)) g[k] = Number.isFinite(g[k]) ? Math.max(0, g[k]) : 0;
    const active = emitSteps(act, g, { voiding, done, tv, pdetVoid }).filter(s => e.steps.includes(s));
    points.push({ t, g, active, lesion: clamp(cfg.lesion ?? 0, 0, 1), badge: cfg.badge ?? null });
  }
  return { points, events };
}

const normalCfg = (o = {}) => ({ ...NORMAL, popen: () => NORMAL.popen, ...o });

function cfgFor(key, p) {
  switch (key) {
    case 'normal': return normalCfg({ capacidad: p.capacidad, infusion: p.infusion });
    // Detrusor overactivity: involuntary, non-suppressible contractions from a threshold volume; leaks when they
    // exceed urethral closing pressure. Neurogenic ("hiperreflexia") = larger, earlier waves (Model).
    case 'iuu': {
      const neuro = p.origen === 'neurologica';
      return normalCfg({ waves: { umbral: p.umbral * (neuro ? 0.8 : 1), amp: p.amplitud * (neuro ? 1.3 : 1), period: 45 }, capacidad: 400,
        lesion: p.amplitud / 80, badge: neuro ? 'hiperreflexia' : 'hiperactividad' });
    }
    // Stress incontinence: coughs from 200 mL; leak when Pves ≥ ALPP. ALPP > 60 = urethral hypermobility,
    // < 60 = intrinsic sphincter deficiency, < 30 = very weak sphincter (McGuire).
    case 'iue': return normalCfg({ coughs: { from: 200, amp: p.tos }, alpp: p.alpp, lesion: 1 - p.alpp / 120,
      badge: p.alpp < 30 ? 'muy_debil' : p.alpp < 60 ? 'dei' : 'hipermovilidad' });
    // Outlet obstruction (BPH, stricture): high urethral resistance; the detrusor hypertrophies (higher Pmax)
    // → high pressure, low flow.
    case 'obstruccion': return normalCfg({ rUretra: p.resistencia, popen: () => 15 + 3 * p.resistencia, pmax: NORMAL.pmax * p.hipertrofia,
      fatigue: 90, lesion: p.resistencia / 10, badge: 'obstruccion' });
    // Underactive detrusor (diabetic neuropathy, low cord lesion): weak, short contraction → low pressure,
    // low flow, residual urine.
    case 'hipoactivo': return normalCfg({ pmax: NORMAL.pmax * p.contractilidad, fatigue: p.duracion, compliance: 60, lesion: 1 - p.contractilidad, badge: 'hipoactivo' });
    // Detrusor–sphincter dyssynergia: without pontine coordination the external sphincter contracts during the
    // detrusor contraction → interrupted flow at high pressure.
    case 'disinergia': return normalCfg({ pmax: 80, rUretra: 2, fatigue: 80, popenMin: 30, lesion: p.intensidad / 100, badge: 'disinergia',
      popen: (tv) => 30 + (Math.sin(2 * Math.PI * tv * p.cierres / 30) > 0 ? p.intensidad : 0),
      emg: (tv) => (Math.sin(2 * Math.PI * tv * p.cierres / 30) > 0 ? 2.6 : 0.6) });
    // Hypertonic pelvic floor: voluntary relaxation is slow and incomplete → delayed, weak, plateau flow.
    case 'suelo_hipertonico': return normalCfg({ fatigue: 80, popenMin: NORMAL.popen + 0.15 * p.tono, lesion: p.tono / 80, badge: 'hipertonico',
      popen: (tv) => NORMAL.popen + p.tono * Math.exp(-tv / p.relajacion) + 0.15 * p.tono,
      emg: (tv) => 0.5 + 2.2 * Math.exp(-tv / p.relajacion) + 0.5 });
    // Age: infant (< 2 y) — reflex voiding at small capacity, no cortical inhibition; older adult — cortical atrophy,
    // collagen → lower capacity and compliance, mild overactivity, weaker detrusor.
    case 'edad': return p.etapa === 'lactante'
      ? normalCfg({ capacidad: 80, compliance: 12, reflex: true, pmax: 55, lesion: 0.5, badge: 'refleja' })
      : normalCfg({ capacidad: 280, compliance: 22, pmax: 45, fatigue: 50, waves: { umbral: 180, amp: 50, period: 50 }, lesion: 0.6, badge: 'anciano' });
  }
  throw new Error(key);
}

const STEPS = {
  normal: (a, g, s) => [...a].filter(x => ['llenado', 'acomodacion', 'deseo', 'suelo', 'contraccion', 'vaciado'].includes(x)),
  iuu: (a) => { const o = ['llenado']; if (a.has('contraccion_inv')) o.push('inestable', 'contraccion_inv', 'urgencia'); if (a.has('fuga')) o.push('fuga'); return o; },
  iue: (a, g, s) => { const o = ['llenado']; if (a.has('tos')) o.push('tos'); if (a.has('fuga')) o.push('fuga_esfuerzo'); else if (a.has('tos')) o.push('cierre'); if (!a.has('tos') && !s.voiding) o.push('estable'); return o; },
  obstruccion: (a, g, s) => { const o = ['llenado']; if (s.voiding) o.push('contraccion', 'resistencia'); if (s.voiding && g.pdet > 50) o.push('presion_alta'); if (s.voiding && g.flujo > 0 && g.flujo < 12) o.push('flujo_bajo'); return o; },
  hipoactivo: (a, g, s) => { const o = ['llenado']; if (s.voiding) o.push('contraccion_debil'); if (s.voiding && g.pdet < 30) o.push('presion_baja'); if (s.voiding && g.flujo > 0 && g.flujo < 12) o.push('flujo_bajo'); if (s.done && g.rpm > 20) o.push('residuo'); return o; },
  disinergia: (a, g, s) => { const o = ['llenado', 'sin_coordinacion']; if (s.voiding) o.push('contraccion'); if (s.voiding && g.emg > 2) o.push('esfinter_cerrado'); if (s.voiding && g.pdet > 50) o.push('presion_alta'); if (s.voiding && g.flujo < 1) o.push('flujo_interrumpido'); return o; },
  suelo_hipertonico: (a, g, s) => { const o = ['llenado']; if (s.voiding) o.push('suelo_tenso'); if (s.voiding && g.flujo < 1 && !s.done) o.push('retraso'); if (s.voiding && g.flujo > 0 && g.flujo < 15) o.push('flujo_bajo'); return o; },
  edad: (a, g, s) => { const o = ['llenado', 'control_cortical']; if (a.has('contraccion_inv')) o.push('contraccion_inv'); if (s.voiding) o.push('vaciado'); return o; },
};

export function simulate(key, params, treated = false) {
  const e = ENTITIES.find(x => x.key === key);
  if (!e) throw new Error(`unknown entity ${key}`);
  const p = { ...defaults(key), ...params };
  // "treated" arm = the normal adult reference cycle, drawn on the same axes for comparison
  if (treated && e.treat) return cycle(e, { ...normalCfg(), badge: 'referencia' }, (a, g, s) => [...a].filter(x => e.steps.includes(x)));
  return cycle(e, cfgFor(key, p), (a, g, s) => STEPS[key](a, g, s));
}

export const PRESETS = {
  adulto_sano: { entity: 'normal', params: { capacidad: 400, infusion: 100 } },
  vejiga_pequena: { entity: 'normal', params: { capacidad: 300, infusion: 100 } },
  urgencia_idiopatica: { entity: 'iuu', params: { umbral: 200, amplitud: 45, origen: 'idiopatica' } },
  hiperreflexia_neurologica: { entity: 'iuu', params: { umbral: 150, amplitud: 60, origen: 'neurologica' } },
  hipermovilidad_posparto: { entity: 'iue', params: { alpp: 85, tos: 110 } },
  deficit_esfinteriano: { entity: 'iue', params: { alpp: 45, tos: 110 } },
  esfinter_muy_debil: { entity: 'iue', params: { alpp: 25, tos: 80 } },
  hbp_obstructiva: { entity: 'obstruccion', params: { resistencia: 6, hipertrofia: 1.6 } },
  neuropatia_diabetica: { entity: 'hipoactivo', params: { contractilidad: 0.45, duracion: 70 } },
  lesion_medular: { entity: 'disinergia', params: { cierres: 3, intensidad: 70 } },
  suelo_tenso: { entity: 'suelo_hipertonico', params: { tono: 40, relajacion: 20 } },
  lactante: { entity: 'edad', params: { etapa: 'lactante' } },
  anciano_urgencia: { entity: 'edad', params: { etapa: 'anciano' } },
};
