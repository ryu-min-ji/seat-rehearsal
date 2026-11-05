import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { StageManager, TYPES } from './stage.js';
import { computeVisibility, summarize, gradeOf, GRADES } from './visibility.js';

const viewer = document.getElementById('viewer');
const tooltip = document.getElementById('tooltip');

// 높이 구간 (공연장 층 느낌으로 나눔)
const TIERS = [
  { name: '아래층 (0–5m)', max: 5, color: '#4f9dde' },
  { name: '중간층 (5–9m)', max: 9, color: '#7c6fd6' },
  { name: '위층 (9m 이상)', max: Infinity, color: '#d98b4a' },
];

const scene = new THREE.Scene();
scene.background = new THREE.Color('#14161c');

const camera = new THREE.PerspectiveCamera(45, 1, 0.5, 2000);
camera.position.set(0, 95, 110);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
viewer.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 5, 0);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI * 0.49;
controls.minDistance = 10;
controls.maxDistance = 300;

scene.add(new THREE.HemisphereLight('#ffffff', '#30343f', 1.1));
const sun = new THREE.DirectionalLight('#ffffff', 0.9);
sun.position.set(40, 120, 60);
scene.add(sun);

// 플로어 (공연 때 무대·플로어석이 들어가는 바닥)
const floor = new THREE.Mesh(
  new THREE.CircleGeometry(40, 96),
  new THREE.MeshStandardMaterial({ color: '#23262e', roughness: 1 })
);
floor.rotation.x = -Math.PI / 2;
scene.add(floor);
const grid = new THREE.PolarGridHelper(40, 16, 8, 96, '#333845', '#2a2e38');
grid.position.y = 0.01;
scene.add(grid);

function resize() {
  const w = viewer.clientWidth, h = viewer.clientHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  // 처음 한 번: 세로로 긴 화면(모바일)이면 카메라를 뒤로 빼서 공연장 전체가 보이게
  if (!framed && w > 0) {
    const k = camera.aspect < 1 ? Math.min(2.2, 1 / camera.aspect) : 1;
    camera.position.set(0, 95 * k, 110 * k);
    framed = true;
  }
}
let framed = false;
new ResizeObserver(resize).observe(viewer);

let seatMesh, seats = [];
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let hovered = -1;
const highlight = new THREE.Color('#ffffff');
window.__app = { get stage() { return stage; }, get vis() { return vis; } };

async function load() {
  const res = await fetch('data/kspodome_seats.json');
  const data = await res.json();
  // 데이터는 Z-up(미터) → three.js Y-up 으로 변환: (x, y, z) → (x, z, -y)
  seats = data.seats.map(([x, y, z]) => new THREE.Vector3(x, z, -y));

  const geo = new THREE.BoxGeometry(0.45, 0.4, 0.45);
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.7 });
  seatMesh = new THREE.InstancedMesh(geo, mat, seats.length);
  const m = new THREE.Matrix4();
  const counts = TIERS.map(() => 0);
  let maxH = 0;
  seats.forEach((p, i) => {
    m.makeTranslation(p.x, p.y, p.z);
    seatMesh.setMatrixAt(i, m);
    const t = TIERS.findIndex((tier) => p.y < tier.max);
    counts[t]++;
    seatMesh.setColorAt(i, new THREE.Color(TIERS[t].color));
    maxH = Math.max(maxH, p.y);
  });
  seatMesh.instanceColor.needsUpdate = true;
  scene.add(seatMesh);

  document.getElementById('seatCount').textContent = seats.length.toLocaleString('ko-KR') + '석';
  document.getElementById('maxHeight').textContent = maxH.toFixed(1) + 'm';
  document.getElementById('legend').innerHTML = TIERS.map(
    (t, i) => `<li><span class="sw" style="background:${t.color}"></span>${t.name}<span class="n">${counts[i].toLocaleString('ko-KR')}석</span></li>`
  ).join('');
  document.getElementById('loading').remove();
  recompute();
}

// ---------- 시야 계산 ----------
let vis = null;          // Float32Array: 좌석별 가시율
let colorMode = 'vis';   // 'vis' | 'tier'

