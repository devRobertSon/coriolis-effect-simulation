import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const EARTH_RADIUS = 1.0;
const OMEGA_BASE = 0.25;

const state = {
  hemisphere: 'N',
  scenario: 'eq-to-pole',
  speedMul: 1.0,
  rotationMul: 1.0,
  timeScale: 1.0,
  running: false,
  elapsed: 0,
  duration: 8.0,
};

const views = { earth: null, space: null };
const ui = {};

init();

function init() {
  views.earth = createView(document.getElementById('earthView'), { rotating: true });
  views.space = createView(document.getElementById('spaceView'), { rotating: false });

  bindUI();
  resetTrajectory();
  applyHemisphereCamera();

  window.addEventListener('resize', onResize);
  onResize();

  requestAnimationFrame(animate);
}

function createView(canvas, { rotating }) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();

  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
  camera.position.set(0, 1.2, 3.2);

  const ambient = new THREE.AmbientLight(0x8899cc, 0.55);
  scene.add(ambient);
  const sun = new THREE.DirectionalLight(0xffffff, 1.1);
  sun.position.set(5, 3, 5);
  scene.add(sun);

  addStarfield(scene);

  // Earth group rotates (or not) around Y axis
  const earthGroup = new THREE.Group();
  scene.add(earthGroup);

  const earthMesh = new THREE.Mesh(
    new THREE.SphereGeometry(EARTH_RADIUS, 64, 48),
    new THREE.MeshPhongMaterial({
      color: 0x1a60c8,
      emissive: 0x051232,
      shininess: 18,
      specular: 0x335588,
    })
  );
  earthGroup.add(earthMesh);

  // continents hint: simple wireframe sphere over the globe
  const wire = new THREE.Mesh(
    new THREE.SphereGeometry(EARTH_RADIUS * 1.001, 24, 16),
    new THREE.MeshBasicMaterial({ color: 0x7fb0ff, wireframe: true, transparent: true, opacity: 0.22 })
  );
  earthGroup.add(wire);

  // Equator ring
  const eqGeom = new THREE.RingGeometry(EARTH_RADIUS * 1.002, EARTH_RADIUS * 1.006, 96);
  const eq = new THREE.Mesh(eqGeom, new THREE.MeshBasicMaterial({ color: 0xffd166, side: THREE.DoubleSide, transparent: true, opacity: 0.65 }));
  eq.rotation.x = Math.PI / 2;
  earthGroup.add(eq);

  // Axis line
  const axisMat = new THREE.LineBasicMaterial({ color: 0xff7bd0, transparent: true, opacity: 0.55 });
  const axisGeom = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, -EARTH_RADIUS * 1.4, 0),
    new THREE.Vector3(0, EARTH_RADIUS * 1.4, 0),
  ]);
  earthGroup.add(new THREE.Line(axisGeom, axisMat));

  // Ball
  const ball = new THREE.Mesh(
    new THREE.SphereGeometry(0.035, 18, 12),
    new THREE.MeshBasicMaterial({ color: 0xffffff })
  );
  scene.add(ball);

  // Trail (line)
  const trailColor = rotating ? 0xffd166 : 0x6ea8ff;
  const trailMat = new THREE.LineBasicMaterial({ color: trailColor, linewidth: 2, transparent: true, opacity: 0.95 });
  const trailGeom = new THREE.BufferGeometry();
  trailGeom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3));
  const trail = new THREE.Line(trailGeom, trailMat);
  scene.add(trail);

  // Start / end markers
  const startMark = new THREE.Mesh(
    new THREE.SphereGeometry(0.028, 16, 10),
    new THREE.MeshBasicMaterial({ color: 0x7bd88f })
  );
  const endMark = new THREE.Mesh(
    new THREE.SphereGeometry(0.028, 16, 10),
    new THREE.MeshBasicMaterial({ color: 0xff6b9a })
  );
  startMark.visible = false;
  endMark.visible = false;
  scene.add(startMark);
  scene.add(endMark);

  // Orbit controls (user can rotate to inspect)
  const controls = new OrbitControls(camera, canvas);
  controls.enablePan = false;
  controls.enableDamping = true;
  controls.minDistance = 1.8;
  controls.maxDistance = 6.0;

  return {
    canvas, renderer, scene, camera, controls,
    earthGroup, earthMesh, ball, trail, trailPoints: [],
    startMark, endMark,
    rotating,
  };
}

