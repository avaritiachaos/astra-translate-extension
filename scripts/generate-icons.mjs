import { writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { deflateSync } from "zlib";

const __dirname = dirname(fileURLToPath(import.meta.url));
const iconsDir = resolve(__dirname, "../public/icons");

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let j = 0; j < 8; j++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
  }
  return (c ^ 0xffffffff) >>> 0;
}

function makeChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuffer = Buffer.from(type, "ascii");
  const crcData = Buffer.concat([typeBuffer, data]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(crcData), 0);
  return Buffer.concat([len, typeBuffer, data, crcBuf]);
}

function createPNG(size) {
  const width = size;
  const height = size;
  const pixels = new Uint8Array(width * height * 4);
  const cx = width / 2;
  const cy = height / 2;
  const r = width * 0.42;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const angle = Math.atan2(dy, dx);
      const innerR = r * 0.45;
      const outerR = r;
      const a = (angle + Math.PI * 2) % (Math.PI * 2);
      const segment = (a / (Math.PI * 2)) * 8;
      const segFrac = segment % 1;
      const starR = (Math.floor(segment) % 2 === 0)
        ? innerR + (outerR - innerR) * segFrac
        : outerR - (outerR - innerR) * segFrac;

      if (dist <= starR) {
        const t = dist / starR;
        pixels[idx]     = Math.round(99 + (129 - 99) * t);
        pixels[idx + 1] = Math.round(102 + (140 - 102) * t);
        pixels[idx + 2] = Math.round(241 + (248 - 241) * t);
        pixels[idx + 3] = 255;
      } else if (dist <= starR + 1.5) {
        pixels[idx]     = 99;
        pixels[idx + 1] = 102;
        pixels[idx + 2] = 241;
        pixels[idx + 3] = Math.round(255 * Math.max(0, 1 - (dist - starR) / 1.5));
      }
    }
  }

  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  const ihdrChunk = makeChunk("IHDR", ihdr);

  const rawData = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    rawData[y * (1 + width * 4)] = 0;
    for (let x = 0; x < width; x++) {
      const srcIdx = (y * width + x) * 4;
      const dstIdx = y * (1 + width * 4) + 1 + x * 4;
      rawData[dstIdx]     = pixels[srcIdx];
      rawData[dstIdx + 1] = pixels[srcIdx + 1];
      rawData[dstIdx + 2] = pixels[srcIdx + 2];
      rawData[dstIdx + 3] = pixels[srcIdx + 3];
    }
  }

  const compressed = deflateSync(rawData);
  const idatChunk = makeChunk("IDAT", compressed);
  const iendChunk = makeChunk("IEND", Buffer.alloc(0));
  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

for (const size of [16, 48, 128]) {
  const png = createPNG(size);
  writeFileSync(resolve(iconsDir, `icon${size}.png`), png);
  console.log(`Generated icon${size}.png (${png.length} bytes)`);
}
console.log("Done!");
