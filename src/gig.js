/* global THREE */
// Gig mode: a 3D venue with a crowd that reacts to your mixing.
// The crowd's hype goes up with smooth blends, drops and energy, and down with
// train wrecks, dead air and playing one track for too long.

import { matchState } from './lessons.js';

const STORE_KEY = 'djwoo.gigs.v1';
const UNLOCK_KEY = 'djwoo.unlockAll';
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const lerp = (a, b, k) => a + (b - a) * k;
const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

function loadJson(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } }
function saveJson(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* storage unavailable */ } }

// Original venues, each an archetype of a famous kind of place to play.
export const VENUES = [
  {
    id: 'basement', name: 'The Basement', stars: 0, capacity: 150, genres: 'House · Rap',
    vibe: 'A sweaty underground club. Low ceiling, one red light, 150 people packed in tight.',
    sky: 0x070304, fog: [0x0d0405, 4, 22], floor: 0x1b1214, hemi: [0x8a4a50, 0x2a1012, 2.4],
    palette: [0xff2a3d, 0xff6a3d, 0xff2a3d, 0xffffff], crowd: { type: 'rect', w: 11, d: 9 }, max: 150,
    build: 'club', screen: [5, 2.2],
  },
  {
    id: 'rooftop', name: 'Rooftop Block Party', stars: 1, capacity: 260, genres: 'Rap · House',
    vibe: 'Golden hour on a city rooftop. Skyline glowing, hip-hop heads on the deck.',
    sky: 0x2a1b3d, fog: [0x3a2440, 18, 70], floor: 0x2c2a30, hemi: [0xffb980, 0x30203a, 2.2],
    palette: [0xffb03a, 0xff5e8a, 0x7c5cff, 0xffe6a0], crowd: { type: 'rect', w: 15, d: 11 }, max: 260,
    build: 'rooftop', screen: [6, 2.6],
  },
  {
    id: 'terrace', name: 'Sunset Terrace', stars: 3, capacity: 420, genres: 'Progressive House',
    vibe: 'An open-air terrace above the sea. The sun sets behind the crowd during your set.',
    sky: 0xff8a5c, fog: [0xff9a6a, 30, 120], floor: 0xd9c3a5, hemi: [0xffc49a, 0x5a3a50, 2.4],
    palette: [0xffd27a, 0xff7b5c, 0xff5ea0, 0xfff0d0], crowd: { type: 'rect', w: 18, d: 13 }, max: 420,
    build: 'terrace', screen: [6, 2.6],
  },
  {
    id: 'warehouse', name: 'Neon Warehouse', stars: 5, capacity: 800, genres: 'Prog · EDM · House',
    vibe: 'Concrete, steel trusses and lasers until 6am.',
    sky: 0x05060a, fog: [0x080a12, 8, 48], floor: 0x18191d, hemi: [0x3a4a80, 0x0a0a10, 1.2],
    palette: [0x2af5ff, 0xff2ad4, 0x7c4dff, 0x2aff8a], crowd: { type: 'rect', w: 22, d: 20 }, max: 800,
    build: 'warehouse', screen: [9, 3.4], lasers: true,
  },
  {
    id: 'canyon', name: 'Canyon Amphitheater', stars: 8, capacity: 1400, genres: 'Everything',
    vibe: 'Rows of seats cut into red rock, under a sky full of stars.',
    sky: 0x0a0d1f, fog: [0x10142a, 30, 110], floor: 0x5a2c1e, hemi: [0x6a7ab0, 0x5a2a1a, 1.8],
    palette: [0xff7a3a, 0x3ac8ff, 0xffd23a, 0xff3a7a], crowd: { type: 'tiers', rows: 16, r0: 5, arc: 2.3 }, max: 1400,
    build: 'canyon', screen: [10, 4], lasers: true, starsSky: true,
  },
  {
    id: 'mainstage', name: 'Festival Mainstage', stars: 11, capacity: 3000, genres: 'EDM · Prog',
    vibe: 'A huge LED stage with pyro, in front of a field of 3,000 people.',
    sky: 0x080616, fog: [0x0e0a24, 30, 140], floor: 0x1d2a1a, hemi: [0x5a4aa0, 0x10200e, 1.6],
    palette: [0xff3af0, 0x3a8aff, 0x3affd2, 0xffe23a], crowd: { type: 'rect', w: 44, d: 40 }, max: 1800,
    build: 'festival', screen: [18, 7], lasers: true, pyro: true, starsSky: true,
  },
];

// ------------------------------------------------------------------ crowd placement

function rng(seed) { let s = seed % 2147483647 || 1; return () => (s = (s * 16807) % 2147483647) / 2147483647; }

function crowdSpots(v, rand) {
  const spots = [];
  const c = v.crowd;
  if (c.type === 'rect') {
    for (let z = 1.8; z < 1.8 + c.d; z += 0.72) {
      const halfW = c.w / 2 * (0.75 + 0.25 * Math.min(1, (z - 1.8) / 4)); // tighter at the barrier
      for (let x = -halfW; x <= halfW; x += 0.68) {
        spots.push({ x: x + (rand() - 0.5) * 0.35, y: 0, z: z + (rand() - 0.5) * 0.3 });
      }
    }
  } else {
    for (let row = 0; row < c.rows; row++) {
      const r = c.r0 + row * 1.15;
      const step = 0.72 / r;
      for (let t = -Math.PI / 2 - c.arc / 2; t <= -Math.PI / 2 + c.arc / 2; t += step) {
        const tt = t + (rand() - 0.5) * step * 0.4;
        spots.push({ x: Math.cos(tt) * r, y: row * 0.45, z: -Math.sin(tt) * r + 0.5 });
      }
    }
  }
  spots.sort((a, b) => a.z - b.z); // front rows first, so a thinner crowd empties from the back
  return spots.slice(0, v.max);
}

