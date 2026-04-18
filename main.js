// Coriolis effect — 2D canvas, pseudo-3D orthographic projection.
// Ball moves along the sphere surface (lat/lon lines), not through free space.
// 4 views: rotating-earth × {earth-frame, inertial-frame}
//          fixed-earth   × {earth-frame, inertial-frame}

const EARTH_R  = 1.0;
const OMEGA_B  = 0.55; // exaggerated rotation speed
const ANIM_DUR = 6.0;

const state = {
  hemisphere: 'N',
  scenario: 'eq-to-pole',
  speedMul: 1.0,
  rotMul:   1.0,
  timeScale: 1.0,
  running: false,
  elapsed: 0,
  physDur: 3.0,
};

const COLORS = {
  bg0:'#07102a', bg1:'#030810',
  ocean:'#1255a8', oceanEdge:'#092555',
  grid:'rgba(140,190,255,0.2)', equator:'#ffd166',
  axis:'rgba(255,123,208,0.5)',
  trailE:'#ffd166', trailS:'#6ea8ff',
  ball:'#ffffff', start:'#7bd88f', end:'#ff6b9a',
};

let views = {}, ui = {},
    traj  = { earth: [], space: [] },
    stars = null;

window.addEventListener('DOMContentLoaded', () => {
  // Rotating-earth views
  views.earth      = mkView('earthView');
  views.space      = mkView('spaceView');
  // Fixed-earth views
  views.earthFixed = mkView('earthFixed');
  views.spaceFixed = mkView('spaceFixed');

  // In rotating views the globe spins; earth-frame trajectory rotates with it.
  views.earth.trajWithGlobe = true;
  views.space.trajWithGlobe = false;
  // In fixed views the globe stays put; trajectory drawn as-is.
  views.earthFixed.trajWithGlobe = false;
  views.spaceFixed.trajWithGlobe = false;

  bindUI();
  buildTraj();
  window.addEventListener('resize', onResize);
  onResize();
  requestAnimationFrame(loop);
});

function mkView(id) {
  return {
    canvas: document.getElementById(id),
    ctx: document.getElementById(id).getContext('2d'),
    w:0, h:0, cx:0, cy:0, scale:1, earthAngle:0,
    trajWithGlobe: false,
  };
}

// ─── UI ──────────────────────────────────────────────────────────────────────

function bindUI() {
  ui.play  = document.getElementById('playBtn');
  ui.pause = document.getElementById('pauseBtn');
  ui.stop  = document.getElementById('stopBtn');
  ui.exp   = document.getElementById('explanation');

  ui.play.addEventListener('click',  () => { if (state.elapsed >= ANIM_DUR) buildTraj(); state.running = true; });
  ui.pause.addEventListener('click', () => { state.running = false; });
  ui.stop.addEventListener('click',  () => { state.running = false; buildTraj(); });

  document.querySelectorAll('.btn.toggle[data-hemi]').forEach(b =>
    b.addEventListener('click', () => {
      document.querySelectorAll('.btn.toggle[data-hemi]').forEach(x => x.setAttribute('aria-pressed','false'));
      b.setAttribute('aria-pressed','true');
      state.hemisphere = b.dataset.hemi;
      buildTraj(); updateExp();
    })
  );
  document.querySelectorAll('.btn.scenario').forEach(b =>
    b.addEventListener('click', () => {
      document.querySelectorAll('.btn.scenario').forEach(x => x.setAttribute('aria-pressed','false'));
      b.setAttribute('aria-pressed','true');
      state.scenario = b.dataset.scenario;
      buildTraj(); updateExp();
    })
  );

  bindSlider('speedSlider',    'speedValue',    v => { state.speedMul = v; buildTraj(); });
  bindSlider('rotationSlider', 'rotationValue', v => { state.rotMul   = v; buildTraj(); });
  bindSlider('timeScaleSlider','timeScaleValue',v => { state.timeScale = v; });
  updateExp();
}

function bindSlider(id, outId, fn) {
  const el = document.getElementById(id), out = document.getElementById(outId);
  const run = () => { const v = parseFloat(el.value); out.textContent = v.toFixed(2); fn(v); };
  el.addEventListener('input', run); run();
}

// ─── Math helpers ─────────────────────────────────────────────────────────────

function v3(x,y,z) { return {x,y,z}; }

