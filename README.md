# Mixtape Maker

Make cassette mixtapes on your Umbrel, with the 90s rules: two sides, a fixed amount of tape, and a digital cassette you can send to someone.

## Features

- **Side A / Side B with real limits.** Pick a C-60, C-90, C-120 or C-180. Each side has a live counter, and a song that won't fit is refused.
- **Library from your own files.** Scans your Umbrel music folder (MP3, M4A, AAC, FLAC, OGG, Opus, WAV) and reads durations from file metadata. Results are cached so rescans are quick.
- **Preview** any song in the browser before you add it.
- **Tape shelf.** Every tape is saved with its title, to/from, note and label style. Reopen and edit any time.
- **Share the cassette.** Each tape can be sent as a single `.html` file: the recipient sees a sleeve, clicks it, the cassette slides out and the track list opens. It works offline in any browser or phone. Download it and send it any way you like, or email it straight from the app (cassette picture and track list in the message, interactive file attached).
- **Picture and music.** Save the cassette as a PNG, or download a ZIP with the songs in tape order (Side A and Side B folders), `playlist.m3u`, `tracklist.txt` and the cassette picture.

## Layout

```
umbrel-app.yml        Umbrel app manifest
docker-compose.yml    Umbrel service definition
app/                  The app (Node + Express, vanilla JS frontend)
```

Music is mounted read-only from `${UMBREL_ROOT}/data/storage/downloads`. Tapes, the library cache and (if you set up email) the SMTP login live in the app's data directory.

## Run it locally

```bash
cd app
npm install
MUSIC_DIR=/path/to/music DATA_DIR=./data PORT=3000 npm start
# open http://localhost:3000
```

## Build the image

```bash
cd app
docker build -t ghcr.io/patriotcrypto/mixtape-maker:0.2.0 .
docker push ghcr.io/patriotcrypto/mixtape-maker:0.2.0
```

Then pin the image by digest in `docker-compose.yml` (`image: ...:0.2.0@sha256:...`), as Umbrel recommends.

## Before publishing to a community app store

- Umbrel community stores require the app id to be prefixed with your store id (for example `yourstore-mixtape-maker`). The id is already `patriot-mixtape-maker`, matching your Patriot Apps store.
- Add a 256x256 SVG icon and 3 to 5 gallery screenshots to the store.
- Check the music folder path against your Umbrel version.

## API

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/library` | Tracks and scan status |
| POST | `/api/library/rescan` | Rescan the music folder |
| GET | `/api/stream/:id` | Stream a track (range requests supported) |
| GET/POST | `/api/tapes` | List or create tapes |
| PUT/DELETE | `/api/tapes/:id` | Update or delete a tape |
| GET | `/api/tapes/:id/m3u` | M3U (paths relative to the music folder, for players on the same machine) |
| GET/PUT | `/api/settings/mail` | Read or save SMTP settings (password is never returned) |
| POST | `/api/tapes/:id/email` | Email the cassette to 1 to 5 recipients |
| GET | `/api/tapes/:id/zip` | Download songs, playlist, track list and cassette picture |

## Credits

Handwriting on the cassette label and the share page uses [Caveat](https://github.com/googlefonts/caveat), bundled under the SIL Open Font License 1.1.

The cassette shell image (`app/public/img/cassette-base.webp`) was generated with Canva's image generator. Title, names, note and printed details are drawn over its blank label in code. If the file is missing, the app falls back to a drawn cassette.

## License

MIT
