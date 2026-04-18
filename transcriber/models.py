from django.db import models


class Transcript(models.Model):
    audio_file = models.FileField(upload_to='uploads/')
    original_filename = models.CharField(max_length=255)
    transcript_text = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.original_filename} ({self.created_at:%Y-%m-%d %H:%M})"
