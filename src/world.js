import * as THREE from 'three';
import { fbm2, ridged2, smoothstep, clamp, rng } from './noise.js';

export const WORLD_SIZE = 16000;
export const WORLD_HALF = WORLD_SIZE / 2;

export const AIRFIELD = { x: 1200, z: 4200, y: 26 };
export const CITY = { x: 3720, z: 3150 };

const ISLANDS = [
  // home island (airfield + city)
  { x: 1250, z: 3000, r: 3100, h: 240 },
  // east island
  { x: 3400, z: 250, r: 1750, h: 300 },
  // southern island
  { x: 2650, z: -2400, r: 1650, h: 360 },
  // big mountain island
  { x: -2550, z: -1500, r: 2950, h: 1150 },
  // west island
  { x: -4000, z: 1500, r: 2050, h: 620 },
  // north mountains
  { x: -450, z: -3900, r: 2600, h: 760 },
  // scattered specks on the horizon
  { x: 5700, z: -1300, r: 1400, h: 260 },
  { x: -1100, z: 5900, r: 2100, h: 260 },
  { x: 5400, z: 3900, r: 1700, h: 280 },
  { x: 6400, z: 1400, r: 1200, h: 200 },
  { x: -6000, z: -3200, r: 1900, h: 420 },
  { x: -5400, z: 4200, r: 1500, h: 240 },
];

const lerp = (a, b, t) => a + (b - a) * t;

/** World height in metres at x/z. Sea floor is negative. */
export function heightAt(x, z) {
  let h = -150;

  for (let i = 0; i < ISLANDS.length; i++) {
    const is = ISLANDS[i];
    const dx = x - is.x;
    const dz = z - is.z;
    const d = Math.sqrt(dx * dx + dz * dz) / is.r;
    if (d < 1.6) {
      const shape = smoothstep(1.42, 0.12, d);
      const wob = 1 + fbm2(x * 0.0011, z * 0.0011, 3, 91 + i * 17) * 0.38;
      h += is.h * shape * Math.max(0.1, wob);
    }
  }

  const landness = smoothstep(-40, 45, h);
  h += fbm2(x * 0.0011, z * 0.0011, 5, 13) * 28 * landness;

  // Mountain ridges above a certain base altitude.
  const mAmt = smoothstep(130, 720, h);
  if (mAmt > 0.002) {
    const r = ridged2(x * 0.00055, z * 0.00055, 5, 77);
    h += Math.pow(r, 2.2) * 620 * mAmt;
  }

  h += fbm2(x * 0.0062, z * 0.0062, 3, 41) * 5.2 * landness;

  // Flatten a generous plateau for the airfield.
  const ad = Math.hypot(x - AIRFIELD.x, z - AIRFIELD.z);
  if (ad < 2400) {
    const w = smoothstep(2400, 620, ad);
    h = lerp(h, AIRFIELD.y, w);
  }
  return h;
}

export function terrainNormal(x, z, eps = 8) {
  const hL = heightAt(x - eps, z);
  const hR = heightAt(x + eps, z);
  const hD = heightAt(x, z - eps);
  const hU = heightAt(x, z + eps);
  return new THREE.Vector3(hL - hR, 2 * eps, hD - hU).normalize();
}

/* ------------------------------------------------------------------ */
/*  Palette / material helpers                                        */
/* ------------------------------------------------------------------ */

const C = {
  deepSand: new THREE.Color('#b7a476'),
  sand: new THREE.Color('#e2d2a0'),
  grass: new THREE.Color('#618542'),
  grassDry: new THREE.Color('#8d9250'),
  forest: new THREE.Color('#3d6134'),
  rock: new THREE.Color('#7c7366'),
  rockDark: new THREE.Color('#5c574e'),
  snow: new THREE.Color('#f2f6fb'),
  seaFloor: new THREE.Color('#2b5a63'),
};

const tmpColor = new THREE.Color();
const tmpColor2 = new THREE.Color();

