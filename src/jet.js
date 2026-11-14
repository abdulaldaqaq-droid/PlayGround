import * as THREE from 'three';
import { clamp } from './noise.js';

const V = new THREE.Vector3();
const Q1 = new THREE.Quaternion();
const Q2 = new THREE.Quaternion();
const E1 = new THREE.Euler();

/* ------------------------------------------------------------------ */
/*  Jet model                                                         */
/* ------------------------------------------------------------------ */

function buildJetModel() {
  const group = new THREE.Group();

  const bodyMat = new THREE.MeshStandardMaterial({
    color: '#4a5564',
    metalness: 0.7,
    roughness: 0.36,
  });
  const darkMat = new THREE.MeshStandardMaterial({
    color: '#232a34',
    metalness: 0.55,
    roughness: 0.55,
  });
  const accentMat = new THREE.MeshStandardMaterial({
    color: '#ff8a3d',
    metalness: 0.4,
    roughness: 0.45,
    emissive: '#5a2400',
    emissiveIntensity: 0.35,
  });
  const glassMat = new THREE.MeshStandardMaterial({
    color: '#0f1c26',
    metalness: 1.0,
    roughness: 0.08,
    emissive: '#123243',
    emissiveIntensity: 0.5,
  });

  // fuselage (lathe, then rotate so the nose points down -Z)
  const profile = [
    [0.04, -7.6],
    [0.3, -7.0],
    [0.58, -6.1],
    [0.86, -4.9],
    [1.12, -3.2],
    [1.24, -1.4],
    [1.22, 0.6],
    [1.1, 2.4],
    [0.98, 4.0],
    [0.9, 5.4],
    [0.74, 6.2],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const bodyGeo = new THREE.LatheGeometry(profile, 20);
  bodyGeo.rotateX(Math.PI / 2);
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  group.add(body);

  // canopy
  const canopy = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), glassMat);
  canopy.scale.set(0.72, 0.62, 1.85);
  canopy.position.set(0, 0.66, -2.15);
  group.add(canopy);

  // wing shape (x = span, y = fore/aft)
  function makeWingGeo() {
    const shape = new THREE.Shape();
    shape.moveTo(0.7, -2.5);
    shape.lineTo(6.3, 1.4);
    shape.lineTo(5.6, 2.7);
    shape.lineTo(0.7, 2.5);
    shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: 0.22,
      bevelEnabled: true,
      bevelSize: 0.06,
      bevelThickness: 0.05,
      bevelSegments: 1,
    });
    geo.rotateX(Math.PI / 2);
    return geo;
  }
  const wingGeo = makeWingGeo();
  const wingR = new THREE.Mesh(wingGeo, bodyMat);
  wingR.position.set(0.5, -0.08, 0.2);
  group.add(wingR);
  const wingL = new THREE.Mesh(wingGeo, bodyMat);
  wingL.position.set(-0.5, -0.08, 0.2);
  wingL.scale.x = -1;
  group.add(wingL);

  // orange wing stripes
  const stripeGeo = new THREE.BoxGeometry(3.6, 0.06, 0.5);
  for (const side of [-1, 1]) {
    const stripe = new THREE.Mesh(stripeGeo, accentMat);
    stripe.position.set(side * 3.0, 0.09, 1.55);
    stripe.rotation.y = side * -0.3;
    group.add(stripe);
  }

  // tail planes
  const tailGeo = makeWingGeo();
  tailGeo.scale(0.42, 1, 0.42);
  const tailR = new THREE.Mesh(tailGeo, bodyMat);
  tailR.position.set(0.45, 0.0, 3.35);
  group.add(tailR);
  const tailL = new THREE.Mesh(tailGeo, bodyMat);
  tailL.position.set(-0.45, 0.0, 3.35);
  tailL.scale.x = -1;
  group.add(tailL);

  // twin vertical fins
  const finShape = new THREE.Shape();
  finShape.moveTo(0, 0);
  finShape.lineTo(2.0, 3.4);
  finShape.lineTo(3.2, 3.4);
  finShape.lineTo(3.4, 0.1);
  finShape.closePath();
  const finGeo = new THREE.ExtrudeGeometry(finShape, {
    depth: 0.14,
    bevelEnabled: true,
    bevelSize: 0.04,
    bevelThickness: 0.03,
    bevelSegments: 1,
  });
  finGeo.rotateY(Math.PI / 2);
  for (const side of [-1, 1]) {
    const fin = new THREE.Mesh(finGeo, bodyMat);
    fin.position.set(side * 0.72, 0.4, 2.2);
    fin.rotation.z = side * -0.24;
    group.add(fin);
    const tip = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.4, 1.4), accentMat);
    tip.position.set(side * 1.45, 3.65, 3.5);
    tip.rotation.z = side * -0.24;
    group.add(tip);
  }

  // intakes
  for (const side of [-1, 1]) {
    const intake = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.7, 2.3), darkMat);
    intake.position.set(side * 1.18, -0.28, -0.4);
    group.add(intake);
  }

  // engines
  const nozzleMat = new THREE.MeshStandardMaterial({
    color: '#2a2f38',
    metalness: 0.9,
    roughness: 0.35,
    emissive: '#ff6a1a',
    emissiveIntensity: 0.35,
  });
  const flames = [];
  const glows = [];
  for (const side of [-1, 1]) {
    const eng = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.62, 2.2, 12), darkMat);
    eng.rotation.x = Math.PI / 2;
    eng.position.set(side * 0.9, 0.05, 4.6);
    group.add(eng);

    const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.55, 0.55, 12, 1, true), nozzleMat);
    nozzle.rotation.x = Math.PI / 2;
    nozzle.position.set(side * 0.9, 0.05, 5.65);
    group.add(nozzle);

    const flame = new THREE.Mesh(
      new THREE.ConeGeometry(0.5, 3.4, 12, 1, true),
      new THREE.MeshBasicMaterial({
        color: '#ffb066',
        transparent: true,
        opacity: 0.85,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    flame.rotation.x = Math.PI / 2;
    flame.position.set(side * 0.9, 0.05, 7.2);
    group.add(flame);
    flames.push(flame);

    const glow = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: makeGlowTexture('#ffb775'),
        color: '#ffc78a',
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        opacity: 0.9,
      })
    );
    glow.scale.set(3.2, 3.2, 1);
    glow.position.set(side * 0.9, 0.05, 5.8);
    group.add(glow);
    glows.push(glow);
  }

  // nav lights
  const navR = new THREE.Mesh(
    new THREE.SphereGeometry(0.2, 8, 6),
    new THREE.MeshBasicMaterial({ color: '#ff3b30' })
  );
  navR.position.set(-6.1, 0.12, 1.5);
  group.add(navR);
  const navG = new THREE.Mesh(
    new THREE.SphereGeometry(0.2, 8, 6),
    new THREE.MeshBasicMaterial({ color: '#34ff7a' })
  );
  navG.position.set(6.1, 0.12, 1.5);
  group.add(navG);
  const navW = new THREE.Mesh(
    new THREE.SphereGeometry(0.16, 8, 6),
    new THREE.MeshBasicMaterial({ color: '#ffffff' })
  );
  navW.position.set(0, 0.1, 5.7);
  group.add(navW);

  // underside accent
  const belly = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.18, 5.2), accentMat);
  belly.position.set(0, -0.62, 1.2);
  group.add(belly);

  group.userData = { flames, glows, navR, navG, navW, canopy };
  return group;
}