// ------------------------------------------------------------------ scene

function basicMat(color, opts = {}) { return new THREE.MeshLambertMaterial({ color, ...opts }); }
function glowMat(color, opacity = 1) {
  return new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
}

function buildVenue(v) {
  const rand = rng(v.id.length * 7919 + 13);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(v.sky);
  scene.fog = new THREE.Fog(v.fog[0], v.fog[1], v.fog[2]);
  const hemi = new THREE.HemisphereLight(v.hemi[0], v.hemi[1], v.hemi[2]);
  scene.add(hemi);
  const wash = new THREE.PointLight(v.palette[0], 0, 0, 0);
  wash.position.set(0, 7, 8);
  scene.add(wash);
  const fx = { hemi, hemiBase: v.hemi[2], wash, heads: [], lasers: [], pyro: [], spin: [] };

  // ground
  const groundSize = v.build === 'festival' || v.build === 'canyon' ? 260 : 120;
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(groundSize, groundSize), basicMat(v.floor));
  ground.rotation.x = -Math.PI / 2;
  ground.position.z = 20;
  scene.add(ground);

  // stage + booth
  const stageW = Math.max(8, v.screen[0] + 4);
  const stage = new THREE.Mesh(new THREE.BoxGeometry(stageW, 1, 6), basicMat(0x15151a));
  stage.position.set(0, 0.5, -2.5);
  scene.add(stage);
  const barrier = new THREE.Mesh(new THREE.BoxGeometry(stageW + 2, 1.1, 0.15), basicMat(0x2a2a30));
  barrier.position.set(0, 0.55, 1.1);
  scene.add(barrier);
  const booth = new THREE.Mesh(new THREE.BoxGeometry(3.2, 1, 0.9), basicMat(0x0c0c10));
  booth.position.set(0, 1.5, -1.3);
  scene.add(booth);
  const boothFront = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 0.9), glowMat(v.palette[1], 0.55));
  boothFront.position.set(0, 1.5, -0.84);
  scene.add(boothFront);
  fx.boothFront = boothFront;
  for (const x of [-0.95, 0.95]) {
    const platter = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.06, 28), basicMat(0x2a2a2e));
    platter.position.set(x, 2.03, -1.35);
    const mark = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.02, 0.32), glowMat(x < 0 ? 0x3ec7e0 : 0xf29a3f));
    mark.position.set(0, 0.04, 0.15);
    platter.add(mark);
    scene.add(platter);
    fx.spin.push(platter);
  }
  const mixer = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.08, 0.7), basicMat(0x1a1a20));
  mixer.position.set(0, 2.04, -1.35);
  scene.add(mixer);

  // LED screen behind the DJ, driven by a canvas visualiser
  const led = document.createElement('canvas');
  led.width = 256; led.height = 112;
  const ledTex = new THREE.CanvasTexture(led);
  ledTex.colorSpace = THREE.SRGBColorSpace;
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(v.screen[0], v.screen[1]), new THREE.MeshBasicMaterial({ map: ledTex, fog: false }));
  screen.position.set(0, 1 + v.screen[1] / 2 + 0.6, -5.4);
  scene.add(screen);
  fx.led = { canvas: led, ctx: led.getContext('2d'), tex: ledTex };

  // light truss with moving-head beams
  const trussY = v.build === 'club' ? 3.6 : v.build === 'festival' ? 11 : 6.5;
  const truss = new THREE.Mesh(new THREE.BoxGeometry(stageW, 0.25, 0.25), basicMat(0x333338));
  truss.position.set(0, trussY, 0);
  scene.add(truss);
  const nHeads = v.build === 'club' ? 4 : v.build === 'festival' ? 10 : 6;
  const beamLen = v.build === 'club' ? 9 : v.build === 'festival' ? 40 : 24;
  for (let i = 0; i < nHeads; i++) {
    const pivot = new THREE.Object3D();
    pivot.position.set(-stageW / 2 + 0.8 + (i * (stageW - 1.6)) / Math.max(1, nHeads - 1), trussY, 0);
    const geo = new THREE.ConeGeometry(beamLen * 0.14, beamLen, 16, 1, true);
    geo.translate(0, -beamLen / 2, 0);
    const beam = new THREE.Mesh(geo, glowMat(v.palette[i % v.palette.length], 0.1));
    pivot.add(beam);
    scene.add(pivot);
    fx.heads.push({ pivot, beam, i });
  }

  if (v.lasers) {
    for (let i = 0; i < 8; i++) {
      const geo = new THREE.BoxGeometry(0.03, 0.03, 60);
      geo.translate(0, 0, 30);
      const laser = new THREE.Mesh(geo, glowMat(i % 2 ? 0x2aff6a : 0xff2a5a, 0.0));
      laser.position.set((i - 3.5) * 0.5, trussY - 0.3, -1);
      scene.add(laser);
      fx.lasers.push({ laser, i });
    }
  }
  if (v.pyro) {
    for (const x of [-stageW / 2 + 1, -stageW / 4, stageW / 4, stageW / 2 - 1]) {
      const flame = new THREE.Mesh(new THREE.ConeGeometry(0.6, 5, 10, 1, true), glowMat(0xff7a1a, 0));
      flame.position.set(x, 3.6, -0.5);
      scene.add(flame);
      fx.pyro.push(flame);
    }
  }
  if (v.starsSky) {
    const n = 900;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const a = rand() * Math.PI * 2, e = 0.12 + rand() * 1.2, r = 120;
      pos.set([Math.cos(a) * Math.cos(e) * r, Math.sin(e) * r, Math.sin(a) * Math.cos(e) * r + 20], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    scene.add(new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 0.5, fog: false })));
  }

  buildSet(v, scene, rand, stageW, fx);
  const crowd = buildCrowd(v, scene, rand);
  return { scene, fx, crowd };
}