function seatColor(i) {
  if (colorMode === 'vis' && vis) return new THREE.Color(gradeOf(vis[i]).color);
  return new THREE.Color(TIERS[TIERS.findIndex((t) => seats[i].y < t.max)].color);
}

function repaint() {
  if (!seatMesh) return;
  for (let i = 0; i < seats.length; i++) seatMesh.setColorAt(i, i === hovered ? highlight : seatColor(i));
  seatMesh.instanceColor.needsUpdate = true;
}

function renderReport() {
  if (!vis) {
    $('headline').textContent = '무대를 하나 이상 놓으면 시야를 계산해요.';
    $('bar').innerHTML = ''; $('gradeList').innerHTML = '';
    return;
  }
  const c = summarize(vis);
  const n = seats.length;
  const limited = c.limited + c.blocked;
  const behind = c.behind ? `<br><span class="sub">무대 뒤 사석 ${c.behind.toLocaleString('ko-KR')}석은 따로 뺐어요.</span>` : '';
  $('headline').innerHTML = `이 무대 배치에서는<br><strong>${limited.toLocaleString('ko-KR')}석</strong>을 시야제한석 이하로 팔아야 해요.${behind}`;
  $('bar').innerHTML = GRADES.map((g) => `<span style="width:${(c[g.key] / n) * 100}%;background:${g.color}" title="${g.label}"></span>`).join('');
  if (seatView) showSeatCard(seatView.id);
  $('gradeList').innerHTML = GRADES.map((g) =>
    `<li><span class="sw" style="background:${g.color}"></span>${g.label}<span class="n">${c[g.key].toLocaleString('ko-KR')}석 · ${Math.round((c[g.key] / n) * 100)}%</span></li>`
  ).join('');
}

let lastCalc = 0, pending = null;
function recompute() {
  if (!seats.length) return;
  // 끄는 동안에는 너무 자주 계산하지 않게 (최대 초당 8번)
  const now = performance.now();
  clearTimeout(pending);
  if (now - lastCalc < 120) { pending = setTimeout(recompute, 120); return; }
  lastCalc = now;
  vis = computeVisibility(seats, stage.boxes());
  repaint();
  renderReport();
}

// ---------- 무대 · 구조물 ----------
const stage = new StageManager(scene);
const $ = (id) => document.getElementById(id);
const fmt = (v) => (Math.round(v * 10) / 10).toString() + 'm';

stage.onChange = () => {
  recompute();
  placePerformers();
  const s = stage.selected;
  $('selected').hidden = !s;
  if (s) {
    $('selName').textContent = TYPES[s.type].label;
    $('selDot').style.background = TYPES[s.type].color;
    const wide = Math.max(s.w, s.d);
    $('wIn').value = wide; $('wOut').textContent = fmt(wide);
    $('hIn').value = s.h; $('hOut').textContent = fmt(s.h);
  }
  $('objList').innerHTML = stage.items.map((i) =>
    `<li data-id="${i.id}" class="${i === s ? 'on' : ''}"><span class="dot" style="background:${TYPES[i.type].color}"></span>${TYPES[i.type].label}<span class="meta">${fmt(Math.max(i.w, i.d))} × 높이 ${fmt(i.h)}</span></li>`
  ).join('');
};

$('presets').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  $('presets').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
  stage.loadPreset(b.dataset.preset);
});
$('colorMode').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  $('colorMode').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
  colorMode = b.dataset.mode;
  repaint();
});
$('addLed').onclick = () => stage.addNew('led');
$('addTower').onclick = () => stage.addNew('tower');
$('rotBtn').onclick = () => stage.selected && stage.rotate(stage.selected);
$('delBtn').onclick = () => stage.selected && stage.remove(stage.selected);
$('wIn').oninput = (e) => {
  const s = stage.selected; if (!s) return;
  const v = +e.target.value;
  // 긴 쪽을 '폭'으로 조절
  stage.update(s, s.w >= s.d ? { w: v } : { d: v });
};
$('hIn').oninput = (e) => stage.selected && stage.update(stage.selected, { h: +e.target.value });
$('objList').addEventListener('click', (e) => {
  const li = e.target.closest('li'); if (!li) return;
  stage.select(stage.items.find((i) => i.id === +li.dataset.id));
});

