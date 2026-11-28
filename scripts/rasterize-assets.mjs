#!/usr/bin/env node
/**
 * Rasterize the profile panels to PNG.
 *
 * GitHub-hosted runners do not have Segoe UI, Arial, Consolas, or Monaco.
 * Which fallback fontconfig returns changes between runner image builds, and
 * resvg drops a text run instead of painting it when the requested face does
 * not match. That is why streak counts and the stats values vanish while the
 * labels next to them sometimes still draw.
 *
 * Rendering always uses the fonts in scripts/fonts and never the runner's
 * fontconfig. After drawing, every text node is checked for real ink in its
 * own box. A blank number fails the job, so a bad panel cannot be committed.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const assetsDir = join(root, "assets");
const fontsDir = join(root, "scripts", "fonts");

const fontFiles = [
  "Inter-Regular.ttf",
  "Inter-Bold.ttf",
  "JetBrainsMono-Regular.ttf",
  "JetBrainsMono-Bold.ttf",
].map((name) => join(fontsDir, name));

const jobs = [
  ["activity-header.svg", 2400],
  ["streak.svg", 1200],
  ["stats.svg", 2400],
];

for (const file of fontFiles) {
  if (!existsSync(file)) {
    console.error("missing vendored font:", file);
    process.exit(1);
  }
}

function numAttr(attrs, name) {
  const match = attrs.match(new RegExp(`\\b${name}\\s*=\\s*['"]([\\d.]+)`));
  return match ? Number(match[1]) : null;
}

function attr(attrs, name) {
  const match = attrs.match(new RegExp(`\\b${name}\\s*=\\s*['"]([^'"]*)['"]`));
  return match ? match[1] : null;
}

function parseColor(fill) {
  if (!fill) return null;
  const hex = fill.trim().replace("#", "");
  const full = hex.length === 3 ? hex.split("").map((c) => c + c).join("") : hex;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;
  return [
    Number.parseInt(full.slice(0, 2), 16),
    Number.parseInt(full.slice(2, 4), 16),
    Number.parseInt(full.slice(4, 6), 16),
  ];
}

function svgSize(svg) {
  const viewBox = svg.match(/viewBox\s*=\s*['"]\s*[\d.-]+\s+[\d.-]+\s+([\d.]+)\s+([\d.]+)\s*['"]/);
  if (viewBox) return { w: Number(viewBox[1]), h: Number(viewBox[2]) };
  const w = svg.match(/\bwidth\s*=\s*['"]([\d.]+)/);
  const h = svg.match(/\bheight\s*=\s*['"]([\d.]+)/);
  if (!w || !h) throw new Error("SVG has no viewBox or width/height");
  return { w: Number(w[1]), h: Number(h[1]) };
}

/** Resolve translate() groups so streak numbers are not checked at 0,0. */
function parseTextNodes(svg) {
  const re = /<\/g\s*>|<g\b[^>]*>|<text\b([^>]*)>([\s\S]*?)<\/text>/g;
  const stack = [{ x: 0, y: 0 }];
  const nodes = [];
  for (const match of svg.matchAll(re)) {
    const token = match[0];
    if (token.startsWith("</g")) {
      if (stack.length > 1) stack.pop();
      continue;
    }
    if (token.startsWith("<g")) {
      const top = stack[stack.length - 1];
      const translated = token.match(/translate\(\s*([\d.eE+-]+)(?:[,\s]+([\d.eE+-]+))?\s*\)/);
      if (translated) {
        stack.push({
          x: top.x + Number(translated[1]),
          y: top.y + Number(translated[2] || 0),
        });
      } else {
        stack.push({ x: top.x, y: top.y });
      }
      continue;
    }
    const attrs = match[1];
    const text = match[2].replace(/\s+/g, " ").trim();
    if (!text) continue;
    const top = stack[stack.length - 1];
    const size = numAttr(attrs, "font-size") || 16;
    nodes.push({
      text,
      x: top.x + (numAttr(attrs, "x") || 0),
      y: top.y + (numAttr(attrs, "y") || 0),
      size,
      anchor: attr(attrs, "text-anchor") || "start",
      fill: parseColor(attr(attrs, "fill")),
      spacing: numAttr(attrs, "letter-spacing") || 0,
    });
  }
  return nodes;
}

function inkBox(node) {
  const width =
    node.size * 0.7 * node.text.length + node.spacing * Math.max(node.text.length - 1, 0);
  const pad = node.size * 0.35;
  let x0;
  let x1;
  if (node.anchor === "end") {
    x1 = node.x + pad;
    x0 = node.x - width - pad;
  } else if (node.anchor === "middle") {
    x0 = node.x - width / 2 - pad;
    x1 = node.x + width / 2 + pad;
  } else {
    x0 = node.x - pad;
    x1 = node.x + width + pad;
  }
  return {
    x0,
    y0: node.y - node.size * 0.95,
    x1,
    y1: node.y + node.size * 0.3,
  };
}

