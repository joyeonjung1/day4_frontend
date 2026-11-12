// 3D 지도 — three.js
//  · 시·도 경계(korea-provinces.geo.json)를 입체로 세우고, 높이·색 = 미세먼지(PM10) 등급
//  · 주요 도시마다 PM10 막대 + 값 라벨
//  · 드래그=회전, 휠=확대/축소, 우클릭 드래그=이동, 클릭=그 지점의 날씨·미세먼지 (weather.js 의 WeatherCard)
// 미세먼지 값은 Open-Meteo 대기질 API(키 없음, 모델 추정값)입니다.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// ─────────────── 좌표 변환: 경도·위도 → 3D 평면 (북쪽 = -z) ───────────────
const K = 10;                                        // 1도 = 10 단위
const LNG0 = 127.8, LAT0 = 36.2;
const COS = Math.cos((LAT0 * Math.PI) / 180);
const proj = (lng, lat) => [(lng - LNG0) * COS * K, (lat - LAT0) * K];
const unproj = (x, z) => [LNG0 + x / (COS * K), LAT0 - z / K];

// 시·도 코드 → [짧은 이름, 대표 지점(도청 소재지) 위도, 경도]
const PROV = {
  11: ['서울', 37.5665, 126.9780], 21: ['부산', 35.1796, 129.0756], 22: ['대구', 35.8714, 128.6014],
  23: ['인천', 37.4563, 126.7052], 24: ['광주', 35.1595, 126.8526], 25: ['대전', 36.3504, 127.3845],
  26: ['울산', 35.5384, 129.3114], 29: ['세종', 36.4800, 127.2890], 31: ['경기', 37.2636, 127.0286],
  32: ['강원', 37.8813, 127.7298], 33: ['충북', 36.6424, 127.4890], 34: ['충남', 36.6600, 126.6700],
  35: ['전북', 35.8242, 127.1480], 36: ['전남', 34.8160, 126.4630], 37: ['경북', 36.5760, 128.5056],
  38: ['경남', 35.2280, 128.6811], 39: ['제주', 33.4996, 126.5312],
};

// 막대를 세울 도시 (전부 세우면 요청 수가 많아져 Open-Meteo 분당 제한에 걸립니다)
const BAR_CITIES = new Set(['서울', '부산', '대구', '인천', '광주', '대전', '울산', '세종', '수원', '춘천', '원주', '강릉', '속초',
  '청주', '천안', '전주', '목포', '여수', '포항', '안동', '창원', '진주', '제주', '서귀포', '울릉도', '독도']);

const COLORS = { 좋음: 0x3b8cff, 보통: 0x2ecc71, 나쁨: 0xffa33a, 매우나쁨: 0xff4d4d, none: 0x8fa3b8 };
const CSS = { 좋음: '#3b8cff', 보통: '#2ecc71', 나쁨: '#ffa33a', 매우나쁨: '#ff4d4d', none: '#8fa3b8' };
const gradePM10 = (v) => v == null ? null : v <= 30 ? '좋음' : v <= 80 ? '보통' : v <= 150 ? '나쁨' : '매우나쁨';
const provHeight = (pm10) => pm10 == null ? 0.8 : 0.6 + Math.min(pm10, 150) * 0.012;   // 0.6 ~ 2.4
const barHeight = (pm10) => pm10 == null ? 0.4 : Math.max(0.6, pm10 * 0.06);

const $ = (id) => document.getElementById(id);
const box = $('map3d');
const info = $('map3d-info');
const btn2d = $('mode-2d'), btn3d = $('mode-3d'), box2d = $('map');