function buildSet(v, scene, rand, stageW, fx) {
  const add = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); scene.add(m); return m; };
  if (v.build === 'club') {
    const wall = basicMat(0x24161a);
    add(new THREE.BoxGeometry(18, 4.2, 0.3), wall, 0, 2.1, -6);
    add(new THREE.BoxGeometry(0.3, 4.2, 20), wall, -8, 2.1, 4);
    add(new THREE.BoxGeometry(0.3, 4.2, 20), wall, 8, 2.1, 4);
    add(new THREE.BoxGeometry(18, 0.2, 20), basicMat(0x120a0c), 0, 4.2, 4);
    for (const x of [-7, 7]) add(new THREE.BoxGeometry(1.2, 2, 1), basicMat(0x0a0a0a), x, 1, 0.2); // speaker stacks
  } else if (v.build === 'rooftop') {
    for (let i = 0; i < 46; i++) {
      const w = 4 + rand() * 7, h = 10 + rand() * 45, a = -1.3 + (i / 46) * 2.6 + (rand() - 0.5) * 0.05;
      const r = 50 + rand() * 30;
      const b = add(new THREE.BoxGeometry(w, h, w), basicMat(0x1c1830), Math.sin(a) * r, h / 2 - 6, Math.cos(a) * r);
      b.lookAt(0, h / 2 - 6, 0);
      // lit windows
      for (let k = 0; k < 6; k++) {
        const win = add(new THREE.PlaneGeometry(w * 0.15, 0.6), glowMat(rand() < 0.5 ? 0xffd27a : 0x9ad0ff, 0.8), 0, 0, 0);
        b.add(win);
        win.position.set((rand() - 0.5) * w * 0.7, (rand() - 0.5) * h * 0.8, w / 2 + 0.02);
      }
    }
    add(new THREE.BoxGeometry(30, 1, 0.2), basicMat(0x3a3540), 0, 0.5, 15); // parapet
    for (let i = 0; i < 30; i++) add(new THREE.SphereGeometry(0.08, 6, 4), glowMat(0xffd27a), -12 + i * 0.83, 4 + Math.sin(i * 0.7) * 0.3, 6);
  } else if (v.build === 'terrace') {
    const sea = add(new THREE.PlaneGeometry(400, 200), new THREE.MeshBasicMaterial({ color: 0x3a5c9a, fog: true }), 0, -3, 110);
    sea.rotation.x = -Math.PI / 2;
    add(new THREE.SphereGeometry(9, 24, 16), new THREE.MeshBasicMaterial({ color: 0xffd27a, fog: false }), 0, 4, 140);
    fx.sun = scene.children[scene.children.length - 1];
    for (let x = -10; x <= 10; x += 1) add(new THREE.BoxGeometry(0.08, 1, 0.08), basicMat(0xffffff), x, 0.5, 16);
    add(new THREE.BoxGeometry(21, 0.08, 0.08), basicMat(0xffffff), 0, 1, 16);
    for (const x of [-9, 9]) {
      add(new THREE.CylinderGeometry(0.15, 0.25, 7, 6), basicMat(0x6a4a30), x, 3.5, 8);
      add(new THREE.ConeGeometry(2.2, 1.4, 7), basicMat(0x2a6a3a), x, 7.2, 8);
    }
  } else if (v.build === 'warehouse') {
    const wall = basicMat(0x1e2024);
    add(new THREE.BoxGeometry(30, 12, 0.4), wall, 0, 6, -7);
    add(new THREE.BoxGeometry(0.4, 12, 40), wall, -13, 6, 12);
    add(new THREE.BoxGeometry(0.4, 12, 40), wall, 13, 6, 12);
    for (let z = 4; z < 26; z += 7) for (const x of [-9, 9]) add(new THREE.BoxGeometry(0.6, 12, 0.6), basicMat(0x2a2c30), x, 6, z);
    for (let z = 3; z < 26; z += 5) add(new THREE.BoxGeometry(26, 0.3, 0.3), basicMat(0x2a2c30), 0, 9, z);
  } else if (v.build === 'canyon') {
    const rock = basicMat(0x8a3a22);
    for (const side of [-1, 1]) {
      for (let i = 0; i < 5; i++) {
        const m = add(new THREE.DodecahedronGeometry(10 + rand() * 8, 0), rock, side * (24 + i * 4), 6 + rand() * 6, -4 + i * 9);
        m.scale.set(1, 1.8 + rand(), 1);
        m.rotation.set(rand(), rand(), rand());
      }
    }
    // stone tiers under the seats
    const c = v.crowd;
    for (let row = 0; row < c.rows; row++) {
      const r = c.r0 + row * 1.15;
      const ring = add(new THREE.RingGeometry(r - 0.58, r + 0.58, 40, 1, -Math.PI / 2 - c.arc / 2 - 0.05, c.arc + 0.1),
        basicMat(row % 2 ? 0x6a3424 : 0x5e2e20, { side: THREE.DoubleSide }), 0, row * 0.45 + 0.01, 0.5);
      ring.rotation.x = -Math.PI / 2;
    }
  } else if (v.build === 'festival') {
    const frame = basicMat(0x1a1a22);
    add(new THREE.BoxGeometry(stageW + 6, 1.2, 8), frame, 0, 15.5, -3); // roof
    for (const x of [-(stageW / 2 + 2.5), stageW / 2 + 2.5]) {
      add(new THREE.BoxGeometry(1, 15, 1), frame, x, 7.5, -3);
      add(new THREE.BoxGeometry(3, 8, 2), basicMat(0x0a0a0e), x, 10, 0.5); // line arrays
    }
    for (const x of [-30, 30]) for (let z = 10; z < 50; z += 20) {
      add(new THREE.CylinderGeometry(0.3, 0.3, 10, 6), frame, x, 5, z);
      const lamp = add(new THREE.SphereGeometry(0.6, 8, 6), glowMat(0xfff0c0), x, 10.2, z);
      fx.spin.push(lamp);
    }
  }
}

