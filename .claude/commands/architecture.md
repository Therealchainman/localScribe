Describe the architecture of the Local Scribe web application. Use the context below — do not re-read the files unless asked for more detail.

---

## High-level overview

Local Scribe is a **single-page, privacy-first audio transcription tool**. The user records audio directly in the browser (or uploads a file), optionally chooses the Whisper model for the current page session, sends the audio to a local Django server, and gets a transcript back — all without any third-party cloud services. Audio is written to a temporary file only for the duration of transcription, and transcript data plus the currently selected model live only in browser memory; closing or refreshing the tab discards them.

---

## Stack

| Layer | Technology |
|---|---|
| Backend framework | Django 5.x (Python) |
| Transcription engine | OpenAI Whisper (`large` model by default) |
| Frontend | Vanilla JS + Django templates (no framework) |
| Styling | Plain CSS (`styles.css`) |

---

## Django project layout

```
transcribe_project/   ← Django project config (settings, root URLs, WSGI)
transcriber/          ← single Django app containing all app logic
  views.py            ← all request handlers
  services.py         ← Whisper model loading and transcription
  urls.py             ← app-level URL routing
  forms.py            ← AudioUploadForm (server-side file validation only)
  templates/          ← base.html + record.html (SPA shell)
  static/             ← styles.css + recorder.js
```

---

## URL routes

| Method | Path | Purpose |
|---|---|---|
| GET | `/` | Main SPA (Record tab) |
| GET | `/upload/` | Main SPA (Upload tab pre-selected) |
| POST | `/api/upload/` | Receive any audio file or recorded blob → transcribe |

---

## Transcription service (`services.py`)

Whisper model selection is request-driven. The page defaults to the configured `WHISPER_MODEL_SIZE`, but the user can override it from the header dropdown for the current page session only. On the server, one Whisper model instance is kept in memory at a time and swapped if a request asks for a different size:

```python
_model = None
_model_size = None
_lock  = threading.Lock()

def get_model(model_size):
    if _model is None or _model_size != model_size:
        with _lock:
            if _model is None or _model_size != model_size:
                _model = whisper.load_model(model_size)
                _model_size = model_size
    return _model
```

`WHISPER_MODEL_SIZE` defaults to `"large"` in settings and is used as the initial dropdown value on each page load. Transcription is synchronous — the HTTP request blocks until Whisper is done, which for the `large` model on long audio can take a minute or more.

---

## Frontend SPA (`recorder.js`)

The UI is a single HTML page (`record.html`) with two tab panels — Record and Upload — controlled entirely in JavaScript without any page navigations.

**Key state variables:**
- `recordedBlob` / `recordedObjectURL` — in-memory audio from the MediaRecorder
- `uploadedFile` / `uploadedObjectURL` — file selected via the file input
- current model selector value — held only in the page DOM; resets to the default on reload
- `transcriptDownloadURL` — Blob URL for the generated ZIP download

**Key flows:**

1. **Record tab** — `MediaRecorder` captures mic audio (or tab audio, or both mixed via `AudioContext`). On "End Recording", chunks are assembled into a `Blob` and a local object URL is created for preview. "Upload & Transcribe" POSTs the blob plus the currently selected Whisper model to `/api/upload/`.

2. **Upload tab** — user selects a file; a local object URL is created immediately for preview. "Transcribe" POSTs the selected file plus the currently selected Whisper model to `/api/upload/`.

3. **Loading state** — both panels are hidden, tabs are disabled, a spinner + elapsed timer + audio player are shown so the user can listen while waiting.

4. **Result state** — transcript text, audio player, copy button, and a Blob-backed ZIP download link are shown. The ZIP always contains `audio.<ext>` and `transcription.txt`. "Record Another" / "Transcribe Another" resets all state and returns to the appropriate tab.

Audio and transcript are never pushed back to the user's browser from the server after the initial JSON response — everything is held as object URLs in JS memory.

---

## Settings of note

- `WHISPER_MODEL_SIZE = 'large'` — can be changed to `tiny`/`base`/`small`/`medium` for speed/accuracy tradeoff
- `DATA_UPLOAD_MAX_MEMORY_SIZE = 104857600` — 100 MB upload cap
- No database, media storage, auth, sessions, or caching middleware — intentionally minimal for local use
