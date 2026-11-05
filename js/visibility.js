// 좌석별 무대 가시율 계산
// 방법: 좌석 눈높이에서 무대 위 '공연자 머리 높이' 지점들로 선을 긋고,
//       LED 벽 · 스피커 타워 상자에 막히지 않는 선의 비율 = 가시율(0~1)

export const EYE_HEIGHT = 0.9;      // 좌석 중심에서 앉은 눈높이까지 (m)
export const PERFORMER_HEAD = 1.6;  // 무대 바닥에서 공연자 머리까지 (m)
const SPACING = 3;                  // 무대 위 목표 지점 간격 (m)

export const GRADES = [
  { key: 'good', label: '잘 보임', min: 0.8, color: '#22c55e' },
  { key: 'partial', label: '일부 가림', min: 0.5, color: '#eab308' },
  { key: 'limited', label: '시야제한석 권장', min: 0.1, color: '#f97316' },
  { key: 'blocked', label: '판매 비권장', min: 0, color: '#ef4444' },
  { key: 'behind', label: '무대 뒤 (사석)', min: -Infinity, color: '#4b5563' },
];
export const BEHIND = -1; // 가시율 대신 넣는 표시값: 무대 뒤라서 원래 팔지 않는 자리
export const gradeOf = (v) => GRADES.find((g) => v >= g.min);

// 무대 · 돌출 무대 윗면에 목표 지점 깔기
export function stageTargets(boxes) {
  const pts = [];
  for (const b of boxes) {
    if (b.type !== 'stage' && b.type !== 'runway') continue;
    const [x0, , z0] = b.min, [x1, h, z1] = b.max;
    const nx = Math.max(2, Math.round((x1 - x0) / SPACING) + 1);
    const nz = Math.max(2, Math.round((z1 - z0) / SPACING) + 1);
    for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
      pts.push([
        x0 + 0.5 + ((x1 - x0 - 1) * i) / (nx - 1),
        h + PERFORMER_HEAD,
        z0 + 0.5 + ((z1 - z0 - 1) * j) / (nz - 1),
      ]);
    }
  }
  return pts;
}

// 선분(p → q)이 상자를 지나가는지 (slab 방식)
function segHitsBox(px, py, pz, dx, dy, dz, b) {
  let t0 = 0, t1 = 1;
  const p = [px, py, pz], d = [dx, dy, dz];
  for (let a = 0; a < 3; a++) {
    const lo = b.min[a], hi = b.max[a];
    if (Math.abs(d[a]) < 1e-9) {
      if (p[a] < lo || p[a] > hi) return false;
    } else {
      let ta = (lo - p[a]) / d[a], tb = (hi - p[a]) / d[a];
      if (ta > tb) { const s = ta; ta = tb; tb = s; }
      if (ta > t0) t0 = ta;
      if (tb < t1) t1 = tb;
      if (t0 > t1) return false;
    }
  }
  return true;
}

/**
 * @param seats  [{x,y,z}] three.js 좌표 (y = 높이)
 * @param boxes  StageManager.boxes()
 * @returns Float32Array 가시율 (무대가 없으면 null)
 */
export function computeVisibility(seats, boxes) {
  const targets = stageTargets(boxes);
  if (!targets.length) return null;
  const obstacles = boxes.filter((b) => b.type === 'led' || b.type === 'tower');
  // 방향이 있는 무대(엔드 무대): 무대 뒷면보다 뒤에 있는 좌석 = 사석
  const facingStages = boxes.filter((b) => b.facing).map((b) => {
    const [fx, fz] = b.facing;
    const w = b.max[0] - b.min[0], d = b.max[2] - b.min[2];
    return { fx, fz, cx: b.center[0], cz: b.center[1], half: Math.abs(fx) * w / 2 + Math.abs(fz) * d / 2 };
  });
  const vis = new Float32Array(seats.length);
  for (let i = 0; i < seats.length; i++) {
    const s = seats[i];
    if (facingStages.some((f) => (s.x - f.cx) * f.fx + (s.z - f.cz) * f.fz < -f.half)) {
      vis[i] = BEHIND;
      continue;
    }
    const ex = s.x, ey = s.y + EYE_HEIGHT, ez = s.z;
    // 좌석과 가까운 장애물만 미리 골라 두면 더 빠르지만, 지금 규모(약 9천 석 × 수십 지점)는 그대로도 충분
    let seen = 0;
    for (const t of targets) {
      const dx = t[0] - ex, dy = t[1] - ey, dz = t[2] - ez;
      let blocked = false;
      for (const b of obstacles) {
        if (segHitsBox(ex, ey, ez, dx, dy, dz, b)) { blocked = true; break; }
      }
      if (!blocked) seen++;
    }
    vis[i] = seen / targets.length;
  }
  return vis;
}

export function summarize(vis) {
  const counts = Object.fromEntries(GRADES.map((g) => [g.key, 0]));
  for (const v of vis) counts[gradeOf(v).key]++;
  return counts;
}