function terrainColor(h, nx, nz, x, z, out) {
  if (h < -6) {
    out.copy(C.seaFloor);
    return out;
  }
  const slope = Math.min(1, Math.hypot(nx, nz) * 1.8);
  const variation = fbm2(x * 0.004, z * 0.004, 3, 5) * 0.5 + 0.5;

  if (h < 4) {
    out.copy(C.deepSand).lerp(C.sand, smoothstep(-6, 3, h));
  } else if (h < 16) {
    out.copy(C.sand).lerp(C.grass, smoothstep(8, 20, h));
  } else {
    out.copy(C.grass).lerp(C.grassDry, smoothstep(16, 180, h) * (0.35 + variation * 0.5));
    out.lerp(C.forest, smoothstep(0.45, 0.8, variation) * 0.65 * (1 - smoothstep(130, 300, h)));
    out.lerp(C.rock, smoothstep(220, 620, h) * 0.65 + slope * 0.55);
    out.lerp(C.rockDark, smoothstep(0.35, 0.9, slope) * 0.4);
    const snowLine = 820 + variation * 160;
    const snow = smoothstep(snowLine, snowLine + 180, h) * (1 - slope * 0.65);
    out.lerp(C.snow, Math.min(1, snow));
  }
  // gentle per-vertex tint so flat areas don't look like plastic
  out.multiplyScalar(0.94 + variation * 0.12);
  return out;
}

/* ------------------------------------------------------------------ */
/*  Terrain                                                           */
/* ------------------------------------------------------------------ */

