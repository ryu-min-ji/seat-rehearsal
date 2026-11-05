import * as THREE from 'three';

// 구조물 종류: 무대(관객이 보려는 대상) / LED 벽 · 스피커 타워(시야를 가릴 수 있는 것)
export const TYPES = {
  stage: { label: '무대', color: '#3b82f6', opacity: 0.75 },
  runway: { label: '돌출 무대', color: '#60a5fa', opacity: 0.75 },
  led: { label: 'LED 벽', color: '#e879f9', opacity: 0.95 },
  tower: { label: '스피커 타워', color: '#facc15', opacity: 0.95 },
};

// 좌표: 미터, 공연장 중앙(0,0), x = 동서, z = 남북. w = x방향 폭, d = z방향 깊이, h = 높이
// 엔드 무대는 서쪽(x < 0) 끝에 두고 동쪽(+x)을 바라본다.
// facing = 무대가 바라보는 방향 [x, z]. 없으면(센터 · 돌출) 사방에서 보는 무대
export const PRESETS = {
  end: [
    { type: 'stage', x: -34.5, z: 0, w: 10, d: 27, h: 1.8, facing: [1, 0] },
    { type: 'led', x: -40.5, z: 0, w: 2, d: 31, h: 12 },
    { type: 'tower', x: -32, z: -17, w: 4, d: 4, h: 14 },
    { type: 'tower', x: -32, z: 17, w: 4, d: 4, h: 14 },
  ],
  center: [
    { type: 'stage', x: 0, z: 0, w: 16, d: 16, h: 1.8 },
    { type: 'tower', x: -12, z: -12, w: 3, d: 3, h: 12 },
    { type: 'tower', x: 12, z: -12, w: 3, d: 3, h: 12 },
    { type: 'tower', x: -12, z: 12, w: 3, d: 3, h: 12 },
    { type: 'tower', x: 12, z: 12, w: 3, d: 3, h: 12 },
  ],
  thrust: [
    { type: 'stage', x: -34.5, z: 0, w: 10, d: 27, h: 1.8, facing: [1, 0] },
    { type: 'runway', x: -14.5, z: 0, w: 30, d: 3, h: 1.5 },
    { type: 'runway', x: 4, z: 0, w: 8, d: 8, h: 1.5 },
    { type: 'led', x: -40.5, z: 0, w: 2, d: 31, h: 12 },
    { type: 'tower', x: -32, z: -17, w: 4, d: 4, h: 14 },
    { type: 'tower', x: -32, z: 17, w: 4, d: 4, h: 14 },
  ],
};

const FLOOR_R = 40;
const unitBox = new THREE.BoxGeometry(1, 1, 1);
const unitEdges = new THREE.EdgesGeometry(unitBox);

export class StageManager {
  constructor(scene) {
    this.group = new THREE.Group();
    scene.add(this.group);
    this.items = []; // { id, type, x, z, w, d, h, mesh }
    this.selected = null;
    this.nextId = 1;
    this.onChange = () => {};
  }

  clear() {
    this.items.forEach((it) => { this.group.remove(it.mesh); if (it.arrow) this.group.remove(it.arrow); });
    this.items = [];
    this.selected = null;
  }

  loadPreset(name) {
    this.clear();
    PRESETS[name].forEach((o) => this.add(o, false));
    this.onChange();
  }

  add(o, notify = true) {
    const t = TYPES[o.type];
    const mat = new THREE.MeshStandardMaterial({
      color: t.color, transparent: t.opacity < 1, opacity: t.opacity, roughness: 0.6,
    });
    const mesh = new THREE.Mesh(unitBox, mat);
    const edges = new THREE.LineSegments(unitEdges, new THREE.LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.35 }));
    mesh.add(edges);
    const item = { id: this.nextId++, ...o, mesh };
    mesh.userData.item = item;
    this.group.add(mesh);
    if (item.facing) {
      // 무대 앞쪽을 알려 주는 화살표
      item.arrow = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(), 8, '#ffffff', 3, 2.4);
      this.group.add(item.arrow);
    }
    this.items.push(item);
    this.sync(item);
    if (notify) { this.select(item); this.onChange(); }
    return item;
  }

  addNew(type) {
    const base = type === 'led'
      ? { type, x: -20, z: 0, w: 2, d: 12, h: 8 }
      : { type, x: -20, z: 0, w: 3, d: 3, h: 12 };
    return this.add(base);
  }

  sync(item) {
    item.mesh.scale.set(item.w, item.h, item.d);
    item.mesh.position.set(item.x, item.h / 2, item.z);
    if (item.arrow) {
      const [fx, fz] = item.facing;
      const half = Math.abs(fx) * item.w / 2 + Math.abs(fz) * item.d / 2;
      item.arrow.position.set(item.x + fx * (half - 6), item.h + 0.3, item.z + fz * (half - 6));
      item.arrow.setDirection(new THREE.Vector3(fx, 0, fz));
    }
  }

  select(item) {
    if (this.selected) this.selected.mesh.material.emissive.set('#000000');
    this.selected = item;
    if (item) item.mesh.material.emissive.set('#553300');
    this.onChange();
  }

  update(item, patch) {
    Object.assign(item, patch);
    // 바닥(플로어) 밖으로 나가지 않게
    const r = Math.hypot(item.x, item.z);
    if (r > FLOOR_R) { item.x *= FLOOR_R / r; item.z *= FLOOR_R / r; }
    this.sync(item);
    this.onChange();
  }

  // 90° 회전: 크기를 맞바꾸고, 무대라면 바라보는 방향도 같이 돌린다
  rotate(item) {
    const patch = { w: item.d, d: item.w };
    if (item.facing) patch.facing = [-item.facing[1], item.facing[0]];
    this.update(item, patch);
  }

  remove(item) {
    this.group.remove(item.mesh);
    if (item.arrow) this.group.remove(item.arrow);
    this.items = this.items.filter((i) => i !== item);
    if (this.selected === item) this.selected = null;
    this.onChange();
  }

  meshes() { return this.items.map((i) => i.mesh); }

  // 3단계(시야 계산)에서 쓰는 데이터: 축 정렬 박스 목록
  boxes() {
    return this.items.map((i) => ({
      type: i.type,
      facing: i.facing || null,
      center: [i.x, i.z],
      min: [i.x - i.w / 2, 0, i.z - i.d / 2],
      max: [i.x + i.w / 2, i.h, i.z + i.d / 2],
    }));
  }
}
