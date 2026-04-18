// Coriolis effect — 2D canvas, pseudo-3D orthographic projection.
// Earth view: rotating frame (Coriolis visible).
// Space view: inertial frame (straight-line path).

const EARTH_R = 1.0;
const OMEGA_BASE = 0.55; // exaggerated for visibility

const state = {
  hemisphere: 'N',
  scenario: 'eq-to-pole',
  speedMul: 1.0,
  rotationMul: 1.0,
  timeScale: 1.0,
  running: false,
  elapsed: 0,
  duration: 6.0,
  physDuration: 1.4, // physics seconds the arc takes
};

const COLORS = {
  bg0: '#07102a', bg1: '#030810',
  ocean: '#1255a8', oceanEdge: '#092555',
  grid: 'rgba(140,190,255,0.2)', equator: '#ffd166',
  axis: 'rgba(255,123,208,0.5)',
  trailEarth: '#ffd166', trailSpace: '#6ea8ff',
  ball: '#ffffff', start: '#7bd88f', end: '#ff6b9a',
};

let views = {}, ui = {}, traj = { earth: [], space: [] }, stars = null;

window.addEventListener('DOMContentLoaded', () => {
  views.earth = makeView(document.getElementById('earthView'));
  views.space = makeView(document.getElementById('spaceView'));
  views.earth.trajFollowsGlobe = true;  // rotating frame: trajectory painted on globe
  views.space.trajFollowsGlobe = false; // inertial frame: trajectory fixed, globe rotates past
  bindUI();
  buildTrajectory();
  window.addEventListener('resize', onResize);
  onResize();
  requestAnimationFrame(loop);
});

function makeView(canvas) {
  return { canvas, ctx: canvas.getContext('2d'), w: 0, h: 0, scale: 1, cx: 0, cy: 0, earthAngle: 0 };
}

// ---------- UI --------------------------------------------------------------

function bindUI() {
  ui.play  = document.getElementById('playBtn');
  ui.pause = document.getElementById('pauseBtn');
  ui.stop  = document.getElementById('stopBtn');
  ui.exp   = document.getElementById('explanation');

  ui.play.addEventListener('click', () => { if (state.elapsed >= state.duration) buildTrajectory(); state.running = true; });
  ui.pause.addEventListener('click', () => { state.running = false; });
  ui.stop.addEventListener('click', () => { state.running = false; buildTrajectory(); });

  document.querySelectorAll('.btn.toggle[data-hemi]').forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll('.btn.toggle[data-hemi]').forEach(x => x.setAttribute('aria-pressed', 'false'));
    b.setAttribute('aria-pressed', 'true');
    state.hemisphere = b.dataset.hemi;
    buildTrajectory(); updateExp();
  }));

  document.querySelectorAll('.btn.scenario').forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll('.btn.scenario').forEach(x => x.setAttribute('aria-pressed', 'false'));
    b.setAttribute('aria-pressed', 'true');
    state.scenario = b.dataset.scenario;
    buildTrajectory(); updateExp();
  }));

  bindSlider('speedSlider',    'speedValue',    v => { state.speedMul    = v; buildTrajectory(); });
  bindSlider('rotationSlider', 'rotationValue', v => { state.rotationMul = v; buildTrajectory(); });
  bindSlider('timeScaleSlider','timeScaleValue',v => { state.timeScale   = v; });

  updateExp();
}

function bindSlider(id, outId, fn) {
  const el = document.getElementById(id), out = document.getElementById(outId);
  const apply = () => { const v = parseFloat(el.value); out.textContent = v.toFixed(2); fn(v); };
  el.addEventListener('input', apply); apply();
}

// ---------- Math helpers ----------------------------------------------------

function v3(x, y, z) { return { x, y, z }; }

function latLon(phi, lam, r = EARTH_R) {
  return v3(r * Math.cos(phi) * Math.cos(lam),
            r * Math.sin(phi),
            r * Math.cos(phi) * Math.sin(lam));
}

function add3(a, b)     { return v3(a.x+b.x, a.y+b.y, a.z+b.z); }
function scale3(a, k)   { return v3(a.x*k, a.y*k, a.z*k); }
function len3(a)        { return Math.hypot(a.x, a.y, a.z); }
function norm3(a)       { const l = len3(a)||1; return scale3(a, 1/l); }
function dot3(a, b)     { return a.x*b.x + a.y*b.y + a.z*b.z; }

