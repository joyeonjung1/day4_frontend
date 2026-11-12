// dummyjson.com/products 응답 구조를 한 줄씩 펼쳐 보여 주는 애니메이션 트리 (정적 데이터, 외부 호출 없음)
(function () {
  const tree = document.getElementById('ptree');
  if (!tree) return;

  // [깊이, 이름, 타입, 예시 값]
  const D = [
    [0, 'root', 'object', '{ }'],
    [1, 'products', 'array', '194개 (기본 30개씩)'],
    [2, '[0] 상품 하나', 'object', '{ 20개 필드 }'],
    [3, 'id', 'number', '1'],
    [3, 'title', 'string', '"Essence Mascara Lash Princess"'],
    [3, 'description', 'string', '"The Essence Mascara …"'],
    [3, 'category', 'string', '"beauty"'],
    [3, 'price', 'number', '9.99'],
    [3, 'discountPercentage', 'number', '10.48'],
    [3, 'rating', 'number', '2.56'],
    [3, 'stock', 'number', '99'],
    [3, 'tags', 'array', '["beauty","mascara"]'],
    [3, 'brand', 'string', '"Essence"'],
    [3, 'sku', 'string', '"BEA-ESS-ESS-001"'],
    [3, 'weight', 'number', '4'],
    [3, 'dimensions', 'object', '{ 3개 }'],
    [4, 'width / height / depth', 'number', '15.14 / 13.08 / 22.99'],
    [3, 'warrantyInformation', 'string', '"1 week warranty"'],
    [3, 'shippingInformation', 'string', '"Ships in 3-5 business days"'],
    [3, 'availabilityStatus', 'string', '"In Stock"'],
    [3, 'reviews', 'array', '3개'],
    [4, '[0] 리뷰', 'object', '{ 5개 }'],
    [5, 'rating', 'number', '3'],
    [5, 'comment', 'string', '"Would not recommend!"'],
    [5, 'date', 'string', '"2025-04-30T09:41:02.053Z"'],
    [5, 'reviewerName', 'string', '"Eleanor Collins"'],
    [5, 'reviewerEmail', 'string', '"eleanor.collins@x.dummyjson.com"'],
    [3, 'returnPolicy', 'string', '"No return policy"'],
    [3, 'minimumOrderQuantity', 'number', '48'],
    [3, 'meta', 'object', '{ 4개 }'],
    [4, 'createdAt / updatedAt', 'string', 'ISO 날짜'],
    [4, 'barcode / qrCode', 'string', '"5784719087687" / URL'],
    [3, 'images', 'array', '[URL, …]'],
    [3, 'thumbnail', 'string', '"https://cdn.dummyjson.com/…"'],
    [1, 'total', 'number', '194'],
    [1, 'skip', 'number', '0'],
    [1, 'limit', 'number', '30'],
  ];

  const rows = D.map(([d, k, t, v], i) => {
    const r = document.createElement('div');
    r.className = 'prow';
    r.style.paddingLeft = d * 18 + 'px';
    r._d = d; r._open = true; r._kids = i + 1 < D.length && D[i + 1][0] > d;
    const tg = document.createElement('span'); tg.className = 'ptg'; tg.textContent = r._kids ? '▾' : '';
    const kk = document.createElement('span'); kk.className = 'pk'; kk.textContent = k;
    const tt = document.createElement('span'); tt.className = 'pt pt-' + t; tt.textContent = t;
    const vv = document.createElement('span'); vv.className = 'pv'; vv.textContent = v; vv.title = v;
    if (r._kids) r.classList.add('parent');
    r.append(tg, kk, tt, vv);
    tree.appendChild(r);
    return r;
  });

  function applyHidden() {
    let hideBelow = null;
    for (const r of rows) {
      if (hideBelow !== null && r._d > hideBelow) { r.classList.add('hide'); continue; }
      hideBelow = null; r.classList.remove('hide');
      if (r._kids && !r._open) hideBelow = r._d;
    }
  }
  function setOpen(r, open) { r._open = open; r.querySelector('.ptg').textContent = open ? '▾' : '▸'; }

  rows.forEach((r) => {
    if (r._kids) r.addEventListener('click', () => { setOpen(r, !r._open); applyHidden(); });
  });

  let timers = [];
  function play() {
    timers.forEach(clearTimeout); timers = [];
    rows.forEach((r) => { r.classList.remove('show'); if (r._kids) setOpen(r, true); });
    applyHidden();
    const fast = matchMedia('(prefers-reduced-motion: reduce)').matches;
    rows.forEach((r, i) => timers.push(setTimeout(() => r.classList.add('show'), fast ? 0 : i * 110)));
  }
  document.getElementById('p-play').addEventListener('click', play);
  document.getElementById('p-all').addEventListener('click', () => {
    rows.forEach((r) => { if (r._kids) setOpen(r, true); }); applyHidden();
  });

  // 화면에 보일 때 한 번 재생
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((es) => { if (es[0].isIntersecting) { play(); io.disconnect(); } }, { threshold: 0.2 });
    io.observe(tree);
  } else play();
})();
