import os

from django import forms


ALLOWED_EXTENSIONS = {'.m4a', '.mov', '.mp4', '.webm', '.ogg', '.wav', '.mp3'}
ALLOWED_TYPES = [
    'audio/mp4', 'audio/x-m4a', 'audio/m4a', 'audio/aac',
    'video/quicktime', 'video/x-quicktime',
    'audio/webm', 'video/webm',
    'audio/ogg', 'video/ogg', 'application/ogg',
    'audio/wav', 'audio/wave', 'audio/x-wav',
    'audio/mpeg', 'audio/mp3',
]

ACCEPT_ATTR = '.m4a,.mov,.mp4,.webm,.ogg,.wav,.mp3,audio/*,video/quicktime,video/webm'


class AudioUploadForm(forms.Form):
    audio_file = forms.FileField(
        label='Select an audio file',
        help_text='Accepted formats: .m4a, .mov, .webm, .ogg, .wav, .mp3. Maximum size: 100 MB.',
        widget=forms.ClearableFileInput(attrs={'accept': ACCEPT_ATTR}),
    )

    def clean_audio_file(self):
        f = self.cleaned_data['audio_file']
        ext = os.path.splitext(f.name)[1].lower()
        if ext not in ALLOWED_EXTENSIONS:
            raise forms.ValidationError(
                f'File type {ext!r} is not accepted. Allowed: {", ".join(sorted(ALLOWED_EXTENSIONS))}'
            )
        if f.content_type not in ALLOWED_TYPES:
            raise forms.ValidationError(
                f'Invalid MIME type: {f.content_type}.'
            )
        return f