function requiredPixels(node, scale) {
  const glyphs = node.text.replace(/\s+/g, "").length;
  const px = node.size * scale;
  return Math.max(20, Math.round(glyphs * px * px * 0.02));
}

function countInk(pixels, width, height, box, rgb, scale) {
  const x0 = Math.max(0, Math.floor(box.x0 * scale));
  const y0 = Math.max(0, Math.floor(box.y0 * scale));
  const x1 = Math.min(width, Math.ceil(box.x1 * scale));
  const y1 = Math.min(height, Math.ceil(box.y1 * scale));
  if (x1 <= x0 || y1 <= y0) return 0;
  const tolerance = 52;
  let count = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * width + x) * 4;
      const alpha = pixels[i + 3];
      if (alpha < 160) continue;
      if (
        Math.abs(pixels[i] - rgb[0]) <= tolerance &&
        Math.abs(pixels[i + 1] - rgb[1]) <= tolerance &&
        Math.abs(pixels[i + 2] - rgb[2]) <= tolerance
      ) {
        count++;
      }
    }
  }
  return count;
}

function familyFor(stack) {
  return /mono|consolas|monaco|courier|jetbrains/i.test(stack) ? "Profile Mono" : "Profile Sans";
}

function rewriteFonts(svg) {
  const withAttrs = svg.replace(
    /font-family\s*=\s*(['"])([\s\S]*?)\1/g,
    (_, quote, family) => `font-family=${quote}${familyFor(family)}${quote}`,
  );
  return withAttrs.replace(
    /font-family\s*:\s*([^;}"]+)/g,
    (_, family) => `font-family: ${familyFor(family)}`,
  );
}

function assertPanel(file, svg, nodes) {
  if (nodes.length === 0) {
    throw new Error(`${file}: no text nodes found`);
  }
  if (nodes.some((node) => !node.fill)) {
    throw new Error(`${file}: a text node has no hex fill, so ink cannot be checked`);
  }
  if (file === "streak.svg") {
    const numbers = nodes.filter((node) => /^[\d,]+$/.test(node.text) && node.size >= 24);
    if (numbers.length < 3) {
      throw new Error(`${file}: expected the three streak numbers, found ${numbers.length}`);
    }
    if (numbers.some((node) => node.x < 40)) {
      throw new Error(`${file}: streak number positions were not resolved from transforms`);
    }
  }
  if (file === "stats.svg") {
    const numbers = nodes.filter((node) => /^[\d,]+$/.test(node.text));
    if (numbers.length < 6) {
      throw new Error(`${file}: expected 6 stat values, found ${numbers.length}`);
    }
  }
}

function rasterize(file, outWidth) {
  const svgPath = join(assetsDir, file);
  const svg = readFileSync(svgPath, "utf8");
  const nodes = parseTextNodes(svg);
  assertPanel(file, svg, nodes);
  const size = svgSize(svg);
  const painted = rewriteFonts(svg);
  const resvg = new Resvg(painted, {
    fitTo: { mode: "width", value: outWidth },
    font: {
      fontFiles,
      loadSystemFonts: false,
      defaultFontFamily: "Profile Sans",
      sansSerifFamily: "Profile Sans",
      serifFamily: "Profile Sans",
      monospaceFamily: "Profile Mono",
    },
    logLevel: "warn",
  });
  const rendered = resvg.render();
  const scale = rendered.width / size.w;
  const failures = [];
  const inks = [];
  for (const node of nodes) {
    const ink = countInk(rendered.pixels, rendered.width, rendered.height, inkBox(node), node.fill, scale);
    const need = requiredPixels(node, scale);
    inks.push(ink);
    if (ink < need) {
      failures.push(
        `"${node.text}" at (${Math.round(node.x)},${Math.round(node.y)}) has ${ink} px, need ${need}`,
      );
    }
  }
  if (failures.length) {
    throw new Error(`${file}: text was not drawn\n  ${failures.join("\n  ")}`);
  }
  const pngName = file.replace(/\.svg$/, ".png");
  writeFileSync(join(assetsDir, pngName), rendered.asPng());
  const numbers = nodes.filter((node) => /^[\d,]+$/.test(node.text));
  console.log(
    `wrote ${pngName} ${rendered.width}x${rendered.height}`,
    `texts ${nodes.length}`,
    numbers.length ? `numbers ${numbers.map((node) => node.text).join(",")}` : "",
    `minInk ${Math.min(...inks)}`,
  );
}

let failed = false;
for (const [file, width] of jobs) {
  try {
    rasterize(file, width);
  } catch (error) {
    failed = true;
    console.error(error.message || error);
  }
}
if (failed) process.exit(1);
