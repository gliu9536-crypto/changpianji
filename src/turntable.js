import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries, toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import * as TX from './textures.js';
import { clamp, damp, smoothstep } from './anim.js';

/* ============================== dimensions ==============================
   a direct-drive turntable — 1 scene unit ≈ 3 cm, so the plinth reads about
   42 × 35 × 5.5 cm with a 30 cm (12″) record.
   x = width, z = depth, y = thickness; origin at the plinth's vertical centre
   ======================================================================= */
export const DIM = {
  W: 13.0, Dp: 11.0, H: 1.7,        // plinth
  hw: 6.5, hz: 5.5, hh: 0.85,       // halfs
  hd: 1.35,                         // bottom extent (to the feet) → the floor rest
  rOut: 0.9,                        // plinth corner radius
  feet: { r: 0.55, h: 0.5, inset: 1.15 },
  platter: { r: 4.7, h: 0.85, chamfer: 0.12 },
  record: { r: 5.0, h: 0.055, labelR: 1.7, holeR: 0.16 },
  spindle: { r: 0.13, h: 0.75 },
  weight: { r: 1.5, h: 0.34, holeR: 0.18 },
  arm: { pivot: [4.3, 3.4], len: 7.0, rOut: 4.55, rIn: 2.4, lift: 0.05, y: 1.12 },
};
const D = DIM;
const RPM = 33.333;                  // playback speed
const REW_SECONDS = 8.5;             // how long a rewind takes

/* ============================== geometry helpers ======================== */
const CREASE = THREE.MathUtils.degToRad(18);
const autoSmooth = (g, crease = CREASE) => toCreasedNormals(g, crease);

/** a cylinder with its rims broken — the chamfer is real geometry, so the
    machined round parts catch a highlight line the way a moulded one does */
function latheCyl(rTop, rBot, h, chamfer = 0.03, segs = 32) {
  const c = Math.min(chamfer, h / 2 - 1e-3, Math.min(rTop, rBot) * 0.5);
  const pts = [
    new THREE.Vector2(0, -h / 2),
    new THREE.Vector2(Math.max(1e-4, rBot - c), -h / 2),
    new THREE.Vector2(rBot, -h / 2 + c),
    new THREE.Vector2(rTop, h / 2 - c),
    new THREE.Vector2(Math.max(1e-4, rTop - c), h / 2),
    new THREE.Vector2(0, h / 2),
  ];
  return autoSmooth(new THREE.LatheGeometry(pts, segs));
}

const box = (w, h, d, r = 0.03) => (r > 0
  ? new RoundedBoxGeometry(w, h, d, 2, Math.min(r, Math.min(w, h, d) / 2))
  : new THREE.BoxGeometry(w, h, d));

function mesh(g, m, x = 0, y = 0, z = 0) {
  const o = new THREE.Mesh(g, m);
  o.position.set(x, y, z);
  o.castShadow = o.receiveShadow = true;
  return o;
}

/** draw-call reduction: static parts sharing a material bake into one mesh */
function bake(meshes, material, castShadow = true) {
  const geos = [];
  for (const m of meshes) {
    m.updateMatrix();
    const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
    g.applyMatrix4(m.matrix);
    for (const k of Object.keys(g.attributes)) {
      if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
    }
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!g.attributes.uv) {
      g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    }
    geos.push(g);
  }
  const merged = mergeGeometries(geos, false);
  geos.forEach((g) => g.dispose());
  if (!merged) return meshes;
  const out = new THREE.Mesh(merged, material);
  out.castShadow = castShadow;
  out.receiveShadow = true;
  return out;
}
function bakeInto(parent, meshes, castShadow = true) {
  const byMat = new Map();
  for (const m of meshes) {
    if (!byMat.has(m.material)) byMat.set(m.material, []);
    byMat.get(m.material).push(m);
  }
  for (const [mat, list] of byMat) {
    if (list.length === 1) parent.add(list[0]);
    else {
      const baked = bake(list, mat, castShadow);
      if (Array.isArray(baked)) list.forEach((m) => parent.add(m));
      else parent.add(baked);
    }
  }
}

/* ============================== materials =============================== */
/** One face's printed label — a circular card, whose RingGeometry uv already
    runs 0..1 with the centre at (0.5, 0.5), so it needs no repeat scaling. */
