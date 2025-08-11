/**
 * Animated Streak (SMIL, no JS at runtime)
 * - Lifetime contributions count-up (left)
 * - Full flickering ring-of-fire + current streak (center)
 * - Longest streaks carousel (right)
 * - Loops forever; SVG is GitHub-safe (no JS in markup)
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

const addDays = (d, n) => {
  const t = new Date(d);
  t.setUTCDate(t.getUTCDate() + n);
  return t;
};

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
const W = 760, H = 160;
const L_X = 150, C_X = 380, R_X = 610;
const TITLE_Y = 34, NUM_Y = 92, SUB_Y = 114;

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

// ---------- full ring-of-fire (flicker + flares) ----------
const ring = `
<g transform="translate(${C_X},98)">
  <defs>
    <!-- ember stroke along the ring -->
    <linearGradient id="strokeGrad" x1="0%" x2="100%">
      <stop offset="0%"   stop-color="#ffd15a"/>
      <stop offset="45%"  stop-color="#ff3b3b"/>
      <stop offset="100%" stop-color="#ffd15a"/>
    </linearGradient>

    <!-- hot core -->
    <radialGradient id="coreGrad" r="80%">
      <stop offset="0%"  stop-color="#ffffff" stop-opacity="0.55"/>
      <stop offset="55%" stop-color="#e11d48" stop-opacity="0.45"/>
      <stop offset="100%" stop-color="#000000" stop-opacity="0"/>
    </radialGradient>

    <!-- turbulent flames that displace outward lines -->
    <filter id="flameNoise" x="-70%" y="-70%" width="240%" height="240%">
      <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="3" seed="7" result="n">
        <animate attributeName="baseFrequency" values="0.8;1.15;0.8" dur="1s" repeatCount="indefinite"/>
        <animate attributeName="seed" values="7;9;11;7" dur="2s" repeatCount="indefinite"/>
      </feTurbulence>
      <feDisplacementMap in="SourceGraphic" in2="n" scale="8">
        <animate attributeName="scale" values="5;12;6;10;5" dur="1.1s" repeatCount="indefinite"/>
      </feDisplacementMap>
    </filter>

    <!-- glow -->
    <filter id="fireGlow" x="-70%" y="-70%" width="240%" height="240%">
      <feGaussianBlur stdDeviation="4" result="b1"/>
      <feGaussianBlur stdDeviation="10" in="SourceGraphic" result="b2"/>
      <feMerge><feMergeNode in="b1"/><feMergeNode in="b2"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>

  <!-- seat -->
  <circle r="44" fill="none" stroke="#1f2937" stroke-width="12"/>

  <!-- rotating ember stroke -->
  <g filter="url(#fireGlow)">
    <circle r="44" fill="none" stroke="url(#strokeGrad)" stroke-width="12" stroke-linecap="round" stroke-dasharray="70 240">
      <animateTransform attributeName="transform" type="rotate" from="0" to="-360" dur="2.6s" repeatCount="indefinite"/>
      <animate attributeName="stroke-dasharray" values="60 250;95 215;130 180;95 215;60 250" dur="1.6s" repeatCount="indefinite"/>
    </circle>
  </g>

  <!-- outer flares -->
  <g filter="url(#flameNoise)">
    <circle r="52" fill="none" stroke="#ff7a18" stroke-opacity=".65" stroke-width="10"/>
    <circle r="58" fill="none" stroke="#ffa62b" stroke-opacity=".35" stroke-width="12"/>
  </g>

  <!-- hot core -->
  <circle r="54" fill="url(#coreGrad)">
    <animate attributeName="opacity" values="0.22;0.40;0.22" dur="1.2s" repeatCount="indefinite"/>
  </circle>

  <text class="centerNum" text-anchor="middle" dy="8">${cs}</text>
</g>`;

// ---------- SVG shell ----------
const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
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
