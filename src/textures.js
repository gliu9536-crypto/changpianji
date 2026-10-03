import * as THREE from 'three';

/* ------------------------------------------------------------------ *
 *  deterministic value noise (tileable) + derived maps
 * ------------------------------------------------------------------ */
function rng(seed) {
  let s = (seed >>> 0) || 1;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
}

export function fbm(size, octaves = 4, seed = 7, gain = 0.5) {
  const out = new Float32Array(size * size);
  let amp = 1, norm = 0, cells = 2;
  for (let o = 0; o < octaves; o++) {
    const r = rng(seed + o * 977);
    const g = new Float32Array(cells * cells);
    for (let i = 0; i < g.length; i++) g[i] = r();
    for (let y = 0; y < size; y++) {
      const fy = (y / size) * cells, y0 = fy | 0, ty = fy - y0, sy = ty * ty * (3 - 2 * ty);
      const y1 = (y0 + 1) % cells;
      for (let x = 0; x < size; x++) {
        const fx = (x / size) * cells, x0 = fx | 0, tx = fx - x0, sx = tx * tx * (3 - 2 * tx);
        const x1 = (x0 + 1) % cells;
        const i00 = g[y0 * cells + x0], i10 = g[y0 * cells + x1];
        const i01 = g[y1 * cells + x0], i11 = g[y1 * cells + x1];
        out[y * size + x] += amp * ((i00 * (1 - sx) + i10 * sx) * (1 - sy) + (i01 * (1 - sx) + i11 * sx) * sy);
      }
    }
    norm += amp; amp *= gain; cells *= 2;
  }
  const k = 1 / norm;
  for (let i = 0; i < out.length; i++) out[i] *= k;
  return out;
}

function dataTex(data, size, srgb = false) {
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  // DataTexture defaults to NearestFilter with no mipmaps — on procedural
  // micro-detail that reads as blocky aliasing
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}

/** fine micro-surface normal map — used for soft-touch plastic & paper */
export function normalTex(size = 256, { octaves = 4, seed = 11, strength = 1.5 } = {}) {
  const h = fbm(size, octaves, seed);
  const d = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const l = h[y * size + ((x - 1 + size) % size)], r = h[y * size + ((x + 1) % size)];
      const u = h[((y - 1 + size) % size) * size + x], v = h[((y + 1) % size) * size + x];
      const nx = (l - r) * strength, ny = (u - v) * strength, nz = 1;
      const il = 1 / Math.hypot(nx, ny, nz), i = (y * size + x) * 4;
      d[i] = (nx * il * 0.5 + 0.5) * 255;
      d[i + 1] = (ny * il * 0.5 + 0.5) * 255;
      d[i + 2] = (nz * il * 0.5 + 0.5) * 255;
      d[i + 3] = 255;
    }
  }
  return dataTex(d, size);
}

const clamp8 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);

/** grayscale roughness variation */
export function roughTex(size = 512, { lo = 0.4, hi = 0.8, octaves = 5, seed = 5 } = {}) {
  const h = fbm(size, octaves, seed);
  const d = new Uint8Array(size * size * 4);
  for (let i = 0; i < h.length; i++) {
    const v = (lo + (hi - lo) * h[i]) * 255;
    d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v;
    d[i * 4 + 3] = 255;
  }
  return dataTex(d, size);
}

/* ------------------------------------------------------------------ *
 *  canvas helpers
 * ------------------------------------------------------------------ */
function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

export function tex(c, { srgb = true, aniso = 16, rep = 1 } = {}) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = aniso;
  t.repeat.set(rep, rep);
  t.needsUpdate = true;
  return t;
}

/** letter-spaced text (canvas letterSpacing isn't universal) */
export function tracked(ctx, text, x, y, { track = 0, align = 'left' } = {}) {
  const chars = [...text];
  let w = 0;
  for (const ch of chars) w += ctx.measureText(ch).width + track;
  w -= track;
  let cx = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
  const prev = ctx.textAlign;
  ctx.textAlign = 'left';
  for (const ch of chars) { ctx.fillText(ch, cx, y); cx += ctx.measureText(ch).width + track; }
  ctx.textAlign = prev;
  return w;
}

