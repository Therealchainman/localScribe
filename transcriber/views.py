import os
import tempfile
from pathlib import Path

from django.conf import settings
from django.http import JsonResponse
from django.shortcuts import render
from django.views.decorators.http import require_POST

from .forms import AudioUploadForm
from .services import WHISPER_MODEL_SIZES, resolve_model_size, transcribe_audio


def main_view(request):
    default_model_size = resolve_model_size(settings.WHISPER_MODEL_SIZE)
    return render(request, 'transcriber/record.html', {
        'default_whisper_model': default_model_size,
        'whisper_model_sizes': WHISPER_MODEL_SIZES,
    })


def _download_filename(original_filename: str) -> str:
    stem = Path(original_filename).stem or 'transcript'
    return f'{stem}.zip'


def _transcribe_uploaded_file(uploaded_file, model_size: str):
    original_filename = uploaded_file.name or 'audio'
    suffix = Path(original_filename).suffix or '.tmp'
    temp_path = None

    try:
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as temp_file:
            for chunk in uploaded_file.chunks():
                temp_file.write(chunk)
            temp_path = temp_file.name

        result = transcribe_audio(temp_path, model_size=model_size)
        return {
            'transcript': result['text'],
            'filename': original_filename,
            'download_filename': _download_filename(original_filename),
            'language': result.get('language', 'unknown'),
        }
    finally:
        if temp_path and os.path.exists(temp_path):
            os.unlink(temp_path)


def _handle_upload(request):
    form = AudioUploadForm(request.POST, request.FILES)
    if not form.is_valid():
        return JsonResponse({'error': form.errors.as_json()}, status=400)

    try:
        model_size = resolve_model_size(request.POST.get('model_size'))
    except ValueError as exc:
        return JsonResponse({'error': str(exc)}, status=400)

    try:
        payload = _transcribe_uploaded_file(form.cleaned_data['audio_file'], model_size)
    except Exception as exc:
        return JsonResponse({'error': f'Transcription failed: {exc}'}, status=500)
    return JsonResponse(payload)


@require_POST
def api_upload_view(request):
    return _handle_upload(request)