function buildTerrain(segments) {
  const size = WORLD_SIZE;
  const count = (segments + 1) * (segments + 1);
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const uvs = new Float32Array(count * 2);

  let p = 0;
  let c = 0;
  let u = 0;
  for (let iz = 0; iz <= segments; iz++) {
    const z = -size / 2 + (iz / segments) * size;
    for (let ix = 0; ix <= segments; ix++) {
      const x = -size / 2 + (ix / segments) * size;
      const h = heightAt(x, z);
      positions[p++] = x;
      positions[p++] = h;
      positions[p++] = z;

      const eps = 14;
      const nx = (heightAt(x - eps, z) - heightAt(x + eps, z)) / (2 * eps);
      const nz = (heightAt(x, z - eps) - heightAt(x, z + eps)) / (2 * eps);
      terrainColor(h, nx, nz, x, z, tmpColor);
      colors[c++] = tmpColor.r;
      colors[c++] = tmpColor.g;
      colors[c++] = tmpColor.b;

      uvs[u++] = ix / segments;
      uvs[u++] = iz / segments;
    }
  }

  const indices = [];
  for (let iz = 0; iz < segments; iz++) {
    for (let ix = 0; ix < segments; ix++) {
      const a = iz * (segments + 1) + ix;
      const b = a + 1;
      const d = a + segments + 1;
      const e = d + 1;
      indices.push(a, d, b, b, d, e);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();

  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.96,
    metalness: 0.0,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = false;
  return mesh;
}

/* ------------------------------------------------------------------ */
/*  Height texture (water shallows + minimap)                         */
/* ------------------------------------------------------------------ */

function buildHeightTexture() {
  const res = 256;
  const data = new Uint8Array(res * res * 4);
  const canvas = document.createElement('canvas');
  canvas.width = res;
  canvas.height = res;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(res, res);

  for (let iz = 0; iz < res; iz++) {
    for (let ix = 0; ix < res; ix++) {
      const x = -WORLD_SIZE / 2 + (ix / (res - 1)) * WORLD_SIZE;
      const z = -WORLD_SIZE / 2 + (iz / (res - 1)) * WORLD_SIZE;
      const h = heightAt(x, z);
      const i = (iz * res + ix) * 4;
      const enc = clamp((h + 300) / 2200, 0, 1);
      data[i] = Math.round(enc * 255);
      data[i + 1] = 0;
      data[i + 2] = 0;
      data[i + 3] = 255;

      // minimap colouring
      let r, g, b;
      if (h < 0) {
        const t = clamp(-h / 180, 0, 1);
        r = Math.round(lerp(58, 18, t));
        g = Math.round(lerp(112, 58, t));
        b = Math.round(lerp(140, 92, t));
      } else if (h < 10) {
        r = 224; g = 210; b = 160;
      } else if (h < 120) {
        const t = h / 120;
        r = Math.round(lerp(110, 92, t));
        g = Math.round(lerp(146, 122, t));
        b = Math.round(lerp(74, 76, t));
      } else if (h < 620) {
        const t = smoothstep(120, 620, h);
        r = Math.round(lerp(108, 128, t));
        g = Math.round(lerp(112, 112, t));
        b = Math.round(lerp(92, 102, t));
      } else {
        r = 232; g = 238; b = 244;
      }
      img.data[i] = r;
      img.data[i + 1] = g;
      img.data[i + 2] = b;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  const tex = new THREE.DataTexture(data, res, res, THREE.RGBAFormat);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return { tex, canvas };
}

/* ------------------------------------------------------------------ */
/*  Sky + ocean                                                       */
/* ------------------------------------------------------------------ */

function buildSky(sunDir) {
  const geo = new THREE.SphereGeometry(26000, 32, 20);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    toneMapped: false,
    uniforms: {
      uSunDir: { value: sunDir.clone() },
      uZenith: { value: new THREE.Color('#2d6fae') },
      uHorizon: { value: new THREE.Color('#d6e7ef') },
      uWarm: { value: new THREE.Color('#ffd9a8') },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uSunDir, uZenith, uHorizon, uWarm;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        float up = clamp(d.y, 0.0, 1.0);
        vec3 col = mix(uHorizon, uZenith, pow(up, 0.55));
        // warm haze near the horizon on the sun side
        float sunAmt = max(dot(d, uSunDir), 0.0);
        col = mix(col, uWarm, pow(sunAmt, 4.0) * 0.35 * (1.0 - up * 0.6));
        // sun disc + halo
        col += uWarm * pow(sunAmt, 900.0) * 2.4;
        col += uWarm * pow(sunAmt, 22.0) * 0.28;
        // below horizon fade to sea haze
        col = mix(vec3(0.55, 0.66, 0.72), col, smoothstep(-0.12, 0.02, d.y));
        // subtle dithering to avoid banding
        float dither = fract(sin(dot(d.xz * 900.0, vec2(12.9898, 78.233))) * 43758.5453) * 0.012;
        gl_FragColor = vec4(col + dither, 1.0);
      }
    `,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -100;
  return mesh;
}

function buildOcean(heightTex) {
  const geo = new THREE.PlaneGeometry(60000, 60000, 1, 1);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.ShaderMaterial({
    fog: false,
    toneMapped: true,
    uniforms: {
      uTime: { value: 0 },
      uHeight: { value: heightTex },
      uWorldSize: { value: WORLD_SIZE },
      uSunDir: { value: new THREE.Vector3(-0.42, 0.52, -0.74).normalize() },
      uSunColor: { value: new THREE.Color('#ffe3b0') },
      uDeep: { value: new THREE.Color('#0f3d63') },
      uMid: { value: new THREE.Color('#1a6382') },
      uShallow: { value: new THREE.Color('#39a6a6') },
      uSky: { value: new THREE.Color('#a8cde4') },
      uFogColor: { value: new THREE.Color('#c2d9e6') },
      uFogDensity: { value: 0.00007 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime, uWorldSize, uFogDensity;
      uniform sampler2D uHeight;
      uniform vec3 uSunDir, uSunColor, uDeep, uMid, uShallow, uSky, uFogColor;
      varying vec3 vWorld;

      void main() {
        vec2 uv = clamp(vWorld.xz / uWorldSize + 0.5, 0.001, 0.999);
        float h = mix(-300.0, 1900.0, texture2D(uHeight, uv).r);
        float depth = max(0.0, -h);

        vec3 viewDir = normalize(cameraPosition - vWorld);
        vec2 p = vWorld.xz;

        // layered directional waves
        float w1 = sin(p.x * 0.031 + uTime * 0.9) * 0.5 + 0.5;
        float w2 = sin(p.y * 0.047 - uTime * 0.7 + p.x * 0.012) * 0.5 + 0.5;
        float w3 = sin((p.x + p.y) * 0.021 + uTime * 0.4) * 0.5 + 0.5;
        vec2 grad = vec2(
          cos(p.x * 0.031 + uTime * 0.9) * 0.031 * 3.0 + cos((p.x + p.y) * 0.021 + uTime * 0.4) * 0.021 * 1.6,
          cos(p.y * 0.047 - uTime * 0.7 + p.x * 0.012) * 0.047 * 3.0 + cos((p.x + p.y) * 0.021 + uTime * 0.4) * 0.021 * 1.6
        );
        float detail = mix(1.0, 0.35, smoothstep(900.0, 9000.0, length(cameraPosition - vWorld)));
        vec3 n = normalize(vec3(grad.x * (0.8 + w1) * detail, 1.0, grad.y * (0.8 + w2) * detail));

        float shallow = smoothstep(120.0, 2.0, depth);
        vec3 col = mix(uDeep, uMid, smoothstep(420.0, 40.0, depth));
        col = mix(col, uShallow, shallow * 0.85);

        // shoreline foam
        float foamBand = smoothstep(9.0, 0.2, depth);
        float foamWave = 0.55 + 0.45 * sin(uTime * 1.6 + p.x * 0.06 + p.y * 0.045);
        col = mix(col, vec3(0.93, 0.98, 1.0), foamBand * foamWave * 0.75);

        float fres = pow(1.0 - clamp(dot(n, viewDir), 0.0, 1.0), 3.0);
        col = mix(col, uSky, fres * 0.55);

        vec3 hv = normalize(uSunDir + viewDir);
        float spec = pow(max(dot(n, hv), 0.0), 260.0);
        col += uSunColor * spec * 2.2;

        float d = length(cameraPosition - vWorld);
        float fog = 1.0 - exp(-pow(uFogDensity * d, 2.0));
        col = mix(col, uFogColor, fog);

        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = 0.0;
  mesh.renderOrder = 1;
  return mesh;
}

/* ------------------------------------------------------------------ */
/*  Clouds                                                            */
/* ------------------------------------------------------------------ */

function buildClouds() {
  const group = new THREE.Group();
  const rand = rng(4211);
  const geo = new THREE.IcosahedronGeometry(1, 1);
  const mat = new THREE.MeshStandardMaterial({
    color: '#ffffff',
    roughness: 1,
    metalness: 0,
    flatShading: true,
    fog: true,
    emissive: new THREE.Color('#9fb7cc'),
    emissiveIntensity: 0.15,
  });

  const puffs = [];
  const clusters = 170;
  for (let i = 0; i < clusters; i++) {
    const a = rand() * Math.PI * 2;
    const r = Math.pow(rand(), 0.65) * 7600;
    const cx = Math.cos(a) * r;
    const cz = Math.sin(a) * r;
    const baseY = 620 + rand() * 1500;
    const n = 4 + Math.floor(rand() * 5);
    const size = 55 + rand() * 120;
    for (let j = 0; j < n; j++) {
      puffs.push({
        x: cx + (rand() - 0.5) * size * 3.2,
        y: baseY + (rand() - 0.5) * size * 0.7,
        z: cz + (rand() - 0.5) * size * 3.2,
        sx: size * (0.7 + rand() * 0.9),
        sy: size * (0.24 + rand() * 0.2),
        sz: size * (0.7 + rand() * 0.9),
        ry: rand() * Math.PI,
      });
    }
  }

  const inst = new THREE.InstancedMesh(geo, mat, puffs.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const pos = new THREE.Vector3();
  for (let i = 0; i < puffs.length; i++) {
    const p = puffs[i];
    pos.set(p.x, p.y, p.z);
    s.set(p.sx, p.sy, p.sz);
    q.setFromEuler(new THREE.Euler(0, p.ry, 0));
    m.compose(pos, q, s);
    inst.setMatrixAt(i, m);
  }
  inst.instanceMatrix.needsUpdate = true;
  inst.frustumCulled = false;
  group.add(inst);
  return group;
}

/* ------------------------------------------------------------------ */
/*  City                                                              */
/* ------------------------------------------------------------------ */

function buildCity() {
  const group = new THREE.Group();
  const rand = rng(90210);
  const geo = new THREE.BoxGeometry(1, 1, 1);
  geo.translate(0, 0.5, 0);
  const mat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.55, metalness: 0.25 });
  const total = 190;
  const inst = new THREE.InstancedMesh(geo, mat, total);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const pos = new THREE.Vector3();
  const palette = ['#9fb0bd', '#8ba0b3', '#b9c3cb', '#7f95a8', '#a9b6bf', '#c3bfb2', '#8e9aa6'];
  let placed = 0;
  let tries = 0;
  const towers = [];
  while (placed < total && tries < 1600) {
    tries++;
    const a = rand() * Math.PI * 2;
    const r = Math.pow(rand(), 0.7) * 820;
    const x = CITY.x + Math.cos(a) * r;
    const z = CITY.z + Math.sin(a) * r;
    const h = heightAt(x, z);
    if (h < 6) continue;
    const dTown = Math.hypot(x - CITY.x, z - CITY.z) / 820;
    const height = 18 + rand() * (110 * (1 - dTown * 0.55) + 30);
    const w = 22 + rand() * 26;
    const d = 22 + rand() * 26;
    pos.set(x, h - 2, z);
    s.set(w, height, d);
    m.compose(pos, q, s);
    inst.setMatrixAt(placed, m);
    inst.setColorAt(placed, new THREE.Color(palette[Math.floor(rand() * palette.length)]));
    if (height > 105) towers.push({ x, z, h: h + height });
    placed++;
  }
  inst.count = placed;
  inst.instanceMatrix.needsUpdate = true;
  if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
  group.add(inst);

  // beacon lights on the tallest towers
  const beaconMat = new THREE.MeshBasicMaterial({ color: '#ff5a4a' });
  towers.slice(0, 8).forEach((t) => {
    const b = new THREE.Mesh(new THREE.SphereGeometry(3.2, 8, 6), beaconMat);
    b.position.set(t.x, t.h + 4, t.z);
    b.userData.beacon = 0.6 + Math.random() * 1.5;
    group.add(b);
  });

  return group;
}

/* ------------------------------------------------------------------ */
/*  Airfield                                                          */
/* ------------------------------------------------------------------ */

function buildAirfield() {
  const group = new THREE.Group();
  const y = AIRFIELD.y;
  const cx = AIRFIELD.x;
  const cz = AIRFIELD.z;

  // runway
  const runway = new THREE.Mesh(
    new THREE.BoxGeometry(48, 1.2, 1150),
    new THREE.MeshStandardMaterial({ color: '#33383d', roughness: 0.9 })
  );
  runway.position.set(cx, y + 0.8, cz);
  group.add(runway);

  // shoulders
  const shoulder = new THREE.Mesh(
    new THREE.BoxGeometry(70, 0.5, 1210),
    new THREE.MeshStandardMaterial({ color: '#5c6047', roughness: 1 })
  );
  shoulder.position.set(cx, y + 0.15, cz);
  group.add(shoulder);

  const whiteMat = new THREE.MeshStandardMaterial({
    color: '#e8ecec',
    roughness: 0.6,
    emissive: '#b8c4c4',
    emissiveIntensity: 0.12,
  });
  const dashGeo = new THREE.BoxGeometry(2.6, 0.35, 30);
  const dashes = new THREE.InstancedMesh(dashGeo, whiteMat, 16);
  const m = new THREE.Matrix4();
  for (let i = 0; i < 16; i++) {
    m.makeTranslation(cx, y + 1.55, cz - 500 + i * 66);
    dashes.setMatrixAt(i, m);
  }
  group.add(dashes);

  // threshold bars
  for (const side of [-1, 1]) {
    for (let i = -2; i <= 2; i++) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(5, 0.4, 34), whiteMat);
      bar.position.set(cx + i * 8, y + 1.55, cz + side * 535);
      group.add(bar);
    }
  }

  // edge lights
  const lightGeo = new THREE.SphereGeometry(1.25, 6, 5);
  const lightMat = new THREE.MeshBasicMaterial({ color: '#ffd894' });
  const lights = new THREE.InstancedMesh(lightGeo, lightMat, 48);
  let li = 0;
  for (let i = 0; i < 24; i++) {
    for (const side of [-1, 1]) {
      m.makeTranslation(cx + side * 30, y + 1.6, cz - 552 + i * 48);
      lights.setMatrixAt(li++, m);
    }
  }
  group.add(lights);

  // tower
  const towerMat = new THREE.MeshStandardMaterial({ color: '#c9d0d2', roughness: 0.65 });
  const glassMat = new THREE.MeshStandardMaterial({
    color: '#20303a',
    roughness: 0.08,
    metalness: 0.9,
    emissive: '#0d2833',
    emissiveIntensity: 0.4,
  });
  const towerBase = new THREE.Mesh(new THREE.CylinderGeometry(7, 9, 46, 10), towerMat);
  towerBase.position.set(cx + 125, y + 23, cz - 360);
  group.add(towerBase);
  const cab = new THREE.Mesh(new THREE.CylinderGeometry(15, 12, 12, 10), glassMat);
  cab.position.set(cx + 125, y + 50, cz - 360);
  group.add(cab);
  const roof = new THREE.Mesh(new THREE.CylinderGeometry(16, 16, 2.4, 10), towerMat);
  roof.position.set(cx + 125, y + 57, cz - 360);
  group.add(roof);
  const dish = new THREE.Mesh(new THREE.SphereGeometry(3, 8, 6), towerMat);
  dish.position.set(cx + 125, y + 60, cz - 360);
  group.add(dish);

  // hangars
  const hangarMat = new THREE.MeshStandardMaterial({ color: '#9aa3a0', roughness: 0.8 });
  for (let i = 0; i < 3; i++) {
    const h = new THREE.Mesh(new THREE.BoxGeometry(52, 19, 38), hangarMat);
    h.position.set(cx + 135 + i * 62, y + 9.5, cz + 210);
    h.rotation.y = Math.PI / 2;
    group.add(h);
    const roofH = new THREE.Mesh(new THREE.CylinderGeometry(19, 19, 52, 12, 1, false, 0, Math.PI), hangarMat);
    roofH.rotation.z = Math.PI / 2;
    roofH.position.set(cx + 135 + i * 62, y + 19, cz + 210);
    group.add(roofH);
  }

  // wind sock
  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.5, 0.5, 16, 6),
    new THREE.MeshStandardMaterial({ color: '#dddddd' })
  );
  pole.position.set(cx - 60, y + 8, cz + 200);
  group.add(pole);
  const sock = new THREE.Mesh(
    new THREE.CylinderGeometry(3.2, 1.4, 12, 8, 1, true),
    new THREE.MeshStandardMaterial({ color: '#ff7a3c', side: THREE.DoubleSide, roughness: 0.9 })
  );
  sock.rotation.z = Math.PI / 2;
  sock.position.set(cx - 48, y + 15, cz + 200);
  group.add(sock);

  // apron markings
  for (let i = 0; i < 3; i++) {
    const line = new THREE.Mesh(new THREE.BoxGeometry(22, 0.3, 1.6), whiteMat);
    line.position.set(cx + 135 + i * 62, y + 1.5, cz + 120);
    group.add(line);
  }

  return group;
}

/* ------------------------------------------------------------------ */
/*  Gate course                                                       */
/* ------------------------------------------------------------------ */

const ROUTE = [
  [400, 2100, 470],
  [2350, 800, 540],
  [3200, -900, 650],
  [2350, -2500, 900],
  [400, -3100, 1200],
  [-1700, -2400, 1450],
  [-3000, -1100, 1750],
  [-3800, 700, 950],
  [-2500, 2400, 620],
  [-700, 3200, 430],
  [300, 3100, 380],
];

function makeLabelSprite(text, color = '#8ff4ff') {
  const size = 128;
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, size, size);
  ctx.font = '700 74px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = 22;
  ctx.fillText(text, size / 2, size / 2);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({
    map: tex,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(60, 60, 1);
  return sprite;
}

function buildGates() {
  const group = new THREE.Group();
  const gates = [];
  const ringGeo = new THREE.TorusGeometry(38, 2.4, 8, 48);
  const glowGeo = new THREE.TorusGeometry(38, 7, 8, 48);

  for (let i = 0; i < ROUTE.length; i++) {
    const [x, z, planned] = ROUTE[i];
    const ground = Math.max(0, heightAt(x, z));
    const y = Math.max(planned, ground + 170, 110);
    const next = ROUTE[(i + 1) % ROUTE.length];
    const prev = ROUTE[(i - 1 + ROUTE.length) % ROUTE.length];
    const tangent = new THREE.Vector3(next[0] - prev[0], 0, next[1] - prev[1]).normalize();
    // tilt the ring slightly along the route's altitude change
    tangent.y = clamp((next[2] - prev[2]) / 2400, -0.35, 0.35);
    tangent.normalize();

    const mat = new THREE.MeshStandardMaterial({
      color: '#3fd8e8',
      emissive: '#1a9fb5',
      emissiveIntensity: 0.9,
      roughness: 0.4,
      metalness: 0.5,
    });
    const ring = new THREE.Mesh(ringGeo, mat);
    const glowMat = new THREE.MeshBasicMaterial({
      color: '#43e6ff',
      transparent: true,
      opacity: 0.1,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const glow = new THREE.Mesh(glowGeo, glowMat);

    const holder = new THREE.Group();
    holder.position.set(x, y, z);
    holder.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), tangent);
    holder.add(ring);
    holder.add(glow);

    const label = makeLabelSprite(String(i + 1));
    label.position.set(0, 58, 0);
    holder.add(label);

    group.add(holder);
    gates.push({
      index: i,
      position: new THREE.Vector3(x, y, z),
      normal: tangent.clone(),
      holder,
      ring,
      glow,
      color: '#3fd8e8',
      passed: false,
    });
  }
  return { group, gates };
}

/* ------------------------------------------------------------------ */
/*  Boats + balloons (a bit of life)                                  */
/* ------------------------------------------------------------------ */

function buildBoats() {
  const group = new THREE.Group();
  const rand = rng(5150);
  const hullMat = new THREE.MeshStandardMaterial({ color: '#f2f3ee', roughness: 0.7 });
  const trimMat = new THREE.MeshStandardMaterial({ color: '#2c4a63', roughness: 0.6 });
  const sailMat = new THREE.MeshStandardMaterial({
    color: '#fff6e8',
    side: THREE.DoubleSide,
    roughness: 0.9,
  });

  for (let i = 0; i < 10; i++) {
    const a = rand() * Math.PI * 2;
    const dist = 3000 + rand() * 700;
    const x = 1250 + Math.cos(a) * dist;
    const z = 3000 + Math.sin(a) * dist;
    if (heightAt(x, z) > -8) continue;
    const boat = new THREE.Group();
    const hull = new THREE.Mesh(new THREE.BoxGeometry(5, 2.6, 16), hullMat);
    hull.position.y = 0.8;
    boat.add(hull);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(5.2, 0.7, 16.2), trimMat);
    stripe.position.y = 1.9;
    boat.add(stripe);
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 18, 6), trimMat);
    mast.position.y = 11;
    boat.add(mast);
    const sail = new THREE.Mesh(new THREE.ConeGeometry(7, 14, 3, 1, true), sailMat);
    sail.position.set(0, 10, 0);
    sail.scale.z = 0.12;
    boat.add(sail);
    boat.position.set(x, 0, z);
    boat.rotation.y = rand() * Math.PI * 2;
    group.add(boat);
  }
  return group;
}

function buildBalloons() {
  const group = new THREE.Group();
  const colors = ['#ff8c5a', '#ffd166', '#7fd8c8', '#e26d8a', '#9bb7ff'];
  const positions = [
    [-900, 700, 2400],
    [2000, 820, -400],
    [-2100, 980, -900],
    [3300, 650, 2400],
    [-3200, 760, 2200],
  ];
  positions.forEach(([x, yBase, z], i) => {
    const b = new THREE.Group();
    const env = new THREE.Mesh(
      new THREE.SphereGeometry(13, 16, 12),
      new THREE.MeshStandardMaterial({ color: colors[i % colors.length], roughness: 0.6 })
    );
    env.scale.set(1, 1.25, 1);
    b.add(env);
    const basket = new THREE.Mesh(
      new THREE.BoxGeometry(5, 4, 5),
      new THREE.MeshStandardMaterial({ color: '#8a6742', roughness: 0.9 })
    );
    basket.position.y = -21;
    b.add(basket);
    b.position.set(x, yBase + 60, z);
    b.userData.float = Math.random() * Math.PI * 2;
    group.add(b);
  });
  return group;
}

/* ------------------------------------------------------------------ */
/*  World factory                                                     */
/* ------------------------------------------------------------------ */

export function createWorld(scene, quality = 'high') {
  const sunDir = new THREE.Vector3(-0.42, 0.52, -0.74).normalize();
  const segments = quality === 'high' ? 300 : quality === 'medium' ? 240 : 180;

  const { tex: heightTex, canvas: mapCanvas } = buildHeightTexture();

  const terrain = buildTerrain(segments);
  scene.add(terrain);

  const sky = buildSky(sunDir);
  scene.add(sky);

  const ocean = buildOcean(heightTex);
  scene.add(ocean);

  const clouds = buildClouds();
  scene.add(clouds);

  const city = buildCity();
  scene.add(city);

  const airfield = buildAirfield();
  scene.add(airfield);

  const gateData = buildGates();
  scene.add(gateData.group);

  const boats = buildBoats();
  scene.add(boats);

  const balloons = buildBalloons();
  scene.add(balloons);

  const hemi = new THREE.HemisphereLight('#cfe6ff', '#55604a', 0.85);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight('#fff2d6', 2.1);
  sun.position.copy(sunDir).multiplyScalar(4000);
  scene.add(sun);

  const fill = new THREE.DirectionalLight('#9ec9ff', 0.35);
  fill.position.set(2000, 900, 3000);
  scene.add(fill);

  scene.fog = new THREE.FogExp2('#c2d9e6', 0.00007);

  const world = {
    sunDir,
    heightAt,
    terrain,
    ocean,
    clouds,
    city,
    airfield,
    gates: gateData.gates,
    gateGroup: gateData.group,
    mapCanvas,
    heightTex,
    time: 0,
    nextGate: 0,
    setNextGate(i) {
      this.nextGate = i;
      gateData.gates.forEach((g, idx) => {
        const active = idx === i;
        g.ring.material.color.set(active ? '#ffcf6b' : '#3fd8e8');
        g.ring.material.emissive.set(active ? '#ff9f2e' : '#1a9fb5');
        g.ring.material.emissiveIntensity = active ? 1.6 : 0.55;
        g.glow.material.color.set(active ? '#ffc85e' : '#43e6ff');
        g.glow.material.opacity = active ? 0.18 : 0.07;
        g.holder.children.forEach((c) => {
          if (c.isSprite) c.material.opacity = active ? 1 : 0.45;
        });
      });
    },
    update(dt, time, camera) {
      this.time = time;
      ocean.material.uniforms.uTime.value = time;
      sky.position.copy(camera.position);

      // gentle gate breathing
      for (let i = 0; i < gateData.gates.length; i++) {
        const g = gateData.gates[i];
        const active = i === this.nextGate;
        const s = active ? 1 + Math.sin(time * 2.4) * 0.035 : 1;
        g.holder.scale.setScalar(s);
        if (active) g.glow.material.opacity = 0.14 + Math.sin(time * 2.4) * 0.05;
      }

      // blink tower beacons
      city.children.forEach((c) => {
        if (c.userData.beacon) {
          c.visible = Math.sin(time * c.userData.beacon * 2) > 0.2;
        }
      });

      // balloons bob
      balloons.children.forEach((b) => {
        b.position.y += Math.sin(time * 0.35 + b.userData.float) * 0.006;
        b.rotation.y += dt * 0.03;
      });
    },
  };

  world.setNextGate(0);
  return world;
}