function rotY(v, a) {
  const c = Math.cos(a), s = Math.sin(a);
  return v3(c*v.x + s*v.z, v.y, -s*v.x + c*v.z);
}
function rotX(v, a) {
  const c = Math.cos(a), s = Math.sin(a);
  return v3(v.x, c*v.y - s*v.z, s*v.y + c*v.z);
}

function onSphere(v) {
  const l = len3(v); if (l === 0) return v3(1,0,0);
  return scale3(v, EARTH_R / l);
}

// tilt: positive tilts north pole toward viewer (+z). Sign depends on hemisphere.
function tilt() { return state.hemisphere === 'N' ? Math.PI/5 : -Math.PI/5; }

// Camera transform for globe surface (applies earth rotation + tilt)
function globeXform(v, view) { return rotX(rotY(v, view.earthAngle), tilt()); }
// Camera transform for trajectory (only tilt — trajectory is already in its frame)
// Earth view: trajectory is in rotating frame → rotate display with globe (same earthAngle).
// Space view: trajectory is in inertial frame → only camera tilt, no Y rotation.
function trajXform(v, view) {
  if (view && view.trajFollowsGlobe) return globeXform(v, view);
  return rotX(v, tilt());
}

function toScreen(p, view) {
  return { sx: view.cx + p.x * view.scale, sy: view.cy - p.y * view.scale, z: p.z };
}

// ---------- Physics ---------------------------------------------------------

function scenarios() {
  const hs = state.hemisphere === 'N' ? 1 : -1;
  const phi30 = hs * Math.PI / 6;
  // lam0 = π/2 places the start point at the front-center of the tilted globe view.
  const L = Math.PI / 2;
  switch (state.scenario) {
    case 'eq-to-pole':  return { phi0: 0,                    lam0: L, dE: 0,  dN: hs };
    case 'pole-to-eq':  return { phi0: hs*(Math.PI/2-0.18),  lam0: L, dE: 0,  dN: -hs };
    case 'eastward':    return { phi0: phi30,                 lam0: L, dE: 1,  dN: 0 };
    case 'westward':    return { phi0: phi30,                 lam0: L, dE: -1, dN: 0 };
  }
}

function buildTrajectory() {
  state.elapsed = 0;
  traj.earth = []; traj.space = [];

  const { phi0, lam0, dE, dN } = scenarios();
  const speed  = 0.55 * state.speedMul;
  const omega  = OMEGA_BASE * state.rotationMul;
  const hs     = state.hemisphere === 'N' ? 1 : -1;

  const pos0 = latLon(phi0, lam0);

  // Local east/north unit vectors at launch point
  const eastV  = norm3(v3(-Math.sin(lam0), 0, Math.cos(lam0)));
  const northV = norm3(v3(-Math.sin(phi0)*Math.cos(lam0), Math.cos(phi0), -Math.sin(phi0)*Math.sin(lam0)));

  const launchDir = norm3(add3(scale3(eastV, dE), scale3(northV, dN)));

  // Inertial velocity = launch direction + surface co-rotation
  // ω × r, with ω = (0, omega, 0): (omega*z, 0, -omega*x)
  const surfVel = v3(omega * pos0.z, 0, -omega * pos0.x);
  const vel = add3(scale3(launchDir, speed), surfVel);

  // Cap physics duration so arc ≈ 50° max, stays in hemisphere
  const arcRad = (50 * Math.PI / 180);
  state.physDuration = arcRad / speed;
  state.duration = 6.0;

  const steps = 300;
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * state.physDuration;

    // Inertial position (straight line)
    const inert = add3(pos0, scale3(vel, t));

    // Space view: project inertial position to sphere
    const spPt = onSphere(inert);
    // Stop if trajectory drifts to wrong hemisphere
    if (spPt.y * hs < -0.08) break;
    traj.space.push(spPt);

    // Earth view: de-rotate inertial position by omega*t → rotating frame
    const earthPt = onSphere(rotY(inert, -omega * t));
    traj.earth.push(earthPt);
  }

  views.earth.earthAngle = 0;
  views.space.earthAngle = 0;
}

// ---------- Rendering -------------------------------------------------------

function onResize() {
  for (const v of [views.earth, views.space]) {
    const r = v.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    v.canvas.width  = Math.max(2, Math.round(r.width  * dpr));
    v.canvas.height = Math.max(2, Math.round(r.height * dpr));
    v.w = r.width; v.h = r.height;
    v.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    v.cx = r.width / 2; v.cy = r.height / 2;
    v.scale = Math.min(r.width, r.height) * 0.36;
  }
  if (!stars) stars = Array.from({length:250}, () => ({
    x: Math.random(), y: Math.random(),
    r: Math.random()*1.3+0.2, a: Math.random()*0.7+0.2,
  }));
}

