import * as THREE from 'three';
import { Jet, spawnExplosion, updateEffects } from './jet.js';
import { AIRFIELD, createWorld } from './world.js';

const $ = (id) => document.getElementById(id);
const ui = {
  viewport: $('viewport'), welcome: $('welcome'), loading: $('loading'), hud: $('hud'),
  pause: $('pause-panel'), crash: $('crash-panel'), help: $('help-panel'),
  start: $('start-button'), resume: $('resume-button'), restart: $('restart-button'),
  restartCrash: $('restart-crash'), pauseButton: $('pause-button'), sound: $('sound-button'),
  helpButton: $('help-button'), closeHelp: $('close-help'), touch: $('touch-controls'),
  touchStick: $('touch-stick'), stickKnob: $('stick-knob'), touchBoost: $('touch-boost'),
  altitude: $('altitude'), speed: $('speed'), heading: $('heading'), status: $('flight-status'),
  altitudeFill: $('altitude-fill'), speedFill: $('speed-fill'), routeName: $('route-name'),
  gateCount: $('gate-count'), routeDistance: $('route-distance'), routeFill: $('route-fill'),
  distance: $('distance'), toast: $('toast'), crashCopy: $('crash-copy'), map: $('minimap'),
};

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.65));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;
ui.viewport.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color('#a9c8d8');
const camera = new THREE.PerspectiveCamera(67, window.innerWidth / window.innerHeight, 0.1, 36000);
const clock = new THREE.Clock();
let world = null;
let jet = null;
let started = false;
let paused = false;
let crashed = false;
let cameraMode = 0;
let elapsed = 0;
let lastToast = 0;
let gateNumber = 0;
let previousPosition = new THREE.Vector3();
const cameraTarget = new THREE.Vector3();
const desiredCamera = new THREE.Vector3();
const lookTarget = new THREE.Vector3();
const upTarget = new THREE.Vector3();
const mapCtx = ui.map.getContext('2d');
const keys = new Set();
const touchInput = { pitch: 0, roll: 0, boost: false };
const input = { pitch: 0, roll: 0, yaw: 0, boost: false, throttle: 0.7 };
const gateNames = ['THE FIRST LIGHT', 'OVER THE BLUE', 'ISLAND HOP', 'SOUTHERN PASS', 'CLOUDLINE', 'HIGH COUNTRY', 'THE RIDGE', 'WESTWARD', 'GOLDEN COAST', 'HOME STRETCH', 'FULL CIRCLE'];
let audioContext = null;
let engineOscillators = [];
let audioGain = null;

function showToast(message, duration = 2600) {
  ui.toast.textContent = message;
  ui.toast.classList.add('visible');
  lastToast = elapsed + duration / 1000;
}

function setVisible(element, visible) {
  element.classList.toggle('hidden', !visible);
}

function setPaused(value) {
  if (!started || crashed) return;
  paused = value;
  setVisible(ui.pause, paused);
  if (paused) keys.clear();
}

function resetFlight() {
  if (!world || !jet) return;
  jet.reset(AIRFIELD.x, 700, AIRFIELD.z - 700, 0);
  crashed = false;
  paused = false;
  gateNumber = 0;
  world.gates.forEach((gate) => { gate.passed = false; });
  world.setNextGate(0);
  setVisible(ui.crash, false);
  setVisible(ui.pause, false);
  ui.crashCopy.textContent = 'Every landing is a chance to take off again.';
  previousPosition.copy(jet.position);
  camera.position.copy(jet.position).add(new THREE.Vector3(0, 24, 76));
  showToast('FLIGHT RESET · FIND THE GOLDEN GATE', 3000);
}

function beginFlight() {
  if (started) {
    if (crashed) resetFlight();
    paused = false;
    setVisible(ui.pause, false);
    setVisible(ui.crash, false);
    return;
  }
  started = true;
  setVisible(ui.welcome, false);
  setVisible(ui.loading, true);
  // Let the loading state paint before the procedural world is generated.
  requestAnimationFrame(() => setTimeout(() => {
    try {
      world = createWorld(scene, window.innerWidth < 760 ? 'low' : 'medium');
      jet = new Jet(scene);
      resetFlight();
      previousPosition.copy(jet.position);
      setVisible(ui.loading, false);
      setVisible(ui.hud, true);
      setVisible(ui.helpButton, true);
      setVisible(ui.touch, window.matchMedia('(pointer: coarse)').matches);
      showToast('WELCOME TO OPEN SKIES · FLY THROUGH THE GOLD GATES', 4400);
      clock.start();
    } catch (error) {
      console.error('Unable to build the flight world:', error);
      ui.loading.textContent = 'THE SKY ISN’T READY — PLEASE RELOAD';
    }
  }, 30));
}