function makeLabelMap(face, opts) {
  return TX.recordLabelTexture(face, opts);
}

export function createMaterials(labelOpts = {}) {
  const micro = TX.normalTex(256, { octaves: 5, strength: 1.7, seed: 11 });
  const micro2 = TX.normalTex(256, { octaves: 5, strength: 2.6, seed: 23 });
  const frost = TX.normalTex(512, { octaves: 6, strength: 2.2, seed: 47 });
  const rgh = TX.roughTex(512, { lo: 0.40, hi: 0.72, seed: 5 });
  const paperN = TX.normalTex(512, { octaves: 6, strength: 2.6, seed: 31 });
  const brush = TX.brushedTexture(512, [158, 162, 170]);
  const brushCu = TX.brushedTexture(512, [198, 148, 104]);
  const groove = TX.grooveTexture(512);

  const labelMap = (face) => makeLabelMap(face, labelOpts);

  return {
    micro, micro2, frost, rgh, paperN, brush, brushCu,
    // the plinth — smoked frosted glass. opaque (a thick slab reads better
    // opaque than translucent), the frost is the fine normal map + clearcoat.
    glass: new THREE.MeshPhysicalMaterial({
      color: 0xaab6bd, metalness: 0, roughness: 0.28,
      roughnessMap: rgh, clearcoat: 1.0, clearcoatRoughness: 0.22,
      normalMap: frost, normalScale: new THREE.Vector2(0.38, 0.38),
      envMapIntensity: 1.25, sheen: 0.12,
      sheenColor: new THREE.Color(0xcfe0e8), sheenRoughness: 0.5,
    }),
    glassEdge: new THREE.MeshPhysicalMaterial({
      color: 0x84939c, metalness: 0, roughness: 0.44, roughnessMap: rgh,
      clearcoat: 0.5, clearcoatRoughness: 0.4,
      normalMap: frost, normalScale: new THREE.Vector2(0.5, 0.5), envMapIntensity: 0.9,
    }),
    metal: new THREE.MeshPhysicalMaterial({
      color: 0xc4c8cf, metalness: 1, roughness: 0.26,
      roughnessMap: brush, anisotropy: 0.5, envMapIntensity: 1.4,
    }),
    metalDark: new THREE.MeshPhysicalMaterial({
      color: 0x565b61, metalness: 1, roughness: 0.6, roughnessMap: brush, envMapIntensity: 0.9,
    }),
    copper: new THREE.MeshPhysicalMaterial({
      color: 0xd68a4e, metalness: 1, roughness: 0.32,
      roughnessMap: brushCu, envMapIntensity: 1.25,
    }),
    rubber: new THREE.MeshStandardMaterial({
      color: 0x141519, metalness: 0, roughness: 0.93,
      normalMap: micro2, normalScale: new THREE.Vector2(0.7, 0.7), envMapIntensity: 0.5,
    }),
    // the vinyl — near black with the groove map doing the work, and a touch of
    // iridescence for the sheen bands a record throws under a point light
    vinyl: new THREE.MeshPhysicalMaterial({
      color: 0x0b0b0d, metalness: 0.06, roughness: 0.55,
      map: groove.map, roughnessMap: groove.roughnessMap, normalMap: groove.normalMap,
      normalScale: new THREE.Vector2(0.4, 0.4),
      clearcoat: 0.5, clearcoatRoughness: 0.35, envMapIntensity: 0.8,
      sheen: 0.25, sheenColor: new THREE.Color(0x9c6636), sheenRoughness: 0.5,
      iridescence: 0.16, iridescenceIOR: 1.3, iridescenceThicknessRange: [80, 320],
    }),
    vinylEdge: new THREE.MeshStandardMaterial({
      color: 0x0a0a0c, metalness: 0.05, roughness: 0.6, envMapIntensity: 0.6,
    }),
    labelA: new THREE.MeshPhysicalMaterial({
      map: labelMap('A'), metalness: 0, roughness: 0.84,
      normalMap: paperN, normalScale: new THREE.Vector2(0.22, 0.22),
      sheen: 0.12, sheenColor: new THREE.Color(0xf6ecd8), sheenRoughness: 0.85,
      envMapIntensity: 0.6, clearcoat: 0.10, clearcoatRoughness: 0.65,
    }),
    labelB: new THREE.MeshPhysicalMaterial({
      map: labelMap('B'), metalness: 0, roughness: 0.84,
      normalMap: paperN, normalScale: new THREE.Vector2(0.22, 0.22),
      sheen: 0.12, sheenColor: new THREE.Color(0xf6ecd8), sheenRoughness: 0.85,
      envMapIntensity: 0.6, clearcoat: 0.10, clearcoatRoughness: 0.65,
    }),
  };
}

