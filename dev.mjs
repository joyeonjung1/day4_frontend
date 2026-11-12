// 내 PC에서 Vercel 없이 미리 보기: 정적 파일 + /api/chat 을 한 서버로 띄웁니다.
//   1) .env 파일에 GEMINI_API_KEY=... (그리고 선택으로 KAKAO_REST_API_KEY=...) 를 적고
//   2) npm run dev   →   http://localhost:3000
// (실제 배포는 Vercel 이 이 파일 없이 api/ 폴더를 함수로 올립니다. 이 파일은 로컬 연습용)
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import handler from './api/chat.js';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
const PUBLIC = new Set(['index.html', 'app.js', 'agent.js', 'weather.js', 'cities.js', 'products-tree.js', 'style.css']);   // 서버 코드(api/·.env)는 내보내지 않음

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/api/chat') {
    let raw = '';
    for await (const c of req) raw += c;
    let body; try { body = JSON.parse(raw || '{}'); } catch (e) { body = null; }
    // Vercel 함수와 같은 모양(req.body / res.status().json())으로 맞춰 준다
    const out = { setHeader: (k, v) => res.setHeader(k, v), status(c) { res.statusCode = c; return this; },
      json(o) { res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(JSON.stringify(o)); } };
    return handler({ method: req.method, headers: req.headers, socket: req.socket, body }, out);
  }
  const name = url.pathname === '/' ? 'index.html' : normalize(url.pathname).replace(/^[/\\]+/, '');
  if (!PUBLIC.has(name)) { res.statusCode = 404; return res.end('not found'); }
  try {
    const data = await readFile(join(ROOT, name));
    res.setHeader('Content-Type', TYPES[extname(name)] || 'application/octet-stream');
    res.end(data);
  } catch (e) { res.statusCode = 404; res.end('not found'); }
}).listen(PORT, () => console.log(`http://localhost:${PORT}  (GEMINI_API_KEY ${process.env.GEMINI_API_KEY ? '설정됨' : '없음!'} · KAKAO_REST_API_KEY ${process.env.KAKAO_REST_API_KEY ? '설정됨' : '없음(OSM 대체)'})`));
