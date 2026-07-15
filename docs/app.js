'use strict';
// Mosaic Forge web — the forge.py algorithm, fully client-side.
const $ = (s) => document.querySelector(s);

let targetBitmap = null;
let photoFiles = [];
let fullCanvas = null;

const EXTS = /\.(jpe?g|png|webp|bmp)$/i;

// ── pickers ─────────────────────────────────────────────────────────────────
$('#btn-target').onclick = () => $('#target-input').click();
$('#target-input').onchange = async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  try {
    targetBitmap = await createImageBitmap(f);
  } catch {
    return showError('Could not read that image.');
  }
  $('#target-name').textContent = `${f.name} (${targetBitmap.width}×${targetBitmap.height})`;
  const pv = $('#target-preview');
  const scale = 74 / targetBitmap.height;
  pv.width = Math.round(targetBitmap.width * scale);
  pv.height = 74;
  pv.getContext('2d').drawImage(targetBitmap, 0, 0, pv.width, pv.height);
  updateReady();
};

$('#btn-photos').onclick = () => $('#photos-input').click();
$('#photos-input').onchange = (e) => {
  photoFiles = [...e.target.files].filter((f) => EXTS.test(f.name));
  $('#photos-name').textContent = photoFiles.length
    ? `${photoFiles.length} photos found`
    : 'No photos found in that folder';
  updateReady();
};

function updateReady() {
  $('#btn-build').disabled = !(targetBitmap && photoFiles.length >= 16);
}

// ── knob labels ─────────────────────────────────────────────────────────────
const gridDesc = (v) => `${v} tiles across`;
const tileDesc = (v) => `${v} px — ${v >= 128 ? 'banner print' : v >= 96 ? 'print quality' : 'screen/share'}`;
const blendDesc = (v) => `${v}% — ${v === 0 ? 'pure photos' : v <= 30 ? 'balanced' : 'poster-graphic'}`;
$('#grid').oninput = () => { $('#grid-val').textContent = gridDesc($('#grid').value); };
$('#tile').oninput = () => { $('#tile-val').textContent = tileDesc($('#tile').value); };
$('#blend').oninput = () => { $('#blend-val').textContent = blendDesc($('#blend').value); };

function showError(msg) { const el = $('#error'); el.hidden = !msg; el.textContent = msg || ''; }
function progress(frac, text) {
  $('#progress').hidden = false;
  $('#progress .bar').style.width = `${Math.round(frac * 100)}%`;
  $('#progress .ptext').textContent = text;
}
const tick = () => new Promise((r) => setTimeout(r, 0));

// ── signatures (2×2 quadrant means in linear light, matching forge.py) ──────
const sigScratch = document.createElement('canvas');
sigScratch.width = sigScratch.height = 16;
const sigCtx = sigScratch.getContext('2d', { willReadFrequently: true });

function signatureOf(drawable, sx, sy, sw, sh) {
  sigCtx.clearRect(0, 0, 16, 16);
  sigCtx.drawImage(drawable, sx, sy, sw, sh, 0, 0, 16, 16);
  const d = sigCtx.getImageData(0, 0, 16, 16).data;
  const sig = new Float32Array(12);
  const count = new Float32Array(4);
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const q = (y >> 3) * 2 + (x >> 3);
      const i = (y * 16 + x) * 4;
      sig[q * 3] += Math.pow(d[i] / 255, 2.2);
      sig[q * 3 + 1] += Math.pow(d[i + 1] / 255, 2.2);
      sig[q * 3 + 2] += Math.pow(d[i + 2] / 255, 2.2);
      count[q]++;
    }
  }
  for (let q = 0; q < 4; q++) {
    sig[q * 3] /= count[q]; sig[q * 3 + 1] /= count[q]; sig[q * 3 + 2] /= count[q];
  }
  return sig;
}

// ── build ───────────────────────────────────────────────────────────────────
$('#btn-build').onclick = async () => {
  showError(null);
  $('#result-panel').hidden = true;
  $('#btn-build').disabled = true;
  try {
    await build();
  } catch (err) {
    showError('Build failed: ' + err.message);
  }
  $('#progress').hidden = true;
  $('#btn-build').disabled = false;
};

