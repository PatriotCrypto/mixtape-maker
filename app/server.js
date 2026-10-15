'use strict';

const express = require('express');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const yazl = require('yazl');
const nodemailer = require('nodemailer');

const PORT = parseInt(process.env.PORT || '3000', 10);
const MUSIC_DIR = path.resolve(process.env.MUSIC_DIR || '/music');
const DATA_DIR = path.resolve(process.env.DATA_DIR || '/data');
const TAPES_FILE = path.join(DATA_DIR, 'tapes.json');
const IMG_DIR = path.join(DATA_DIR, 'images');
const MAIL_FILE = path.join(DATA_DIR, 'mail.json');
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
fs.mkdirSync(IMG_DIR, { recursive: true });

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
const smallJson = express.json({ limit: '1mb' });
app.use((req, res, next) => (req.path.endsWith('/email') ? next() : smallJson(req, res, next)));
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
  fsp.unlink(imgPath(req.params.id)).catch(() => {});
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

const safeName = (str, fallback) =>
  String(str || '').replace(/[\\/:*?"<>|\x00-\x1f]+/g, '').replace(/\s+/g, ' ').trim().slice(0, 80) || fallback;
const imgPath = (id) => path.join(IMG_DIR, id.replace(/[^\w-]/g, '') + '.png');

// Store the PNG of the digital cassette (rendered by the browser) so it can go in the ZIP.
app.put('/api/tapes/:id/image', express.raw({ type: 'image/png', limit: '20mb' }), async (req, res) => {
  const tapes = await loadTapes();
  if (!tapes.some((t) => t.id === req.params.id)) return res.status(404).json({ error: 'not found' });
  const buf = req.body;
  if (!Buffer.isBuffer(buf) || buf.length < 8 || buf.readUInt32BE(0) !== 0x89504e47) {
    return res.status(400).json({ error: 'expected a PNG' });
  }
  await fsp.writeFile(imgPath(req.params.id), buf);
  res.json({ ok: true });
});

// A whole tape as a ZIP: the songs in tape order, a playlist, a track list and the cassette picture.
app.get('/api/tapes/:id/zip', async (req, res) => {
  const tapes = await loadTapes();
  const tape = tapes.find((t) => t.id === req.params.id);
  if (!tape) return res.status(404).end();
  const byId = new Map(library.tracks.map((t) => [t.id, t]));
  const zip = new yazl.ZipFile();
  const root = safeName(tape.title, 'Mixtape');
  const m3u = ['#EXTM3U', `#PLAYLIST:${tape.title}`];
  const txt = [tape.title, `C-${tape.lengthMin * 2}`];
  if (tape.to) txt.push(`To: ${tape.to}`);
  if (tape.from) txt.push(`From: ${tape.from}`);
  if (tape.note) txt.push('', tape.note);
  const fmt = (n) => `${Math.floor(n / 60)}:${String(Math.round(n % 60)).padStart(2, '0')}`;
  for (const [label, ids] of [['A', tape.sideA], ['B', tape.sideB]]) {
    const tracks = ids.map((id) => byId.get(id)).filter(Boolean);
    txt.push('', `SIDE ${label}  (${fmt(tracks.reduce((s, t) => s + t.duration, 0))})`);
    m3u.push(`# Side ${label}`);
    tracks.forEach((t, i) => {
      const full = path.join(MUSIC_DIR, t.rel);
      if (!full.startsWith(MUSIC_DIR + path.sep)) return;
      const name = `${String(i + 1).padStart(2, '0')} - ${safeName(`${t.artist} - ${t.title}`, 'track')}${path.extname(full).toLowerCase()}`;
      const inZip = `${root}/Side ${label}/${name}`;
      zip.addFile(full, inZip, { compress: false });
      m3u.push(`#EXTINF:${t.duration},${t.artist} - ${t.title}`, `Side ${label}/${name}`);
      txt.push(`${String(i + 1).padStart(2, '0')}. ${t.artist} - ${t.title}  [${fmt(t.duration)}]`);
    });
  }
  zip.addBuffer(Buffer.from(m3u.join('\n') + '\n'), `${root}/playlist.m3u`);
  zip.addBuffer(Buffer.from(txt.join('\n') + '\n'), `${root}/tracklist.txt`);
  try {
    zip.addBuffer(await fsp.readFile(imgPath(tape.id)), `${root}/cassette.png`);
  } catch {}
  res.set({
    'Content-Type': 'application/zip',
    'Content-Disposition': `attachment; filename="${root}.zip"`,
  });
  zip.outputStream.pipe(res);
  zip.end();
});

// ---------- email ----------
// SMTP details are entered once in the app and kept in the app's data folder (mode 600).
const esc = (x) => String(x ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const MAIL_MAX_AUDIO = 15 * 1024 * 1024; // most mail providers cap a message near 25 MB after encoding

// Files for a tape's songs in tape order, with sizes. Used by the email option and the size check.
async function tapeAudio(tape) {
  const byId = new Map(library.tracks.map((t) => [t.id, t]));
  const out = [];
  let bytes = 0;
  for (const [label, ids] of [['A', tape.sideA], ['B', tape.sideB]]) {
    let n = 0;
    for (const id of ids) {
      const t = byId.get(id);
      if (!t) continue;
      const full = path.join(MUSIC_DIR, t.rel);
      if (!full.startsWith(MUSIC_DIR + path.sep)) continue;
      let size = 0;
      try {
        size = (await fsp.stat(full)).size;
      } catch {
        continue;
      }
      n++;
      bytes += size;
      out.push({ path: full, size, filename: `${label}${String(n).padStart(2, '0')} - ${safeName(`${t.artist} - ${t.title}`, 'track')}${path.extname(full).toLowerCase()}` });
    }
  }
  return { files: out, bytes };
}

app.get('/api/tapes/:id/audio-size', async (req, res) => {
  const tapes = await loadTapes();
  const tape = tapes.find((t) => t.id === req.params.id);
  if (!tape) return res.status(404).json({ error: 'not found' });
  const a = await tapeAudio(tape);
  res.json({ count: a.files.length, bytes: a.bytes, max: MAIL_MAX_AUDIO });
});

const EMAIL_RE = /^[^\s@<>",;]+@[^\s@<>",;]+\.[^\s@<>",;]+$/;

app.get('/api/settings/mail', async (_req, res) => {
  const m = await readJson(MAIL_FILE, {});
  res.json({ host: m.host || '', port: m.port || 587, user: m.user || '', fromName: m.fromName || '', fromEmail: m.fromEmail || '', hasPass: !!m.pass, ready: !!(m.host && m.user && m.pass) });
});

app.put('/api/settings/mail', async (req, res) => {
  const old = await readJson(MAIL_FILE, {});
  const b = req.body || {};
  const next = {
    host: String(b.host || '').trim().slice(0, 200),
    port: Math.min(65535, Math.max(1, parseInt(b.port, 10) || 587)),
    user: String(b.user || '').trim().slice(0, 200),
    pass: b.pass ? String(b.pass).slice(0, 300) : old.pass || '',
    fromName: String(b.fromName || '').trim().slice(0, 80),
    fromEmail: String(b.fromEmail || '').trim().slice(0, 200),
  };
  await fsp.writeFile(MAIL_FILE, JSON.stringify(next, null, 2), { mode: 0o600 });
  res.json({ ok: true, ready: !!(next.host && next.user && next.pass) });
});

app.post('/api/tapes/:id/email', express.json({ limit: '20mb' }), async (req, res) => {
  const tapes = await loadTapes();
  const tape = tapes.find((t) => t.id === req.params.id);
  if (!tape) return res.status(404).json({ error: 'Tape not found. Save it first.' });
  const m = await readJson(MAIL_FILE, {});
  if (!(m.host && m.user && m.pass)) return res.status(400).json({ error: 'Email is not set up yet.' });
  const b = req.body || {};
  const to = String(b.to || '').split(/[,;\s]+/).filter(Boolean);
  if (!to.length || to.length > 5 || !to.every((x) => EMAIL_RE.test(x))) {
    return res.status(400).json({ error: 'Enter 1 to 5 valid email addresses.' });
  }
  const html = typeof b.html === 'string' ? b.html : '';
  const png = typeof b.png === 'string' ? Buffer.from(b.png, 'base64') : null;
  if (!html || !png || png.length < 8 || png.readUInt32BE(0) !== 0x89504e47) {
    return res.status(400).json({ error: 'The cassette was not attached correctly. Try again.' });
  }
  let audio = { files: [], bytes: 0 };
  if (b.includeMusic) {
    audio = await tapeAudio(tape);
    if (!audio.files.length) return res.status(400).json({ error: 'No songs were found to attach.' });
    if (audio.bytes > MAIL_MAX_AUDIO) {
      return res.status(400).json({ error: `The songs are ${(audio.bytes / 1048576).toFixed(1)} MB, too big to attach (limit ${MAIL_MAX_AUDIO / 1048576} MB). Send without the songs, or use Download with music (.zip).` });
    }
  }
  const byId = new Map(library.tracks.map((t) => [t.id, t]));
  const sideRows = (label, ids) => {
    const rows = ids.map((id) => byId.get(id)).filter(Boolean);
    const secs = rows.reduce((n, t) => n + t.duration, 0);
    const f = (n) => `${Math.floor(n / 60)}:${String(Math.round(n % 60)).padStart(2, '0')}`;
    return {
      text: [`SIDE ${label} (${f(secs)})`, ...rows.map((t, i) => `${i + 1}. ${t.artist} - ${t.title}`)].join('\n'),
      html: `<p style="margin:14px 0 4px;font-weight:700;letter-spacing:1px">SIDE ${label} <span style="font-weight:400;color:#777">${f(secs)}</span></p><ol style="margin:0;padding-left:22px;line-height:1.6">${rows.map((t) => `<li>${esc(t.artist)} &ndash; ${esc(t.title)}</li>`).join('')}</ol>`,
    };
  };
  const A = sideRows('A', tape.sideA);
  const B = sideRows('B', tape.sideB);
  const note = String(b.message || '').slice(0, 1000);
  const who = tape.from || m.fromName || 'Someone';
  const mailHtml = `<div style="font-family:Helvetica,Arial,sans-serif;max-width:560px;margin:auto;color:#222">
<p style="font-size:18px">${esc(who)} made you a mixtape.</p>
${note ? `<p style="white-space:pre-wrap">${esc(note)}</p>` : ''}
<img src="cid:cassette" alt="${esc(tape.title)}" style="width:100%;max-width:520px;height:auto;display:block;margin:16px 0">
<p style="color:#555"><b>To open the cassette:</b> tap the attached <b>${esc(safeName(tape.title, 'mixtape'))}.html</b> file, then tap the cassette case. If it only shows a plain preview, save the file and open it with Safari or Chrome.</p>
${audio.files.length ? `<p style="color:#555"><b>The songs are attached</b> (${audio.files.length} files, named by side and track number).</p>` : ''}
${A.html}${B.html}
</div>`;
  const mailText = `${who} made you a mixtape: ${tape.title}\n\n${note ? note + '\n\n' : ''}To open the cassette: tap the attached .html file, then tap the cassette case. If it only shows a plain preview, save the file and open it with Safari or Chrome.\n${audio.files.length ? `The songs are attached (${audio.files.length} files, named by side and track number).\n` : ''}\n\n${A.text}\n\n${B.text}\n`;
  const fromEmail = m.fromEmail || m.user;
  try {
    const transport = nodemailer.createTransport({
      host: m.host,
      port: m.port,
      secure: Number(m.port) === 465,
      auth: { user: m.user, pass: m.pass },
      connectionTimeout: 15000,
      greetingTimeout: 15000,
      socketTimeout: 30000,
    });
    await transport.sendMail({
      from: m.fromName ? { name: m.fromName, address: fromEmail } : fromEmail,
      to,
      subject: `${who} made you a mixtape: ${tape.title}`,
      text: mailText,
      html: mailHtml,
      attachments: [
        { filename: 'cassette.png', content: png, cid: 'cassette', contentType: 'image/png', contentDisposition: 'inline' },
        { filename: `${safeName(tape.title, 'mixtape')}.html`, content: html, contentType: 'text/html; charset=utf-8' },
        ...audio.files.map((f) => ({ filename: f.filename, path: f.path })),
      ],
    });
    res.json({ ok: true });
  } catch (e) {
    console.error('mail failed:', e.message);
    res.status(502).json({ error: `Could not send: ${e.message}` });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Mixtape Maker listening on :${PORT} (music: ${MUSIC_DIR}, data: ${DATA_DIR})`);
  scanLibrary();
});