// 끌어서 옮기기: 바닥 평면 위로 이동
const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
let drag = null; // { item, offset }
const tmp = new THREE.Vector3();

function setPointer(e) {
  const r = renderer.domElement.getBoundingClientRect();
  pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  return r;
}

// ---------- 공연자 (크기 감을 위한 사람 모형) ----------
const performers = new THREE.Group();
{
  const geo = new THREE.CapsuleGeometry(0.28, 1.1, 4, 8);
  const mat = new THREE.MeshStandardMaterial({ color: '#f8fafc', emissive: '#334155' });
  [-2.5, 0, 2.5].forEach((off) => {
    const p = new THREE.Mesh(geo, mat);
    p.position.set(0, 0.83, off);
    performers.add(p);
  });
}
scene.add(performers);
function placePerformers() {
  const main = stage.items.find((i) => i.type === 'stage');
  performers.visible = !!main;
  if (!main) return;
  performers.position.set(main.x, main.h, main.z);
  // 무대가 바라보는 방향에 맞춰 옆으로 늘어서게
  const f = main.facing || [1, 0];
  performers.rotation.y = Math.atan2(-f[1], f[0]);
}

// ---------- 내 자리에서 보기 ----------
let seatView = null; // { id, eye, yaw, pitch }
let tween = null;    // { from, to, fromT, toT, t0 }
let down = null;     // { x, y, look } 클릭 · 둘러보기 판정용
const homeView = { pos: new THREE.Vector3(), target: new THREE.Vector3() };

function mainStageLookPoint() {
  const main = stage.items.find((i) => i.type === 'stage');
  return main ? new THREE.Vector3(main.x, main.h + 1.6, main.z) : new THREE.Vector3(0, 2, 0);
}

function enterSeatView(id) {
  const s = seats[id];
  const eye = new THREE.Vector3(s.x, s.y + 0.9, s.z);
  const look = mainStageLookPoint();
  const dir = look.clone().sub(eye).normalize();
  if (!seatView) { homeView.pos.copy(camera.position); homeView.target.copy(controls.target); }
  seatView = { id, eye, yaw: Math.atan2(dir.x, dir.z), pitch: Math.asin(dir.y) };
  controls.enabled = false;
  tooltip.hidden = true;
  tween = { from: camera.position.clone(), to: eye, fromT: controls.target.clone(), toT: look, t0: performance.now() };
  camera.fov = 55; camera.updateProjectionMatrix();
  showSeatCard(id);
  viewer.classList.add('seat-mode');
}

function exitSeatView() {
  if (!seatView) return;
  seatView = null;
  tween = { from: camera.position.clone(), to: homeView.pos.clone(), fromT: lookTarget(), toT: homeView.target.clone(), t0: performance.now(), done: () => { controls.enabled = true; } };
  camera.fov = 45; camera.updateProjectionMatrix();
  $('seatCard').hidden = true;
  viewer.classList.remove('seat-mode');
}

function lookTarget() {
  if (!seatView) return controls.target.clone();
  const { yaw, pitch, eye } = seatView;
  return eye.clone().add(new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)));
}

function showSeatCard(id) {
  const v = vis ? vis[id] : null;
  const g = v === null ? null : gradeOf(v);
  $('scTitle').textContent = `좌석 #${id + 1}`;
  $('scGrade').textContent = g ? g.label : '';
  $('scGrade').style.background = g ? g.color : 'transparent';
  $('scDesc').textContent = v === null ? '무대를 놓으면 시야를 계산해요.'
    : v < 0 ? '무대 뒤쪽이라 공연자 정면이 보이지 않는 자리예요.'
    : `이 자리에서는 무대가 ${Math.round(v * 100)}% 보여요. 높이 ${seats[id].y.toFixed(1)}m · 무대까지 ${mainStageLookPoint().distanceTo(seatView.eye).toFixed(0)}m`;
  $('seatCard').hidden = false;
}

$('scBack').onclick = exitSeatView;
stage.loadPreset('end'); // 공연자 모형까지 준비된 뒤에 기본 무대 배치
window.addEventListener('keydown', (e) => { if (e.key === 'Escape') exitSeatView(); });

