/* Generate docs/svg/crimson-flow.svg from live GitHub stats. */
import fs from "node:fs/promises";
import path from "node:path";

// --- Build tag so the output *always* differs and Git can commit ---
const BUILD_TAG = process.env.BUILD_TAG || new Date().toISOString();  // <— forces diff

const USER  = process.env.USER_LOGIN || "statikfintechllc";
const TOKEN = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
if (!TOKEN) {
  console.error("Missing GH_TOKEN/GITHUB_TOKEN");
  process.exit(1);
}

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const isoStartUTC = (d) =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0)).toISOString();
const isoNowUTC = () => new Date().toISOString();

async function gql(query, variables = {}) {
  const r = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `bearer ${TOKEN}`,
      "Content-Type": "application/json",
      "User-Agent": "crimson-flow",
    },
    body: JSON.stringify({ query, variables }),
  });
  const j = await r.json();
  if (!r.ok || j.errors) {
    console.error("GraphQL error:", j.errors || r.statusText);
    process.exit(1);
  }
  return j.data;
}

function bezierPath(points) {
  if (points.length < 2) return "";
  const p = [];
  p.push(`M${points[0].x.toFixed(1)},${points[0].y.toFixed(1)}`);
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i === 0 ? i : i - 1];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] || p2;
    const s = 0.2;
    const c1x = p1.x + (p2.x - p0.x) * s, c1y = p1.y + (p2.y - p0.y) * s;
    const c2x = p2.x - (p3.x - p1.x) * s, c2y = p2.y - (p3.y - p1.y) * s;
    p.push(`C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`);
  }
  return p.join(" ");
}

function streaks(days) {
  let curr = 0, best = 0;
  for (const d of days) { if (d.count > 0) { curr++; best = Math.max(best, curr); } else curr = 0; }
  let cs = 0; for (let i = days.length - 1; i >= 0 && days[i].count > 0; i--) cs++;
  return { current: cs, longest: best };
}

// --- Fetch data
const now = new Date();
const start30  = new Date(now);  start30.setUTCDate(now.getUTCDate() - 30);
const start365 = new Date(now);  start365.setUTCDate(now.getUTCDate() - 365);

const query = `
query($login:String!, $from30:DateTime!, $to:DateTime!, $from365:DateTime!){
  user(login:$login){
    contributions30: contributionsCollection(from:$from30, to:$to){
      contributionCalendar{ weeks{ contributionDays{ date contributionCount } } }
    }
    contributions365: contributionsCollection(from:$from365, to:$to){
      contributionCalendar{ weeks{ contributionDays{ date contributionCount } } }
    }
  }
}`;

const data = await gql(query, {
  login: USER,
  from30:  isoStartUTC(start30),
  from365: isoStartUTC(start365),
  to:      isoNowUTC(),
});

function flattenDays(cc) {
  const days = [];
  for (const w of cc.contributionCalendar.weeks) {
    for (const d of w.contributionDays) days.push({ date: d.date, count: d.contributionCount });
  }
  days.sort((a, b) => a.date.localeCompare(b.date));
  return days;
}

const days30  = flattenDays(data.user.contributions30).slice(-30);
const days365 = flattenDays(data.user.contributions365).slice(-365);

const total365 = days365.reduce((a, d) => a + d.count, 0);
const { current: streakCurrent, longest: streakLongest } = streaks(days365);

// --- Geometry & SVG
const W = 1200, H = 420;
const plot = { x: 40, y: 60, w: 1120, h: 260 };
const maxCount = Math.max(5, ...days30.map(d => d.count));
const cap = Math.max(15, Math.min(40, maxCount + 5));

const pts = days30.map((d, i) => {
  const x = plot.x + (plot.w * i) / Math.max(1, days30.length - 1);
  const y = plot.y + plot.h - (plot.h * clamp(d.count, 0, cap)) / cap;
  return { x, y };
});
const dPath = bezierPath(pts);
const areaPath = `${dPath} L ${plot.x + plot.w},${plot.y + plot.h} L ${plot.x},${plot.y + plot.h} Z`;

const RED="#9b0e2a", RED_LINE="#c3193d", RED_SOFT="#7a0f26", MUTED="#94a3b8";

