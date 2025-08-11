/**
 * Build animated Streak SVG
 * - Ring-of-fire animation in center (SMIL)
 * - Left: animated counter from first commit date -> today (dates + totals)
 * - Right: cycles through top longest streaks (plural)
 *
 * Requires: env PAT_GITHUB, USER=statikfintechllc (override via env)
 * Output: docs/s.svg/streak.svg
 */

import fs from "node:fs/promises";
import path from "node:path";

const OUT = path.resolve(process.cwd(), "assets/streak.svg");
const GH_TOKEN = process.env.PAT_GITHUB;
const USER = process.env.GH_USER || "statikfintechllc";

// ----------- helpers -----------
const GQL = async (query, variables = {}, attempt = 1) => {
  if (!GH_TOKEN) throw new Error("PAT_GITHUB env missing");
  const r = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `bearer ${GH_TOKEN}`,
      "Content-Type": "application/json",
      "User-Agent": "ggpt-boost-streak"
    },
    body: JSON.stringify({ query, variables })
  });
  if (r.status === 502 || r.status === 503 || r.status === 504) {
    if (attempt < 5) {
      await new Promise(res => setTimeout(res, attempt * 1000));
      return GQL(query, variables, attempt + 1);
    }
  }
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`GraphQL ${r.status}: ${t}`);
  }
  const data = await r.json();
  if (data.errors) throw new Error(JSON.stringify(data.errors, null, 2));
  return data.data;
};

// ----------- query -----------
const q = `
query Streak($login:String!, $from:DateTime!) {
  user(login:$login){
    createdAt
    contributionsCollection(from:$from){
      contributionCalendar{
        totalContributions
        weeks{
          contributionDays{
            date
            contributionCount
          }
        }
      }
      totalCommitContributions
      totalIssueContributions
      totalPullRequestContributions
      totalPullRequestReviewContributions
      totalRepositoryContributions
    }
  }
}
`;

// find account creation for window start
const whoQ = `
query Who($login:String!){
  user(login:$login){ createdAt }
}
`;

// get account start
const who = await GQL(whoQ, { login: USER });
const createdAt = new Date(who.user.createdAt);
const fromISO = createdAt.toISOString();

// pull full calendar (GitHub returns a full year window from "from")
const data = await GQL(q, { login: USER, from: fromISO });
const cc = data.user.contributionsCollection;
const days = cc.contributionCalendar.weeks.flatMap(w => w.contributionDays);

// collapse to timeline of {date, total}
let running = 0;
const timeline = days
  .sort((a, b) => new Date(a.date) - new Date(b.date))
  .map(d => {
    running += d.contributionCount;
    return { date: d.date, total: running };
  });

// streak calc (daily contributions > 0)
const streaks = [];
let curStart = null;
let curLen = 0;

for (const d of days) {
  if (d.contributionCount > 0) {
    if (!curStart) curStart = d.date;
    curLen++;
  } else {
    if (curLen > 0) {
      streaks.push({ start: curStart, end: prevDate(d.date), len: curLen });
    }
    curStart = null;
    curLen = 0;
  }
}
if (curLen > 0) streaks.push({ start: curStart, end: days.at(-1).date, len: curLen });

function prevDate(iso) {
  const t = new Date(iso);
  t.setUTCDate(t.getUTCDate() - 1);
  return t.toISOString().slice(0, 10);
}

// current streak = if last day had >0, else 0
const lastDay = days.at(-1);
let currentStreak = 0;
if (lastDay && lastDay.contributionCount > 0) {
  currentStreak = streaks.at(-1)?.len ?? 0;
}

// longest streaks (top 3 by len, stable)
const top = [...streaks].sort((a, b) => b.len - a.len).slice(0, 3);

// timeline sampling for SMIL (avoid thousands of text nodes)
// cap to MAX_STEPS frames uniformly
const MAX_STEPS = 60;
const sampled = (() => {
  if (timeline.length <= MAX_STEPS) return timeline;
  const step = (timeline.length - 1) / (MAX_STEPS - 1);
  const arr = [];
  for (let i = 0; i < MAX_STEPS; i++) {
    const idx = Math.round(i * step);
    arr.push(timeline[idx]);
  }
  return arr;
})();

