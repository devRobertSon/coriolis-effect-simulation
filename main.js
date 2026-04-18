// Coriolis simulation — 2D canvas with pseudo-3D (orthographic) projection of a
// rotating sphere. Two stacked views: the ball's trajectory in the rotating
// (Earth observer) frame and in the inertial (space observer) frame.

const EARTH_R = 1.0;
const OMEGA_BASE = 0.45; // radians per simulated second at rotation multiplier 1

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

const COLORS = {
  bgGrad0: '#0a1230',
  bgGrad1: '#05070f',
  oceanFar: '#0b2a5a',
  oceanNear: '#1a60c8',
  grid: 'rgba(160, 200, 255, 0.22)',
  equator: '#ffd166',
  axis: 'rgba(255, 123, 208, 0.55)',
  trailEarth: '#ffd166',
  trailSpace: '#6ea8ff',
  ball: '#ffffff',
  startMark: '#7bd88f',
  endMark: '#ff6b9a',
  star: 'rgba(255,255,255,0.85)',
};

const views = { earth: null, space: null };
const ui = {};
let trajectory = { earth: [], space: [] };
let stars = null;

init();

function init() {
  views.earth = setupView(document.getElementById('earthView'), { rotating: true });
  views.space = setupView(document.getElementById('spaceView'), { rotating: false });

  bindUI();
  resetTrajectory();

  window.addEventListener('resize', onResize);
  onResize();

  requestAnimationFrame(animate);
}

function setupView(canvas, { rotating }) {
  return {
    canvas,
    ctx: canvas.getContext('2d'),
    rotating,
    width: 0,
    height: 0,
    scale: 200, // pixels per unit radius, computed on fit
    cx: 0,
    cy: 0,
    earthAngle: 0, // current Earth rotation (for space view)
  };
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

  bindSlider('speedSlider', 'speedValue', (v) => { state.speedMul = v; resetTrajectory(); });
  bindSlider('rotationSlider', 'rotationValue', (v) => { state.rotationMul = v; resetTrajectory(); });
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

// ---------- Physics / geometry ----------------------------------------------

function latLonToVec3(phi, lambda, r = EARTH_R) {
  return {
    x: r * Math.cos(phi) * Math.cos(lambda),
    y: r * Math.sin(phi),
    z: r * Math.cos(phi) * Math.sin(lambda),
  };
}

function eastNorth(phi, lambda) {
  return {
    east: { x: -Math.sin(lambda), y: 0, z: Math.cos(lambda) },
    north: {
      x: -Math.sin(phi) * Math.cos(lambda),
      y: Math.cos(phi),
      z: -Math.sin(phi) * Math.sin(lambda),
    },
  };
}

function rotateY(v, a) {
  const c = Math.cos(a), s = Math.sin(a);
  return { x: c * v.x + s * v.z, y: v.y, z: -s * v.x + c * v.z };
}

function projectToSphere(v) {
  const r = Math.hypot(v.x, v.y, v.z);
  if (r === 0) return { x: EARTH_R, y: 0, z: 0 };
  const k = EARTH_R / r;
  return { x: v.x * k, y: v.y * k, z: v.z * k };
}

function initialConditions() {
  const hemiSign = state.hemisphere === 'N' ? 1 : -1;
  const phiMid = hemiSign * Math.PI / 6; // 30° latitude

  let startPhi = phiMid;
  let startLambda = 0;
  let dirEast = 0;
  let dirNorth = 0;

  switch (state.scenario) {
    case 'eq-to-pole':
      startPhi = 0;
      dirNorth = hemiSign;
      break;
    case 'pole-to-eq':
      startPhi = hemiSign * (Math.PI / 2 - 0.15);
      dirNorth = -hemiSign;
      break;
    case 'eastward':
      startPhi = phiMid;
      dirEast = 1;
      break;
    case 'westward':
      startPhi = phiMid;
      dirEast = -1;
      break;
  }
  return { startPhi, startLambda, dirEast, dirNorth };
}

function resetTrajectory() {
  state.elapsed = 0;
  trajectory = { earth: [], space: [] };

  const { startPhi, startLambda, dirEast, dirNorth } = initialConditions();
  const speed = 0.55 * state.speedMul;
  const omega = OMEGA_BASE * state.rotationMul;

  const startPos = latLonToVec3(startPhi, startLambda);
  const { east, north } = eastNorth(startPhi, startLambda);

  const dir = {
    x: east.x * dirEast + north.x * dirNorth,
    y: east.y * dirEast + north.y * dirNorth,
    z: east.z * dirEast + north.z * dirNorth,
  };
  const dlen = Math.hypot(dir.x, dir.y, dir.z) || 1;
  dir.x /= dlen; dir.y /= dlen; dir.z /= dlen;

  // Inertial velocity = launch tangent velocity + co-rotating surface velocity
  // (ω × r) = (0, ω, 0) × (x, y, z) = (ω·z, 0, -ω·x). Wait: (a × b)_x = a_y b_z - a_z b_y.
  // With a = (0, ω, 0), b = (x, y, z): (ω·z - 0, 0 - 0, 0 - ω·x) = (ω·z, 0, -ω·x).
  const surfaceVel = { x: omega * startPos.z, y: 0, z: -omega * startPos.x };
  const vel = {
    x: dir.x * speed + surfaceVel.x,
    y: dir.y * speed + surfaceVel.y,
    z: dir.z * speed + surfaceVel.z,
  };

  state.duration = 8.0;
  const steps = 240;
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * state.duration;
    const inertial = {
      x: startPos.x + vel.x * t,
      y: startPos.y + vel.y * t,
      z: startPos.z + vel.z * t,
    };
    const spaceGround = projectToSphere(inertial);
    trajectory.space.push(spaceGround);

    const earthFrame = rotateY(inertial, -omega * t);
    trajectory.earth.push(projectToSphere(earthFrame));
  }

  views.earth.earthAngle = 0;
  views.space.earthAngle = 0;
}

