import subprocess
import shutil
import threading

import whisper
from django.conf import settings

WHISPER_MODEL_SIZES = ('tiny', 'base', 'small', 'medium', 'large')

_model = None
_model_size = None
_lock = threading.Lock()
_transcription_lock = threading.Lock()


def resolve_model_size(model_size: str | None = None) -> str:
    candidate = (model_size or settings.WHISPER_MODEL_SIZE).strip().lower()
    if candidate not in WHISPER_MODEL_SIZES:
        raise ValueError(f'Invalid Whisper model size: {candidate}.')
    return candidate


def get_model(model_size: str | None = None):
    global _model, _model_size
    resolved_model_size = resolve_model_size(model_size)
    if _model is None or _model_size != resolved_model_size:
        with _lock:
            if _model is None or _model_size != resolved_model_size:
                _model = whisper.load_model(resolved_model_size)
                _model_size = resolved_model_size
    return _model


def ensure_ffmpeg_available() -> None:
    ffmpeg_path = shutil.which('ffmpeg')
    if not ffmpeg_path:
        raise RuntimeError('ffmpeg is not installed or not available on PATH.')

    try:
        subprocess.run(
            [ffmpeg_path, '-version'],
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
            text=True,
        )
    except OSError as exc:
        raise RuntimeError(f'ffmpeg is on PATH but could not be executed: {exc}') from exc
    except subprocess.CalledProcessError as exc:
        stderr = (exc.stderr or '').strip().splitlines()
        details = stderr[0] if stderr else 'Unknown ffmpeg startup failure.'
        raise RuntimeError(
            f'ffmpeg is on PATH but failed to start cleanly: {details}'
        ) from exc


def transcribe_audio(file_path: str, model_size: str | None = None) -> dict:
    # Serialize transcription work so the process-wide Whisper model cannot be
    # swapped out while another request is actively using it.
    with _transcription_lock:
        ensure_ffmpeg_available()
        model = get_model(model_size)
        result = model.transcribe(str(file_path))
    return {
        'text': result['text'].strip(),
        'language': result.get('language', 'unknown'),
    }