// ─────────────── 데이터: 시·도 + 도시의 PM10 (한 번에 요청, 30분 캐시) ───────────────
async function loadAir(points) {
  const KEY = 'air3d-v2';
  try {
    const c = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (c && Date.now() - c.t < 30 * 60 * 1000 && c.n === points.length) return c.v;
  } catch (e) { /* 저장소를 못 써도 그냥 진행 */ }
  const url = 'https://air-quality-api.open-meteo.com/v1/air-quality' +
    `?latitude=${points.map((p) => p[0]).join(',')}&longitude=${points.map((p) => p[1]).join(',')}` +
    '&current=pm10,pm2_5&timezone=Asia%2FSeoul';
  const r = await fetch(url);
  if (r.status === 429) throw new Error('요청이 너무 많아 잠시 제한됐습니다. 잠시 뒤 3D 버튼을 다시 눌러 주세요');
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const d = await r.json();
  const arr = Array.isArray(d) ? d : [d];
  const v = arr.map((x) => ({
    pm10: typeof x.current?.pm10 === 'number' ? Math.round(x.current.pm10) : null,
    pm25: typeof x.current?.pm2_5 === 'number' ? Math.round(x.current.pm2_5) : null,
  }));
  try { localStorage.setItem(KEY, JSON.stringify({ t: Date.now(), n: points.length, v })); } catch (e) { /* 무시 */ }
  return v;
}

// ─────────────── 장면 ───────────────
let ready = false, running = false, airOk = false;
let renderer, scene, camera, controls, raycaster, clock;
let provMeshes = [], bars = [], provLabels = [], pin = null, pinRing = null, hover = null;
const provState = {};                 // 시·도 코드 → { cur, target }  (높이 애니메이션)
let intro = { on: true, t: 0 };
let airCtx = null;

const ease = (t) => 1 - Math.pow(1 - t, 3);

