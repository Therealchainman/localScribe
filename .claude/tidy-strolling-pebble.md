# Importal Transcribe — Implementation Plan

## Context
Build a web application from scratch that lets users upload M4A audio files and generates transcripts using local Whisper. The project directory is currently empty.

**Stack:** Django (full framework — views, templates, file handling, transcription logic), openai-whisper for local transcription.

---

## Project Structure

```
importal-transcribe/
├── .gitignore
├── requirements.txt
├── manage.py
├── transcribe_project/            # Django project package
│   ├── __init__.py
│   ├── settings.py
│   ├── urls.py
│   ├── wsgi.py
│   └── asgi.py
├── transcriber/                   # Django app
│   ├── __init__.py
│   ├── apps.py
│   ├── models.py                  # Transcript model
│   ├── forms.py                   # AudioUploadForm with M4A validation
│   ├── views.py                   # upload, result, download views
│   ├── urls.py                    # app-level URL routing
│   ├── services.py                # Whisper singleton + transcribe function
│   ├── templates/transcriber/
│   │   ├── base.html              # base layout
│   │   ├── upload.html            # upload form page
│   │   └── result.html            # transcript display + download
│   └── static/transcriber/css/
│       └── styles.css             # minimal styling
└── media/uploads/                 # uploaded M4A files (gitignored)
```

---

## Dependencies (`requirements.txt`)

```
django>=5.1,<6.0
openai-whisper>=20231117
```

**System prerequisite:** `ffmpeg` must be installed (`brew install ffmpeg`).

---

## Implementation Steps

### Step 1: Scaffolding
- Create `requirements.txt`, `.gitignore`
- Run `django-admin startproject transcribe_project .`
- Run `python manage.py startapp transcriber`

### Step 2: Settings (`transcribe_project/settings.py`)
- Add `transcriber` to `INSTALLED_APPS`
- Remove unused apps (auth, admin, sessions, messages) and their middleware
- Configure `MEDIA_URL = '/media/'` and `MEDIA_ROOT = BASE_DIR / 'media'`
- Add `WHISPER_MODEL_SIZE = 'base'` (configurable, ~140MB, good speed/accuracy)
- Set upload size limits: `DATA_UPLOAD_MAX_MEMORY_SIZE = 104857600` (100MB)

### Step 3: Transcript Model (`transcriber/models.py`)
```python
class Transcript(models.Model):
    audio_file = models.FileField(upload_to='uploads/')
    original_filename = models.CharField(max_length=255)
    transcript_text = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
```
- Gives stable URLs for result/download views
- Preserves transcription history
- Run `makemigrations` + `migrate`

### Step 4: Whisper Service (`transcriber/services.py`)
- Module-level lazy singleton with thread-safe double-checked locking
- `get_model()` — loads Whisper model on first call (not at startup, avoiding slow `manage.py` commands)
- `transcribe_audio(file_path) -> dict` — returns `{'text': ..., 'language': ...}`

### Step 5: Upload Form (`transcriber/forms.py`)
- `AudioUploadForm(forms.Form)` with a single `FileField`
- `clean_audio_file()` validates:
  - File extension must be `.m4a`
  - MIME type must be in `['audio/mp4', 'audio/x-m4a', 'audio/m4a', 'audio/aac']`

### Step 6: Views (`transcriber/views.py`)
- **`upload_view`** (GET/POST) — render form, on valid submit: save file via `Transcript.objects.create()`, run `transcribe_audio()` synchronously, save transcript text, redirect to result
- **`result_view`** — display transcript text with metadata
- **`download_view`** — return `HttpResponse` with `Content-Disposition: attachment` as `.txt` file

### Step 7: URL Routing
- `transcriber/urls.py`: `''` → upload, `'result/<int:pk>/'` → result, `'download/<int:pk>/'` → download
- `transcribe_project/urls.py`: include app URLs, serve media files in DEBUG mode

### Step 8: Templates
- **`base.html`** — HTML skeleton, CSS link, header with app title, content block
- **`upload.html`** — form with `enctype="multipart/form-data"`, CSRF token, submit button; JS to disable button and show "Transcribing..." on submit
- **`result.html`** — transcript in `<pre>` block, "Download .txt" button, "Transcribe Another" link

### Step 9: Styling (`styles.css`)
- System font stack, centered container (700px max-width)
- Clean transcript box with light background and subtle border
- Styled buttons and form inputs

---

## Key Design Decisions

1. **Synchronous transcription** — no Celery/Redis needed for a single-user tool. Browser waits during processing; JS loading indicator handles UX.
2. **Lazy model singleton** — Whisper model loads on first transcription request, not during `manage.py` commands. Thread-safe via `threading.Lock`.
3. **SQLite** — Django default, perfectly adequate for single-user use.
4. **Plain `forms.Form`** (not `ModelForm`) — we need to run transcription between validation and model save.
5. **No auth** — internal tool. Django's auth middleware removed entirely.
6. **Base model default** — ~140MB download, ~1GB RAM, runs well on CPU. Changeable via `WHISPER_MODEL_SIZE` setting.

---

## Critical Files

| File | Purpose |
|------|---------|
| `transcriber/services.py` | Whisper model singleton + transcription logic |
| `transcriber/views.py` | All application logic (upload, result, download) |
| `transcriber/forms.py` | M4A file validation |
| `transcriber/models.py` | Transcript persistence |
| `transcribe_project/settings.py` | Project config (media, whisper model, upload limits) |

---

## Verification

```bash
# Prerequisites
brew install ffmpeg

# Setup
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python manage.py migrate

# Run
python manage.py runserver

# Test: open http://127.0.0.1:8000/
# 1. Upload an M4A file → click Transcribe → wait for redirect to result page
# 2. View transcript text → click Download .txt
# 3. Try uploading a non-M4A file → should see validation error
```
