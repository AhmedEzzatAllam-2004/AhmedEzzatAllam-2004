/**
 * generate-hero.js
 *
 * Regenerates assets/gitskins-hero.png: a dotted world map whose dots are
 * colorized from the current GitHub avatar of GITHUB_USERNAME.
 *
 * Run with:  node scripts/generate-hero.js
 * Requires:  GITHUB_USERNAME env var (falls back to the constant below)
 *
 * This replaces the old gitskins.com dependency (which required a login
 * to get a working export URL) with a fully self-hosted, automatable
 * version driven by a GitHub Action.
 */

const fs = require("fs");
const path = require("path");
const https = require("https");
const DottedMap = require("dotted-map").default;
const sharp = require("sharp");

const USERNAME = process.env.GITHUB_USERNAME || "ahmedezzatallam-2004";
const OUT_PATH = path.join(__dirname, "..", "assets", "gitskins-hero.png");
const WIDTH_PX = 950;

// ---- helpers ---------------------------------------------------------

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(
      url,
      { headers: { "User-Agent": "hero-generator-script" } },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(e);
          }
        });
      }
    ).on("error", reject);
  });
}

function fetchBuffer(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { "User-Agent": "hero-generator-script" } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          fetchBuffer(res.headers.location).then(resolve, reject);
          return;
        }
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve(Buffer.concat(chunks)));
      })
      .on("error", reject);
  });
}

function rgbToHsv(r, g, b) {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b);
  const v = max;
  const d = max - min;
  const s = max === 0 ? 0 : d / max;
  let h = 0;
  if (d !== 0) {
    switch (max) {
      case r:
        h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
        break;
      case g:
        h = ((b - r) / d + 2) / 6;
        break;
      case b:
        h = ((r - g) / d + 4) / 6;
        break;
    }
  }
  return [h, s, v];
}

// ---- main --------------------------------------------------------------

async function main() {
  console.log(`Generating hero for ${USERNAME}...`);

  // 1. Get current avatar URL from the GitHub API (always up to date)
  const user = await fetchJson(`https://api.github.com/users/${USERNAME}`);
  if (!user.avatar_url) throw new Error("Could not resolve avatar_url from GitHub API");
  const avatarBuffer = await fetchBuffer(user.avatar_url);

  // 2. Downscale the avatar to a small color grid we can sample cheaply
  const GRID = 100;
  const { data: pixels, info } = await sharp(avatarBuffer)
    .resize(GRID, GRID, { fit: "cover" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const channels = info.channels; // should be 3 (RGB)

  function sampleAvatar(nx, ny) {
    const ax = Math.min(GRID - 1, Math.floor(nx * GRID));
    const ay = Math.min(GRID - 1, Math.floor(ny * GRID));
    const idx = (ay * GRID + ax) * channels;
    return [pixels[idx], pixels[idx + 1], pixels[idx + 2]];
  }

  // 3. Build the base dotted world map (positions only)
  const map = new DottedMap({ height: 60, grid: "diagonal" });
  const baseSvg = map.getSVG({
    radius: 0.22,
    color: "#2eca7f",
    shape: "circle",
    backgroundColor: "#0d1117",
  });

  const circleRe = /<circle cx="([\d.]+)" cy="([\d.]+)"/g;
  const points = [];
  let m;
  while ((m = circleRe.exec(baseSvg)) !== null) {
    points.push([parseFloat(m[1]), parseFloat(m[2])]);
  }
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const minX = Math.min(...xs),
    maxX = Math.max(...xs);
  const minY = Math.min(...ys),
    maxY = Math.max(...ys);

  // 4. Colorize each dot from the avatar; keep low-saturation pixels dim
  //    so the result still reads as a map, not just a mosaic of the photo.
  const BASE_DIM = [90, 96, 110];
  const circles = points.map(([cx, cy]) => {
    const nx = (cx - minX) / (maxX - minX);
    const ny = (cy - minY) / (maxY - minY);
    const [r, g, b] = sampleAvatar(nx, ny);
    const [, s, v] = rgbToHsv(r, g, b);
    let fr, fg, fb;
    if (s > 0.28 && v > 0.25) {
      const alpha = Math.min(1, (s - 0.28) / 0.4);
      fr = Math.round(BASE_DIM[0] * (1 - alpha) + r * alpha);
      fg = Math.round(BASE_DIM[1] * (1 - alpha) + g * alpha);
      fb = Math.round(BASE_DIM[2] * (1 - alpha) + b * alpha);
    } else {
      [fr, fg, fb] = BASE_DIM;
    }
    const hex = (n) => n.toString(16).padStart(2, "0");
    const color = `#${hex(fr)}${hex(fg)}${hex(fb)}`;
    return `<circle cx="${cx}" cy="${cy}" r="0.22" fill="${color}" />`;
  });

  // 5. Assemble final SVG: rounded card, border, dots, credit label
  const finalSvg = `<svg viewBox="0 0 119 60" xmlns="http://www.w3.org/2000/svg">
<defs>
  <clipPath id="round">
    <rect x="0.5" y="0.5" width="118" height="59" rx="3" ry="3"/>
  </clipPath>
</defs>
<rect x="0" y="0" width="119" height="60" fill="#0d1117"/>
<g clip-path="url(#round)">
${circles.join("\n")}
</g>
<rect x="0.5" y="0.5" width="118" height="59" rx="3" ry="3" fill="none" stroke="#2a3140" stroke-width="0.6"/>
<text x="114" y="57.5" font-family="monospace" font-size="2.6" fill="#5b6472" text-anchor="end">${USERNAME}</text>
</svg>`;

  // 6. Rasterize to PNG and write to assets/
  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  await sharp(Buffer.from(finalSvg), { density: 300 })
    .resize(WIDTH_PX, null)
    .png()
    .toFile(OUT_PATH);

  console.log(`Wrote ${OUT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