renderer.domElement.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  down = { x: e.clientX, y: e.clientY, yaw: seatView?.yaw, pitch: seatView?.pitch };
  if (seatView) return; // 내 자리 보기 중에는 구조물을 옮기지 않음
  setPointer(e);
  const hit = raycaster.intersectObjects(stage.meshes(), false)[0];
  if (hit) {
    const item = hit.object.userData.item;
    stage.select(item);
    raycaster.ray.intersectPlane(floorPlane, tmp);
    drag = { item, dx: item.x - tmp.x, dz: item.z - tmp.z };
    controls.enabled = false;
    renderer.domElement.setPointerCapture(e.pointerId);
  }
});
renderer.domElement.addEventListener('pointerup', (e) => {
  const clicked = down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 6;
  down = null;
  if (drag) {
    drag = null;
    controls.enabled = true;
    renderer.domElement.releasePointerCapture(e.pointerId);
    return;
  }
  // 좌석을 '클릭'(거의 안 움직이고 뗌)하면 그 자리 시점으로
  if (clicked && seatMesh && e.button === 0) {
    setPointer(e);
    const hit = raycaster.intersectObject(seatMesh)[0];
    if (hit && (!seatView || hit.instanceId !== seatView.id)) enterSeatView(hit.instanceId);
  }
});

renderer.domElement.addEventListener('pointermove', (e) => {
  if (seatView) {
    // 내 자리 보기: 드래그로 고개 돌리기
    if (down && down.yaw !== undefined && !tween) {
      seatView.yaw = down.yaw - (e.clientX - down.x) * 0.004;
      seatView.pitch = THREE.MathUtils.clamp(down.pitch + (e.clientY - down.y) * 0.004, -1.2, 1.2);
    }
    return;
  }
  const r = setPointer(e);
  if (drag) {
    if (raycaster.ray.intersectPlane(floorPlane, tmp)) {
      stage.update(drag.item, { x: tmp.x + drag.dx, z: tmp.z + drag.dz });
    }
    tooltip.hidden = true;
    return;
  }
  if (!seatMesh) return;
  const hit = raycaster.intersectObject(seatMesh)[0];
  const id = hit ? hit.instanceId : -1;
  if (id !== hovered) {
    if (hovered >= 0) seatMesh.setColorAt(hovered, seatColor(hovered));
    if (id >= 0) seatMesh.setColorAt(id, highlight);
    seatMesh.instanceColor.needsUpdate = true;
    hovered = id;
  }
  if (id >= 0) {
    const p = seats[id];
    const dist = Math.hypot(p.x, p.z);
    tooltip.hidden = false;
    tooltip.style.left = e.clientX - r.left + 'px';
    tooltip.style.top = e.clientY - r.top + 'px';
    const v = !vis ? '' : vis[id] < 0 ? ' · 무대 뒤 (사석)' : ` · 무대 ${Math.round(vis[id] * 100)}% 보임 (${gradeOf(vis[id]).label})`;
    tooltip.textContent = `좌석 #${id + 1} · 높이 ${p.y.toFixed(1)}m${v}`;
    // 화면 오른쪽 끝에서는 말풍선을 왼쪽으로 뒤집기
    const flip = e.clientX - r.left + tooltip.offsetWidth + 16 > r.width;
    tooltip.style.transform = flip ? 'translate(calc(-100% - 12px), -50%)' : 'translate(12px, -50%)';
  } else {
    tooltip.hidden = true;
  }
});
renderer.domElement.addEventListener('pointerleave', () => (tooltip.hidden = true));

const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
renderer.setAnimationLoop(() => {
  if (tween) {
    const t = Math.min(1, (performance.now() - tween.t0) / 700);
    const k = ease(t);
    camera.position.lerpVectors(tween.from, tween.to, k);
    const tgt = new THREE.Vector3().lerpVectors(tween.fromT, tween.toT, k);
    camera.lookAt(tgt);
    if (t >= 1) {
      if (!seatView) controls.target.copy(tween.toT);
      tween.done?.();
      tween = null;
    }
  } else if (seatView) {
    camera.position.copy(seatView.eye);
    camera.lookAt(lookTarget());
  } else {
    controls.update();
  }
  renderer.render(scene, camera);
});

load().catch((err) => {
  document.getElementById('loading').textContent = '좌석 데이터를 불러오지 못했어요: ' + err.message;
});
