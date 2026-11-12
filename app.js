/* BRASÊ | vitrine de pedidos + biolink | VOLTZ MEDIA */
(() => {
'use strict';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const body = document.body;
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ============ CONFIG (editável) ============ */
const CONFIG = {
  whatsapp: '5586981007375',
  tz: 'America/Fortaleza',
  // abre em minutos desde 00:00, por dia da semana (0 = domingo). Todos fecham às 00h30 do dia seguinte.
  open: { 0: 660, 1: 1020, 2: 1020, 3: 1020, 4: 1020, 5: 1020, 6: 660 },
  closeSpill: 30,
  // benefício do pedido direto: deixar vazio até o cliente confirmar. Ex.: 'Pedindo direto, ...'
  benefit: '',
  links: {
    f99: 'https://oia.99app.com/dlp9/4RKqci',
    ifood: 'https://www.ifood.com.br/busca?q=Bras%C3%AA%20Teresina' // a confirmar com o cliente
  },
  address: 'Av. Nossa Sra. de Fátima, 135, Jóquei, Teresina (PI)',
  pixelId: '',      // Meta Pixel (vazio = desligado)
  ga4Id: '',        // GA4 (vazio = desligado)
  consent: true,    // trocar para false para só disparar depois de aceite
  pixelMap: { ver_cardapio: 'ViewContent', adicionar_item: 'AddToCart', iniciar_pedido: 'InitiateCheckout', pedido_enviado_whatsapp: 'Purchase' }
};

/* ============ utilidades ============ */
const brl = v => 'R$ ' + v.toLocaleString('pt-BR', { minimumFractionDigits: Number.isInteger(v) ? 0 : 2, maximumFractionDigits: 2 });
const norm = s => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const clean = s => (s || '').replace(/[*_~`]/g, '').replace(/\s+/g, ' ').trim();
const cleanMulti = s => (s || '').replace(/[*_~`]/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const store = {
  get(k) { try { const v = localStorage.getItem('brase:' + k); return v == null ? null : JSON.parse(v); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem('brase:' + k, JSON.stringify(v)); } catch (e) {} },
  clear() { try { Object.keys(localStorage).filter(k => k.startsWith('brase:')).forEach(k => localStorage.removeItem(k)); } catch (e) {} }
};
const mulberry = a => () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const wa = text => 'https://wa.me/' + CONFIG.whatsapp + '?text=' + encodeURIComponent(text);
let toastT;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  t.style.animation = 'none'; void t.offsetWidth; t.style.animation = '';
  clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, 2800);
}

/* ============ horário (Fortaleza) ============ */
function nowParts() {
  const d = window.__fakeNow ? new Date(window.__fakeNow) : new Date();
  const f = new Intl.DateTimeFormat('en-US', { timeZone: CONFIG.tz, weekday: 'short', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' });
  const p = Object.fromEntries(f.formatToParts(d).map(x => [x.type, x.value]));
  const day = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[p.weekday];
  const h = parseInt(p.hour, 10) % 24, m = parseInt(p.minute, 10);
  return { day, h, m, mins: h * 60 + m, date: d };
}
function openState() {
  const n = nowParts();
  const isOpen = n.mins >= CONFIG.open[n.day] || n.mins < CONFIG.closeSpill;
  const fh = v => { const hh = Math.floor(v / 60), mm = v % 60; return mm ? `${hh}h${String(mm).padStart(2, '0')}` : `${hh}h`; };
  return { isOpen, n, opensAt: fh(CONFIG.open[n.day]), text: isOpen ? 'Aberto agora, até 00h30' : `Fechado agora. Abre hoje às ${fh(CONFIG.open[n.day])}` };
}
function refreshStatus() {
  const s = openState();
  const el = $('#status');
  el.className = 'status ' + (s.isOpen ? 'open' : 'closed');
  $('span', el).textContent = s.text;
  const cn = $('#closed-note');
  if (s.isOpen) cn.hidden = true;
  else { cn.hidden = false; cn.textContent = `Estamos fechados agora. Se você enviar o pedido, ele fica registrado para quando abrirmos, hoje às ${s.opensAt}.`; }
  $$('#hours li').forEach(li => li.classList.toggle('today', +li.dataset.d === s.n.day));
  return s;
}

/* ============ origem (UTM) e rastreio ============ */
const UTM = (() => {
  let o = {};
  try {
    const q = new URLSearchParams(location.search);
    ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'].forEach(k => { if (q.get(k)) o[k] = q.get(k).slice(0, 60); });
    if (Object.keys(o).length) { try { sessionStorage.setItem('brase:utm', JSON.stringify(o)); } catch (e) {} }
    else { try { o = JSON.parse(sessionStorage.getItem('brase:utm') || '{}'); } catch (e) { o = {}; } }
  } catch (e) {}
  return o;
})();
const originText = () => {
  const k = Object.keys(UTM);
  return k.length ? 'página de pedidos (' + k.map(x => x.replace('utm_', '') + ': ' + UTM[x]).join(', ') + ')' : 'página de pedidos (acesso direto)';
};
window.dataLayer = window.dataLayer || [];
function loadTrackers() {
  if (!CONFIG.consent) return;
  try {
    if (CONFIG.ga4Id) {
      const s = document.createElement('script'); s.async = true; s.src = 'https://www.googletagmanager.com/gtag/js?id=' + CONFIG.ga4Id; document.head.appendChild(s);
      window.gtag = function () { window.dataLayer.push(arguments); }; gtag('js', new Date()); gtag('config', CONFIG.ga4Id);
    }
    if (CONFIG.pixelId) {
      !function (f, b, e, v, n, t, s) { if (f.fbq) return; n = f.fbq = function () { n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments); }; if (!f._fbq) f._fbq = n; n.push = n; n.loaded = !0; n.version = '2.0'; n.queue = []; t = b.createElement(e); t.async = !0; t.src = v; s = b.getElementsByTagName(e)[0]; s.parentNode.insertBefore(t, s); }(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js');
      fbq('init', CONFIG.pixelId); fbq('track', 'PageView');
    }
  } catch (e) {}
}
const trackLog = [];
function track(name, params = {}) {
  const p = Object.assign({}, params, UTM);
  trackLog.push({ name, p });
  if (!CONFIG.consent) return;
  try {
    window.dataLayer.push(Object.assign({ event: name }, p));
    if (window.gtag && CONFIG.ga4Id) gtag('event', name, p);
    if (window.fbq && CONFIG.pixelId) {
      const std = CONFIG.pixelMap[name];
      const fp = p.value != null ? { value: p.value, currency: 'BRL' } : {};
      if (std) fbq('track', std, fp); else fbq('trackCustom', name, p);
    }
  } catch (e) {}
}

/* ============ dados do cardápio ============ */
const DATA = JSON.parse($('#menu-data').textContent);
const ITEMS = DATA.items, OPTS = DATA.opts, CATS = DATA.cats;
const BYID = Object.fromEntries(ITEMS.map(i => [i.id, i]));

/* ============ links ============ */
function setupLinks() {
  $('#wa-fale').href = wa('Olá, Brasê! Vim pela página de pedidos e quero fazer uma reserva.');
  $('#wa-happy').href = wa('Olá, Brasê! Vim pela página e queria saber como funciona o happy hour das 17h às 20h.');
  $('#c-wa').href = wa('Olá, Brasê! Vim pela página de pedidos.');
  $('#l-99').href = $('#c-99').href = CONFIG.links.f99;
  $('#l-ifood').href = $('#c-ifood').href = CONFIG.links.ifood;
  const b = $('#benefit');
  if (CONFIG.benefit) { b.textContent = CONFIG.benefit; b.hidden = false; }
  $$('.btn-main').forEach(btn => { ['rip', 'rip r2'].forEach(c => { const r = document.createElement('i'); r.className = c; r.setAttribute('aria-hidden', 'true'); btn.appendChild(r); }); });
  document.addEventListener('click', e => {
    const t = e.target.closest('[data-track]');
    if (t) track(t.dataset.track, { origem: t.id || t.dataset.track });
  });
}

/* ============ palavras, entradas, seções vivas ============ */
function splitWords() {
  $$('.words').forEach(h => {
    const txt = h.textContent.trim(); h.setAttribute('aria-label', txt);
    h.innerHTML = txt.split(/\s+/).map((w, i) => `<span class="w" aria-hidden="true"><i style="--i:${i}">${w}</i></span>`).join(' ');
  });
}
function setupReveal() {
  $$('.dish').forEach((d, i) => d.style.setProperty('--k', i % 6));
  const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
  $$('.rv-up,.rv-left,.rv-right,.rv-scale,.rv-blur,.words,.dish').forEach(el => io.observe(el));
  const vio = new IntersectionObserver(es => es.forEach(e => e.target.classList.toggle('vis', e.isIntersecting)), { rootMargin: '120px 0px' });
  $$('.sec').forEach(s => vio.observe(s));
}

/* ============ menu: scroll-spy e progresso ============ */
const dock = $('#dock');
const dockLinks = $$('a[data-sp]', dock);
const sections = dockLinks.map(a => $('#' + a.dataset.sp));
let curSec = '';
function onScroll() {
  const vh = innerHeight, y = scrollY;
  const max = document.documentElement.scrollHeight - vh;
  $('#progress').style.setProperty('--p', max > 0 ? clamp(y / max, 0, 1).toFixed(4) : 0);
  let act = sections[0].id;
  for (const s of sections) { const r = s.getBoundingClientRect(); if (r.top <= vh * 0.38) act = s.id; }
  if (max - y < 40) act = sections[sections.length - 1].id;
  if (act !== curSec) {
    curSec = act;
    dockLinks.forEach(a => {
      const on = a.dataset.sp === act; a.classList.toggle('on', on);
      if (on) { a.setAttribute('aria-current', 'true'); dock.scrollTo({ left: a.offsetLeft - (dock.clientWidth - a.offsetWidth) / 2, behavior: reduce ? 'auto' : 'smooth' }); }
      else a.removeAttribute('aria-current');
    });
    document.dispatchEvent(new CustomEvent('sectionchange', { detail: act }));
  }
  menuSpy();
  parallax();
}
let ticking = false;
addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(() => { ticking = false; onScroll(); }); } }, { passive: true });
addEventListener('resize', () => requestAnimationFrame(onScroll));

function parallax() {
  if (reduce) return;
  $$('.collage figure img').forEach((im, i) => {
    const r = im.parentElement.getBoundingClientRect();
    if (r.bottom < 0 || r.top > innerHeight) return;
    const k = ((r.top + r.height / 2) - innerHeight / 2) / innerHeight;
    im.style.translate = `0 ${(k * -18 * (i % 2 ? -1 : 1)).toFixed(1)}px`;
  });
}

/* ============ steppers genéricos ============ */
function setupSteppers() {
  $$('[data-stepper]').forEach(st => {
    const out = $('output', st), step = +(st.dataset.step || 1), min = +(st.dataset.min || 1), max = +(st.dataset.max || 30);
    st.addEventListener('click', e => {
      const b = e.target.closest('button[data-d]'); if (!b) return;
      const v = clamp(+out.textContent + step * +b.dataset.d, min, max);
      out.textContent = v; out.animate && !reduce && out.animate([{ transform: 'scale(1.35)' }, { transform: 'scale(1)' }], { duration: 260, easing: 'ease-out' });
      st.dispatchEvent(new CustomEvent('stepchange', { bubbles: true, detail: v }));
    });
  });
  $$('.seg,.chipset').forEach(g => g.addEventListener('click', e => {
    const b = e.target.closest('button[role=radio]'); if (!b) return;
    $$('button[role=radio]', g).forEach(x => x.setAttribute('aria-checked', x === b ? 'true' : 'false'));
    g.dispatchEvent(new CustomEvent('segchange', { bubbles: true, detail: b }));
  }));
}

