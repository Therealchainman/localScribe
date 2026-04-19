# Local Scribe

A web application for recording audio in the browser or uploading audio/video files and generating transcripts with local [OpenAI Whisper](https://github.com/openai/whisper).

Built with Django. Transcription runs locally — no API keys required.

## Prerequisites

- Python 3.12+
- ffmpeg

Verify `ffmpeg` with:

```bash
ffmpeg -version
```

Install ffmpeg on macOS:

```bash
brew install ffmpeg
```

## Setup

```bash
cd local-scribe
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## Run

```bash
source .venv/bin/activate
python3 manage.py runserver
```

Open http://127.0.0.1:8000/ in your browser.

## Usage

1. Record audio in the browser, or select an audio/video file to upload.
2. Choose a Whisper model from the header selector if you want something other than the default `large` model for this page session.
3. Click **Upload & Transcribe** or **Transcribe**.
4. Wait for the transcript to generate; the first use of a given model downloads or loads that model.
5. Review the transcript in the browser. You can switch models and click **Retry** to transcribe the same audio again without re-recording or re-uploading.
6. Click **Download** to save a ZIP containing `audio.<ext>` and `transcription.txt`.

## Configuration

Set these in `transcribe_project/settings.py`:

| Setting | Default | Description |
|---------|---------|-------------|
| `WHISPER_MODEL_SIZE` | `large` | Whisper model: `tiny`, `base`, `small`, `medium`, `large` |
| `UPLOAD_STAGING_DIR` | `BASE_DIR / "media" / "uploads"` | Temporary upload staging directory used before Whisper reads the file |
| `DATA_UPLOAD_MAX_MEMORY_SIZE` | 100 MB | Maximum upload file size |

The header model selector defaults to `large` on each page load. Changing it only affects the current browser page state; refreshing or reopening the app resets the selector back to the configured default.

Uploaded files are staged temporarily in `media/uploads/` before Whisper reads them. This default keeps the temp path inside a normal, non-hidden directory under your home folder, which helps Snap-confined `ffmpeg` builds access the file more reliably than `/tmp`.

## Privacy and storage

Uploads are written to a temporary file only long enough for Whisper to process them. The transcript is returned as JSON, displayed in the current browser session, and the download is generated locally in the browser as a ZIP containing `audio.<ext>` and `transcription.txt`. Refreshing or leaving the page discards the current transcript.
