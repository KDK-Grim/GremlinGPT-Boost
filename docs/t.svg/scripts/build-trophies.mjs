/**
 * Animated Trophies (2-card carousel)
 * FIXES:
 *  • Stars = stargazers on OWNED repos (not starredRepositories)
 *  • Lifetime window to now
 *  • Centered layout + pulse, no overlap
 */

import fs from "node:fs/promises";
import path from "node:path";

const OUT = path.resolve(process.cwd(), "assets/trophies.svg");
const GH_TOKEN = process.env.PAT_GITHUB;
const USER = process.env.GH_USER || "statikfintechllc";
if (!GH_TOKEN) throw new Error("PAT_GITHUB env missing");

const gql = async (query, variables = {}, attempt = 1) => {
  const r = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `bearer ${GH_TOKEN}`,
      "Content-Type": "application/json",
      "User-Agent": "ggpt-boost-trophies"
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
const who = await gql(qUser, { login: USER });
const fromISO = new Date(who.user.createdAt).toISOString();
const nowISO = new Date().toISOString();

// totals across lifetime window
const qTotals = `
query($login:String!, $from:DateTime!, $to:DateTime!){
  user(login:$login){
    followers{ totalCount }
    repositories(affiliations:[OWNER], isFork:false, first:100){
      totalCount
      nodes{ stargazerCount }
      pageInfo{ hasNextPage endCursor }
    }
    contributionsCollection(from:$from, to:$to){
      totalCommitContributions
      totalIssueContributions
      totalPullRequestContributions
      totalPullRequestReviewContributions
      totalRepositoryContributions
      contributionCalendar{ totalContributions }
    }
  }
}
`;

// fetch repos paginated for accurate star sum
let starSum = 0;
let repoCount = 0;
let next = null;
do {
  const q = `
  query($login:String!, $cursor:String){
    user(login:$login){
      repositories(affiliations:[OWNER], isFork:false, first:100, after:$cursor){
        totalCount
        nodes{ stargazerCount }
        pageInfo{ hasNextPage endCursor }
      }
    }
  }`;
  const d = await gql(q, { login: USER, cursor: next });
  const r = d.user.repositories;
  repoCount = r.totalCount;
  starSum += r.nodes.reduce((a,b)=>a + (b.stargazerCount||0), 0);
  next = r.pageInfo.hasNextPage ? r.pageInfo.endCursor : null;
} while (next);

const d = await gql(qTotals, { login: USER, from: fromISO, to: nowISO });
const c = d.user.contributionsCollection;

const trophies = [
  { title:"Commits",       value: c.totalCommitContributions,            desc:"Commit contributions across all repos." },
  { title:"Followers",     value: d.user.followers.totalCount,           desc:"People following this account." },
  { title:"Stars Earned",  value: starSum,                                desc:"Stargazers on your owned repositories." },
  { title:"Reviews",       value: c.totalPullRequestReviewContributions, desc:"Pull request reviews submitted." },
  { title:"Issues",        value: c.totalIssueContributions,             desc:"Issues created." },
  { title:"Repositories",  value: repoCount,                              desc:"Owned non-fork repositories." },
  { title:"Pull Requests", value: c.totalPullRequestContributions,       desc:"Pull requests opened." },
  { title:"Total Activity",value: c.contributionCalendar.totalContributions, desc:"All recorded contributions." }
];

// grading (simple)
const grade = v => v > 5000 ? "S" : v > 1000 ? "A" : "B";

// chunk into pages of 2
const pages = [];
for (let i=0;i<trophies.length;i+=2) pages.push(trophies.slice(i,i+2));

const W=760,H=140,CW=300,CH=120,G=40;
const x0 = (W - (2*CW + G))/2;

const card = (t, x) => `
  <g transform="translate(${x},10)" opacity="0.0">
    <rect x="0" y="0" rx="14" ry="14" width="${CW}" height="${CH}" fill="#0b1220" stroke="#1f2937"/>
    <text x="20" y="34" class="cardTitle">${t.title}</text>
    <text x="20" y="70" class="cardValue">${t.value.toLocaleString()} <tspan class="grade">[${grade(t.value)}]</tspan></text>
    <text x="20" y="96" class="cardDesc">${t.desc}</text>
    <animate attributeName="opacity" values="0;1;1;0" keyTimes="0;0.1;0.9;1" dur="3s" repeatCount="1" fill="freeze"/>
    <animate attributeName="filter" values="url(#p0);url(#p1);url(#p0)" dur="1.6s" repeatCount="indefinite"/>
  </g>
`;

let slides = "";
pages.forEach((pg,i)=>{
  const begin = (i*3).toFixed(2);
  slides += `
  <g transform="translate(${W},0)">
    ${card(pg[0], x0)}${pg[1] ? card(pg[1], x0+CW+G) : ""}
    <animateTransform attributeName="transform" type="translate"
      values="${W};0;${-W}" keyTimes="0;0.12;1" dur="3s" begin="${begin}s" fill="freeze"/>
  </g>`;
});

const totalDur = (pages.length*3).toFixed(2);

const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
  <style>
    :root{ color-scheme: dark; }
    .cardTitle{ font:700 16px system-ui; fill:#e5e7eb }
    .cardValue{ font:800 22px system-ui; fill:#60a5fa }
    .grade{ font:700 16px system-ui; fill:#e11d48 }
    .cardDesc{ font:12px system-ui; fill:#9ca3af }
  </style>
  <defs>
    <filter id="p0"><feGaussianBlur stdDeviation="0"/></filter>
    <filter id="p1"><feGaussianBlur stdDeviation="2"/></filter>
  </defs>

  ${slides}

  <!-- loop -->
  <set attributeName="visibility" to="visible" begin="${totalDur}s" dur="0.01s"/>
</svg>`;

await fs.mkdir(path.dirname(OUT), { recursive: true });
await fs.writeFile(OUT, svg, "utf8");
console.log("wrote", OUT);
