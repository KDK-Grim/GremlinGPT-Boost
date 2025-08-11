import fs from "node:fs/promises";
import path from "node:path";

const OUT = path.resolve(process.cwd(), "assets/streak.svg”);
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

// ––––– realistic flame generator –––––
const generateFlame = (baseHeight = 25, baseWidth = 8, complexity = 6) => {
let path = `M0,0`;

// Left side going up with jagged edges
for (let i = 1; i <= complexity; i++) {
const y = -(baseHeight * i / complexity);
const wobble = Math.sin(i * 2.1) * (baseWidth * 0.3);
const x = -baseWidth/2 + wobble * (1 - i/complexity);
path += ` L${x.toFixed(1)},${y.toFixed(1)}`;
}

// Flame tip (pointed)
path += ` L0,${-baseHeight}`;

// Right side coming down with different jagged pattern
for (let i = complexity - 1; i >= 1; i–) {
const y = -(baseHeight * i / complexity);
const wobble = Math.cos(i * 1.8) * (baseWidth * 0.3);
const x = baseWidth/2 + wobble * (1 - i/complexity);
path += ` L${x.toFixed(1)},${y.toFixed(1)}`;
}

path += ` Z`;
return path;
};

// ––––– edge flame effects –––––
const createEdgeFlames = () => {
let flames = “”;

// Left edge flames
for (let i = 0; i < 8; i++) {
const y = 30 + i * 18;
const height = 15 + Math.random() * 10;
const phase = Math.random() * 2;
flames += ` <g transform="translate(25,${y}) scale(0.6)"> <path d="${generateFlame(height, 6, 5)}" fill="url(#flameGrad)" opacity="0.8"> <animateTransform attributeName="transform" type="scale"  values="1,1;1.2,0.9;0.9,1.1;1,1" dur="${1.2 + Math.random() * 0.6}s"  begin="${phase}s" repeatCount="indefinite"/> <animate attributeName="opacity" values="0.6;0.9;0.7;0.6"  dur="${1.0 + Math.random() * 0.8}s" begin="${phase}s" repeatCount="indefinite"/> </path> </g>`;
}

// Right edge flames
for (let i = 0; i < 8; i++) {
const y = 30 + i * 18;
const height = 15 + Math.random() * 10;
const phase = Math.random() * 2;
flames += ` <g transform="translate(735,${y}) scale(-0.6,0.6)"> <path d="${generateFlame(height, 6, 5)}" fill="url(#flameGrad)" opacity="0.8"> <animateTransform attributeName="transform" type="scale"  values="1,1;1.2,0.9;0.9,1.1;1,1" dur="${1.2 + Math.random() * 0.6}s"  begin="${phase}s" repeatCount="indefinite"/> <animate attributeName="opacity" values="0.6;0.9;0.7;0.6"  dur="${1.0 + Math.random() * 0.8}s" begin="${phase}s" repeatCount="indefinite"/> </path> </g>`;
}

return flames;
};

// ––––– ring of fire (realistic flames around circle) –––––
const FLAME_COUNT = 32;
const RING_R = 44;

const buildFireRing = () => {
let flames = “”;

for (let i = 0; i < FLAME_COUNT; i++) {
const angle = (i / FLAME_COUNT) * 360;
const rad = (angle - 90) * Math.PI / 180;
const x = (RING_R * Math.cos(rad)).toFixed(2);
const y = (RING_R * Math.sin(rad)).toFixed(2);

```
const height = 18 + (i % 4) * 3;
const width = 5 + (i % 3);
const phase = (i % 7) * 0.15;
const scale = 0.7 + (i % 4) * 0.1;

flames += `
<g transform="translate(${x},${y}) rotate(${angle}) scale(${scale})">
  <path d="${generateFlame(height, width, 4)}" fill="url(#ringFlameGrad)" opacity="0.85">
    <animateTransform attributeName="transform" type="scale" additive="sum"
      values="1,1;1.3,0.8;0.8,1.2;1,1" dur="${0.8 + (i % 5) * 0.2}s" 
      begin="${phase}s" repeatCount="indefinite"/>
    <animate attributeName="opacity" values="0.7;1;0.8;0.7" 
      dur="${0.9 + (i % 4) * 0.25}s" begin="${phase}s" repeatCount="indefinite"/>
  </path>
  <!-- Inner flame core -->
  <path d="${generateFlame(height * 0.6, width * 0.6, 3)}" fill="url(#flameCore)" opacity="0.9">
    <animateTransform attributeName="transform" type="scale" additive="sum"
      values="1,1;1.4,0.7;0.7,1.3;1,1" dur="${0.7 + (i % 3) * 0.2}s" 
      begin="${phase + 0.1}s" repeatCount="indefinite"/>
  </path>
</g>`;
```

}

return flames;
};

// ––––– complete ring assembly –––––
const ring = `
<g transform="translate(${C_X},104)">
<defs>
<!-- Enhanced flame gradients -->
<radialGradient id="flameGrad" r="85%">
<stop offset="0%" stop-color="#ffffff"/>
<stop offset="20%" stop-color="#ffeb3b"/>
<stop offset="50%" stop-color="#ff9800"/>
<stop offset="80%" stop-color="#f44336"/>
<stop offset="100%" stop-color="#8b0000"/>
</radialGradient>

```
<radialGradient id="ringFlameGrad" r="75%">
  <stop offset="0%" stop-color="#fff9c4"/>
  <stop offset="30%" stop-color="#fbbf24"/>
  <stop offset="60%" stop-color="#ea580c"/>
  <stop offset="100%" stop-color="#991b1b"/>
</radialGradient>

<radialGradient id="flameCore" r="60%">
  <stop offset="0%" stop-color="#ffffff"/>
  <stop offset="40%" stop-color="#fef08a"/>
  <stop offset="100%" stop-color="#f59e0b"/>
</radialGradient>

<!-- Ring base -->
<radialGradient id="ringBase" r="100%">
  <stop offset="60%" stop-color="#7f1d1d" stop-opacity="0.8"/>
  <stop offset="90%" stop-color="#450a0a" stop-opacity="0.4"/>
  <stop offset="100%" stop-color="#1c1917" stop-opacity="0.2"/>
</radialGradient>

<!-- Fire glow filter -->
<filter id="fireGlow" x="-100%" y="-100%" width="300%" height="300%">
  <feGaussianBlur stdDeviation="3" result="glow1"/>
  <feGaussianBlur stdDeviation="8" result="glow2"/>
  <feGaussianBlur stdDeviation="15" result="glow3"/>
  <feMerge>
    <feMergeNode in="glow3"/>
    <feMergeNode in="glow2"/>
    <feMergeNode in="glow1"/>
    <feMergeNode in="SourceGraphic"/>
  </feMerge>
</filter>

<!-- Heat distortion -->
<filter id="heatWave" x="-50%" y="-50%" width="200%" height="200%">
  <feTurbulence baseFrequency="0.02 0.1" numOctaves="2" result="noise">
    <animate attributeName="baseFrequency" values="0.02 0.1;0.04 0.12;0.02 0.1" 
      dur="2s" repeatCount="indefinite"/>
  </feTurbulence>
  <feDisplacementMap in="SourceGraphic" in2="noise" scale="2"/>
</filter>
```

  </defs>

  <!-- Dark ring base -->

  <circle r="${RING_R}" fill="url(#ringBase)" stroke="#2d1b1b" stroke-width="3"/>

  <!-- Heated inner ring -->

  <circle r="${RING_R - 8}" fill="none" stroke="#7f1d1d" stroke-width="4" opacity="0.6">
    <animate attributeName="opacity" values="0.4;0.8;0.4" dur="1.5s" repeatCount="indefinite"/>
  </circle>

  <!-- Ring of fire -->

  <g filter="url(#fireGlow)">
    ${buildFireRing()}
  </g>

  <!-- Central heat shimmer -->

  <circle r="${RING_R - 15}" fill="url(#ringBase)" opacity="0.3" filter="url(#heatWave)"/>

  <!-- Number with fire glow -->

<text class="centerNum" text-anchor="middle" dy="10" filter="url(#fireGlow)">${cs}</text>
</g>`;

// ––––– SVG shell with edge flames –––––
const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">

  <style>
    :root{ color-scheme: dark; }
    .title{ font:700 18px system-ui; fill:url(#hdrGrad); filter:url(#hdrGlow) }
    .leftLabel,.rightLabel{ font:800 22px system-ui; fill:#60a5fa }
    .leftSub,.rightSub{ font:12px system-ui; fill:#9ca3af }
    .centerNum{ font:900 28px system-ui; fill:#fbbf24; text-shadow: 0 0 10px #f59e0b }
  </style>

  <defs>
    <!-- Header gradients -->
    <linearGradient id="hdrGrad" x1="0" x2="1">
      <stop offset="0%"  stop-color="#d1d5db" stop-opacity=".85"/>
      <stop offset="100%" stop-color="#9ca3af" stop-opacity=".75"/>
    </linearGradient>
    <filter id="hdrGlow" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="1.2" result="b"/>
      <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>

```
<!-- Flame gradients for edges -->
<radialGradient id="flameGrad" r="85%">
  <stop offset="0%" stop-color="#ffffff"/>
  <stop offset="20%" stop-color="#ffeb3b"/>
  <stop offset="50%" stop-color="#ff9800"/>
  <stop offset="80%" stop-color="#f44336"/>
  <stop offset="100%" stop-color="#8b0000"/>
</radialGradient>
```

  </defs>

  <!-- Dark background -->

  <rect width="100%" height="100%" fill="#0a0a0a"/>

  <!-- Edge flames -->

${createEdgeFlames()}

  <!-- Content -->

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
