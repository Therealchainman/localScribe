/* Audio recorder using the MediaRecorder API */

const MIME_PREFERENCE = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/ogg',
    'audio/mp4',
];

function getSupportedMimeType() {
    for (const type of MIME_PREFERENCE) {
        if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(type)) {
            return type;
        }
    }
    return '';
}

function mimeToExtension(mimeType) {
    if (mimeType.startsWith('audio/webm')) return '.webm';
    if (mimeType.startsWith('audio/ogg'))  return '.ogg';
    if (mimeType.startsWith('audio/mp4'))  return '.mp4';
    return '.webm';
}

function getCsrfToken() {
    const value = `; ${document.cookie}`;
    const parts = value.split('; csrftoken=');
    if (parts.length === 2) return parts.pop().split(';').shift();
    // Fallback: read from hidden input rendered by {% csrf_token %}
    const input = document.querySelector('input[name="csrfmiddlewaretoken"]');
    return input ? input.value : '';
}

const recordBtn    = document.getElementById('record-btn');
const timerDisplay = document.getElementById('timer');
const audioPreview = document.getElementById('audio-preview');
const uploadBtn    = document.getElementById('upload-btn');
const statusMsg    = document.getElementById('status-msg');

let mediaRecorder = null;
let chunks        = [];
let timerInterval = null;
let elapsed       = 0;
let recordedBlob  = null;
let activeMime    = '';

function formatTime(s) {
    const m   = Math.floor(s / 60).toString().padStart(2, '0');
    const sec = (s % 60).toString().padStart(2, '0');
    return `${m}:${sec}`;
}

function setStatus(text, isError = false) {
    statusMsg.textContent = text;
    statusMsg.classList.toggle('error', isError);
}

async function startRecording() {
    let stream;
    try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
        setStatus(`Microphone access denied: ${err.message}`, true);
        return;
    }

    activeMime = getSupportedMimeType();
    const options = activeMime ? { mimeType: activeMime } : {};
    mediaRecorder = new MediaRecorder(stream, options);
    chunks = [];

    mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
    };

    mediaRecorder.onstop = () => {
        const blobType = activeMime || 'audio/webm';
        recordedBlob = new Blob(chunks, { type: blobType });
        audioPreview.src = URL.createObjectURL(recordedBlob);
        audioPreview.hidden = false;
        uploadBtn.disabled = false;
        setStatus('Recording ready. Preview or upload below.');
    };

    mediaRecorder.start();

    elapsed = 0;
    timerDisplay.textContent = '00:00';
    timerInterval = setInterval(() => {
        elapsed++;
        timerDisplay.textContent = formatTime(elapsed);
    }, 1000);

    recordBtn.textContent = 'Stop';
    recordBtn.classList.add('recording');
    recordBtn.setAttribute('aria-label', 'Stop recording');
    uploadBtn.disabled = true;
    audioPreview.hidden = true;
    setStatus('Recording\u2026');
}

function stopRecording() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
        mediaRecorder.stream.getTracks().forEach((t) => t.stop());
    }
    clearInterval(timerInterval);
    recordBtn.textContent = 'Record';
    recordBtn.classList.remove('recording');
    recordBtn.setAttribute('aria-label', 'Start recording');
}

recordBtn.addEventListener('click', () => {
    if (mediaRecorder && mediaRecorder.state === 'recording') {
        stopRecording();
    } else {
        startRecording();
    }
});

uploadBtn.addEventListener('click', async () => {
    if (!recordedBlob) return;

    const ext      = mimeToExtension(activeMime);
    const filename = `recording${ext}`;
    const formData = new FormData();
    formData.append('audio_file', recordedBlob, filename);

    uploadBtn.disabled = true;
    setStatus('Uploading and transcribing\u2026 this may take a moment.');

    try {
        const resp = await fetch('/api/upload/', {
            method: 'POST',
            headers: { 'X-CSRFToken': getCsrfToken() },
            body: formData,
        });
        const data = await resp.json();
        if (resp.ok && data.redirect_url) {
            window.location.href = data.redirect_url;
        } else {
            setStatus(`Upload failed. Please try again.`, true);
            uploadBtn.disabled = false;
        }
    } catch (err) {
        setStatus(`Network error: ${err.message}`, true);
        uploadBtn.disabled = false;
    }
});
