// 프론트에는 가공·등급 계산·예측 코드가 한 줄도 없습니다.
// fetch로 FastAPI에게 결과만 받아서 색칠만 합니다. (역할 분리)
const API = window.APP_CONFIG.API_BASE;
const $ = (id) => document.getElementById(id);

function badge(grade) {
  if (!grade) return '<span class="badge none">-</span>';
  const span = document.createElement('span');
  span.className = 'badge g-' + grade;
  span.textContent = grade;
  return span.outerHTML;
}

function esc(s) {
  const d = document.createElement('div');
  d.textContent = s == null ? '' : String(s);
  return d.innerHTML;
}

async function getJSON(path) {
  const r = await fetch(API + path);
  if (!r.ok) throw new Error(`${path} → ${r.status}`);
  return r.json();
}

// 시간별 기록(실선)과 1시간 뒤 예측값(점선·빨간 점)을 한 그래프로
function drawChart(station, hist, predicted) {
  const pts = hist.filter((h) => h.pm10 != null);
  if (pts.length < 2) return '<small>그래프를 그릴 기록이 아직 부족합니다.</small>';
  const W = 640, H = 170, L = 38, R = 14, T = 14, B = 30;
  const vals = pts.map((p) => p.pm10);
  const all = predicted != null ? vals.concat(predicted) : vals;
  const lo = Math.max(0, Math.floor(Math.min(...all) / 10) * 10 - 10);
  const hi = Math.ceil(Math.max(...all) / 10) * 10 + 10;
  const n = pts.length + (predicted != null ? 1 : 0);
  const x = (i) => L + (i * (W - L - R)) / Math.max(1, n - 1);
  const y = (v) => T + ((hi - v) * (H - T - B)) / (hi - lo);
  const line = pts.map((p, i) => `${x(i).toFixed(1)},${y(p.pm10).toFixed(1)}`).join(' ');
  const last = pts.length - 1;
  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(station)} PM10 시간별 추이">`;
  for (const g of [lo, (lo + hi) / 2, hi]) {
    svg += `<line x1="${L}" x2="${W - R}" y1="${y(g)}" y2="${y(g)}" class="grid"/>` +
           `<text x="${L - 6}" y="${y(g) + 4}" text-anchor="end" class="axis">${Math.round(g)}</text>`;
  }
  svg += `<polyline points="${line}" class="series"/>`;
  if (predicted != null) {
    svg += `<line x1="${x(last)}" y1="${y(vals[last])}" x2="${x(last + 1)}" y2="${y(predicted)}" class="forecast"/>` +
           `<circle cx="${x(last + 1)}" cy="${y(predicted)}" r="5" class="predpt"/>` +
           `<text x="${x(last + 1)}" y="${y(predicted) - 9}" text-anchor="end" class="axis">예측 ${predicted}</text>`;
  }
  svg += `<text x="${L}" y="${H - 8}" class="axis">${esc(pts[0].time.slice(5))}</text>` +
         `<text x="${x(last)}" y="${H - 8}" text-anchor="end" class="axis">${esc(pts[last].time.slice(5))}</text></svg>`;
  return `<b>${esc(station)}</b> PM10 시간별 기록 <small>(DB에 쌓인 ${pts.length}개${predicted != null ? ' + 1시간 뒤 예측' : ''})</small>${svg}`;
}

// ─────────────── 지도 ───────────────
// 측정소 좌표는 백엔드가 내려 줍니다. 여기서는 마커를 찍고,
// 지도 클릭 지점에서 가장 가까운 측정소를 골라 값을 보여 주기만 합니다.
let map = null;
let stationLayer = null;
let clickMarker = null;
let mapStations = [];

function initMap() {
  if (map || typeof L === 'undefined') return;
  map = L.map('map').setView([36.2, 127.8], 7); // 한국 전체가 보이게
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 18,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);
  stationLayer = L.layerGroup().addTo(map);
  map.on('click', onMapClick);
}

