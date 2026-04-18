# Local Scribe

A web application for recording audio in the browser or uploading audio/video files and generating transcripts with local [OpenAI Whisper](https://github.com/openai/whisper).

Built with Django. Transcription runs locally — no API keys required.

## Prerequisites

- Python 3.12+
- ffmpeg

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
2. Click **Upload & Transcribe** or **Transcribe**.
3. Wait for the transcript to generate; the first run downloads the configured Whisper model.
4. Review the transcript in the browser, then click **Download** to save a ZIP containing `audio.<ext>` and `transcription.txt`.

## Configuration

Set these in `transcribe_project/settings.py`:

| Setting | Default | Description |
|---------|---------|-------------|
| `WHISPER_MODEL_SIZE` | `large` | Whisper model: `tiny`, `base`, `small`, `medium`, `large` |
| `DATA_UPLOAD_MAX_MEMORY_SIZE` | 100 MB | Maximum upload file size |

## Privacy and storage

Uploads are written to a temporary file only long enough for Whisper to process them. The transcript is returned as JSON, displayed in the current browser session, and the download is generated locally in the browser as a ZIP containing `audio.<ext>` and `transcription.txt`. Refreshing or leaving the page discards the current transcript.