function addStarfield(scene) {
  const geom = new THREE.BufferGeometry();
  const count = 400;
  const pos = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const r = 30 + Math.random() * 15;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    pos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    pos[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
    pos[i * 3 + 2] = r * Math.cos(phi);
  }
  geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.05, sizeAttenuation: true, transparent: true, opacity: 0.8 });
  scene.add(new THREE.Points(geom, mat));
}

function bindUI() {
  ui.playBtn = document.getElementById('playBtn');
  ui.pauseBtn = document.getElementById('pauseBtn');
  ui.stopBtn = document.getElementById('stopBtn');
  ui.explanation = document.getElementById('explanation');

  ui.playBtn.addEventListener('click', () => {
    if (state.elapsed >= state.duration) resetTrajectory();
    state.running = true;
  });
  ui.pauseBtn.addEventListener('click', () => { state.running = false; });
  ui.stopBtn.addEventListener('click', () => { state.running = false; resetTrajectory(); });

  document.querySelectorAll('.btn.toggle[data-hemi]').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.btn.toggle[data-hemi]').forEach((b) => b.setAttribute('aria-pressed', 'false'));
      btn.setAttribute('aria-pressed', 'true');
      state.hemisphere = btn.dataset.hemi;
      resetTrajectory();
      applyHemisphereCamera();
      updateExplanation();
    });
  });

  document.querySelectorAll('.btn.scenario').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.btn.scenario').forEach((b) => b.setAttribute('aria-pressed', 'false'));
      btn.setAttribute('aria-pressed', 'true');
      state.scenario = btn.dataset.scenario;
      resetTrajectory();
      updateExplanation();
    });
  });

  bindSlider('speedSlider', 'speedValue', (v) => { state.speedMul = v; });
  bindSlider('rotationSlider', 'rotationValue', (v) => { state.rotationMul = v; });
  bindSlider('timeScaleSlider', 'timeScaleValue', (v) => { state.timeScale = v; });

  updateExplanation();
}

function bindSlider(inputId, valueId, onChange) {
  const input = document.getElementById(inputId);
  const out = document.getElementById(valueId);
  const apply = () => {
    const v = parseFloat(input.value);
    out.textContent = v.toFixed(2);
    onChange(v);
  };
  input.addEventListener('input', apply);
  apply();
}

function applyHemisphereCamera() {
  const y = state.hemisphere === 'N' ? 1.4 : -1.4;
  for (const view of [views.earth, views.space]) {
    view.camera.position.set(0, y, 2.6);
    view.controls.target.set(0, 0, 0);
    view.controls.update();
  }
}

// --- Physics / trajectory ---------------------------------------------------

function initialConditions() {
  const phi0 = state.hemisphere === 'N' ? Math.PI / 6 : -Math.PI / 6; // 30° latitude
  const lambda0 = 0;

  // Starting latitude/longitude per scenario
  let startPhi = phi0;
  let startLambda = lambda0;

  // Direction in local tangent plane: (east, north)
  // east +x_local, north +y_local
  let dirEast = 0;
  let dirNorth = 0;

  const hemiSign = state.hemisphere === 'N' ? 1 : -1;

  switch (state.scenario) {
    case 'eq-to-pole':
      startPhi = 0; // equator
      startLambda = 0;
      dirNorth = hemiSign; // toward pole
      break;
    case 'pole-to-eq':
      startPhi = hemiSign * (Math.PI / 2 - 0.12); // near pole
      startLambda = 0;
      dirNorth = -hemiSign; // toward equator
      break;
    case 'eastward':
      startPhi = phi0;
      startLambda = 0;
      dirEast = 1;
      break;
    case 'westward':
      startPhi = phi0;
      startLambda = 0;
      dirEast = -1;
      break;
  }

  return { startPhi, startLambda, dirEast, dirNorth };
}

