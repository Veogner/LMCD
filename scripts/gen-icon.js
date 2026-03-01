import { PNG } from "pngjs";
import fs from "fs";
import path from "path";
import pngToIco from "png-to-ico";

const size = 256;
const outDir = path.join(process.cwd(), "build");
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

const png = new PNG({ width: size, height: size });

for (let y = 0; y < size; y++) {
  for (let x = 0; x < size; x++) {
    const idx = (size * y + x) << 2;
    const t = y / size;
    const r = Math.round(12 + 60 * t + 180 * (x / size) * 0.2);
    const g = Math.round(17 + 80 * (1 - t) + 120 * (x / size) * 0.1);
    const b = Math.round(42 + 140 * t);
    png.data[idx] = r;
    png.data[idx + 1] = g;
    png.data[idx + 2] = b;
    png.data[idx + 3] = 255;
  }
}

// Draw a bold "M" glyph using blocks
const drawRect = (x0, y0, w, h, color) => {
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      if (x < 0 || x >= size || y < 0 || y >= size) continue;
      const idx = (size * y + x) << 2;
      png.data[idx] = color[0];
      png.data[idx + 1] = color[1];
      png.data[idx + 2] = color[2];
      png.data[idx + 3] = color[3];
    }
  }
};

const mint = [70, 240, 161, 255];
const deep = [15, 23, 42, 220];

// Outer frame
drawRect(46, 46, 164, 164, deep);
// M shape
drawRect(66, 86, 32, 84, mint);
drawRect(158, 86, 32, 84, mint);
drawRect(98, 118, 28, 52, mint);
drawRect(130, 118, 28, 52, mint);
drawRect(118, 86, 24, 28, mint);

const pngPath = path.join(outDir, "icon.png");
png
  .pack()
  .pipe(fs.createWriteStream(pngPath))
  .on("finish", async () => {
    const buf = fs.readFileSync(pngPath);
    const ico = await pngToIco(buf);
    fs.writeFileSync(path.join(outDir, "icon.ico"), ico);
    console.log("Generated icon.png and icon.ico in /build");
  });
