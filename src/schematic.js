// Schematic: cortex → pontine micturition centre → spinal centres → hypogastric / pelvic / pudendal nerves,
// the bladder (size = volume, wall = detrusor pressure), internal sphincter, external sphincter / pelvic floor
// (thickness = EMG), the urine stream (width = flow) and live Pabd + Pdet = Pves bars.
export function drawSchematic(box, e, pt, tr) {
  const g = pt.g;
  const voiding = g.flujo > 0.3 || pt.active.includes('contraccion') || pt.active.includes('contraccion_debil');
  const filling = !voiding && g.vol > 0 && g.qmax === 0;
  const hot = (loc) => e.loc === loc;
  const stroke = (on) => (on ? 'var(--hot)' : 'var(--tissue-line)');
  const nerve = (on, d, label, x, y) => `<path d="${d}" fill="none" stroke="${on ? 'var(--s1)' : 'var(--axis)'}" stroke-width="${on ? 3 : 1.4}" stroke-dasharray="${on ? '' : '4 3'}"/>
    <text x="${x}" y="${y}" style="font-size:11px;${on ? 'font-weight:700;fill:var(--s1)' : ''}">${label}</text>`;
  const box2 = (x, y, w, label, on, sub = '') => `<rect x="${x}" y="${y}" width="${w}" height="${sub ? 34 : 24}" rx="6" fill="var(--surface)" stroke="${stroke(on)}" stroke-width="${on ? 2.5 : 1.2}"/>
    <text x="${x + w / 2}" y="${y + 16}" text-anchor="middle" style="font-size:11.5px;font-weight:700" class="${on ? 'lbl-on' : ''}">${label}</text>
    ${sub ? `<text x="${x + w / 2}" y="${y + 29}" text-anchor="middle" style="font-size:10px">${sub}</text>` : ''}`;
  // bladder
  const r = Math.max(16, Math.min(78, 72 * Math.sqrt(g.vol / 450)));
  const cx = 330, cy = 112;
  const wall = 2 + Math.min(8, g.pdet / 12);
  const intOpen = voiding && g.flujo > 0.3;
  const floorW = 6 + 6 * Math.min(3, g.emg);
  const narrow = hot('uretra') ? 3 : 7;
  const stream = Math.min(12, g.flujo / 2.5);
  // pressure bars
  const bx = 560, by = 214, sc = 1.1;
  const bar = (x, v, fill, label) => `<rect x="${x}" y="${by - Math.min(150, v) * sc}" width="30" height="${Math.min(150, v) * sc}" rx="3" fill="${fill}"/>
    <text x="${x + 15}" y="${by + 14}" text-anchor="middle" style="font-size:11px">${label}</text>
    <text x="${x + 15}" y="${by - Math.min(150, v) * sc - 4}" text-anchor="middle" style="font-size:11px;font-weight:700;fill:var(--ink)">${Math.round(v)}</text>`;
  const pons = hot('pontino');
  box.innerHTML = `
<svg viewBox="0 0 700 260" role="img" aria-label="${tr('schem.aria')}">
  ${box2(20, 10, 130, tr('schem.cortex'), hot('cortex'))}
  ${box2(20, 52, 130, tr('schem.pontino'), pons)}
  ${pons ? '<path d="M60 56 l50 16 M110 56 l-50 16" stroke="var(--hot)" stroke-width="2.5"/>' : ''}
  ${box2(20, 100, 130, tr('schem.simpatico'), false, 'T10–L2')}
  ${box2(20, 150, 130, tr('schem.sacro'), false, 'S2–S4')}
  <path d="M85 34 V52 M85 76 V100 M85 134 V150" stroke="var(--axis)" stroke-width="1.5"/>
  ${nerve(filling, `M150 117 C 210 117, 240 ${cy + 20}, ${cx - r} ${cy + 20}`, tr('schem.hipogastrico'), 160, 110)}
  ${nerve(voiding, `M150 167 C 220 167, 240 ${cy + 40}, ${cx - r * 0.7} ${cy + r * 0.7}`, tr('schem.pelvico'), 160, 160)}
  ${nerve(!voiding, `M150 177 C 220 200, 260 214, ${cx - 30} 214`, tr('schem.pudendo'), 160, 208)}
  <circle cx="${cx}" cy="${cy}" r="${r}" fill="var(--cyst)" stroke="${hot('detrusor') ? 'var(--hot)' : 'var(--tissue-line)'}" stroke-width="${wall}"/>
  <text x="${cx}" y="${cy + 4}" text-anchor="middle" style="font-size:12px;font-weight:700;fill:var(--ink)">${Math.round(g.vol)} mL</text>
  <text x="${cx + r + 8}" y="${Math.max(20, cy - r + 10)}" style="font-size:11px" class="${hot('detrusor') ? 'lbl-on' : ''}">${tr('schem.detrusor')}</text>
  <rect x="${cx - 12}" y="${cy + r - 2}" width="24" height="16" rx="3" fill="${intOpen ? 'var(--surface)' : 'var(--tissue)'}" stroke="var(--tissue-line)"/>
  <rect x="${cx - narrow / 2}" y="${cy + r - 2}" width="${narrow}" height="${214 - (cy + r - 2)}" fill="${intOpen ? 'var(--s1)' : 'var(--surface)'}" opacity="${intOpen ? 0.5 : 1}" stroke="${hot('uretra') ? 'var(--hot)' : 'var(--tissue-line)'}" stroke-width="${hot('uretra') ? 2 : 1}"/>
  <text x="${cx + 18}" y="${cy + r + 12}" style="font-size:10.5px">${tr('schem.esf_int')}: ${intOpen ? tr('schem.abierto') : tr('schem.cerrado')}</text>
  <rect x="${cx - 60}" y="${210 - floorW / 2}" width="120" height="${floorW}" rx="4" fill="var(--tissue)" stroke="${hot('suelo') || hot('esfinter') ? 'var(--hot)' : 'var(--tissue-line)'}" stroke-width="${hot('suelo') || hot('esfinter') ? 2.5 : 1}"/>
  <text x="${cx + 66}" y="214" style="font-size:10.5px" class="${hot('suelo') || hot('esfinter') ? 'lbl-on' : ''}">${tr('schem.suelo')}</text>
  ${stream > 0.3 ? `<rect x="${cx - stream / 2}" y="${214 + floorW / 2}" width="${stream}" height="${40 - floorW / 2}" fill="var(--s1)"/>` : ''}
  ${g.fugas > 0 ? `<text x="${cx - 70}" y="252" style="font-size:11px" class="lbl-on">${tr('schem.fugas')}: ${Math.round(g.fugas)} mL</text>` : ''}
  <text x="${cx + 20}" y="252" style="font-size:11px">Q ${g.flujo.toFixed(1)} mL/s</text>
  <text x="${bx + 50}" y="20" text-anchor="middle" style="font-size:12px;font-weight:700;fill:var(--ink)">${voiding ? tr('schem.vaciado') : tr('schem.llenado')}</text>
  <text x="${bx + 50}" y="36" text-anchor="middle" style="font-size:10.5px">cmH₂O</text>
  ${bar(bx - 20, g.pabd, 'var(--grid)', 'Pabd')}
  <text x="${bx + 18}" y="${by - 20}" text-anchor="middle" style="font-size:14px">+</text>
  ${bar(bx + 25, g.pdet, 'var(--s1)', 'Pdet')}
  <text x="${bx + 63}" y="${by - 20}" text-anchor="middle" style="font-size:14px">=</text>
  ${bar(bx + 70, g.pves, 'var(--band)', 'Pves')}
</svg>`;
}
