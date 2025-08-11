/**
 * Animated Streak (GitHub-safe SVG via SMIL)
 * - Lifetime count-up (left)
 * - Flame crown ring with strong glow (center)
 * - Rising edge flames (left & right), no bubbles
 * - Longest streaks carousel (right)
 */

import fs from "node:fs/promises";
import path from "node:path";

const OUT = path.resolve(process.cwd(), "assets/streak.svg");
const GH_TOKEN = process.env.PAT_GITHUB;
const USER = process.env.GH_USER || "statikfintechllc";
if (!GH_TOKEN) throw new Error("PAT_GITHUB env missing");

// ---------------- GraphQL ----------------
const gql = async (query, variables = {}, attempt = 1) => {
  const r = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `bearer ${GH_TOKEN}`,
      "Content-Type": "application/json",
      "User-Agent": "ggpt-boost-streak"
    },
    body: JSON.stringify({ query, variables })
  });
  if (r.status >= 500 && attempt < 5) {
    await new Promise(res => setTimeout(res, attempt * 400));
    return gql(query, variables, attempt + 1);
  }
  if (!r.ok) throw new Error(`GraphQL ${r.status}: ${await r.text()}`);
  const j = await r.json();
  if (j.errors) throw new Error(JSON.stringify(j.errors));
  return j.data;
};

const qUser = `query($login:String!){ user(login:$login){ createdAt } }`;
const qCal = `
query($login:String!, $from:DateTime!, $to:DateTime!){
  user(login:$login){
    contributionsCollection(from:$from, to:$to){
      contributionCalendar{
        weeks{ contributionDays{ date contributionCount } }
      }
    }
  }
}
`;

// ---------- collect lifetime daily contributions ----------
const who = await gql(qUser, { login: USER });
const createdAt = new Date(who.user.createdAt);
const now = new Date();

const addDays = (d, n) => { const t = new Date(d); t.setUTCDate(t.getUTCDate() + n); return t; };

let cursor = new Date(Date.UTC(
  createdAt.getUTCFullYear(),
  createdAt.getUTCMonth(),
  createdAt.getUTCDate()
));

const allDays = [];
while (cursor < now) {
  const to = addDays(cursor, 365);
  const winFrom = cursor.toISOString();
  const winTo   = (to < now ? to : now).toISOString();
  const data = await gql(qCal, { login: USER, from: winFrom, to: winTo });
  const days = data.user.contributionsCollection.contributionCalendar.weeks
    .flatMap(w => w.contributionDays)
    .map(d => ({ date: d.date, count: d.contributionCount }));
  allDays.push(...days);
  cursor = to;
}

// unique + sort
const byDate = new Map();
for (const d of allDays) byDate.set(d.date, (byDate.get(d.date) || 0) + d.count);
const days = [...byDate.entries()]
  .map(([date, count]) => ({ date, count }))
  .sort((a, b) => new Date(a.date) - new Date(b.date));

// cumulative timeline
let run = 0;
const timeline = days.map(d => ({ date: d.date, total: (run += d.count) }));

// current streak (ending today)
let cs = 0;
for (let i = days.length - 1; i >= 0; i--) {
  if (new Date(days[i].date) > now) continue;
  if (days[i].count > 0) cs++;
  else break;
}

// longest streaks
const streaks = [];
let cur = 0, start = null;
for (let i = 0; i < days.length; i++) {
  const d = days[i];
  if (d.count > 0) {
    if (cur === 0) start = d.date;
    cur++;
  } else if (cur > 0) {
    streaks.push({ start, end: days[i - 1].date, len: cur });
    cur = 0; start = null;
  }
}
if (cur > 0) streaks.push({ start, end: days.at(-1).date, len: cur });
const top = [...streaks].sort((a, b) => b.len - a.len).slice(0, 3);

