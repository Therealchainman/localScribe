import os
import tempfile
import threading
import time
from unittest.mock import ANY, patch

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import SimpleTestCase, override_settings

from transcriber import services


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
        upload = SimpleUploadedFile('meeting.mp4', b'fake-audio', content_type='audio/mp4')

        with patch('transcriber.views.transcribe_audio', return_value={'text': 'uploaded text', 'language': 'en'}):
            response = self.client.post('/api/upload/', {'audio_file': upload})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {
            'transcript': 'uploaded text',
            'filename': 'meeting.mp4',
            'download_filename': 'meeting.zip',
            'language': 'en',
        })
        self.assertNotIn('pk', response.json())

    def test_explicit_model_size_is_passed_to_transcription(self):
        upload = SimpleUploadedFile('clip.wav', b'fake-audio', content_type='audio/wav')

        with patch('transcriber.views.transcribe_audio', return_value={'text': 'hello world', 'language': 'en'}) as mock_transcribe:
            response = self.client.post('/api/upload/', {
                'audio_file': upload,
                'model_size': 'small',
            })

        self.assertEqual(response.status_code, 200)
        mock_transcribe.assert_called_once_with(ANY, model_size='small')

    def test_missing_model_size_uses_default_whisper_model(self):
        upload = SimpleUploadedFile('clip.wav', b'fake-audio', content_type='audio/wav')

        with patch('transcriber.views.transcribe_audio', return_value={'text': 'hello world', 'language': 'en'}) as mock_transcribe:
            response = self.client.post('/api/upload/', {'audio_file': upload})

        self.assertEqual(response.status_code, 200)
        mock_transcribe.assert_called_once_with(ANY, model_size='large')

    def test_upload_temp_file_is_removed_after_success(self):
        upload = SimpleUploadedFile('cleanup.wav', b'audio-bytes', content_type='audio/wav')
        captured_path = {}

        def fake_transcribe(path, model_size=None):
            captured_path['value'] = path
            self.assertTrue(os.path.exists(path))
            with open(path, 'rb') as temp_file:
                self.assertEqual(temp_file.read(), b'audio-bytes')
            self.assertEqual(model_size, 'large')
            return {'text': 'done', 'language': 'en'}

        with patch('transcriber.views.transcribe_audio', side_effect=fake_transcribe):
            response = self.client.post('/api/upload/', {'audio_file': upload})

        self.assertEqual(response.status_code, 200)
        self.assertFalse(os.path.exists(captured_path['value']))

    def test_upload_temp_file_uses_configured_staging_directory(self):
        upload = SimpleUploadedFile('cleanup.wav', b'audio-bytes', content_type='audio/wav')

        with tempfile.TemporaryDirectory() as staging_root:
            staging_dir = os.path.join(staging_root, 'visible-upload-cache')
            captured_path = {}

            def fake_transcribe(path, model_size=None):
                captured_path['value'] = path
                self.assertTrue(path.startswith(staging_dir + os.sep))
                return {'text': 'done', 'language': 'en'}

            with override_settings(UPLOAD_STAGING_DIR=staging_dir):
                with patch('transcriber.views.transcribe_audio', side_effect=fake_transcribe):
                    response = self.client.post('/api/upload/', {'audio_file': upload})

        self.assertEqual(response.status_code, 200)
        self.assertFalse(os.path.exists(captured_path['value']))

    def test_upload_temp_file_is_removed_after_transcription_failure(self):
        upload = SimpleUploadedFile('broken.webm', b'audio-bytes', content_type='audio/webm')
        captured_path = {}

        def fake_transcribe(path, model_size=None):
            captured_path['value'] = path
            self.assertTrue(os.path.exists(path))
            self.assertEqual(model_size, 'large')
            raise RuntimeError('boom')

        with patch('transcriber.views.traceback.print_exc') as mock_print_exc:
            with patch('transcriber.views.transcribe_audio', side_effect=fake_transcribe):
                response = self.client.post('/api/upload/', {'audio_file': upload})

        mock_print_exc.assert_called_once()
        self.assertEqual(response.status_code, 500)
        self.assertEqual(response.json(), {'error': 'Transcription failed: RuntimeError: boom'})
        self.assertFalse(os.path.exists(captured_path['value']))

    @override_settings(DEBUG=True)
    def test_transcription_failure_in_debug_includes_traceback(self):
        upload = SimpleUploadedFile('broken.webm', b'audio-bytes', content_type='audio/webm')

        with patch('transcriber.views.traceback.print_exc') as mock_print_exc:
            with patch('transcriber.views.transcribe_audio', side_effect=RuntimeError('boom')):
                response = self.client.post('/api/upload/', {'audio_file': upload})

        mock_print_exc.assert_called_once()
        self.assertEqual(response.status_code, 500)
        self.assertEqual(response.json()['error'], 'Transcription failed: RuntimeError: boom')
        self.assertIn('traceback', response.json())

    def test_invalid_upload_returns_validation_error(self):
        upload = SimpleUploadedFile('notes.txt', b'not-audio', content_type='text/plain')

        response = self.client.post('/api/upload/', {'audio_file': upload})

        self.assertEqual(response.status_code, 400)
        self.assertEqual(
            response.json(),
            {'error': "File type '.txt' is not accepted. Allowed: .m4a, .mov, .mp3, .mp4, .ogg, .wav, .webm"},
        )

    def test_invalid_model_size_returns_validation_error(self):
        upload = SimpleUploadedFile('clip.wav', b'fake-audio', content_type='audio/wav')

        with patch('transcriber.views.transcribe_audio') as mock_transcribe:
            response = self.client.post('/api/upload/', {
                'audio_file': upload,
                'model_size': 'xl',
            })

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json(), {'error': 'Invalid Whisper model size: xl.'})
        mock_transcribe.assert_not_called()

    def test_removed_upload_file_route_returns_404(self):
        upload = SimpleUploadedFile('meeting.mp3', b'fake-audio', content_type='audio/mpeg')

        response = self.client.post('/api/upload-file/', {'audio_file': upload})

        self.assertEqual(response.status_code, 404)