function buildCrowd(v, scene, rand) {
  const spots = crowdSpots(v, rand);
  const n = spots.length;
  const bodyGeo = new THREE.CylinderGeometry(0.17, 0.22, 1.15, 7);
  bodyGeo.translate(0, 0.575, 0);
  const headGeo = new THREE.SphereGeometry(0.135, 8, 6);
  headGeo.translate(0, 1.33, 0);
  const armGeo = new THREE.BoxGeometry(0.07, 0.58, 0.07);
  armGeo.translate(0, 0.29, 0);
  const phoneGeo = new THREE.PlaneGeometry(0.08, 0.14);

  const bodies = new THREE.InstancedMesh(bodyGeo, basicMat(0xffffff), n);
  const heads = new THREE.InstancedMesh(headGeo, basicMat(0xffffff), n);
  heads.instanceMatrix = bodies.instanceMatrix; // same transform for body and head
  const arms = new THREE.InstancedMesh(armGeo, basicMat(0xffffff), n * 2);
  const phones = new THREE.InstancedMesh(phoneGeo, glowMat(0xeaf4ff, 0.95), n);
  for (const m of [bodies, heads, arms, phones]) {
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.frustumCulled = false;
    scene.add(m);
  }

  const clothes = [0x1a1a1a, 0xf2f2f2, 0x2a3a6a, 0x8a1a2a, 0x2a5a3a, 0x6a4a8a, 0xd9a43a, 0x3a3a3a, ...v.palette];
  const skins = [0xf1c8a8, 0xd9a07a, 0xa86a48, 0x7a4a30, 0x4a2e20, 0xe6b48a];
  const col = new THREE.Color();
  const people = spots.map((s, i) => {
    const shirt = clothes[Math.floor(rand() * clothes.length)];
    bodies.setColorAt(i, col.setHex(shirt));
    heads.setColorAt(i, col.setHex(skins[Math.floor(rand() * skins.length)]));
    arms.setColorAt(i * 2, col.setHex(shirt));
    arms.setColorAt(i * 2 + 1, col.setHex(shirt));
    return {
      ...s,
      scale: 0.9 + rand() * 0.22,
      offset: rand() - 0.5,         // timing sloppiness
      dancer: 0.4 + rand() * 0.9,   // how hard they bounce
      handsAt: 45 + rand() * 55,    // hype at which their hands go up
      phoneAt: rand(),
      sway: rand() * Math.PI * 2,
    };
  });
  for (const m of [bodies, heads, arms]) m.instanceColor.needsUpdate = true;
  return { bodies, heads, arms, phones, people };
}

/** Write a uniform scale + Z rotation + translation into a column-major 4x4. */
function writeMatrix(arr, i, x, y, z, s, rot = 0) {
  const o = i * 16, c = Math.cos(rot) * s, sn = Math.sin(rot) * s;
  arr[o] = c; arr[o + 1] = sn; arr[o + 2] = 0; arr[o + 3] = 0;
  arr[o + 4] = -sn; arr[o + 5] = c; arr[o + 6] = 0; arr[o + 7] = 0;
  arr[o + 8] = 0; arr[o + 9] = 0; arr[o + 10] = s; arr[o + 11] = 0;
  arr[o + 12] = x; arr[o + 13] = y; arr[o + 14] = z; arr[o + 15] = 1;
}

// ------------------------------------------------------------------ gig controller