/* ============ ABERTURA: ACENDA A BRASA ============ */
function setupIntro() {
  const intro = $('#intro'), cv = $('#fire'), ctx = cv.getContext('2d');
  const skip = $('#skip'), meter = $('#heat-fill'), turb = $('#heat-turb'), disp = $('#heat-disp');
  let W = 0, H = 0, DPR = 1, heat = 0, pressing = false, px = 0.5, py = 0.6, lit = false, finished = false, t0 = performance.now(), last = t0, litAt = 0;
  const rnd = mulberry(7);
  let coals = [], embers = [], flames = [], sparks = [];
  function size() {
    DPR = Math.min(devicePixelRatio || 1, 2); W = innerWidth; H = innerHeight;
    cv.width = W * DPR; cv.height = H * DPR; ctx.setTransform(DPR, 0, 0, DPR, 0, 0); build();
  }
  function build() {
    const r = mulberry(11); coals = []; embers = [];
    const y0 = H * 0.56, yb = H * 0.88, n = Math.round(W / 11);
    for (let i = 0; i < n * 5; i++) {
      const x = r() * W, y = y0 + 14 + r() * (yb - y0 - 14), s = 14 + r() * 24, k = 5 + Math.floor(r() * 3);
      const pts = []; for (let j = 0; j < k; j++) { const a = j / k * Math.PI * 2 + r() * .6; pts.push([Math.cos(a) * s * (.7 + r() * .5), Math.sin(a) * s * .62 * (.7 + r() * .5)]); }
      coals.push({ x, y, pts, tone: r() });
    }
    coals.sort((a, b) => a.y - b.y);
    for (let i = 0; i < 70; i++) embers.push({ x: r() * W, y: y0 + 18 + r() * (yb - y0 - 30), r: 6 + r() * 16, ph: r() * 6.28, sp: .6 + r() * 1.4 });
  }
  function spawnFlame(n) {
    for (let i = 0; i < n && flames.length < 260; i++) {
      const x = pressing && rnd() < .55 ? px * W + (rnd() - .5) * 90 : rnd() * W;
      flames.push({ x, y: H * 0.6 + rnd() * H * 0.1, vx: (rnd() - .5) * 18, vy: -(60 + rnd() * 140) * (0.6 + heat), life: 0, max: .6 + rnd() * .9, r: 14 + rnd() * 30 });
    }
  }
  function spawnSpark(n, ax) {
    for (let i = 0; i < n && sparks.length < 240; i++) {
      const x = ax != null ? ax + (rnd() - .5) * 70 : rnd() * W;
      sparks.push({ x, y: H * 0.6 + rnd() * H * 0.12, vx: (rnd() - .5) * 90, vy: -(120 + rnd() * 320), life: 0, max: .8 + rnd() * 1.4, s: 1 + rnd() * 2.2 });
    }
  }
  function frame(now) {
    if (finished) return;
    const dt = Math.min(.05, (now - last) / 1000); last = now;
    const el = (now - t0) / 1000;
    if (!lit) {
      const auto = el > .35 ? dt / 1.9 : 0;
      heat = clamp(heat + (pressing ? dt / 1.15 : auto) - (pressing ? 0 : 0), 0, 1.0);
      if (heat >= 1) ignite();
    } else { heat = 1; }
    meter.style.transform = `scaleX(${clamp(heat, 0, 1)})`;
    draw(el, dt);
    if (lit && now - litAt > 1250) { finishIntro(); return; }
    requestAnimationFrame(frame);
  }
  function ignite() {
    if (lit) return; lit = true; litAt = performance.now();
    intro.classList.add('lit');
    cv.style.filter = 'url(#heat)';
    spawnFlame(80); spawnSpark(60);
    try { navigator.vibrate && navigator.vibrate(40); } catch (e) {}
  }
  function draw(el, dt) {
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#0B0706'; ctx.fillRect(0, 0, W, H);
    const y0 = H * 0.56;
    // fundo: calor sobe
    const g = ctx.createLinearGradient(0, y0 - H * .5, 0, y0 + 40);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, `rgba(161,24,18,${.05 + heat * .38})`);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    // brasas (carvão)
    for (const c of coals) {
      const near = pressing ? Math.max(0, 1 - Math.hypot(c.x - px * W, c.y - py * H) / (W * .5)) : 0;
      const b = clamp(.03 + heat * (.45 + near * .55) * (.55 + .45 * Math.sin(el * 2 + c.x)), 0, 1);
      ctx.beginPath(); ctx.moveTo(c.x + c.pts[0][0], c.y + c.pts[0][1]); for (let i = 1; i < c.pts.length; i++) ctx.lineTo(c.x + c.pts[i][0], c.y + c.pts[i][1]); ctx.closePath();
      const base = 20 + c.tone * 18, rr = Math.round(base + b * 220), gg = Math.round(base * .7 + b * 90), bb = Math.round(base * .6 + b * 26);
      ctx.fillStyle = `rgb(${rr},${gg},${bb})`; ctx.fill();
      ctx.strokeStyle = `rgba(255,${Math.round(120 + b * 80)},60,${b * .6})`; ctx.lineWidth = 1; ctx.stroke();
    }
    // pontos de brasa morta que pulsam fraco
    ctx.globalCompositeOperation = 'lighter';
    for (const e of embers) {
      const near = pressing ? Math.max(0, 1 - Math.hypot(e.x - px * W, e.y - py * H) / (W * .45)) : 0;
      const a = clamp((.05 + .06 * Math.sin(el * e.sp + e.ph)) + heat * (.5 + near * .5), 0, .95);
      const gr = ctx.createRadialGradient(e.x, e.y, 0, e.x, e.y, e.r * (1 + heat * 1.6));
      gr.addColorStop(0, `rgba(255,150,60,${a})`); gr.addColorStop(1, 'rgba(161,24,18,0)');
      ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(e.x, e.y, e.r * (1 + heat * 1.6), 0, 7); ctx.fill();
    }
    // chamas
    const rate = heat * heat * 110 + (lit ? 120 : 0);
    spawnFlame(Math.floor(rate * dt + Math.random()));
    if (pressing && !lit) spawnSpark(Math.floor(40 * dt + Math.random() * 1.2), px * W);
    if (lit) spawnSpark(Math.floor(30 * dt + Math.random()));
    flames = flames.filter(f => (f.life += dt) < f.max);
    for (const f of flames) {
      f.x += f.vx * dt + Math.sin(el * 6 + f.y * .02) * 14 * dt; f.y += f.vy * dt;
      const k = f.life / f.max, r = f.r * (1 - k * .75) * (.6 + heat * .7);
      const gr = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, r);
      gr.addColorStop(0, `rgba(255,${Math.round(220 - k * 120)},${Math.round(130 - k * 100)},${(1 - k) * .55})`);
      gr.addColorStop(.5, `rgba(255,${Math.round(110 - k * 60)},40,${(1 - k) * .3})`);
      gr.addColorStop(1, 'rgba(161,24,18,0)');
      ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(f.x, f.y, r, 0, 7); ctx.fill();
    }
    // grelha
    ctx.globalCompositeOperation = 'source-over';
    const gy = y0 - 6, bars = 7;
    for (let i = 0; i < bars; i++) {
      const y = gy + i * 3.2, w = 3 - i * .12;
      ctx.fillStyle = `rgba(${38 + heat * 120},${34 + heat * 50},${30 + heat * 20},1)`;
      ctx.fillRect(0, y, W, w + 1.2);
    }
    for (let x = 6; x < W; x += 34) { ctx.fillStyle = `rgba(${30 + heat * 80},26,24,1)`; ctx.fillRect(x, gy - 2, 3, 26); }
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = `rgba(255,140,50,${heat * .28})`; ctx.fillRect(0, gy - 3, W, 2);
    // fagulhas
    sparks = sparks.filter(s => (s.life += dt) < s.max);
    for (const s of sparks) {
      s.vy += 40 * dt; s.x += s.vx * dt + Math.sin(el * 9 + s.y * .03) * 22 * dt; s.y += s.vy * dt;
      const k = s.life / s.max;
      ctx.fillStyle = `rgba(255,${Math.round(200 - k * 110)},${Math.round(110 - k * 80)},${1 - k})`;
      ctx.beginPath(); ctx.arc(s.x, s.y, s.s * (1 - k * .5), 0, 7); ctx.fill();
      ctx.strokeStyle = `rgba(255,170,80,${(1 - k) * .4})`; ctx.lineWidth = s.s * .5; ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(s.x - s.vx * .03, s.y - s.vy * .03); ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
    // distorção de calor
    const tf = .012 + Math.sin(el * 1.6) * .003; if (turb) turb.setAttribute('baseFrequency', `${tf.toFixed(4)} ${(tf * 2.6).toFixed(4)}`);
    if (disp) disp.setAttribute('scale', String(Math.round(heat * heat * 26)));
  }
  function finishIntro() {
    if (finished) return; finished = true;
    intro.classList.add('done'); body.classList.remove('intro-on'); body.classList.add('roast');
    setTimeout(() => body.classList.remove('roast'), 1700);
    setTimeout(() => { cv.width = cv.height = 1; intro.remove(); document.dispatchEvent(new Event('introdone')); }, 1000);
    document.dispatchEvent(new Event('introend'));
  }
  const pos = e => { px = clamp(e.clientX / W, 0, 1); py = clamp(e.clientY / H, 0, 1); };
  intro.addEventListener('pointerdown', e => { if (e.target.closest('.skip')) return; pressing = true; intro.classList.add('held'); pos(e); try { intro.setPointerCapture(e.pointerId); } catch (x) {} });
  intro.addEventListener('pointermove', e => { if (pressing) pos(e); });
  const up = () => { pressing = false; intro.classList.remove('held'); };
  intro.addEventListener('pointerup', up); intro.addEventListener('pointercancel', up); intro.addEventListener('lostpointercapture', up);
  intro.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { heat = 1; } });
  skip.addEventListener('click', () => { lit = true; litAt = 0; finishIntro(); });
  addEventListener('resize', () => { if (!finished) size(); });
  if (reduce) { skip.click(); return; }
  size(); requestAnimationFrame(frame);
  window.__intro = { skip: () => skip.click(), get heat() { return heat; } };
}

