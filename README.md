# Importal Transcribe

A web application for uploading M4A audio files and generating transcripts using local [OpenAI Whisper](https://github.com/openai/whisper).

Built with Django and SQLite. Transcription runs locally — no API keys required.

## Prerequisites

- Python 3.12+
- ffmpeg

Install ffmpeg on macOS:

```bash
brew install ffmpeg
```

## Setup

```bash
cd importal-transcribe
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python manage.py migrate
```

## Run

```bash
source .venv/bin/activate
python manage.py runserver
```

Open http://127.0.0.1:8000/ in your browser.

## Usage

1. Select an M4A audio file and click **Transcribe**
2. Wait for the transcript to generate (the first run downloads the Whisper model ~140MB)
3. View the transcript on the result page
4. Click **Download .txt** to save it

## Configuration

Set these in `transcribe_project/settings.py`:

| Setting | Default | Description |
|---------|---------|-------------|
| `WHISPER_MODEL_SIZE` | `base` | Whisper model: `tiny`, `base`, `small`, `medium`, `large` |
| `DATA_UPLOAD_MAX_MEMORY_SIZE` | 100 MB | Maximum upload file size |