function latLon(phi, lam, r = EARTH_R) {
  return v3(r*Math.cos(phi)*Math.cos(lam), r*Math.sin(phi), r*Math.cos(phi)*Math.sin(lam));
}

function rotY(v, a) {
  const c=Math.cos(a),s=Math.sin(a);
  return v3(c*v.x+s*v.z, v.y, -s*v.x+c*v.z);
}
function rotX(v, a) {
  const c=Math.cos(a),s=Math.sin(a);
  return v3(v.x, c*v.y-s*v.z, s*v.y+c*v.z);
}

// Camera tilt so the selected hemisphere faces the viewer.
function tilt() { return state.hemisphere === 'N' ? Math.PI/5 : -Math.PI/5; }

// Globe surface transform (earth rotation + tilt).
function globeXform(pt, view) { return rotX(rotY(pt, view.earthAngle), tilt()); }

// Trajectory transform: earth-frame view rotates the trajectory with the globe;
// inertial-frame view only applies the camera tilt.
function trajXform(pt, view) {
  return view.trajWithGlobe ? globeXform(pt, view) : rotX(pt, tilt());
}

function toScreen(p, view) {
  return { sx: view.cx + p.x*view.scale, sy: view.cy - p.y*view.scale, z: p.z };
}

// ─── Physics: ball moves along lat/lon surface lines ─────────────────────────

function scenarioParams() {
  const hs  = state.hemisphere === 'N' ? 1 : -1;
  const LAM = Math.PI / 2;          // starting longitude (front-centre of tilted view)
  const rate = 0.18 * state.speedMul; // rad / physics-second

  switch (state.scenario) {
    case 'eq-to-pole':
      return { phi0: 0,                      lam0: LAM,
               dPhi: hs * rate,              dLam: 0 };
    case 'pole-to-eq':
      return { phi0: hs * (Math.PI/2 - 0.15), lam0: LAM,
               dPhi: -hs * rate,             dLam: 0 };
    case 'eastward':
      return { phi0: hs * Math.PI/6,         lam0: LAM,
               dPhi: 0,                      dLam: rate };
    case 'westward':
      return { phi0: hs * Math.PI/6,         lam0: LAM,
               dPhi: 0,                      dLam: -rate };
  }
}

function buildTraj() {
  state.elapsed = 0;
  traj.earth = []; traj.space = [];

  const { phi0, lam0, dPhi, dLam } = scenarioParams();
  const omega = OMEGA_B * state.rotMul;
  state.physDur = (45 * Math.PI / 180) / (Math.abs(dPhi) || Math.abs(dLam) || 0.01);

  const STEPS = 300;
  for (let i = 0; i <= STEPS; i++) {
    const t   = (i / STEPS) * state.physDur;
    const phi = phi0 + dPhi * t;
    const lam = lam0 + dLam * t;          // longitude in earth frame

    traj.earth.push(latLon(phi, lam));
    traj.space.push(latLon(phi, lam + omega * t)); // add earth's rotation → inertial lon
  }

  for (const v of allViews()) v.earthAngle = 0;
}

function allViews() { return [views.earth, views.space, views.earthFixed, views.spaceFixed]; }

// ─── Rendering ────────────────────────────────────────────────────────────────

function onResize() {
  for (const v of allViews()) {
    const r   = v.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    v.canvas.width  = Math.round(r.width  * dpr);
    v.canvas.height = Math.round(r.height * dpr);
    v.w = r.width; v.h = r.height;
    v.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    v.cx = r.width/2; v.cy = r.height/2;
    v.scale = Math.min(r.width, r.height) * 0.36;
  }
  stars = stars || Array.from({length:200}, () => ({
    x:Math.random(), y:Math.random(),
    r:Math.random()*1.2+0.2, a:Math.random()*0.6+0.2,
  }));
}

function drawBg(view) {
  const {ctx,w,h} = view;
  const g = ctx.createLinearGradient(0,0,0,h);
  g.addColorStop(0,COLORS.bg0); g.addColorStop(1,COLORS.bg1);
  ctx.fillStyle=g; ctx.fillRect(0,0,w,h);
  ctx.save();
  for (const s of stars) {
    ctx.globalAlpha=s.a; ctx.fillStyle='#fff';
    ctx.beginPath(); ctx.arc(s.x*w,s.y*h,s.r,0,Math.PI*2); ctx.fill();
  }
  ctx.restore();
}

