# 날씨 기반 장소 추천 에이전트 (Vercel 전용)

질문 → **Gemini** 가 도구를 골라 호출(function calling) → 서버가 실행 → 결과로 추천 답변.

| 도구 | 하는 일 | 데이터 |
|---|---|---|
| `get_weather` | 실시간 날씨·오늘/내일 예보·미세먼지 | Open-Meteo (키 없음) |
| `find_spots` | 지역 주변 장소 검색 (관광지·맛집·카페·자연·실내) | 카카오 로컬 API (키 있으면) / 없으면 OpenStreetMap |

Railway 서버 없이 **Vercel(정적 파일 + 서버리스 함수 `api/chat.js`)** 만 씁니다.

## 구조
```
index.html · style.css · app.js(2D 지도) · weather.js(날씨 카드·검색) · cities.js · agent.js(채팅 화면)
api/chat.js            POST /api/chat  — 입력 검증, 호출 제한, 에이전트 실행
api/_lib/agent.js      Gemini 호출 루프 (도구 호출 → 실행 → 결과 전달, 최대 5회)
api/_lib/tools.js      get_weather, find_spots 와 Gemini 에게 알려 주는 도구 설명서
dev.mjs                내 PC 미리보기용 (배포에는 쓰이지 않음)
```

## Vercel 에 배포
1. Vercel 에서 이 저장소를 가져온다 (Framework: Other, Root Directory 는 비워 둠, Build 설정 없음).
2. **Settings → Environment Variables** 에 등록 후 다시 배포:
   - `GEMINI_API_KEY` (필수) — https://aistudio.google.com/apikey
   - `KAKAO_REST_API_KEY` (권장) — https://developers.kakao.com 에서 앱 만들고 REST API 키
   - `GEMINI_MODEL` (선택, 기본 `gemini-3.8-flash`)
3. 키는 서버 함수 안에서만 쓰이며 브라우저로 나가지 않는다.

## 내 PC 에서 실행
```bash
cp .env.example .env     # 값 채우기
npm run dev              # http://localhost:3000   (Node 20.6+)
```
