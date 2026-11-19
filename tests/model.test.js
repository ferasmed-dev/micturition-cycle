import test from 'node:test';
import assert from 'node:assert/strict';
import { ENTITIES, GAUGES, PRESETS, simulate, defaults, NORMAL } from '../src/model.js';
import { STR } from '../src/i18n.js';

const last = r => r.points[r.points.length - 1];
const at = (r, t) => r.points.reduce((a, b) => (Math.abs(b.t - t) < Math.abs(a.t - t) ? b : a));
const min = (r, g) => Math.min(...r.points.map(p => p.g[g]));
const max = (r, g) => Math.max(...r.points.map(p => p.g[g]));
const evs = r => r.events.map(e => e.key);

/* ---------- generic: every entity ---------- */
for (const e of ENTITIES) {
  test(`${e.key}: well-formed output (defaults, extremes, both arms)`, () => {
    const variants = [defaults(e.key)];
    for (const p of e.params.filter(q => q.type !== 'choice')) {
      variants.push({ ...defaults(e.key), [p.key]: p.min }, { ...defaults(e.key), [p.key]: p.max });
    }
    for (const p of e.params.filter(q => q.type === 'choice')) for (const o of p.options) variants.push({ ...defaults(e.key), [p.key]: o });
    for (const v of variants) for (const tr of [false, true]) {
      const r = simulate(e.key, v, tr);
      assert.equal(r.points.length, Math.round(e.tMax / e.dt) + 1);
      for (let i = 1; i < r.points.length; i++) assert.ok(r.points[i].t > r.points[i - 1].t);
      for (const pt of r.points) {
        for (const g of [...e.tiles, ...e.charts]) {
          assert.ok(Number.isFinite(pt.g[g]) && pt.g[g] >= 0, `${e.key} ${g}=${pt.g[g]}`);
          assert.ok(GAUGES[g], `gauge ${g} defined`);
        }
        for (const a of pt.active) assert.ok(e.steps.includes(a), `${e.key} unknown step ${a}`);
        assert.ok(pt.lesion >= 0 && pt.lesion <= 1);
      }
      for (const ev of r.events) assert.ok(ev.t >= 0 && ev.t <= e.tMax);
    }
  });
}

test('pure: same input → same output, params not mutated', () => {
  for (const e of ENTITIES) {
    const p = defaults(e.key); const copy = JSON.stringify(p);
    assert.deepEqual(simulate(e.key, p, true), simulate(e.key, p, true));
    assert.equal(JSON.stringify(p), copy);
  }
});

test('normal reference: Qmax = (Pmax − Popen)/(Ri + R) = 25 mL/s; filling Pdet stays < 15 cmH2O at 400 mL', () => {
  assert.equal((NORMAL.pmax - NORMAL.popen) / (NORMAL.ri + NORMAL.rUretra), 25);
  assert.ok(NORMAL.capacidad / NORMAL.compliance <= 10);
});

test('i18n: every key used by the model exists in ES and EN', () => {
  for (const lang of ['es', 'en']) {
    const S = STR[lang];
    for (const e of ENTITIES) {
      const E = S.ent[e.key];
      for (const f of ['name', 'what', 'params', 'sees', 'tto']) assert.ok(E[f], `${lang} ${e.key}.${f}`);
      for (const st of e.steps) assert.ok(E.steps[st], `${lang} step ${e.key}.${st}`);
      for (const p of e.params) {
        assert.ok(S.params[p.key], `${lang} param ${p.key}`);
        if (p.type === 'choice') for (const o of p.options) assert.ok(S.choice[p.key][o], `${lang} choice ${p.key}.${o}`);
      }
      for (const g of [...e.tiles, ...e.charts]) assert.ok(S.gauges[g], `${lang} gauge ${g}`);
      assert.ok(S.units[e.unit]);
      for (const tr of [false, true]) {
        const r = simulate(e.key, defaults(e.key), tr);
        for (const ev of r.events) assert.equal(typeof S.ev[ev.key], 'function', `${lang} event ${ev.key}`);
        for (const pt of r.points) if (pt.badge) assert.ok(S.badge[pt.badge], `${lang} badge ${pt.badge}`);
      }
    }
    for (const k of Object.keys(PRESETS)) assert.ok(S.presets[k], `${lang} preset ${k}`);
  }
});

/* ---------- presets ---------- */
test('presets reference valid entities and parameters', () => {
  for (const [k, pr] of Object.entries(PRESETS)) {
    const e = ENTITIES.find(x => x.key === pr.entity);
    assert.ok(e, k);
    for (const pk of Object.keys(pr.params)) assert.ok(e.params.some(p => p.key === pk), `${k}.${pk}`);
    for (const ev of [...simulate(pr.entity, pr.params, false).events, ...simulate(pr.entity, pr.params, true).events]) {
      assert.equal(typeof STR.es.ev[ev.key], 'function', `${k} event ${ev.key}`);
    }
  }
});