/* ============ brasas leves na primeira tela ============ */
function setupEmbers() {
  const cv = $('.embers'), sec = $('#links'); if (!cv || reduce) return;
  const ctx = cv.getContext('2d'); let W, H, DPR, ps = [];
  const rnd = mulberry(23);
  function size() { DPR = Math.min(devicePixelRatio || 1, 2); W = sec.clientWidth; H = sec.clientHeight; cv.width = W * DPR; cv.height = H * DPR; ctx.setTransform(DPR, 0, 0, DPR, 0, 0); }
  size(); addEventListener('resize', size);
  for (let i = 0; i < 42; i++) ps.push({ x: rnd() * 1, y: rnd(), s: .6 + rnd() * 2, v: .02 + rnd() * .05, ph: rnd() * 6.28, a: .3 + rnd() * .6 });
  let last = performance.now();
  (function loop(now) {
    requestAnimationFrame(loop);
    if (!sec.classList.contains('vis')) return;
    const dt = Math.min(.05, (now - last) / 1000); last = now;
    ctx.clearRect(0, 0, W, H); ctx.globalCompositeOperation = 'lighter';
    for (const p of ps) {
      p.y -= p.v * dt; if (p.y < -.05) { p.y = 1.05; p.x = rnd(); }
      const x = p.x * W + Math.sin(now / 900 + p.ph) * 14, y = p.y * H;
      const a = p.a * clamp(p.y * 1.4, 0, 1) * (.6 + .4 * Math.sin(now / 300 + p.ph));
      const g = ctx.createRadialGradient(x, y, 0, x, y, p.s * 5);
      g.addColorStop(0, `rgba(255,150,60,${a})`); g.addColorStop(1, 'rgba(161,24,18,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, p.s * 5, 0, 7); ctx.fill();
    }
  })(last);
}

/* ============ MOTOR DE PEDIDOS ============ */
const cart = (store.get('cart') || []).filter(l => BYID[l.id]);
const customer = Object.assign({ mode: '', rua: '', bairro: '', compl: '', nome: '', fone: '', pay: '', troco: '' }, store.get('cust') || {});
const money = { shown: 0 };
const lineKey = l => [l.id, l.opt || '', l.note || ''].join('|');
const lineTotal = l => BYID[l.id].p * l.qty;
const cartCount = () => cart.reduce((a, l) => a + l.qty, 0);
const cartTotal = () => cart.reduce((a, l) => a + lineTotal(l), 0);
function persistCart() { store.set('cart', cart); }
function persistCust() { store.set('cust', customer); }

function tween(el, from, to, fmt, ms = 450) {
  if (reduce || from === to) { el.textContent = fmt(to); return; }
  const t0 = performance.now();
  (function s(n) { const k = clamp((n - t0) / ms, 0, 1), e = 1 - Math.pow(1 - k, 3); el.textContent = fmt(from + (to - from) * e); if (k < 1) requestAnimationFrame(s); })(t0);
}
function refreshCartUI(bump) {
  const n = cartCount(), tot = cartTotal(), bar = $('#cartbar');
  bar.hidden = n === 0 || sheetOpen;
  $('#cb-n').textContent = n + (n === 1 ? ' item' : ' itens');
  tween($('#cb-total'), money.shown, tot, v => brl(Math.round(v * 100) / 100));
  money.shown = tot;
  if (bump) { bar.classList.remove('bump'); void bar.offsetWidth; bar.classList.add('bump'); }
  const per = {}; cart.forEach(l => per[l.id] = (per[l.id] || 0) + l.qty);
  $$('.dish').forEach(d => {
    const q = per[d.dataset.id] || 0; d.classList.toggle('in-cart', q > 0);
    let b = $('.qtybadge', d);
    if (q > 0) { if (!b) { b = document.createElement('span'); b.className = 'qtybadge'; d.appendChild(b); } b.textContent = q; } else if (b) b.remove();
  });
  document.dispatchEvent(new CustomEvent('cartchange'));
}
function flyTo(srcEl, item) {
  if (reduce || !srcEl) return;
  const bar = $('#cartbar'); if (bar.hidden) return;
  const a = srcEl.getBoundingClientRect(), b = $('#cartbtn').getBoundingClientRect();
  const f = $('#flyer'); f.style.backgroundImage = item.ph ? `url(assets/${item.ph}.webp)` : 'none';
  const sx = a.left + a.width / 2 - 27, sy = a.top + a.height / 2 - 27, ex = b.left + 40, ey = b.top + b.height / 2 - 27;
  f.animate([{ transform: `translate(${sx}px,${sy}px) scale(1)`, opacity: 1 }, { transform: `translate(${(sx + ex) / 2}px,${Math.min(sy, ey) - 60}px) scale(.8)`, opacity: 1, offset: .5 }, { transform: `translate(${ex}px,${ey}px) scale(.3)`, opacity: .2 }], { duration: 650, easing: 'cubic-bezier(.4,.1,.3,1)' });
}
function addLine(id, qty = 1, opt = '', note = '', src) {
  const it = BYID[id]; if (!it) return;
  const l = { id, qty, opt, note: cleanMulti(note).slice(0, 140) };
  const ex = cart.find(x => lineKey(x) === lineKey(l));
  if (ex) ex.qty = clamp(ex.qty + qty, 1, 99); else cart.push(l);
  persistCart();
  const wasHidden = $('#cartbar').hidden;
  refreshCartUI(true);
  if (wasHidden) requestAnimationFrame(() => flyTo(src, it)); else flyTo(src, it);
  const btn = src && src.classList && src.classList.contains('add') ? src : null;
  if (btn) { btn.classList.remove('pop'); void btn.offsetWidth; btn.classList.add('pop'); }
  track('adicionar_item', { item: it.n, value: it.p * qty, quantidade: qty });
}

/* ---------- sheet (carrinho, opções, checkout) ---------- */
let sheetOpen = false, lastFocus = null, mode = 'cart', step = 0;
const sheet = $('#sheet'), scrim = $('#scrim');
function openSheet(m) {
  mode = m; if (!sheetOpen) { lastFocus = document.activeElement; }
  sheetOpen = true; body.classList.add('sheet-open'); body.style.overflow = 'hidden';
  sheet.hidden = false; scrim.hidden = false; sheet.classList.remove('closing'); scrim.classList.remove('closing');
  $('#cartbar').hidden = true;
  document.dispatchEvent(new CustomEvent('sheetstate', { detail: true }));
  setTimeout(() => $('#sh-close').focus({ preventScroll: true }), 80);
}
function closeSheet() {
  if (!sheetOpen) return;
  sheetOpen = false; sheet.classList.add('closing'); scrim.classList.add('closing');
  const done = () => { sheet.hidden = true; scrim.hidden = true; sheet.classList.remove('closing'); scrim.classList.remove('closing'); body.style.overflow = ''; body.classList.remove('sheet-open'); refreshCartUI(); if (lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true }); };
  reduce ? done() : setTimeout(done, 300);
  document.dispatchEvent(new CustomEvent('sheetstate', { detail: false }));
}
$('#sh-close').addEventListener('click', closeSheet);
scrim.addEventListener('click', closeSheet);
document.addEventListener('keydown', e => {
  if (!sheetOpen) return;
  if (e.key === 'Escape') closeSheet();
  if (e.key === 'Tab') {
    const f = $$('button,a[href],input,textarea,select', sheet).filter(x => !x.disabled && x.offsetParent !== null);
    if (!f.length) return; const a = f[0], z = f[f.length - 1];
    if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); } else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
  }
});
function setSteps(n) {
  const w = $('#sh-steps');
  if (n < 1) { w.innerHTML = ''; return; }
  w.innerHTML = [1, 2, 3, 4, 5].map(i => `<i class="${i < n ? 'done' : i === n ? 'on' : ''}"></i>`).join('');
}
function render(title, html, foot, cls = '') {
  $('#sh-title').textContent = title;
  const b = $('#sh-body'); b.className = 'sh-body swap ' + cls; b.innerHTML = html; b.scrollTop = 0;
  $('#sh-foot').innerHTML = foot;
  void b.offsetWidth;
}
const ic = n => `<svg class="ic" viewBox="0 0 256 256" aria-hidden="true" fill="currentColor"><use href="#i-${n}"/></svg>`;
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ---------- opções do prato ---------- */
function openOptions(id, src) {
  const it = BYID[id], o = it.o;
  const isNote = !!o && o.startsWith('nota:'), og = o && !isNote ? OPTS[o] : null;
  let qty = 1, sel = o === 'ponto' ? 'Ao ponto' : '', note = '', tried = false;
  const missing = () => (og && !sel) || (isNote && !sel.trim());
  const keep = () => { const n = $('#opt-note'), s = $('#opt-sel'); if (n) note = n.value; if (s) sel = s.value; };
  function draw() {
    const img = it.ph ? `<img src="assets/${it.ph}.webp" alt="" width="72" height="90">` : '';
    let h = `<div class="opt-top">${img}<div><b>${esc(it.n)}</b><span>${brl(it.p)}</span></div></div>`;
    if (og) {
      h += `<p class="opt-h">${esc(og.label)}</p><div class="choices" role="radiogroup" aria-label="${esc(og.label)}">${og.values.map(v => `<button type="button" role="radio" aria-checked="${v === sel}" data-v="${esc(v)}">${esc(v)}</button>`).join('')}</div>`;
      if (o === 'ponto') { const i = og.values.indexOf(sel); h += `<div class="dial"><div class="meter" aria-hidden="true"><i style="left:${i < 0 ? 50 : 17 + i * 33}%"></i></div></div>`; }
    }
    if (isNote) h += `<label class="fld ${tried && !sel.trim() ? 'bad' : ''}">${esc(o.slice(5))} (obrigatório)<input id="opt-sel" type="text" maxlength="60" value="${esc(sel)}" autocomplete="off">${tried && !sel.trim() ? '<span class="em">Informe para continuar.</span>' : ''}</label>`;
    h += `<label class="fld">Observação (opcional)<textarea id="opt-note" maxlength="140" placeholder="Ex.: sem cebola">${esc(note)}</textarea></label>`;
    h += `<div class="opt-top" style="justify-content:space-between;margin-top:8px"><b style="font-weight:500">Quantidade</b><div class="stepper small"><button type="button" aria-label="Menos" data-q="-1">${ic('minus')}</button><output>${qty}</output><button type="button" aria-label="Mais" data-q="1">${ic('plus')}</button></div></div>`;
    render(og || isNote ? 'Escolha as opções' : 'Adicionar ao pedido', h, `<button type="button" class="btn" id="opt-add" ${missing() ? 'aria-disabled="true"' : ''}>${ic('plus')}<span>Adicionar &bull; ${brl(it.p * qty)}</span></button>`, 'opt');
    const b = $('#sh-body');
    $$('.choices button', b).forEach(x => x.addEventListener('click', () => { keep(); sel = x.dataset.v; draw(); }));
    $$('[data-q]', b).forEach(x => x.addEventListener('click', () => { keep(); qty = clamp(qty + +x.dataset.q, 1, 20); draw(); }));
    const si = $('#opt-sel'); if (si) si.addEventListener('input', () => { sel = si.value; $('#opt-add').setAttribute('aria-disabled', sel.trim() ? 'false' : 'true'); });
    $('#opt-add').addEventListener('click', () => {
      keep();
      if (missing()) { tried = true; draw(); toast('Escolha a opção antes de adicionar.'); return; }
      const optText = isNote ? `${o.slice(5)}: ${clean(sel)}` : (og ? `${og.label}: ${sel}` : '');
      const n = note, q = qty; closeSheet(); setTimeout(() => addLine(id, q, optText, n, src), reduce ? 0 : 330);
    });
  }
  setSteps(0); draw(); openSheet('opt');
}