// ---------- Rendering -------------------------------------------------------

function onResize() {
  for (const v of [views.earth, views.space]) {
    const rect = v.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    v.canvas.width = Math.max(2, Math.floor(rect.width * dpr));
    v.canvas.height = Math.max(2, Math.floor(rect.height * dpr));
    v.width = rect.width;
    v.height = rect.height;
    v.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    v.cx = rect.width / 2;
    v.cy = rect.height / 2;
    // Leave room so the entire trajectory (can extend beyond the globe's
    // silhouette) stays on screen.
    v.scale = Math.min(rect.width, rect.height) * 0.38;
  }
  if (!stars) stars = genStars(220);
}

function genStars(n) {
  const arr = [];
  for (let i = 0; i < n; i++) {
    arr.push({
      x: Math.random(),
      y: Math.random(),
      r: Math.random() * 1.4 + 0.2,
      a: Math.random() * 0.7 + 0.2,
    });
  }
  return arr;
}

// View orientation: we tilt the sphere so the selected hemisphere is toward
// the viewer. Rotation by angle `tilt` around the X axis maps Earth's Y axis
// (pole) forward-and-up. Then we project (x,z) directly to screen with y
// giving depth shading. A secondary rotation around Y animates the globe in
// the space view.
function tiltAngle() {
  // For N hemisphere we look slightly down onto the northern hemisphere.
  // For S hemisphere, we look slightly up onto the southern hemisphere.
  return state.hemisphere === 'N' ? -Math.PI / 5 : Math.PI / 5;
}

function rotateX(v, a) {
  const c = Math.cos(a), s = Math.sin(a);
  return { x: v.x, y: c * v.y - s * v.z, z: s * v.y + c * v.z };
}

function viewTransform(v, view) {
  // Apply the view's own Earth rotation (space view animates), then tilt.
  let p = rotateY(v, view.earthAngle);
  p = rotateX(p, tiltAngle());
  return p;
}

function project(p, view) {
  return {
    sx: view.cx + p.x * view.scale,
    sy: view.cy - p.y * view.scale, // screen-y goes down
    depth: p.z, // +z = toward viewer after transform
  };
}