const svg = `<?xml version="1.0" encoding="UTF-8"?>
<!-- build: ${BUILD_TAG} user:${USER} points:${pts.length} total365:${total365} -->
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
     width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Crimson Flow Graph">
  <defs>
    <linearGradient id="bgGrad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#0a0d12"/><stop offset="100%" stop-color="#070a0d"/>
    </linearGradient>
    <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
      <path d="M40 0H0V40" fill="none" stroke="#121821" stroke-width="1"/>
    </pattern>
    <filter id="glow"><feGaussianBlur stdDeviation="3" result="b1"/><feMerge><feMergeNode in="b1"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    <linearGradient id="sheen" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="${RED}" stop-opacity="0"/>
      <stop offset="50%" stop-color="${RED}" stop-opacity=".14"/>
      <stop offset="100%" stop-color="${RED}" stop-opacity="0"/>
      <animateTransform attributeName="gradientTransform" type="translate" from="-1 0" to="1 0" dur="9s" repeatCount="indefinite"/>
    </linearGradient>
    <pattern id="scan" width="2" height="6" patternUnits="userSpaceOnUse"><rect width="2" height="1" fill="${RED}" opacity=".05"/></pattern>
  </defs>

  <rect width="${W}" height="${H}" fill="url(#bgGrad)"/>
  <rect x="${plot.x}" y="${plot.y}" width="${plot.w}" height="${plot.h}" fill="url(#grid)"/>
  <rect x="${plot.x}" y="${plot.y}" width="${plot.w}" height="${plot.h}" fill="url(#sheen)"/>
  <rect x="${plot.x}" y="${plot.y}" width="${plot.w}" height="${plot.h}" fill="url(#scan)"/>

  <text x="${W/2}" y="40" text-anchor="middle"
        font-family="ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,Arial"
        font-size="22" fill="${RED}" opacity=".95">Statik DK Smoke’s Crimson Flow</text>

  <path d="${areaPath}" fill="${RED_SOFT}" opacity=".13">
    <animate attributeName="opacity" values=".10;.17;.10" dur="6s" repeatCount="indefinite"/>
  </path>

  <path id="curve" d="${dPath}" fill="none" stroke="${RED_LINE}" stroke-width="5"
        stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="6 14" filter="url(#glow)">
    <animate attributeName="stroke-dashoffset" values="0;-220" dur="4.8s" repeatCount="indefinite"/>
  </path>

  <g fill="#ffd1db">
    <circle r="4"><animateMotion dur="7s" rotate="auto" repeatCount="indefinite"><mpath xlink:href="#curve"/></animateMotion><animate attributeName="opacity" values="1;.3;1" dur="2.2s" repeatCount="indefinite"/></circle>
    <circle r="3" fill="#ffffff"><animateMotion dur="8.2s" begin="1s" rotate="auto" repeatCount="indefinite"><mpath xlink:href="#curve"/></animateMotion><animate attributeName="opacity" values=".7;.2;.7" dur="2.4s" repeatCount="indefinite"/></circle>
    <circle r="3" fill="#ffc7d3"><animateMotion dur="6s" begin="2s" rotate="auto" repeatCount="indefinite"><mpath xlink:href="#curve"/></animateMotion><animate attributeName="opacity" values=".8;.3;.8" dur="2s" repeatCount="indefinite"/></circle>
  </g>

  <text x="${plot.x-12}" y="${plot.y+plot.h+15}" font-size="12" fill="${RED}" opacity=".7">days ▶</text>
  <text x="${plot.x-16}" y="${plot.y+plot.h/2}" transform="rotate(-90 ${plot.x-16},${plot.y+plot.h/2})" font-size="12" fill="${RED}" opacity=".7">contributions ▶</text>

  <g font-family="ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,Arial" font-size="15">
    <g transform="translate(120,360)"><rect x="-12" y="-26" rx="10" ry="10" width="220" height="36" fill="#0a0d12" stroke="${RED}" opacity=".92"/><text x="12" y="-6" fill="${MUTED}">Total Contributions (365d)</text><text x="12" y="12" fill="${RED}" font-weight="700">${total365.toLocaleString()}</text></g>
    <g transform="translate(490,360)"><rect x="-12" y="-26" rx="10" ry="10" width="170" height="36" fill="#0a0d12" stroke="${RED}" opacity=".92"/><text x="12" y="-6" fill="${MUTED}">Current Streak</text><text x="12" y="12" fill="${RED}" font-weight="700">${streakCurrent}</text></g>
    <g transform="translate(800,360)"><rect x="-12" y="-26" rx="10" ry="10" width="170" height="36" fill="#0a0d12" stroke="${RED}" opacity=".92"/><text x="12" y="-6" fill="${MUTED}">Longest Streak</text><text x="12" y="12" fill="${RED}" font-weight="700">${streakLongest}</text></g>
  </g>
</svg>`;

// docs/svg/scripts/generate-crimson-flow.mjs
const outPath = path.join(process.cwd(), "docs", "svg", "crimson-flow.svg");
await fs.mkdir(path.dirname(outPath), { recursive: true });
await fs.writeFile(outPath, svg, "utf8");
console.log("Wrote", outPath);

const stat = await fs.stat(outPath);
console.log(`Wrote ${outPath} (${stat.size} bytes)`);