// sample to limit frame count
const MAX_FRAMES = 80;
const sample = (() => {
  if (timeline.length <= MAX_FRAMES) return timeline;
  const step = (timeline.length - 1) / (MAX_FRAMES - 1);
  return Array.from({ length: MAX_FRAMES }, (_, i) => timeline[Math.round(i * step)]);
})();

// ---------- layout ----------
const W = 760, H = 180;
const L_X = 150, C_X = 380, R_X = 610;
const TITLE_Y = 34, NUM_Y = 102, SUB_Y = 126;

// ---------- left carousel ----------
const LEFT_FRAMES = sample.length;
const LEFT_DUR = +(LEFT_FRAMES * 0.08).toFixed(2);
const mkLeft = sample.map((p, i) => {
  const keyTimes = [], values = [];
  for (let k = 0; k <= LEFT_FRAMES; k++) {
    keyTimes.push((k / LEFT_FRAMES).toFixed(6));
    values.push((k === i || k === i + 1) ? 1 : 0);
  }
  return `
  <g>
    <text x="${L_X}" y="${NUM_Y}" class="leftLabel" text-anchor="middle">${p.total.toLocaleString()}</text>
    <text x="${L_X}" y="${SUB_Y}" class="leftSub"   text-anchor="middle">${p.date}</text>
    <animate attributeName="opacity" values="${values.join(";")}" keyTimes="${keyTimes.join(";")}" dur="${LEFT_DUR}s" repeatCount="indefinite"/>
  </g>`;
}).join("");

// ---------- right carousel ----------
const RIGHT_FRAMES = Math.max(1, top.length);
const RIGHT_DUR = +(RIGHT_FRAMES * 2.4).toFixed(2);
const mkRight = top.map((s, i) => {
  const keyTimes = [], values = [];
  for (let k = 0; k <= RIGHT_FRAMES; k++) {
    keyTimes.push((k / RIGHT_FRAMES).toFixed(6));
    values.push((k === i || k === i + 1) ? 1 : 0);
  }
  return `
  <g>
    <text x="${R_X}" y="${NUM_Y}" class="rightLabel" text-anchor="middle">${s.len} days</text>
    <text x="${R_X}" y="${SUB_Y}" class="rightSub"   text-anchor="middle">${s.start} → ${s.end}</text>
    <animate attributeName="opacity" values="${values.join(";")}" keyTimes="${keyTimes.join(";")}" dur="${RIGHT_DUR}s" repeatCount="indefinite"/>
  </g>`;
}).join("");