function latLonToVec3(phi, lambda, r = EARTH_RADIUS) {
  // phi: latitude (-pi/2..pi/2), lambda: longitude (-pi..pi)
  const x = r * Math.cos(phi) * Math.cos(lambda);
  const y = r * Math.sin(phi);
  const z = r * Math.cos(phi) * Math.sin(lambda);
  return new THREE.Vector3(x, y, z);
}

function eastNorthVectors(phi, lambda) {
  // East: derivative wrt lambda (normalized) = (-sinλ, 0, cosλ)
  const east = new THREE.Vector3(-Math.sin(lambda), 0, Math.cos(lambda));
  // North: (-sinφ cosλ, cosφ, -sinφ sinλ)
  const north = new THREE.Vector3(-Math.sin(phi) * Math.cos(lambda), Math.cos(phi), -Math.sin(phi) * Math.sin(lambda));
  return { east, north };
}

let trajectory = { earth: [], space: [] };

function resetTrajectory() {
  state.elapsed = 0;
  trajectory = { earth: [], space: [] };

  const { startPhi, startLambda, dirEast, dirNorth } = initialConditions();

  // Build the inertial trajectory: ball launched from surface at t=0 with speed v
  // along local tangent direction, then moves in straight line in inertial frame
  // (we ignore gravity; a "tangent-plane cannonball" — standard Coriolis demo).
  const speed = 0.55 * state.speedMul; // units of radius per unit time

  // At t=0 the Earth has rotated by 0 (define frames aligned).
  // Inertial start position = Earth start position at t=0
  const startPos = latLonToVec3(startPhi, startLambda);
  const { east, north } = eastNorthVectors(startPhi, startLambda);
  const dir = new THREE.Vector3().addScaledVector(east, dirEast).addScaledVector(north, dirNorth).normalize();

  // In the inertial frame the ball's velocity also inherits the surface rotation
  // velocity at the launch point (ω × r). This is essential for the eq→pole and
  // eastward/westward cases to show Coriolis deflection correctly.
  const omega = OMEGA_BASE * state.rotationMul;
  const omegaVec = new THREE.Vector3(0, omega, 0);
  const surfaceVel = new THREE.Vector3().crossVectors(omegaVec, startPos);

  const inertialVel = dir.multiplyScalar(speed).add(surfaceVel);

  // Duration chosen so that the ball travels a visible arc
  state.duration = 8.0;

  const steps = 220;
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * state.duration;
    // Inertial position (straight line in space)
    const inertial = new THREE.Vector3().copy(startPos).addScaledVector(inertialVel, t);
    // Project back to earth surface visually (clamp to sphere) for display
    const inertialOnSphere = projectToSphere(inertial);
    trajectory.space.push(inertialOnSphere);

    // Earth-frame position: rotate inertial by -ω*t around Y
    const angle = -omega * t;
    const earthFrame = rotateY(inertial, angle);
    trajectory.earth.push(projectToSphere(earthFrame));
  }

  // Render static trail initially empty and update ball to first point
  updateTrailGeometry(views.earth, []);
  updateTrailGeometry(views.space, []);
  views.earth.ball.position.copy(trajectory.earth[0]);
  views.space.ball.position.copy(trajectory.space[0]);

  views.earth.startMark.position.copy(trajectory.earth[0]);
  views.earth.endMark.position.copy(trajectory.earth[trajectory.earth.length - 1]);
  views.space.startMark.position.copy(trajectory.space[0]);
  views.space.endMark.position.copy(trajectory.space[trajectory.space.length - 1]);
  for (const v of [views.earth, views.space]) {
    v.startMark.visible = true;
    v.endMark.visible = true;
  }

  // Reset Earth group rotation
  views.earth.earthGroup.rotation.y = 0;
  views.space.earthGroup.rotation.y = 0;
}

function projectToSphere(vec) {
  const r = vec.length();
  if (r === 0) return new THREE.Vector3(EARTH_RADIUS, 0, 0);
  // For visual: keep ball slightly above surface
  return vec.clone().multiplyScalar(EARTH_RADIUS * 1.01 / r);
}

