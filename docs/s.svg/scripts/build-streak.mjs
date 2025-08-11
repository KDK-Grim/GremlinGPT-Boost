/**

- Animated Streak with REAL FIRE effects
- - Realistic flame shapes around the ring
- - Fire elements on screen edges
- - Proper flame colors and animation
    */

import fs from “node:fs/promises”;
import path from “node:path”;

const OUT = path.resolve(process.cwd(), “assets/streak.svg”);
const GH_TOKEN = process.env.PAT_GITHUB;
const USER = process.env.GH_USER || “statikfintechllc”;
if (!GH_TOKEN) throw new Error(“PAT_GITHUB env missing”);

// –––––––– GraphQL ––––––––
const gql = async (query, variables = {}, attempt = 1) => {
const r = await fetch(“https://api.github.com/graphql”, {
method: “POST”,
headers: {
Authorization: `bearer ${GH_TOKEN}`,
“Content-Type”: “application/json”,
“User-Agent”: “ggpt-boost-streak”
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
const qCal = `query($login:String!, $from:DateTime!, $to:DateTime!){ user(login:$login){ contributionsCollection(from:$from, to:$to){ contributionCalendar{ weeks{ contributionDays{ date contributionCount } } } } } }`;

// ––––– collect lifetime daily contributions –––––
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
allDays.push(…days);
cursor = to;
}

// unique + sort
const byDate = new Map();
for (const d of allDays) byDate.set(d.date, (byDate.get(d.date) || 0) + d.count);
const days = […byDate.entries()]
.map(([date, count]) => ({ date, count }))
.sort((a, b) => new Date(a.date) - new Date(b.date));

// cumulative timeline
let run = 0;
const timeline = days.map(d => ({ date: d.date, total: (run += d.count) }));

// current streak (ending today)
let cs = 0;
for (let i = days.length - 1; i >= 0; i–) {
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
const top = […streaks].sort((a, b) => b.len - a.len).slice(0, 3);

// sample to limit frame count
const MAX_FRAMES = 80;
const sample = (() => {
if (timeline.length <= MAX_FRAMES) return timeline;
const step = (timeline.length - 1) / (MAX_FRAMES - 1);
return Array.from({ length: MAX_FRAMES }, (_, i) => timeline[Math.round(i * step)]);
})();

// ––––– layout constants (centered columns) –––––
const W = 760, H = 170;
const L_X = 150, C_X = 380, R_X = 610;
const TITLE_Y = 34, NUM_Y = 98, SUB_Y = 120;

// ––––– left carousel (loop) –––––
const LEFT_FRAMES = sample.length;
const LEFT_DUR = +(LEFT_FRAMES * 0.08).toFixed(2);

const mkLeft = sample.map((p, i) => {
const keyTimes = [], values = [];
for (let k = 0; k <= LEFT_FRAMES; k++) {
keyTimes.push((k / LEFT_FRAMES).toFixed(6));
values.push((k === i || k === i + 1) ? 1 : 0);
}
return ` <g> <text x="${L_X}" y="${NUM_Y}" class="leftLabel" text-anchor="middle">${p.total.toLocaleString()}</text> <text x="${L_X}" y="${SUB_Y}" class="leftSub"   text-anchor="middle">${p.date}</text> <animate attributeName="opacity" values="${values.join(";")}" keyTimes="${keyTimes.join(";")}" dur="${LEFT_DUR}s" repeatCount="indefinite"/> </g>`;
}).join(””);

// ––––– right carousel (longest streaks, loop) –––––
const RIGHT_FRAMES = Math.max(1, top.length);
const RIGHT_DUR = +(RIGHT_FRAMES * 2.4).toFixed(2);

const mkRight = top.map((s, i) => {
const keyTimes = [], values = [];
for (let k = 0; k <= RIGHT_FRAMES; k++) {
keyTimes.push((k / RIGHT_FRAMES).toFixed(6));
values.push((k === i || k === i + 1) ? 1 : 0);
}
return ` <g> <text x="${R_X}" y="${NUM_Y}" class="rightLabel" text-anchor="middle">${s.len} days</text> <text x="${R_X}" y="${SUB_Y}" class="rightSub"   text-anchor="middle">${s.start} → ${s.end}</text> <animate attributeName="opacity" values="${values.join(";")}" keyTimes="${keyTimes.join(";")}" dur="${RIGHT_DUR}s" repeatCount="indefinite"/> </g>`;
}).join(””);

// ––––– realistic flame builder –––––
const FLAME_COUNT = 32;
const RING_R = 44;

const buildRealisticFlames = () => {
// More realistic flame path with irregular edges and multiple tongues
const flameVariations = [
“M0,0 C-3,-8 -6,-16 -8,-24 C-9,-30 -7,-35 -4,-38 C-2,-40 0,-41 2,-40 C4,-38 6,-35 5,-30 C4,-24 2,-16 -1,-8 Z M0,0 C3,-6 5,-14 4,-22 C3,-28 1,-32 -1,-34 C0,-36 1,-37 2,-36 C3,-34 4,-30 3,-26 C2,-20 0,-12 0,-6 Z”,
“M0,0 C-4,-5 -7,-12 -9,-20 C-10,-28 -8,-34 -5,-38 C-3,-41 -1,-42 1,-41 C3,-39 5,-35 4,-30 C3,-25 1,-18 -2,-10 Z M0,0 C2,-4 4,-10 6,-16 C7,-22 6,-27 4,-30 C3,-32 2,-33 1,-32 C0,-30 -1,-27 0,-23 C1,-17 1,-10 0,-5 Z”,
“M0,0 C-5,-7 -8,-15 -10,-23 C-11,-31 -9,-37 -6,-40 C-4,-42 -2,-43 0,-42 C2,-40 4,-37 3,-32 C2,-26 0,-17 -3,-9 Z M0,0 C3,-5 5,-11 7,-18 C8,-24 7,-29 5,-32 C4,-34 3,-35 2,-34 C1,-32 0,-29 1,-25 C2,-19 2,-12 1,-6 Z”
];

let flames = “”;
for (let i = 0; i < FLAME_COUNT; i++) {
const a = (i / FLAME_COUNT) * 360;
const phase = (i % 7) * 0.15;
const scale = (0.7 + (i % 4) * 0.08).toFixed(2);
const flameShape = flameVariations[i % flameVariations.length];

```
const rr = RING_R + 15; // Position flames outside the ring
const rad = (a - 90) * Math.PI / 180;
const x = (rr * Math.cos(rad)).toFixed(3);
const y = (rr * Math.sin(rad)).toFixed(3);

flames += `
<g transform="translate(${x},${y}) rotate(${a})">
  <path d="${flameShape}" fill="url(#realisticFlame)">
    <animateTransform attributeName="transform" additive="sum" type="scale"
      values="${scale};${(+scale + 0.4).toFixed(2)};${(+scale + 0.15).toFixed(2)};${scale}"
      keyTimes="0;0.3;0.7;1" 
      dur="${(0.8 + (i % 5) * 0.3).toFixed(2)}s" 
      begin="${phase}s" 
      repeatCount="indefinite"/>
    <animate attributeName="opacity" 
      values="0.7;1;0.85;0.9;0.7" 
      keyTimes="0;0.25;0.5;0.75;1"
      dur="${(1.0 + (i % 4) * 0.25).toFixed(2)}s" 
      begin="${phase}s" 
      repeatCount="indefinite"/>
    <animate attributeName="fill-opacity"
      values="0.9;1;0.95;0.9"
      keyTimes="0;0.4;0.8;1"
      dur="${(0.7 + (i % 3) * 0.2).toFixed(2)}s"
      begin="${phase}s"
      repeatCount="indefinite"/>
  </path>
</g>`;
```

}
return flames;
};

// ––––– edge flames for screen borders –––––
const buildEdgeFlames = () => {
const leftFlames = Array.from({length: 6}, (_, i) => {
const y = 20 + i * 25;
const phase = i * 0.2;
const scale = (0.6 + (i % 3) * 0.1).toFixed(2);
return ` <g transform="translate(15,${y}) rotate(45)"> <path d="M0,0 C-2,-4 -4,-8 -5,-12 C-6,-16 -5,-19 -3,-21 C-1,-22 1,-22 2,-21 C3,-19 3,-16 2,-12 C1,-8 0,-4 0,0 Z"  fill="url(#edgeFlame)"> <animateTransform attributeName="transform" additive="sum" type="scale" values="${scale};${(+scale + 0.3).toFixed(2)};${scale}" dur="${(0.9 + (i % 3) * 0.2).toFixed(2)}s"  begin="${phase}s"  repeatCount="indefinite"/> <animate attributeName="opacity" values="0.6;1;0.8;0.6" dur="1.1s" begin="${phase}s" repeatCount="indefinite"/> </path> </g>`;
}).join(””);

const rightFlames = Array.from({length: 6}, (_, i) => {
const y = 20 + i * 25;
const phase = i * 0.18;
const scale = (0.55 + (i % 3) * 0.12).toFixed(2);
return ` <g transform="translate(${W-15},${y}) rotate(-45)"> <path d="M0,0 C-2,-4 -4,-8 -5,-12 C-6,-16 -5,-19 -3,-21 C-1,-22 1,-22 2,-21 C3,-19 3,-16 2,-12 C1,-8 0,-4 0,0 Z"  fill="url(#edgeFlame)"> <animateTransform attributeName="transform" additive="sum" type="scale" values="${scale};${(+scale + 0.35).toFixed(2)};${scale}" dur="${(0.85 + (i % 4) * 0.25).toFixed(2)}s"  begin="${phase}s"  repeatCount="indefinite"/> <animate attributeName="opacity" values="0.65;1;0.75;0.65" dur="1.0s" begin="${phase}s" repeatCount="indefinite"/> </path> </g>`;
}).join(””);

return leftFlames + rightFlames;
};

// ––––– full ring-of-fire with realistic flames –––––
const ring = `
<g transform="translate(${C_X},104)">
<defs>
<!-- Realistic flame gradient with proper fire colors -->
<radialGradient id="realisticFlame" cx="0.3" cy="0.8" r="0.8">
<stop offset="0%"  stop-color="#ffffff" stop-opacity="0.9"/>
<stop offset="15%" stop-color="#fff2a6" stop-opacity="0.95"/>
<stop offset="35%" stop-color="#ffae00" stop-opacity="1"/>
<stop offset="60%" stop-color="#ff6200" stop-opacity="0.9"/>
<stop offset="85%" stop-color="#cc1100" stop-opacity="0.7"/>
<stop offset="100%" stop-color="#660000" stop-opacity="0.3"/>
</radialGradient>

```
<!-- Edge flame gradient -->
<radialGradient id="edgeFlame" cx="0.4" cy="0.7" r="0.9">
  <stop offset="0%"  stop-color="#fff2a6" stop-opacity="0.8"/>
  <stop offset="25%" stop-color="#ffae00" stop-opacity="0.9"/>
  <stop offset="60%" stop-color="#ff4500" stop-opacity="0.8"/>
  <stop offset="90%" stop-color="#cc1100" stop-opacity="0.5"/>
  <stop offset="100%" stop-color="#330000" stop-opacity="0.2"/>
</radialGradient>

<!-- Fire turbulence for realistic flicker -->
<filter id="fireDistortion" x="-50%" y="-50%" width="200%" height="200%">
  <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="3" seed="3" result="noise">
    <animate attributeName="baseFrequency" values="0.8;1.2;0.9;1.1;0.8" dur="1.2s" repeatCount="indefinite"/>
    <animate attributeName="seed" values="3;5;7;9;11;3" dur="2.5s" repeatCount="indefinite"/>
  </feTurbulence>
  <feDisplacementMap in="SourceGraphic" in2="noise" scale="4">
    <animate attributeName="scale" values="2;6;4;7;3;5;2" dur="1.1s" repeatCount="indefinite"/>
  </feDisplacementMap>
</filter>

<!-- Inner ring glow -->
<radialGradient id="innerGlow" cx="50%" cy="50%" r="60%">
  <stop offset="0%"  stop-color="#ff6200" stop-opacity="0.4"/>
  <stop offset="50%" stop-color="#ffae00" stop-opacity="0.2"/>
  <stop offset="100%" stop-color="#cc1100" stop-opacity="0.1"/>
</radialGradient>

<!-- Ring glow filter -->
<filter id="ringGlow" x="-80%" y="-80%" width="260%" height="260%">
  <feGaussianBlur stdDeviation="4" result="b1"/>
  <feGaussianBlur stdDeviation="8" in="SourceGraphic" result="b2"/>
  <feGaussianBlur stdDeviation="16" in="SourceGraphic" result="b3"/>
  <feMerge><feMergeNode in="b3"/><feMergeNode in="b2"/><feMergeNode in="b1"/><feMergeNode in="SourceGraphic"/></feMerge>
</filter>
```

  </defs>

  <!-- Dark ring base -->

  <circle r="${RING_R}" fill="none" stroke="#0f0f0f" stroke-width="8" opacity="0.8"/>

  <!-- Inner glow ring -->

  <circle r="${RING_R - 5}" fill="url(#innerGlow)">
    <animate attributeName="opacity" values="0.3;0.6;0.4;0.5;0.3" dur="1.3s" repeatCount="indefinite"/>
  </circle>

  <!-- Realistic flame crown -->

  <g filter="url(#fireDistortion)">
    <g filter="url(#ringGlow)">
      ${buildRealisticFlames()}
    </g>
  </g>

  <!-- Hot ember ring -->

  <circle r="${RING_R}" fill="none" stroke="#ff4500" stroke-width="3" stroke-opacity="0.6" stroke-dasharray="20 40">
    <animateTransform attributeName="transform" type="rotate" from="0" to="360" dur="4s" repeatCount="indefinite"/>
    <animate attributeName="stroke-opacity" values="0.4;0.8;0.6;0.4" dur="0.9s" repeatCount="indefinite"/>
  </circle>

  <!-- Center number with fire glow -->

<text class="centerNum" text-anchor="middle" dy="10" filter="url(#ringGlow)">${cs}</text>
</g>`;

// ––––– SVG shell –––––
const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">

  <style>
    :root{ color-scheme: dark; }
    .title{ font:700 18px system-ui; fill:url(#hdrGrad); filter:url(#hdrGlow) }
    .leftLabel,.rightLabel{ font:800 22px system-ui; fill:#60a5fa }
    .leftSub,.rightSub{ font:12px system-ui; fill:#9ca3af }
    .centerNum{ font:900 28px system-ui; fill:#ff6200 }
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

  <!-- Background flames on edges -->

${buildEdgeFlames()}

<text x="${L_X}" y="${TITLE_Y}" class="title" text-anchor="middle">Total Contributions</text>
${mkLeft}

<text x="${C_X}" y="${TITLE_Y}" class="title" text-anchor="middle">Current Streak</text>
${ring}

<text x="${R_X}" y="${TITLE_Y}" class="title" text-anchor="middle">Longest Streaks</text>
${mkRight}
</svg>`;

await fs.mkdir(path.dirname(OUT), { recursive: true });
await fs.writeFile(OUT, svg, “utf8”);
console.log(“wrote”, OUT);