class PageTests(SimpleTestCase):
    def test_main_page_does_not_link_a_manifest(self):
        response = self.client.get('/')

        self.assertEqual(response.status_code, 200)
        self.assertNotContains(response, 'rel="manifest"', html=False)

    def test_removed_upload_page_route_returns_404(self):
        response = self.client.get('/upload/')

        self.assertEqual(response.status_code, 404)

    def test_main_page_renders_whisper_model_selector_with_large_selected(self):
        response = self.client.get('/')

        self.assertEqual(response.status_code, 200)
        self.assertContains(response, 'id="model-size-select"', html=False)
        self.assertContains(response, '<option value="large" selected>large</option>', html=False)
        self.assertContains(response, '<option value="tiny">tiny</option>', html=False)
        self.assertContains(response, '<option value="base">base</option>', html=False)
        self.assertContains(response, '<option value="small">small</option>', html=False)
        self.assertContains(response, '<option value="medium">medium</option>', html=False)

    def test_main_page_renders_retry_button_in_result_actions(self):
        response = self.client.get('/')

        self.assertEqual(response.status_code, 200)
        self.assertContains(response, 'id="result-retry-btn"', html=False)
        self.assertContains(response, '>Retry</button>', html=False)
        self.assertNotContains(response, 'DEFAULT_TAB', html=False)


class ServiceTests(SimpleTestCase):
    def test_transcription_lock_blocks_model_switch_until_active_transcription_finishes(self):
        first_started = threading.Event()
        allow_first_to_finish = threading.Event()
        second_started = threading.Event()
        get_model_calls = []

        class FakeModel:
            def __init__(self, name):
                self.name = name

            def transcribe(self, _path):
                if self.name == 'large':
                    first_started.set()
                    if not allow_first_to_finish.wait(timeout=1):
                        raise AssertionError('First transcription was not released in time.')
                    return {'text': 'first', 'language': 'en'}
                second_started.set()
                return {'text': 'second', 'language': 'en'}

        def fake_get_model(model_size=None):
            get_model_calls.append(model_size)
            return FakeModel(model_size)

        results = {}

        def run_transcription(label, path, model_size):
            results[label] = services.transcribe_audio(path, model_size=model_size)

        with patch('transcriber.services.ensure_ffmpeg_available'):
            with patch('transcriber.services.get_model', side_effect=fake_get_model):
                first_thread = threading.Thread(
                    target=run_transcription,
                    args=('first', 'first.wav', 'large'),
                )
                second_thread = threading.Thread(
                    target=run_transcription,
                    args=('second', 'second.wav', 'tiny'),
                )

                first_thread.start()
                self.assertTrue(first_started.wait(timeout=1))

                second_thread.start()
                time.sleep(0.05)

                self.assertEqual(get_model_calls, ['large'])
                self.assertFalse(second_started.is_set())

                allow_first_to_finish.set()
                first_thread.join(timeout=1)
                second_thread.join(timeout=1)

        self.assertFalse(first_thread.is_alive())
        self.assertFalse(second_thread.is_alive())
        self.assertEqual(get_model_calls, ['large', 'tiny'])
        self.assertEqual(results['first']['text'], 'first')
        self.assertEqual(results['second']['text'], 'second')

    def test_transcribe_audio_requires_ffmpeg_on_path(self):
        with patch('transcriber.services.shutil.which', return_value=None):
            with patch('transcriber.services.get_model') as mock_get_model:
                with self.assertRaisesRegex(RuntimeError, 'ffmpeg is not installed or not available on PATH'):
                    services.transcribe_audio('meeting.m4a', model_size='large')

        mock_get_model.assert_not_called()

    def test_transcribe_audio_requires_working_ffmpeg_binary(self):
        with patch('transcriber.services.shutil.which', return_value='/usr/bin/ffmpeg'):
            with patch(
                'transcriber.services.subprocess.run',
                side_effect=services.subprocess.CalledProcessError(
                    1,
                    ['/usr/bin/ffmpeg', '-version'],
                    stderr='snap-confine has elevated permissions and is not confined but should be.',
                ),
            ):
                with patch('transcriber.services.get_model') as mock_get_model:
                    with self.assertRaisesRegex(
                        RuntimeError,
                        'ffmpeg is on PATH but failed to start cleanly: snap-confine has elevated permissions',
                    ):
                        services.transcribe_audio('meeting.m4a', model_size='large')

        mock_get_model.assert_not_called()