function drawBg(view) {
  const { ctx, w, h, cx, cy, scale } = view;
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, COLORS.bg0); g.addColorStop(1, COLORS.bg1);
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  ctx.save();
  for (const s of stars) {
    ctx.globalAlpha = s.a;
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(s.x*w, s.y*h, s.r, 0, Math.PI*2); ctx.fill();
  }
  ctx.restore();
}

function drawGlobe(view) {
  const { ctx, cx, cy, scale } = view;
  // shaded disk
  const g = ctx.createRadialGradient(cx-scale*0.3, cy-scale*0.3, scale*0.1, cx, cy, scale);
  g.addColorStop(0, '#3472d4'); g.addColorStop(0.6, COLORS.ocean); g.addColorStop(1, COLORS.oceanEdge);
  ctx.beginPath(); ctx.arc(cx, cy, scale, 0, Math.PI*2);
  ctx.fillStyle = g; ctx.fill();
  ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(120,170,255,0.3)'; ctx.stroke();

  // graticule — lat circles every 30°, meridians every 30°
  ctx.strokeStyle = COLORS.grid; ctx.lineWidth = 0.8;
  for (let lat = -60; lat <= 60; lat += 30) drawLatCircle(view, lat * Math.PI/180);
  for (let lon = 0; lon < 360; lon += 30) drawMeridian(view, lon * Math.PI/180);

  // equator highlight
  ctx.strokeStyle = COLORS.equator; ctx.globalAlpha = 0.7; ctx.lineWidth = 1.4;
  drawLatCircle(view, 0); ctx.globalAlpha = 1;

  // axis
  const tp = toScreen(globeXform(v3(0,1.22,0), view), view);
  const bp = toScreen(globeXform(v3(0,-1.22,0), view), view);
  ctx.strokeStyle = COLORS.axis; ctx.lineWidth = 1; ctx.globalAlpha = 0.6;
  ctx.beginPath(); ctx.moveTo(tp.sx,tp.sy); ctx.lineTo(bp.sx,bp.sy); ctx.stroke();
  ctx.globalAlpha = 1;
}

function drawLatCircle(view, phi) {
  const { ctx } = view;
  const segs = 90;
  ctx.beginPath(); let pen = false;
  for (let i = 0; i <= segs; i++) {
    const lam = (i/segs) * Math.PI * 2;
    const t = globeXform(latLon(phi, lam, EARTH_R*1.001), view);
    if (t.z < 0) { pen = false; continue; }
    const p = toScreen(t, view);
    if (!pen) { ctx.moveTo(p.sx, p.sy); pen = true; } else ctx.lineTo(p.sx, p.sy);
  }
  ctx.stroke();
}

function drawMeridian(view, lam) {
  const { ctx } = view;
  const segs = 60;
  ctx.beginPath(); let pen = false;
  for (let i = 0; i <= segs; i++) {
    const phi = -Math.PI/2 + (i/segs)*Math.PI;
    const t = globeXform(latLon(phi, lam, EARTH_R*1.001), view);
    if (t.z < 0) { pen = false; continue; }
    const p = toScreen(t, view);
    if (!pen) { ctx.moveTo(p.sx, p.sy); pen = true; } else ctx.lineTo(p.sx, p.sy);
  }
  ctx.stroke();
}

function drawTrail(view, pts, color, alpha) {
  const { ctx } = view;
  if (pts.length < 2) return;
  ctx.save(); ctx.lineWidth = 2.5; ctx.lineCap = 'round';
  // back pass (faded)
  ctx.beginPath(); let pen = false;
  for (const pt of pts) {
    const t = trajXform(pt, view); if (t.z >= 0) { pen = false; continue; }
    const p = toScreen(t, view);
    if (!pen) { ctx.moveTo(p.sx,p.sy); pen=true; } else ctx.lineTo(p.sx,p.sy);
  }
  ctx.globalAlpha = alpha * 0.22; ctx.strokeStyle = color; ctx.stroke();
  // front pass
  ctx.beginPath(); pen = false;
  for (const pt of pts) {
    const t = trajXform(pt, view); if (t.z < 0) { pen = false; continue; }
    const p = toScreen(t, view);
    if (!pen) { ctx.moveTo(p.sx,p.sy); pen=true; } else ctx.lineTo(p.sx,p.sy);
  }
  ctx.globalAlpha = alpha; ctx.strokeStyle = color; ctx.stroke();
  ctx.restore();
}