// build text frames (dates + totals)
const leftFrames = sampled.map((p, i) => {
  const begin = (i * 0.07).toFixed(2); // 70ms steps
  const dur = "0.07s";
  const show = `
    <text x="80" y="80" class="leftLabel">${p.total.toLocaleString()}</text>
    <text x="80" y="102" class="leftSub">${p.date}</text>
    <set xlink:href="#lf${i}" attributeName="visibility" to="visible" begin="${begin}s" dur="${dur}" fill="freeze"/>
  `;
  return `<g id="lf${i}" visibility="${i === 0 ? "visible" : "hidden"}">${show}</g>`;
}).join("\n");

// right side: rotate through top streaks
const rightFrames = top.map((s, i) => {
  const begin = (i * 2.2).toFixed(2);
  return `
  <g id="rt${i}" visibility="${i === 0 ? "visible" : "hidden"}">
    <text x="520" y="80" class="rightLabel">${s.len} days</text>
    <text x="520" y="102" class="rightSub">${s.start} → ${s.end}</text>
    <set attributeName="visibility" to="visible" begin="${begin}s" dur="2s" fill="freeze"/>
  </g>`;
}).join("\n");

// ring-of-fire (center)
const ring = `
<g transform="translate(300,85)">
  <defs>
    <radialGradient id="fireGrad" r="80%">
      <stop offset="0%" stop-color="#fffb" />
      <stop offset="60%" stop-color="#e11d48" />
      <stop offset="100%" stop-color="#0000" />
    </radialGradient>
    <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="3.5" result="b"/>
      <feMerge>
        <feMergeNode in="b"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
    <linearGradient id="strokeGrad" x1="0%" x2="100%">
      <stop offset="0%" stop-color="#ffae00"/>
      <stop offset="50%" stop-color="#ff0044"/>
      <stop offset="100%" stop-color="#ffd500"/>
    </linearGradient>
  </defs>

  <!-- base circle -->
  <circle r="38" fill="none" stroke="#1f2937" stroke-width="10"/>

  <!-- animated fire arc -->
  <g filter="url(#glow)">
    <circle r="38" fill="none" stroke="url(#strokeGrad)" stroke-linecap="round" stroke-width="10" stroke-dasharray="40 240">
      <animateTransform attributeName="transform" type="rotate" from="0" to="360" dur="3s" repeatCount="indefinite"/>
      <animate attributeName="stroke-dasharray" values="40 240;80 200;120 160;80 200;40 240" dur="1.8s" repeatCount="indefinite"/>
    </circle>
    <circle r="44" fill="url(#fireGrad)" opacity="0.4">
      <animate attributeName="opacity" values="0.25;0.45;0.25" dur="1.2s" repeatCount="indefinite"/>
    </circle>
  </g>

  <!-- current streak number -->
  <text text-anchor="middle" dy="6" class="centerNum">${currentStreak}</text>
</g>
`;

// SVG shell
const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="640" height="140" viewBox="0 0 640 140" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
  <style>
    :root{ color-scheme: dark; }
    .title{ font: 700 16px system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, 'Noto Sans', 'Helvetica Neue', Arial, 'Apple Color Emoji','Segoe UI Emoji'; fill:#e5e7eb }
    .leftLabel{ font: 700 20px system-ui; fill:#60a5fa }
    .leftSub{ font: 12px system-ui; fill:#9ca3af }
    .centerNum{ font: 800 24px system-ui; fill:#e11d48 }
    .rightLabel{ font: 700 20px system-ui; fill:#60a5fa }
    .rightSub{ font: 12px system-ui; fill:#9ca3af }
  </style>

  <!-- left block -->
  <text x="24" y="32" class="title">Total Contributions</text>
  ${leftFrames}

  <!-- center ring -->
  <text x="268" y="32" class="title">Current Streak</text>
  ${ring}

  <!-- right block -->
  <text x="520" y="32" class="title">Longest Streaks</text>
  ${rightFrames}

  <!-- loop the right side cycle -->
  <set xlink:href="#rt0" attributeName="visibility" to="visible" begin="${(top.length)*2.2}s" dur="2s" fill="freeze"/>
</svg>`;

await fs.mkdir(path.dirname(OUT), { recursive: true });
await fs.writeFile(OUT, svg, "utf8");
console.log(`wrote ${OUT}`);