/* ---------- carrinho ---------- */
function openCart() { step = 0; renderCart(); openSheet('cart'); }
function renderCart() {
  setSteps(0);
  if (!cart.length) { render('Seu pedido', `<div class="empty">${ic('shopping-bag-open')}<p>Seu pedido está vazio. Toque no + de qualquer prato para começar.</p></div>`, `<button type="button" class="btn-s fill" id="back-menu"><span>Ver o cardápio</span></button>`); $('#back-menu').addEventListener('click', closeSheet); return; }
  const lines = cart.map((l, i) => {
    const it = BYID[l.id];
    return `<li class="cl-item" data-i="${i}"><span class="nm">${esc(it.n)}</span><span class="lt">${brl(lineTotal(l))}</span>${l.opt ? `<span class="op">${esc(l.opt)}</span>` : ''}${l.note ? `<span class="op">Obs.: ${esc(l.note)}</span>` : ''}<div class="qc"><div class="stepper small"><button type="button" aria-label="Menos" data-c="-1">${ic('minus')}</button><output>${l.qty}</output><button type="button" aria-label="Mais" data-c="1">${ic('plus')}</button></div><button type="button" class="rm" data-rm>${ic('trash')}<span>Remover</span></button></div></li>`;
  }).join('');
  render('Seu pedido', `<ul class="cl">${lines}</ul><div class="sum"><div><span>Subtotal</span><strong>${brl(cartTotal())}</strong></div><small>Taxa de entrega, se houver, é informada no WhatsApp.</small></div>`,
    `<div class="total-row"><span>${cartCount()} ${cartCount() === 1 ? 'item' : 'itens'}</span><strong>${brl(cartTotal())}</strong></div><button type="button" class="btn" id="go-co">${ic('arrow-right')}<span>Continuar</span></button><button type="button" class="btn-s" id="more">Continuar escolhendo</button>`);
  $('#more').addEventListener('click', closeSheet);
  $('#go-co').addEventListener('click', () => { track('iniciar_pedido', { value: cartTotal(), itens: cartCount() }); step = 1; renderStep(); });
}
$('#sh-body').addEventListener('click', e => {
  if (!sheetOpen || mode !== 'cart' || step !== 0) return;
  const li = e.target.closest('.cl-item'); if (!li) return; const l = cart[+li.dataset.i];
  const c = e.target.closest('[data-c]');
  if (c) { l.qty = clamp(l.qty + +c.dataset.c, 0, 99); if (l.qty === 0) cart.splice(+li.dataset.i, 1); }
  else if (e.target.closest('[data-rm]')) cart.splice(+li.dataset.i, 1); else return;
  persistCart(); const sh = money.shown; renderCart(); refreshCartUI(); money.shown = cartTotal(); void sh;
});

/* ---------- checkout ---------- */
const PAYS = [['PIX', 'qr-code'], ['Cartão de crédito', 'credit-card'], ['Cartão de débito', 'credit-card'], ['Dinheiro', 'money']];
function maskPhone(v) {
  const d = v.replace(/\D/g, '').slice(0, 11);
  if (d.length <= 2) return d ? '(' + d : '';
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}
function parseMoney(s) { const v = parseFloat(String(s).replace(/[^\d,.]/g, '').replace(/\./g, '').replace(',', '.')); return isNaN(v) ? 0 : v; }
const foot = (next, back = true, label = 'Continuar') => `<div class="row">${back ? `<button type="button" class="btn-s" id="back">Voltar</button>` : ''}<button type="button" class="btn" id="next">${ic('arrow-right')}<span>${label}</span></button></div>`;
function renderStep() {
  setSteps(step);
  const wrapErr = (cond, msg) => cond ? `<span class="em">${msg}</span>` : '';
  if (step === 1) {
    render('Como quer receber?', `<div class="choices" role="radiogroup" aria-label="Retirada ou entrega"><button type="button" role="radio" aria-checked="${customer.mode === 'retirada'}" data-m="retirada">${ic('storefront')}Retirada<small>no Brasê</small></button><button type="button" role="radio" aria-checked="${customer.mode === 'entrega'}" data-m="entrega">${ic('moped')}Entrega<small>no seu endereço</small></button></div><p class="hint-s" id="m-hint">${customer.mode === 'retirada' ? 'Retire no Brasê: ' + CONFIG.address + '.' : customer.mode === 'entrega' ? 'A taxa de entrega e o tempo são informados no WhatsApp ao confirmar.' : 'Escolha uma opção para continuar.'}</p>`, foot(null, true));
    $$('#sh-body [data-m]').forEach(b => b.addEventListener('click', () => { customer.mode = b.dataset.m; persistCust(); renderStep(); }));
    $('#back').addEventListener('click', () => { step = 0; renderCart(); });
    $('#next').addEventListener('click', () => { if (!customer.mode) { toast('Escolha retirada ou entrega.'); return; } step = customer.mode === 'entrega' ? 2 : 3; renderStep(); });
  } else if (step === 2) {
    let tried = false;
    const draw = () => {
      render('Endereço de entrega', `<label class="fld ${tried && !customer.rua.trim() ? 'bad' : ''}">Rua e número<input id="f-rua" type="text" autocomplete="street-address" maxlength="120" value="${esc(customer.rua)}" placeholder="Ex.: Rua das Flores, 120">${wrapErr(tried && !customer.rua.trim(), 'Informe a rua e o número.')}</label><label class="fld ${tried && !customer.bairro.trim() ? 'bad' : ''}">Bairro<input id="f-bairro" type="text" maxlength="60" value="${esc(customer.bairro)}">${wrapErr(tried && !customer.bairro.trim(), 'Informe o bairro.')}</label><label class="fld">Complemento ou ponto de referência (opcional)<textarea id="f-compl" maxlength="180" placeholder="Ex.: apto 302, portão azul">${esc(customer.compl)}</textarea></label><p class="hint-s">A taxa de entrega é informada no WhatsApp, junto com o tempo estimado.</p>`, foot(null, true));
      bind();
    };
    const bind = () => {
      $('#f-rua').addEventListener('input', e => { customer.rua = e.target.value; persistCust(); });
      $('#f-bairro').addEventListener('input', e => { customer.bairro = e.target.value; persistCust(); });
      $('#f-compl').addEventListener('input', e => { customer.compl = e.target.value; persistCust(); });
      $('#back').addEventListener('click', () => { step = 1; renderStep(); });
      $('#next').addEventListener('click', () => { if (!customer.rua.trim() || !customer.bairro.trim()) { tried = true; draw(); $('.fld.bad input') && $('.fld.bad input').focus(); return; } step = 3; renderStep(); });
    };
    draw();
  } else if (step === 3) {
    let tried = false;
    const draw = () => {
      const nOk = clean(customer.nome).length >= 2, pOk = customer.fone.replace(/\D/g, '').length >= 10;
      render('Seu nome e telefone', `<label class="fld ${tried && !nOk ? 'bad' : ''}">Nome<input id="f-nome" type="text" autocomplete="name" maxlength="80" value="${esc(customer.nome)}">${wrapErr(tried && !nOk, 'Informe seu nome.')}</label><label class="fld ${tried && !pOk ? 'bad' : ''}">Telefone com DDD<input id="f-fone" type="tel" inputmode="tel" autocomplete="tel" maxlength="16" value="${esc(customer.fone)}" placeholder="(86) 99999-9999">${wrapErr(tried && !pOk, 'Informe um telefone com DDD.')}</label><p class="hint-s">Seus dados vão só na mensagem do WhatsApp. Não guardamos nada em servidor.</p>`, foot(null, true));
      $('#f-nome').addEventListener('input', e => { customer.nome = e.target.value; persistCust(); });
      $('#f-fone').addEventListener('input', e => { e.target.value = maskPhone(e.target.value); customer.fone = e.target.value; persistCust(); });
      $('#back').addEventListener('click', () => { step = customer.mode === 'entrega' ? 2 : 1; renderStep(); });
      $('#next').addEventListener('click', () => { const n2 = clean(customer.nome).length >= 2, p2 = customer.fone.replace(/\D/g, '').length >= 10; if (!n2 || !p2) { tried = true; draw(); const b = $('.fld.bad input'); b && b.focus(); return; } step = 4; renderStep(); });
    };
    draw();
  } else if (step === 4) {
    let tried = false;
    const draw = () => {
      const tot = cartTotal(); const tv = parseMoney(customer.troco);
      const trocoBad = tried && customer.pay === 'Dinheiro' && customer.troco !== 'sem' && (!customer.troco || tv < tot);
      render('Como vai pagar?', `<div class="choices" role="radiogroup" aria-label="Forma de pagamento">${PAYS.map(([n, i]) => `<button type="button" role="radio" aria-checked="${customer.pay === n}" data-p="${n}">${ic(i)}${n}</button>`).join('')}</div>${customer.pay === 'Dinheiro' ? `<p class="opt-h">Troco</p><div class="choices"><button type="button" role="radio" aria-checked="${customer.troco === 'sem'}" data-t="sem">Não preciso de troco</button><button type="button" role="radio" aria-checked="${customer.troco !== 'sem' && customer.pay === 'Dinheiro' && customer.troco !== ''}" data-t="sim">Preciso de troco</button></div>${customer.troco !== 'sem' && customer.troco !== '' ? `<label class="fld ${trocoBad ? 'bad' : ''}">Troco para quanto? (em reais)<input id="f-troco" type="text" inputmode="decimal" value="${customer.troco === 'sim' ? '' : esc(customer.troco)}" placeholder="Ex.: 100">${trocoBad ? `<span class="em">O valor precisa ser maior ou igual a ${brl(tot)}.</span>` : ''}</label>` : ''}` : ''}<p class="hint-s">${customer.pay === 'PIX' ? 'Combinamos o PIX na conversa do WhatsApp.' : customer.pay === 'Cartão de crédito' || customer.pay === 'Cartão de débito' ? 'Pagamento na maquininha, na hora. Não pedimos dados do cartão aqui.' : customer.pay === 'Dinheiro' ? '' : 'Escolha a forma de pagamento.'}</p>`, foot(null, true));
      $$('#sh-body [data-p]').forEach(b => b.addEventListener('click', () => { customer.pay = b.dataset.p; if (customer.pay !== 'Dinheiro') customer.troco = ''; persistCust(); draw(); }));
      $$('#sh-body [data-t]').forEach(b => b.addEventListener('click', () => { customer.troco = b.dataset.t === 'sem' ? 'sem' : 'sim'; persistCust(); draw(); const f = $('#f-troco'); f && f.focus(); }));
      const tf = $('#f-troco'); if (tf) tf.addEventListener('input', e => { customer.troco = e.target.value || 'sim'; persistCust(); });
      $('#back').addEventListener('click', () => { step = 3; renderStep(); });
      $('#next').addEventListener('click', () => {
        if (!customer.pay) { toast('Escolha a forma de pagamento.'); return; }
        if (customer.pay === 'Dinheiro') { const t = parseMoney(customer.troco); if (customer.troco !== 'sem' && (!t || t < cartTotal())) { tried = true; draw(); const f = $('#f-troco'); f && f.focus(); return; } }
        step = 5; renderStep();
      });
    };
    draw();
  } else if (step === 5) renderReview();
}

