Describe the architecture of the Local Scribe web application. Use the context below — do not re-read the files unless asked for more detail.

---

## High-level overview

Local Scribe is a **single-page, privacy-first audio transcription tool**. The user records audio directly in the browser (or uploads a file), the audio is sent to a local Django server, transcribed on-device using OpenAI Whisper, and the transcript is returned and displayed — all without any third-party cloud services. Audio is written to a temporary file only for the duration of transcription, and transcript data lives in the browser session; closing or refreshing the tab discards it.

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

Whisper is loaded **once** at process startup using a thread-safe double-checked locking pattern:

```python
_model = None
_lock  = threading.Lock()

def get_model():
    if _model is None:
        with _lock:
            if _model is None:
                _model = whisper.load_model(settings.WHISPER_MODEL_SIZE)
    return _model
```

`WHISPER_MODEL_SIZE` defaults to `"large"` in settings. The model is kept in memory for the lifetime of the server process, so subsequent transcriptions are fast (no reload overhead). Transcription is synchronous — the HTTP request blocks until Whisper is done, which for the `large` model on long audio can take a minute or more.

---

## Frontend SPA (`recorder.js`)

The UI is a single HTML page (`record.html`) with two tab panels — Record and Upload — controlled entirely in JavaScript without any page navigations.

**Key state variables:**
- `recordedBlob` / `recordedObjectURL` — in-memory audio from the MediaRecorder
- `uploadedFile` / `uploadedObjectURL` — file selected via the file input
- `transcriptDownloadURL` — Blob URL for the generated ZIP download

**Key flows:**

1. **Record tab** — `MediaRecorder` captures mic audio (or tab audio, or both mixed via `AudioContext`). On "End Recording", chunks are assembled into a `Blob` and a local object URL is created for preview. "Upload & Transcribe" POSTs the blob to `/api/upload/`.

2. **Upload tab** — user selects a file; a local object URL is created immediately for preview. "Transcribe" POSTs the selected file to `/api/upload/`.

3. **Loading state** — both panels are hidden, tabs are disabled, a spinner + elapsed timer + audio player are shown so the user can listen while waiting.

4. **Result state** — transcript text, audio player, copy button, and a Blob-backed ZIP download link are shown. The ZIP always contains `audio.<ext>` and `transcription.txt`. "Record Another" / "Transcribe Another" resets all state and returns to the appropriate tab.

Audio and transcript are never pushed back to the user's browser from the server after the initial JSON response — everything is held as object URLs in JS memory.

---

## Settings of note

- `WHISPER_MODEL_SIZE = 'large'` — can be changed to `tiny`/`base`/`small`/`medium` for speed/accuracy tradeoff
- `DATA_UPLOAD_MAX_MEMORY_SIZE = 104857600` — 100 MB upload cap
- No database, media storage, auth, sessions, or caching middleware — intentionally minimal for local use