/* ============================== build =================================== */
export function createTurntable(labelOpts = {}) {
  const M = createMaterials(labelOpts);
  const root = new THREE.Group();
  const assembly = new THREE.Group();
  root.add(assembly);

  const yTop = D.hh;                                   // +0.85  plinth top
  const platterY = yTop + D.platter.h / 2;             // +1.275
  const recordY = yTop + D.platter.h + D.record.h / 2; // +1.7275
  const recordTop = yTop + D.platter.h + D.record.h;   // +1.755
  const weightY = recordTop + D.weight.h / 2;          // +1.925
  const LABEL_DY = 0.006;                              // the label rides proud of the record

  const gPlinth = new THREE.Group();
  const spin = new THREE.Group();
  const gPlatter = new THREE.Group(); gPlatter.position.set(0, platterY, 0);
  const gRecord = new THREE.Group(); gRecord.position.set(0, recordY, 0);
  const gWeight = new THREE.Group(); gWeight.position.set(0, weightY, 0);
  const gArm = new THREE.Group(); gArm.position.set(D.arm.pivot[0], yTop, D.arm.pivot[1]);
  spin.add(gPlatter, gRecord, gWeight);
  assembly.add(gPlinth, spin, gArm);

  /* ---------------- plinth + feet ---------------- */
  bakeInto(gPlinth, [mesh(box(D.W, D.H, D.Dp, D.rOut), M.glass)]);
  {
    const feet = [];
    for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
      const fx = sx * (D.hw - D.feet.inset);
      const fz = sz * (D.hz - D.feet.inset);
      feet.push(mesh(latheCyl(D.feet.r, D.feet.r, D.feet.h, 0.04, 28), M.metal, fx, -D.hh - D.feet.h / 2, fz));
      feet.push(mesh(latheCyl(D.feet.r * 0.6, D.feet.r * 0.6, 0.06, 0.02, 24), M.rubber, fx, -D.hh - D.feet.h + 0.03, fz));
    }
    bakeInto(gPlinth, feet);
  }

  /* ---------------- platter + spindle + slip mat ---------------- */
  bakeInto(gPlatter, [
    mesh(latheCyl(D.platter.r, D.platter.r, D.platter.h, D.platter.chamfer, 64), M.metal),
    mesh(latheCyl(D.spindle.r, D.spindle.r, D.spindle.h, 0.02, 24), M.metalDark, 0, D.platter.h / 2 + D.spindle.h / 2, 0),
    mesh(latheCyl(D.platter.r - 0.15, D.platter.r - 0.15, 0.03, 0.01, 64), M.rubber, 0, D.platter.h / 2 + 0.015, 0),
  ]);

  /* ---------------- record ---------------- */
  {
    const bits = [];
    bits.push(mesh(new THREE.CylinderGeometry(D.record.r, D.record.r, D.record.h, 128, 1, true), M.vinylEdge));
    const fT = new THREE.RingGeometry(D.record.holeR, D.record.r, 128);
    fT.rotateX(-Math.PI / 2);
    bits.push(mesh(fT, M.vinyl, 0, D.record.h / 2, 0));
    const fB = new THREE.RingGeometry(D.record.holeR, D.record.r, 128);
    fB.rotateX(Math.PI / 2);
    bits.push(mesh(fB, M.vinyl, 0, -D.record.h / 2, 0));
    bakeInto(gRecord, bits);
  }
  // the two printed labels ride on the record's faces, referenceable for the
  // write head, so they are added directly rather than baked away
  const lgA = new THREE.RingGeometry(D.record.holeR + 0.01, D.record.labelR, 64);
  lgA.rotateX(-Math.PI / 2);
  const labA = mesh(lgA, M.labelA, 0, D.record.h / 2 + LABEL_DY, 0);
  const lgB = new THREE.RingGeometry(D.record.holeR + 0.01, D.record.labelR, 64);
  lgB.rotateX(Math.PI / 2);
  const labB = mesh(lgB, M.labelB, 0, -D.record.h / 2 - LABEL_DY, 0);
  gRecord.add(labA, labB);

  /* ---------------- the copper record weight ---------------- */
  {
    const bits = [];
    bits.push(mesh(new THREE.CylinderGeometry(D.weight.r, D.weight.r, D.weight.h, 64, 1, true), M.copper));
    bits.push(mesh(new THREE.CylinderGeometry(D.weight.holeR, D.weight.holeR, D.weight.h, 48, 1, true), M.copper));
    const wT = new THREE.RingGeometry(D.weight.holeR, D.weight.r, 64);
    wT.rotateX(-Math.PI / 2);
    bits.push(mesh(wT, M.copper, 0, D.weight.h / 2, 0));
    const wB = new THREE.RingGeometry(D.weight.holeR, D.weight.r, 64);
    wB.rotateX(Math.PI / 2);
    bits.push(mesh(wB, M.copper, 0, -D.weight.h / 2, 0));
    bakeInto(gWeight, bits);
  }

  /* ---------------- tonearm ---------------- */
  const gCart = new THREE.Group();
  gCart.position.set(D.arm.len, 0, 0);
  // the stylus tip sits at the cart's origin, so the swing below aims it exactly
  bakeInto(gCart, [
    mesh(box(0.5, 0.10, 0.28, 0.02), M.metalDark, -0.42, 0.02, 0),   // headshell
    mesh(box(0.26, 0.12, 0.20, 0.02), M.metal, -0.12, -0.06, 0),     // cartridge
    mesh(box(0.015, 0.13, 0.015, 0.004), M.metalDark, 0, -0.15, 0),  // stylus
  ]);
  const swing = new THREE.Group();
  swing.position.set(0, D.arm.y, 0);
  const lift = new THREE.Group();
  swing.add(lift);
  {
    const tube = new THREE.CylinderGeometry(0.05, 0.055, D.arm.len + 1.2, 24);
    tube.rotateZ(-Math.PI / 2);
    lift.add(mesh(tube, M.metal, (D.arm.len - 1.2) / 2, 0, 0));
    lift.add(mesh(latheCyl(0.24, 0.24, 0.5, 0.03, 28), M.metalDark, -1.0, 0, 0));  // counterweight
    lift.add(gCart);
  }
  gArm.add(mesh(latheCyl(0.16, 0.20, 0.5, 0.03, 28), M.metalDark, 0, 0.25, 0));   // bearing post
  gArm.add(swing);

  /* ---------------- the write head ----------------
     A label rewrite is the same circular sweep the cassette used: the incoming
     print rides on a copy of the label disc and is let in through a window that
     crosses the card, and the base's map is only handed over once the window has
     left the far edge. The label's uv is already 0..1, so the sweep is a single
     offset on `offset.x` — no repeat scaling, unlike the cassette's raw shape. */
  const labelR = D.record.labelR;
  const headLayers = [];
  const HEAD_W = 0.30;
  const HEAD_STOP_X = labelR - HEAD_W / 2;
  const HEAD_END_X = HEAD_STOP_X - 0.30;
  const HEAD_START_X = -labelR - HEAD_W / 2;
  const HEAD_LIT = 0.30;
  const HEAD_FADE = 0.8;
  const head = { x: HEAD_START_X, enter: 0, dying: false, fade: 0 };
  {
    const mk = (src, dy, streakY, up) => {
      const geo = src.geometry.clone();
      const mat = src.material.clone();
      mat.transparent = true;
      mat.depthWrite = false;
      mat.alphaMap = TX.sweepAlpha();
      const o = new THREE.Mesh(geo, mat);
      o.position.copy(src.position); o.position.y += dy;
      o.rotation.copy(src.rotation);
      o.castShadow = false;
      o.receiveShadow = true;
      o.renderOrder = 8;
      o.visible = false;
      o.userData.noGhost = true;
      const st = new THREE.Mesh(
        new THREE.PlaneGeometry(HEAD_W, labelR * 2),
        new THREE.MeshBasicMaterial({
          map: TX.headStreak(), transparent: true, opacity: 0, color: 0xffe9c8,
          blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
        })
      );
      st.rotation.x = up ? -Math.PI / 2 : Math.PI / 2;
      st.position.set(HEAD_START_X, streakY, 0);
      st.renderOrder = 9;
      st.visible = false;
      st.userData.noGhost = true;
      src.parent.add(o, st);
      headLayers.push({ o, mat, st });
    };
    mk(labA, 0.004, D.record.h / 2 + LABEL_DY + 0.010, true);
    mk(labB, -0.004, -D.record.h / 2 - LABEL_DY - 0.010, false);
  }
  function paintHead() {
    const op = HEAD_LIT * head.enter * (1 - smoothstep(0, 1, head.fade));
    const wide = 1 + head.fade * 0.8;
    for (const L of headLayers) {
      L.st.material.opacity = op;
      L.st.position.x = head.x;
      L.st.scale.x = wide;
    }
  }

  /* ---------------- analysis anchors ---------------- */
  const anchor = (parent, x, y, z) => {
    const o = new THREE.Object3D();
    o.position.set(x, y, z);
    parent.add(o);
    return o;
  };
  const anchors = {
    plinth: anchor(gPlinth, 5.0, yTop, 3.4),
    platter: anchor(gPlatter, 0, -0.12, D.platter.r - 0.05),
    record: anchor(gRecord, -2.5, D.record.h / 2 + 0.02, 1.5),
    arm: anchor(gArm, 3.0, D.arm.y, 0.4),
    cart: anchor(gCart, -0.1, -0.06, 0),
  };

  /* ---------------- explode ---------------- */
  const EXPLODE = [
    [gWeight, 4.2],
    [gRecord, 2.6],
    [gPlatter, 1.2],
    [gArm, 1.0],
    [gPlinth, 0],
  ];
  const baseY = new Map(EXPLODE.map(([o]) => [o, o.position.y]));

  /** drive the record from outside (an <audio> element's currentTime) */
  function setProgress(frac) {
    st.frac = clamp(frac, 0, 1);
    st.driven = true;
  }

  /* ---------------- transport state ---------------- */
  const A_TOTAL = Math.PI * D.record.r * D.record.r;
  const st = {
    frac: 0, angle: 0, cue: 0, introSpin: 0,
    playing: false, dir: -1, driven: false,
    explode: 0, explodeTarget: 0, flip: 0, flipTarget: 0,
    time: 0, duration: 0,
  };

  const foldAngle = (a) => a % (Math.PI * 2);
  const armRadius = (frac) => D.arm.rOut + (D.arm.rIn - D.arm.rOut) * frac;
  /** aim the tonearm so its stylus rests on the groove at the given radius */
  function aimArm(r) {
    const [px, pz] = D.arm.pivot;
    const Dp = Math.hypot(px, pz);
    const L = D.arm.len;
    const cosB = clamp((Dp * Dp + r * r - L * L) / (2 * Dp * r), -1, 1);
    const B = Math.acos(cosB);
    const alpha = Math.atan2(pz, px);
    const phi = alpha + B;                      // the solution whose stylus sweeps the near side
    const sx = Math.cos(phi) * r, sz = Math.sin(phi) * r;
    const dx = sx - px, dz = sz - pz;
    swing.rotation.y = Math.atan2(-dz, dx);
  }

  function update(dt) {
    // ---- transport (internal simulation while the audio element isn't driving)
    if (st.playing && !st.driven) {
      if (st.dir < 0) {
        st.frac += dt / Math.max(st.duration, 1);
        if (st.frac >= 1) { st.frac = 1; st.dir = 1; }   // the side is over: spool back
      } else {
        st.frac -= dt / REW_SECONDS;
        if (st.frac <= 0) { st.frac = 0; st.dir = -1; } // back at the lead-in
      }
    }
    st.frac = clamp(st.frac, 0, 1);
    st.time = st.frac * st.duration;

    // ---- spin — 33⅓ forward (clockwise from above), faster while rewinding
    if (st.playing) {
      const fwd = st.dir < 0 ? 1 : -1;
      const rpm = st.dir < 0 ? RPM : RPM * 1.6;
      st.angle = foldAngle(st.angle - fwd * (rpm / 60) * Math.PI * 2 * dt);
    }
    if (st.introSpin > 0) {                         // the boot spins the record by hand
      st.angle = foldAngle(st.angle + 16 * dt);
      st.introSpin -= dt;
    }
    spin.rotation.y = st.angle;

    // ---- tonearm: track the groove, cue the needle down only while playing
    const targetCue = st.playing ? 1 : 0;
    st.cue = damp(st.cue, targetCue, 6, dt);
    aimArm(armRadius(st.frac));
    lift.rotation.z = (1 - st.cue) * D.arm.lift;

    // ---- explode / flip
    st.explode = damp(st.explode, st.explodeTarget, 3.4, dt);
    st.flip = damp(st.flip, st.flipTarget, 4.2, dt);
    const e = st.explode;
    for (const [o, y] of EXPLODE) o.position.y = baseY.get(o) + y * e;
    assembly.rotation.x = -Math.PI * st.flip;
    // flipping about X sweeps the plinth's half-depth (~5.5) below the floor, so
    // the whole machine arcs up out of the way first, like lifting it to turn it over
    assembly.position.y = Math.sin(Math.PI * st.flip) * 3.6;
    return st;
  }

  return {
    root, assembly, materials: M, anchors, st, update, setProgress,
    A_TOTAL,
    /* The write head's own materials — copies of the label materials, not part of
       `materials`, so main.js must hand them the same envMap the labels get (see
       bindProbe) or the print they reveal is lit by a different room. */
    headMaterials: headLayers.map((L) => L.mat),
    setExplode: (on) => { st.explodeTarget = on ? 1 : 0; },
    setFlip: (on) => { st.flipTarget = on ? 1 : 0; },

    /* ---- the write head, driven from outside ---------------------------
       `setLabel` draws a new print and parks it off the leading edge,
       `sweepLabel` walks the window across the label (0 → 1), and `commitLabel`
       hands the print over to the label itself. The caller owns the clock. */
    setLabel(opts) {
      const neu = [makeLabelMap('A', opts), makeLabelMap('B', opts)];
      const old = [M.labelA.map, M.labelB.map];
      head.x = HEAD_START_X;
      head.enter = 0;
      head.dying = false;
      head.fade = 0;
      for (let i = 0; i < 2; i++) {
        headLayers[i].mat.map = neu[i];
        headLayers[i].o.visible = true;
        headLayers[i].st.visible = true;
      }
      paintHead();
      return { neu, old };
    },
    sweepLabel(p) {
      const k = clamp(p, 0, 1);
      const off = 1.05 - k * 1.17;        // the window crosses the label left → right
      for (const L of headLayers) {
        L.mat.alphaMap.offset.x = off;
      }
      const x = (0.45 - off) * (labelR * 2);
      head.x = Math.min(x, HEAD_STOP_X);
      head.enter = smoothstep(0.03, 0.14, k);
      if (x >= HEAD_END_X) head.dying = true;
      paintHead();
    },
    stepHead(dt) {
      if (!head.dying || head.fade >= 1) return;
      head.fade = Math.min(1, head.fade + dt / HEAD_FADE);
      paintHead();
      if (head.fade >= 1) for (const L of headLayers) L.st.visible = false;
    },
    commitLabel() {
      M.labelA.map = headLayers[0].mat.map;
      M.labelB.map = headLayers[1].mat.map;
      for (const L of headLayers) L.o.visible = false;
    },
    warmLabel(on) {
      for (const L of headLayers) {
        L.o.visible = on;
        L.st.visible = on;
        L.st.material.opacity = 0;
        L.mat.alphaMap.offset.x = on ? 0.4 : 1.55;
        L.st.position.x = HEAD_START_X;
        L.st.scale.x = 1;
      }
      head.x = HEAD_START_X;
      head.enter = 0;
      head.dying = false;
      head.fade = 0;
    },
    parts: {
      gPlinth, gPlatter, gRecord, gWeight, gArm, gCart, spin,
      plinth: gPlinth, platter: gPlatter, record: gRecord, weight: gWeight,
      arm: gArm, cart: gCart,
    },
    dispose: () => assembly.traverse((o) => { if (o.isMesh) o.geometry.dispose?.(); }),
  };
}
