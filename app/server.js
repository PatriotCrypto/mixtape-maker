'use strict';

const express = require('express');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const PORT = parseInt(process.env.PORT || '3000', 10);
const MUSIC_DIR = path.resolve(process.env.MUSIC_DIR || '/music');
const DATA_DIR = path.resolve(process.env.DATA_DIR || '/data');
const TAPES_FILE = path.join(DATA_DIR, 'tapes.json');
const CACHE_FILE = path.join(DATA_DIR, 'library-cache.json');
const AUDIO_EXT = new Set(['.mp3', '.m4a', '.aac', '.flac', '.ogg', '.opus', '.wav']);
const MIME = {
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.flac': 'audio/flac',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.wav': 'audio/wav',
};
const TAPE_LENGTHS = [30, 45, 60, 90]; // minutes per side

let mm = null; // music-metadata is ESM-friendly via dynamic import
async function loadMM() {
  if (!mm) mm = await import('music-metadata');
  return mm;
}

fs.mkdirSync(DATA_DIR, { recursive: true });

// ---------- helpers ----------
const idFor = (rel) => crypto.createHash('sha1').update(rel).digest('hex').slice(0, 16);

async function walk(dir, out = []) {
  let entries;
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) await walk(full, out);
    else if (AUDIO_EXT.has(path.extname(e.name).toLowerCase())) out.push(full);
  }
  return out;
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fsp.readFile(file, 'utf8'));
  } catch {
    return fallback;
  }
}

async function writeJson(file, data) {
  const tmp = file + '.tmp';
  await fsp.writeFile(tmp, JSON.stringify(data, null, 2));
  await fsp.rename(tmp, file);
}

// ---------- library ----------
let library = { tracks: [], scannedAt: null, scanning: false, progress: 0, total: 0 };

async function scanLibrary() {
  if (library.scanning) return;
  library.scanning = true;
  library.progress = 0;
  try {
    const { parseFile } = await loadMM();
    const cache = await readJson(CACHE_FILE, {});
    const files = await walk(MUSIC_DIR);
    library.total = files.length;
    const next = {};
    const tracks = [];
    for (const file of files) {
      const rel = path.relative(MUSIC_DIR, file);
      const st = await fsp.stat(file);
      const key = `${rel}|${st.size}|${Math.floor(st.mtimeMs)}`;
      let t = cache[key];
      if (!t) {
        try {
          const meta = await parseFile(file, { duration: true, skipCovers: true });
          t = {
            id: idFor(rel),
            rel,
            title: meta.common.title || path.basename(file, path.extname(file)),
            artist: meta.common.artist || meta.common.albumartist || 'Unknown Artist',
            album: meta.common.album || '',
            year: meta.common.year || null,
            duration: Math.round(meta.format.duration || 0),
          };
        } catch {
          t = {
            id: idFor(rel),
            rel,
            title: path.basename(file, path.extname(file)),
            artist: 'Unknown Artist',
            album: '',
            year: null,
            duration: 0,
          };
        }
      }
      next[key] = t;
      tracks.push(t);
      library.progress++;
    }
    tracks.sort((a, b) =>
      (a.artist + a.album + a.title).localeCompare(b.artist + b.album + b.title, undefined, {
        sensitivity: 'base',
      })
    );
    library.tracks = tracks;
    library.scannedAt = new Date().toISOString();
    await writeJson(CACHE_FILE, next);
  } catch (err) {
    console.error('scan failed:', err);
  } finally {
    library.scanning = false;
  }
}

// ---------- tapes ----------
async function loadTapes() {
  return readJson(TAPES_FILE, []);
}