function drawGlobe(view) {
  const {ctx,cx,cy,scale} = view;
  const g = ctx.createRadialGradient(cx-scale*.3,cy-scale*.3,scale*.1,cx,cy,scale);
  g.addColorStop(0,'#3472d4'); g.addColorStop(.6,COLORS.ocean); g.addColorStop(1,COLORS.oceanEdge);
  ctx.beginPath(); ctx.arc(cx,cy,scale,0,Math.PI*2);
  ctx.fillStyle=g; ctx.fill();
  ctx.lineWidth=1.5; ctx.strokeStyle='rgba(120,170,255,0.3)'; ctx.stroke();

  ctx.strokeStyle=COLORS.grid; ctx.lineWidth=0.8;
  for (const latD of [-60,-30,0,30,60]) drawLatCircle(view, latD*Math.PI/180);
  for (let lonD=0; lonD<360; lonD+=30) drawMeridian(view, lonD*Math.PI/180);

  // Equator highlight
  ctx.strokeStyle=COLORS.equator; ctx.lineWidth=1.4; ctx.globalAlpha=0.7;
  drawLatCircle(view, 0); ctx.globalAlpha=1;

  // Axis
  const tp=toScreen(globeXform(v3(0,1.22,0),view),view);
  const bp=toScreen(globeXform(v3(0,-1.22,0),view),view);
  ctx.strokeStyle=COLORS.axis; ctx.lineWidth=1; ctx.globalAlpha=0.55;
  ctx.beginPath(); ctx.moveTo(tp.sx,tp.sy); ctx.lineTo(bp.sx,bp.sy); ctx.stroke();
  ctx.globalAlpha=1;
}

function drawLatCircle(view, phi) {
  const {ctx} = view;
  ctx.beginPath(); let pen=false;
  for (let i=0; i<=90; i++) {
    const lam = (i/90)*Math.PI*2;
    const t = globeXform(latLon(phi,lam,EARTH_R*1.001),view);
    if (t.z<0) { pen=false; continue; }
    const p=toScreen(t,view);
    if (!pen) { ctx.moveTo(p.sx,p.sy); pen=true; } else ctx.lineTo(p.sx,p.sy);
  }
  ctx.stroke();
}

function drawMeridian(view, lam) {
  const {ctx} = view;
  ctx.beginPath(); let pen=false;
  for (let i=0; i<=60; i++) {
    const phi=-Math.PI/2+(i/60)*Math.PI;
    const t=globeXform(latLon(phi,lam,EARTH_R*1.001),view);
    if (t.z<0) { pen=false; continue; }
    const p=toScreen(t,view);
    if (!pen) { ctx.moveTo(p.sx,p.sy); pen=true; } else ctx.lineTo(p.sx,p.sy);
  }
  ctx.stroke();
}

function drawTrail(view, pts, color, alpha) {
  if (pts.length<2) return;
  const {ctx}=view;
  ctx.save(); ctx.lineWidth=2.5; ctx.lineCap='round'; ctx.lineJoin='round';
  // Back pass (faded)
  ctx.beginPath(); let pen=false;
  for (const pt of pts) {
    const t=trajXform(pt,view); if (t.z>=0){pen=false;continue;}
    const p=toScreen(t,view);
    if(!pen){ctx.moveTo(p.sx,p.sy);pen=true;}else ctx.lineTo(p.sx,p.sy);
  }
  ctx.globalAlpha=alpha*0.22; ctx.strokeStyle=color; ctx.stroke();
  // Front pass
  ctx.beginPath(); pen=false;
  for (const pt of pts) {
    const t=trajXform(pt,view); if(t.z<0){pen=false;continue;}
    const p=toScreen(t,view);
    if(!pen){ctx.moveTo(p.sx,p.sy);pen=true;}else ctx.lineTo(p.sx,p.sy);
  }
  ctx.globalAlpha=alpha; ctx.strokeStyle=color; ctx.stroke();
  ctx.restore();
}

function drawDot(view, pt, color, r, label) {
  const t=trajXform(pt,view), p=toScreen(t,view), {ctx}=view;
  ctx.save();
  ctx.globalAlpha = t.z<0 ? 0.25 : 1;
  ctx.fillStyle=color; ctx.beginPath(); ctx.arc(p.sx,p.sy,r,0,Math.PI*2); ctx.fill();
  if (label && t.z>=0) {
    ctx.fillStyle='#e8ecff'; ctx.font='11px system-ui,sans-serif';
    ctx.fillText(label, p.sx+r+3, p.sy-3);
  }
  ctx.restore();
}

