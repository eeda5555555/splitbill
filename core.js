// Pure logic: money parsing, exact allocation, bill splitting, receipt text parsing.
// No DOM access, so it runs unchanged in the browser and under node for tests.
(function (root) {
  'use strict';

  const ZERO_DEC = new Set(['IDR', 'JPY', 'KRW', 'VND']);
  const decimalsOf = (cur) => (ZERO_DEC.has(cur) ? 0 : 2);

  // "45.000", "45,000", "1.234,56", "12.50", "Rp 12,5" -> integer minor units, or null.
  function parseMoney(str, dec) {
    if (str == null) return null;
    const s = String(str).replace(/[^\d.,]/g, '');
    if (!/\d/.test(s)) return null;
    if (dec === 0) return parseInt(s.replace(/[.,]/g, ''), 10);

    const lastDot = s.lastIndexOf('.');
    const lastCom = s.lastIndexOf(',');
    const last = Math.max(lastDot, lastCom);
    let intPart = s;
    let frac = '';
    if (last >= 0) {
      const after = s.slice(last + 1);
      const sep = s[last];
      const sepCount = s.split(sep).length - 1;
      const otherSep = lastDot >= 0 && lastCom >= 0;
      const isThousands = !otherSep && (sepCount > 1 || after.length === 3);
      if (!isThousands) {
        intPart = s.slice(0, last);
        frac = after;
      }
    }
    intPart = intPart.replace(/[.,]/g, '') || '0';
    const p = Math.pow(10, dec);
    const fracVal = frac ? Math.round(parseFloat('0.' + frac) * p) : 0;
    return parseInt(intPart, 10) * p + fracVal;
  }

  // Minor units -> plain editable string ("45000", "12.50").
  function formatPlain(minor, dec) {
    if (minor == null) return '';
    const neg = minor < 0;
    const abs = Math.abs(minor);
    const p = Math.pow(10, dec);
    const whole = Math.floor(abs / p);
    const frac = dec ? '.' + String(abs % p).padStart(dec, '0') : '';
    return (neg ? '-' : '') + whole + frac;
  }

  // Split an integer total across integer weights so parts sum EXACTLY to total.
  // Largest-remainder method; `offset` rotates who wins ties so the same person
  // doesn't absorb every stray unit across many items.
  function allocate(total, weights, offset) {
    const n = weights.length;
    if (!n) return [];
    let w = weights.map((x) => Math.max(0, Math.round(x)));
    let sum = w.reduce((a, b) => a + b, 0);
    if (sum <= 0) { w = w.map(() => 1); sum = n; }
    const sign = total < 0 ? -1 : 1;
    const T = BigInt(Math.abs(total));
    const S = BigInt(sum);
    const parts = new Array(n);
    const rems = new Array(n);
    let given = 0n;
    for (let i = 0; i < n; i++) {
      const num = T * BigInt(w[i]);
      parts[i] = num / S;
      rems[i] = num % S;
      given += parts[i];
    }
    let left = Number(T - given);
    const off = offset || 0;
    const order = [...Array(n).keys()].sort((a, b) => {
      if (rems[a] !== rems[b]) return rems[a] > rems[b] ? -1 : 1;
      return ((a - off) % n + n) % n - ((b - off) % n + n) % n;
    });
    for (let k = 0; left > 0; k++, left--) parts[order[k % n]] += 1n;
    return parts.map((x) => sign * Number(x));
  }

  // state: { cur, people:[{id}], items:[{id,price,who:[ids]}], ex:{service,tax,tip,discount:{mode,v}} }
  function splitBill(state) {
    const people = state.people;
    const out = {
      per: {}, subtotal: 0, service: 0, tax: 0, tip: 0, discount: 0, total: 0, sharedCount: 0,
    };
    if (!people.length) return out;
    const ids = people.map((p) => p.id);
    ids.forEach((id) => {
      out.per[id] = { lines: [], sub: 0, service: 0, tax: 0, tip: 0, discount: 0, total: 0 };
    });

    state.items.forEach((it, idx) => {
      const price = it.price || 0;
      let who = (it.who || []).filter((id) => out.per[id]);
      if (!who.length) { who = ids; out.sharedCount++; }
      const shares = allocate(price, who.map(() => 1), idx);
      who.forEach((id, k) => {
        out.per[id].lines.push({ itemId: it.id, share: shares[k], of: who.length });
        out.per[id].sub += shares[k];
      });
      out.subtotal += price;
    });

    const amt = (c, base) => (c.mode === 'pct' ? Math.round((base * (c.v || 0)) / 100) : Math.round(c.v || 0));
    const ex = state.ex;
    out.service = amt(ex.service, out.subtotal);
    out.tax = amt(ex.tax, out.subtotal + out.service);
    out.tip = amt(ex.tip, out.subtotal);
    out.discount = Math.min(amt(ex.discount, out.subtotal), out.subtotal);

    const weights = ids.map((id) => out.per[id].sub);
    [['service', 1], ['tax', 1], ['tip', 1], ['discount', -1]].forEach(([key]) => {
      const parts = allocate(out[key], weights);
      ids.forEach((id, i) => { out.per[id][key] = parts[i]; });
    });
    ids.forEach((id) => {
      const p = out.per[id];
      p.total = p.sub + p.service + p.tax + p.tip - p.discount;
    });
    out.total = out.subtotal + out.service + out.tax + out.tip - out.discount;
    return out;
  }

  // OCR text -> { items:[{name,price}], service, tax, tip, discount, total, subtotal } (minor units).
  const RE = {
    sub: /sub\s*-?\s*total|subtotal/i,
    total: /grand\s*total|total|jumlah|amount\s*due|tagihan|to\s*pay|balance/i,
    tax: /\b(tax|pajak|ppn|pb\s*-?\s*1|vat|gst)\b/i,
    service: /service|servis|\bsvc\b|s\/c|s\.?\s*charge/i,
    discount: /disc|diskon|potongan|promo|voucher/i,
    tip: /\btip\b|gratuity/i,
    skip: /cash|tunai|change|kembali|kartu|card|debit|credit|payment|bayar|rounding|pembulatan|tendered|qris|ovo|gopay|npwp|telp?\b|phone|table|meja|invoice|receipt|struk|kasir|cashier|\border\b|thank|terima kasih|wifi|password|\bpax\b|guest|\b(jl|jalan|street|road|rd|ave|blvd)\b/i,
    time: /\b\d{1,2}[:.]\d{2}(:\d{2})?\s*(am|pm)?\b.*\b\d{4}\b|\b\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}\b|\b\d{1,2}:\d{2}\b/i,
  };

  function parseReceipt(text, dec) {
    const res = { items: [], service: null, tax: null, tip: null, discount: null, total: null, subtotal: null };
    const lines = String(text).split(/\r?\n/);
    for (let raw of lines) {
      let line = raw.replace(/\s+/g, ' ').trim();
      if (!line) continue;
      const toks = [...line.matchAll(/\d[\d.,]*\d|\d/g)];
      if (!toks.length) continue;
      const last = toks[toks.length - 1];
      const price = parseMoney(last[0], dec);
      if (!price || (dec === 0 && price < 100)) continue; // tiny bare numbers are table/house numbers, not prices
      if (line.slice(last.index + last[0].length).trim().startsWith('%')) continue; // "Service 5%" has no amount

      if (RE.sub.test(line)) { res.subtotal = price; continue; }
      if (RE.tax.test(line)) { if (res.tax == null) res.tax = price; continue; }
      if (RE.service.test(line)) { if (res.service == null) res.service = price; continue; }
      if (RE.discount.test(line)) { if (res.discount == null) res.discount = price; continue; }
      if (RE.tip.test(line)) { if (res.tip == null) res.tip = price; continue; }
      if (RE.total.test(line)) { res.total = price; continue; }
      if (RE.skip.test(line) || RE.time.test(line)) continue;

      let name = line.slice(0, last.index);
      name = name.replace(/\d[\d.,]*\s*[xX@]\s*\d[\d.,]*/g, ' ');
      name = name.replace(/\b(rp|idr|usd|eur|sgd|myr)\b\.?/gi, ' ').replace(/[$€£¥]/g, ' ');
      let qty = '';
      const q = name.match(/^\s*(\d{1,2})\s*[xX]?\s+(?=[A-Za-z])/);
      if (q) { if (parseInt(q[1], 10) > 1) qty = q[1] + '× '; name = name.slice(q[0].length); }
      name = name.replace(/[|_*#=~]+/g, ' ').replace(/^[\s.\-:,]+|[\s.\-:,]+$/g, '').replace(/\s+/g, ' ');
      if ((name.match(/[A-Za-z]/g) || []).length < 2) continue;
      res.items.push({ name: qty + name, price });
    }
    return res;
  }

  const api = { decimalsOf, parseMoney, formatPlain, allocate, splitBill, parseReceipt };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SplitCore = api;
})(typeof self !== 'undefined' ? self : this);