/* ---------- mensagem do WhatsApp e comanda ---------- */
function orderLines() {
  return cart.map(l => {
    const it = BYID[l.id];
    return { q: l.qty, name: it.n, opt: l.opt, note: l.note, total: lineTotal(l) };
  });
}
function buildMessage() {
  const st = openState(), tot = cartTotal(), c = customer, L = [];
  L.push('*NOVO PEDIDO | BRASÊ*');
  if (!st.isOpen) L.push(`_Pedido para quando abrirmos (hoje às ${st.opensAt})_`);
  L.push('--------------------');
  L.push(`*Tipo:* ${c.mode === 'entrega' ? 'Entrega' : 'Retirada no Brasê'}`);
  L.push(`*Nome:* ${clean(c.nome)}`);
  L.push(`*Telefone:* ${clean(c.fone)}`);
  if (c.mode === 'entrega') {
    L.push(`*Endereço:* ${clean(c.rua)}, ${clean(c.bairro)}`);
    if (clean(c.compl)) L.push(`*Complemento:* ${cleanMulti(c.compl).replace(/\n/g, ' / ')}`);
  }
  L.push('--------------------');
  L.push('*Itens*');
  orderLines().forEach(l => {
    L.push(`${l.q}x ${clean(l.name)}${l.opt ? ' (' + clean(l.opt) + ')' : ''} - ${brl(l.total)}`);
    if (l.note) L.push(`   Obs.: ${clean(l.note)}`);
  });
  L.push('--------------------');
  L.push(`*Subtotal:* ${brl(tot)}`);
  L.push(c.mode === 'entrega' ? '*Entrega:* taxa a informar no WhatsApp' : '*Entrega:* não se aplica (retirada)');
  let pay = c.pay;
  if (c.pay === 'Dinheiro') pay += c.troco === 'sem' ? ' (sem troco)' : ` (troco para ${brl(parseMoney(c.troco))})`;
  L.push(`*Pagamento:* ${pay}`);
  L.push(`*Origem:* ${originText()}`);
  return L.join('\n');
}
function renderReview() {
  const st = openState(), tot = cartTotal(), c = customer, now = nowParts();
  const stamp = `${String(now.date.getUTCDate()).padStart(2, '0')}`;
  const dt = new Intl.DateTimeFormat('pt-BR', { timeZone: CONFIG.tz, dateStyle: 'short', timeStyle: 'short' }).format(now.date);
  let k = 0;
  const rows = orderLines().map(l => `<div class="tl" style="--k:${k++}"><span>${l.q}x ${esc(clean(l.name))}${l.opt ? ' (' + esc(clean(l.opt)) + ')' : ''}</span><span>${brl(l.total)}</span></div>${l.note ? `<div class="tn">Obs.: ${esc(clean(l.note))}</div>` : ''}`).join('');
  let pay = c.pay; if (c.pay === 'Dinheiro') pay += c.troco === 'sem' ? ' (sem troco)' : ` (troco p/ ${brl(parseMoney(c.troco))})`;
  const ticket = `<div class="ticket-wrap"><div class="ticket" id="ticket"><h4>BRASÊ</h4><div class="tc">COMANDA &bull; ${esc(dt)}</div><hr>
    <div class="tl"><span>Tipo</span><span>${c.mode === 'entrega' ? 'ENTREGA' : 'RETIRADA'}</span></div>
    <div class="tl"><span>Nome</span><span>${esc(clean(c.nome))}</span></div>
    <div class="tl"><span>Fone</span><span>${esc(clean(c.fone))}</span></div>
    ${c.mode === 'entrega' ? `<div class="tn" style="padding:0">${esc(clean(c.rua))}, ${esc(clean(c.bairro))}${clean(c.compl) ? '<br>' + esc(cleanMulti(c.compl).replace(/\n/g, ' / ')) : ''}</div>` : ''}
    <hr>${rows}<hr>
    <div class="tl tt"><span>SUBTOTAL</span><span>${brl(tot)}</span></div>
    <div class="tl"><span>Entrega</span><span>${c.mode === 'entrega' ? 'a informar' : 'n/a'}</span></div>
    <div class="tl"><span>Pagamento</span><span>${esc(pay)}</span></div>
    ${st.isOpen ? '' : `<hr><div class="tn" style="padding:0">Pedido para quando abrirmos (hoje às ${st.opensAt})</div>`}
    <div class="tc">Confira e envie no WhatsApp</div></div></div>`;
  render('Confira sua comanda', ticket, `<div class="total-row"><span>Subtotal</span><strong>${brl(tot)}</strong></div><a class="btn" id="send" href="${wa(buildMessage())}" target="_blank" rel="noopener">${ic('whatsapp-logo')}<span>Enviar pedido no WhatsApp</span></a><div class="row"><button type="button" class="btn-s" id="back">Editar</button><button type="button" class="btn-s" id="copy">${ic('copy-simple')}<span>Copiar</span></button></div>`);
  $('#back').addEventListener('click', () => { step = 4; renderStep(); });
  $('#send').addEventListener('click', () => {
    const a = $('#send'); a.href = wa(buildMessage());
    track('pedido_enviado_whatsapp', { value: cartTotal(), itens: cartCount(), tipo: customer.mode, pagamento: customer.pay });
    toast('Abrindo o WhatsApp. Confirme o envio por lá.');
  });
  $('#copy').addEventListener('click', async () => {
    const txt = buildMessage(); let ok = false;
    try { await navigator.clipboard.writeText(txt); ok = true; } catch (e) {
      try { const ta = document.createElement('textarea'); ta.value = txt; ta.style.cssText = 'position:fixed;opacity:0'; document.body.appendChild(ta); ta.select(); ok = document.execCommand('copy'); ta.remove(); } catch (x) {}
    }
    toast(ok ? 'Pedido copiado. Cole no WhatsApp.' : 'Não deu para copiar. Use o botão de enviar.');
  });
}

/* ---------- Monte sua mesa ---------- */
const mesa = { n: 4, mode: 'brasa', seed: 1, list: [] };
function buildMesa() {
  const rnd = mulberry(mesa.seed * 9301 + mesa.n * 49297 + mesa.mode.length);
  const pool = ks => ITEMS.filter(i => ks.includes(i.c) && i.p > 0);
  const pick = a => a[Math.floor(rnd() * a.length)];
  const out = new Map(), add = (it, q = 1) => { const e = out.get(it.id); if (e) e.q += q; else out.set(it.id, { it, q }); };
  const mainKs = mesa.mode === 'brasa' ? ['brasa', 'individuais'] : mesa.mode === 'familia' ? ['familia'] : ['entradas', 'hamburgueres', 'sanduiches'];
  let mains = pool(mainKs).filter(i => i.s > 0);
  if (!mains.length) mains = pool(mainKs);
  let cover = 0, guard = 0;
  while (cover < mesa.n && guard++ < 14) {
    const rem = mesa.n - cover;
    const fit = mains.filter(i => i.s <= rem + 1);
    const it = pick(fit.length ? fit : [mains.reduce((a, b) => a.s < b.s ? a : b)]);
    add(it); cover += it.s || 1;
  }
  if (mesa.mode !== 'petiscar' && mesa.n >= 2) { const e = pool(['entradas']); if (e.length) add(pick(e)); }
  const ac = pool(['acomp']);
  if (ac.length && mesa.mode !== 'petiscar') { const c = Math.ceil(mesa.n / 4); const used = new Set(); for (let i = 0; i < c; i++) { const a = pick(ac.filter(x => !used.has(x.id)) || ac); if (a) { used.add(a.id); add(a); } } }
  if (mesa.n >= 3) { const s = pool(['sobremesas']); if (s.length) add(pick(s)); }
  mesa.list = [...out.values()];
  renderMesa();
}
function defaultOpt(it) { return it.o === 'ponto' ? 'Ponto da carne: Ao ponto' : ''; }
function renderMesa() {
  const tot = mesa.list.reduce((a, e) => a + e.it.p * e.q, 0);
  $('#mesa-list').innerHTML = mesa.list.map((e, i) => `<li style="--k:${i}"><span class="n">${e.q > 1 ? e.q + '× ' : ''}${esc(e.it.n)}</span><span class="sv">${e.it.s ? 'serve ' + e.it.s : 'para a mesa'}${e.it.o === 'ponto' ? ', ao ponto' : ''}</span><b>${brl(e.it.p * e.q)}</b></li>`).join('');
  const per = tot / mesa.n;
  $('#mesa-total').innerHTML = `Total <strong>${brl(tot)}</strong>, cerca de ${brl(Math.round(per * 100) / 100)} por pessoa.`;
}
function setupMesa() {
  $('#mesa [data-stepper=people]').addEventListener('stepchange', e => { mesa.n = e.detail; mesa.seed++; buildMesa(); });
  $('#mesa .seg').addEventListener('segchange', e => { mesa.mode = e.detail.dataset.mode; mesa.seed++; buildMesa(); });
  $('#mesa-shuffle').addEventListener('click', () => { mesa.seed++; buildMesa(); });
  $('#mesa-add').addEventListener('click', e => {
    mesa.list.forEach(x => addLine(x.it.id, x.q, defaultOpt(x.it), '', null));
    toast('Mesa adicionada ao pedido.');
  });
  $('#people').textContent = mesa.n; buildMesa();
}

/* ---------- busca, categorias, adicionar ---------- */
function menuSpy() {
  const sec = $('#cardapio'); if (!sec) return;
  const r = sec.getBoundingClientRect(); if (r.bottom < 0 || r.top > innerHeight) return;
  let cur = null;
  $$('.cat:not(.hid)').forEach(c => { if (c.getBoundingClientRect().top <= 190) cur = c.dataset.cat; });
  if (cur !== menuSpy.cur) {
    menuSpy.cur = cur;
    $$('.chip').forEach(ch => {
      const on = ch.dataset.chip === cur; ch.classList.toggle('on', on);
      if (on) { const row = $('#chips'); row.scrollTo({ left: ch.offsetLeft - (row.clientWidth - ch.offsetWidth) / 2, behavior: reduce ? 'auto' : 'smooth' }); }
    });
  }
}
function setupMenu() {
  $('#chips').addEventListener('click', e => {
    const c = e.target.closest('.chip'); if (!c) return;
    const q = $('#q'); if (q.value) { q.value = ''; filter(''); }
    const t = $('#c-' + c.dataset.chip); if (t) t.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
  });
  const filter = v => {
    const q = norm(v.trim()); let any = false;
    $$('.dish').forEach(d => { const m = !q || norm(d.dataset.search).includes(q); d.classList.toggle('hid', !m); if (m) { any = true; d.classList.add('in'); d.style.opacity = 1; } });
    $$('.cat').forEach(c => c.classList.toggle('hid', !$('.dish:not(.hid)', c)));
    $('#noresult').hidden = any;
  };
  let t; $('#q').addEventListener('input', e => { clearTimeout(t); t = setTimeout(() => filter(e.target.value), 120); });
  $('#menu').addEventListener('click', e => {
    const b = e.target.closest('.add'); if (!b) return;
    const d = b.closest('.dish'), id = d.dataset.id, it = BYID[id];
    if (it.o) openOptions(id, b); else addLine(id, 1, '', '', d.querySelector('.ph') || b);
    if (!it.o) { const btn = b; btn.classList.remove('pop'); void btn.offsetWidth; btn.classList.add('pop'); }
  });
  document.addEventListener('click', e => {
    const q = e.target.closest('[data-quick]'); if (!q) return;
    const id = q.dataset.quick, it = BYID[id]; if (!it) return;
    if (it.o) openOptions(id, q); else { addLine(id, 1, '', '', q); toast(it.n + ' adicionado ao pedido.'); }
  });
  $('#cartbtn').addEventListener('click', openCart);
  const first = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { track('ver_cardapio', { origem: 'rolagem' }); first.disconnect(); } }), { threshold: .2 });
  first.observe($('#cardapio'));
}

