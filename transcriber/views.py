import time

from django.http import HttpResponse, JsonResponse
from django.shortcuts import get_object_or_404, render
from django.views.decorators.http import require_POST

from .forms import AudioUploadForm
from .models import Transcript
from .services import transcribe_audio


def main_view(request, default_tab='record'):
    return render(request, 'transcriber/record.html', {'default_tab': default_tab})


@require_POST
def record_upload_view(request):
    form = AudioUploadForm(request.POST, request.FILES)
    if form.is_valid():
        audio_file = form.cleaned_data['audio_file']
        transcript = Transcript.objects.create(
            audio_file=audio_file,
            original_filename=audio_file.name,
        )
        result = transcribe_audio(transcript.audio_file.path)
        transcript.transcript_text = result['text']
        transcript.save()
        return JsonResponse({
            'transcript': transcript.transcript_text,
            'filename': transcript.original_filename,
            'pk': transcript.pk,
        })
    return JsonResponse({'error': form.errors.as_json()}, status=400)


@require_POST
def api_upload_file_view(request):
    form = AudioUploadForm(request.POST, request.FILES)
    if form.is_valid():
        audio_file = form.cleaned_data['audio_file']
        transcript = Transcript.objects.create(
            audio_file=audio_file,
            original_filename=audio_file.name,
        )
        result = transcribe_audio(transcript.audio_file.path)
        transcript.transcript_text = result['text']
        transcript.save()
        return JsonResponse({
            'transcript': transcript.transcript_text,
            'filename': transcript.original_filename,
            'pk': transcript.pk,
        })
    return JsonResponse({'error': form.errors.as_json()}, status=400)


def result_view(request, pk):
    transcript = get_object_or_404(Transcript, pk=pk)
    return render(request, 'transcriber/result.html', {'transcript': transcript})


def download_view(request, pk):
    transcript = get_object_or_404(Transcript, pk=pk)
    response = HttpResponse(transcript.transcript_text, content_type='text/plain')
    base_name = transcript.original_filename.rsplit('.', 1)[0]
    response['Content-Disposition'] = f'attachment; filename="{base_name}.txt"'
    return response