export function createGig(api) {
  const stageEl = document.getElementById('stage');
  const canvas = document.getElementById('stage-canvas');
  const panel = document.getElementById('venue-panel');
  const $ = (id) => document.getElementById(id);
  let renderer = null;
  let camera = null;
  let world = null;
  let gig = null;
  let records = loadJson(STORE_KEY, {});
  let unlockAll = loadJson(UNLOCK_KEY, false);
  const freq = new Uint8Array(1024);
  const wave = new Float32Array(2048);
  let lastT = performance.now();
  const shown = new Set();

  const totalStars = () => VENUES.reduce((n, v) => n + (records[v.id]?.stars || 0), 0);
  const unlocked = (v) => unlockAll || totalStars() >= v.stars;

  // ---------- venue picker
  function renderPanel() {
    const stars = totalStars();
    $('venue-stars').textContent = `${stars} ★ earned`;
    $('unlock-all').checked = unlockAll;
    $('venue-list').replaceChildren(...VENUES.map((v) => {
      const open = unlocked(v);
      const rec = records[v.id];
      const card = document.createElement('li');
      card.className = `venue-card${open ? '' : ' locked'}`;
      const sw = v.palette.map((c) => `#${c.toString(16).padStart(6, '0')}`);
      card.innerHTML = `
        <div class="venue-swatch" style="background:linear-gradient(135deg, #${v.sky.toString(16).padStart(6, '0')} 20%, ${sw[0]} 70%, ${sw[1]})"></div>
        <div class="venue-body">
          <div class="venue-name">${v.name}</div>
          <div class="venue-meta">${v.capacity.toLocaleString()} capacity · ${v.genres}</div>
          <div class="venue-vibe">${v.vibe}</div>
          ${rec ? `<div class="venue-best"><span class="stars">${'★'.repeat(rec.stars)}${'☆'.repeat(3 - rec.stars)}</span> best ${rec.score}</div>` : ''}
        </div>
        <button class="${open ? 'primary' : 'ghost'}" ${open ? '' : 'disabled'}>${open ? 'Play' : `Needs ${v.stars} ★`}</button>`;
      if (open) card.querySelector('button').addEventListener('click', () => begin(v));
      return card;
    }));
  }
  function openPanel() { renderPanel(); panel.hidden = false; }
  $('close-venues').addEventListener('click', () => { panel.hidden = true; });
  $('unlock-all').addEventListener('change', (e) => { unlockAll = e.target.checked; saveJson(UNLOCK_KEY, unlockAll); renderPanel(); });

  // ---------- renderer
  function ensureRenderer() {
    if (renderer) return;
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    camera = new THREE.PerspectiveCamera(62, 16 / 9, 0.1, 400);
  }

  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    const cur = renderer.getSize(new THREE.Vector2());
    if (cur.x !== w || cur.y !== h) {
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
  }

  function disposeWorld() {
    if (!world) return;
    world.scene.traverse((o) => {
      o.geometry?.dispose();
      const mats = [].concat(o.material || []);
      for (const m of mats) { m.map?.dispose(); m.dispose(); }
    });
    world = null;
  }

  // ---------- lifecycle
  async function begin(v) {
    panel.hidden = true;
    await api.ready();
    api.onGigStart?.();
    ensureRenderer();
    disposeWorld();
    world = buildVenue(v);
    shown.clear();
    gig = {
      venue: v, hype: 35, attendance: 0.45, started: false, setTime: 0, musicTime: 0, hypeSum: 0,
      silentFor: 0, bassFast: 0, bassLong: 0.2, lowBassFor: 0, breakdown: false, dropTimer: 0, cheerTimer: 0,
      blendTime: 0, blendCounted: false, clashTime: 0, clashCounted: false, trackTime: 0, restlessShown: false,
      domBuffer: null, mixes: 0, wrecks: 0, drops: 0, peakCrowd: 0, shoutReady: 0, cam: 'dj', beat: -1,
      deadShown: false, ended: false, chantShown: false, flash: 0, domDeck: null, domSwitch: 0, played: new Set(),
    };
    stageEl.hidden = false;
    document.body.classList.add('in-gig');
    $('hud-venue').textContent = v.name;
    $('gig-result').hidden = true;
    $('toasts').replaceChildren();
    stageEl.scrollIntoView({ block: 'start', behavior: 'smooth' });
    toast(`${v.name}: the crowd is waiting. Press play.`, 'info', 3500);
  }

  function exit() {
    gig = null;
    disposeWorld();
    stageEl.hidden = true;
    document.body.classList.remove('in-gig');
  }

  function endSet() {
    if (!gig || gig.ended) return;
    gig.ended = true;
    const g = gig;
    const avg = g.musicTime > 0 ? g.hypeSum / g.musicTime : 0;
    const tooShort = g.setTime < 60;
    const stars = tooShort ? 0 : avg >= 75 ? 3 : avg >= 60 ? 2 : avg >= 45 ? 1 : 0;
    const score = Math.max(0, Math.round(avg * 10 + g.mixes * 50 + g.drops * 30 - g.wrecks * 40));
    const prev = records[g.venue.id];
    const before = totalStars();
    if (!tooShort && (!prev || score > prev.score || stars > prev.stars)) {
      records[g.venue.id] = { stars: Math.max(stars, prev?.stars || 0), score: Math.max(score, prev?.score || 0) };
      saveJson(STORE_KEY, records);
    }
    const newly = VENUES.filter((v) => !unlockAll && v.stars > before && v.stars <= totalStars()).map((v) => v.name);
    const res = $('gig-result');
    res.hidden = false;
    res.innerHTML = `
      <h2>${tooShort ? 'Set too short' : stars === 3 ? 'You headlined it' : stars ? 'Solid set' : 'Tough crowd'}</h2>
      ${tooShort ? '<p>Play for at least a minute to get a rating.</p>' : `<div class="stars big">${'★'.repeat(stars)}${'☆'.repeat(3 - stars)}</div>`}
      <table class="breakdown">
        <tr><td>Set length</td><td>${fmt(g.setTime)}</td></tr>
        <tr><td>Average hype</td><td>${Math.round(avg)}</td></tr>
        <tr><td>Peak crowd</td><td>${g.peakCrowd.toLocaleString()}</td></tr>
        <tr><td>Smooth blends</td><td>${g.mixes}</td></tr>
        <tr><td>Drops landed</td><td>${g.drops}</td></tr>
        <tr><td>Train wrecks</td><td>${g.wrecks}</td></tr>
        <tr><td><b>Score</b></td><td><b>${tooShort ? '–' : score}</b></td></tr>
      </table>
      ${newly.length ? `<p class="unlock-note">Unlocked: <b>${newly.join(', ')}</b></p>` : ''}
      <div class="coach-btns"><button class="ghost" id="res-exit">Back to studio</button><button class="ghost" id="res-venues">Venues</button><button class="primary" id="res-again">Play again</button></div>`;
    const venue = g.venue;
    $('res-exit').addEventListener('click', exit);
    $('res-venues').addEventListener('click', () => { exit(); openPanel(); });
    $('res-again').addEventListener('click', () => begin(venue));
  }

  // ---------- HUD
  function toast(text, kind = 'info', ms = 2200) {
    const el = document.createElement('div');
    el.className = `toast ${kind}`;
    el.textContent = text;
    $('toasts').prepend(el);
    while ($('toasts').children.length > 3) $('toasts').lastChild.remove();
    setTimeout(() => el.remove(), ms);
  }
  function toastOnce(key, text, kind) { if (!shown.has(key)) { shown.add(key); toast(text, kind); } }

  function shout() {
    if (!gig || gig.ended) return;
    const now = performance.now();
    if (now < gig.shoutReady) { toast('Save the mic for the big moments', 'warn'); return; }
    gig.shoutReady = now + 20000;
    if (gig.silentFor > 0.5) { toast('Nobody cheers into silence', 'bad'); return; }
    gig.hype = clamp(gig.hype + 5, 0, 100);
    gig.cheerTimer = 2.2;
    toast('"Make some noise!" The crowd roars.', 'good');
  }

  function toggleCam() { if (gig) gig.cam = gig.cam === 'dj' ? 'crowd' : gig.cam === 'crowd' ? 'wide' : 'dj'; }

  $('end-set').addEventListener('click', endSet);
  $('exit-gig').addEventListener('click', exit);
  $('shout-btn').addEventListener('click', shout);
  $('cam-btn').addEventListener('click', toggleCam);
  window.addEventListener('keydown', (e) => {
    if (!gig || e.metaKey || e.ctrlKey || e.altKey || e.target.matches('input[type=text], input[type=search], textarea, select')) return;
    if (e.key === 'v' || e.key === 'V') toggleCam();
    if (e.key === 'm' || e.key === 'M') shout();
  });

  // ---------- audio analysis + crowd logic
  function audible(deck) { return deck.playing ? deck.level() * deck.xfade.gain.value : 0; }

  function simulate(dt) {
    const g = gig;
    const an = api.analyser();
    an.getFloatTimeDomainData(wave);
    let sum = 0;
    for (let i = 0; i < an.fftSize; i++) sum += wave[i] * wave[i];
    const rms = Math.sqrt(sum / an.fftSize);
    an.getByteFrequencyData(freq);
    const hzPerBin = an.context.sampleRate / an.fftSize;
    const bassBins = Math.max(2, Math.round(140 / hzPerBin));
    let bass = 0;
    for (let i = 1; i <= bassBins; i++) bass += freq[i];
    bass /= bassBins * 255;

    const music = rms > 0.012;
    const { A, B } = api.decks;
    if (!g.started && music) { g.started = true; toast('Here we go', 'info'); }
    if (g.ended) return { rms, bass, music };

    if (g.started) g.setTime += dt;
    g.bassFast = lerp(g.bassFast, bass, 1 - Math.exp(-dt * 8));
    if (music) g.bassLong = lerp(g.bassLong, bass, 1 - Math.exp(-dt * 0.06));
    const energy = clamp(g.bassFast * 1.5 + rms * 0.8, 0, 1);

    // dead air
    g.silentFor = music ? 0 : g.silentFor + dt;
    if (g.started && g.silentFor > 1.5) {
      g.hype -= 7 * dt;
      if (!g.deadShown) { g.deadShown = true; toast('Dead air! The crowd is booing', 'bad'); }
    } else if (music) g.deadShown = false;

    // blends and train wrecks
    // peak-hold envelopes: raw levels flicker between kicks, so hold each deck's level for ~half a second
    g.envA = Math.max(audible(A), (g.envA || 0) * Math.exp(-dt * 1.5));
    g.envB = Math.max(audible(B), (g.envB || 0) * Math.exp(-dt * 1.5));
    const audA = g.envA, audB = g.envB;
    // both decks count as "in the mix" when each is clearly present, even in a quiet intro
    const both = Math.min(audA, audB) > 0.006 && Math.min(audA, audB) > Math.max(audA, audB) * 0.15;
    const s = matchState(api.decks);
    if (both) {
      const locked = s?.bothPlaying && Math.abs(s.diff) < 0.15 && Math.abs(s.phase) < 0.05;
      if (locked) {
        g.clashTime = 0; g.clashCounted = false;
        g.blendTime += dt;
        g.hype += 1.8 * dt;
        if (g.blendTime > 4 && !g.blendCounted) { g.blendCounted = true; g.mixes++; toast('Smooth blend', 'good'); }
      } else {
        g.clashTime += dt;
        if (g.clashTime > 0.6) {
          g.hype -= 9 * dt;
          if (!g.clashCounted) { g.clashCounted = true; g.wrecks++; toast('Train wreck! The kicks are clashing', 'bad'); }
        }
      }
    } else {
      g.blendTime = 0; g.blendCounted = false; g.clashTime = 0; g.clashCounted = false;
    }

    // which deck the crowd is hearing: switch only once the other deck is clearly louder for a while
    const loud = audA >= audB ? A : B;
    const loudLvl = Math.max(audA, audB), quietLvl = Math.min(audA, audB);
    if (!g.domDeck) g.domDeck = loud;
    if (loud !== g.domDeck && loudLvl > 0.006 && loudLvl > quietLvl * 1.8) {
      g.domSwitch += dt;
      if (g.domSwitch > 1.5) { g.domDeck = loud; g.domSwitch = 0; }
    } else g.domSwitch = 0;
    const dom = g.domDeck;

    // fresh tracks vs. playing one too long
    if (music && dom.buffer && dom.buffer !== g.domBuffer) {
      if (g.domBuffer) toast(`Now playing: ${dom.name.replace('Demo: ', '')}`, 'info');
      if (g.domBuffer && !g.played.has(dom.buffer)) g.hype += 4;
      g.played.add(dom.buffer);
      g.domBuffer = dom.buffer; g.trackTime = 0; g.restlessShown = false;
    }
    g.trackTime += music ? dt : 0;
    if (g.trackTime > 150) {
      g.hype -= 1.2 * dt;
      if (!g.restlessShown) { g.restlessShown = true; toast('The crowd is getting restless. Mix in something new', 'warn'); }
    }

    // groove: bass-heavy music builds hype, thin sections let it sag a little
    if (music) g.hype += (energy * 1.3 - 0.35) * dt;

    // breakdown → drop
    if (music && g.bassFast < g.bassLong * 0.4) g.lowBassFor += dt; else if (!g.breakdown) g.lowBassFor = 0;
    if (!g.breakdown && g.lowBassFor > 3) { g.breakdown = true; toastOnce(`bd${g.drops}`, 'Breakdown: phones up', 'info'); }
    if (g.breakdown && music && g.bassFast > g.bassLong * 0.85) {
      g.breakdown = false; g.lowBassFor = 0;
      g.drops++; g.hype += 10; g.dropTimer = 2.5; g.flash = 1;
      toast('DROP! The whole place jumps', 'good');
    }
    g.dropTimer = Math.max(0, g.dropTimer - dt);
    g.cheerTimer = Math.max(0, g.cheerTimer - dt);
    g.flash = Math.max(0, g.flash - dt * 2.5);

    g.hype = clamp(g.hype, 0, 100);
    if (g.hype > 85 && !g.chantShown) { g.chantShown = true; toast('The crowd is chanting "one more tune!"', 'good'); }
    if (g.hype < 70) g.chantShown = false;
    if (g.started && music) { g.hypeSum += g.hype * dt; g.musicTime += dt; }

    // people arrive when it's going off and drift to the bar when it isn't
    g.attendance = lerp(g.attendance, 0.3 + 0.7 * (g.hype / 100), 1 - Math.exp(-dt * 0.15));
    return { rms, bass, music, energy, dom };
  }

  // ---------- per-frame
  function tick() {
    if (!gig || !world) return;
    const now = performance.now();
    const dt = Math.min(0.3, (now - lastT) / 1000);
    lastT = now;
    const g = gig;
    const audio = simulate(dt);
    const t = now / 1000;
    const v = g.venue;

    // beat clock from the loudest deck
    const dom = audio.dom || api.decks.A;
    let phase = (t * 2) % 1, beatIdx = Math.floor(t * 2);
    if (dom.bpm && dom.playing) {
      const b = (dom.position - dom.firstBeat) / (60 / dom.bpm);
      phase = b - Math.floor(b); beatIdx = Math.floor(b);
    }
    const onBeat = beatIdx !== g.beat;
    g.beat = beatIdx;
    const energy = audio.music ? audio.energy ?? 0 : 0;
    const hypeK = g.hype / 100;

    // crowd
    const { bodies, heads, arms, phones, people } = world.crowd;
    const visible = Math.max(1, Math.floor(people.length * clamp(g.attendance, 0, 1)));
    g.peakCrowd = Math.max(g.peakCrowd, Math.round(v.capacity * g.attendance));
    const bm = bodies.instanceMatrix.array, am = arms.instanceMatrix.array, pm = phones.instanceMatrix.array;
    const jumpAmp = audio.music ? (0.05 + 0.32 * hypeK) * (0.4 + 0.6 * energy) + (g.dropTimer > 0 ? 0.25 : 0) : 0.01;
    const phonesUp = g.breakdown || (!audio.music && g.started);
    for (let i = 0; i < visible; i++) {
      const p = people[i];
      let f = phase + p.offset * (0.35 - 0.3 * hypeK);
      f -= Math.floor(f);
      const y = p.y + jumpAmp * p.dancer * Math.pow(Math.sin(Math.PI * f), 2);
      const sway = audio.music ? Math.sin(t * 2 + p.sway) * 0.05 : 0;
      writeMatrix(bm, i, p.x + sway, y, p.z, p.scale);
      const hands = g.dropTimer > 0 || g.cheerTimer > 0 || (audio.music && g.hype > p.handsAt);
      const sh = y + 1.12 * p.scale;
      if (hands) {
        const wave2 = Math.sin(t * 3 + p.sway) * 0.25;
        writeMatrix(am, i * 2, p.x - 0.19 * p.scale + sway, sh, p.z, p.scale, 0.35 + wave2);
        writeMatrix(am, i * 2 + 1, p.x + 0.19 * p.scale + sway, sh, p.z, p.scale, -0.35 + wave2);
      } else {
        writeMatrix(am, i * 2, 0, -50, 0, 0);
        writeMatrix(am, i * 2 + 1, 0, -50, 0, 0);
      }
      if (phonesUp && p.phoneAt < 0.35 + hypeK * 0.4) writeMatrix(pm, i, p.x + 0.12, y + 1.75 * p.scale, p.z - 0.05, 1);
      else writeMatrix(pm, i, 0, -50, 0, 0);
    }
    bodies.count = heads.count = phones.count = visible;
    arms.count = visible * 2;
    bodies.instanceMatrix.needsUpdate = arms.instanceMatrix.needsUpdate = phones.instanceMatrix.needsUpdate = true;

    // lights
    const fx = world.fx;
    const pal = v.palette;
    const pulse = audio.music ? Math.pow(1 - phase, 3) : 0;
    fx.hemi.intensity = fx.hemiBase * (0.7 + 0.3 * energy) + g.flash * 3;
    fx.wash.color.setHex(pal[beatIdx % pal.length]);
    fx.wash.intensity = audio.music ? 0.6 + pulse * (0.8 + 1.6 * hypeK) : 0.15;
    for (const h of fx.heads) {
      const sp = 0.4 + hypeK * 0.8;
      h.pivot.rotation.z = Math.sin(t * sp + h.i * 0.9) * 0.6;
      h.pivot.rotation.x = -0.5 + Math.sin(t * sp * 0.7 + h.i) * 0.25;
      if (onBeat && audio.music) h.beam.material.color.setHex(pal[(beatIdx + h.i) % pal.length]);
      h.beam.material.opacity = audio.music ? 0.05 + 0.12 * energy + 0.1 * pulse * hypeK : 0.02;
    }
    for (const l of fx.lasers) {
      const on = audio.music && (g.hype > 60 || g.dropTimer > 0);
      l.laser.material.opacity = on ? 0.55 + 0.4 * pulse : 0;
      l.laser.rotation.y = Math.sin(t * 0.9 + l.i * 0.5) * 0.7;
      l.laser.rotation.x = -0.12 - Math.abs(Math.sin(t * 0.6 + l.i)) * 0.12;
    }
    for (const f of fx.pyro) {
      f.material.opacity = g.dropTimer > 1.5 ? (g.dropTimer - 1.5) : 0;
      f.scale.y = 0.6 + Math.random() * 0.6;
    }
    for (const s of fx.spin) s.rotation.y += dt * (dom.playing ? 3.5 * dom.rate : 0.2);
    if (fx.sun) fx.sun.position.y = 4 - Math.min(14, g.setTime / 30); // the sun sets during your set
    fx.boothFront.material.opacity = 0.35 + pulse * 0.5;
    drawLed(fx.led, pal, phase, hypeK, g);

    // camera
    resize();
    const bob = audio.music ? Math.pow(Math.sin(Math.PI * phase), 2) * 0.04 : 0;
    if (g.cam === 'dj') {
      camera.position.set(Math.sin(t * 0.3) * 0.15, 3.25 + bob, -3.7);
      camera.lookAt(0, 1.2, 12);
    } else if (g.cam === 'crowd') {
      const back = v.crowd.type === 'tiers' ? v.crowd.r0 + 6 : Math.min(10, v.crowd.d * 0.5);
      camera.position.set(Math.sin(t * 0.2) * 1.5, 2.1 + bob * 3 + (v.crowd.type === 'tiers' ? 2.5 : 0), back + 2);
      camera.lookAt(0, 2.6, -3);
    } else {
      const r = v.crowd.type === 'tiers' ? 30 : Math.max(18, v.crowd.d * 1.1);
      camera.position.set(Math.sin(t * 0.08) * r * 0.6, r * 0.45, r * 0.8);
      camera.lookAt(0, 0, v.crowd.type === 'tiers' ? 6 : v.crowd.d * 0.35);
    }
    renderer.render(world.scene, camera);

    // HUD
    $('hype-fill').style.transform = `scaleX(${hypeK})`;
    $('hype-fill').className = g.hype > 70 ? 'hot' : g.hype < 30 ? 'cold' : '';
    $('hype-val').textContent = Math.round(g.hype);
    $('hud-crowd').textContent = `${Math.round(v.capacity * g.attendance).toLocaleString()} / ${v.capacity.toLocaleString()} in the crowd`;
    $('hud-time').textContent = g.started ? fmt(g.setTime) : 'waiting…';
  }

  let ledFrame = 0;
  function drawLed(led, pal, phase, hypeK, g) {
    if (ledFrame++ % 2) return;
    const { ctx, canvas: c, tex } = led;
    const an = api.analyser();
    ctx.fillStyle = '#05050a';
    ctx.fillRect(0, 0, c.width, c.height);
    const bars = 32;
    for (let i = 0; i < bars; i++) {
      const v = freq[Math.floor(Math.pow(i / bars, 1.8) * 300) + 1] / 255;
      const h = v * c.height * 0.9;
      ctx.fillStyle = `#${pal[i % pal.length].toString(16).padStart(6, '0')}`;
      ctx.fillRect(i * (c.width / bars) + 1, c.height - h, c.width / bars - 2, h);
    }
    if (g.dropTimer > 0 || g.hype > 80) {
      ctx.fillStyle = `rgba(255,255,255,${0.5 + 0.5 * (1 - phase)})`;
      ctx.font = 'bold 34px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('DJWOO', c.width / 2, c.height / 2 + 12);
    }
    void an; void hypeK;
    tex.needsUpdate = true;
  }

  return { openPanel, tick, exit, get active() { return !!gig; }, get state() { return gig; } };
}