/** A run of print measured to fit its box. */
export function fitRun(ctx, text, font, size, maxW, { track = 0, min = 0.62 } = {}) {
  const width = (s) => ctx.measureText(s).width + track * Math.max(0, [...s].length - 1);
  ctx.font = font(size);
  let s = size;
  while (s > size * min + 1e-6 && width(text) > maxW) {
    s = Math.max(size * min, s * 0.94);
    ctx.font = font(s);
  }
  let out = text;
  if (width(out) > maxW) {
    out = '';
    for (const ch of text) {
      if (width(out + ch + '…') > maxW) break;
      out += ch;
    }
    out = out.replace(/\s+$/, '') + '…';
  }
  return { text: out, size: s, w: width(out) };
}

export function grain(ctx, w, h, amount = 0.06, seed = 3) {
  const r = rng(seed);
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (r() - 0.5) * 255 * amount;
    d[i] += n; d[i + 1] += n; d[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);
}

/* ------------------------------------------------------------------ *
 *  the record label : a circular paper label printed onto the vinyl
 * ------------------------------------------------------------------ */

/** a run of text set around a circle, each glyph rotated onto the tangent so
    the fine print reads round the rim the way a record label's does */
function arcText(g, cx, cy, radius, text, startAngle, spacing, { font, color }) {
  g.save();
  g.translate(cx, cy);
  g.fillStyle = color;
  g.font = font;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const chars = [...text];
  const w = chars.map((ch) => g.measureText(ch).width);
  let a = startAngle;
  for (let i = 0; i < chars.length; i++) {
    const mid = a + (w[i] / 2) / radius;
    g.save();
    g.rotate(mid);
    g.fillText(chars[i], 0, -radius);
    g.restore();
    a += (w[i] + spacing) / radius;
  }
  g.restore();
}

export function recordLabelTexture(face = 'A', { title = '', artist = '', album = '', minutes = '' } = {}) {
  const S = 1024, R = S / 2, cx = R, cy = R;
  const c = canvas(S, S);
  const g = c.getContext('2d');
  const dark = face === 'B';
  const U = (u) => u * R;                       // one shape unit = the label radius
  const r = rng(face === 'A' ? 61 : 73);

  // ---- base paper. A is the warm day card, B the night card — the same
  //      printing screened onto a dark ground.
  const base = dark ? ['#242731', '#111319'] : ['#f4efe3', '#e3dcc6'];
  const lg = g.createLinearGradient(0, 0, S, S);
  lg.addColorStop(0, base[0]); lg.addColorStop(1, base[1]);
  g.fillStyle = lg;
  g.beginPath(); g.arc(cx, cy, R - 3, 0, Math.PI * 2); g.fill();

  const ink = dark ? '#e9e4d6' : '#2b2c30';
  const sub = dark ? 'rgba(206,203,214,.74)' : 'rgba(62,64,70,.82)';
  const lead = dark ? '210,214,220' : '46,49,55';

  // ---- spindle hole + the reinforcing ring around it
  const holeR = R * 0.075;
  g.save();
  g.beginPath(); g.arc(cx, cy, holeR + U(0.02), 0, Math.PI * 2);
  g.fillStyle = dark ? 'rgba(0,0,0,.7)' : 'rgba(0,0,0,.78)';
  g.fill();
  g.restore();
  g.strokeStyle = sub;
  g.lineWidth = 2;
  g.beginPath(); g.arc(cx, cy, holeR + U(0.035), 0, Math.PI * 2); g.stroke();

  // ---- the rim rule, drawn once thin and once thick so it reads as a printed
  //      plate edge rather than a single hairline
  g.strokeStyle = dark ? 'rgba(232,227,216,.55)' : 'rgba(43,44,48,.55)';
  g.lineWidth = 2;
  g.beginPath(); g.arc(cx, cy, R * 0.965, 0, Math.PI * 2); g.stroke();
  g.lineWidth = 5;
  g.beginPath(); g.arc(cx, cy, R * 0.955, 0, Math.PI * 2); g.stroke();

  // ---- circumferential fine print
  const side = face === 'A' ? 'SIDE A' : 'SIDE B';
  g.font = `600 ${Math.round(U(0.052))}px "Segoe UI", Helvetica, Arial, sans-serif`;
  arcText(g, cx, cy, R * 0.83, `33⅓ RPM · STEREO · ${side} · OHM DISC`, -Math.PI / 2, U(0.016), { font: g.font, color: sub });

  // ---- title / artist / album, set across the upper middle (the spindle hole
  //      is small, so the type may sit centred like a printed card)
  const midBox = R * 1.5;
  const titleY = cy - R * 0.30;
  const script = (s) => `400 ${s}px Gabriola, "Segoe Script", "Lucida Handwriting", "Brush Script MT", cursive`;
  const sans = (s) => `300 ${s}px "Segoe UI", Helvetica, Arial, sans-serif`;
  if (title) {
    const fit = fitRun(g, title, script, U(0.30), midBox);
    g.font = script(fit.size);
    g.fillStyle = dark ? 'rgba(226,220,208,.28)' : 'rgba(60,62,68,.26)';
    g.fillText(fit.text, cx + U(0.01), titleY + U(0.01));
    g.fillStyle = ink;
    g.fillText(fit.text, cx, titleY);
    // the pencil rule under the title, stopping where the hand stopped
    g.strokeStyle = dark ? 'rgba(232,227,216,.4)' : 'rgba(60,62,68,.4)';
    g.lineWidth = U(0.012);
    g.beginPath();
    g.moveTo(cx - fit.w / 2, titleY + U(0.16));
    g.lineTo(cx + fit.w * 0.62, titleY + U(0.16));
    g.stroke();
  }
  const credits = [artist, album].filter(Boolean).join('  ·  ');
  if (credits) {
    const fit = fitRun(g, credits, sans, U(0.085), midBox, { track: U(0.02), min: 0.72 });
    g.fillStyle = sub;
    g.font = sans(fit.size);
    tracked(g, fit.text, cx, cy + R * 0.04, { track: U(0.02), align: 'center' });
  }
  g.fillStyle = sub;
  g.font = `300 ${Math.round(U(0.062))}px "Menlo", "Consolas", monospace`;
  tracked(g, minutes ? `TRT ${minutes} MIN` : 'TRT —', cx, cy + R * 0.26, { track: U(0.03), align: 'center' });

  // ---- a second arc of fine print along the lower rim
  g.font = `300 ${Math.round(U(0.044))}px "Menlo", "Consolas", monospace`;
  arcText(g, cx, cy, R * 0.62, 'MICROGROOVE · 30 CM · DIRECT-DRIVE', Math.PI * 0.5, U(0.014), { font: g.font, color: sub });

  // ---- paper tooth + grain
  grain(g, S, S, dark ? 0.05 : 0.03, face === 'A' ? 19 : 27);

  // ---- soft edge shading so the paper doesn't read flat
  const vg = g.createRadialGradient(cx, cy, R * 0.3, cx, cy, R * 0.99);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, dark ? 'rgba(0,0,0,.5)' : 'rgba(70,58,42,.2)');
  g.fillStyle = vg;
  g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.fill();

  return tex(c, { srgb: true });
}

