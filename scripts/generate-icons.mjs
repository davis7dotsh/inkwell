// Generates the Inkwell icon family: three ink-wash ribbons (deep ink /
// stroke blue / wash) on paper — the app's core brush gesture.
import { createRequire } from "module";
import fs from "node:fs";

const require = createRequire(import.meta.url);
const sharpDir = fs
  .readdirSync("node_modules/.pnpm")
  .find((d) => d.startsWith("sharp@"));
const sharp = require(
  `${process.cwd()}/node_modules/.pnpm/${sharpDir}/node_modules/sharp`,
);

const RIBBON =
  "M 2 7.6 C 12 3.6 30 2.8 50 4.2 C 68 5.4 84 3.6 98 5.4 " +
  "C 99.4 5.8 99.4 6.6 98.2 7.0 C 84 6.6 66 8.6 46 7.8 " +
  "C 28 7.1 12 9.6 2.4 9.0 C 1.2 8.7 1.0 8.1 2 7.6 Z";

const PAPER = "#F7F8F6";
const DEEP = "#0E2E52";
const STROKE = "#3D7BC0";
const WASH = "#8FB8DE";

// The ribbon trio, tuned for a 1024 box.
const trio = (c1, c2, c3) => `
  <path d="${RIBBON}" fill="${c1}" transform="translate(110,230) scale(8.1,24)"/>
  <path d="${RIBBON}" fill="${c2}" transform="translate(916,440) scale(-7.9,19)"/>
  <path d="${RIBBON}" fill="${c3}" transform="translate(125,640) scale(7.7,14)"/>`;

const svg = (body, bg) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">${
    bg ? `<rect width="1024" height="1024" fill="${bg}"/>` : ""
  }${body}</svg>`;

// Centered + shrunk variant (android adaptive safe zone / splash)
const centered = (body, k = 0.62) =>
  `<g transform="translate(${(1024 * (1 - k)) / 2},${(1024 * (1 - k)) / 2}) scale(${k})">${body}</g>`;

const out = {
  "apps/mobile/assets/images/icon.png": [
    svg(trio(DEEP, STROKE, WASH), PAPER),
    1024,
  ],
  "apps/mobile/assets/images/android-icon-foreground.png": [
    svg(centered(trio(DEEP, STROKE, WASH))),
    1024,
  ],
  "apps/mobile/assets/images/android-icon-background.png": [
    svg("", PAPER),
    1024,
  ],
  "apps/mobile/assets/images/android-icon-monochrome.png": [
    svg(centered(trio("#FFFFFF", "#FFFFFF", "#FFFFFF"))),
    1024,
  ],
  "apps/mobile/assets/images/splash-icon.png": [
    svg(centered(trio(PAPER, PAPER, PAPER), 0.9)),
    512,
  ],
  "apps/mobile/assets/images/favicon.png": [
    svg(trio(DEEP, STROKE, WASH), PAPER),
    64,
  ],
  "apps/web/public/favicon.png": [svg(trio(DEEP, STROKE, WASH), PAPER), 64],
};

fs.mkdirSync("apps/web/public", { recursive: true });
for (const [file, [markup, size]] of Object.entries(out)) {
  await sharp(Buffer.from(markup)).resize(size, size).png().toFile(file);
  console.log("wrote", file, size);
}
// Rounded-corner SVG favicon for the web (browsers don't mask favicons).
const webSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
<rect width="1024" height="1024" rx="180" fill="${PAPER}"/>${trio(DEEP, STROKE, WASH)}</svg>`;
fs.writeFileSync("apps/web/public/favicon.svg", webSvg);
console.log("wrote apps/web/public/favicon.svg");
