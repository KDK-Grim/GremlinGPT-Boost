/**
 * Animated Streak (SMIL, no JS at runtime)
 * - Lifetime contributions count-up (left)
 * - Ring-of-fire + current streak (center)
 * - Top longest streaks cycle (right)
 *
 * FIXES:
 *  • Lifetime window via multi-year paging (from createdAt .. now)
 *  • Uses {from, to: now} so current-day is included
 *  • No overlap: each frame toggles opacity on/off
 */

import fs from "node:fs/promises";
import path from "node:path";

const OUT = path.resolve(process.cwd(), "assets/streak.svg");
const GH_TOKEN = process.env.PAT_GITHUB;
const USER = process.env.GH_USER || "statikfintechllc";

if (!GH_TOKEN) throw new Error("PAT_GITHUB env missing");

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

// --------- collect ALL daily contributions (lifetime) ----------
const who = await gql(qUser, { login: USER });
const createdAt = new Date(who.user.createdAt);
const now = new Date();

const addDays = (d, n) => {
  const t = new Date(d);
  t.setUTCDate(t.getUTCDate() + n);
  return t;
};

let cursor = new Date(Date.UTC(createdAt.getUTCFullYear(), createdAt.getUTCMonth(), createdAt.getUTCDate()));
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

// sort unique by date
const byDate = new Map();
for (const d of allDays) byDate.set(d.date, (byDate.get(d.date) || 0) + d.count);
const days = [...byDate.entries()]
  .map(([date, count]) => ({ date, count }))
  .sort((a, b) => new Date(a.date) - new Date(b.date));

// timeline cumulative
let run = 0;
const timeline = days.map(d => ({ date: d.date, total: (run += d.count) }));

// current streak (ending today)
let cs = 0;
for (let i = days.length - 1; i >= 0; i--) {
  if (new Date(days[i].date) > now) continue;
  if (days[i].count > 0) cs++;
  else break;
}

// longest streaks (top 3)
const streaks = [];
let cur = 0, start = null;
for (const d of days) {
  if (d.count > 0) {
    if (cur === 0) start = d.date;
    cur++;
  } else if (cur > 0) {
    streaks.push({ start, end: days[days.indexOf(d) - 1].date, len: cur });
    cur = 0; start = null;
  }
}
if (cur > 0) streaks.push({ start, end: days.at(-1).date, len: cur });
const top = [...streaks].sort((a,b)=>b.len-a.len).slice(0,3);

// sample to limit frame count
const MAX_FRAMES = 80;
const sample = (() => {
  if (timeline.length <= MAX_FRAMES) return timeline;
  const step = (timeline.length - 1) / (MAX_FRAMES - 1);
  return Array.from({length: MAX_FRAMES}, (_, i) => timeline[Math.round(i*step)]);
})();

// ---------- LOOPING CAROUSELS ----------
const LEFT_FRAMES = sample.length;
const LEFT_SLOT = 0.08;                  // seconds for each step
const LEFT_DUR  = +(LEFT_FRAMES * LEFT_SLOT).toFixed(2);

const mkLeft = sample.map((p, i) => {
  // build stepwise keyTimes (0..1) and values (0 or 1) so ONLY this frame is visible in its slot
  const keyTimes = [];
  const values   = [];
  for (let k = 0; k <= LEFT_FRAMES; k++) {
    keyTimes.push((k/LEFT_FRAMES).toFixed(6));
    values.push((k === i || k === i+1) ? 1 : 0);
  }
  return `
  <g>
    <text x="56" y="90" class="leftLabel">${p.total.toLocaleString()}</text>
    <text x="56" y="112" class="leftSub">${p.date}</text>
    <animate attributeName="opacity"
      values="${values.join(";")}"
      keyTimes="${keyTimes.join(";")}"
      dur="${LEFT_DUR}s"
      repeatCount="indefinite"/>
  </g>`;
}).join("");

// right side (top longest streaks) — loop forever
const RIGHT_FRAMES = Math.max(1, top.length);
const RIGHT_SLOT   = 2.4;                // seconds per card
const RIGHT_DUR    = +(RIGHT_FRAMES * RIGHT_SLOT).toFixed(2);

const mkRight = top.map((s, i) => {
  const keyTimes = [];
  const values   = [];
  for (let k = 0; k <= RIGHT_FRAMES; k++) {
    keyTimes.push((k/RIGHT_FRAMES).toFixed(6));
    values.push((k === i || k === i+1) ? 1 : 0);
  }
  return `
  <g>
    <text x="470" y="90" class="rightLabel">${s.len} days</text>
    <text x="470" y="112" class="rightSub">${s.start} → ${s.end}</text>
    <animate attributeName="opacity"
      values="${values.join(";")}"
      keyTimes="${keyTimes.join(";")}"
      dur="${RIGHT_DUR}s"
      repeatCount="indefinite"/>
  </g>`;
}).join("");


// ring-of-fire
const ring = `
<g transform="translate(320,95)">
  <defs>
    <radialGradient id="fireGrad" r="80%">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.5"/>
      <stop offset="60%" stop-color="#e11d48" stop-opacity="0.55"/>
      <stop offset="100%" stop-color="#000000" stop-opacity="0"/>
    </radialGradient>
    <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="3.5" result="b"/>
      <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <linearGradient id="strokeGrad" x1="0%" x2="100%">
      <stop offset="0%" stop-color="#ffae00"/>
      <stop offset="50%" stop-color="#ff0044"/>
      <stop offset="100%" stop-color="#ffd500"/>
    </linearGradient>
  </defs>
  <circle r="42" fill="none" stroke="#1f2937" stroke-width="12"/>
  <g filter="url(#glow)">
    <circle r="42" fill="none" stroke="url(#strokeGrad)" stroke-width="12" stroke-linecap="round" stroke-dasharray="50 260">
      <animateTransform attributeName="transform" type="rotate" from="0" to="360" dur="3s" repeatCount="indefinite"/>
      <animate attributeName="stroke-dasharray" values="50 260;95 215;140 170;95 215;50 260" dur="1.8s" repeatCount="indefinite"/>
    </circle>
    <circle r="52" fill="url(#fireGrad)">
      <animate attributeName="opacity" values="0.25;0.45;0.25" dur="1.2s" repeatCount="indefinite"/>
    </circle>
  </g>
  <text class="centerNum" text-anchor="middle" dy="8">${cs}</text>
</g>`;

// SVG
const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="760" height="150" viewBox="0 0 760 150" xmlns="http://www.w3.org/2000/svg">
  <style>
    :root{ color-scheme: dark; }
    .title{ font: 700 18px system-ui; fill:#e5e7eb }
    .leftLabel,.rightLabel{ font: 800 22px system-ui; fill:#60a5fa }
    .leftSub,.rightSub{ font: 12px system-ui; fill:#9ca3af }
    .centerNum{ font: 900 28px system-ui; fill:#e11d48 }
  </style>

  <text x="40"  y="36" class="title">Total Contributions</text>
  ${mkLeft}

  <text x="298" y="36" class="title">Current Streak</text>
  ${ring}

  <text x="470" y="36" class="title">Longest Streaks</text>
  ${mkRight}
</svg>`;

await fs.mkdir(path.dirname(OUT), { recursive: true });
await fs.writeFile(OUT, svg, "utf8");
console.log("wrote", OUT);