function drawBackground(view) {
  const { ctx, width, height } = view;
  const g = ctx.createLinearGradient(0, 0, 0, height);
  g.addColorStop(0, COLORS.bgGrad0);
  g.addColorStop(1, COLORS.bgGrad1);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, width, height);

  ctx.save();
  for (const s of stars) {
    ctx.globalAlpha = s.a;
    ctx.fillStyle = COLORS.star;
    ctx.beginPath();
    ctx.arc(s.x * width, s.y * height, s.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawGlobe(view) {
  const { ctx, cx, cy, scale } = view;

  // Globe disk with radial shading for a 3D look
  const grad = ctx.createRadialGradient(
    cx - scale * 0.35, cy - scale * 0.35, scale * 0.15,
    cx, cy, scale
  );
  grad.addColorStop(0, '#3d86ff');
  grad.addColorStop(0.55, COLORS.oceanNear);
  grad.addColorStop(1, COLORS.oceanFar);

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, scale, 0, Math.PI * 2);
  ctx.fillStyle = grad;
  ctx.fill();

  // Atmosphere glow
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(140, 180, 255, 0.35)';
  ctx.stroke();
  ctx.restore();

  drawGraticule(view);
  drawAxis(view);
  drawEquator(view);
}

// Draw latitude/longitude grid. Only front-facing (z > 0 after transform)
// segments are drawn.
function drawGraticule(view) {
  const { ctx } = view;
  ctx.strokeStyle = COLORS.grid;
  ctx.lineWidth = 1;

  // Latitude circles
  for (let lat = -60; lat <= 60; lat += 30) {
    const phi = (lat * Math.PI) / 180;
    drawLatitudeCircle(view, phi);
  }

  // Longitude meridians
  for (let lonDeg = 0; lonDeg < 360; lonDeg += 30) {
    const lambda = (lonDeg * Math.PI) / 180;
    drawMeridian(view, lambda);
  }
}

function drawLatitudeCircle(view, phi) {
  const { ctx } = view;
  const segs = 96;
  ctx.beginPath();
  let moved = false;
  for (let i = 0; i <= segs; i++) {
    const lambda = (i / segs) * Math.PI * 2;
    const v = latLonToVec3(phi, lambda, EARTH_R * 1.001);
    const t = viewTransform(v, view);
    if (t.z >= -0.05) {
      const p = project(t, view);
      if (!moved) { ctx.moveTo(p.sx, p.sy); moved = true; }
      else ctx.lineTo(p.sx, p.sy);
    } else {
      moved = false;
    }
  }
  ctx.stroke();
}

function drawMeridian(view, lambda) {
  const { ctx } = view;
  const segs = 64;
  ctx.beginPath();
  let moved = false;
  for (let i = 0; i <= segs; i++) {
    const phi = -Math.PI / 2 + (i / segs) * Math.PI;
    const v = latLonToVec3(phi, lambda, EARTH_R * 1.001);
    const t = viewTransform(v, view);
    if (t.z >= -0.05) {
      const p = project(t, view);
      if (!moved) { ctx.moveTo(p.sx, p.sy); moved = true; }
      else ctx.lineTo(p.sx, p.sy);
    } else {
      moved = false;
    }
  }
  ctx.stroke();
}

function drawEquator(view) {
  const { ctx } = view;
  ctx.strokeStyle = COLORS.equator;
  ctx.globalAlpha = 0.8;
  ctx.lineWidth = 1.5;
  drawLatitudeCircle(view, 0);
  ctx.globalAlpha = 1;
}

function drawAxis(view) {
  const { ctx } = view;
  const top = viewTransform({ x: 0, y: EARTH_R * 1.25, z: 0 }, view);
  const bot = viewTransform({ x: 0, y: -EARTH_R * 1.25, z: 0 }, view);
  const a = project(top, view);
  const b = project(bot, view);
  ctx.strokeStyle = COLORS.axis;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(a.sx, a.sy);
  ctx.lineTo(b.sx, b.sy);
  ctx.stroke();
}

function drawTrail(view, points, color) {
  const { ctx } = view;
  if (points.length < 2) return;

  // Draw in two passes so the hidden side is faded, the visible side is bright.
  ctx.lineWidth = 2.5;
  ctx.lineCap = 'round';

  for (const front of [false, true]) {
    ctx.beginPath();
    let moved = false;
    for (let i = 0; i < points.length; i++) {
      const t = viewTransform(points[i], view);
      const isFront = t.z >= -0.02;
      if (isFront !== front) { moved = false; continue; }
      const p = project(t, view);
      if (!moved) { ctx.moveTo(p.sx, p.sy); moved = true; }
      else ctx.lineTo(p.sx, p.sy);
    }
    ctx.globalAlpha = front ? 1 : 0.25;
    ctx.strokeStyle = color;
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function drawMarker(view, p3, color, label) {
  const t = viewTransform(p3, view);
  const isFront = t.z >= -0.02;
  const p = project(t, view);
  const { ctx } = view;
  ctx.save();
  ctx.globalAlpha = isFront ? 1 : 0.3;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(p.sx, p.sy, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.55)';
  ctx.lineWidth = 1;
  ctx.stroke();
  if (label) {
    ctx.fillStyle = '#e8ecff';
    ctx.font = '11px "Pretendard", "Noto Sans KR", system-ui, sans-serif';
    ctx.fillText(label, p.sx + 8, p.sy - 6);
  }
  ctx.restore();
}

function drawBall(view, p3) {
  const t = viewTransform(p3, view);
  const p = project(t, view);
  const { ctx } = view;
  const isFront = t.z >= -0.02;
  ctx.save();
  ctx.globalAlpha = isFront ? 1 : 0.5;
  ctx.fillStyle = COLORS.ball;
  ctx.beginPath();
  ctx.arc(p.sx, p.sy, 4.5, 0, Math.PI * 2);
  ctx.fill();
  // Subtle halo
  ctx.globalAlpha = (isFront ? 0.4 : 0.2);
  ctx.beginPath();
  ctx.arc(p.sx, p.sy, 8, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.fill();
  ctx.restore();
}

function renderView(view, fullPath, partialPath, color, startPt, endPt) {
  const { ctx, width, height } = view;
  ctx.clearRect(0, 0, width, height);
  drawBackground(view);
  drawGlobe(view);

  // Full planned path as a faded reference so the whole route is visible.
  ctx.save();
  ctx.globalAlpha = 0.35;
  drawTrail(view, fullPath, color);
  ctx.restore();

  // Traveled path so far, bright.
  drawTrail(view, partialPath, color);

  drawMarker(view, startPt, COLORS.startMark, '시작');
  drawMarker(view, endPt, COLORS.endMark, '끝');

  if (partialPath.length > 0) {
    drawBall(view, partialPath[partialPath.length - 1]);
  }
}

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

  const frac = Math.min(1, state.elapsed / state.duration);
  const nE = Math.max(1, Math.floor(frac * (trajectory.earth.length - 1)));
  const nS = Math.max(1, Math.floor(frac * (trajectory.space.length - 1)));

  const omega = OMEGA_BASE * state.rotationMul;

  // Earth-view: ground is fixed (we show in the rotating frame), so no globe spin.
  views.earth.earthAngle = 0;
  // Space-view: globe rotates at ω relative to the trajectory (which is plotted in inertial coords).
  views.space.earthAngle = omega * state.elapsed;

  const earthFull = trajectory.earth;
  const spaceFull = trajectory.space;

  renderView(
    views.earth,
    earthFull,
    earthFull.slice(0, nE + 1),
    COLORS.trailEarth,
    earthFull[0],
    earthFull[earthFull.length - 1]
  );
  renderView(
    views.space,
    spaceFull,
    spaceFull.slice(0, nS + 1),
    COLORS.trailSpace,
    spaceFull[0],
    spaceFull[spaceFull.length - 1]
  );

  requestAnimationFrame(animate);
}

function updateExplanation() {
  const hemi = state.hemisphere === 'N' ? '북반구' : '남반구';
  const deflect = state.hemisphere === 'N' ? '오른쪽' : '왼쪽';
  const map = {
    'eq-to-pole': `적도에서 ${hemi}의 극을 향해 던진 공은 자전에 의한 동쪽 방향 접선 속도를 함께 가진 채 출발합니다. 고위도로 갈수록 지표가 자전으로 움직이는 속도가 느려지기 때문에, 지구 관측자에게는 공이 원래 목표보다 ${deflect}(동쪽)으로 휘어 보입니다.`,
    'pole-to-eq': `극 근처에서 적도 방향으로 던진 공은 초기 접선 속도가 거의 0입니다. 공이 저위도로 내려올수록 아래쪽 지면이 더 빠르게 동쪽으로 이동하기 때문에, 지구 관측자에게는 공이 ${deflect}(서쪽)으로 뒤처져 휘어 보입니다.`,
    'eastward': `${hemi}에서 지구 자전 방향(동쪽)으로 던진 공은 원심 효과가 커지면서 적도 쪽으로 밀립니다. 결과적으로 지구 관측자에게는 공이 ${deflect}으로 휘어 보입니다.`,
    'westward': `${hemi}에서 자전 반대 방향(서쪽)으로 던진 공은 원심 효과가 줄어 극 쪽으로 휘어집니다. 결과적으로 지구 관측자에게는 공이 ${deflect}으로 휘어 보입니다.`,
  };
  ui.explanation.textContent = map[state.scenario] || '';
}
