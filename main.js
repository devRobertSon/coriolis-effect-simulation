// Coriolis effect – 2D polar top-down view
// Center = selected pole, edge circle = equator
// Space view : globe rotates, ball travels in a straight line
// Earth view : globe fixed,  ball travels a curved path (Coriolis)

const R_EQ    = 0.82;   // equatorial radius in canvas-unit coords
const OMEGA_B = 0.55;   // base angular speed (exaggerated)
const ANIM_S  = 6.0;    // animation duration in seconds

const state = {
  hemi: 'N', scenario: 'eq-to-pole',
  speedMul: 1, rotMul: 1, timeScale: 1,
  running: false, elapsed: 0, physDur: 1.5,
};

const COLORS = {
  bg0:'#06102a', bg1:'#020810',
  ocean:'#103a7a', oceanRim:'#061a40',
  latLine:'rgba(120,180,255,0.22)',
  lonLine:'rgba(120,180,255,0.15)',
  equator:'#ffd166',
  trailE:'#ffd166', trailS:'#6ea8ff',
  start:'#7bd88f', end:'#ff6b9a', ball:'#ffffff',
};

let views = {}, ui = {}, traj = {earth:[], space:[]}, stars = null;

// ── init ──────────────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  views.earth = mkView('earthView');
  views.space = mkView('spaceView');
  bindUI();
  buildTraj();
  window.addEventListener('resize', onResize);
  onResize();
  requestAnimationFrame(loop);
});

function mkView(id) {
  const canvas = document.getElementById(id);
  return { canvas, ctx: canvas.getContext('2d'), w:0, h:0, cx:0, cy:0, scale:1 };
}

// ── UI ────────────────────────────────────────────────────────────────────────
function bindUI() {
  ui.play  = document.getElementById('playBtn');
  ui.pause = document.getElementById('pauseBtn');
  ui.stop  = document.getElementById('stopBtn');
  ui.exp   = document.getElementById('explanation');

  ui.play.addEventListener('click',  () => { if (state.elapsed >= ANIM_S) buildTraj(); state.running = true; });
  ui.pause.addEventListener('click', () => { state.running = false; });
  ui.stop.addEventListener('click',  () => { state.running = false; buildTraj(); });

  document.querySelectorAll('.btn.toggle[data-hemi]').forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll('.btn.toggle[data-hemi]').forEach(x => x.setAttribute('aria-pressed','false'));
    b.setAttribute('aria-pressed','true');
    state.hemi = b.dataset.hemi;
    buildTraj(); updateExp();
  }));
  document.querySelectorAll('.btn.scenario').forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll('.btn.scenario').forEach(x => x.setAttribute('aria-pressed','false'));
    b.setAttribute('aria-pressed','true');
    state.scenario = b.dataset.scenario;
    buildTraj(); updateExp();
  }));
  bindSlider('speedSlider',    'speedValue',    v => { state.speedMul  = v; buildTraj(); });
  bindSlider('rotationSlider', 'rotationValue', v => { state.rotMul    = v; buildTraj(); });
  bindSlider('timeScaleSlider','timeScaleValue',v => { state.timeScale = v; });
  updateExp();
}

function bindSlider(id, outId, fn) {
  const el = document.getElementById(id), out = document.getElementById(outId);
  const run = () => { const v = parseFloat(el.value); out.textContent = v.toFixed(2); fn(v); };
  el.addEventListener('input', run); run();
}

// ── Physics ───────────────────────────────────────────────────────────────────
// Positive omega = CCW rotation (N hemisphere viewed from above)
// Negative omega = CW  rotation (S hemisphere viewed from below)
function omega() { return (state.hemi === 'N' ? 1 : -1) * OMEGA_B * state.rotMul; }

function rot2D(x, y, a) {
  const c = Math.cos(a), s = Math.sin(a);
  return { x: c*x - s*y, y: s*x + c*y };
}

// Co-rotation velocity at point (x,y): ω × r = ω*(-y, x)
function coRot(x, y) { const w = omega(); return { vx: -y*w, vy: x*w }; }

