// 3D 지도 — three.js
//  · 시·도 경계(korea-provinces.geo.json)를 입체로 세우고, 미세먼지 등급 색으로 칠한다
//  · 전국 주요 도시(cities.js)마다 PM10 높이의 막대를 세운다
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

const COLORS = { 좋음: 0x2f80ed, 보통: 0x27ae60, 나쁨: 0xf2994a, 매우나쁨: 0xeb5757, none: 0x8c959f };
const gradePM10 = (v) => v == null ? null : v <= 30 ? '좋음' : v <= 80 ? '보통' : v <= 150 ? '나쁨' : '매우나쁨';

const $ = (id) => document.getElementById(id);
const box = $('map3d');
const info = $('map3d-info');
const btn2d = $('mode-2d'), btn3d = $('mode-3d'), box2d = $('map');

// ─────────────── 데이터: 시·도 + 도시의 PM10 (한 번에 요청, 10분 캐시) ───────────────
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
  if (r.status === 429) throw new Error('요청이 너무 많아 잠시 제한됐습니다. 1분 뒤 3D 버튼을 다시 눌러 주세요');
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
let ready = false, running = false;
let renderer, scene, camera, controls, raycaster;
let provMeshes = [], bars = [], pin = null, hover = null;

function textSprite(text) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 96;
  const g = c.getContext('2d');
  g.font = 'bold 54px "Malgun Gothic", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = 10; g.strokeStyle = 'rgba(255,255,255,.95)'; g.strokeText(text, 128, 48);
  g.fillStyle = '#1f2328'; g.fillText(text, 128, 48);
  const t = new THREE.CanvasTexture(c);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true }));
  s.scale.set(5, 1.9, 1); s.renderOrder = 10;
  return s;
}

function ringShape(ring) {
  return ring.map(([lng, lat]) => new THREE.Vector2(...proj(lng, lat)));
}

function provinceGeometry(geom, depth) {
  const polys = geom.type === 'MultiPolygon' ? geom.coordinates : [geom.coordinates];
  const geos = [];
  for (const poly of polys) {
    const shape = new THREE.Shape(ringShape(poly[0]));
    for (const hole of poly.slice(1)) shape.holes.push(new THREE.Path(ringShape(hole)));
    geos.push(new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false }));
  }
  return geos;
}

async function init() {
  info.textContent = '3D 지도를 만드는 중…';
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  box.prepend(renderer.domElement);
  renderer.domElement.style.display = 'block';

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0xdff1ff);
  camera = new THREE.PerspectiveCamera(42, 1, 0.1, 400);
  camera.position.set(0, 62, 52);

  scene.add(new THREE.AmbientLight(0xffffff, 0.75));
  const sun = new THREE.DirectionalLight(0xffffff, 0.9);
  sun.position.set(-30, 60, 30); scene.add(sun);

  // 바다
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshStandardMaterial({ color: 0xbfe3fb }));
  sea.rotation.x = -Math.PI / 2; sea.position.y = -0.05; scene.add(sea);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI / 2.1;
  controls.minDistance = 15; controls.maxDistance = 130;
  controls.target.set(0, 0, 0);
  raycaster = new THREE.Raycaster();

  // 데이터
  const provCodes = Object.keys(PROV);
  const cities = (window.KR_CITIES || []).filter((c) => BAR_CITIES.has(c[0]));
  const pts = provCodes.map((k) => [PROV[k][1], PROV[k][2]]).concat(cities.map((c) => [c[2], c[3]]));
  const provAir = {}; provCodes.forEach((k) => { provAir[k] = { pm10: null }; });

  // 시·도 입체 (높이는 일정, 색 = 도청 소재지 PM10 등급)
  const gj = await (await fetch('korea-provinces.geo.json')).json();
  for (const f of gj.features) {
    const code = String(f.properties.code);
    const p = PROV[code]; if (!p) continue;
    const pm10 = provAir[code].pm10, grade = gradePM10(pm10);
    const mat = new THREE.MeshStandardMaterial({ color: COLORS[grade || 'none'], roughness: 0.8 });
    for (const g of provinceGeometry(f.geometry, 0.6)) {
      const m = new THREE.Mesh(g, mat.clone());
      m.rotation.x = -Math.PI / 2;
      m.userData = { kind: 'prov', code, name: p[0], pm10, grade, base: COLORS[grade || 'none'] };
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(g, 30), new THREE.LineBasicMaterial({ color: 0xffffff }));
      m.add(edges);
      scene.add(m); provMeshes.push(m);
    }
    const [x, y] = proj(p[2], p[1]);
    const label = textSprite(p[0]); label.position.set(x, 2.2, -y); scene.add(label);
  }

  // 도시 막대 (높이 = PM10)
  cities.forEach((c, i) => {
    const a = { pm10: null, pm25: null };
    const grade = gradePM10(a.pm10);
    const h = 0.4;
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 1, 10),
      new THREE.MeshStandardMaterial({ color: COLORS[grade || 'none'], roughness: 0.4 }));
    const [x, y] = proj(c[3], c[2]);
    m.scale.y = h; m.position.set(x, 0.6 + h / 2, -y);
    m.userData = { kind: 'city', name: c[0], lat: c[2], lng: c[3], pm10: a.pm10, pm25: a.pm25, grade };
    scene.add(m); bars.push(m);
  });

  new ResizeObserver(resize).observe(box);
  bindEvents();
  resize();
  ready = true;
  window.__air3d = { pts, provCodes, nProv: provCodes.length };
  await refreshAir();
}