// ---------- flame sprites / filters ----------
const flameDefs = `
  <linearGradient id="gFlame" x1="0" y1="1" x2="0" y2="0">
    <stop offset="0%"  stop-color="#ff5a00"/>
    <stop offset="55%" stop-color="#ffb300"/>
    <stop offset="100%" stop-color="#fff7bf"/>
  </linearGradient>

  <symbol id="flameA" viewBox="-9 -30 18 30" overflow="visible">
    <path d="M0,0 C-6,-7 -9,-17 -5,-25 C-3,-29 3,-29 5,-25 C9,-17 6,-7 0,0 Z" fill="url(#gFlame)"/>
    <path d="M1,-7 C-3,-11 -4,-16 -2,-20 C-1,-22 1,-22 2,-20 C4,-16 3,-11 1,-7 Z" fill="#ffd56a" opacity=".55"/>
  </symbol>
  <symbol id="flameB" viewBox="-8 -28 16 28" overflow="visible">
    <path d="M0,0 C-5,-6 -7,-15 -3,-22 C-1,-26 1,-26 3,-22 C7,-15 5,-6 0,0 Z" fill="url(#gFlame)"/>
    <path d="M0.7,-6 C-2.3,-10 -3.2,-14 -1.7,-18 C-1.0,-20 0.6,-20 1.6,-18 C3.5,-14 2.6,-10 0.7,-6 Z" fill="#ffd56a" opacity=".45"/>
  </symbol>

  <filter id="fWobble" x="-120%" y="-120%" width="340%" height="340%">
    <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="9" result="n">
      <animate attributeName="baseFrequency" values="0.7;1.2;0.7" dur="1.2s" repeatCount="indefinite"/>
      <animate attributeName="seed" values="9;11;13;9" dur="2.8s" repeatCount="indefinite"/>
    </feTurbulence>
    <feDisplacementMap in="SourceGraphic" in2="n" scale="8">
      <animate attributeName="scale" values="4;12;6;10;4" dur="1.3s" repeatCount="indefinite"/>
    </feDisplacementMap>
  </filter>

  <filter id="fGlow" x="-80%" y="-80%" width="260%" height="260%">
    <feGaussianBlur stdDeviation="5" result="b1"/>
    <feGaussianBlur stdDeviation="12" in="SourceGraphic" result="b2"/>
    <feMerge><feMergeNode in="b1"/><feMergeNode in="b2"/><feMergeNode in="SourceGraphic"/></feMerge>
  </filter>

  <filter id="ringSuperGlow" x="-120%" y="-120%" width="360%" height="360%">
    <feGaussianBlur stdDeviation="8" result="g1"/>
    <feGaussianBlur stdDeviation="18" in="SourceGraphic" result="g2"/>
    <feMerge><feMergeNode in="g1"/><feMergeNode in="g2"/><feMergeNode in="SourceGraphic"/></feMerge>
  </filter>

  <radialGradient id="gCore" r="80%">
    <stop offset="0%"  stop-color="#ffffff" stop-opacity=".55"/>
    <stop offset="58%" stop-color="#e11d48" stop-opacity=".40"/>
    <stop offset="100%" stop-color="#000000" stop-opacity="0"/>
  </radialGradient>
`;

// ---------- ring (flame crown, strong glow) ----------
const RING_R = 44;
const FLAME_COUNT_RING = 40;

const ring = `
<g transform="translate(${C_X},110)">
  <defs>${flameDefs}</defs>

  <!-- seat (dark ring) -->
  <circle r="${RING_R}" fill="#111827" stroke="#1f2937" stroke-width="10"/>

  <!-- crown -->
  <g filter="url(#ringSuperGlow)">
    ${Array.from({length: FLAME_COUNT_RING}, (_, i) => {
      const a = (i / FLAME_COUNT_RING) * 360;
      const rr = RING_R + 8;
      const rad = (a - 90) * Math.PI / 180;
      const x = (rr * Math.cos(rad)).toFixed(3);
      const y = (rr * Math.sin(rad)).toFixed(3);
      const sym = i % 2 ? "flameA" : "flameB";
      const s0 = 0.80 + (i % 3) * 0.05;
      const s1 = s0 + 0.32;
      const dur = (0.9 + (i % 5) * 0.18).toFixed(2);
      const ph  = (i % 11) * 0.08;
      const lean = (i % 2 ? -7 : 7);
      return `
      <g transform="translate(${x},${y}) rotate(${a + lean})" filter="url(#fWobble)">
        <use xlink:href="#${sym}" opacity="0.92">
          <animateTransform attributeName="transform" additive="sum" type="scale"
            values="${s0.toFixed(2)};${s1.toFixed(2)};${s0.toFixed(2)}"
            keyTimes="0;0.5;1" dur="${dur}s" begin="${ph}s" repeatCount="indefinite"/>
          <animate attributeName="opacity" values="0.75;1;0.85" keyTimes="0;0.5;1"
            dur="${(dur*1.15).toFixed(2)}s" begin="${ph}s" repeatCount="indefinite"/>
        </use>
      </g>`;
    }).join("")}
  </g>

  <!-- core bloom -->
  <circle r="${RING_R + 10}" fill="url(#gCore)">
    <animate attributeName="opacity" values="0.22;0.45;0.22" dur="1.2s" repeatCount="indefinite"/>
  </circle>

  <text class="centerNum" text-anchor="middle" dy="10">${cs}</text>
</g>`;

