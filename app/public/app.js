'use strict';

(() => {
  const $ = (id) => document.getElementById(id);

  const state = {
    tracks: [],
    byId: new Map(),
    tapes: [],
    current: blankTape(),
    filter: '',
  };

  function blankTape() {
    return { id: null, title: '', to: '', from: '', note: '', style: 'red', lengthMin: 45, sideA: [], sideB: [] };
  }

  // ---------- utils ----------
  function h(tag, attrs = {}, ...kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') e.className = v;
      else if (k === 'text') e.textContent = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else if (v !== false && v != null) e.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) {
      if (kid == null) continue;
      e.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    }
    return e;
  }

  const fmt = (sec) => {
    sec = Math.max(0, Math.round(sec));
    return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
  };

  let toastTimer;
  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (t.textContent = ''), 3500);
  }

  async function api(path, opts) {
    const res = await fetch(path, {
      headers: { 'Content-Type': 'application/json' },
      ...opts,
      body: opts && opts.body ? JSON.stringify(opts.body) : undefined,
    });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return res.status === 204 ? null : res.json();
  }

  // ---------- tape math ----------
  const capacity = () => state.current.lengthMin * 60;
  const sideSecs = (side) =>
    state.current[side === 'A' ? 'sideA' : 'sideB'].reduce((s, id) => s + (state.byId.get(id)?.duration || 0), 0);
  const usedIds = () => new Set([...state.current.sideA, ...state.current.sideB]);

  function addToSide(id, side) {
    const key = side === 'A' ? 'sideA' : 'sideB';
    const t = state.byId.get(id);
    if (!t) return;
    if (usedIds().has(id)) return toast('Already on this tape.');
    if (sideSecs(side) + t.duration > capacity()) {
      return toast(`Side ${side} is full. That one won't fit — make a hard choice.`);
    }
    state.current[key].push(id);
    renderAll();
  }

  function removeFrom(side, idx) {
    state.current[side === 'A' ? 'sideA' : 'sideB'].splice(idx, 1);
    renderAll();
  }

  function move(side, idx, dir) {
    const arr = state.current[side === 'A' ? 'sideA' : 'sideB'];
    const j = idx + dir;
    if (j < 0 || j >= arr.length) return;
    [arr[idx], arr[j]] = [arr[j], arr[idx]];
    renderAll();
  }

  function flip(side, idx) {
    const from = side === 'A' ? 'sideA' : 'sideB';
    const to = side === 'A' ? 'B' : 'A';
    const id = state.current[from][idx];
    const t = state.byId.get(id);
    if (sideSecs(to) + (t?.duration || 0) > capacity()) return toast(`Side ${to} is full.`);
    state.current[from].splice(idx, 1);
    state.current[to === 'A' ? 'sideA' : 'sideB'].push(id);
    renderAll();
  }

  // ---------- rendering ----------
  function renderLibrary() {
    const q = state.filter.toLowerCase();
    const used = usedIds();
    const list = $('track-list');
    list.replaceChildren();
    const shown = state.tracks.filter(
      (t) => !q || `${t.artist} ${t.title} ${t.album}`.toLowerCase().includes(q)
    );
    const frag = document.createDocumentFragment();
    for (const t of shown.slice(0, 500)) {
      frag.append(
        h(
          'li',
          { class: used.has(t.id) ? 'used' : '' },
          h('div', { class: 'name' }, t.title, h('small', { text: `${t.artist}${t.album ? ' · ' + t.album : ''}` })),
          h(
            'div',
            { class: 'btns' },
            h('span', { class: 'dur', text: fmt(t.duration) }),
            h('button', { class: 'small', title: 'Preview', onclick: () => preview(t.id) }, '▶'),
            h('button', { class: 'small', title: 'Add to Side A', onclick: () => addToSide(t.id, 'A') }, 'A'),
            h('button', { class: 'small', title: 'Add to Side B', onclick: () => addToSide(t.id, 'B') }, 'B')
          )
        )
      );
    }
    list.append(frag);
    if (shown.length > 500) list.append(h('li', { class: 'muted' }, `Showing 500 of ${shown.length}. Narrow your search.`));
    if (!state.tracks.length) list.append(h('li', { class: 'muted' }, 'No music found yet.'));
  }

  function renderSide(side) {
    const key = side === 'A' ? 'sideA' : 'sideB';
    const ol = $(`list-${side}`);
    ol.replaceChildren();
    const arr = state.current[key];
    if (!arr.length) {
      ol.append(h('div', { class: 'empty-side', text: 'Add songs with the A / B buttons.' }));
    }
    arr.forEach((id, i) => {
      const t = state.byId.get(id);
      ol.append(
        h(
          'li',
          {},
          h('div', { class: 'name' }, t ? t.title : '(missing track)', t ? h('small', { text: t.artist }) : null),
          h(
            'div',
            { class: 'btns' },
            h('span', { class: 'dur', text: fmt(t?.duration || 0) }),
            h('button', { class: 'small', title: 'Move up', onclick: () => move(side, i, -1) }, '↑'),
            h('button', { class: 'small', title: 'Move down', onclick: () => move(side, i, 1) }, '↓'),
            h('button', { class: 'small', title: `Flip to Side ${side === 'A' ? 'B' : 'A'}`, onclick: () => flip(side, i) }, '⇄'),
            h('button', { class: 'small', title: 'Remove', onclick: () => removeFrom(side, i) }, '✕')
          )
        )
      );
    });
    const used = sideSecs(side);
    const cap = capacity();
    const left = cap - used;
    const time = $(`time-${side}`);
    time.textContent = `${fmt(used)} / ${fmt(cap)}  (${fmt(left)} left)`;
    time.className = 'time' + (left < 0 ? ' bad' : left < 120 ? ' warn' : '');
    const bar = $(`bar-${side}`);
    bar.style.width = Math.min(100, (used / cap) * 100) + '%';
    bar.className = 'tape-fill' + (left < 0 ? ' bad' : '');
  }

  function renderMeta() {
    const c = state.current;
    $('t-title').value = c.title;
    $('t-to').value = c.to;
    $('t-from').value = c.from;
    $('t-note').value = c.note;
    $('t-length').value = String(c.lengthMin);
    $('t-style').value = c.style;
  }

  function renderAll() {
    renderLibrary();
    renderSide('A');
    renderSide('B');
    renderPreview();
  }

  // ---------- cassette art ----------
  const STYLES = {
    red:   { shell: '#1d1c22', shell2: '#08080b', accent: '#d4232a', accent2: '#f2a0a4', label: '#f4eddc', ink: '#1c2a8a' },
    green: { shell: '#171d19', shell2: '#070a08', accent: '#19a15f', accent2: '#a4e3c3', label: '#eef2e6', ink: '#1c2a8a' },
    blue:  { shell: '#2457c9', shell2: '#102a6c', accent: '#ffd200', accent2: '#fff0a0', label: '#fbf6e2', ink: '#14307a' },
    white: { shell: '#e4e4e8', shell2: '#a9a9b2', accent: '#8a8a94', accent2: '#d2d2d9', label: '#ffffff', ink: '#222222' },
  };
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let svgSeq = 0;

  // How much of the tape is "recorded" (0..1). Drives how much tape sits on each reel.
  function fillRatio(tape) {
    const cap = (tape.lengthMin || 45) * 60 * 2;
    const secs = (ids) => (ids || []).reduce((s, id) => s + (state.byId.get(id)?.duration || 0), 0);
    return Math.min(1, (secs(tape.sideA) + secs(tape.sideB)) / cap);
  }

  function hub(cx, cy, id) {
    let teeth = '';
    for (let a = 0; a < 360; a += 60) {
      teeth += `<path d="M${cx - 2.3} ${cy - 9.2} h4.6 v4.9 h-4.6 z" fill="url(#${id}w)" stroke="rgba(0,0,0,.35)" stroke-width=".4" transform="rotate(${a} ${cx} ${cy})"/>`;
    }
    return `<circle cx="${cx}" cy="${cy}" r="15.4" fill="rgba(0,0,0,.6)" filter="url(#${id}bl)"/>
      <circle cx="${cx}" cy="${cy}" r="13.2" fill="url(#${id}w)" stroke="#7d7d84" stroke-width=".8"/>
      <circle cx="${cx}" cy="${cy}" r="11.4" fill="none" stroke="rgba(0,0,0,.18)" stroke-width=".8"/>
      <circle cx="${cx}" cy="${cy}" r="9.3" fill="#060607"/>
      <circle cx="${cx}" cy="${cy}" r="9.3" fill="none" stroke="rgba(255,255,255,.28)" stroke-width=".7"/>
      ${teeth}
      <path d="M${cx - 10.5} ${cy - 5} A11.6 11.6 0 0 1 ${cx - 2} ${cy - 11.4}" stroke="rgba(255,255,255,.9)" stroke-width="1.1" fill="none" stroke-linecap="round"/>`;
  }

  function cassetteSVGVector(tape) {
    const s = STYLES[tape.style] || STYLES.red;
    const id = `c${++svgSeq}`;
    const p = Math.max(0.08, fillRatio(tape));
    const rl = 14.5 + (1 - p) * 10.5; // unwound side keeps the big pack
    const rr = 14.5 + p * 10.5;
    const title = (tape.title || '').trim() || 'Untitled Mix';
    const tSize = Math.max(20, Math.min(36, 36 - Math.max(0, title.length - 13) * 1.0));
    const to = (tape.to || '').trim();
    const from = (tape.from || '').trim();
    const line = [to && `To: ${to}`, from && `From: ${from}`].filter(Boolean).join('  ·  ');
    const hand = "Caveat,'Segoe Print','Bradley Hand','Marker Felt',cursive";
    const print = "'Helvetica Neue',Helvetica,Arial,sans-serif";

    // tape pack: wound tape with fine winding lines and a specular arc
    const pack = (cx, r) => {
      let rings = '';
      for (let q = 17; q < r - 1; q += 2.1) {
        rings += `<circle cx="${cx}" cy="130" r="${q.toFixed(1)}" fill="none" stroke="${q % 4.2 < 2.1 ? 'rgba(0,0,0,.30)' : 'rgba(255,225,190,.07)'}" stroke-width=".7"/>`;
      }
      const R = r * 0.84, a0 = (200 * Math.PI) / 180, a1 = (266 * Math.PI) / 180;
      const arc = `M${cx + R * Math.cos(a0)} ${130 + R * Math.sin(a0)} A${R} ${R} 0 0 1 ${cx + R * Math.cos(a1)} ${130 + R * Math.sin(a1)}`;
      return `<circle cx="${cx}" cy="130" r="${r + 1.2}" fill="rgba(0,0,0,.6)"/>
        <circle cx="${cx}" cy="130" r="${r}" fill="url(#${id}p)"/>${rings}
        <path d="${arc}" stroke="rgba(255,236,214,.5)" stroke-width="2.4" fill="none" stroke-linecap="round" filter="url(#${id}bl)"/>
        <circle cx="${cx}" cy="130" r="${r}" fill="none" stroke="rgba(0,0,0,.55)" stroke-width="1"/>`;
    };

    const screw = (cx, cy, r, rot) => `<circle cx="${cx}" cy="${cy}" r="${r + 2.2}" fill="rgba(0,0,0,.5)" filter="url(#${id}bl)"/>
      <circle cx="${cx}" cy="${cy}" r="${r + .6}" fill="#0a0a0c"/>
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#${id}s)"/>
      <circle cx="${cx}" cy="${cy}" r="${r - .5}" fill="none" stroke="rgba(255,255,255,.55)" stroke-width=".6" stroke-dasharray="${(r * 2.2).toFixed(1)} 40" transform="rotate(200 ${cx} ${cy})"/>
      <g transform="rotate(${rot} ${cx} ${cy})">
        <path d="M${cx - r * .62} ${cy} h${r * 1.24} M${cx} ${cy - r * .62} v${r * 1.24}" stroke="#101013" stroke-width="${(r * .26).toFixed(2)}" stroke-linecap="round"/>
        <path d="M${cx - r * .62} ${cy + .7} h${r * 1.24} M${cx + .7} ${cy - r * .62} v${r * 1.24}" stroke="rgba(255,255,255,.35)" stroke-width=".5" stroke-linecap="round"/>
      </g>`;

    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 254" role="img" aria-label="Cassette tape: ${esc(title)}">
  <defs>
    <linearGradient id="${id}b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${s.shell}"/><stop offset="1" stop-color="${s.shell2}"/></linearGradient>
    <radialGradient id="${id}rh" cx=".28" cy=".12" r=".85"><stop offset="0" stop-color="#fff" stop-opacity=".16"/><stop offset=".55" stop-color="#fff" stop-opacity=".02"/><stop offset="1" stop-color="#000" stop-opacity=".25"/></radialGradient>
    <linearGradient id="${id}v" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".6"/><stop offset=".45" stop-color="#808080" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".55"/></linearGradient>
    <linearGradient id="${id}t" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity=".16"/><stop offset="1" stop-color="#000" stop-opacity=".50"/></linearGradient>
    <radialGradient id="${id}s" cx=".34" cy=".3" r=".85"><stop offset="0" stop-color="#fbfbfd"/><stop offset=".5" stop-color="#a6a6af"/><stop offset="1" stop-color="#5c5c66"/></radialGradient>
    <radialGradient id="${id}w" cx=".35" cy=".3" r=".9"><stop offset="0" stop-color="#ffffff"/><stop offset=".6" stop-color="#dcdce1"/><stop offset="1" stop-color="#a9a9b2"/></radialGradient>
    <radialGradient id="${id}p" cx=".38" cy=".32" r=".95"><stop offset="0" stop-color="#7a5236"/><stop offset=".55" stop-color="#3a2415"/><stop offset="1" stop-color="#1b110a"/></radialGradient>
    <linearGradient id="${id}gl" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".22"/><stop offset=".42" stop-color="#fff" stop-opacity=".04"/><stop offset=".43" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#fff" stop-opacity=".05"/></linearGradient>
    <linearGradient id="${id}is" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity=".75"/><stop offset="1" stop-color="#000" stop-opacity="0"/></linearGradient>
    <linearGradient id="${id}lp" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".32"/><stop offset=".5" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#5a4a30" stop-opacity=".14"/></linearGradient>
    <linearGradient id="${id}m" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#6d6d76"/><stop offset=".5" stop-color="#d9d9df"/><stop offset="1" stop-color="#6d6d76"/></linearGradient>

    <filter id="${id}gr" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">
      <feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" seed="11"/><feColorMatrix type="saturate" values="0"/>
    </filter>
    <filter id="${id}pg" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">
      <feTurbulence type="fractalNoise" baseFrequency=".55 .8" numOctaves="3" seed="4"/><feColorMatrix type="saturate" values="0"/>
    </filter>
    <filter id="${id}bv" x="-3%" y="-3%" width="106%" height="106%" color-interpolation-filters="sRGB">
      <feGaussianBlur in="SourceAlpha" stdDeviation="2.6" result="hm"/>
      <feSpecularLighting in="hm" surfaceScale="7" specularConstant="1" specularExponent="24" lighting-color="#ffffff" result="sp"><feDistantLight azimuth="232" elevation="52"/></feSpecularLighting>
      <feComposite in="sp" in2="SourceAlpha" operator="in" result="spi"/>
      <feDiffuseLighting in="hm" surfaceScale="6" diffuseConstant="1.05" lighting-color="#ffffff" result="df"><feDistantLight azimuth="232" elevation="62"/></feDiffuseLighting>
      <feComposite in="df" in2="SourceAlpha" operator="in" result="dfi"/>
      <feBlend in="SourceGraphic" in2="dfi" mode="multiply" result="lit"/>
      <feComposite in="lit" in2="spi" operator="arithmetic" k1="0" k2="1" k3=".65" k4="0"/>
    </filter>
    <filter id="${id}bl" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="1.3"/></filter>
    <filter id="${id}ls" x="-5%" y="-5%" width="110%" height="115%"><feGaussianBlur stdDeviation="1.6"/></filter>
    <filter id="${id}ink" x="-2%" y="-10%" width="104%" height="130%">
      <feTurbulence type="fractalNoise" baseFrequency=".045" numOctaves="2" seed="5" result="t"/><feDisplacementMap in="SourceGraphic" in2="t" scale="1.3"/>
    </filter>

    <clipPath id="${id}sh"><rect x="4" y="4" width="392" height="246" rx="16"/></clipPath>
    <clipPath id="${id}l"><rect x="24" y="30" width="352" height="136" rx="4.5"/></clipPath>
    <clipPath id="${id}n"><rect x="80" y="46" width="292" height="44"/></clipPath>
    <clipPath id="${id}wn"><rect x="112" y="104" width="176" height="52" rx="8"/></clipPath>
  </defs>

  <!-- shell: molded plastic with bevel lighting and grain -->
  <rect x="4" y="4" width="392" height="246" rx="16" fill="url(#${id}b)" filter="url(#${id}bv)"/>
  <g clip-path="url(#${id}sh)">
    <rect x="0" y="0" width="400" height="254" filter="url(#${id}gr)" style="mix-blend-mode:soft-light" opacity=".4"/>
    <rect x="0" y="0" width="400" height="254" fill="url(#${id}rh)"/>
  </g>
  <rect x="4.5" y="4.5" width="391" height="245" rx="15.5" fill="none" stroke="rgba(0,0,0,.65)" stroke-width="1"/>
  <!-- mould parting line -->
  <path d="M10 168 H390" stroke="rgba(0,0,0,.18)" stroke-width=".8"/><path d="M10 169 H390" stroke="rgba(255,255,255,.07)" stroke-width=".8"/>

  <!-- bottom bezel -->
  <g filter="url(#${id}bv)"><polygon points="92,176 308,176 336,244 64,244" fill="url(#${id}t)"/></g>
  <polygon points="92,176 308,176 336,244 64,244" fill="none" stroke="rgba(0,0,0,.55)" stroke-width="1"/>
  <g>
    <circle cx="126" cy="214" r="10.5" fill="rgba(0,0,0,.4)" filter="url(#${id}bl)"/>
    <circle cx="126" cy="214" r="9" fill="#040405"/><path d="M118 218.5 A9 9 0 0 0 134 218.5" stroke="rgba(255,255,255,.3)" stroke-width="1" fill="none"/>
    <circle cx="274" cy="214" r="10.5" fill="rgba(0,0,0,.4)" filter="url(#${id}bl)"/>
    <circle cx="274" cy="214" r="9" fill="#040405"/><path d="M266 218.5 A9 9 0 0 0 282 218.5" stroke="rgba(255,255,255,.3)" stroke-width="1" fill="none"/>
    <circle cx="172" cy="208" r="4.6" fill="#040405"/><circle cx="228" cy="208" r="4.6" fill="#040405"/>
  </g>
  <rect x="150" y="235" width="100" height="15" rx="2" fill="#050506" stroke="rgba(255,255,255,.12)" stroke-width=".6"/>
  <rect x="173" y="237" width="5" height="13" fill="url(#${id}m)"/><rect x="197.5" y="237" width="5" height="13" fill="url(#${id}m)"/><rect x="222" y="237" width="5" height="13" fill="url(#${id}m)"/>

  <!-- label: paper sticker with soft contact shadow -->
  <rect x="25" y="33" width="352" height="136" rx="5" fill="rgba(0,0,0,.65)" filter="url(#${id}ls)"/>
  <g clip-path="url(#${id}l)">
    <rect x="24" y="30" width="352" height="136" fill="${s.label}"/>
    <rect x="24" y="30" width="352" height="136" filter="url(#${id}pg)" style="mix-blend-mode:multiply" opacity=".22"/>
    <rect x="24" y="30" width="352" height="136" fill="url(#${id}lp)"/>
    <rect x="24" y="30" width="352" height="13" fill="${s.accent}"/>
    <rect x="24" y="30" width="352" height="13" fill="url(#${id}lp)"/>
    <rect x="24" y="45" width="352" height="3" fill="${s.accent2}"/>
    <rect x="29" y="53" width="40" height="38" rx="3" fill="none" stroke="${s.ink}" stroke-width="2.2" opacity=".9"/>
    <text x="49" y="83" text-anchor="middle" font-family="${print}" font-size="29" font-weight="900" fill="${s.ink}" opacity=".92">A</text>
    <g clip-path="url(#${id}n)" filter="url(#${id}ink)" style="mix-blend-mode:multiply">
      <text x="82" y="76" font-family="${hand}" font-size="${tSize}" font-weight="700" fill="${s.ink}" opacity=".94">${esc(title)}</text>
    </g>
    <line x1="80" y1="82" x2="370" y2="82" stroke="rgba(30,60,140,.35)" stroke-width=".9"/>
    <line x1="80" y1="101" x2="370" y2="101" stroke="rgba(30,60,140,.25)" stroke-width=".9"/>
    ${line ? `<g filter="url(#${id}ink)" style="mix-blend-mode:multiply"><text x="84" y="97" font-family="${hand}" font-size="17.5" font-weight="500" fill="${s.ink}" opacity=".9">${esc(line)}</text></g>` : ''}
    <text x="68" y="135" text-anchor="middle" font-family="${print}" font-size="14" font-weight="800" fill="#2c2c30" letter-spacing=".5">C-${(tape.lengthMin || 45) * 2}</text>
    <text x="68" y="148" text-anchor="middle" font-family="${print}" font-size="7.5" fill="#55555c" letter-spacing=".9">${tape.lengthMin || 45} MIN / SIDE</text>
    <text x="332" y="132" text-anchor="middle" font-family="${print}" font-size="8.5" font-weight="700" fill="#44444a" letter-spacing=".9">TYPE I</text>
    <text x="332" y="144" text-anchor="middle" font-family="${print}" font-size="8" fill="#55555c" letter-spacing="1">NORMAL</text>
    <text x="332" y="156" text-anchor="middle" font-family="${print}" font-size="7" fill="#6a6a72" letter-spacing=".9">70 µs EQ</text>
  </g>
  <rect x="24" y="30" width="352" height="136" rx="4.5" fill="none" stroke="rgba(0,0,0,.45)" stroke-width=".8"/>
  <path d="M26 30.6 H374" stroke="rgba(255,255,255,.45)" stroke-width=".8"/>

  <!-- window: tape, hubs, glass -->
  <rect x="111" y="103" width="178" height="54" rx="9" fill="rgba(0,0,0,.45)" filter="url(#${id}bl)"/>
  <rect x="112" y="104" width="176" height="52" rx="8" fill="#0a0807"/>
  <g clip-path="url(#${id}wn)">
    ${pack(148, rl)}${pack(252, rr)}
    <path d="M148 ${130 + rl} L252 ${130 + rr}" stroke="#2a190e" stroke-width="2.6" fill="none"/>
    <path d="M148 ${130 + rl} L252 ${130 + rr}" stroke="#7d5232" stroke-width="1.2" fill="none"/>
    <path d="M148 ${129.2 + rl} L252 ${129.2 + rr}" stroke="rgba(255,230,200,.35)" stroke-width=".5" fill="none"/>
    ${hub(148, 130, id)}${hub(252, 130, id)}
    <rect x="112" y="104" width="176" height="52" fill="url(#${id}gl)"/>
    <rect x="112" y="104" width="176" height="16" fill="url(#${id}is)"/>
  </g>
  <rect x="112" y="104" width="176" height="52" rx="8" fill="none" stroke="rgba(0,0,0,.9)" stroke-width="1.6"/>
  <path d="M116 157.2 H284" stroke="rgba(255,255,255,.28)" stroke-width=".8"/>

  <!-- screws -->
  ${screw(17, 17, 6.6, 28)}${screw(383, 17, 6.6, 71)}${screw(17, 237, 6.6, 12)}${screw(383, 237, 6.6, 54)}${screw(200, 16.5, 5.2, 40)}

  <!-- overall lighting -->
  <g clip-path="url(#${id}sh)"><rect x="0" y="0" width="400" height="254" fill="url(#${id}v)" style="mix-blend-mode:soft-light" opacity=".55"/></g>
</svg>`;
  }

  // ---------- photo-based cassette ----------
  // The shell is a real photograph (img/cassette-base.webp, 1536x1024). Everything on the paper
  // label is drawn on top of it in code, so each tape still gets its own title, names and note.
  let photoOk = true;
  const PHOTO_SRC = 'img/cassette-base.webp';
  const LABEL = '192,119 1335,119 1396,190 1396,688 1388,695 140,695 131,688 131,190';

  function cassetteSVG(tape) {
    if (!photoOk) return cassetteSVGVector(tape);
    const s = STYLES[tape.style] || STYLES.red;
    const id = `p${++svgSeq}`;
    const title = (tape.title || '').trim() || 'Untitled Mix';
    const to = (tape.to || '').trim();
    const from = (tape.from || '').trim();
    const note = (tape.note || '').trim();
    const line = [to && `To: ${to}`, from && `From: ${from}`].filter(Boolean).join('   ·   ');
    const mins = tape.lengthMin || 45;
    const hand = "Caveat,'Segoe Print','Bradley Hand','Marker Felt',cursive";
    const print = "'Helvetica Neue',Helvetica,Arial,sans-serif";
    const tSize = Math.max(58, Math.min(104, 104 - Math.max(0, title.length - 14) * 2.6));
    const nSize = Math.max(34, Math.min(50, 50 - Math.max(0, note.length - 34) * 0.55));

    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1536 1024" role="img" aria-label="Cassette tape: ${esc(title)}">
  <defs>
    <clipPath id="${id}l"><polygon points="${LABEL}"/></clipPath>
    <clipPath id="${id}t"><rect x="268" y="150" width="1090" height="150"/></clipPath>
    <clipPath id="${id}n"><rect x="420" y="585" width="740" height="110"/></clipPath>
    <filter id="${id}g" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">
      <feTurbulence type="fractalNoise" baseFrequency=".6 .9" numOctaves="3" seed="7"/><feColorMatrix type="saturate" values="0"/>
    </filter>
    <filter id="${id}ink" x="-2%" y="-15%" width="104%" height="135%">
      <feTurbulence type="fractalNoise" baseFrequency=".03" numOctaves="2" seed="5" result="t"/><feDisplacementMap in="SourceGraphic" in2="t" scale="3.2"/>
    </filter>
    <linearGradient id="${id}sh" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#000" stop-opacity=".16"/><stop offset=".12" stop-color="#000" stop-opacity="0"/>
      <stop offset=".9" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".12"/>
    </linearGradient>
  </defs>

  <image href="${PHOTO_SRC}" x="0" y="0" width="1536" height="1024"/>

  <g clip-path="url(#${id}l)">
    <!-- coloured stripe printed on the paper -->
    <rect x="120" y="119" width="1290" height="40" fill="${s.accent}" style="mix-blend-mode:multiply" opacity=".92"/>
    <rect x="120" y="164" width="1290" height="9" fill="${s.accent2}" style="mix-blend-mode:multiply" opacity=".9"/>
    <!-- paper grain + soft edge shading so the print sits in the photo -->
    <rect x="120" y="119" width="1290" height="590" filter="url(#${id}g)" style="mix-blend-mode:multiply" opacity=".12"/>
    <rect x="120" y="119" width="1290" height="590" fill="url(#${id}sh)"/>

    <!-- side marker -->
    <rect x="166" y="372" width="118" height="118" rx="10" fill="none" stroke="${s.ink}" stroke-width="7" opacity=".85" style="mix-blend-mode:multiply"/>
    <text x="225" y="470" text-anchor="middle" font-family="${print}" font-size="96" font-weight="900" fill="${s.ink}" opacity=".88" style="mix-blend-mode:multiply">A</text>

    <!-- handwritten title and names -->
    <g clip-path="url(#${id}t)" filter="url(#${id}ink)" style="mix-blend-mode:multiply">
      <text x="276" y="244" font-family="${hand}" font-size="${tSize}" font-weight="700" fill="${s.ink}" opacity=".94">${esc(title)}</text>
    </g>
    <line x1="268" y1="262" x2="1370" y2="262" stroke="rgba(40,70,150,.38)" stroke-width="2.2"/>
    <line x1="268" y1="311" x2="1370" y2="311" stroke="rgba(40,70,150,.28)" stroke-width="2.2"/>
    ${line ? `<g filter="url(#${id}ink)" style="mix-blend-mode:multiply"><text x="280" y="302" font-family="${hand}" font-size="44" font-weight="500" fill="${s.ink}" opacity=".92">${esc(line)}</text></g>` : ''}

    <!-- printed details, left and right of the window -->
    <g font-family="${print}" fill="#3a3a40" style="mix-blend-mode:multiply" text-anchor="middle">
      <text x="1303" y="420" font-size="36" font-weight="800" letter-spacing="2" opacity=".85">TYPE I</text>
      <text x="1303" y="466" font-size="31" opacity=".72" letter-spacing="3">NORMAL</text>
      <text x="1303" y="508" font-size="26" opacity=".6" letter-spacing="2">70 µs EQ</text>
    </g>

    <!-- under the window: length and a handwritten note -->
    <g font-family="${print}" fill="#303036" style="mix-blend-mode:multiply" text-anchor="middle">
      <text x="276" y="640" font-size="54" font-weight="800" letter-spacing="1" opacity=".86">C-${mins * 2}</text>
      <text x="276" y="676" font-size="23" opacity=".62" letter-spacing="3">${mins} MIN / SIDE</text>
    </g>
    ${note ? `<g clip-path="url(#${id}n)" filter="url(#${id}ink)" style="mix-blend-mode:multiply"><text x="790" y="650" text-anchor="middle" font-family="${hand}" font-size="${nSize}" font-weight="500" fill="${s.ink}" opacity=".9">${esc(note)}</text></g>` : ''}
  </g>
</svg>`;
  }

  function renderPreview() {
    const box = $('preview');
    if (box) box.innerHTML = cassetteSVG(state.current);
  }

  function renderShelf() {
    const shelf = $('shelf');
    shelf.replaceChildren();
    $('shelf-empty').classList.toggle('hidden', state.tapes.length > 0);
    for (const t of state.tapes) {
      const count = t.sideA.length + t.sideB.length;
      const art = h('div', { class: 'cassette-art' });
      art.innerHTML = cassetteSVG(t);
      shelf.append(
        h(
          'div',
          { class: 'cassette' },
          art,
          h('div', { class: 'info', text: `C-${t.lengthMin * 2} · ${count} song${count === 1 ? '' : 's'}` }),
          h(
            'div',
            { class: 'btns' },
            h('button', { onclick: () => openTape(t) }, 'Edit'),
            h('button', { onclick: () => printJCard(t) }, 'Print'),
            h('button', { onclick: () => (location.href = `api/tapes/${t.id}/m3u`) }, 'M3U'),
            h('button', { onclick: () => deleteTape(t) }, 'Delete')
          )
        )
      );
    }
  }

  // ---------- J-card ----------
  function printJCard(tape) {
    const root = $('jcard-root');
    const sideList = (ids, label) => {
      const secs = ids.reduce((s, id) => s + (state.byId.get(id)?.duration || 0), 0);
      return [
        h('h2', {}, h('span', { text: `SIDE ${label}` }), h('span', { text: fmt(secs) })),
        h(
          'ol',
          {},
          ids.map((id) => {
            const t = state.byId.get(id);
            return h('li', { text: t ? `${t.artist} – ${t.title}` : '(missing track)' });
          })
        ),
      ];
    };
    root.replaceChildren(
      h(
        'div',
        { class: `jcard s-${tape.style}` },
        h('div', { class: 'back' }, h('div', { class: 'bar' }), sideList(tape.sideA, 'A'), sideList(tape.sideB, 'B')),
        h('div', { class: 'spine', text: tape.title || 'Untitled Mix' }),
        h(
          'div',
          { class: 'front' },
          h('div', { class: 'bar' }),
          h('h1', { text: tape.title || 'Untitled Mix' }),
          h('div', { class: 'tofrom' }, tape.to ? h('div', { text: `To: ${tape.to}` }) : null, tape.from ? h('div', { text: `From: ${tape.from}` }) : null),
          tape.note ? h('div', { class: 'note', text: tape.note }) : null,
          h('div', { class: 'cut', text: `C-${tape.lengthMin * 2} · cut on the dashed line, fold at the spine` })
        )
      )
    );
    window.print();
  }

  // ---------- actions ----------
  function readMeta() {
    const c = state.current;
    c.title = $('t-title').value.trim();
    c.to = $('t-to').value.trim();
    c.from = $('t-from').value.trim();
    c.note = $('t-note').value.trim();
    c.style = $('t-style').value;
    c.lengthMin = parseInt($('t-length').value, 10);
  }

  async function saveTape() {
    readMeta();
    if (!state.current.title) return toast('Give your tape a title first.');
    const over = ['A', 'B'].some((s) => sideSecs(s) > capacity());
    if (over) return toast('One side is over the tape length. Trim it down.');
    try {
      const saved = state.current.id
        ? await api(`api/tapes/${state.current.id}`, { method: 'PUT', body: state.current })
        : await api('api/tapes', { method: 'POST', body: state.current });
      state.current.id = saved.id;
      await loadTapes();
      toast('Saved to the shelf.');
    } catch (e) {
      toast(`Save failed: ${e.message}`);
    }
  }

  function openTape(t) {
    state.current = JSON.parse(JSON.stringify(t));
    renderMeta();
    renderAll();
    showView('build');
  }

  async function deleteTape(t) {
    if (!confirm(`Delete "${t.title || 'Untitled Mix'}"? This can't be undone.`)) return;
    await api(`api/tapes/${t.id}`, { method: 'DELETE' });
    if (state.current.id === t.id) state.current.id = null;
    await loadTapes();
  }

  function preview(id) {
    const p = $('player');
    p.src = `api/stream/${id}`;
    p.play().catch(() => {});
  }

  function exportM3U() {
    readMeta();
    if (!state.current.id) return toast('Save the tape first, then export.');
    location.href = `api/tapes/${state.current.id}/m3u`;
  }

  function showView(name) {
    document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
    $('view-build').classList.toggle('hidden', name !== 'build');
    $('view-shelf').classList.toggle('hidden', name !== 'shelf');
    if (name === 'shelf') renderShelf();
  }

  // ---------- data loading ----------
  let pollTimer;
  async function loadLibrary() {
    const lib = await api('api/library');
    state.tracks = lib.tracks;
    state.byId = new Map(lib.tracks.map((t) => [t.id, t]));
    const s = $('scan-status');
    if (lib.scanning) {
      s.textContent = `Scanning ${lib.progress}/${lib.total}…`;
      clearTimeout(pollTimer);
      pollTimer = setTimeout(loadLibrary, 1200);
    } else {
      s.textContent = lib.tracks.length
        ? `${lib.tracks.length} songs`
        : `No songs found in ${lib.musicDir}. Put music in your Umbrel music folder and hit Rescan.`;
    }
    renderAll();
  }

  async function loadTapes() {
    state.tapes = await api('api/tapes');
    renderShelf();
  }

  // ---------- wire up ----------
  $('search').addEventListener('input', (e) => {
    state.filter = e.target.value;
    renderLibrary();
  });
  $('rescan').addEventListener('click', async () => {
    await api('api/library/rescan', { method: 'POST' });
    setTimeout(loadLibrary, 300);
  });
  ['t-title', 't-to', 't-from', 't-note', 't-style'].forEach((id) =>
    $(id).addEventListener('input', () => {
      readMeta();
      renderPreview();
    })
  );
  ['t-length'].forEach((id) =>
    $(id).addEventListener('change', () => {
      readMeta();
      renderAll();
    })
  );
  $('save').addEventListener('click', saveTape);
  $('print').addEventListener('click', () => {
    readMeta();
    if (!state.current.sideA.length && !state.current.sideB.length) return toast('Add some songs first.');
    printJCard(state.current);
  });
  $('m3u').addEventListener('click', exportM3U);
  $('new').addEventListener('click', () => {
    state.current = blankTape();
    renderMeta();
    renderAll();
  });
  document.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => showView(b.dataset.view)));

  const probe = new Image();
  probe.onerror = () => {
    photoOk = false;
    renderPreview();
    renderShelf();
  };
  probe.src = PHOTO_SRC;

  renderMeta();
  Promise.all([loadLibrary(), loadTapes()]).catch((e) => toast(`Load failed: ${e.message}`));
})();