/* ------------------------------------------------------------------ *
 *  the vinyl playing surface : concentric grooves as a height field
 * ------------------------------------------------------------------ */
export function grooveTexture(size = 512) {
  const h = new Float32Array(size * size);
  const grooves = 340;                        // how many grooves to draw
  const rIn = 0.34, rOut = 0.99;              // normalized radii (label / rim)
  for (let y = 0; y < size; y++) {
    const ny = (y + 0.5) / size - 0.5;
    for (let x = 0; x < size; x++) {
      const nx = (x + 0.5) / size - 0.5;
      const rn = Math.hypot(nx, ny) * 2;      // 0 at centre, 1 at the edge midpoint
      let v;
      if (rn < rIn) v = 0.5;                  // dead wax, hidden by the label
      else if (rn > rOut) v = 0.62;           // the un-grooved rim
      else {
        const t = (rn - rIn) / (rOut - rIn);
        const ph = (t * grooves) % 1;
        // a groove is a narrow trough between flat lands
        v = 0.74 - 0.36 * Math.pow(Math.sin(ph * Math.PI), 2);
        // faint radial streaks give the "spokes of light" a record throws
        const a = Math.atan2(ny, nx);
        v += 0.05 * Math.sin(a * 9) * Math.sin(ph * Math.PI);
      }
      h[y * size + x] = v;
    }
  }

  const nrm = new Uint8Array(size * size * 4);
  const rgh = new Uint8Array(size * size * 4);
  const col = new Uint8Array(size * size * 4);
  const at = (x, y) => h[((y + size) % size) * size + ((x + size) % size)];
  const strength = 1.3;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x, o = i * 4;
      const l = at(x - 1, y), rr = at(x + 1, y), u = at(x, y - 1), vv = at(x, y + 1);
      const nx = (l - rr) * strength, ny = (u - vv) * strength, nz = 1;
      const il = 1 / Math.hypot(nx, ny, nz);
      nrm[o] = (nx * il * 0.5 + 0.5) * 255;
      nrm[o + 1] = (ny * il * 0.5 + 0.5) * 255;
      nrm[o + 2] = (nz * il * 0.5 + 0.5) * 255;
      nrm[o + 3] = 255;
      const hv = h[i];
      const rv = (0.30 + 0.30 * (1 - hv)) * 255;
      rgh[o] = rgh[o + 1] = rgh[o + 2] = rv; rgh[o + 3] = 255;
      const lv = 14 + 30 * (1 - hv);
      col[o] = lv; col[o + 1] = lv; col[o + 2] = lv + 2; col[o + 3] = 255;
    }
  }
  return {
    map: dataTex(col, size, true),
    normalMap: dataTex(nrm, size, false),
    roughnessMap: dataTex(rgh, size, false),
  };
}