function drawDot(view, pt3, color, r, label) {
  const t = trajXform(pt3, view);
  const p = toScreen(t, view);
  const { ctx } = view;
  ctx.save();
  ctx.globalAlpha = t.z < 0 ? 0.25 : 1;
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.arc(p.sx, p.sy, r, 0, Math.PI*2); ctx.fill();
  if (label && t.z >= 0) {
    ctx.fillStyle = '#e8ecff';
    ctx.font = '11px system-ui, sans-serif';
    ctx.fillText(label, p.sx+r+3, p.sy-3);
  }
  ctx.restore();
}

function render(view, fullPts, shownPts, color, startPt, endPt, ballPt) {
  const { ctx, w, h, cx, cy, scale } = view;
  ctx.clearRect(0, 0, w, h);
  drawBg(view);

  // Center the view on the current ball position so the ball stays mid-screen.
  const bt = trajXform(ballPt || shownPts[shownPts.length-1] || fullPts[0], view);
  const bsx = cx + bt.x * scale;
  const bsy = cy - bt.y * scale;
  const dx = cx - bsx, dy = cy - bsy;

  ctx.save();
  ctx.translate(dx, dy);

  drawGlobe(view);
  drawTrail(view, fullPts,  color, 0.3);   // ghost full path
  drawTrail(view, shownPts, color, 1.0);   // traveled path bright
  drawDot(view, startPt, COLORS.start, 5.5, '시작');
  drawDot(view, endPt,   COLORS.end,   5.5, '끝');
  if (shownPts.length > 0) drawDot(view, ballPt, '#fff', 5);

  ctx.restore();
}

// ---------- Animation loop --------------------------------------------------

let lastT = performance.now();

function loop(now) {
  const dt = Math.min(0.05, (now - lastT) / 1000);
  lastT = now;

  if (state.running) {
    state.elapsed += dt * state.timeScale;
    if (state.elapsed >= state.duration) { state.elapsed = state.duration; state.running = false; }
  }

  const frac = Math.min(1, state.elapsed / state.duration);
  const nE = Math.max(1, Math.round(frac * (traj.earth.length - 1)));
  const nS = Math.max(1, Math.round(frac * (traj.space.length - 1)));

  const omega = OMEGA_BASE * state.rotationMul;
  const physT = frac * state.physDuration; // actual physics time elapsed

  // Both views show the globe rotating at ω.
  // Earth view: trajectory is in the rotating frame, so it rotates with the globe
  //   → Coriolis curve stays "painted on" the globe surface.
  // Space view: trajectory is inertial (trajXform skips earthAngle)
  //   → globe rotates under the fixed straight-line path.
  views.earth.earthAngle = omega * physT;
  views.space.earthAngle = omega * physT;

  const ef = traj.earth, sf = traj.space;
  if (!ef.length || !sf.length) { requestAnimationFrame(loop); return; }

  render(views.earth, ef, ef.slice(0, nE+1), COLORS.trailEarth, ef[0], ef[ef.length-1], ef[nE]);
  render(views.space, sf, sf.slice(0, nS+1), COLORS.trailSpace, sf[0], sf[sf.length-1], sf[nS]);

  requestAnimationFrame(loop);
}

// ---------- Explanations ----------------------------------------------------

function updateExp() {
  const hs = state.hemisphere === 'N' ? '북반구' : '남반구';
  const d  = state.hemisphere === 'N' ? '오른쪽' : '왼쪽';
  const map = {
    'eq-to-pole': `적도에서 ${hs}의 극을 향해 던진 공은 자전의 동쪽 접선 속도를 가지고 출발합니다. 고위도로 갈수록 지표 자전 속도가 느려지므로 지구 관측자 눈에는 공이 ${d}(동쪽)으로 휘어 보입니다.`,
    'pole-to-eq': `극 근처에서 적도로 던진 공은 초기 접선 속도가 거의 없습니다. 저위도로 내려올수록 지면이 더 빠르게 동으로 움직여 공이 ${d}(서쪽)으로 뒤처지는 것처럼 보입니다.`,
    'eastward':   `${hs}에서 동쪽으로 던진 공은 원심 효과가 커져 적도 쪽(${d})으로 휘어 보입니다.`,
    'westward':   `${hs}에서 서쪽으로 던진 공은 원심 효과가 줄어 극 쪽(${d})으로 휘어 보입니다.`,
  };
  ui.exp.textContent = map[state.scenario] || '';
}