// Returns { x0,y0,vx,vy } — inertial-frame initial conditions
// vx,vy already include co-rotation so the inertial path is as straight as possible
function scenarioIC() {
  const speed = 0.42 * state.speedMul;
  const w = omega();
  const h = state.hemi === 'N' ? 1 : -1;  // hemisphere sign (pole direction on screen)

  switch (state.scenario) {

    case 'pole-to-eq': {
      // Launch straight down from near-pole → perfectly vertical in space view
      // No co-rotation (pole has zero tangential velocity)
      const x0 = 0, y0 = 0.02 * h;
      return { x0, y0, vx: 0, vy: -h * speed };
    }

    case 'eq-to-pole': {
      // Ball at equator bottom, launched toward pole.
      // Add co-rotation so inertial velocity is as vertical as possible.
      // At (0, -h*R_EQ), co-rotation = ω*(h*R_EQ, 0) = (w*h*R_EQ, 0) – horizontal.
      // Inertial = (w*h*R_EQ, h*speed). Clearly straight (diagonal) but STRAIGHT.
      const x0 = 0, y0 = -h * R_EQ * 0.92;
      const cr = coRot(x0, y0);
      return { x0, y0, vx: cr.vx, vy: cr.vy + h * speed };
    }

    case 'eastward': {
      // At (0, -h*R_EQ*0.5), east = +x for N (co-rotation is rightward there).
      // Inertial is purely horizontal since co-rotation is already in +x.
      const x0 = 0, y0 = -h * R_EQ * 0.5;
      const cr = coRot(x0, y0);
      // "Eastward" in rotating frame = +x (CCW direction at that point)
      return { x0, y0, vx: speed + cr.vx, vy: cr.vy };
    }

    case 'westward': {
      const x0 = 0, y0 = -h * R_EQ * 0.5;
      const cr = coRot(x0, y0);
      return { x0, y0, vx: -speed + cr.vx, vy: cr.vy };
    }
  }
}

function buildTraj() {
  state.elapsed = 0;
  traj.earth = []; traj.space = [];

  const { x0, y0, vx, vy } = scenarioIC();
  const w = omega();

  // Physics duration: travel until ball exits disk (R_EQ) or max ~2 s
  const iSpeed = Math.hypot(vx, vy);
  state.physDur = Math.min(2.0, R_EQ * 1.8 / (iSpeed || 0.01));

  const STEPS = 320;
  for (let i = 0; i <= STEPS; i++) {
    const t = (i / STEPS) * state.physDur;
    const xi = x0 + vx * t;
    const yi = y0 + vy * t;

    // Keep points inside disk for neatness
    if (Math.hypot(xi, yi) > R_EQ * 1.08) break;

    traj.space.push({ x: xi, y: yi });
    const er = rot2D(xi, yi, -w * t);
    traj.earth.push(er);
  }
}

// ── Rendering ─────────────────────────────────────────────────────────────────
function onResize() {
  for (const v of [views.earth, views.space]) {
    const r = v.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    v.canvas.width  = Math.round(r.width  * dpr);
    v.canvas.height = Math.round(r.height * dpr);
    v.w = r.width; v.h = r.height;
    v.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    v.cx = r.width / 2; v.cy = r.height / 2;
    v.scale = Math.min(r.width, r.height) * 0.42;
  }
  stars = stars || Array.from({length:200}, () => ({
    x: Math.random(), y: Math.random(),
    r: Math.random() * 1.2 + 0.2, a: Math.random() * 0.6 + 0.2,
  }));
}

// (x,y) in normalized coords → screen pixel
function sp(view, x, y) {
  return { sx: view.cx + x * view.scale, sy: view.cy - y * view.scale };
}

function drawBg(view) {
  const { ctx, w, h } = view;
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, COLORS.bg0); g.addColorStop(1, COLORS.bg1);
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  ctx.save();
  for (const s of stars) {
    ctx.globalAlpha = s.a; ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(s.x*w, s.y*h, s.r, 0, Math.PI*2); ctx.fill();
  }
  ctx.restore();
}

function drawGlobe(view, earthAngle) {
  const { ctx, cx, cy, scale } = view;
  const R = R_EQ * scale;

  // Ocean disk
  const g = ctx.createRadialGradient(cx - R*0.25, cy - R*0.2, R*0.1, cx, cy, R);
  g.addColorStop(0, '#1a5fc8'); g.addColorStop(0.7, COLORS.ocean); g.addColorStop(1, COLORS.oceanRim);
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI*2);
  ctx.fillStyle = g; ctx.fill();
  ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(100,160,255,0.28)'; ctx.stroke();

  // Latitude rings
  ctx.strokeStyle = COLORS.latLine; ctx.lineWidth = 0.8;
  for (const latDeg of [30, 60]) {
    const r = Math.cos(latDeg * Math.PI/180) * R;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI*2); ctx.stroke();
  }

  // Meridian lines (rotate with earthAngle)
  ctx.strokeStyle = COLORS.lonLine; ctx.lineWidth = 0.7;
  for (let deg = 0; deg < 180; deg += 30) {
    const a = earthAngle + deg * Math.PI / 180;
    const dx = Math.cos(a) * R, dy = Math.sin(a) * R;
    ctx.beginPath();
    ctx.moveTo(cx - dx, cy - dy);
    ctx.lineTo(cx + dx, cy + dy);
    ctx.stroke();
  }

  // Equator circle
  ctx.strokeStyle = COLORS.equator; ctx.lineWidth = 1.4; ctx.globalAlpha = 0.75;
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI*2); ctx.stroke();
  ctx.globalAlpha = 1;

  // Pole dot
  ctx.fillStyle = 'rgba(255,123,208,0.8)';
  ctx.beginPath(); ctx.arc(cx, cy, 3.5, 0, Math.PI*2); ctx.fill();
}

