/**
 * Animated Streak (GitHub-safe SVG via SMIL)
 * - Lifetime contributions count-up (left)
 * - Realistic flickering ring-of-fire (center)
 * - Longest streaks carousel (right)
 * - Fully centered grid, blended headers
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
  const winTo = (to < now ? to : now).toISOString();
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

// ---------- layout constants (centered columns) ----------
const W = 760, H = 170;
const L_X = 150, C_X = 380, R_X = 610;
const TITLE_Y = 34, NUM_Y = 98, SUB_Y = 120;

// ---------- left carousel (loop) ----------
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
    <animate attributeName="opacity"
      values="${values.join(";")}"
      keyTimes="${keyTimes.join(";")}"
      dur="${LEFT_DUR}s" repeatCount="indefinite"/>
  </g>`;
}).join("");

// ---------- right carousel (longest streaks, loop) ----------
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
    <animate attributeName="opacity"
      values="${values.join(";")}"
      keyTimes="${keyTimes.join(";")}"
      dur="${RIGHT_DUR}s" repeatCount="indefinite"/>
  </g>`;
}).join("");

// ---------- flame crown builder ----------
const FLAME_COUNT = 28;            // number of sprite flames around the ring
const RING_R = 44;                  // ring radius
const FLARE_R1 = 56, FLARE_R2 = 62; // halo radii

const buildFlameCrown = () => {
  // a stylized single flame path (relative coords), oriented pointing up at (0,0)
  const flamePath = "M0,0 C-6,-6 -8,-14 -4,-22 C-2,-26 2,-26 4,-22 C8,-14 6,-6 0,0 Z";
  let uses = "";
  for (let i = 0; i < FLAME_COUNT; i++) {
    const a = (i / FLAME_COUNT) * 360;
    const phase = (i % 5) * 0.12;           // stagger flicker
    const scale = (0.85 + (i % 3) * 0.05).toFixed(2);
    // position flames on a slightly larger radius so they sit outside the ring edge
    const rr = RING_R + 10;
    const rad = (a - 90) * Math.PI / 180;   // -90 so 0deg is up
    const x = (rr * Math.cos(rad)).toFixed(3);
    const y = (rr * Math.sin(rad)).toFixed(3);
    uses += `
    <g transform="translate(${x},${y}) rotate(${a})">
      <use xlink:href="#flame" opacity="0.9">
        <animateTransform attributeName="transform" additive="sum" type="scale"
          values="${scale};${(+scale + 0.25).toFixed(2)};${scale}"
          keyTimes="0;0.5;1" dur="${(0.9 + (i % 4) * 0.2).toFixed(2)}s" begin="${phase}s" repeatCount="indefinite"/>
        <animate attributeName="opacity" values="0.75;1;0.8" keyTimes="0;0.5;1"
          dur="${(1.1 + (i % 3) * 0.2).toFixed(2)}s" begin="${phase}s" repeatCount="indefinite"/>
      </use>
    </g>`;
  }
  return uses;
};

// ---------- full ring-of-fire (sprite flames + halo + ember stroke) ----------
const ring = `
<g transform="translate(${C_X},104)">
  <defs>
    <!-- gradient for flame sprite -->
    <linearGradient id="flameGrad" x1="0" y1="1" x2="0" y2="0">
      <stop offset="0%"  stop-color="#ff6200"/>
      <stop offset="55%" stop-color="#ffae00"/>
      <stop offset="100%" stop-color="#fff2a6"/>
    </linearGradient>

    <!-- sprite glyph -->
    <symbol id="flame" viewBox="-8 -26 16 26" overflow="visible">
      <path d="M0,0 C-6,-6 -8,-14 -4,-22 C-2,-26 2,-26 4,-22 C8,-14 6,-6 0,0 Z"
            fill="url(#flameGrad)"/>
      <!-- inner highlight -->
      <path d="M1,-5 C-3,-9 -4,-14 -2,-18 C-1,-20 1,-20 2,-18 C4,-14 3,-9 1,-5 Z"
            fill="#ffd15a" opacity=".6"/>
    </symbol>

    <!-- noise jitter to make flares dance -->
    <filter id="flameJitter" x="-80%" y="-80%" width="260%" height="260%">
      <feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="2" seed="5" result="n">
        <animate attributeName="baseFrequency" values="0.7;1.1;0.7" dur="1.4s" repeatCount="indefinite"/>
        <animate attributeName="seed" values="5;7;9;5" dur="3s" repeatCount="indefinite"/>
      </feTurbulence>
      <feDisplacementMap in="SourceGraphic" in2="n" scale="6">
        <animate attributeName="scale" values="3;10;4;8;3" dur="1.3s" repeatCount="indefinite"/>
      </feDisplacementMap>
    </filter>

    <!-- ember stroke along ring -->
    <linearGradient id="emberGrad" x1="0%" x2="100%">
      <stop offset="0%"   stop-color="#ffd15a"/>
      <stop offset="45%"  stop-color="#ff3b3b"/>
      <stop offset="100%" stop-color="#ffd15a"/>
    </linearGradient>

    <!-- header gradient/glow reused -->
    <radialGradient id="coreGrad" r="78%">
      <stop offset="0%"  stop-color="#ffffff" stop-opacity=".55"/>
      <stop offset="60%" stop-color="#e11d48" stop-opacity=".40"/>
      <stop offset="100%" stop-color="#000000" stop-opacity="0"/>
    </radialGradient>

    <filter id="ringGlow" x="-70%" y="-70%" width="240%" height="240%">
      <feGaussianBlur stdDeviation="5" result="b1"/>
      <feGaussianBlur stdDeviation="12" in="SourceGraphic" result="b2"/>
      <feMerge><feMergeNode in="b1"/><feMergeNode in="b2"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>

  <!-- dark seat -->
  <circle r="${RING_R}" fill="none" stroke="#1f2937" stroke-width="12"/>

  <!-- halo flares (jittered rings) -->
  <g filter="url(#flameJitter)">
    <circle r="${FLARE_R1}" fill="none" stroke="#ff7a18" stroke-opacity=".55" stroke-width="9"/>
    <circle r="${FLARE_R2}" fill="none" stroke="#ffa62b" stroke-opacity=".35" stroke-width="12"/>
  </g>

  <!-- sprite crown -->
  <g filter="url(#ringGlow)">
    ${buildFlameCrown()}
  </g>

  <!-- rotating ember stroke just inside flames -->
  <g filter="url(#ringGlow)">
    <circle r="${RING_R}" fill="none" stroke="url(#emberGrad)" stroke-width="10" stroke-linecap="round" stroke-dasharray="70 240">
      <animateTransform attributeName="transform" type="rotate" from="0" to="-360" dur="3s" repeatCount="indefinite"/>
      <animate attributeName="stroke-dasharray" values="60 250;95 215;130 180;95 215;60 250" dur="1.8s" repeatCount="indefinite"/>
    </circle>
  </g>

  <!-- hot core bloom -->
  <circle r="${RING_R + 8}" fill="url(#coreGrad)">
    <animate attributeName="opacity" values="0.22;0.40;0.22" dur="1.2s" repeatCount="indefinite"/>
  </circle>

  <!-- number -->
  <text class="centerNum" text-anchor="middle" dy="10">${cs}</text>
</g>`;

// ---------- SVG shell ----------
const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
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