function rotateY(v, angle) {
  const c = Math.cos(angle), s = Math.sin(angle);
  return new THREE.Vector3(c * v.x + s * v.z, v.y, -s * v.x + c * v.z);
}

function updateTrailGeometry(view, points) {
  const arr = new Float32Array(points.length * 3);
  for (let i = 0; i < points.length; i++) {
    arr[i * 3] = points[i].x;
    arr[i * 3 + 1] = points[i].y;
    arr[i * 3 + 2] = points[i].z;
  }
  view.trail.geometry.setAttribute('position', new THREE.BufferAttribute(arr, 3));
  view.trail.geometry.setDrawRange(0, points.length);
  view.trail.geometry.attributes.position.needsUpdate = true;
  view.trail.geometry.computeBoundingSphere();
}

// --- Animation --------------------------------------------------------------

let lastTime = performance.now();

function animate(now) {
  const dt = Math.min(0.05, (now - lastTime) / 1000);
  lastTime = now;

  if (state.running) {
    state.elapsed += dt * state.timeScale;
    if (state.elapsed >= state.duration) {
      state.elapsed = state.duration;
      state.running = false;
    }
  }

  // Fraction of trajectory to draw
  const frac = Math.min(1, state.elapsed / state.duration);
  const n = Math.max(1, Math.floor(frac * (trajectory.earth.length - 1)));

  updateTrailGeometry(views.earth, trajectory.earth.slice(0, n + 1));
  updateTrailGeometry(views.space, trajectory.space.slice(0, n + 1));

  if (trajectory.earth[n]) views.earth.ball.position.copy(trajectory.earth[n]);
  if (trajectory.space[n]) views.space.ball.position.copy(trajectory.space[n]);

  // Rotate Earth in the "Earth observer" view? The Earth view is the rotating
  // frame, so the ground should appear stationary — keep earthGroup static.
  // In the "Space" view, the Earth rotates at ω.
  const omega = OMEGA_BASE * state.rotationMul;
  views.space.earthGroup.rotation.y = omega * state.elapsed;
  // For continuous visual rotation cue even when paused, rotate slowly:
  if (!state.running) {
    views.space.earthGroup.rotation.y += 0;
  }

  for (const v of [views.earth, views.space]) {
    v.controls.update();
    v.renderer.render(v.scene, v.camera);
  }

  requestAnimationFrame(animate);
}

function onResize() {
  for (const v of [views.earth, views.space]) {
    const rect = v.canvas.getBoundingClientRect();
    const w = Math.max(2, rect.width);
    const h = Math.max(2, rect.height);
    v.renderer.setSize(w, h, false);
    v.camera.aspect = w / h;
    v.camera.updateProjectionMatrix();
  }
}

function updateExplanation() {
  const hemi = state.hemisphere === 'N' ? '북반구' : '남반구';
  const deflect = state.hemisphere === 'N' ? '오른쪽' : '왼쪽';
  const map = {
    'eq-to-pole': `적도에서 ${hemi}의 극을 향해 던진 공은 자전의 접선 속도(동쪽 성분)를 가진 채 출발합니다. 고위도로 갈수록 지표 자전 속도가 느려지므로, 지구 관측자에게는 공이 ${deflect}(동쪽)으로 휘어 보입니다.`,
    'pole-to-eq': `극 근처에서 적도를 향해 던진 공은 초기 접선 속도가 거의 0입니다. 공이 저위도로 갈수록 그 아래의 지면이 더 빠르게 동쪽으로 움직이므로, 지구 관측자에게는 공이 ${deflect}(서쪽)으로 뒤처져 휘어 보입니다.`,
    'eastward': `${hemi}에서 지구 자전 방향(동쪽)으로 던진 공은 원심 효과가 커져 적도 쪽으로, 즉 ${hemi}에서 오른/왼쪽(${deflect})으로 휘어 보입니다.`,
    'westward': `${hemi}에서 자전 반대 방향(서쪽)으로 던진 공은 원심 효과가 줄어 극 쪽으로, 즉 ${hemi}에서 ${deflect}으로 휘어 보입니다.`,
  };
  ui.explanation.textContent = map[state.scenario] || '';
}