// ---------- edges: rising flames (NO circles) ----------
const EDGE_W = 76;          // strip width each side
const EDGE_FLAMES = 26;     // per side
function buildEdge(side) {
  const x = side === "left" ? 0 : W - EDGE_W;
  const mirror = side === "left" ? 1 : -1;
  const baseDelay = side === "left" ? 0 : 0.35;

  const cols = Array.from({length: EDGE_FLAMES}, (_, i) => {
    const sym = i % 2 ? "flameA" : "flameB";
    const lane = i % 6;
    const jitter = (i % 3) * 2;
    const sx = (x + 8 + lane * ((EDGE_W - 16) / 5) + (i % 2 ? 3 : -3)).toFixed(1);
    const s0 = 0.9 + (i % 5) * 0.08;
    const s1 = s0 + 0.28;
    const dur = (3.2 + (i % 7) * 0.38).toFixed(2);
    const delay = (baseDelay + (i % 9) * 0.17).toFixed(2);
    const y0 = H + 40 + (i % 10) * 6;
    const y1 = -60;

    return `
    <g transform="translate(${sx},${y0}) scale(${mirror},1)" filter="url(#fWobble)" opacity="0.88" clip-path="url(#edge-${side})">
      <use xlink:href="#${sym}">
        <animateTransform attributeName="transform" additive="sum" type="scale"
          values="${s0.toFixed(2)};${s1.toFixed(2)};${s0.toFixed(2)}"
          keyTimes="0;0.5;1" dur="${(dur*0.6).toFixed(2)}s" begin="${delay}s" repeatCount="indefinite"/>
        <animate attributeName="opacity" values="0.6;1;0.7" dur="${(dur*0.75).toFixed(2)}s" begin="${delay}s" repeatCount="indefinite"/>
      </use>
      <animateTransform attributeName="transform" type="translate"
        values="${sx},${y0}; ${(+sx + (mirror*jitter)).toFixed(1)},${y1}" dur="${dur}s" begin="${delay}s" repeatCount="indefinite"/>
    </g>`;
  }).join("");

  return `
  <defs><clipPath id="edge-${side}"><rect x="${x}" y="0" width="${EDGE_W}" height="${H}"/></clipPath>${flameDefs}</defs>
  <g filter="url(#fGlow)">${cols}</g>`;
}

const edges = `${buildEdge("left")}\n${buildEdge("right")}`;

// ---------- SVG shell ----------
const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"
     xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
  <style>
    :root{ color-scheme: dark; }
    .title{ font:700 18px system-ui; fill:url(#hdrGrad); filter:url(#hdrGlow) }
    .leftLabel,.rightLabel{ font:800 22px system-ui; fill:#60a5fa }
    .leftSub,.rightSub{ font:12px system-ui; fill:#9ca3af }
    .centerNum{ font:900 28px system-ui; fill:#e11d48 }
  </style>
  <defs>
    <linearGradient id="hdrGrad" x1="0" x2="1">
      <stop offset="0%"  stop-color="#d1d5db" stop-opacity=".85"/>
      <stop offset="100%" stop-color="#9ca3af" stop-opacity=".75"/>
    </linearGradient>
    <filter id="hdrGlow" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="1.2" result="b"/>
      <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>

  ${edges}

  <text x="${L_X}" y="${TITLE_Y}" class="title" text-anchor="middle">Total Contributions</text>
  ${mkLeft}

  <text x="${C_X}" y="${TITLE_Y}" class="title" text-anchor="middle">Current Streak</text>
  ${ring}

  <text x="${R_X}" y="${TITLE_Y}" class="title" text-anchor="middle">Longest Streaks</text>
  ${mkRight}
</svg>`;

await fs.mkdir(path.dirname(OUT), { recursive: true });
await fs.writeFile(OUT, svg, "utf8");
console.log("wrote", OUT);