function renderView(view, trajPts, fullPts, color, ballPt) {
  const {ctx,w,h,cx,cy,scale}=view;
  ctx.clearRect(0,0,w,h);
  drawBg(view);

  // Offset so ball stays near screen centre
  const bt=trajXform(ballPt,view);
  const dx=cx-(cx+bt.x*scale), dy=cy-(cy-bt.y*scale);
  ctx.save(); ctx.translate(dx,dy);

  drawGlobe(view);
  drawTrail(view, fullPts,  color, 0.28);
  drawTrail(view, trajPts,  color, 1.0);
  drawDot(view, fullPts[0],                color===COLORS.trailE ? COLORS.start : COLORS.start, 5, '시작');
  drawDot(view, fullPts[fullPts.length-1], color===COLORS.trailE ? COLORS.end   : COLORS.end,   5, '끝');
  drawDot(view, ballPt, COLORS.ball, 5);

  ctx.restore();
}

// ─── Animation loop ───────────────────────────────────────────────────────────

let lastT = performance.now();

function loop(now) {
  const dt = Math.min(0.05,(now-lastT)/1000);
  lastT = now;

  if (state.running) {
    state.elapsed += dt * state.timeScale;
    if (state.elapsed >= ANIM_DUR) { state.elapsed = ANIM_DUR; state.running = false; }
  }

  const frac  = Math.min(1, state.elapsed / ANIM_DUR);
  const nE    = Math.max(1, Math.round(frac * (traj.earth.length-1)));
  const nS    = Math.max(1, Math.round(frac * (traj.space.length-1)));
  const physT = frac * state.physDur;
  const omega = OMEGA_B * state.rotMul;

  const ef=traj.earth, sf=traj.space;
  if (!ef.length||!sf.length) { requestAnimationFrame(loop); return; }

  // Rotating views: globe spins
  views.earth.earthAngle      = omega * physT;
  views.space.earthAngle      = omega * physT;
  // Fixed views: globe stays put
  views.earthFixed.earthAngle = 0;
  views.spaceFixed.earthAngle = 0;

  // Earth-frame trajectory: traj.earth (lat/lon lines, Coriolis-free path on globe)
  // Space-frame trajectory: traj.space (inertial = earth-frame lon + earth rotation)
  renderView(views.earth,      ef.slice(0,nE+1), ef, COLORS.trailE, ef[nE]);
  renderView(views.space,      sf.slice(0,nS+1), sf, COLORS.trailS, sf[nS]);
  renderView(views.earthFixed, ef.slice(0,nE+1), ef, COLORS.trailE, ef[nE]);
  renderView(views.spaceFixed, sf.slice(0,nS+1), sf, COLORS.trailS, sf[nS]);

  requestAnimationFrame(loop);
}

// ─── Explanation ──────────────────────────────────────────────────────────────

function updateExp() {
  const hs = state.hemisphere==='N' ? '북반구' : '남반구';
  const d  = state.hemisphere==='N' ? '오른쪽' : '왼쪽';
  const map = {
    'eq-to-pole': `${hs}: 적도에서 극으로 경도선을 따라 이동합니다. 지구 고정 시점(아래 왼쪽)에서는 경도선을 직선으로 따라가지만, 우주 고정 시점(아래 오른쪽)에서는 지구 자전이 더해져 나선형으로 보입니다.`,
    'pole-to-eq': `${hs}: 극에서 적도 방향으로 경도선을 따라 이동합니다. 지구 고정(아래 왼쪽) = 직선, 우주 고정(아래 오른쪽) = 나선.`,
    'eastward':   `${hs}: 위도선을 따라 동쪽으로 이동합니다. 지구 고정(아래 왼쪽) = 위도선 원, 우주 고정(아래 오른쪽) = 지구 자전 속도가 더해진 더 빠른 원.`,
    'westward':   `${hs}: 위도선을 따라 서쪽으로 이동합니다. 지구 고정(아래 왼쪽) = 위도선 원, 우주 고정(아래 오른쪽) = 지구 자전 속도가 일부 상쇄된 원.`,
  };
  ui.exp.textContent = map[state.scenario] || '';
}