function textSprite(text, { size = 54, w = 256, h = 96, sw = 5, sh = 1.9 } = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.font = `bold ${size}px "Malgun Gothic", sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = 9; g.strokeStyle = 'rgba(10,25,45,.85)'; g.strokeText(text, w / 2, h / 2);
  g.fillStyle = '#ffffff'; g.fillText(text, w / 2, h / 2);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false, transparent: true }));
  s.scale.set(sw, sh, 1); s.renderOrder = 10;
  return s;
}

// 막대 위의 값 라벨 (둥근 알약 모양)
function pillTexture(text, color) {
  const c = document.createElement('canvas'); c.width = 128; c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = color; g.beginPath(); g.roundRect(6, 8, 116, 48, 24); g.fill();
  g.lineWidth = 4; g.strokeStyle = 'rgba(255,255,255,.95)'; g.stroke();
  g.font = 'bold 32px "Malgun Gothic", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = '#fff'; g.fillText(text, 64, 34);
  return new THREE.CanvasTexture(c);
}

function ringVec(ring) { return ring.map(([lng, lat]) => new THREE.Vector2(...proj(lng, lat))); }

function provinceGeometries(geom) {
  const polys = geom.type === 'MultiPolygon' ? geom.coordinates : [geom.coordinates];
  return polys.map((poly) => {
    const shape = new THREE.Shape(ringVec(poly[0]));
    for (const hole of poly.slice(1)) shape.holes.push(new THREE.Path(ringVec(hole)));
    return new THREE.ExtrudeGeometry(shape, { depth: 1, bevelEnabled: false });  // 높이 1 → scale.z 로 조절
  });
}

function inRing(lng, lat, ring) {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

async function init() {
  info.textContent = '3D 지도를 만드는 중…';
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  box.prepend(renderer.domElement);
  renderer.domElement.style.display = 'block';

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(40, 1, 0.1, 500);
  camera.position.set(0, 130, 95);              // 시작 위치 (소개 애니메이션으로 아래 위치까지 내려옴)
  clock = new THREE.Clock();

  scene.add(new THREE.HemisphereLight(0xcfe8ff, 0x1a3350, 0.9));
  const sun = new THREE.DirectionalLight(0xffffff, 1.5);
  sun.position.set(-35, 70, 40);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -45, right: 45, top: 45, bottom: -45, near: 10, far: 200 });
  sun.shadow.bias = -0.0005;
  scene.add(sun);

  // 바다 + 격자
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), new THREE.MeshStandardMaterial({ color: 0x14406a, roughness: 0.9 }));
  sea.rotation.x = -Math.PI / 2; sea.position.y = -0.06; sea.receiveShadow = true; scene.add(sea);
  const grid = new THREE.GridHelper(240, 120, 0x2f7cb8, 0x1f5a8c);
  grid.position.y = -0.04; grid.material.transparent = true; grid.material.opacity = 0.35; scene.add(grid);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI / 2.1;
  controls.minDistance = 14; controls.maxDistance = 140;
  controls.autoRotate = true; controls.autoRotateSpeed = 0.45;     // 처음엔 천천히 돈다 (건드리면 멈춤)
  raycaster = new THREE.Raycaster();

  const provCodes = Object.keys(PROV);
  const cities = (window.KR_CITIES || []).filter((c) => BAR_CITIES.has(c[0]));
  const pts = provCodes.map((k) => [PROV[k][1], PROV[k][2]]).concat(cities.map((c) => [c[2], c[3]]));
  airCtx = { pts, provCodes };

  // 시·도 입체
  const gj = await (await fetch('korea-provinces.geo.json')).json();
  const polysByCode = {};
  for (const f of gj.features) {
    const code = String(f.properties.code);
    const p = PROV[code]; if (!p) continue;
    provState[code] = { cur: 0.01, target: provHeight(null) };
    const geom = f.geometry;
    polysByCode[code] = (geom.type === 'MultiPolygon' ? geom.coordinates : [geom.coordinates]).map((poly) => poly[0]);
    for (const g of provinceGeometries(geom)) {
      const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: COLORS.none, roughness: 0.55, metalness: 0.05 }));
      m.rotation.x = -Math.PI / 2;
      m.castShadow = true; m.receiveShadow = true;
      m.userData = { kind: 'prov', code, name: p[0], pm10: null, pm25: null, grade: null, base: COLORS.none, lift: 0, liftT: 0 };
      m.add(new THREE.LineSegments(new THREE.EdgesGeometry(g, 30), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 })));
      scene.add(m); provMeshes.push(m);
    }
    const [x, y] = proj(p[2], p[1]);
    const label = textSprite(p[0]); label.position.set(x, 3, -y); label.userData = { code, x, z: -y };
    scene.add(label); provLabels.push(label);
  }

  // 도시 막대 — 어느 시·도 위에 있는지 찾아서 그 높이 위에 세운다
  cities.forEach((c) => {
    let code = Object.keys(polysByCode).find((k) => polysByCode[k].some((r) => inRing(c[3], c[2], r)));
    if (!code) {   // 섬(독도 등)이라 경계 안에 없으면 가장 가까운 도청 소재지의 시·도
      let bd = Infinity;
      for (const k of provCodes) { const d = Math.hypot(PROV[k][1] - c[2], PROV[k][2] - c[3]); if (d < bd) { bd = d; code = k; } }
    }
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.3, 1, 18),
      new THREE.MeshStandardMaterial({ color: COLORS.none, roughness: 0.3, metalness: 0.2, emissive: COLORS.none, emissiveIntensity: 0.25 }));
    const [x, y] = proj(c[3], c[2]);
    m.castShadow = true;
    m.position.set(x, 1, -y);
    m.userData = { kind: 'city', name: c[0], lat: c[2], lng: c[3], code, pm10: null, pm25: null, grade: null, cur: 0.01, target: barHeight(null), w: 1, wT: 1 };
    const tag = new THREE.Sprite(new THREE.SpriteMaterial({ depthTest: false, transparent: true }));
    tag.scale.set(2.2, 1.1, 1); tag.renderOrder = 11; tag.visible = false;
    m.userData.tag = tag;
    scene.add(m, tag); bars.push(m);
  });

  new ResizeObserver(resize).observe(box);
  bindEvents();
  resize();
  ready = true;
  await refreshAir();
}

// 미세먼지 값을 가져와 시·도 높이/색과 도시 막대에 반영 (실패하면 지형만 남고, 3D 버튼을 다시 누르면 재시도)
async function refreshAir() {
  const { pts, provCodes } = airCtx;
  try {
    const air = await loadAir(pts);
    for (const m of provMeshes) {
      const v = air[provCodes.indexOf(m.userData.code)];
      Object.assign(m.userData, { pm10: v.pm10, pm25: v.pm25, grade: gradePM10(v.pm10) });
      m.userData.base = COLORS[m.userData.grade || 'none'];
      m.material.color.setHex(m.userData.base);
      provState[m.userData.code].target = provHeight(v.pm10);
    }
    bars.forEach((m, i) => {
      const v = air[provCodes.length + i];
      const grade = gradePM10(v.pm10);
      Object.assign(m.userData, { pm10: v.pm10, pm25: v.pm25, grade, target: barHeight(v.pm10) });
      m.material.color.setHex(COLORS[grade || 'none']);
      m.material.emissive.setHex(COLORS[grade || 'none']);
      const tag = m.userData.tag;
      if (tag.material.map) tag.material.map.dispose();
      tag.material.map = pillTexture(v.pm10 == null ? '-' : String(v.pm10), CSS[grade || 'none']);
      tag.material.needsUpdate = true; tag.visible = true;
    });
    airOk = true;
    info.textContent = '높이·색 = PM10 등급. 드래그로 회전 · 휠로 확대 · 도시나 지역을 클릭해 보세요.';
  } catch (e) {
    airOk = false;
    info.textContent = '미세먼지 데이터를 못 불러왔습니다 — ' + e.message;
  }
}

function resize() {
  const w = box.clientWidth, h = box.clientHeight;
  if (!w || !h) return;
  renderer.setSize(w, h);
  camera.aspect = w / h; camera.updateProjectionMatrix();
}

// ─────────────── 마우스 ───────────────
function pick(ev) {
  const r = renderer.domElement.getBoundingClientRect();
  raycaster.setFromCamera(new THREE.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1), camera);
  return raycaster.intersectObjects(bars.concat(provMeshes), false)[0] || null;
}

function setHover(obj) {
  if (hover === obj) return;
  if (hover) {
    if (hover.userData.kind === 'prov') { hover.userData.liftT = 0; hover.material.emissive.setHex(0x000000); }
    else hover.userData.wT = 1;
  }
  hover = obj;
  if (hover) {
    if (hover.userData.kind === 'prov') { hover.userData.liftT = 0.35; hover.material.emissive.setHex(0x222222); }
    else hover.userData.wT = 1.7;
  }
  renderer.domElement.style.cursor = obj ? 'pointer' : 'grab';
}

function describe(d) {
  return `${d.name} · PM10 ${d.pm10 ?? '-'}${d.grade ? ' (' + d.grade + ')' : ''}`;
}

function bindEvents() {
  const el = renderer.domElement;
  let down = null;
  el.addEventListener('pointermove', (ev) => {
    const h = pick(ev);
    setHover(h ? h.object : null);
    if (h) info.textContent = describe(h.object.userData) + (h.object.userData.kind === 'prov' ? ' (도청 소재지 기준)' : '');
  });
  el.addEventListener('pointerdown', (ev) => {
    down = [ev.clientX, ev.clientY];
    controls.autoRotate = false; intro.on = false;      // 건드리면 자동 회전·소개 애니메이션 중지
  });
  el.addEventListener('pointerup', async (ev) => {
    if (!down || Math.hypot(ev.clientX - down[0], ev.clientY - down[1]) > 5) return; // 드래그는 클릭이 아님
    const h = pick(ev); if (!h) return;
    let lat, lng, label;
    const d = h.object.userData;
    if (d.kind === 'city') { lat = d.lat; lng = d.lng; label = `${d.name} · 도시`; }
    else { [lng, lat] = unproj(h.point.x, h.point.z); }
    placePin(h.point.x, h.point.y, h.point.z);
    if (!window.WeatherCard) return;
    info.textContent = '날씨 불러오는 중…';
    const w = await window.WeatherCard.show({ lat, lng, label });
    info.textContent = w
      ? `${w.icon} ${w.temp}°C ${w.desc} · 미세먼지 ${w.pm10 ?? '-'}(${w.g10 || '-'}) · 초미세먼지 ${w.pm25 ?? '-'}(${w.g25 || '-'})  ← 위 날씨 카드에도 표시됨`
      : '날씨를 불러오지 못했습니다';
  });
}

function placePin(x, y, z) {
  if (!pin) {
    pin = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1.6, 16), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.5 }));
    pin.rotation.x = Math.PI; pin.castShadow = true; scene.add(pin);
    pinRing = new THREE.Mesh(new THREE.RingGeometry(0.7, 0.9, 32), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, side: THREE.DoubleSide }));
    pinRing.rotation.x = -Math.PI / 2; scene.add(pinRing);
  }
  pin.userData.baseY = y + 1.5;
  pin.position.set(x, y + 1.5, z);
  pinRing.position.set(x, y + 0.05, z);
}

// ─────────────── 렌더 루프 (화면에 보일 때만) ───────────────
function loop() {
  if (!running) return;
  const dt = Math.min(clock.getDelta(), 0.05), time = clock.elapsedTime;
  const k = Math.min(1, dt * 4);

  // 소개: 카메라가 위에서 내려오며 자리 잡는다
  if (intro.on) {
    intro.t = Math.min(1, intro.t + dt / 2.2);
    const e = ease(intro.t);
    camera.position.set(0, 130 + (62 - 130) * e, 95 + (52 - 95) * e);
    if (intro.t >= 1) intro.on = false;
  }

  for (const s of Object.values(provState)) s.cur += (s.target - s.cur) * k;
  for (const m of provMeshes) {
    const u = m.userData, st = provState[u.code];
    u.lift += (u.liftT - u.lift) * k;
    m.scale.z = Math.max(st.cur, 0.01);
    m.position.y = u.lift;
  }
  for (const l of provLabels) l.position.y = provState[l.userData.code].cur + 1.3;
  for (const b of bars) {
    const u = b.userData, base = provState[u.code].cur;
    u.cur += (u.target - u.cur) * k;
    u.w += (u.wT - u.w) * k;
    b.scale.set(u.w, Math.max(u.cur, 0.01), u.w);
    b.position.y = base + u.cur / 2;
    u.tag.position.set(b.position.x, base + u.cur + 0.9, b.position.z);
  }
  if (pin) {
    pin.position.y = pin.userData.baseY + Math.sin(time * 4) * 0.25;
    const s = 1 + ((time * 1.2) % 1) * 1.4;
    pinRing.scale.set(s, s, 1); pinRing.material.opacity = 0.8 * (1 - ((time * 1.2) % 1));
  }

  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}

async function show3d() {
  box2d.hidden = true; box.hidden = false;
  btn3d.classList.add('on'); btn2d.classList.remove('on');
  $('maphint').textContent = '3D 지도: 높이·색 = PM10 (모델 추정값). 시·도 색은 도청 소재지 기준입니다.';
  try {
    if (!window.THREE_READY) window.THREE_READY = init();
    await window.THREE_READY;
  } catch (e) {
    info.textContent = '3D 지도를 만들지 못했습니다: ' + e.message;
    return;
  }
  resize();
  if (!airOk && ready) await refreshAir();
  if (!running) { running = true; clock.getDelta(); loop(); }
}

function show2d() {
  running = false;
  box.hidden = true; box2d.hidden = false;
  btn2d.classList.add('on'); btn3d.classList.remove('on');
  $('maphint').textContent = '지도를 클릭하면 그 지점의 날씨와 미세먼지를 보여 줍니다.';
  if (window.map2dResize) window.map2dResize();
}

btn3d.addEventListener('click', show3d);
btn2d.addEventListener('click', show2d);