function popupHtml(r, extra) {
  return `<div class="pop"><b>${esc(r.station)}</b>${extra ? ' <small>' + esc(extra) + '</small>' : ''}<br>` +
    `PM10 <b>${esc(r.pm10 ?? '-')}</b> ${badge(r.pm10_grade)}<br>` +
    `PM2.5 <b>${esc(r.pm25 ?? '-')}</b> ${badge(r.pm25_grade)}<br>` +
    `<small>${esc(r.time)} 기준</small></div>`;
}

function drawMap(rows) {
  initMap();
  if (!map) {
    $('maphint').textContent = '지도 라이브러리를 불러오지 못했습니다. 인터넷 연결을 확인하세요.';
    return;
  }
  stationLayer.clearLayers();
  mapStations = rows.filter((r) => r.lat != null && r.lng != null);
  for (const r of mapStations) {
    const icon = L.divIcon({
      className: '',
      html: `<div class="pin g-${r.pm10_grade || 'none'}">${esc(r.pm10 ?? '-')}</div>`,
      iconSize: [30, 30], iconAnchor: [15, 15],
    });
    L.marker([r.lat, r.lng], { icon, title: r.station })
      .bindPopup(popupHtml(r)).addTo(stationLayer);
  }
  const missing = rows.filter((r) => r.lat == null).map((r) => r.station);
  $('maphint').textContent =
    '지도를 클릭하면 그 지점의 날씨와 미세먼지를 보여 줍니다(제주는 측정소 실측 포함). 원 안 숫자는 측정소 PM10입니다.' +
    (missing.length ? ` (위치 미등록 측정소: ${missing.join(', ')})` : '');
}

// 지도 어디를 눌러도(전국) 그 지점의 날씨 + 미세먼지를 보여 준다.
//  - 가까운 측정소(30km 이내)가 있으면 그 실측값(에어코리아 → Supabase)도 함께
//  - 날씨·미세먼지(모델 추정)는 Open-Meteo 에서 바로 받는다 (weather.js)
const STATION_RANGE_M = 30000;

function onMapClick(ev) {
  let best = null, bestD = Infinity;
  for (const r of mapStations) {
    const d = map.distance(ev.latlng, [r.lat, r.lng]); // 미터
    if (d < bestD) { bestD = d; best = r; }
  }
  if (clickMarker) clickMarker.remove();
  clickMarker = L.circleMarker(ev.latlng, { radius: 6, color: '#1f2328', weight: 2, fillColor: '#fff', fillOpacity: 1 }).addTo(map);

  const box = document.createElement('div');
  const top = document.createElement('div');
  if (best && bestD <= STATION_RANGE_M) {
    top.innerHTML = popupHtml(best, `가장 가까운 측정소 · ${(bestD / 1000).toFixed(1)}km (실측)`);
  } else {
    top.innerHTML = '<div class="pop"><b>선택한 위치</b><br><small>근처에 측정소가 없어 모델 추정값을 보여 줍니다</small></div>';
  }
  const wx = document.createElement('div');
  wx.className = 'pop popw';
  wx.textContent = '날씨 불러오는 중…';
  box.append(top, wx);
  clickMarker.bindPopup(box, { offset: [0, -4], minWidth: 190 }).openPopup();

  if (window.WeatherCard) {
    window.WeatherCard.show({ lat: ev.latlng.lat, lng: ev.latlng.lng }).then((d) => {
      wx.textContent = d
        ? `${d.icon} ${d.temp}°C ${d.desc} · 미세먼지 ${d.pm10 ?? '-'}(${d.g10 || '-'}) · 초미세먼지 ${d.pm25 ?? '-'}(${d.g25 || '-'})`
        : '날씨를 불러오지 못했습니다';
    });
  }
}

// 검색으로 지역을 고르면 지도도 그 위치로 이동 (weather.js 가 부른다)
window.focusMap = function (lat, lng, label) {
  initMap();
  if (!map) return;
  map.setView([lat, lng], Math.max(map.getZoom(), 9));
  if (clickMarker) clickMarker.remove();
  clickMarker = L.circleMarker([lat, lng], { radius: 6, color: '#1f2328', weight: 2, fillColor: '#fff', fillOpacity: 1 }).addTo(map);
  if (label) clickMarker.bindPopup(esc(label)).openPopup();
};

