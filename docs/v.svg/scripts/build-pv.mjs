// scripts/build-pv.mjs
// Build a solid dark-red "views" pill from Komarev's live count (no left segment).
import fs from "node:fs/promises";

const USER = process.env.USER_LOGIN || "statikfintechllc";
const RED  = "#8B0000";

// Fetch Komarev SVG (force fresh via cache-buster)
const url = `https://komarev.com/ghpvc/?username=${encodeURIComponent(USER)}&style=for-the-badge&t=${Date.now()}`;
const svg = await fetch(url).then(r => r.text());

// Pull the last number appearing in the SVG
const nums = [...svg.matchAll(/>(\d+)</g)].map(m => m[1]);
if (!nums.length) {
  console.error("Could not parse Komarev count");
  process.exit(1);
}
const count = nums.at(-1);

// Build our own single-rect pill (height 28 to match your label)
const h = 28;
const padX = 12;                 // horizontal padding
const charW = 12;                // approx per digit for bold uppercase look
const w = Math.max(42, padX*2 + count.length * charW);

const out = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="Profile views: ${count}">
  <rect x="0" y="0" width="${w}" height="${h}" rx="14" ry="14" fill="${RED}"/>
  <text x="${w/2}" y="${h/2 + 5}" text-anchor="middle"
        font-family="ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,Arial"
        font-size="14" font-weight="700" fill="#fff">${count}</text>
</svg>`;

// Write next to your label asset
await fs.mkdir("assets", { recursive: true });
await fs.writeFile("assets/pv-count.svg", out, "utf8");
console.log("Wrote assets/pv-count.svg with count:", count);
