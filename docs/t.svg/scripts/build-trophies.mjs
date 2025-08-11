/**
 * Build animated "Trophies" SVG
 * - 2-cards carousel (slide + pulse)
 * - Each card centered with label and definition
 * Data via GraphQL contributionsCollection
 * Output: docs/t.svg/trophies.svg
 */

import fs from "node:fs/promises";
import path from "node:path";

const OUT = path.resolve(process.cwd(), "docs/t.svg/assets/trophies.svg");
const GH_TOKEN = process.env.PAT_GITHUB;
const USER = process.env.GH_USER || "statikfintechllc";

const GQL = async (query, variables = {}, attempt = 1) => {
  if (!GH_TOKEN) throw new Error("PAT_GITHUB env missing");
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
    await new Promise(r => setTimeout(r, attempt * 1000));
    return GQL(query, variables, attempt + 1);
  }
  if (!r.ok) throw new Error(`GraphQL ${r.status}: ${await r.text()}`);
  const j = await r.json();
  if (j.errors) throw new Error(JSON.stringify(j.errors, null, 2));
  return j.data;
};

const q = `
query Trophies($login:String!, $from:DateTime!){
  user(login:$login){
    createdAt
    contributionsCollection(from:$from){
      totalCommitContributions
      totalIssueContributions
      totalPullRequestContributions
      totalPullRequestReviewContributions
      totalRepositoryContributions
      contributionCalendar{ totalContributions }
    }
    followers{ totalCount }
    repositories(ownerAffiliations:[OWNER], isFork:false){ totalCount }
    starredRepositories{ totalCount }
  }
}
`;

const whoQ = `query W($login:String!){ user(login:$login){ createdAt } }`;
const who = await GQL(whoQ, { login: USER });
const fromISO = new Date(who.user.createdAt).toISOString();
const d = await GQL(q, { login: USER, from: fromISO });

const c = d.user.contributionsCollection;
const trophies = [
  {
    key: "commits",
    title: "Commits",
    value: c.totalCommitContributions,
    grade: c.totalCommitContributions > 5000 ? "S" : c.totalCommitContributions > 1000 ? "A" : "B",
    desc: "Number of commit contributions across all repos."
  },
  {
    key: "followers",
    title: "Followers",
    value: d.user.followers.totalCount,
    grade: d.user.followers.totalCount > 1000 ? "S" : d.user.followers.totalCount > 100 ? "A" : "B",
    desc: "People who follow this account."
  },
  {
    key: "stars",
    title: "Stars",
    value: d.user.starredRepositories.totalCount,
    grade: d.user.starredRepositories.totalCount > 1000 ? "S" : d.user.starredRepositories.totalCount > 200 ? "A" : "B",
    desc: "Repositories starred by this account."
  },
  {
    key: "reviews",
    title: "Reviews",
    value: c.totalPullRequestReviewContributions,
    grade: c.totalPullRequestReviewContributions > 300 ? "S" : c.totalPullRequestReviewContributions > 50 ? "A" : "B",
    desc: "Pull request review contributions."
  },
  {
    key: "issues",
    title: "Issues",
    value: c.totalIssueContributions,
    grade: c.totalIssueContributions > 500 ? "S" : c.totalIssueContributions > 100 ? "A" : "B",
    desc: "Issues created across repositories."
  },
  {
    key: "repos",
    title: "Repositories",
    value: d.user.repositories.totalCount,
    grade: d.user.repositories.totalCount > 100 ? "S" : d.user.repositories.totalCount > 20 ? "A" : "B",
    desc: "Non-fork repositories owned."
  },
  {
    key: "pulls",
    title: "Pull Requests",
    value: c.totalPullRequestContributions,
    grade: c.totalPullRequestContributions > 300 ? "S" : c.totalPullRequestContributions > 50 ? "A" : "B",
    desc: "Pull requests opened."
  },
  {
    key: "experience",
    title: "Experience",
    value: (new Date().getFullYear() - new Date(who.user.createdAt).getFullYear()),
    grade: "A",
    desc: "Years since GitHub account creation."
  }
];

// chunk into pages of 2
const pages = [];
for (let i = 0; i < trophies.length; i += 2) pages.push(trophies.slice(i, i + 2));

const PAGE_W = 640;
const CARD_W = 280;
const CARD_H = 120;
const GAP = 40;

const makeCard = (t, x, id) => `
  <g id="${id}" transform="translate(${x},0)">
    <rect x="0" y="0" rx="14" ry="14" width="${CARD_W}" height="${CARD_H}" fill="#0b1220" stroke="#1f2937" />
    <text x="20" y="30" class="cardTitle">${t.title}</text>
    <text x="20" y="60" class="cardValue">${t.value.toLocaleString()} <tspan class="grade">[${t.grade}]</tspan></text>
    <text x="20" y="90" class="cardDesc">${t.desc}</text>
    <animate attributeName="filter" dur="1.6s" repeatCount="indefinite"
      values="url(#pulse0);url(#pulse1);url(#pulse0)"/>
  </g>
`;

let slides = "";
pages.forEach((pg, i) => {
  const start = (i * 3).toFixed(2);
  const groupId = `page${i}`;
  const x0 = (PAGE_W - (2 * CARD_W + GAP)) / 2;
  const a = makeCard(pg[0], x0, `${groupId}-a`);
  const b = pg[1] ? makeCard(pg[1], x0 + CARD_W + GAP, `${groupId}-b`) : "";

  slides += `
  <g id="${groupId}" transform="translate(${PAGE_W},0)">
    ${a}${b}
    <animateTransform attributeName="transform" type="translate"
      values="${PAGE_W};0;${-PAGE_W}"
      keyTimes="0;0.15;1"
      dur="3s" begin="${start}s"
      fill="freeze"/>
  </g>`;
});

// total duration
const totalDur = (pages.length * 3).toFixed(2);

// SVG
const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${PAGE_W}" height="${CARD_H}" viewBox="0 0 ${PAGE_W} ${CARD_H}"
  xmlns="http://www.w3.org/2000/svg">
  <style>
    :root{ color-scheme: dark; }
    .cardTitle{ font: 700 16px system-ui; fill:#e5e7eb }
    .cardValue{ font: 800 22px system-ui; fill:#60a5fa }
    .grade{ font: 700 16px system-ui; fill:#e11d48 }
    .cardDesc{ font: 12px system-ui; fill:#9ca3af }
  </style>
  <defs>
    <filter id="pulse0"><feGaussianBlur stdDeviation="0"/></filter>
    <filter id="pulse1"><feGaussianBlur stdDeviation="2"/></filter>
  </defs>

  ${slides}

  <!-- loop -->
  <set attributeName="visibility" to="visible" begin="${totalDur}s" dur="0.1s" />
</svg>`;

await fs.mkdir(path.dirname(OUT), { recursive: true });
await fs.writeFile(OUT, svg, "utf8");
console.log(`wrote ${OUT}`);