/* ---------- segure para assar (fotos dos pratos) ---------- */
function setupRoast() {
  const active = new Set(); let raf = 0, last = 0;
  const rnd = mulberry(3);
  function loop(now) {
    const dt = Math.min(.05, (now - last) / 1000); last = now;
    active.forEach(o => {
      const { cv, ctx, ps } = o; const w = cv.clientWidth, h = cv.clientHeight;
      if (cv.width !== w * 2) { cv.width = w * 2; cv.height = h * 2; ctx.setTransform(2, 0, 0, 2, 0, 0); }
      ctx.clearRect(0, 0, w, h); ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 3; i++) ps.push({ x: o.x + (rnd() - .5) * 30, y: o.y + (rnd() - .5) * 10, vx: (rnd() - .5) * 50, vy: -(30 + rnd() * 80), l: 0, m: .5 + rnd() * .7 });
      for (let i = ps.length - 1; i >= 0; i--) {
        const p = ps[i]; p.l += dt; if (p.l > p.m) { ps.splice(i, 1); continue; }
        p.x += p.vx * dt; p.y += p.vy * dt; const k = p.l / p.m;
        ctx.fillStyle = `rgba(255,${Math.round(190 - k * 100)},70,${1 - k})`; ctx.beginPath(); ctx.arc(p.x, p.y, 1.8 * (1 - k * .5), 0, 7); ctx.fill();
      }
    });
    if (active.size) raf = requestAnimationFrame(loop); else raf = 0;
  }
  $$('.ph[data-hold]').forEach(ph => {
    const cv = $('.spk', ph), ctx = cv.getContext('2d'); let timer;
    const o = { cv, ctx, ps: [], x: 40, y: 80 };
    const start = e => { const r = ph.getBoundingClientRect(); o.x = e.clientX - r.left; o.y = e.clientY - r.top; timer = setTimeout(() => { ph.classList.add('hot'); active.add(o); if (!raf) { last = performance.now(); raf = requestAnimationFrame(loop); } }, 350); };
    const move = e => { const r = ph.getBoundingClientRect(); o.x = e.clientX - r.left; o.y = e.clientY - r.top; };
    const end = () => { clearTimeout(timer); if (active.has(o)) { setTimeout(() => { active.delete(o); o.ps.length = 0; ctx.clearRect(0, 0, cv.width, cv.height); }, 500); setTimeout(() => ph.classList.remove('hot'), 1400); } };
    ph.addEventListener('pointerdown', start); ph.addEventListener('pointermove', move);
    ['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => ph.addEventListener(ev, end));
    ph.addEventListener('contextmenu', e => e.preventDefault());
  });
}

/* ============ BOLICHE: solte a bola ============ */
function setupLane() {
  const lane = $('#lane'), cv = $('#lane-cv'), ctx = cv.getContext('2d'), cta = $('#lane-cta'), score = $('#lane-score');
  let W = 0, H = 0, vis = false, pins = [], ball, roll = 1, best = 0, phase = 'aim', phaseT = 0, trail = [], samples = [], dragging = false, startP = null, flash = 0;
  const cx = () => W / 2, yTop = () => H * 0.12;
  const half = y => { const t = clamp((y - yTop()) / (H - yTop()), 0, 1); return W * 0.2 + (W * 0.47 - W * 0.2) * t; };
  const sc = y => 0.5 + 0.5 * clamp((y - yTop()) / (H - yTop()), 0, 1);
  const startY = () => H * 0.72;
  function size() { const d = Math.min(devicePixelRatio || 1, 2); W = cv.clientWidth; H = cv.clientHeight; if (!W) return; cv.width = W * d; cv.height = H * d; ctx.setTransform(d, 0, 0, d, 0, 0); if (!pins.length) resetAll(); else layoutPins(false); }
  function layoutPins(newPins) {
    const rows = [4, 3, 2, 1], spX = W * 0.1, spY = H * 0.052, y0 = H * 0.2; let n = 0;
    rows.forEach((cnt, r) => { for (let c = 0; c < cnt; c++) { const x = cx() + (c - (cnt - 1) / 2) * spX, y = y0 + r * spY; if (newPins) pins.push({ hx: x, hy: y, x, y, vx: 0, vy: 0, hit: false, ang: 0, a: 1, i: n }); else { const p = pins[n]; p.hx = x; p.hy = y; if (!p.hit) { p.x = x; p.y = y; } } n++; } });
  }
  function resetBall() { ball = { x: cx(), y: startY(), vx: 0, vy: 0, live: false, gut: false }; trail = []; }
  function resetAll() { pins = []; layoutPins(true); resetBall(); roll = 1; phase = 'aim'; setScore('Arraste a bola para cima e solte'); }
  function setScore(t) { score.textContent = t; }
  function frac() { return pins.filter(p => p.hit).length / 10; }
  function updateCta() { const f = Math.max(best, frac()); const hot = f >= 0.6; lane.classList.toggle('hot', hot); cta.style.opacity = hot ? '' : String(.55 + .45 * f); }
  const pt = e => { const r = cv.getBoundingClientRect(); return { x: (e.clientX - r.left) * (W / r.width), y: (e.clientY - r.top) * (H / r.height), t: performance.now() }; };
  cv.addEventListener('pointerdown', e => {
    if (phase !== 'aim') return; const p = pt(e);
    if (p.y < H * 0.45) return;
    dragging = true; startP = p; samples = [p]; cv.setPointerCapture(e.pointerId); cv.style.cursor = 'grabbing';
    ball.x = clamp(p.x, cx() - half(H * .8) + 14, cx() + half(H * .8) - 14); ball.y = clamp(p.y, H * 0.52, H * 0.86);
  });
  cv.addEventListener('pointermove', e => {
    if (!dragging) return; const p = pt(e); samples.push(p); if (samples.length > 8) samples.shift();
    ball.x = clamp(p.x, cx() - half(H * .8) + 14, cx() + half(H * .8) - 14); ball.y = clamp(p.y, H * 0.3, H * 0.9);
  });
  const release = e => {
    if (!dragging) return; dragging = false; cv.style.cursor = '';
    const p = pt(e); samples.push(p);
    const now = performance.now(), recent = samples.filter(s => now - s.t < 140);
    let vx = 0, vy = 0;
    if (recent.length >= 2) { const a = recent[0], b = recent[recent.length - 1], dt = Math.max(16, b.t - a.t) / 1000; vx = (b.x - a.x) / dt; vy = (b.y - a.y) / dt; }
    const dx = p.x - startP.x, dy = p.y - startP.y;
    let sp = Math.hypot(vx, vy);
    if (!(vy < -250 && sp > 350)) {
      if (dy < -45) { const l = Math.hypot(dx, dy); vx = dx / l * 620; vy = dy / l * 620; sp = 620; }
      else { resetBall(); setScore('Arraste para cima, com força'); return; }
    }
    sp = clamp(sp, 420, 900); const l = Math.hypot(vx, vy); ball.vx = vx / l * sp * 0.9; ball.vy = vy / l * sp * 0.9; ball.vy = Math.min(ball.vy, -260);
    ball.live = true; phase = 'roll'; phaseT = 0; setScore('Lá vai a bola');
  };
  cv.addEventListener('pointerup', release); cv.addEventListener('pointercancel', release);
  $('#lane-reset').addEventListener('click', () => { resetAll(); best = 0; updateCta(); });
  function step(dt) {
    phaseT += dt;
    pins.forEach(p => { if (p.hit) { p.x += p.vx * dt; p.y += p.vy * dt; const f = Math.pow(.08, dt); p.vx *= f; p.vy *= f; p.ang = Math.min(p.ang + dt * 8, 1.4); if (Math.hypot(p.vx, p.vy) < 8) p.a = Math.max(.35, p.a - dt * .3); } });
    if (ball.live) {
      ball.x += ball.vx * dt; ball.y += ball.vy * dt; trail.push({ x: ball.x, y: ball.y }); if (trail.length > 14) trail.shift();
      const h = half(ball.y);
      if (!ball.gut && Math.abs(ball.x - cx()) > h + 6) { ball.gut = true; ball.vx = 0; ball.x = cx() + Math.sign(ball.x - cx()) * (h + 10); }
      if (ball.gut) ball.x = cx() + Math.sign(ball.x - cx()) * (half(ball.y) + 10);
      if (!ball.gut) {
        const rb = W * 0.055 * sc(ball.y);
        pins.forEach(p => {
          const rp = W * 0.03 * sc(p.y), dx = p.x - ball.x, dy = p.y - ball.y, d = Math.hypot(dx, dy) || 1;
          if (d < rb + rp) {
            const nx = dx / d, ny = dy / d, sp = Math.hypot(ball.vx, ball.vy);
            p.hit = true; p.vx = ball.vx * .75 + nx * sp * .55; p.vy = ball.vy * .75 + ny * sp * .55;
            ball.vx -= nx * sp * .12; ball.vy *= .93; const ov = rb + rp - d; p.x += nx * ov; p.y += ny * ov;
          }
        });
      }
      for (let i = 0; i < pins.length; i++) for (let j = i + 1; j < pins.length; j++) {
        const a = pins[i], b = pins[j]; if (!a.hit && !b.hit) continue;
        const rp = W * 0.03 * sc(a.y) * 2, dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1;
        if (d < rp) {
          const nx = dx / d, ny = dy / d, rel = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
          if (rel > 0 || (!a.hit || !b.hit)) { const k = Math.max(rel, 40) * .8; if (a.hit && Math.hypot(a.vx, a.vy) > 25) { b.hit = true; b.vx += nx * k; b.vy += ny * k; } if (b.hit && Math.hypot(b.vx, b.vy) > 25) { a.hit = true; a.vx -= nx * k * .6; a.vy -= ny * k * .6; } }
        }
      }
      if (ball.y < H * 0.13 || phaseT > 2.6) { ball.live = false; settle(); }
    }
  }
  function settle() {
    const n = pins.filter(p => p.hit).length; best = Math.max(best, n / 10);
    flash = 1;
    if (n === 10) { setScore('Strike! Caiu tudo.'); phase = 'wait'; phaseT = 0; wait(2400, () => { resetAll(); }); }
    else if (roll === 1) { setScore(n + (n === 1 ? ' pino' : ' pinos') + '. Mais uma bola.'); roll = 2; phase = 'wait'; wait(1100, () => { resetBall(); phase = 'aim'; }); }
    else { setScore(n + ' pinos no total. Jogue de novo ou reserve.'); phase = 'wait'; wait(2600, () => { resetAll(); }); }
    updateCta(); if (n >= 6) track('boliche_jogo', { pinos: n });
  }
  let wt; function wait(ms, fn) { clearTimeout(wt); wt = setTimeout(fn, ms); }
  const pink = '#FF2E93', blue = '#2EA8FF';
  function draw(now) {
    ctx.clearRect(0, 0, W, H);
    const yt = yTop(), tt = now / 1000;
    ctx.fillStyle = '#05030A'; ctx.fillRect(0, 0, W, H);
    // fundo: faixas de luz que correm
    for (let i = 0; i < 5; i++) {
      const gx = ((tt * 40 * (i % 2 ? 1 : -1) + i * W / 5) % (W * 1.4)) - W * .2;
      const g = ctx.createRadialGradient(gx, H * .08, 0, gx, H * .08, W * .5);
      g.addColorStop(0, i % 2 ? 'rgba(255,46,147,.26)' : 'rgba(46,168,255,.26)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H * .5);
    }
    // calhas
    ctx.fillStyle = '#0a0612'; ctx.beginPath(); ctx.moveTo(cx() - half(yt) - W * .05, yt); ctx.lineTo(cx() + half(yt) + W * .05, yt); ctx.lineTo(cx() + half(H) + W * .09, H); ctx.lineTo(cx() - half(H) - W * .09, H); ctx.fill();
    // pista
    const lg = ctx.createLinearGradient(0, yt, 0, H); lg.addColorStop(0, '#201034'); lg.addColorStop(.6, '#150b26'); lg.addColorStop(1, '#0c1428');
    ctx.fillStyle = lg; ctx.beginPath(); ctx.moveTo(cx() - half(yt), yt); ctx.lineTo(cx() + half(yt), yt); ctx.lineTo(cx() + half(H), H); ctx.lineTo(cx() - half(H), H); ctx.fill();
    // tábuas
    ctx.strokeStyle = 'rgba(180,140,255,.12)'; ctx.lineWidth = 1;
    for (let i = -4; i <= 4; i++) { ctx.beginPath(); ctx.moveTo(cx() + i / 5 * half(yt), yt); ctx.lineTo(cx() + i / 5 * half(H), H); ctx.stroke(); }
    // varredura de luz
    const sy = yt + ((tt * 90) % (H - yt));
    const sg = ctx.createLinearGradient(0, sy - 40, 0, sy + 40); sg.addColorStop(0, 'rgba(255,255,255,0)'); sg.addColorStop(.5, 'rgba(160,200,255,.14)'); sg.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = sg; ctx.fillRect(cx() - half(sy), sy - 40, half(sy) * 2, 80);
    // marcas da pista
    ctx.fillStyle = 'rgba(255,255,255,.35)';
    [-2, -1, 0, 1, 2].forEach(k => { const y = H * .6, r = 3 * sc(y); ctx.beginPath(); ctx.arc(cx() + k / 5 * half(y) * 1.5, y - Math.abs(k) * 6, r, 0, 7); ctx.fill(); });
    // bordas neon
    const pulse = .7 + .3 * Math.sin(tt * 3);
    [[-1, pink], [1, blue]].forEach(([s, col]) => { ctx.strokeStyle = col; ctx.lineWidth = 3; ctx.shadowColor = col; ctx.shadowBlur = 14 * pulse; ctx.beginPath(); ctx.moveTo(cx() + s * half(yt), yt); ctx.lineTo(cx() + s * half(H), H); ctx.stroke(); });
    ctx.shadowBlur = 0;
    // fosso dos pinos
    const dg = ctx.createLinearGradient(0, yt - 4, 0, H * .12 + 22); dg.addColorStop(0, '#000'); dg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = dg; ctx.fillRect(cx() - half(yt), yt - 4, half(yt) * 2, 30);
    // pinos
    const sorted = pins.slice().sort((a, b) => a.y - b.y);
    sorted.forEach(p => {
      const r = W * 0.03 * sc(p.y), col = p.i % 2 ? pink : blue;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.ang * (p.i % 2 ? 1 : -1)); ctx.globalAlpha = p.a;
      ctx.shadowColor = col; ctx.shadowBlur = p.hit ? 4 : 10 + 4 * Math.sin(tt * 4 + p.i);
      ctx.fillStyle = '#F6F1EA'; ctx.beginPath(); ctx.ellipse(0, 0, r * .8, r * 1.55, 0, 0, 7); ctx.fill();
      ctx.shadowBlur = 0; ctx.fillStyle = col; ctx.fillRect(-r * .78, -r * .55, r * 1.56, r * .35);
      ctx.restore();
    });
    // rastro e bola
    trail.forEach((t, i) => { ctx.fillStyle = `rgba(46,168,255,${i / trail.length * .35})`; ctx.beginPath(); ctx.arc(t.x, t.y, W * .05 * sc(t.y) * (i / trail.length), 0, 7); ctx.fill(); });
    if (phase !== 'wait' || ball.live || true) {
      const r = W * 0.055 * sc(ball.y);
      ctx.shadowColor = blue; ctx.shadowBlur = 16;
      const bg = ctx.createRadialGradient(ball.x - r * .3, ball.y - r * .35, r * .1, ball.x, ball.y, r);
      bg.addColorStop(0, '#6fd0ff'); bg.addColorStop(.5, '#1b5fb5'); bg.addColorStop(1, '#0a1f4a');
      ctx.fillStyle = bg; ctx.beginPath(); ctx.arc(ball.x, ball.y, r, 0, 7); ctx.fill(); ctx.shadowBlur = 0;
      ctx.fillStyle = 'rgba(0,0,20,.7)'; [[-.25, -.35], [.15, -.4], [-.02, -.12]].forEach(([a, b]) => { ctx.beginPath(); ctx.arc(ball.x + a * r, ball.y + b * r, r * .11, 0, 7); ctx.fill(); });
    }
    // dica de gesto
    if (phase === 'aim' && !dragging && roll === 1 && frac() === 0) {
      const k = (tt % 2.2) / 2.2, y = startY() - k * H * .28;
      ctx.fillStyle = `rgba(255,255,255,${(1 - k) * .75})`; ctx.beginPath(); ctx.arc(cx(), y, 9, 0, 7); ctx.fill();
      ctx.strokeStyle = `rgba(255,255,255,${(1 - k) * .5})`; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(cx(), y, 9 + k * 14, 0, 7); ctx.stroke();
    }
    if (flash > 0) { ctx.fillStyle = `rgba(255,255,255,${flash * .18})`; ctx.fillRect(0, 0, W, H); flash = Math.max(0, flash - .04); }
  }
  let last = performance.now();
  (function loop(now) {
    requestAnimationFrame(loop);
    if (!vis) { last = now; return; }
    if (!W) size();
    const dt = Math.min(.04, (now - last) / 1000); last = now;
    step(dt / 2); step(dt / 2); draw(now);
  })(last);
  new IntersectionObserver(es => es.forEach(e => { vis = e.isIntersecting; if (vis) size(); }), { rootMargin: '60px' }).observe(lane);
  addEventListener('resize', size); size();
  window.__lane = { get pins() { return pins; }, shoot(vx, vy) { if (phase === 'aim') { ball.vx = vx; ball.vy = vy; ball.live = true; phase = 'roll'; phaseT = 0; } } };
}