/* ---------- mechanisms ---------- */
const run = (k, p = {}, tr = false) => simulate(k, p, tr);
const fin = (r) => last(r).g;
const ev = (r, k) => r.events.find(e => e.key === k);
const fillMax = (r, g) => { const i = r.events.find(e => e.key === 'capacidad'); return Math.max(...r.points.filter(p => !i || p.t < i.t).map(p => p.g[g])); };

test('normal cycle: low-pressure filling to capacity, coordinated void with bell flow, Qmax ≥ 15, residual < 10 %', () => {
  const r = run('normal');
  assert.ok(fillMax(r, 'pdet') < 15);
  assert.ok(Math.abs(ev(r, 'capacidad').args[0] - 400) <= 5);
  assert.ok(fin(r).qmax >= 15 && fin(r).rpm < 10 && fin(r).fugas === 0);
  assert.ok(ev(r, 'deseo').t < ev(r, 'capacidad').t);
  assert.ok(run('normal', { capacidad: 300 }).events.find(e => e.key === 'capacidad').t < ev(r, 'capacidad').t);
});

test('urge incontinence: involuntary contractions after the threshold volume, leaks and a reduced functional capacity', () => {
  const r = run('iuu', PRESETS.urgencia_idiopatica.params);
  assert.ok(ev(r, 'contraccion_inv') && ev(r, 'fuga') && fin(r).fugas > 0);
  assert.ok(ev(r, 'capacidad').args[0] < 300);
  const n = run('iuu', PRESETS.hiperreflexia_neurologica.params);
  assert.ok(ev(n, 'contraccion_inv').t < ev(r, 'contraccion_inv').t && fillMax(n, 'pdet') > fillMax(r, 'pdet'));
  assert.equal(fin(run('iuu', {}, true)).fugas, 0, 'the normal reference does not leak');
});

test('stress incontinence: leaks with cough only when Pves exceeds the ALPP, without detrusor contraction; lower ALPP leaks more', () => {
  const h = run('iue', PRESETS.hipermovilidad_posparto.params), d = run('iue', PRESETS.deficit_esfinteriano.params);
  assert.ok(fin(h).fugas > 0 && fin(d).fugas > fin(h).fugas);
  assert.ok(fillMax(d, 'pdet') < 15, 'no detrusor contraction during the leak');
  assert.equal(fin(run('iue', { alpp: 120, tos: 100 })).fugas, 0);
  assert.equal(h.points[0].badge, 'hipermovilidad');
  assert.equal(d.points[0].badge, 'dei');
  assert.equal(run('iue', PRESETS.esfinter_muy_debil.params).points[0].badge, 'muy_debil');
});

test('obstruction vs underactive detrusor: both have low flow; only pressure separates them (high vs low Pdet)', () => {
  const o = run('obstruccion', PRESETS.hbp_obstructiva.params), h = run('hipoactivo', PRESETS.neuropatia_diabetica.params);
  assert.ok(fin(o).qmax < 10 && fin(h).qmax < 10);
  assert.ok(max(o, 'pdet') > 60 && max(h, 'pdet') < 30);
  assert.ok(fin(h).rpm > 20, 'underactive detrusor leaves a residual > 20 %');
  assert.ok(fin(run('obstruccion', { resistencia: 9 })).qmax < fin(run('obstruccion', { resistencia: 3 })).qmax);
  assert.ok(fin(run('hipoactivo', { contractilidad: 0.8 })).rpm < fin(h).rpm);
});

test('detrusor–sphincter dyssynergia: high pressure, interrupted flow with an active sphincter EMG, residual urine', () => {
  const r = run('disinergia', PRESETS.lesion_medular.params);
  const v = r.points.filter(p => p.t > ev(r, 'capacidad').t && p.t < ev(r, 'fin').t);
  const zeros = v.filter(p => p.g.flujo < 0.5).length, flows = v.filter(p => p.g.flujo > 3).length;
  assert.ok(zeros > 5 && flows > 5, 'flow stops and restarts');
  assert.ok(max(r, 'pdet') > 60 && max(r, 'emg') > 2 && fin(r).rpm > 20);
});

test('hypertonic pelvic floor: delayed, weak flow while the floor relaxes', () => {
  const r = run('suelo_hipertonico', PRESETS.suelo_tenso.params);
  const c = ev(r, 'capacidad').t;
  const firstFlow = r.points.find(p => p.t > c && p.g.flujo > 1).t;
  const nFirst = run('normal').points.find(p => p.g.flujo > 1).t - ev(run('normal'), 'capacidad').t;
  assert.ok(firstFlow - c > nFirst && fin(r).qmax < 15);
});

test('age: the infant voids reflexly at a small capacity; the older adult has lower capacity and overactivity', () => {
  const l = run('edad', { etapa: 'lactante' }), a = run('edad', { etapa: 'anciano' });
  assert.ok(ev(l, 'capacidad').args[0] < 100 && !ev(l, 'deseo'));
  assert.ok(ev(a, 'capacidad').args[0] < 300 && ev(a, 'contraccion_inv') && fin(a).fugas > 0);
});
