// 2D 지도 (Leaflet + OpenStreetMap)
//  · 지도 어디를 눌러도 그 지점의 날씨 + 미세먼지를 보여 준다 (weather.js 의 WeatherCard)
//  · 에이전트가 추천한 장소는 번호 마커로 찍는다 (agent.js 가 showSpots 를 부른다)
// 서버(Railway) 없이 브라우저 + Vercel 함수만으로 동작합니다.
const $ = (id) => document.getElementById(id);

let map = null, spotLayer = null, clickMarker = null;

function initMap() {
  if (map || typeof L === 'undefined') return;
  map = L.map('map').setView([36.2, 127.8], 7); // 한국 전체가 보이게
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 18,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);
  spotLayer = L.layerGroup().addTo(map);
  map.on('click', onMapClick);
}

function dot(latlng) {
  if (clickMarker) clickMarker.remove();
  clickMarker = L.circleMarker(latlng, { radius: 6, color: '#1f2328', weight: 2, fillColor: '#fff', fillOpacity: 1 }).addTo(map);
  return clickMarker;
}

function onMapClick(ev) {
  const box = document.createElement('div');
  box.className = 'pop';
  const title = document.createElement('b'); title.textContent = '선택한 위치';
  const wx = document.createElement('div'); wx.textContent = '날씨 불러오는 중…';
  box.append(title, wx);
  dot(ev.latlng).bindPopup(box, { offset: [0, -4], minWidth: 190 }).openPopup();

  if (window.WeatherCard) {
    window.WeatherCard.show({ lat: ev.latlng.lat, lng: ev.latlng.lng }).then((d) => {
      wx.textContent = d
        ? `${d.icon} ${d.temp}°C ${d.desc} · 미세먼지 ${d.pm10 ?? '-'}(${d.g10 || '-'}) · 초미세먼지 ${d.pm25 ?? '-'}(${d.g25 || '-'})`
        : '날씨를 불러오지 못했습니다';
    });
  }
}

// 지역 검색 등에서 그 위치로 이동 (weather.js 가 부른다)
window.focusMap = function (lat, lng, label) {
  initMap();
  if (!map) return;
  map.setView([lat, lng], Math.max(map.getZoom(), 9));
  const m = dot([lat, lng]);
  if (label) { const d = document.createElement('div'); d.textContent = label; m.bindPopup(d).openPopup(); }
};

// 에이전트가 추천한 장소를 번호 마커로 표시하고 지도를 맞춘다
window.showSpots = function (spots) {
  initMap();
  if (!map) return;
  spotLayer.clearLayers();
  const pts = [];
  spots.forEach((s, i) => {
    if (typeof s.lat !== 'number' || typeof s.lng !== 'number') return;
    const icon = L.divIcon({ className: '', html: `<div class="spin">${i + 1}</div>`, iconSize: [28, 28], iconAnchor: [14, 14] });
    const box = document.createElement('div');
    box.className = 'pop';
    const b = document.createElement('b'); b.textContent = `${i + 1}. ${s.name}`;
    const sm = document.createElement('small');
    sm.textContent = [s.type, s.distance_km != null ? `${s.distance_km}km` : null].filter(Boolean).join(' · ');
    box.append(b, document.createElement('br'), sm);
    if (s.address) { box.append(document.createElement('br')); const a = document.createElement('small'); a.textContent = s.address; box.append(a); }
    if (s.website && /^https?:\/\//.test(s.website)) {
      box.append(document.createElement('br'));
      const l = document.createElement('a'); l.href = s.website; l.target = '_blank'; l.rel = 'noopener noreferrer'; l.textContent = '자세히 보기';
      box.append(l);
    }
    L.marker([s.lat, s.lng], { icon, title: s.name }).bindPopup(box).addTo(spotLayer);
    pts.push([s.lat, s.lng]);
  });
  if (pts.length) map.fitBounds(pts, { padding: [40, 40], maxZoom: 14 });
};

initMap();
