// POST /api/chat   { messages: [{ role: 'user'|'model', text }] }
// → { reply, trace, spots, weather }
// Gemini 키는 Vercel 환경변수 GEMINI_API_KEY 에만 둡니다 (브라우저로 나가지 않음).
import { runAgent } from './_lib/agent.js';

// 아주 단순한 호출 제한 (서버가 켜져 있는 동안만 유지되는 메모리 방식 — 연습용 방어선)
const hits = new Map();
function limited(ip) {
  const now = Date.now(), WINDOW = 10 * 60 * 1000, MAX = 30;
  const arr = (hits.get(ip) || []).filter((t) => now - t < WINDOW);
  arr.push(now); hits.set(ip, arr);
  if (hits.size > 500) hits.clear();
  return arr.length > MAX;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST 만 지원합니다' });

  const key = (process.env.GEMINI_API_KEY || '').trim();
  if (!key) return res.status(500).json({ error: 'GEMINI_API_KEY 환경변수가 없습니다. Vercel → Settings → Environment Variables 에 추가한 뒤 다시 배포하세요.' });

  const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim();
  if (limited(ip)) return res.status(429).json({ error: '요청이 너무 많습니다. 잠시 뒤 다시 시도하세요.' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = null; } }
  const raw = body?.messages;
  if (!Array.isArray(raw) || !raw.length) return res.status(400).json({ error: 'messages 배열이 필요합니다' });

  // 입력 검증: 길이·개수 제한, 역할은 user/model 만, 마지막은 사용자 말
  const messages = raw.slice(-12)
    .filter((m) => m && (m.role === 'user' || m.role === 'model') && typeof m.text === 'string' && m.text.trim())
    .map((m) => ({ role: m.role, text: m.text.trim().slice(0, 1000) }));
  while (messages.length && messages[0].role !== 'user') messages.shift();   // Gemini 대화는 user 로 시작해야 함
  if (!messages.length || messages[messages.length - 1].role !== 'user') return res.status(400).json({ error: '마지막 메시지는 사용자 질문이어야 합니다' });

  try {
    return res.status(200).json(await runAgent(messages, key));
  } catch (e) {
    console.error('agent error:', e.message);
    const status = e.status === 429 ? 429 : 502;
    return res.status(status).json({ error: e.status === 429 ? 'Gemini 사용량 한도에 걸렸습니다. 잠시 뒤 다시 시도하세요.' : e.message });
  }
}