async function load() {
  try {
    const [health, summary, rows, stats] = await Promise.all([
      getJSON('/health'),
      getJSON('/air/summary'),
      getJSON('/air/latest'),
      getJSON('/air/stats'),
    ]);

    $('status').textContent =
      `연결됨 · ${API} · 모드: ${health.mode === 'demo' ? '연습 데이터' : '에어코리아 실데이터'}` +
      `${health.demo_reason ? ' (' + health.demo_reason + ')' : ''} · 저장소: ${health.store}`;
    $('status').className = 'status ok';

    // Supabase에 실제로 쌓이고 있는지 한눈에
    const d = $('dbstat');
    d.hidden = false;
    d.innerHTML =
      `<b>🗄 DB 저장 현황</b> (${esc(stats.mode === 'demo' ? '연습' : '실데이터')}) · ` +
      `누적 <b>${esc(stats.rows)}</b>건 · 수집 <b>${esc(stats.runs)}</b>회` +
      (stats.first ? ` · ${esc(stats.first)} ~ ${esc(stats.last)}` : '') +
      `<br><small>서버가 1시간마다 새 값을 받아 같은 측정소·같은 시각은 덮어쓰고, 새 시각은 계속 쌓습니다.</small>`;

    const s = $('summary');
    s.hidden = false;
    s.innerHTML =
      `<div><b>${esc(summary.stations)}</b><span>측정소</span></div>` +
      `<div><b>${esc(summary.avg_pm10 ?? '-')}</b><span>평균 PM10 ${badge(summary.avg_pm10_grade)}</span></div>` +
      `<div><b>${esc(summary.avg_pm25 ?? '-')}</b><span>평균 PM2.5</span></div>` +
      `<div><b>${esc(summary.worst_station?.station ?? '-')}</b><span>가장 나쁜 곳</span></div>`;

    drawMap(rows);

    $('rows').innerHTML = rows.map((r) => `
      <tr>
        <td>${esc(r.station)}</td>
        <td>${esc(r.time.slice(11))}</td>
        <td>${esc(r.pm10 ?? '-')} ${badge(r.pm10_grade)}</td>
        <td>${esc(r.pm25 ?? '-')} ${badge(r.pm25_grade)}</td>
        <td><button data-st="${esc(r.station)}">1시간 뒤?</button></td>
      </tr>`).join('');
  } catch (e) {
    $('status').textContent = `백엔드에 연결할 수 없습니다 (${API}) — 서버가 켜져 있는지, FRONT_ORIGINS가 맞는지 확인하세요. ${e.message}`;
    $('status').className = 'status err';
  }
}

$('rows').addEventListener('click', async (ev) => {
  const btn = ev.target.closest('button[data-st]');
  if (!btn) return;
  const p = $('pred'), c = $('chart');
  const st = encodeURIComponent(btn.dataset.st);
  p.hidden = false;
  p.textContent = '예측 중…';
  try {
    const [d, hist] = await Promise.all([
      getJSON('/air/predict?station=' + st),
      getJSON('/air/history?limit=48&station=' + st),
    ]);
    p.innerHTML = d.ready
      ? `<b>${esc(d.station)}</b> 1시간 뒤 PM10 약 <b>${esc(d.next_pm10)}</b> ${badge(d.next_grade)} ` +
        `<small>(평균 오차 ±${esc(d.avg_error)} · 학습 데이터 ${esc(d.points)}개 · ${esc(d.model)})</small>`
      : esc(d.message);
    c.hidden = false;
    c.innerHTML = drawChart(btn.dataset.st, hist, d.ready ? d.next_pm10 : null);
  } catch (e) {
    p.textContent = '예측 실패: ' + e.message;
    c.hidden = true;
  }
});

initMap(); // 백엔드가 꺼져 있어도 지도·날씨는 동작하게
load();
