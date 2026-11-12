// 에이전트가 고를 수 있는 두 가지 도구
//   get_weather : 실시간 날씨 + 미세먼지 (Open-Meteo, 키 없음)
//   find_spots  : 장소 검색 (OpenStreetMap Overpass, 키 없음)
// 둘 다 서버(Vercel 함수)에서 실행됩니다. 결과는 Gemini 에게 돌려주는 JSON 입니다.

const UA = 'weather-spot-agent/1.0 (Vercel serverless)';

// fetch + 시간 제한
async function getJSON(url, opts = {}, ms = 12000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { ...opts, signal: ctl.signal, headers: { 'User-Agent': UA, ...(opts.headers || {}) } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

const WMO = {
  0: '맑음', 1: '대체로 맑음', 2: '구름 많음', 3: '흐림', 45: '안개', 48: '서리 안개',
  51: '약한 이슬비', 53: '이슬비', 55: '강한 이슬비', 56: '어는 이슬비', 57: '강한 어는 이슬비',
  61: '약한 비', 63: '비', 65: '강한 비', 66: '어는 비', 67: '강한 어는 비',
  71: '약한 눈', 73: '눈', 75: '강한 눈', 77: '싸락눈', 80: '약한 소나기', 81: '소나기', 82: '강한 소나기',
  85: '약한 눈보라', 86: '강한 눈보라', 95: '뇌우', 96: '우박 동반 뇌우', 99: '강한 우박 뇌우',
};
const gradePM10 = (v) => v == null ? null : v <= 30 ? '좋음' : v <= 80 ? '보통' : v <= 150 ? '나쁨' : '매우나쁨';
const gradePM25 = (v) => v == null ? null : v <= 15 ? '좋음' : v <= 35 ? '보통' : v <= 75 ? '나쁨' : '매우나쁨';
const round = (v, d = 0) => (typeof v === 'number' ? Number(v.toFixed(d)) : null);

// ─────────────── 지역 이름 → 좌표 ───────────────
// 1순위 Open-Meteo 지오코딩(영어 이름에 강함), 2순위 Nominatim(한글 지명·랜드마크에 강함)
export async function geocode(name) {
  const q = String(name || '').trim().slice(0, 80);
  if (!q) throw new Error('지역 이름이 비어 있습니다');
  try {
    const u = new URL('https://geocoding-api.open-meteo.com/v1/search');
    u.search = new URLSearchParams({ name: q, count: '1', language: 'ko', countryCode: 'KR', format: 'json' });
    const d = await getJSON(u);
    const r = d.results?.[0];
    if (r) return { name: [r.name, r.admin1].filter(Boolean).join(', '), lat: r.latitude, lng: r.longitude };
  } catch (e) { /* 다음 방법으로 */ }
  const u = new URL('https://nominatim.openstreetmap.org/search');
  u.search = new URLSearchParams({ q, format: 'jsonv2', countrycodes: 'kr', limit: '1', 'accept-language': 'ko' });
  const d = await getJSON(u);
  if (!d[0]) throw new Error(`'${q}' 위치를 찾지 못했습니다. 다른 표기(영어 이름 등)로 다시 시도하세요`);
  return { name: d[0].display_name.split(',').slice(0, 2).join(',').trim(), lat: Number(d[0].lat), lng: Number(d[0].lon) };
}

// ─────────────── 도구 1: get_weather ───────────────
export async function get_weather({ location }) {
  const place = await geocode(location);
  const f = new URL('https://api.open-meteo.com/v1/forecast');
  f.search = new URLSearchParams({
    latitude: place.lat, longitude: place.lng, timezone: 'Asia/Seoul', wind_speed_unit: 'kmh', forecast_days: '2',
    current: 'temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,wind_speed_10m',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum',
  });
  const a = new URL('https://air-quality-api.open-meteo.com/v1/air-quality');
  a.search = new URLSearchParams({ latitude: place.lat, longitude: place.lng, timezone: 'Asia/Seoul', current: 'pm10,pm2_5' });

  const [w, air] = await Promise.allSettled([getJSON(f), getJSON(a)]);
  if (w.status !== 'fulfilled') throw new Error('날씨 API 호출 실패: ' + w.reason.message);
  const c = w.value.current, d = w.value.daily;
  const pm10 = air.status === 'fulfilled' ? round(air.value.current?.pm10) : null;
  const pm25 = air.status === 'fulfilled' ? round(air.value.current?.pm2_5) : null;
  const day = (i) => ({
    date: d.time[i], weather: WMO[d.weather_code[i]] || '알 수 없음',
    temp_min: round(d.temperature_2m_min[i]), temp_max: round(d.temperature_2m_max[i]),
    rain_probability_percent: d.precipitation_probability_max?.[i] ?? null, rain_mm: round(d.precipitation_sum?.[i], 1),
  });
  return {
    location: place.name, lat: place.lat, lng: place.lng, observed_at: c.time,
    now: {
      weather: WMO[c.weather_code] || '알 수 없음', temp_c: round(c.temperature_2m), feels_like_c: round(c.apparent_temperature),
      humidity_percent: round(c.relative_humidity_2m), wind_kmh: round(c.wind_speed_10m), rain_mm: round(c.precipitation, 1),
    },
    today: day(0), tomorrow: day(1),
    air_quality: air.status === 'fulfilled'
      ? { pm10, pm10_grade: gradePM10(pm10), pm25, pm25_grade: gradePM25(pm25), note: '모델 추정값(측정소 실측과 다를 수 있음)' }
      : { note: '미세먼지 정보를 가져오지 못함' },
  };
}

// ─────────────── 도구 2: find_spots ───────────────
const CATEGORIES = {
  attraction: ['["tourism"~"^(attraction|viewpoint|zoo|theme_park|aquarium|artwork)$"]', '["historic"~"^(castle|monument|ruins|archaeological_site|memorial)$"]'],
  indoor: ['["tourism"~"^(museum|gallery|aquarium)$"]', '["shop"="mall"]', '["amenity"~"^(cinema|theatre|library|arts_centre)$"]'],
  food: ['["amenity"="restaurant"]'],
  cafe: ['["amenity"="cafe"]'],
  nature: ['["leisure"~"^(park|garden|nature_reserve)$"]', '["natural"~"^(beach|peak|waterfall|volcano)$"]', '["tourism"="viewpoint"]'],
};
export const CATEGORY_NAMES = Object.keys(CATEGORIES);

const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];

function km(a, b, c, d) {
  const R = 6371, rad = (x) => (x * Math.PI) / 180;
  const h = Math.sin(rad(c - a) / 2) ** 2 + Math.cos(rad(a)) * Math.cos(rad(c)) * Math.sin(rad(d - b) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

async function findSpotsOSM(place, cat, radius, n) {

  const sel = CATEGORIES[cat].map((s) => `nwr${s}(around:${radius},${place.lat},${place.lng});`).join('');
  const query = `[out:json][timeout:20];(${sel});out tags center 80;`;

  let data = null, lastErr = null;
  for (const ep of OVERPASS) {
    try {
      data = await getJSON(ep, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'data=' + encodeURIComponent(query) }, 18000);
      break;
    } catch (e) { lastErr = e; }
  }
  if (!data) throw new Error('장소 검색 서버가 응답하지 않습니다 (' + (lastErr?.message || '') + '). 잠시 뒤 다시 시도하세요');

  const seen = new Set();
  const spots = [];
  for (const el of data.elements || []) {
    const t = el.tags || {};
    const name = t['name:ko'] || t.name;
    const lat = el.lat ?? el.center?.lat, lng = el.lon ?? el.center?.lon;
    if (!name || lat == null || lng == null || seen.has(name)) continue;
    seen.add(name);
    const dist = km(place.lat, place.lng, lat, lng);
    // 유명도 대용 점수: 위키 정보·웹사이트가 있고 태그가 풍부할수록 ↑, 멀수록 ↓
    const score = (t.wikipedia || t.wikidata ? 3 : 0) + (t['name:ko'] ? 1 : 0) + (t.website || t.phone ? 1 : 0) +
      Math.min(Object.keys(t).length / 10, 2) - dist * 0.15;
    spots.push({
      name, lat: round(lat, 5), lng: round(lng, 5), distance_km: round(dist, 1),
      type: t.tourism || t.historic || t.amenity || t.leisure || t.natural || t.shop || cat,
      address: t['addr:full'] || [t['addr:city'], t['addr:street'], t['addr:housenumber']].filter(Boolean).join(' ') || null,
      opening_hours: t.opening_hours || null,
      website: /^https?:\/\//.test(t.website || '') ? t.website : null,
      _s: score,
    });
  }
  spots.sort((a, b) => b._s - a._s);
  const top = spots.slice(0, n).map(({ _s, ...s }) => s);
  return {
    source: 'OpenStreetMap', count: top.length, spots: top,
    note: top.length ? 'OpenStreetMap 기준(평점·영업 여부는 확인되지 않음)' : '조건에 맞는 장소를 찾지 못했습니다. 반경을 넓히거나 다른 분류를 시도하세요',
  };
}


// ─────────────── 카카오 로컬 API (KAKAO_REST_API_KEY 가 있을 때) ───────────────
// 분류 → [카테고리 그룹 코드 | 키워드]   AT4 관광명소 · CT1 문화시설 · FD6 음식점 · CE7 카페
const KAKAO = {
  attraction: [{ code: 'AT4' }],
  indoor: [{ code: 'CT1' }, { keyword: '쇼핑몰' }],
  food: [{ code: 'FD6' }],
  cafe: [{ code: 'CE7' }],
  nature: [{ keyword: '공원' }, { keyword: '해수욕장' }, { code: 'AT4' }],
};

async function findSpotsKakao(place, cat, radius, n, key) {
  const headers = { Authorization: 'KakaoAK ' + key };
  const jobs = KAKAO[cat].map((q) => {
    const u = new URL(q.code ? 'https://dapi.kakao.com/v2/local/search/category.json' : 'https://dapi.kakao.com/v2/local/search/keyword.json');
    const p = { x: place.lng, y: place.lat, radius: Math.min(radius, 20000), size: '15', sort: q.code ? 'distance' : 'accuracy' };
    if (q.code) p.category_group_code = q.code; else p.query = q.keyword;
    u.search = new URLSearchParams(p);
    return getJSON(u, { headers }, 10000);
  });
  const settled = await Promise.allSettled(jobs);
  const ok = settled.filter((r) => r.status === 'fulfilled');
  if (!ok.length) throw new Error('카카오 장소 검색 실패: ' + settled[0].reason.message + ' (KAKAO_REST_API_KEY 확인)');
  const seen = new Set(), spots = [];
  for (const r of ok) for (const d of r.value.documents || []) {
    if (seen.has(d.id)) continue;
    seen.add(d.id);
    spots.push({
      name: d.place_name, lat: round(Number(d.y), 5), lng: round(Number(d.x), 5),
      distance_km: round(Number(d.distance) / 1000, 1),
      type: (d.category_name || '').split('>').pop().trim() || cat,
      address: d.road_address_name || d.address_name || null,
      phone: d.phone || null, opening_hours: null,
      website: /^https?:\/\//.test(d.place_url || '') ? d.place_url : null,   // 카카오맵 링크
    });
  }
  // 카테고리 검색은 가까운 순, 키워드 검색은 정확도순으로 섞여 들어오므로 거리 기준으로 정리
  spots.sort((a, b) => (a.distance_km ?? 99) - (b.distance_km ?? 99));
  const top = spots.slice(0, n);
  return { source: '카카오 로컬', count: top.length, spots: top, note: top.length ? '카카오맵 기준(평점·영업시간은 확인되지 않음)' : '조건에 맞는 장소를 찾지 못했습니다. 반경을 넓히거나 다른 분류를 시도하세요' };
}

export async function find_spots({ location, category = 'attraction', radius_km = 5, limit = 6 }) {
  const cat = CATEGORIES[category] ? category : 'attraction';
  const radius = Math.min(Math.max(Number(radius_km) || 5, 1), 20) * 1000;
  const n = Math.min(Math.max(parseInt(limit, 10) || 6, 1), 10);
  const place = await geocode(location);
  const key = (process.env.KAKAO_REST_API_KEY || '').trim();
  const found = key ? await findSpotsKakao(place, cat, radius, n, key) : await findSpotsOSM(place, cat, radius, n);
  return { center: place.name, center_lat: place.lat, center_lng: place.lng, category: cat, radius_km: radius / 1000, ...found };
}

// Gemini 에게 알려 주는 도구 설명서 (함수 선언)
export const DECLARATIONS = [
  {
    name: 'get_weather',
    description: '한국 내 특정 지역의 실시간 날씨(기온·체감·습도·바람·강수), 오늘·내일 예보, 미세먼지(PM10·PM2.5)를 조회한다. 날씨·옷차림·비 여부·미세먼지·야외 활동 가능 여부가 중요할 때 호출한다.',
    parameters: {
      type: 'object',
      properties: { location: { type: 'string', description: '지역 이름. 영어 로마자로 넣으면 가장 정확하다 (예: Seoul, Busan, Jeju, Seogwipo, Gangneung). 한글 지명은 영어로 바꿔서 넣는다.' } },
      required: ['location'],
    },
  },
  {
    name: 'find_spots',
    description: '지역 주변의 장소(관광지·맛집·카페·자연·실내 장소)를 검색한다. 장소·여행·맛집·카페·산책·데이트 추천이 필요할 때 호출한다. 날씨에 따라 분류(category)를 고르면 좋다.',
    parameters: {
      type: 'object',
      properties: {
        location: { type: 'string', description: '검색 중심 지역 또는 랜드마크 이름. 영어 로마자 권장 (예: Jeju, Haeundae, Seongsan Ilchulbong)' },
        category: { type: 'string', enum: CATEGORY_NAMES, description: 'attraction=관광지·명소, indoor=실내(박물관·미술관·쇼핑몰·영화관), food=음식점, cafe=카페, nature=공원·해변·전망대 등 야외 자연. 비·미세먼지·추위면 indoor, 맑으면 nature/attraction.' },
        radius_km: { type: 'number', description: '검색 반경 km (기본 5, 최대 20). 자연·드라이브는 크게.' },
        limit: { type: 'integer', description: '결과 개수 (기본 6, 최대 10)' },
      },
      required: ['location', 'category'],
    },
  },
];

export const TOOLS = { get_weather, find_spots };
