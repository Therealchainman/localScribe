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
const tabHint      = document.getElementById('tab-hint');

let mediaRecorder    = null;
let chunks           = [];
let timerInterval    = null;
let elapsed          = 0;
let recordedBlob     = null;
let activeMime       = '';
// Extra streams/context to clean up when using tab or mixed mode
let secondaryStreams = [];
let audioContext     = null;

function formatTime(s) {
    const m   = Math.floor(s / 60).toString().padStart(2, '0');
    const sec = (s % 60).toString().padStart(2, '0');
    return `${m}:${sec}`;
}

function setStatus(text, isError = false) {
    statusMsg.textContent = text;
    statusMsg.classList.toggle('error', isError);
}

function getSelectedSource() {
    const radio = document.querySelector('input[name="audio-source"]:checked');
    return radio ? radio.value : 'mic';
}

// Show/hide the tab hint and disable unavailable options on page load
(function initSourceSelector() {
    const hasDisplayMedia = !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia);
    document.querySelectorAll('input[name="audio-source"][value="tab"], input[name="audio-source"][value="both"]').forEach((el) => {
        if (!hasDisplayMedia) {
            el.disabled = true;
            el.closest('label').title = 'getDisplayMedia is not supported in this browser';
        }
    });

    document.querySelectorAll('input[name="audio-source"]').forEach((el) => {
        el.addEventListener('change', () => {
            const src = getSelectedSource();
            tabHint.hidden = (src === 'mic');
        });
    });
})();

async function getRecordingStream() {
    const source = getSelectedSource();

    if (source === 'mic') {
        return await navigator.mediaDevices.getUserMedia({ audio: true });
    }

    if (source === 'tab') {
        const displayStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
        displayStream.getVideoTracks().forEach((t) => t.stop());
        const audioTracks = displayStream.getAudioTracks();
        if (audioTracks.length === 0) {
            throw new Error('No audio captured — enable "Share audio" in the browser prompt.');
        }
        secondaryStreams.push(displayStream);
        return new MediaStream(audioTracks);
    }

    // source === 'both': mic + tab mixed via AudioContext
    const [micStream, displayStream] = await Promise.all([
        navigator.mediaDevices.getUserMedia({ audio: true }),
        navigator.mediaDevices.getDisplayMedia({ video: true, audio: true }),
    ]);
    displayStream.getVideoTracks().forEach((t) => t.stop());
    secondaryStreams.push(micStream, displayStream);

    audioContext = new AudioContext();
    const dest = audioContext.createMediaStreamDestination();
    audioContext.createMediaStreamSource(micStream).connect(dest);
    if (displayStream.getAudioTracks().length > 0) {
        audioContext.createMediaStreamSource(displayStream).connect(dest);
    }
    return dest.stream;
}

async function startRecording() {
    secondaryStreams = [];
    audioContext = null;

    let stream;
    try {
        stream = await getRecordingStream();
    } catch (err) {
        setStatus(`Could not start recording: ${err.message}`, true);
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
    secondaryStreams.forEach((s) => s.getTracks().forEach((t) => t.stop()));
    secondaryStreams = [];
    if (audioContext) {
        audioContext.close();
        audioContext = null;
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

const loadingDiv    = document.getElementById('loading');
const transcribeTimer = document.getElementById('transcription-timer');

function formatTimeLong(s) {
    const h   = Math.floor(s / 3600);
    const m   = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return String(h).padStart(2, '0') + ':' +
           String(m).padStart(2, '0') + ':' +
           String(sec).padStart(2, '0');
}

uploadBtn.addEventListener('click', async () => {
    if (!recordedBlob) return;

    const ext      = mimeToExtension(activeMime);
    const filename = `recording${ext}`;
    const formData = new FormData();
    formData.append('audio_file', recordedBlob, filename);

    uploadBtn.disabled = true;
    setStatus('Uploading and transcribing\u2026 this may take a moment.');

    loadingDiv.style.display = 'block';
    transcribeTimer.textContent = '00:00:00';

    const uploadStart = Date.now();
    elapsed = 0;
    timerDisplay.textContent = formatTime(0);
    timerInterval = setInterval(() => {
        elapsed++;
        timerDisplay.textContent = formatTime(elapsed);
        transcribeTimer.textContent = formatTimeLong(elapsed);
    }, 1000);

    try {
        const resp = await fetch('/api/upload/', {
            method: 'POST',
            headers: { 'X-CSRFToken': getCsrfToken() },
            body: formData,
        });
        const data = await resp.json();
        clearInterval(timerInterval);
        if (resp.ok && data.redirect_url) {
            const duration = Math.round((Date.now() - uploadStart) / 1000);
            window.location.href = data.redirect_url + '?t=' + duration;
        } else {
            loadingDiv.style.display = 'none';
            setStatus(`Upload failed. Please try again.`, true);
            uploadBtn.disabled = false;
        }
    } catch (err) {
        clearInterval(timerInterval);
        loadingDiv.style.display = 'none';
        setStatus(`Network error: ${err.message}`, true);
        uploadBtn.disabled = false;
    }
});