async function build() {
  const gridW = parseInt($('#grid').value, 10);
  const tilePx = parseInt($('#tile').value, 10);
  const blend = parseInt($('#blend').value, 10) / 100;
  const spread = 3;

  // 1) index the library
  const tiles = [], sigs = [];
  let skipped = 0;
  for (let i = 0; i < photoFiles.length; i++) {
    try {
      const bmp = await createImageBitmap(photoFiles[i]);
      const side = Math.min(bmp.width, bmp.height);
      const sx = (bmp.width - side) / 2, sy = (bmp.height - side) / 2;
      const tile = await createImageBitmap(bmp, sx, sy, side, side,
        { resizeWidth: tilePx, resizeHeight: tilePx, resizeQuality: 'high' });
      sigs.push(signatureOf(tile, 0, 0, tilePx, tilePx));
      tiles.push(tile);
      bmp.close();
    } catch { skipped++; }
    if (i % 12 === 0) {
      progress(i / photoFiles.length * 0.45, `Indexing photos ${i + 1}/${photoFiles.length}…`);
      await tick();
    }
  }
  if (tiles.length < 16) throw new Error(`only ${tiles.length} usable photos (need 16+)`);
  const n = tiles.length;
  const flat = new Float32Array(n * 12);
  sigs.forEach((s, i) => flat.set(s, i * 12));

  // 2) target cell signatures
  const gridH = Math.max(8, Math.round(gridW * targetBitmap.height / targetBitmap.width));
  const cellW = targetBitmap.width / gridW, cellH = targetBitmap.height / gridH;
  const cellSigs = new Array(gridH * gridW);
  for (let gy = 0; gy < gridH; gy++) {
    for (let gx = 0; gx < gridW; gx++) {
      cellSigs[gy * gridW + gx] = signatureOf(targetBitmap, gx * cellW, gy * cellH, cellW, cellH);
    }
  }

  // 3) place tiles
  fullCanvas = document.createElement('canvas');
  fullCanvas.width = gridW * tilePx;
  fullCanvas.height = gridH * tilePx;
  const ctx = fullCanvas.getContext('2d');
  const chosen = new Int32Array(gridH * gridW).fill(-1);
  const usage = new Float32Array(n);

  for (let gy = 0; gy < gridH; gy++) {
    for (let gx = 0; gx < gridW; gx++) {
      const want = cellSigs[gy * gridW + gx];
      let best = -1, bestD = Infinity;
      outer:
      for (let k = 0; k < n; k++) {
        let d = usage[k] * 0.005;
        if (d >= bestD) continue;
        const base = k * 12;
        for (let j = 0; j < 12; j++) {
          const diff = flat[base + j] - want[j];
          d += diff * diff;
          if (d >= bestD) continue outer;
        }
        // de-clump: skip if this tile sits within `spread` cells
        for (let dy = -spread; dy <= spread; dy++) {
          const yy = gy + dy;
          if (yy < 0 || yy >= gridH) continue;
          for (let dx = -spread; dx <= spread; dx++) {
            const xx = gx + dx;
            if (xx >= 0 && xx < gridW && chosen[yy * gridW + xx] === k) continue outer;
          }
        }
        best = k; bestD = d;
      }
      if (best < 0) best = Math.floor(Math.random() * n);   // fully blocked cell
      chosen[gy * gridW + gx] = best;
      usage[best] += 1;

      const x = gx * tilePx, y = gy * tilePx;
      ctx.drawImage(tiles[best], x, y);
      if (blend > 0) {
        const w = cellSigs[gy * gridW + gx];
        const r = Math.round(Math.pow((w[0] + w[3] + w[6] + w[9]) / 4, 1 / 2.2) * 255);
        const g = Math.round(Math.pow((w[1] + w[4] + w[7] + w[10]) / 4, 1 / 2.2) * 255);
        const b = Math.round(Math.pow((w[2] + w[5] + w[8] + w[11]) / 4, 1 / 2.2) * 255);
        ctx.fillStyle = `rgba(${r},${g},${b},${blend})`;
        ctx.fillRect(x, y, tilePx, tilePx);
      }
    }
    if (gy % 3 === 0) {
      progress(0.45 + (gy / gridH) * 0.55, `Placing tiles — row ${gy + 1}/${gridH}…`);
      await tick();
    }
  }

  // 4) preview + stats
  const used = usage.reduce((a, v) => a + (v > 0 ? 1 : 0), 0);
  $('#result-stats').textContent =
    `${gridW}×${gridH} tiles · ${fullCanvas.width}×${fullCanvas.height}px · ` +
    `${used} of ${n} photos used` + (skipped ? ` · ${skipped} files skipped` : '');
  const pv = $('#result-preview');
  const pscale = Math.min(1, 1600 / fullCanvas.width);
  pv.width = Math.round(fullCanvas.width * pscale);
  pv.height = Math.round(fullCanvas.height * pscale);
  pv.getContext('2d').drawImage(fullCanvas, 0, 0, pv.width, pv.height);
  $('#result-panel').hidden = false;
  $('#result-panel').scrollIntoView({ behavior: 'smooth' });
}

$('#btn-download').onclick = () => {
  if (!fullCanvas) return;
  progress(1, 'Encoding PNG…');
  fullCanvas.toBlob((blob) => {
    $('#progress').hidden = true;
    if (!blob) return showError('PNG encoding failed — try a smaller Detail/Tile size.');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'mosaic.png';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }, 'image/png');
};