/* ------------------------------------------------------------------ *
 *  misc
 * ------------------------------------------------------------------ */
export function brushedTexture(size = 512, tint = [150, 152, 158], rot = 0) {
  const c = canvas(size, size), g = c.getContext('2d');
  g.fillStyle = `rgb(${tint[0] * 0.7 | 0},${tint[1] * 0.7 | 0},${tint[2] * 0.72 | 0})`;
  g.fillRect(0, 0, size, size);
  const r = rng(41);
  g.translate(size / 2, size / 2); g.rotate(rot); g.translate(-size / 2, -size / 2);
  for (let i = 0; i < 5200; i++) {
    const y = r() * size, x = r() * size, len = 20 + r() * 190;
    const a = 0.04 + r() * 0.12;
    g.strokeStyle = r() > 0.5 ? `rgba(255,255,255,${a})` : `rgba(0,0,0,${a})`;
    g.lineWidth = 0.6 + r() * 1.1;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + len, y + (r() - 0.5) * 2); g.stroke();
  }
  return tex(c, { srgb: false, rep: 2 });
}

export function radialTexture(size = 512, { inner = 'rgba(0,0,0,1)', outer = 'rgba(0,0,0,0)', p = 0.55, color = '0,0,0' } = {}) {
  const c = canvas(size, size), g = c.getContext('2d');
  const gr = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gr.addColorStop(0, inner); gr.addColorStop(p, `rgba(${color},0.55)`); gr.addColorStop(1, outer);
  g.fillStyle = gr; g.fillRect(0, 0, size, size);
  return tex(c, { srgb: false });
}

export function dustSprite(size = 128) {
  const c = canvas(size, size), g = c.getContext('2d');
  const gr = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gr.addColorStop(0, 'rgba(255,246,232,1)');
  gr.addColorStop(0.35, 'rgba(255,240,220,0.35)');
  gr.addColorStop(1, 'rgba(255,235,210,0)');
  g.fillStyle = gr; g.fillRect(0, 0, size, size);
  return tex(c, { srgb: true });
}

/** the visible backdrop: a vertical gradient plus an optional soft pool of
    light behind the subject (i.e. a background light on the cyclorama). */
export function backdropTexture({ stops, spot = null, size = 2048 }) {
  const h = size / 2;
  const c = canvas(size, h), g = c.getContext('2d');
  const lg = g.createLinearGradient(0, 0, 0, h);
  for (const [p, col] of stops) lg.addColorStop(p, col);
  g.fillStyle = lg; g.fillRect(0, 0, size, h);
  if (spot) pool(g, size, h, spot);
  return tex(soften(c, size, h, Math.round(size / 96)), { srgb: true });
}

const POLE_TAPER = [
  [0, 0], [0.07, 0.12], [0.15, 0.5], [0.26, 1],
  [0.74, 1], [0.85, 0.5], [0.93, 0.12], [1, 0],
];

function pool(g, size, h, spot) {
  const layer = canvas(size, h), pl = layer.getContext('2d');
  const cy = spot.v * h, r = spot.r * size;
  const mid = spot.color.replace(/[\d.]+\)$/, '0.42)');
  pl.globalCompositeOperation = 'lighter';
  for (const dx of [-size, 0, size]) {
    const cx = spot.u * size + dx;
    if (cx + r < 0 || cx - r > size) continue;
    const rg = pl.createRadialGradient(cx, cy, 0, cx, cy, r);
    rg.addColorStop(0, spot.color);
    rg.addColorStop(0.55, mid);
    rg.addColorStop(1, 'rgba(0,0,0,0)');
    pl.fillStyle = rg;
    pl.fillRect(0, 0, size, h);
  }
  pl.globalCompositeOperation = 'destination-in';
  const mask = pl.createLinearGradient(0, 0, 0, h);
  for (const [p, a] of POLE_TAPER) mask.addColorStop(p, `rgba(0,0,0,${a})`);
  pl.fillStyle = mask;
  pl.fillRect(0, 0, size, h);
  g.globalCompositeOperation = 'lighter';
  g.drawImage(layer, 0, 0);
  g.globalCompositeOperation = 'source-over';
}

