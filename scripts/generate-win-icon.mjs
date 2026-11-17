import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import pngToIco from 'png-to-ico';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const srcLogoPath = path.join(rootDir, 'public', 'awlad-selim-logo.png');
const buildDir = path.join(rootDir, 'build');
const outPngPath = path.join(buildDir, 'icon.png');
const outIcoPath = path.join(buildDir, 'icon.ico');

if (!fs.existsSync(srcLogoPath)) {
  throw new Error(`Missing official logo: ${srcLogoPath}`);
}

const srcBuf = fs.readFileSync(srcLogoPath);
const srcPng = PNG.sync.read(srcBuf);

// Find non-transparent bounding box
let minX = srcPng.width;
let minY = srcPng.height;
let maxX = -1;
let maxY = -1;

for (let y = 0; y < srcPng.height; y++) {
  for (let x = 0; x < srcPng.width; x++) {
    const idx = (y * srcPng.width + x) << 2;
    const alpha = srcPng.data[idx + 3];
    if (alpha > 8) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
}

if (maxX < minX || maxY < minY) {
  minX = 0;
  minY = 0;
  maxX = srcPng.width - 1;
  maxY = srcPng.height - 1;
}

const cropW = maxX - minX + 1;
const cropH = maxY - minY + 1;

// Render cropped logo centered inside a 512x512 transparent square canvas with bilinear sampling
const targetSize = 512;
const maxInner = 472;
const scale = Math.min(maxInner / cropW, maxInner / cropH);
const drawW = Math.max(1, Math.round(cropW * scale));
const drawH = Math.max(1, Math.round(cropH * scale));
const offsetX = Math.floor((targetSize - drawW) / 2);
const offsetY = Math.floor((targetSize - drawH) / 2);

const outPng = new PNG({ width: targetSize, height: targetSize, fill: true });
outPng.data.fill(0);

for (let dy = 0; dy < drawH; dy++) {
  const sy = minY + ((dy + 0.5) * cropH) / drawH - 0.5;
  const y0 = Math.max(minY, Math.min(maxY, Math.floor(sy)));
  const y1 = Math.max(minY, Math.min(maxY, y0 + 1));
  const fy = sy - y0;

  for (let dx = 0; dx < drawW; dx++) {
    const sx = minX + ((dx + 0.5) * cropW) / drawW - 0.5;
    const x0 = Math.max(minX, Math.min(maxX, Math.floor(sx)));
    const x1 = Math.max(minX, Math.min(maxX, x0 + 1));
    const fx = sx - x0;

    const i00 = (y0 * srcPng.width + x0) << 2;
    const i10 = (y0 * srcPng.width + x1) << 2;
    const i01 = (y1 * srcPng.width + x0) << 2;
    const i11 = (y1 * srcPng.width + x1) << 2;

    const outIdx = ((offsetY + dy) * targetSize + (offsetX + dx)) << 2;
    for (let c = 0; c < 4; c++) {
      const top = srcPng.data[i00 + c] * (1 - fx) + srcPng.data[i10 + c] * fx;
      const bot = srcPng.data[i01 + c] * (1 - fx) + srcPng.data[i11 + c] * fx;
      outPng.data[outIdx + c] = Math.round(top * (1 - fy) + bot * fy);
    }
  }
}

fs.mkdirSync(buildDir, { recursive: true });
const pngBuffer = PNG.sync.write(outPng);
fs.writeFileSync(outPngPath, pngBuffer);

const icoBuffer = await pngToIco(outPngPath);
fs.writeFileSync(outIcoPath, icoBuffer);

console.log(`Generated ${path.relative(rootDir, outPngPath)} (${pngBuffer.length} bytes) and ${path.relative(rootDir, outIcoPath)} (${icoBuffer.length} bytes)`);