function updateInput() {
  input.pitch = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0)
    - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0) + touchInput.pitch;
  input.roll = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0)
    - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0) + touchInput.roll;
  input.yaw = (keys.has('KeyE') ? 1 : 0) - (keys.has('KeyQ') ? 1 : 0);
  input.boost = keys.has('ShiftLeft') || keys.has('ShiftRight') || touchInput.boost;
  input.throttle = 0.72;
}

function updateGates() {
  if (!world || !jet) return;
  const gate = world.gates[gateNumber];
  if (!gate) return;
  const before = previousPosition.clone().sub(gate.position).dot(gate.normal);
  const after = jet.position.clone().sub(gate.position).dot(gate.normal);
  const distance = jet.position.distanceTo(gate.position);
  const crossing = before <= 0 && after > 0 && distance < 170;
  const nearCenter = distance < 38;
  if ((crossing && distance < 66) || nearCenter) {
    gate.passed = true;
    gateNumber = (gateNumber + 1) % world.gates.length;
    world.setNextGate(gateNumber);
    showToast(gateNumber === 0 ? 'SCENIC ROUTE COMPLETE · NICE FLYING!' : `WAYPOINT ${String(gateNumber).padStart(2, '0')} CLEARED`, 2200);
  }
}

function drawMap() {
  const size = ui.map.width;
  mapCtx.clearRect(0, 0, size, size);
  mapCtx.drawImage(world.mapCanvas, 0, 0, size, size);
  const toMap = (x, z) => ({ x: (x / 16000 + 0.5) * size, y: (z / 16000 + 0.5) * size });
  // Course line and waypoint dots
  mapCtx.beginPath();
  world.gates.forEach((gate, index) => {
    const p = toMap(gate.position.x, gate.position.z);
    if (!index) mapCtx.moveTo(p.x, p.y); else mapCtx.lineTo(p.x, p.y);
  });
  mapCtx.closePath();
  mapCtx.strokeStyle = 'rgba(255,214,137,.55)';
  mapCtx.lineWidth = 1.5;
  mapCtx.stroke();
  world.gates.forEach((gate, index) => {
    const p = toMap(gate.position.x, gate.position.z);
    mapCtx.beginPath();
    mapCtx.arc(p.x, p.y, index === gateNumber ? 4 : 2, 0, Math.PI * 2);
    mapCtx.fillStyle = index === gateNumber ? '#ffd06b' : 'rgba(226,245,236,.82)';
    mapCtx.fill();
  });
  const p = toMap(jet.position.x, jet.position.z);
  mapCtx.save();
  mapCtx.translate(p.x, p.y);
  mapCtx.rotate(jet.headingDeg() * Math.PI / 180);
  mapCtx.beginPath();
  mapCtx.moveTo(0, -7);
  mapCtx.lineTo(4.5, 5);
  mapCtx.lineTo(0, 3);
  mapCtx.lineTo(-4.5, 5);
  mapCtx.closePath();
  mapCtx.fillStyle = '#fff';
  mapCtx.shadowColor = '#7ce9e3';
  mapCtx.shadowBlur = 7;
  mapCtx.fill();
  mapCtx.restore();
}