function makeGlowTexture(color = '#ffffff') {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, color);
  g.addColorStop(0.35, 'rgba(255,190,120,0.65)');
  g.addColorStop(1, 'rgba(255,120,30,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/* ------------------------------------------------------------------ */
/*  Contrail ribbon                                                   */
/* ------------------------------------------------------------------ */

const TRAIL_MAX = 95;

class Trail {
  constructor(scene, opacity = 0.42) {
    this.scene = scene;
    this.max = TRAIL_MAX;
    this.points = [];
    const geo = new THREE.BufferGeometry();
    this.positions = new Float32Array(this.max * 2 * 3);
    this.alphas = new Float32Array(this.max * 2);
    const indices = [];
    for (let i = 0; i < this.max - 1; i++) {
      const a = i * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alphas, 1));
    geo.setIndex(indices);
    geo.setDrawRange(0, 0);
    this.geo = geo;
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      uniforms: { uColor: { value: new THREE.Color('#eaf6ff') }, uOpacity: { value: opacity } },
      vertexShader: /* glsl */ `
        attribute float aAlpha;
        varying float vA;
        void main() {
          vA = aAlpha;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        uniform float uOpacity;
        varying float vA;
        void main() {
          gl_FragColor = vec4(uColor, vA * uOpacity);
        }
      `,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }

  reset() {
    this.points.length = 0;
    this.geo.setDrawRange(0, 0);
  }

  push(pos, side) {
    const pts = this.points;
    if (pts.length === 0 || pts[pts.length - 1].pos.distanceToSquared(pos) > 6) {
      pts.push({ pos: pos.clone(), side: side.clone() });
      if (pts.length > this.max) pts.shift();
    }
  }

  update() {
    const n = this.points.length;
    if (n < 2) {
      this.geo.setDrawRange(0, 0);
      return;
    }
    const pos = this.positions;
    const alpha = this.alphas;
    for (let i = 0; i < n; i++) {
      const p = this.points[i];
      const t = i / (n - 1); // 0 = oldest
      const width = 0.25 + (1 - t) * 1.9;
      const ax = p.side.x * width * 0.5;
      const ay = p.side.y * width * 0.5;
      const az = p.side.z * width * 0.5;
      const o = i * 6;
      pos[o] = p.pos.x + ax;
      pos[o + 1] = p.pos.y + ay;
      pos[o + 2] = p.pos.z + az;
      pos[o + 3] = p.pos.x - ax;
      pos[o + 4] = p.pos.y - ay;
      pos[o + 5] = p.pos.z - az;
      const a = Math.pow(t, 1.4) * 0.85;
      alpha[i * 2] = a;
      alpha[i * 2 + 1] = a;
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aAlpha.needsUpdate = true;
    this.geo.setDrawRange(0, Math.max(0, (n - 1) * 6));
  }
}

/* ------------------------------------------------------------------ */
/*  Effects                                                           */
/* ------------------------------------------------------------------ */

const effects = [];

export function spawnExplosion(scene, position) {
  const count = 110;
  const positions = new Float32Array(count * 3);
  const velocities = [];
  const rand = () => Math.random() * 2 - 1;
  for (let i = 0; i < count; i++) {
    positions[i * 3] = 0;
    positions[i * 3 + 1] = 0;
    positions[i * 3 + 2] = 0;
    const v = new THREE.Vector3(rand(), rand(), rand()).normalize().multiplyScalar(8 + Math.random() * 34);
    velocities.push(v);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.PointsMaterial({
    color: '#ffb066',
    size: 8,
    transparent: true,
    opacity: 1,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const points = new THREE.Points(geo, mat);
  points.position.copy(position);
  points.frustumCulled = false;
  scene.add(points);

  const flash = new THREE.PointLight('#ff9a4d', 600, 1200, 2);
  flash.position.copy(position);
  scene.add(flash);

  effects.push({ points, velocities, geo, mat, flash, life: 0, maxLife: 2.2 });
}

export function updateEffects(dt) {
  for (let i = effects.length - 1; i >= 0; i--) {
    const e = effects[i];
    e.life += dt;
    const arr = e.geo.attributes.position.array;
    for (let j = 0; j < e.velocities.length; j++) {
      const v = e.velocities[j];
      arr[j * 3] += v.x * dt;
      arr[j * 3 + 1] += v.y * dt;
      arr[j * 3 + 2] += v.z * dt;
      v.multiplyScalar(1 - dt * 0.9);
      v.y -= 22 * dt;
    }
    e.geo.attributes.position.needsUpdate = true;
    const t = e.life / e.maxLife;
    e.mat.opacity = Math.max(0, 1 - t);
    e.mat.size = 8 + t * 16;
    if (e.flash) {
      e.flash.intensity = Math.max(0, 600 * (1 - t * 2.2));
      if (t > 0.45) {
        e.flash.removeFromParent();
        e.flash = null;
      }
    }
    if (t >= 1) {
      e.points.removeFromParent();
      e.geo.dispose();
      e.mat.dispose();
      effects.splice(i, 1);
    }
  }
}

/* ------------------------------------------------------------------ */
/*  Jet                                                               */
/* ------------------------------------------------------------------ */

export class Jet {
  constructor(scene) {
    this.scene = scene;
    this.model = buildJetModel();
    scene.add(this.model);

    this.position = new THREE.Vector3();
    this.quaternion = new THREE.Quaternion();

    this.speed = 145;
    this.throttle = 0.65;
    this.boost = false;
    this.boostAmount = 0; // smoothed 0..1
    this.angVel = new THREE.Vector3(); // pitch, yaw, roll rates (rad/s)
    this.crashed = false;
    this.crashTimer = 0;
    this.navTimer = 0;
    this.stall = 0;
    this.gLoad = 1;
    this.distanceFlown = 0;
    this.shake = 0;

    this.trailR = new Trail(scene, 0.42);
    this.trailL = new Trail(scene, 0.42);

    this.forward = new THREE.Vector3(0, 0, -1);
    this.up = new THREE.Vector3(0, 1, 0);
    this.right = new THREE.Vector3(1, 0, 0);

    this.reset(1200, 700, 3500, 0);
  }

  reset(x, y, z, heading) {
    this.position.set(x, y, z);
    this.quaternion.setFromEuler(new THREE.Euler(0, -heading, 0, 'YXZ'));
    this.speed = 150;
    this.throttle = 0.7;
    this.boost = false;
    this.boostAmount = 0;
    this.angVel.set(0, 0, 0);
    this.crashed = false;
    this.crashTimer = 0;
    this.stall = 0;
    this.gLoad = 1;
    this.distanceFlown = 0;
    this.shake = 0;
    this.model.visible = true;
    this.trailR.reset();
    this.trailL.reset();
    this.syncModel();
  }

  syncModel() {
    this.model.position.copy(this.position);
    this.model.quaternion.copy(this.quaternion);
  }

  get altitude() {
    return this.position.y;
  }

  headingDeg() {
    const f = this.forward;
    return ((Math.atan2(f.x, -f.z) * 180) / Math.PI + 360) % 360;
  }

  pitchDeg() {
    return Math.asin(clamp(this.forward.y, -1, 1)) * (180 / Math.PI);
  }

  bankDeg() {
    return Math.atan2(-this.right.y, this.up.y) * (180 / Math.PI);
  }

  update(dt, input, world, crashed = false) {
    if (crashed) {
      this.syncModel();
      if (this.model.visible) this.model.visible = false;
      return;
    }

    this.forward.set(0, 0, -1).applyQuaternion(this.quaternion);
    this.up.set(0, 1, 0).applyQuaternion(this.quaternion);
    this.right.set(1, 0, 0).applyQuaternion(this.quaternion);

    const speedNorm = clamp(this.speed / 210, 0, 1.4);
    const authority = clamp((this.speed - 26) / 90, 0.18, 1.0);

    // Stall: below ~52 m/s the nose gets mushy and drops.
    this.stall = clamp((55 - this.speed) / 22, 0, 1);

    // Smooth the control response so the jet has some mass.
    const targetPitch = input.pitch * 1.05 * authority;
    const targetRoll = -input.roll * 2.35 * (0.65 + authority * 0.35);
    const targetYaw = -input.yaw * 0.55 * authority;
    const smooth = 1 - Math.exp(-dt * (input.pitch !== 0 || input.roll !== 0 ? 7.5 : 4.2));
    this.angVel.x += (targetPitch - this.angVel.x) * smooth;
    this.angVel.y += (targetYaw - this.angVel.y) * smooth;
    this.angVel.z += (targetRoll - this.angVel.z) * smooth;

    // Coordinated turn from bank angle (what makes banking feel right).
    const bank = Math.atan2(-this.right.y, this.up.y);
    const bankTurn = (-(9.81 * Math.tan(clamp(bank, -1.25, 1.25))) / Math.max(this.speed, 70)) * 1.9;
    const yawTotal = this.angVel.y + bankTurn;

    Q1.setFromEuler(E1.set(this.angVel.x * dt, yawTotal * dt, this.angVel.z * dt, 'XYZ'));
    this.quaternion.multiply(Q1);

    // Stall nose drop
    if (this.stall > 0) {
      Q2.setFromAxisAngle(V.set(1, 0, 0), -this.stall * 0.5 * dt);
      this.quaternion.multiply(Q2);
      this.shake = Math.max(this.shake, this.stall * 0.5);
    }

    this.quaternion.normalize();

    // speed model
    const boostTarget = input.boost ? 1 : 0;
    this.boostAmount += (boostTarget - this.boostAmount) * (1 - Math.exp(-dt * 4));
    this.throttle += (input.throttle - this.throttle) * (1 - Math.exp(-dt * 5));
    this.throttle = clamp(this.throttle, 0, 1);

    const thrust = 6 + this.throttle * 34 + this.boostAmount * 32;
    const drag = 0.0016 * this.speed * this.speed;
    const gravityAlong = -9.81 * this.forward.y * 0.85;
    this.speed = clamp(this.speed + (thrust - drag + gravityAlong) * dt, 18, 330);

    // Recompute after rotation for movement direction
    this.forward.set(0, 0, -1).applyQuaternion(this.quaternion);
    this.up.set(0, 1, 0).applyQuaternion(this.quaternion);
    this.right.set(1, 0, 0).applyQuaternion(this.quaternion);

    const step = this.speed * dt;
    this.position.addScaledVector(this.forward, step);
    this.distanceFlown += step;

    // g-load estimate for the HUD
    const turnRate = Math.abs(yawTotal) + Math.abs(this.angVel.x);
    const targetG = 1 + (turnRate * this.speed) / 9.81;
    this.gLoad += (targetG - this.gLoad) * (1 - Math.exp(-dt * 6));

    // engine visuals
    const ud = this.model.userData;
    const flick = 0.86 + Math.sin(performance.now() * 0.05) * 0.08 + Math.random() * 0.06;
    const thr = this.throttle * (0.55 + this.boostAmount * 0.9);
    ud.flames.forEach((f) => {
      f.visible = this.throttle > 0.05;
      const len = (0.5 + thr * 1.1) * flick;
      f.scale.set(0.8 + this.boostAmount * 0.35, len, 0.8 + this.boostAmount * 0.35);
      f.material.opacity = 0.28 + thr * 0.6;
    });
    ud.glows.forEach((g) => {
      const s = 1.6 + thr * 3.4 + this.boostAmount * 2.2;
      g.scale.set(s, s, 1);
      g.material.opacity = 0.35 + thr * 0.6;
    });

    // nav light blink
    this.navTimer += dt;
    const blink = Math.sin(this.navTimer * 4.5) > 0.55;
    ud.navW.visible = blink;
    ud.navR.visible = true;
    ud.navG.visible = true;

    // trails from the nozzles
    const nozzles = [
      [this.trailL, -0.9],
      [this.trailR, 0.9],
    ];
    for (const [trail, ox] of nozzles) {
      V.set(ox, 0.05, 5.8).applyQuaternion(this.quaternion).add(this.position);
      const side = this.up.clone().multiplyScalar(0.5).addScaledVector(this.right, 0.5);
      trail.push(V, side);
      trail.update();
    }

    this.syncModel();

    // crash: terrain or water
    const ground = Math.max(0, world.heightAt(this.position.x, this.position.z));
    if (this.position.y < ground + 7) {
      return { crash: true, ground };
    }
    // soft world edge
    const R = 7700;
    if (Math.abs(this.position.x) > R || Math.abs(this.position.z) > R) {
      return { edge: true };
    }
    return null;
  }

  setCameraVisible(visible) {
    this.model.visible = visible;
  }
}