/* ============ formulários (WhatsApp) ============ */
function ymdToday() { return new Intl.DateTimeFormat('sv-SE', { timeZone: CONFIG.tz }).format(window.__fakeNow ? new Date(window.__fakeNow) : new Date()); }
const WD = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
function dateBr(ymd) { const [y, m, d] = ymd.split('-').map(Number); return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y} (${WD[new Date(y, m - 1, d).getDay()]})`; }
function setupForms() {
  const today = ymdToday();
  const rd = $('#rp-data'); rd.min = today; rd.value = today;
  $('#ev-data').min = today;
  const pre = () => { if (customer.nome) { if (!$('#rp-nome').value) $('#rp-nome').value = customer.nome; if (!$('#ev-nome').value) $('#ev-nome').value = customer.nome; } };
  pre(); document.addEventListener('introend', pre);
  const dur = () => $('#reserva-pista [data-dur][aria-checked=true]').dataset.dur;
  function pista() {
    const err = []; const d = $('#rp-data').value, h = $('#rp-hora').value, nome = clean($('#rp-nome').value);
    if (!d) err.push('Escolha a data.'); else if (d < ymdToday()) err.push('A data já passou. Escolha hoje ou uma data futura.');
    if (!h) err.push('Escolha o horário.');
    if (nome.length < 2) err.push('Informe seu nome.');
    return { err, d, h, nome };
  }
  function pistaMsg(o) {
    return ['*RESERVA DE PISTA | BRASÊ*', '--------------------', `*Data:* ${dateBr(o.d)}`, `*Horário:* ${o.h}`, `*Pessoas:* ${$('#rp-pessoas').textContent}`, `*Duração:* ${dur()}`, `*Nome:* ${o.nome}`, '--------------------', 'Valor e regras da pista: confirmar com o Brasê.', `*Origem:* ${originText()}`].join('\n');
  }
  const rs = $('#rp-send'), re = $('#rp-err');
  const syncPista = () => { const o = pista(); rs.href = o.err.length ? '#reserva-pista' : wa(pistaMsg(o)); };
  $('#reserva-pista').addEventListener('input', syncPista); $('#reserva-pista').addEventListener('segchange', syncPista); $('#reserva-pista').addEventListener('stepchange', syncPista);
  rs.addEventListener('click', e => {
    const o = pista();
    if (o.err.length) { e.preventDefault(); re.hidden = false; re.textContent = o.err[0]; re.style.animation = 'none'; void re.offsetWidth; re.style.animation = ''; return; }
    re.hidden = true; rs.href = wa(pistaMsg(o));
    toast('Abrindo o WhatsApp. Confirme o envio por lá.');
  });
  syncPista();
  const es = $('#ev-send');
  const evMsg = () => {
    const tipo = $('#evento [data-ev][aria-checked=true]').dataset.ev, obs = cleanMulti($('#ev-obs').value), d = $('#ev-data').value;
    return ['*EVENTO | BRASÊ*', '--------------------', `*Tipo:* ${tipo}`, `*Convidados:* ${$('#ev-conv').textContent}`, `*Data prevista:* ${d ? dateBr(d) : 'a combinar'}`, `*Nome:* ${clean($('#ev-nome').value)}`, obs ? `*Detalhes:* ${obs.replace(/\n/g, ' / ')}` : '', '--------------------', 'Gostaria de receber informações e orçamento.', `*Origem:* ${originText()}`].filter(Boolean).join('\n');
  };
  const syncEv = () => { es.href = clean($('#ev-nome').value).length >= 2 ? wa(evMsg()) : '#evento'; };
  $('#evento').addEventListener('input', syncEv); $('#evento').addEventListener('segchange', syncEv); $('#evento').addEventListener('stepchange', syncEv);
  es.addEventListener('click', e => {
    if (clean($('#ev-nome').value).length < 2) { e.preventDefault(); toast('Informe seu nome para enviar.'); $('#ev-nome').focus(); return; }
    es.href = wa(evMsg()); toast('Abrindo o WhatsApp. Confirme o envio por lá.');
  });
  syncEv();
  window.__forms = { pistaMsg: () => pistaMsg(pista()), evMsg };
}

/* ============ galeria arrastável ============ */
function setupGallery() {
  const g = $('#gallery'); let down = false, sx = 0, sl = 0, auto = !reduce, dir = 1, pos = 0, resume, vis = false;
  g.addEventListener('pointerdown', e => { auto = false; clearTimeout(resume); g.style.scrollSnapType = ''; if (e.pointerType !== 'mouse') return; down = true; sx = e.clientX; sl = g.scrollLeft; g.classList.add('drag'); try { g.setPointerCapture(e.pointerId); } catch (x) {} });
  g.addEventListener('pointermove', e => { if (down) g.scrollLeft = sl - (e.clientX - sx); });
  const up = () => { down = false; g.classList.remove('drag'); pos = g.scrollLeft; clearTimeout(resume); if (!reduce) resume = setTimeout(() => { auto = true; pos = g.scrollLeft; }, 3500); };
  g.addEventListener('pointerup', up); g.addEventListener('pointercancel', up); g.addEventListener('pointerleave', () => { if (down) up(); });
  g.addEventListener('touchstart', () => { auto = false; clearTimeout(resume); }, { passive: true });
  g.addEventListener('touchend', () => { clearTimeout(resume); if (!reduce) resume = setTimeout(() => { auto = true; pos = g.scrollLeft; }, 3500); }, { passive: true });
  new IntersectionObserver(es => es.forEach(e => vis = e.isIntersecting)).observe(g);
  (function loop() {
    requestAnimationFrame(loop);
    if (!auto || !vis) return;
    const max = g.scrollWidth - g.clientWidth; g.style.scrollSnapType = 'none';
    pos += dir * 0.5; if (pos >= max) { pos = max; dir = -1; } if (pos <= 0) { pos = 0; dir = 1; }
    g.scrollLeft = pos;
  })();
}

/* ============ avaliações ============ */
function setupCarousel() {
  const tr = $('#car-track'), cards = $$('.rv', tr), dots = $('#car-dots'), n = cards.length; if (!n) return;
  dots.innerHTML = cards.map((c, i) => `<button type="button" tabindex="-1"><i></i></button>`).join('');
  const db = $$('button', dots); let idx = 0, timer, vis = false, hold = false, T = 5500;
  dots.style.setProperty('--t', T + 'ms'); db.forEach(b => b.style.setProperty('--t', T + 'ms'));
  const mark = () => {
    cards.forEach((c, i) => c.classList.toggle('cur', i === idx));
    db.forEach((b, i) => { b.classList.remove('on', 'done'); if (i < idx) b.classList.add('done'); });
    const b = db[idx]; b.classList.remove('on'); void b.offsetWidth; b.classList.add('on');
  };
  const go = i => { idx = (i + n) % n; const c = cards[idx]; tr.scrollTo({ left: c.offsetLeft - (tr.clientWidth - c.offsetWidth) / 2, behavior: reduce ? 'auto' : 'smooth' }); mark(); };
  const sched = () => { clearTimeout(timer); if (reduce) return; timer = setTimeout(() => { if (vis && !hold) go(idx + 1); sched(); }, T); };
  let st; tr.addEventListener('scroll', () => { clearTimeout(st); st = setTimeout(() => { const mid = tr.scrollLeft + tr.clientWidth / 2; let b = 0, bd = 1e9; cards.forEach((c, i) => { const d = Math.abs(c.offsetLeft + c.offsetWidth / 2 - mid); if (d < bd) { bd = d; b = i; } }); if (b !== idx) { idx = b; mark(); } }, 90); }, { passive: true });
  ['pointerdown', 'touchstart', 'wheel'].forEach(ev => tr.addEventListener(ev, () => { hold = true; clearTimeout(timer); }, { passive: true }));
  ['pointerup', 'touchend', 'pointercancel'].forEach(ev => tr.addEventListener(ev, () => { setTimeout(() => { hold = false; sched(); }, 6000); }, { passive: true }));
  let down = false, sx = 0, sl = 0;
  tr.addEventListener('pointerdown', e => { if (e.pointerType === 'mouse') { down = true; sx = e.clientX; sl = tr.scrollLeft; tr.style.scrollSnapType = 'none'; } });
  addEventListener('pointermove', e => { if (down) tr.scrollLeft = sl - (e.clientX - sx); });
  addEventListener('pointerup', () => { if (down) { down = false; tr.style.scrollSnapType = ''; } });
  new IntersectionObserver(es => es.forEach(e => { vis = e.isIntersecting; if (vis) mark(); })).observe(tr);
  mark(); sched();
  // contador animado
  const sc = $('#score'), strong = $('.rating p strong'); let done = false;
  new IntersectionObserver((es, o) => es.forEach(e => { if (e.isIntersecting && !done) { done = true; o.disconnect(); tween(sc, 0, 4.3, v => v.toFixed(1).replace('.', ','), 1400); tween(strong, 0, 161, v => Math.round(v) + ' avaliações', 1400); } }), { threshold: .5 }).observe($('.rating'));
}

/* ============ FAQ em conversa ============ */
function setupFaq() {
  const qas = $$('.qa');
  qas.forEach(qa => {
    const q = $('.q', qa), a = $('.a', qa), p = $('p', a); p.dataset.full = p.textContent;
    q.addEventListener('click', () => {
      if (!a.hidden) { clearTimeout(qa._t); clearInterval(qa._i); a.hidden = true; q.setAttribute('aria-expanded', 'false'); p.textContent = p.dataset.full; return; }
      openQa(qa);
    });
  });
  function openQa(qa) {
    const q = $('.q', qa), a = $('.a', qa), p = $('p', a), full = p.dataset.full;
    a.hidden = false; q.setAttribute('aria-expanded', 'true');
    if (reduce) { p.textContent = full; return; }
    clearTimeout(qa._t); clearInterval(qa._i);
    p.className = 'typing'; p.innerHTML = '<i></i><i></i><i></i>';
    qa._t = setTimeout(() => {
      p.className = ''; let i = 0;
      qa._i = setInterval(() => { i += 2; if (i >= full.length) { clearInterval(qa._i); p.textContent = full; return; } p.innerHTML = ''; p.append(document.createTextNode(full.slice(0, i))); const c = document.createElement('span'); c.className = 'cur'; p.append(c); }, 18);
    }, 700);
  }
  let first = false;
  new IntersectionObserver((es, o) => es.forEach(e => { if (e.isIntersecting && !first) { first = true; o.disconnect(); setTimeout(() => openQa(qas[0]), 600); } }), { threshold: .35 }).observe($('#chat'));
}

/* ============ limpar dados ============ */
function setupClear() {
  $('#clear-data').addEventListener('click', () => {
    store.clear(); cart.length = 0;
    Object.assign(customer, { mode: '', rua: '', bairro: '', compl: '', nome: '', fone: '', pay: '', troco: '' });
    ['#rp-nome', '#ev-nome', '#ev-obs'].forEach(s => { $(s).value = ''; });
    money.shown = 0; refreshCartUI(); toast('Dados apagados deste aparelho.');
  });
}

/* ============ MASCOTE: a logo do Brasê andando pelas bordas ============ */
function setupMascot() {
  if (reduce) { $('#mlayer').style.display = 'none'; return; }
  const layer = $('#mlayer'), m = $('#mascot'), bub = $('#m-bubble'), SZ = 62;
  const SAY = {
    links: ['Bora acender essa brasa?', 'Tudo, menos blasé.'],
    cardapio: ['O Strike serve 2. Bom pra dividir.', 'Segure a foto do prato para assar.'],
    combos: ['A peixada serve 3. Chama a mesa.', 'Maminha na brasa, olha só.'],
    boliche: ['Derruba tudo!', 'Arrasta a bola pra cima.'],
    eventos: ['Comemoração boa é aqui.', 'Conta o que você quer celebrar.'],
    kids: ['Tem parquinho pra criançada.', 'Música ao vivo também.'],
    quem: ['Gente de verdade falando do Brasê.', 'Dá uma olhada nas avaliações.'],
    faq: ['Pergunta aí, eu respondo.', 'Toque numa pergunta.'],
    local: ['Te espero no Jóquei.', 'Chama no WhatsApp antes de vir.']
  };
  let W = 0, H = 0, leg = 0, x = 0, y = 0, tY = 0, hideBub, sec = 'links', tick = 0, started = false, cartShift = 0, lastT = 0, nextSay = 0, lineI = {};
  const legs = () => [{ row: 'bot', from: -SZ, to: W }, { row: 'top', from: W, to: -SZ }, { row: 'bot', from: W, to: -SZ }, { row: 'top', from: -SZ, to: W }];
  const size = () => { W = layer.clientWidth; H = layer.clientHeight; };
  size(); addEventListener('resize', size);
  const botY = () => H - SZ - 12 - cartShift, topY = 80;
  function startLeg() { size(); const l = legs()[leg % 4]; x = l.from; y = l.row === 'bot' ? botY() : topY; m.classList.toggle('top', l.row === 'top'); }
  function say(text) {
    if (!text) return; bub.textContent = text; bub.classList.add('show'); clearTimeout(hideBub); hideBub = setTimeout(() => bub.classList.remove("show"), 3000);
  }
  function lineFor(s) { const arr = SAY[s] || SAY.links; lineI[s] = ((lineI[s] ?? -1) + 1) % arr.length; return arr[lineI[s]]; }
  document.addEventListener('sectionchange', e => { sec = e.detail; if (started) say(lineFor(sec)); nextSay = performance.now() + 11000; });
  document.addEventListener('introend', () => { setTimeout(() => { started = true; m.classList.remove('off'); startLeg(); say(lineFor(sec)); nextSay = performance.now() + 11000; }, 900); });
  (function loop(now) {
    requestAnimationFrame(loop);
    const dt = Math.min(.05, (now - (lastT || now)) / 1000); lastT = now;
    if (!started) return;
    const hide = sheetOpen; m.classList.toggle('off', hide);
    if (hide) return;
    const wantShift = $('#cartbar').hidden ? 0 : 74; cartShift += (wantShift - cartShift) * Math.min(1, dt * 6);
    const l = legs()[leg % 4], dirn = Math.sign(l.to - l.from);
    x += dirn * 58 * dt;
    if ((dirn > 0 && x >= l.to) || (dirn < 0 && x <= l.to)) { leg++; startLeg(); }
    const ty = l.row === 'bot' ? botY() : topY; y += (ty - y) * Math.min(1, dt * 8);
    m.style.transform = `translate(${x.toFixed(1)}px,${y.toFixed(1)}px)`;
    const edge = x < 100 ? 'edgeL' : x > W - 100 - SZ ? 'edgeR' : '';
    if (bub.dataset.edge !== edge) { bub.classList.remove('edgeL', 'edgeR'); if (edge) bub.classList.add(edge); bub.dataset.edge = edge; }
    if (now > nextSay) { nextSay = now + 12000; say(lineFor(sec)); }
  })(performance.now());
}


/* ============ quem vem com você (ambiente) ============ */
function setupWho() {
  const W = [
    { t: 'Parquinho a R$ 29,90 por criança, menu kids e milk shake para os pequenos. Para os adultos, boliche e drinks.', go: '#c-kids', l: 'Ver o menu kids', g: 0 },
    { t: 'Drinks autorais para começar, uma mesa para dois e o boliche para depois. Ambiente climatizado, com música ao vivo em dias de apresentação.', go: '#c-autorais', l: 'Ver os drinks autorais', g: 5 },
    { t: 'O Strike serve 2, dá para dividir. Chopp no cardápio e uma pista reservada para a turma toda.', go: '#boliche', l: 'Reservar a pista', g: 3 },
    { t: 'Comemoração no salão, com a pista de boliche como atração extra. Conte para a gente o que você quer celebrar.', go: '#eventos', l: 'Montar o evento', g: 4 }
  ];
  const g = $('#gallery');
  const set = i => {
    const w = W[i]; $('#who-txt').textContent = w.t; const a = $('#who-go'); a.href = w.go; $('span', a).textContent = w.l;
    const card = $('#who-card'); card.style.animation = 'none'; void card.offsetWidth; card.style.animation = '';
    const f = $$('figure', g)[w.g]; if (f) g.scrollTo({ left: f.offsetLeft - (g.clientWidth - f.offsetWidth) / 2, behavior: reduce ? 'auto' : 'smooth' });
  };
  $('#who').addEventListener('segchange', e => set(+e.detail.dataset.w));
  const t = $('#who-txt'); t.textContent = W[0].t;
}

/* ============ INICIAR ============ */
splitWords(); setupLinks(); setupSteppers(); refreshStatus(); setInterval(refreshStatus, 30000);
setupReveal(); setupMesa(); setupMenu(); setupRoast(); refreshCartUI();
setupLane(); setupForms(); setupGallery(); setupCarousel(); setupFaq(); setupClear(); setupWho(); setupEmbers(); setupMascot();
loadTrackers(); onScroll(); requestAnimationFrame(() => document.dispatchEvent(new Event('introend')));
window.__brase = { cart, customer, ITEMS, CONFIG, buildMessage, openState, refreshStatus, trackLog, openCart, addLine, closeSheet, setNow: d => { window.__fakeNow = d; refreshStatus(); }, mesa };
})();