function updateHud() {
  const altitude = Math.max(0, jet.position.y);
  const speedKts = jet.speed * 1.94384;
  const heading = Math.round(jet.headingDeg());
  ui.altitude.textContent = String(Math.round(altitude * 3.28084)).padStart(4, '0');
  ui.speed.textContent = String(Math.round(speedKts)).padStart(3, '0');
  ui.heading.textContent = `${String(heading).padStart(3, '0')}°`;
  ui.altitudeFill.style.width = `${Math.min(100, altitude / 28)}%`;
  ui.speedFill.style.width = `${Math.min(100, speedKts / 5.2)}%`;
  ui.distance.textContent = `${(jet.distanceFlown / 1000).toFixed(1)} KM FLOWN`;
  const gate = world.gates[gateNumber];
  const distance = jet.position.distanceTo(gate.position);
  ui.gateCount.textContent = `${String(gateNumber + 1).padStart(2, '0')} / ${world.gates.length}`;
  ui.routeName.textContent = gateNames[gateNumber] || `WAYPOINT ${gateNumber + 1}`;
  ui.routeDistance.textContent = `${(distance / 1000).toFixed(1)} KM`;
  const previous = world.gates[(gateNumber - 1 + world.gates.length) % world.gates.length];
  const leg = previous.position.distanceTo(gate.position);
  ui.routeFill.style.width = `${Math.max(4, Math.min(100, (1 - distance / leg) * 100))}%`;
  const pitch = jet.pitchDeg();
  const bank = jet.bankDeg();
  const fd = ui.hud.querySelector('.flight-director');
  fd.style.transform = `translate(${THREE.MathUtils.clamp(bank * 0.45, -35, 35)}px, ${THREE.MathUtils.clamp(-pitch * 0.65, -26, 26)}px)`;
  ui.status.textContent = jet.stall > 0.25 ? 'STALL · NOSE DOWN' : input.boost ? 'AFTERBURNER' : jet.gLoad > 4 ? 'HIGH G' : 'CRUISE';
  if (elapsed < lastToast - 0.05 && lastToast - elapsed < 4.5) ui.toast.classList.add('visible');
  else ui.toast.classList.remove('visible');
  drawMap();
}

function updateCamera(dt) {
  const forward = jet.forward;
  if (cameraMode === 1) {
    desiredCamera.copy(jet.position).addScaledVector(forward, 4.8).addScaledVector(jet.up, 1.7);
    camera.position.lerp(desiredCamera, 1 - Math.exp(-dt * 9));
    lookTarget.copy(jet.position).addScaledVector(forward, 160);
  } else {
    desiredCamera.copy(jet.position).addScaledVector(forward, -66).addScaledVector(jet.up, 23);
    camera.position.lerp(desiredCamera, 1 - Math.exp(-dt * 3.2));
    lookTarget.copy(jet.position).addScaledVector(forward, 48).addScaledVector(jet.up, 4);
  }
  upTarget.copy(jet.up).lerp(new THREE.Vector3(0, 1, 0), cameraMode === 1 ? 0.1 : 0.45).normalize();
  camera.up.lerp(upTarget, 1 - Math.exp(-dt * 4));
  camera.lookAt(lookTarget);
}

function crashFlight(edge = false) {
  if (crashed) return;
  crashed = true;
  paused = false;
  keys.clear();
  if (!edge) spawnExplosion(scene, jet.position.clone());
  ui.crashCopy.textContent = edge
    ? 'You found the edge of this little world. The horizon is waiting for another try.'
    : 'A little too close to the ground. Every landing is a chance to take off again.';
  setVisible(ui.crash, true);
}

function updateAudio() {
  if (!audioContext || !engineOscillators.length || !jet) return;
  const active = started && !paused && !crashed && ui.sound.classList.contains('sound-on');
  audioGain.gain.setTargetAtTime(active ? 0.014 + jet.speed / 330 * 0.012 : 0, audioContext.currentTime, 0.12);
  engineOscillators[0].frequency.setTargetAtTime(48 + jet.speed * 0.42, audioContext.currentTime, 0.1);
  engineOscillators[1].frequency.setTargetAtTime(73 + jet.speed * 0.64, audioContext.currentTime, 0.1);
}

function toggleSound() {
  if (!audioContext) {
    const AudioCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtor) return;
    audioContext = new AudioCtor();
    audioGain = audioContext.createGain();
    audioGain.gain.value = 0;
    audioGain.connect(audioContext.destination);
    engineOscillators = [55, 85].map((frequency, index) => {
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      oscillator.type = index ? 'sawtooth' : 'triangle';
      oscillator.frequency.value = frequency;
      gain.gain.value = index ? 0.18 : 0.55;
      oscillator.connect(gain).connect(audioGain);
      oscillator.start();
      return oscillator;
    });
    audioContext.resume();
    ui.sound.classList.add('sound-on');
    ui.sound.title = 'Sound on';
  } else {
    const on = ui.sound.classList.toggle('sound-on');
    ui.sound.title = on ? 'Sound on' : 'Sound off';
    if (on) audioContext.resume();
    else audioGain.gain.setTargetAtTime(0, audioContext.currentTime, 0.08);
  }
}

