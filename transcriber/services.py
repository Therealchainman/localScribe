import threading

import whisper
from django.conf import settings

_model = None
_lock = threading.Lock()


def get_model():
    global _model
    if _model is None:
        with _lock:
            if _model is None:
                _model = whisper.load_model(settings.WHISPER_MODEL_SIZE)
    return _model


def transcribe_audio(file_path: str) -> dict:
    model = get_model()
    result = model.transcribe(str(file_path))
    return {
        'text': result['text'].strip(),
        'language': result.get('language', 'unknown'),
    }