// 미세먼지 값을 가져와 시·도 색과 도시 막대에 반영 (실패하면 지형만 남고, 3D 버튼을 다시 누르면 재시도)
let airOk = false;
async function refreshAir() {
  const { pts, provCodes } = window.__air3d;
  try {
    const air = await loadAir(pts);
    const set = (m, v, base) => { m.userData.pm10 = v.pm10; m.userData.pm25 = v.pm25; m.userData.grade = gradePM10(v.pm10); };
    for (const m of provMeshes) {
      const v = air[provCodes.indexOf(m.userData.code)];
      set(m, v);
      m.userData.base = COLORS[m.userData.grade || 'none'];
      m.material.color.setHex(m.userData.base);
    }
    bars.forEach((m, i) => {
      const v = air[provCodes.length + i];
      set(m, v);
      const h = v.pm10 == null ? 0.4 : Math.max(0.5, v.pm10 * 0.06);
      m.scale.y = h; m.position.y = 0.6 + h / 2;
      m.material.color.setHex(COLORS[m.userData.grade || 'none']);
    });
    airOk = true;
    info.textContent = '막대 높이 = PM10, 색 = 등급. 드래그로 회전 · 휠로 확대 · 도시/지역을 클릭해 보세요.';
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
  const hit = raycaster.intersectObjects(bars.concat(provMeshes), false)[0];
  return hit || null;
}

function setHover(obj) {
  if (hover === obj) return;
  if (hover && hover.userData.kind === 'prov') hover.material.color.setHex(hover.userData.base);
  hover = obj;
  if (hover && hover.userData.kind === 'prov') hover.material.color.setHex(hover.userData.base).offsetHSL(0, 0, 0.12);
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
  el.addEventListener('pointerdown', (ev) => { down = [ev.clientX, ev.clientY]; });
  el.addEventListener('pointerup', async (ev) => {
    if (!down || Math.hypot(ev.clientX - down[0], ev.clientY - down[1]) > 5) return; // 드래그는 클릭이 아님
    const h = pick(ev); if (!h) return;
    let lat, lng, label;
    const d = h.object.userData;
    if (d.kind === 'city') { lat = d.lat; lng = d.lng; label = `${d.name} · 도시`; }
    else { [lng, lat] = unproj(h.point.x, h.point.z); }
    placePin(h.point.x, h.point.z);
    if (!window.WeatherCard) return;
    info.textContent = '날씨 불러오는 중…';
    const w = await window.WeatherCard.show({ lat, lng, label });
    info.textContent = w
      ? `${w.icon} ${w.temp}°C ${w.desc} · 미세먼지 ${w.pm10 ?? '-'}(${w.g10 || '-'}) · 초미세먼지 ${w.pm25 ?? '-'}(${w.g25 || '-'})  ← 위 날씨 카드에도 표시됨`
      : '날씨를 불러오지 못했습니다';
  });
}

function placePin(x, z) {
  if (!pin) {
    pin = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1.6, 12), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x333333 }));
    pin.rotation.x = Math.PI; scene.add(pin);
  }
  pin.position.set(x, 3.5, z);
}

// ─────────────── 렌더 루프 (화면에 보일 때만) ───────────────
function loop() {
  if (!running) return;
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}

async function show3d() {
  box2d.hidden = true; box.hidden = false;
  btn3d.classList.add('on'); btn2d.classList.remove('on');
  $('maphint').textContent = '3D 지도: 막대 높이 = PM10 (모델 추정값). 시·도 색은 도청 소재지 기준입니다.';
  try {
    if (!window.THREE_READY) window.THREE_READY = init();
    await window.THREE_READY;
  } catch (e) {
    info.textContent = '3D 지도를 만들지 못했습니다: ' + e.message;
    return;
  }
  resize();
  if (!airOk && ready) await refreshAir();
  if (!running) { running = true; loop(); }
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
