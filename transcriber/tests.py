import os
from unittest.mock import patch

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import SimpleTestCase


class UploadApiTests(SimpleTestCase):
    def test_record_upload_returns_ephemeral_json_without_pk(self):
        upload = SimpleUploadedFile('clip.webm', b'fake-audio', content_type='audio/webm')

        with patch('transcriber.views.transcribe_audio', return_value={'text': 'hello world', 'language': 'en'}):
            response = self.client.post('/api/upload/', {'audio_file': upload})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {
            'transcript': 'hello world',
            'filename': 'clip.webm',
            'download_filename': 'clip.zip',
            'language': 'en',
        })
        self.assertNotIn('pk', response.json())

    def test_uploaded_file_returns_ephemeral_json_without_pk(self):
        upload = SimpleUploadedFile('meeting.mp3', b'fake-audio', content_type='audio/mpeg')

        with patch('transcriber.views.transcribe_audio', return_value={'text': 'uploaded text', 'language': 'en'}):
            response = self.client.post('/api/upload/', {'audio_file': upload})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {
            'transcript': 'uploaded text',
            'filename': 'meeting.mp3',
            'download_filename': 'meeting.zip',
            'language': 'en',
        })
        self.assertNotIn('pk', response.json())

    def test_upload_temp_file_is_removed_after_success(self):
        upload = SimpleUploadedFile('cleanup.wav', b'audio-bytes', content_type='audio/wav')
        captured_path = {}

        def fake_transcribe(path):
            captured_path['value'] = path
            self.assertTrue(os.path.exists(path))
            with open(path, 'rb') as temp_file:
                self.assertEqual(temp_file.read(), b'audio-bytes')
            return {'text': 'done', 'language': 'en'}

        with patch('transcriber.views.transcribe_audio', side_effect=fake_transcribe):
            response = self.client.post('/api/upload/', {'audio_file': upload})

        self.assertEqual(response.status_code, 200)
        self.assertFalse(os.path.exists(captured_path['value']))

    def test_upload_temp_file_is_removed_after_transcription_failure(self):
        upload = SimpleUploadedFile('broken.webm', b'audio-bytes', content_type='audio/webm')
        captured_path = {}

        def fake_transcribe(path):
            captured_path['value'] = path
            self.assertTrue(os.path.exists(path))
            raise RuntimeError('boom')

        with patch('transcriber.views.transcribe_audio', side_effect=fake_transcribe):
            response = self.client.post('/api/upload/', {'audio_file': upload})

        self.assertEqual(response.status_code, 500)
        self.assertEqual(response.json(), {'error': 'Transcription failed: boom'})
        self.assertFalse(os.path.exists(captured_path['value']))

    def test_invalid_upload_returns_validation_error(self):
        upload = SimpleUploadedFile('notes.txt', b'not-audio', content_type='text/plain')

        response = self.client.post('/api/upload/', {'audio_file': upload})

        self.assertEqual(response.status_code, 400)
        self.assertIn('error', response.json())

    def test_removed_upload_file_route_returns_404(self):
        upload = SimpleUploadedFile('meeting.mp3', b'fake-audio', content_type='audio/mpeg')

        response = self.client.post('/api/upload-file/', {'audio_file': upload})

        self.assertEqual(response.status_code, 404)