function sanitizeTape(input, existing = {}) {
  const lengthMin = TAPE_LENGTHS.includes(Number(input.lengthMin))
    ? Number(input.lengthMin)
    : existing.lengthMin || 45;
  const ids = (arr) =>
    Array.isArray(arr) ? arr.filter((x) => typeof x === 'string').slice(0, 200) : [];
  return {
    id: existing.id || crypto.randomUUID(),
    title: String(input.title ?? existing.title ?? 'Untitled Mix').slice(0, 80),
    to: String(input.to ?? existing.to ?? '').slice(0, 60),
    from: String(input.from ?? existing.from ?? '').slice(0, 60),
    note: String(input.note ?? existing.note ?? '').slice(0, 300),
    style: ['red', 'green', 'blue', 'white'].includes(input.style)
      ? input.style
      : existing.style || 'red',
    lengthMin,
    sideA: ids(input.sideA ?? existing.sideA),
    sideB: ids(input.sideB ?? existing.sideB),
    createdAt: existing.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

// ---------- app ----------
const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.get('/api/library', (_req, res) => {
  res.json({
    tracks: library.tracks,
    scannedAt: library.scannedAt,
    scanning: library.scanning,
    progress: library.progress,
    total: library.total,
    musicDir: MUSIC_DIR,
  });
});

app.post('/api/library/rescan', (_req, res) => {
  scanLibrary();
  res.json({ started: true });
});

app.get('/api/stream/:id', (req, res) => {
  const track = library.tracks.find((t) => t.id === req.params.id);
  if (!track) return res.status(404).end();
  const full = path.join(MUSIC_DIR, track.rel);
  if (!full.startsWith(MUSIC_DIR + path.sep)) return res.status(400).end();
  const ext = path.extname(full).toLowerCase();
  res.type(MIME[ext] || 'application/octet-stream');
  res.sendFile(full, { acceptRanges: true });
});

app.get('/api/tapes', async (_req, res) => res.json(await loadTapes()));

app.post('/api/tapes', async (req, res) => {
  const tapes = await loadTapes();
  const tape = sanitizeTape(req.body || {});
  tapes.push(tape);
  await writeJson(TAPES_FILE, tapes);
  res.status(201).json(tape);
});

app.put('/api/tapes/:id', async (req, res) => {
  const tapes = await loadTapes();
  const i = tapes.findIndex((t) => t.id === req.params.id);
  if (i < 0) return res.status(404).json({ error: 'not found' });
  tapes[i] = sanitizeTape(req.body || {}, tapes[i]);
  await writeJson(TAPES_FILE, tapes);
  res.json(tapes[i]);
});

app.delete('/api/tapes/:id', async (req, res) => {
  const tapes = await loadTapes();
  const next = tapes.filter((t) => t.id !== req.params.id);
  if (next.length === tapes.length) return res.status(404).json({ error: 'not found' });
  await writeJson(TAPES_FILE, next);
  res.status(204).end();
});

// Export a tape as an M3U playlist (Side A then Side B), paths relative to the music folder
// so it can be dropped next to the music for iPod Sync or any other player.
app.get('/api/tapes/:id/m3u', async (req, res) => {
  const tapes = await loadTapes();
  const tape = tapes.find((t) => t.id === req.params.id);
  if (!tape) return res.status(404).end();
  const byId = new Map(library.tracks.map((t) => [t.id, t]));
  const lines = ['#EXTM3U', `#PLAYLIST:${tape.title}`];
  for (const [label, ids] of [['A', tape.sideA], ['B', tape.sideB]]) {
    lines.push(`# Side ${label}`);
    for (const id of ids) {
      const t = byId.get(id);
      if (!t) continue;
      lines.push(`#EXTINF:${t.duration},${t.artist} - ${t.title}`);
      lines.push(t.rel.split(path.sep).join('/'));
    }
  }
  const safe = tape.title.replace(/[^\w\- ]+/g, '').trim() || 'mixtape';
  res.set({
    'Content-Type': 'audio/x-mpegurl; charset=utf-8',
    'Content-Disposition': `attachment; filename="${safe}.m3u"`,
  });
  res.send(lines.join('\n') + '\n');
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Mixtape Maker listening on :${PORT} (music: ${MUSIC_DIR}, data: ${DATA_DIR})`);
  scanLibrary();
});
