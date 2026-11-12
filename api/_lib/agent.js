// 에이전트 루프: 사용자 질문 → Gemini 가 도구를 고름(function calling) → 서버가 도구 실행 → 결과를 Gemini 에게 → 최종 답
import { DECLARATIONS, TOOLS } from './tools.js';

const MODEL = () => (process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite').trim();
// 생각 수준: minimal | low | medium | high  (낮을수록 빠르고 저렴). 환경변수 GEMINI_THINKING_LEVEL 로 변경
const THINKING = () => (process.env.GEMINI_THINKING_LEVEL || 'low').trim().toLowerCase();
const MAX_STEPS = 5;  // 도구 호출 왕복 최대 횟수 (무한 반복·비용 방지)

const SYSTEM = `너는 한국 여행·나들이 추천 에이전트다. 두 가지 도구를 상황에 맞게 골라 쓴다.
- get_weather: 날씨·옷차림·비 여부·미세먼지·야외 활동 가능 여부가 필요할 때.
- find_spots: 장소·맛집·카페·관광지·산책·데이트 추천이 필요할 때.
규칙:
1. 장소 추천 질문은 보통 get_weather 로 날씨를 먼저 확인하고, 그 결과에 맞춰 find_spots 의 category 를 고른다
   (비·눈·강한 미세먼지·추위면 indoor 위주, 맑고 공기가 좋으면 nature/attraction). 날씨만 묻는 질문엔 get_weather 만 쓴다.
2. 도구의 location 인자는 영어 로마자로 넣는다 (예: 제주 → Jeju, 해운대 → Haeundae).
3. 도구 결과에 없는 장소·정보는 지어내지 않는다. 영업시간·가격·평점은 결과에 없으면 "확인 필요"라고 말한다.
4. 답변은 한국어로 간결하게: 날씨 요약 1~2줄 → 추천 3~5곳(이름, 추천 이유, 대략 거리) → 한 줄 팁. 마크다운 목록(-)과 **굵게**만 사용한다.
5. 지역이 전혀 없는 모호한 질문일 때만 어느 지역인지 되묻는다. 지역이 있으면 바로 도구를 호출한다.
6. 한국 밖의 지역이나 위 범위를 벗어난 요청은 정중히 범위를 안내한다.`;

async function callGemini(contents, key) {
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL()}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },   // 키는 헤더로만 (URL·로그에 안 남도록)
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM }] },
      contents,
      tools: [{ functionDeclarations: DECLARATIONS }],
      toolConfig: { functionCallingConfig: { mode: 'AUTO' } },
      generationConfig: { temperature: 0.4, maxOutputTokens: 1500, thinkingConfig: { thinkingLevel: THINKING() } },
    }),
  });
  if (!r.ok) {
    let msg = '';
    try { msg = (await r.json()).error?.message || ''; } catch (e) { /* 본문 없음 */ }
    const err = new Error(`Gemini 호출 실패 (HTTP ${r.status}) ${msg}`.trim());
    err.status = r.status;
    throw err;
  }
  return r.json();
}

// messages: [{ role: 'user'|'model', text }]  → { reply, trace, spots, weather }
export async function runAgent(messages, key) {
  const contents = messages.map((m) => ({ role: m.role, parts: [{ text: m.text }] }));
  const trace = [], spots = [], weather = [];

  for (let step = 0; step < MAX_STEPS; step++) {
    const res = await callGemini(contents, key);
    const cand = res.candidates?.[0];
    const parts = cand?.content?.parts || [];
    const calls = parts.filter((p) => p.functionCall).map((p) => p.functionCall);

    if (!calls.length) {
      const text = parts.map((p) => p.text).filter(Boolean).join('').trim();
      if (!text) {
        const why = res.promptFeedback?.blockReason || cand?.finishReason || '';
        return { reply: `답변을 만들지 못했습니다${why ? ' (' + why + ')' : ''}. 질문을 조금 바꿔서 다시 물어봐 주세요.`, trace, spots, weather };
      }
      return { reply: text, trace, spots, weather };
    }

    contents.push(cand.content);   // 모델이 한 "도구 호출 요청"을 대화에 그대로 남긴다
    // 같은 단계의 도구 호출은 동시에 실행
    const results = await Promise.all(calls.map(async (call) => {
      const fn = TOOLS[call.name];
      const entry = { tool: call.name, args: call.args || {}, ok: true };
      let result;
      try {
        if (!fn) throw new Error('알 수 없는 도구: ' + call.name);
        result = await fn(call.args || {});
        if (call.name === 'find_spots') spots.push(...result.spots.map((s) => ({ ...s, center: result.center })));
        if (call.name === 'get_weather') weather.push({ location: result.location, lat: result.lat, lng: result.lng, now: result.now, air_quality: result.air_quality });
      } catch (e) {
        entry.ok = false; entry.error = e.message;
        result = { error: e.message };       // 실패도 모델에게 알려서 스스로 대응(다른 표기로 재시도 등)하게 한다
      }
      trace.push(entry);
      return { functionResponse: { name: call.name, response: { result } } };
    }));
    contents.push({ role: 'user', parts: results });
  }
  return { reply: '도구를 너무 많이 호출해서 중단했습니다. 질문을 더 구체적으로 해 주세요.', trace, spots, weather };
}
