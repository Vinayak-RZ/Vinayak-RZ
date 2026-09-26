#!/usr/bin/env node
const sharp = require("sharp");
const fs = require("fs");
const path = require("path");

const OUT = path.join(__dirname, "..", "assets");
const SIZE = 128;
const PAD = 36;
const ICON = SIZE - PAD * 2;

async function whiteTile(name, inputBuf, { dropBlack = false } = {}) {
  let pipeline = sharp(inputBuf)
    .resize(ICON, ICON, {
      fit: "contain",
      background: { r: 255, g: 255, b: 255, alpha: 0 },
    })
    .ensureAlpha();

  if (dropBlack) {
    const { data, info } = await pipeline.raw().toBuffer({ resolveWithObject: true });
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      if (r < 45 && g < 45 && b < 45) data[i + 3] = 0;
    }
    pipeline = sharp(data, {
      raw: { width: info.width, height: info.height, channels: 4 },
    });
  }

  const iconPng = await pipeline.png().toBuffer();

  // white rounded square via SVG mask overlay
  const frame = Buffer.from(`
    <svg width="${SIZE}" height="${SIZE}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${SIZE}" height="${SIZE}" rx="22" ry="22" fill="#ffffff"/>
      <rect x="1" y="1" width="${SIZE - 2}" height="${SIZE - 2}" rx="21" ry="21"
            fill="none" stroke="#E5E5E5" stroke-width="2"/>
    </svg>`);

  await sharp(frame)
    .composite([{ input: iconPng, gravity: "centre" }])
    .png()
    .toFile(path.join(OUT, name));

  console.log("wrote", name);
}

async function fetchIcon(url, color) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch ${url}: ${res.status}`);
  let svg = await res.text();
  svg = svg.replace(/<svg\b/, `<svg fill="${color}"`);
  svg = svg.replace(/fill="#000000"/gi, `fill="${color}"`);
  svg = svg.replace(/fill="black"/gi, `fill="${color}"`);
  return Buffer.from(svg);
}

(async () => {
  await whiteTile(
    "connect-stamped.png",
    fs.readFileSync(path.join(OUT, "stamped-logo.png")),
    { dropBlack: true }
  );

  await whiteTile(
    "connect-linkedin.png",
    await fetchIcon(
      "https://cdn.jsdelivr.net/npm/simple-icons@v11/icons/linkedin.svg",
      "#0A66C2"
    )
  );

  await whiteTile(
    "connect-email.png",
    await fetchIcon(
      "https://cdn.jsdelivr.net/npm/simple-icons@v11/icons/gmail.svg",
      "#EA4335"
    )
  );

  await whiteTile(
    "connect-github.png",
    await fetchIcon(
      "https://cdn.jsdelivr.net/npm/simple-icons@v11/icons/github.svg",
      "#181717"
    )
  );

  const tiles = [
    "connect-stamped.png",
    "connect-linkedin.png",
    "connect-email.png",
    "connect-github.png",
  ];
  const gap = 28;
  const stripW = SIZE * 4 + gap * 5;
  const stripH = SIZE + gap * 2;
  const comps = tiles.map((t, i) => ({
    input: path.join(OUT, t),
    left: gap + i * (SIZE + gap),
    top: gap,
  }));

  await sharp({
    create: {
      width: stripW,
      height: stripH,
      channels: 3,
      background: { r: 13, g: 17, b: 23 },
    },
  })
    .composite(comps)
    .png()
    .toFile(path.join(OUT, "_connect-preview.png"));

  console.log("wrote _connect-preview.png");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
