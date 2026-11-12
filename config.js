// 백엔드(FastAPI) 주소 설정
// - 로컬(127.0.0.1 / localhost)에서 열면 → http://127.0.0.1:8000 (내 PC에서 실행한 uvicorn)
// - Vercel 배포 후에는 → RAILWAY_API (Railway에 배포한 day3_backend)
// 이 파일에는 절대 Supabase 키, 공공데이터 키 같은 비밀 값을 넣지 마세요. (브라우저에 그대로 공개됩니다)
(function () {
  const RAILWAY_API = 'https://day3backend-production-7a45b28f.up.railway.app'; // Railway 주소가 생기면 여기만 바꾸기 (끝에 / 없이)

  const isLocal = ['localhost', '127.0.0.1'].includes(location.hostname);
  window.APP_CONFIG = Object.freeze({
    API_BASE: isLocal ? 'http://127.0.0.1:8000' : RAILWAY_API,
  });
})();