function toggleHelp(force) {
  const visible = force === undefined ? ui.help.classList.contains('hidden') : force;
  setVisible(ui.help, visible);
  if (visible) keys.clear();
}

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta() || 0, 0.04);
  elapsed += dt;
  if (!world || !jet) {
    renderer.render(scene, camera);
    return;
  }
  if (paused) {
    world.update(0, elapsed, camera);
    updateEffects(0);
    renderer.render(scene, camera);
    return;
  }
  if (!crashed) {
    updateInput();
    previousPosition.copy(jet.position);
    const result = jet.update(dt, input, world, false);
    updateGates();
    if (result?.crash) crashFlight(false);
    else if (result?.edge) crashFlight(true);
  } else {
    jet.update(dt, input, world, true);
  }
  updateEffects(dt);
  updateCamera(dt);
  world.update(dt, elapsed, camera);
  updateHud();
  updateAudio();
  renderer.render(scene, camera);
}

ui.start.addEventListener('click', beginFlight);
ui.resume.addEventListener('click', () => setPaused(false));
ui.restart.addEventListener('click', resetFlight);
ui.restartCrash.addEventListener('click', resetFlight);
ui.pauseButton.addEventListener('click', () => setPaused(!paused));
ui.sound.addEventListener('click', toggleSound);
ui.helpButton.addEventListener('click', () => toggleHelp());
ui.closeHelp.addEventListener('click', () => toggleHelp(false));

window.addEventListener('keydown', (event) => {
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(event.code)) event.preventDefault();
  if (event.repeat && ['Escape', 'KeyR', 'KeyV', 'KeyH'].includes(event.code)) return;
  if (event.code === 'Escape') {
    if (!ui.help.classList.contains('hidden')) toggleHelp(false);
    else if (started && !crashed) setPaused(!paused);
    return;
  }
  if (event.code === 'KeyH' || event.code === 'Slash') {
    if (started && !paused && !crashed) toggleHelp();
    return;
  }
  if (event.code === 'KeyR' && started) { resetFlight(); return; }
  if (event.code === 'KeyV' && started) { cameraMode = (cameraMode + 1) % 2; showToast(cameraMode ? 'COCKPIT VIEW' : 'CHASE VIEW', 1400); return; }
  if (event.code === 'Enter' && !started) { beginFlight(); return; }
  keys.add(event.code);
});
window.addEventListener('keyup', (event) => keys.delete(event.code));
window.addEventListener('blur', () => keys.clear());

let stickPointer = null;
function moveStick(event) {
  if (stickPointer !== event.pointerId) return;
  const rect = ui.touchStick.getBoundingClientRect();
  const max = rect.width * 0.34;
  const x = THREE.MathUtils.clamp(event.clientX - (rect.left + rect.width / 2), -max, max);
  const y = THREE.MathUtils.clamp(event.clientY - (rect.top + rect.height / 2), -max, max);
  ui.stickKnob.style.transform = `translate(${x}px, ${y}px)`;
  touchInput.roll = x / max;
  touchInput.pitch = -y / max;
}
ui.touchStick.addEventListener('pointerdown', (event) => {
  event.preventDefault();
  stickPointer = event.pointerId;
  ui.touchStick.setPointerCapture(event.pointerId);
  moveStick(event);
});
ui.touchStick.addEventListener('pointermove', moveStick);
function releaseStick(event) {
  if (stickPointer !== event.pointerId) return;
  stickPointer = null;
  touchInput.pitch = touchInput.roll = 0;
  ui.stickKnob.style.transform = 'translate(0, 0)';
}
ui.touchStick.addEventListener('pointerup', releaseStick);
ui.touchStick.addEventListener('pointercancel', releaseStick);
ui.touchBoost.addEventListener('pointerdown', (event) => { event.preventDefault(); touchInput.boost = true; ui.touchBoost.classList.add('active'); });
for (const name of ['pointerup', 'pointercancel', 'pointerleave']) ui.touchBoost.addEventListener(name, () => { touchInput.boost = false; ui.touchBoost.classList.remove('active'); });

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.65));
  renderer.setSize(window.innerWidth, window.innerHeight);
});

animate();
