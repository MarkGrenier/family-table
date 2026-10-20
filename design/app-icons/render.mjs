// Renders the alternate icons. Does not replace the live files in public/icons.
//
//   node design/app-icons/render.mjs
//
// Writes a 512 preview next to each SVG, plus apple-touch, 192, 512, maskable,
// and favicon sizes under design/app-icons/sized/<letter>/.
// To ship a chosen design, copy that folder's files over public/icons/.
import { createRequire } from "node:module";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const sharp = createRequire(import.meta.url)("sharp");
const root = dirname(fileURLToPath(import.meta.url));
const designs = [
  ["a", "a-table.svg"],
  ["b", "b-monogram.svg"],
  ["c", "c-pot.svg"],
  ["d", "d-house.svg"],
  ["e", "e-sprig.svg"],
  ["f", "f-fork.svg"],
  ["g", "g-bowl.svg"],
  ["h", "h-f.svg"],
  ["i", "i-place.svg"],
  ["j", "j-cutout.svg"],
  ["k", "k-cream.svg"],
  ["l", "l-angle.svg"],
  ["m", "m-table.svg"],
  ["n", "n-bowl.svg"],
];

for (const [letter, file] of designs) {
  const svg = readFileSync(join(root, file));
  const master = await sharp(svg).resize(512, 512).flatten({ background: "#5dbb24" }).png().toBuffer();
  await sharp(master).png({ compressionLevel: 9 }).toFile(join(root, file.replace(".svg", "-512.png")));
  const dir = join(root, "sized", letter);
  mkdirSync(dir, { recursive: true });
  const write = async (size, name) => {
    await sharp(master).resize(size, size).flatten({ background: "#5dbb24" }).png({ compressionLevel: 9 }).toFile(join(dir, name));
  };
  await write(180, "apple-touch-icon.png");
  await write(192, "icon-192.png");
  await write(512, "icon-512.png");
  await write(512, "icon-maskable.png");
  await write(32, "favicon-32.png");
}

console.log("Rendered alternate icons under design/app-icons. Live public/icons were left alone.");