function soften(src, size, h, r) {
  const pad = Math.ceil(r * 3);
  const big = canvas(size + pad * 2, h + pad * 2), bg = big.getContext('2d');
  for (const dx of [-1, 0, 1]) {
    const x = pad + dx * size;
    bg.drawImage(src, x, pad, size, h);
    bg.drawImage(src, 0, 0, size, 1, x, 0, size, pad);
    bg.drawImage(src, 0, h - 1, size, 1, x, pad + h, size, pad);
  }
  const out = canvas(size, h), og = out.getContext('2d');
  og.filter = `blur(${r}px)`;
  og.drawImage(big, -pad, -pad);
  og.filter = 'none';
  return out;
}

/** vertical studio gradient used for the environment dome */
export function gradientTexture(stops, size = 512) {
  const c = canvas(size, size), g = c.getContext('2d');
  const lg = g.createLinearGradient(0, 0, 0, size);
  for (const [p, col] of stops) lg.addColorStop(p, col);
  g.fillStyle = lg; g.fillRect(0, 0, size, size);
  return tex(c, { srgb: true });
}

/* ------------------------------------------------------------------ *
 *  the write head (see turntable.setLabel / main.updateLabelSwap)
 *
 *  A label that has been regenerated is a new texture, and pointing a material
 *  at one is a step. The incoming print is therefore carried on a copy of the
 *  same disc and let in through a window that crosses the label, so the change
 *  is a rewrite rather than a cut.
 * ------------------------------------------------------------------ */

/** The window itself: a ramp across U — solid behind the head, dropping to
    nothing over the last tenth of the card. The caller slides it by animating
    `offset.x`, and past the end of the ramp the sample clamps to the edge —
    which is why the wrap has to be ClampToEdge and the edge has to be the black
    end: parked beyond it, the whole window reads zero and nothing of the new
    print shows. */
export function sweepAlpha(w = 64, h = 4) {
  const c = canvas(w, h);
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, w, 0);
  grad.addColorStop(0, '#fff');
  grad.addColorStop(0.88, '#fff');
  grad.addColorStop(1, '#000');
  g.fillStyle = grad; g.fillRect(0, 0, w, h);
  g.globalCompositeOperation = 'multiply';
  for (let i = 0; i < 3; i++) {
    g.fillStyle = `rgba(0,0,0,${0.11 + i * 0.13})`;
    g.fillRect(Math.round(w * (0.90 + i * 0.032)), 0, 1, h);
  }
  g.globalCompositeOperation = 'source-over';
  const t = tex(c, { srgb: false, aniso: 1 });
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

/** the head's own light — a band, not a line: bright where it is writing, gone
    at both ends of the stroke and at the disc's two edges. Everything about it
    is alpha, because the quad that carries it is additive. */
export function headStreak(w = 64, h = 32) {
  const c = canvas(w, h);
  const g = c.getContext('2d');
  const gx = g.createLinearGradient(0, 0, w, 0);
  gx.addColorStop(0, 'rgba(255,255,255,0)');
  gx.addColorStop(0.34, 'rgba(255,255,255,0.42)');
  gx.addColorStop(0.48, 'rgba(255,255,255,1)');
  gx.addColorStop(0.52, 'rgba(255,255,255,1)');
  gx.addColorStop(0.66, 'rgba(255,255,255,0.42)');
  gx.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gx; g.fillRect(0, 0, w, h);
  g.globalCompositeOperation = 'destination-in';
  const gy = g.createLinearGradient(0, 0, 0, h);
  gy.addColorStop(0, 'rgba(255,255,255,0)');
  gy.addColorStop(0.18, 'rgba(255,255,255,1)');
  gy.addColorStop(0.82, 'rgba(255,255,255,1)');
  gy.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gy; g.fillRect(0, 0, w, h);
  return tex(c, { srgb: true, aniso: 2 });
}