function drawPath(view, pts, color, alpha) {
  if (pts.length < 2) return;
  const { ctx } = view;
  ctx.save();
  ctx.strokeStyle = color; ctx.lineWidth = 2.5;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.globalAlpha = alpha;
  ctx.beginPath();
  const p0 = sp(view, pts[0].x, pts[0].y);
  ctx.moveTo(p0.sx, p0.sy);
  for (let i = 1; i < pts.length; i++) {
    const p = sp(view, pts[i].x, pts[i].y);
    ctx.lineTo(p.sx, p.sy);
  }
  ctx.stroke();
  ctx.restore();
}

function drawDot(view, x, y, color, r, label) {
  const { ctx } = view;
  const p = sp(view, x, y);
  ctx.save();
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.arc(p.sx, p.sy, r, 0, Math.PI*2); ctx.fill();
  if (label) {
    ctx.fillStyle = '#e8ecff';
    ctx.font = '11px system-ui, sans-serif';
    ctx.fillText(label, p.sx + r + 3, p.sy - 3);
  }
  ctx.restore();
}

function renderView(view, pts, fullPts, color, ballPt, earthAngle) {
  const { ctx, w, h, cx, cy, scale } = view;
  ctx.clearRect(0, 0, w, h);
  drawBg(view);

  // Shift so ball is near center
  const bsx = cx + ballPt.x * scale;
  const bsy = cy - ballPt.y * scale;
  ctx.save();
  ctx.translate(cx - bsx, cy - bsy);

  drawGlobe(view, earthAngle);
  drawPath(view, fullPts,  color, 0.28);  // ghost full path
  drawPath(view, pts,      color, 1.0);   // traveled

  const s0 = fullPts[0], sN = fullPts[fullPts.length - 1];
  drawDot(view, s0.x, s0.y, COLORS.start, 5, '시작');
  drawDot(view, sN.x, sN.y, COLORS.end,   5, '끝');
  drawDot(view, ballPt.x, ballPt.y, COLORS.ball, 5);

  ctx.restore();
}

// ── Loop ──────────────────────────────────────────────────────────────────────
let lastT = performance.now();

function loop(now) {
  const dt = Math.min(0.05, (now - lastT) / 1000);
  lastT = now;

  if (state.running) {
    state.elapsed += dt * state.timeScale;
    if (state.elapsed >= ANIM_S) { state.elapsed = ANIM_S; state.running = false; }
  }

  const frac  = Math.min(1, state.elapsed / ANIM_S);
  const nE    = Math.max(1, Math.round(frac * (traj.earth.length - 1)));
  const nS    = Math.max(1, Math.round(frac * (traj.space.length - 1)));
  const physT = frac * state.physDur;
  const w     = omega();

  const ef = traj.earth, sf = traj.space;
  if (!ef.length || !sf.length) { requestAnimationFrame(loop); return; }

  // Earth view: globe is FIXED (reference frame), trajectory curves
  renderView(views.earth, ef.slice(0, nE+1), ef, COLORS.trailE, ef[nE], 0);

  // Space view: globe ROTATES, trajectory is a straight line
  renderView(views.space, sf.slice(0, nS+1), sf, COLORS.trailS, sf[nS], w * physT);

  requestAnimationFrame(loop);
}

// ── Explanation ───────────────────────────────────────────────────────────────
function updateExp() {
  const hs = state.hemi === 'N' ? '북반구' : '남반구';
  const d  = state.hemi === 'N' ? '오른쪽' : '왼쪽';
  const map = {
    'eq-to-pole': `${hs}: 적도에서 극 방향으로 던진 공은 우주 관측자 눈에 직선으로 움직이지만, 지구 관측자 눈에는 ${d}으로 휘어 보입니다. 지구 자전으로 아래쪽 지면이 달라지기 때문입니다.`,
    'pole-to-eq': `${hs}: 극에서 적도 방향으로 던진 공은 우주에서 직선이지만, 지구 위 관측자에게는 ${d}으로 휘어져 보입니다.`,
    'eastward':   `${hs}: 자전 방향(동쪽)으로 던진 공은 우주에서 수평 직선이지만, 지구 관측자에게는 적도 쪽(${d})으로 휘어져 보입니다.`,
    'westward':   `${hs}: 자전 반대 방향(서쪽)으로 던진 공은 우주에서 수평 직선이지만, 지구 관측자에게는 극 쪽(${d})으로 휘어져 보입니다.`,
  };
  ui.exp.textContent = map[state.scenario] || '';
}
