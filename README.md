# Doc-a-Pod

Turn a research paper into a two-host audio conversation. Maya explains; Leo asks. Upload a PDF, text file, or Markdown paper, then listen, download the WAV, and read the script alongside it. Past episodes stay in a local library.

One responsive, installable web app for a laptop browser and iPhone Safari. No accounts, payments, or cloud hosting. The default path uses your existing Ollama installation and local Kokoro voices, with no paid key.

## Start on the Mac mini

Requirements: Node.js 22.13+ (Node 22 LTS recommended), npm, and Ollama running with `qwen3.5:9b`. The app does not install or download an Ollama model automatically.

```sh
cd doc-a-pod
npm ci
cp .env.example .env
npm start
```

Open **http://localhost:3000**. Upload a paper and choose **Create podcast**. Leave the terminal running. The first Kokoro recording downloads the quantized ONNX model from Hugging Face into `.cache/`; later recordings reuse it. Generation may take several minutes. Scripts appear before recording finishes, and you can leave and reopen the page while the Mac works.

Check `ollama list` if script generation fails. Use `OLLAMA_MODEL=qwen3.8:27b` in `.env` to select that already-installed model instead; the 9B default is lighter. Start the existing Ollama app/service if needed. Do not download another multi-GB model on a disk-constrained machine just to try this app. See the [Ollama generate API](https://docs.ollama.com/api/generate).

Keep the Mac awake while recording or streaming. On macOS, `caffeinate -i npm start` runs the app while inhibiting idle system sleep; Control-C stops it. A stopped/restarted app marks unfinished jobs as failed and offers Retry. Ready episodes survive restarts.

### Disk and runtime

No Python, PyTorch, ffmpeg, database server, or build step is needed. Kokoro uses ONNX Runtime on CPU with `dtype: q8`. On the development Mac, installed Node dependencies occupied approximately 473 MB and the downloaded model cache 88 MB; allow at least 1 GB for installation, caches, and initial recordings. Sizes vary by platform and dependency version. Audio is mono 24 kHz, 16-bit PCM WAV, about 2.9 MB/minute. Only one generation worker runs at a time; the queue accepts up to three episodes.

The app rejects new work below 300 MB free disk space. Delete old episodes in the library to reclaim their source, script, and audio. `.cache/` can be removed with the app stopped to reclaim model space; the next Kokoro run downloads it again. The existing Ollama models are managed separately and are never removed by this app.

## Open on an iPhone

### Same Wi-Fi

1. Start the app on the Mac. It listens on `0.0.0.0:3000` by default.
2. Find the Mac's local IP in System Settings → Network, or run `ipconfig getifaddr en0` if Wi-Fi uses `en0`.
3. In iPhone Safari, open `http://YOUR-MAC-IP:3000`. Allow incoming Node connections if macOS asks. Both devices must be on the same non-isolated network.
4. Upload through Safari's file picker. Tap Play to start audio; playback never relies on autoplay. Downloads can be saved to Files.

Plain LAN HTTP supports the app, uploads, and playback. A service worker requires HTTPS (except localhost); use the HTTPS option below for the full installable experience. A phone cannot use the Mac's `localhost` address.

### Private HTTPS with Tailscale

With the Mac and iPhone already in the same Tailscale network, use [Tailscale Serve](https://tailscale.com/docs/reference/tailscale-cli/serve) to proxy the local app privately:

```sh
tailscale serve --bg http://127.0.0.1:3000
```

Follow Tailscale's HTTPS setup prompt if required. Open the exact HTTPS URL it prints on iPhone Safari, then **Share → Add to Home Screen**. This is private Serve, not public Funnel. If Serve already routes another app on this Mac, arrange a separate allowed HTTPS port or route before changing it. To limit direct LAN access when using only this proxy, set `HOST=127.0.0.1` in `.env` and restart the app. Tailscale on the phone must remain connected.

The service worker caches only the app shell. It does not cache papers, scripts, or recordings. The library requires a connection to the running Mac. For offline listening, download an episode into Files first. Actual iPhone Safari hardware playback and installation should be checked on the owner's phone; desktop mobile emulation is not equivalent.

## Providers and settings

Selections in the upload form apply to that episode. Environment variables set defaults. Restart after editing `.env`.

| Setting | Default | Purpose |
| --- | --- | --- |
| `HOST`, `PORT` | `0.0.0.0`, `3000` | App listener |
| `ALLOWED_HOSTS` | unset | Extra comma-separated host names the API accepts; localhost, IP addresses, `*.local`, and `*.ts.net` are always allowed |
| `DATA_DIR` | `./data` | Local source files, JSON metadata, and WAVs |
| `MODEL_CACHE_DIR` | `./.cache` | Downloaded ONNX model cache |
| `SCRIPT_PROVIDER` | `ollama` | `ollama` or `demo` |
| `OLLAMA_URL` | `http://127.0.0.1:11434` | Server-side model endpoint |
| `OLLAMA_MODEL` | `qwen3.5:9b` | Existing local model name |
| `VOICE_PROVIDER` | `kokoro` | `kokoro`, `elevenlabs`, or `demo` |
| `ELEVENLABS_API_KEY` | unset | Optional secret, server environment only |
| `ELEVENLABS_VOICE_MAYA` | unset | Maya's ElevenLabs voice ID |
| `ELEVENLABS_VOICE_LEO` | unset | A different ElevenLabs voice ID |
| `ELEVENLABS_MODEL` | `eleven_multilingual_v2` | ElevenLabs speech model |

**Offline excerpt preview** is deterministic and works without Ollama. It selects complete source sentences for each research topic and openly says when it cannot find one. It is a demonstration, not a substitute for an AI summary or scientific appraisal. It can be combined with Kokoro for real spoken excerpts. There is no silent provider fallback: local model errors appear with a retry action.

**Test tones** are an explicitly labeled, non-speech voice provider for testing the entire pipeline with no downloads or model inference:

```sh
SCRIPT_PROVIDER=demo VOICE_PROVIDER=demo npm start
```

**ElevenLabs** is disabled unless a key and two different voice IDs are configured. Put them in your shell environment or ignored `.env`, never in source control. The browser receives only an availability flag, never the key. Selecting ElevenLabs sends dialogue text to that service and may consume paid quota. It requests `pcm_24000` and wraps the stitched PCM as one WAV. Key, voice, quota, or plan errors are shown without exposing provider response bodies. See [ElevenLabs speech API and format availability](https://elevenlabs.io/docs/api-reference/text-to-speech/convert). No live paid API calls are part of tests.

A future hosted script adapter belongs in `writeScript` in `src/script.js`: implement the same `{ lines: [{ host, topic, text }] }` output, run `validateScript` before saving or speaking it, and add the provider to the server allowlist and upload form. Credentials must remain server-side, with explicit UI notice before any source leaves the Mac. No hosted script endpoint is enabled in v1.

## Limits and research fidelity

- **Dialogue: at most 10 pages.** A page is 500 whitespace-separated words, **including host labels**; the hard cap is 5,000 words. Page count rounds up. The model targets a shorter 600–1,000-word conversation, not the maximum.
- **Source: one file, at most 20 MB, 100 PDF pages, and 500,000 extracted characters.** UTF-8 text/Markdown uses the same size/character limits. Invalid, encrypted, image-only, or almost-empty PDFs produce clear errors. OCR is not included.
- Scripts alternate named hosts, cover question/method/findings/limits, and require complete sentences. Turns are bounded to 100 words. Overlong or invalid model output is rewritten once, then fails visibly rather than being truncated.
- Each model prompt carries at most 24,000 source characters, leaving context room for instructions and the script. Longer sources are processed in full through sequential section summaries (summarized again if the notes are still too long) before the final conversation. This takes longer and can lose nuance; a notice appears with the script. Scientific equations, tables, references, and multi-column PDF reading order can extract imperfectly. Compare the script to the original before relying on it.
- Kokoro receives small word-boundary chunks to avoid its tokenizer's input truncation. Each script line has a timestamp for “Listen from here.” Recordings have a one-hour safety limit.
- English dialogue and English voices are the v1 target. Generated summaries can be wrong. Research documents are treated as source data in the prompts, not executable instructions.

## Storage and local access

`data/<episode-id>/` holds the source, atomically written JSON metadata, and one WAV. It is a single-process local store; do not run two app processes against the same `DATA_DIR`. Source files are not served as static files. A failed episode retains its source for retry and may retain a completed script. Retry starts generation again; retrying ElevenLabs may incur additional charges. Delete removes the entire episode directory.

There are intentionally no accounts. Anyone who can reach this app's address can read or delete episodes, upload papers, or use configured providers. Use a trusted LAN or restricted Tailscale network; do not expose the port publicly. Cross-origin mutation requests and API requests for unrecognized host names (a DNS-rebinding defense) are rejected, but this is not authentication. There is no analytics. Source text stays local with the default providers; Kokoro's initial download contacts Hugging Face without sending paper text. Back up `DATA_DIR` if you want to preserve the library.

## Voice licenses

- [Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M) and the [ONNX conversion](https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX) publish Apache-2.0 model weights. Maya uses `af_heart`; Leo uses `am_michael`. Review the upstream model card and voice provenance before redistributing models or using voices commercially.
- `kokoro-js` and Transformers.js are Apache-2.0. The phonemizer dependency includes eSpeak NG; its GPL license and notices apply to that component. Installed dependencies retain their own licenses. This app does not check model weights into Git.
- ElevenLabs is a hosted proprietary service; voice access, usage, and commercial rights depend on your account, selected voices, and current plan/terms.

## Development and verification

```sh
npm run dev       # restart on server edits
npm run check     # syntax checks and all tests
npm test          # Node's test runner, no paid service or model downloads
```

CI uses Node 22 and runs the same check. Tests execute real selectable-text PDF extraction, upload/page/text rejection, exact 5,000-word boundaries, script shape, full-source chunk coverage, both script switches, distinct voice routing, ElevenLabs secret handling, WAV stitching/timestamps, HTTP upload-to-library flow, ranged playback, retry/deletion, and restart recovery. Kokoro and Ollama adapters use mocks in CI; demo tones support deterministic end-to-end coverage.

Implementation: `src/extract.js` reads sources; `script.js` writes and validates dialogue; `voice.js` records and joins PCM; `worker.js` runs expensive work away from HTTP; `app.js` serves the API and PWA; `store.js` persists the library. The frontend is plain HTML/CSS/JavaScript with native audio controls.

### Local smoke-test evidence

On the development Mac, a real PDF passed through the installed `qwen3.5:9b` and quantized Kokoro into a 477-word, 26-turn script and a 216.625-second WAV. Chrome played the resulting audio and rendered all script turns; the 390-pixel viewport had no horizontal overflow. Desktop layout was also inspected. The browser automation tool returned stale element references even after a fresh snapshot, so the upload itself was exercised via multipart HTTP and the completed episode was verified in the browser. Native iPhone Safari and live ElevenLabs remain untested; no paid API request was made.
