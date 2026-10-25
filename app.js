(function () {
  'use strict';
  const C = SplitCore;
  const $ = (s) => document.querySelector(s);
  const CURRENCIES = ['IDR', 'USD', 'EUR', 'GBP', 'SGD', 'MYR', 'AUD', 'JPY', 'THB', 'KRW', 'VND', 'CAD', 'CHF', 'CNY', 'INR', 'PHP'];
  const EXTRAS = [['service', 'Service'], ['tax', 'Tax'], ['tip', 'Tip'], ['discount', 'Discount']];
  const KEY = 'splitbill.v1';

  const blankEx = () => ({
    service: { mode: 'pct', v: 0 }, tax: { mode: 'pct', v: 0 },
    tip: { mode: 'amt', v: 0 }, discount: { mode: 'amt', v: 0 },
  });
  const fresh = () => ({ cur: 'IDR', people: [], items: [], ex: blankEx(), receiptTotal: null, seq: 1 });

  function load() {
    try {
      const s = JSON.parse(localStorage.getItem(KEY));
      if (s && Array.isArray(s.people) && Array.isArray(s.items) && s.ex) return s;
    } catch (e) { /* storage unavailable or corrupt: start fresh */ }
    return null;
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* ignore */ } }

  let S = load() || fresh();
  const openSet = new Set();
  const dec = () => C.decimalsOf(S.cur);
  const uid = () => 'x' + S.seq++;
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const hue = (p) => p.hue;
  const color = (p) => `hsl(${hue(p)} 62% 38%)`;

  const fmtCache = {};
  function fmt(minor) {
    const key = S.cur;
    if (!fmtCache[key]) {
      const d = dec();
      try {
        fmtCache[key] = new Intl.NumberFormat(key === 'IDR' ? 'id-ID' : undefined,
          { style: 'currency', currency: key, minimumFractionDigits: d, maximumFractionDigits: d });
      } catch (e) { fmtCache[key] = { format: (v) => key + ' ' + v.toFixed(d) }; }
    }
    return fmtCache[key].format(minor / Math.pow(10, dec()));
  }

  // ---------- rendering ----------
  function renderCurrency() {
    $('#cur').innerHTML = CURRENCIES.map((c) => `<option${c === S.cur ? ' selected' : ''}>${c}</option>`).join('');
  }

  function renderPeople() {
    $('#people').innerHTML = S.people.map((p) =>
      `<span class="person" style="--c:${color(p)}">${esc(p.name)}<button class="ghost" data-a="rmPerson" data-p="${p.id}" aria-label="Remove ${esc(p.name)}">✕</button></span>`).join('');
  }

  function renderItems() {
    const el = $('#items');
    if (!S.items.length) {
      el.innerHTML = '<p class="empty">Scan a receipt or add items by hand.</p>';
      return;
    }
    el.innerHTML = S.items.map((it) => {
      const chips = S.people.map((p) =>
        `<button class="chip${it.who.includes(p.id) ? ' on' : ''}" style="--c:${color(p)}" data-a="toggle" data-id="${it.id}" data-p="${p.id}">${esc(p.name)}</button>`).join('');
      const hint = !S.people.length ? 'Add people above, then tap names to assign.'
        : it.who.length ? '' : 'Nobody picked: split between everyone.';
      return `<div class="item">
        <div class="row">
          <input type="text" data-f="name" data-id="${it.id}" value="${esc(it.name)}" placeholder="Item" autocomplete="off">
          <input type="text" class="price" data-f="price" data-id="${it.id}" value="${C.formatPlain(it.price, dec())}" placeholder="0" inputmode="decimal" autocomplete="off">
          <button class="ghost" data-a="delItem" data-id="${it.id}" aria-label="Delete item">✕</button>
        </div>
        ${chips ? `<div class="chips">${chips}</div>` : ''}
        ${hint ? `<p class="hint">${hint}</p>` : ''}
      </div>`;
    }).join('');
  }

  function renderExtras() {
    $('#extras').innerHTML = EXTRAS.map(([k, label]) => {
      const e = S.ex[k];
      const val = e.mode === 'amt' ? (e.v ? C.formatPlain(e.v, dec()) : '') : (e.v ? String(e.v) : '');
      return `<div class="extra">
        <label for="ex-${k}">${label}</label>
        <input type="text" id="ex-${k}" data-f="ex" data-k="${k}" value="${val}" placeholder="0" inputmode="decimal" autocomplete="off">
        <button data-a="mode" data-k="${k}" aria-label="${label}: switch between percent and amount">${e.mode === 'pct' ? '%' : S.cur}</button>
      </div>`;
    }).join('');
  }

  function renderResult() {
    const out = $('#out');
    if (!S.people.length) { out.innerHTML = '<p class="empty">Add people to see the split.</p>'; return; }
    const r = C.splitBill(S);
    const itemById = Object.fromEntries(S.items.map((i) => [i.id, i]));
    let html = S.people.map((p) => {
      const x = r.per[p.id];
      const lines = x.lines.map((l) => {
        const it = itemById[l.itemId];
        const nm = esc((it && it.name) || 'Item');
        return `<div><span>${nm}${l.of > 1 ? ` <small>(÷${l.of})</small>` : ''}</span><span class="amt">${fmt(l.share)}</span></div>`;
      }).join('');
      const extra = [['service', 'Service', 1], ['tax', 'Tax', 1], ['tip', 'Tip', 1], ['discount', 'Discount', -1]]
        .filter(([k]) => x[k]).map(([k, label, sg]) => `<div><span>${label}</span><span class="amt">${sg < 0 ? '−' : ''}${fmt(x[k])}</span></div>`).join('');
      return `<details class="pp" data-p="${p.id}"${openSet.has(p.id) ? ' open' : ''} style="--c:${color(p)}">
        <summary><span class="dot"></span><span class="nm">${esc(p.name)}</span><span class="amt big">${fmt(x.total)}</span></summary>
        <div class="bd">${lines || '<div><span>No items</span></div>'}${extra}</div>
      </details>`;
    }).join('');

    html += `<div class="sum"><span>Bill total</span><span class="amt">${fmt(r.total)}</span></div>
      <div class="fine"><span>Items ${fmt(r.subtotal)}</span><span>${[r.service && 'service ' + fmt(r.service), r.tax && 'tax ' + fmt(r.tax), r.tip && 'tip ' + fmt(r.tip), r.discount && 'discount −' + fmt(r.discount)].filter(Boolean).join(' · ')}</span></div>`;
    if (r.sharedCount) html += `<div class="note">${r.sharedCount} item${r.sharedCount > 1 ? 's' : ''} not assigned, so split between everyone.</div>`;
    const tol = Math.max(Math.round(r.total * 0.005), dec() === 0 ? 100 : 5);   // receipts round; don't nag about that
    if (S.receiptTotal != null && Math.abs(S.receiptTotal - r.total) > tol) {
      html += `<div class="note">Receipt total read as ${fmt(S.receiptTotal)}, this adds up to ${fmt(r.total)} (difference ${fmt(Math.abs(r.total - S.receiptTotal))}). Check prices, tax and service${S.receiptTotal > r.total ? ' (a missed item?)' : ''}.</div>`;
    }
    html += `<div class="row" style="margin-top:12px"><button class="primary" id="share" style="flex:1" ${S.items.length ? '' : 'disabled'}>Share / copy summary</button></div>`;
    out.innerHTML = html;
  }

  function renderAll() { renderCurrency(); renderPeople(); renderItems(); renderExtras(); renderResult(); }
  function changed(structural) { save(); if (structural) { renderItems(); renderPeople(); } renderResult(); }

  // ---------- events ----------
  function addPerson() {
    const input = $('#pname');
    const name = input.value.trim().slice(0, 24);
    if (!name) return;
    S.people.push({ id: uid(), name, hue: (S.people.length * 137.5 + 15 + S.seq * 31) % 360 });
    input.value = '';
    changed(true);
    input.focus();
  }
  $('#padd').addEventListener('click', addPerson);
  $('#pname').addEventListener('keydown', (e) => { if (e.key === 'Enter') addPerson(); });

  $('#addItem').addEventListener('click', () => {
    S.items.push({ id: uid(), name: '', price: null, who: [] });
    changed(true);
    const names = document.querySelectorAll('#items [data-f=name]');
    if (names.length) names[names.length - 1].focus();
  });

  $('#cur').addEventListener('change', (e) => {
    const od = dec();
    S.cur = e.target.value;
    const nd = dec();
    if (od !== nd) {
      const f = Math.pow(10, nd - od);
      const cv = (v) => (v == null ? v : Math.round(v * f));
      S.items.forEach((i) => { i.price = cv(i.price); });
      EXTRAS.forEach(([k]) => { if (S.ex[k].mode === 'amt') S.ex[k].v = cv(S.ex[k].v); });
      if (S.receiptTotal != null) S.receiptTotal = cv(S.receiptTotal);
    }
    save(); renderAll();
  });

  $('#reset').addEventListener('click', () => {
    if (!confirm('Start a new bill? Items and extras are cleared; people are kept.')) return;
    S.items = []; S.ex = blankEx(); S.receiptTotal = null; openSet.clear();
    save(); renderAll();
  });

  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-a]');
    if (!b) return;
    const a = b.dataset.a;
    if (a === 'rmPerson') {
      S.people = S.people.filter((p) => p.id !== b.dataset.p);
      S.items.forEach((i) => { i.who = i.who.filter((id) => id !== b.dataset.p); });
      changed(true);
    } else if (a === 'delItem') {
      S.items = S.items.filter((i) => i.id !== b.dataset.id);
      changed(true);
    } else if (a === 'toggle') {
      const it = S.items.find((i) => i.id === b.dataset.id);
      if (!it) return;
      const p = b.dataset.p;
      it.who = it.who.includes(p) ? it.who.filter((x) => x !== p) : it.who.concat(p);
      changed(true);
    } else if (a === 'mode') {
      const ex = S.ex[b.dataset.k];
      ex.mode = ex.mode === 'pct' ? 'amt' : 'pct';
      ex.v = 0;
      save(); renderExtras(); renderResult();
    }
  });
  document.addEventListener('click', (e) => { if (e.target.id === 'share') shareSummary(); });

  document.addEventListener('input', (e) => {
    const f = e.target.dataset && e.target.dataset.f;
    if (!f) return;
    if (f === 'name') {
      const it = S.items.find((i) => i.id === e.target.dataset.id);
      if (it) { it.name = e.target.value; save(); renderResult(); }
    } else if (f === 'price') {
      const it = S.items.find((i) => i.id === e.target.dataset.id);
      if (it) { it.price = C.parseMoney(e.target.value, dec()); save(); renderResult(); }
    } else if (f === 'ex') {
      const ex = S.ex[e.target.dataset.k];
      ex.v = ex.mode === 'amt' ? (C.parseMoney(e.target.value, dec()) || 0)
        : (parseFloat(e.target.value.replace(',', '.')) || 0);
      save(); renderResult();
    }
  });
  // Tidy the displayed number once editing finishes (keeps typing uninterrupted).
  document.addEventListener('change', (e) => {
    const f = e.target.dataset && e.target.dataset.f;
    if (f === 'price') {
      const it = S.items.find((i) => i.id === e.target.dataset.id);
      if (it) e.target.value = C.formatPlain(it.price, dec());
    } else if (f === 'ex') {
      const ex = S.ex[e.target.dataset.k];
      e.target.value = !ex.v ? '' : ex.mode === 'amt' ? C.formatPlain(ex.v, dec()) : String(ex.v);
    }
  });
  // <details> open state must survive re-renders; 'toggle' doesn't bubble, so capture.
  document.addEventListener('toggle', (e) => {
    const d = e.target;
    if (d.classList && d.classList.contains('pp')) { d.open ? openSet.add(d.dataset.p) : openSet.delete(d.dataset.p); }
  }, true);

  // ---------- share ----------
  function summaryText() {
    const r = C.splitBill(S);
    const itemById = Object.fromEntries(S.items.map((i) => [i.id, i]));
    const parts = S.people.map((p) => {
      const x = r.per[p.id];
      const l = [`${p.name}: ${fmt(x.total)}`];
      x.lines.forEach((ln) => l.push(`  ${(itemById[ln.itemId] || {}).name || 'Item'}${ln.of > 1 ? ` (÷${ln.of})` : ''} ${fmt(ln.share)}`));
      const add = x.service + x.tax + x.tip;
      if (add) l.push(`  service/tax/tip ${fmt(add)}`);
      if (x.discount) l.push(`  discount −${fmt(x.discount)}`);
      return l.join('\n');
    });
    return `Split bill\n\n${parts.join('\n\n')}\n\nTotal ${fmt(r.total)}`;
  }
  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch (e) { /* fall through */ }
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { /* ignore */ }
    ta.remove();
    return ok;
  }
  async function shareSummary() {
    const text = summaryText();
    const btn = $('#share');
    if (navigator.share) {
      try { await navigator.share({ text }); return; } catch (e) { if (e && e.name === 'AbortError') return; }
    }
    const ok = await copyText(text);
    if (btn) { btn.textContent = ok ? 'Copied ✓' : 'Could not copy'; setTimeout(() => { btn.textContent = 'Share / copy summary'; }, 1800); }
  }

  // ---------- receipt scanning ----------
  function setStatus(msg, p) {
    const s = $('#scanStatus'), b = $('#scanBar');
    s.hidden = !msg; s.textContent = msg || '';
    b.hidden = !msg || p == null;
    if (p != null) b.firstElementChild.style.width = Math.round(p * 100) + '%';
  }
  function loadScript(src) {
    return new Promise((res, rej) => {
      if (window.Tesseract) return res();
      const s = document.createElement('script');
      s.src = src; s.onload = res; s.onerror = () => rej(new Error('Could not load the scanner'));
      document.head.appendChild(s);
    });
  }

  // Downscale, grayscale and stretch contrast: small, even text reads far better.
  async function prepare(file) {
    let src;
    try { src = await createImageBitmap(file); }
    catch (e) {
      src = await new Promise((res, rej) => {
        const im = new Image(); const u = URL.createObjectURL(file);
        im.onload = () => res(im); im.onerror = rej; im.src = u;
      });
    }
    const w0 = src.width, h0 = src.height;
    let s = w0 < 1000 ? Math.min(2, 1000 / w0) : Math.min(1, 1500 / w0);
    s = Math.min(s, Math.sqrt(6e6 / (w0 * h0)));
    const cw = Math.max(1, Math.round(w0 * s)), ch = Math.max(1, Math.round(h0 * s));
    const cv = document.createElement('canvas');
    cv.width = cw; cv.height = ch;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(src, 0, 0, cw, ch);
    if (src.close) src.close();
    const img = ctx.getImageData(0, 0, cw, ch), d = img.data;
    const hist = new Uint32Array(256);
    for (let i = 0; i < d.length; i += 4) {
      const g = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000 | 0;
      d[i] = g; hist[g]++;
    }
    const n = cw * ch; let acc = 0, lo = 0, hi = 255;
    for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= n * 0.02) { lo = v; break; } }
    acc = 0;
    for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc >= n * 0.02) { hi = v; break; } }
    const span = Math.max(1, hi - lo);
    for (let i = 0; i < d.length; i += 4) {
      const v = Math.max(0, Math.min(255, ((d[i] - lo) * 255 / span) | 0));
      d[i] = d[i + 1] = d[i + 2] = v;
    }
    ctx.putImageData(img, 0, 0);
    return cv;
  }

  async function ocr(canvas) {
    const base = new URL('vendor/', location.href).href;   // worker resolves paths from its own URL, so be absolute
    await loadScript(base + 'tesseract.min.js');
    const worker = await Tesseract.createWorker('eng+ind', 1, {
      workerPath: base + 'worker.min.js',
      corePath: base,
      langPath: base + 'lang',
      workerBlobURL: false,
      cacheMethod: 'none',
      logger: (m) => { if (m.status === 'recognizing text') setStatus(`Reading receipt… ${Math.round(m.progress * 100)}%`, 0.15 + 0.85 * m.progress); },
    });
    try {
      await worker.setParameters({ tessedit_pageseg_mode: '6', preserve_interword_spaces: '1' });
      const { data } = await worker.recognize(canvas);
      return data.text;
    } finally {
      await worker.terminate();   // frees the ~100MB wasm heap on the phone
    }
  }

  function applyScan(parsed) {
    parsed.items.forEach((it) => S.items.push({ id: uid(), name: it.name, price: it.price, who: [] }));
    ['service', 'tax', 'tip', 'discount'].forEach((k) => { if (parsed[k] != null) S.ex[k] = { mode: 'amt', v: parsed[k] }; });
    if (parsed.total != null) S.receiptTotal = parsed.total;
    save(); renderItems(); renderExtras(); renderResult();
  }

  $('#scan').addEventListener('click', () => $('#file').click());
  $('#file').addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const btn = $('#scan'); btn.disabled = true;
    try {
      setStatus('Preparing photo…', 0.05);
      const canvas = await prepare(file);
      setStatus('Loading reader…', 0.1);
      const text = await ocr(canvas);
      const parsed = C.parseReceipt(text, dec());
      applyScan(parsed);
      setStatus(parsed.items.length
        ? `Found ${parsed.items.length} item${parsed.items.length > 1 ? 's' : ''}. Check names and prices against the receipt.`
        : 'No items found. Try a flatter, brighter photo, or add items by hand.');
    } catch (err) {
      setStatus('Scan failed: ' + (err && err.message ? err.message : err));
    } finally {
      btn.disabled = false;
    }
  });

  renderAll();

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  window.__split = { get state() { return S; }, applyScan, ocr, prepare };   // handy for testing in devtools
})();
