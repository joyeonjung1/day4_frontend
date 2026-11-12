// 채팅 화면: 질문을 /api/chat (Vercel 서버리스 함수)로 보내고, 답·도구 호출 내역·추천 장소를 보여 준다.
// Gemini 키는 서버에만 있으므로 이 파일에는 비밀 값이 없습니다.
(function () {
  const log = document.getElementById('chat-log');
  const form = document.getElementById('chat-form');
  const input = document.getElementById('chat-q');
  const sendBtn = document.getElementById('chat-send');
  const examples = document.getElementById('examples');
  if (!log) return;

  const history = [];   // [{ role: 'user' | 'model', text }]  — 서버에는 최근 것만 보낸다

  const EXAMPLES = [
    '내일 제주에서 비 오면 갈 만한 실내 장소 추천해줘',
    '오늘 서울 날씨 어때? 산책하기 좋은 곳도 알려줘',
    '부산 해운대 근처 분위기 좋은 카페 추천해줘',
    '강릉 맛집 추천해줘. 날씨도 같이 알려줘',
  ];
  for (const q of EXAMPLES) {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = q;
    b.addEventListener('click', () => { input.value = q; form.requestSubmit(); });
    examples.appendChild(b);
  }

  // **굵게**만 지원하는 안전한 인라인 렌더링 (HTML 을 만들지 않고 DOM 으로 조립)
  function inline(parent, text) {
    text.split(/(\*\*[^*]+\*\*)/g).forEach((part) => {
      if (!part) return;
      if (part.startsWith('**') && part.endsWith('**')) {
        const b = document.createElement('b'); b.textContent = part.slice(2, -2); parent.appendChild(b);
      } else parent.appendChild(document.createTextNode(part));
    });
  }

  // 문단 + 목록(-, *, 1.) 렌더링
  function rich(el, text) {
    let list = null, p = null;
    for (const line of text.split('\n')) {
      const m = line.match(/^\s*(?:[-*•]|\d+\.)\s+(.*)$/);
      if (m) {
        if (!list) { list = document.createElement('ul'); el.appendChild(list); }
        const li = document.createElement('li'); inline(li, m[1]); list.appendChild(li); p = null;
      } else if (line.trim()) {
        list = null;
        p = document.createElement('p'); inline(p, line.trim()); el.appendChild(p);
      } else { list = null; p = null; }
    }
  }

  function bubble(role) {
    const msg = document.createElement('div'); msg.className = 'msg ' + role;
    const b = document.createElement('div'); b.className = 'bubble';
    msg.appendChild(b); log.appendChild(msg);
    log.scrollTop = log.scrollHeight;
    return { msg, b };
  }

  function chips(msg, trace) {
    if (!trace || !trace.length) return;
    const row = document.createElement('div'); row.className = 'tools';
    for (const t of trace) {
      const c = document.createElement('span');
      c.className = 'chip' + (t.ok ? '' : ' fail');
      const a = t.args || {};
      const detail = [a.location, a.category].filter(Boolean).join(' · ');
      c.textContent = `${t.ok ? '🔧' : '⚠️'} ${t.tool}(${detail})${t.ok ? '' : ' 실패'}`;
      if (!t.ok && t.error) c.title = t.error;
      row.appendChild(c);
    }
    msg.appendChild(row);
  }

  async function send(text) {
    history.push({ role: 'user', text });
    const u = bubble('user'); u.b.textContent = text;
    const m = bubble('model'); m.b.classList.add('pending'); m.b.textContent = '날씨와 장소를 찾아보는 중…';
    sendBtn.disabled = true; input.disabled = true;
    try {
      const r = await fetch('/api/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: history.slice(-12) }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || `서버 오류 (HTTP ${r.status})`);

      m.b.classList.remove('pending'); m.b.textContent = '';
      rich(m.b, data.reply || '');
      chips(m.msg, data.trace);
      history.push({ role: 'model', text: data.reply || '' });

      if (data.spots && data.spots.length && window.showSpots) window.showSpots(data.spots);
      // 날씨를 조회했다면 아래 날씨 카드도 그 지역으로 맞춘다
      const w = data.weather && data.weather[0];
      if (w && window.WeatherCard) window.WeatherCard.show({ lat: w.lat, lng: w.lng, label: w.location });
    } catch (e) {
      history.pop();   // 실패한 질문은 대화 기록에서 뺀다 (다시 보낼 수 있게)
      m.b.classList.remove('pending'); m.b.classList.add('err');
      m.b.textContent = '오류: ' + e.message;
    } finally {
      sendBtn.disabled = false; input.disabled = false; input.focus();
      log.scrollTop = log.scrollHeight;
    }
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    send(text);
  });
})();
