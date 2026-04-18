import time

from django.http import HttpResponse, JsonResponse
from django.shortcuts import get_object_or_404, redirect, render
from django.urls import reverse
from django.views.decorators.http import require_POST

from .forms import AudioUploadForm
from .models import Transcript
from .services import transcribe_audio


def upload_view(request):
    if request.method == 'POST':
        form = AudioUploadForm(request.POST, request.FILES)
        if form.is_valid():
            audio_file = form.cleaned_data['audio_file']
            transcript = Transcript.objects.create(
                audio_file=audio_file,
                original_filename=audio_file.name,
            )
            t0 = time.time()
            result = transcribe_audio(transcript.audio_file.path)
            elapsed = round(time.time() - t0)
            transcript.transcript_text = result['text']
            transcript.save()
            url = reverse('transcriber:result', kwargs={'pk': transcript.pk})
            return redirect(f'{url}?t={elapsed}')
    else:
        form = AudioUploadForm()
    return render(request, 'transcriber/upload.html', {'form': form})


def record_view(request):
    return render(request, 'transcriber/record.html')


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
            'redirect_url': reverse('transcriber:result', kwargs={'pk': transcript.pk})
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
