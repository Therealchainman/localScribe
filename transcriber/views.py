import os
import tempfile
from pathlib import Path

from django.http import JsonResponse
from django.shortcuts import render
from django.views.decorators.http import require_POST

from .forms import AudioUploadForm
from .services import transcribe_audio


def main_view(request, default_tab='record'):
    return render(request, 'transcriber/record.html', {'default_tab': default_tab})


def _download_filename(original_filename: str) -> str:
    stem = Path(original_filename).stem or 'transcript'
    return f'{stem}.zip'


def _transcribe_uploaded_file(uploaded_file):
    original_filename = uploaded_file.name or 'audio'
    suffix = Path(original_filename).suffix or '.tmp'
    temp_path = None

    try:
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as temp_file:
            for chunk in uploaded_file.chunks():
                temp_file.write(chunk)
            temp_path = temp_file.name

        result = transcribe_audio(temp_path)
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
        payload = _transcribe_uploaded_file(form.cleaned_data['audio_file'])
    except Exception as exc:
        return JsonResponse({'error': f'Transcription failed: {exc}'}, status=500)
    return JsonResponse(payload)


@require_POST
def api_upload_view(request):
    return _handle_upload(request)
