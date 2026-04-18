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
    const input = document.querySelector('input[name="csrfmiddlewaretoken"]');
    return input ? input.value : '';
}

// --- Element refs ---
const panelRecord       = document.getElementById('panel-record');
const panelUpload       = document.getElementById('panel-upload');
const recordBtn         = document.getElementById('record-btn');
const recordingControls = document.getElementById('recording-controls');
const pauseBtn          = document.getElementById('pause-btn');
const endBtn            = document.getElementById('end-btn');
const timerDisplay      = document.getElementById('timer');
const audioPreview      = document.getElementById('audio-preview');
const uploadBtn         = document.getElementById('upload-btn');
const statusMsg         = document.getElementById('status-msg');
const tabHint           = document.getElementById('tab-hint');
const loadingDiv        = document.getElementById('loading');
const loadingAudio      = document.getElementById('loading-audio');
const transcribeTimer   = document.getElementById('transcription-timer');
const fileInput         = document.getElementById('file-input');
const transcribeFileBtn = document.getElementById('transcribe-file-btn');
const uploadFileError   = document.getElementById('upload-file-error');
const resultSection     = document.getElementById('result-section');
const resultFilename    = document.getElementById('result-filename');
const resultMeta        = document.getElementById('result-meta');
const resultAudio       = document.getElementById('result-audio');
const resultTranscript  = document.getElementById('result-transcript');
const resultDownloadBtn = document.getElementById('result-download-btn');
const startOverBtn      = document.getElementById('start-over-btn');

// --- Recording state ---
let mediaRecorder    = null;
let chunks           = [];
let timerInterval    = null;
let elapsed          = 0;
let recordedBlob     = null;
let activeMime       = '';
let secondaryStreams = [];
let audioContext     = null;

// --- SPA state ---
let recordedObjectURL       = null;
let uploadedFile             = null;
let uploadedObjectURL        = null;
let currentPk                = null;
let transcribeTimerInterval  = null;
let transcribeElapsed        = 0;
let skipNextStop             = false;  // guard for async onstop after tab switch

// --- Helpers ---
function formatTime(s) {
    const m   = Math.floor(s / 60).toString().padStart(2, '0');
    const sec = (s % 60).toString().padStart(2, '0');
    return `${m}:${sec}`;
}

function formatTimeLong(s) {
    const h   = Math.floor(s / 3600);
    const m   = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return String(h).padStart(2, '0') + ':' +
           String(m).padStart(2, '0') + ':' +
           String(sec).padStart(2, '0');
}

function setStatus(text, isError = false) {
    statusMsg.textContent = text;
    statusMsg.classList.toggle('error', isError);
}

function getSelectedSource() {
    const radio = document.querySelector('input[name="audio-source"]:checked');
    return radio ? radio.value : 'mic';
}

// --- State management ---
function clearState() {
    // Revoke object URLs before nulling them
    resultAudio.src = '';
    if (recordedObjectURL) { URL.revokeObjectURL(recordedObjectURL); recordedObjectURL = null; }
    if (uploadedObjectURL) { URL.revokeObjectURL(uploadedObjectURL); uploadedObjectURL = null; }
    recordedBlob = null;
    uploadedFile = null;
    currentPk = null;
    // Reset result section
    resultSection.hidden = true;
    resultTranscript.textContent = '';
    resultFilename.textContent = '';
    resultMeta.textContent = '';
    resultDownloadBtn.href = '#';
    // Reset upload tab
    fileInput.value = '';
    transcribeFileBtn.disabled = true;
    uploadFileError.hidden = true;
    uploadFileError.textContent = '';
}

function showLoading(audioURL) {
    panelRecord.hidden = true;
    panelUpload.hidden = true;
    document.querySelectorAll('.tab-btn').forEach(b => { b.disabled = true; });
    loadingAudio.src = audioURL || '';
    loadingDiv.style.display = 'block';
    transcribeTimer.textContent = '00:00:00';
    transcribeElapsed = 0;
    transcribeTimerInterval = setInterval(() => {
        transcribeElapsed++;
        transcribeTimer.textContent = formatTimeLong(transcribeElapsed);
    }, 1000);
}

function hideLoading() {
    clearInterval(transcribeTimerInterval);
    transcribeTimerInterval = null;
    loadingDiv.style.display = 'none';
    document.querySelectorAll('.tab-btn').forEach(b => { b.disabled = false; });
}

function showResult(transcript, audioObjectURL, pk, filename, sourceTab) {
    currentPk = pk;
    resultFilename.textContent = filename;
    resultMeta.textContent = `Transcribed in ${formatTimeLong(transcribeElapsed)}`;
    resultTranscript.textContent = transcript;
    resultAudio.src = audioObjectURL;
    resultDownloadBtn.href = `/download/${pk}/`;
    startOverBtn.textContent = sourceTab === 'record' ? 'Record Another' : 'Transcribe Another';
    resultSection.hidden = false;
}

function switchTab(tabName) {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        skipNextStop = true;
        stopRecording();
    }
    clearState();
    // Reset record tab UI
    recordBtn.style.display = '';
    recordingControls.style.display = 'none';
    timerDisplay.style.display = 'none';
    statusMsg.style.display = '';
    uploadBtn.disabled = true;
    audioPreview.hidden = true;
    setStatus('Press Record to start.');
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.setAttribute('aria-selected', String(btn.dataset.tab === tabName));
    });
    panelRecord.hidden = tabName !== 'record';
    panelUpload.hidden = tabName !== 'upload';
}

// --- Source selector init ---
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

// --- Recording ---
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

    // source === 'both'
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
        if (skipNextStop) {
            skipNextStop = false;
            return;
        }
        const blobType = activeMime || 'audio/webm';
        recordedBlob = new Blob(chunks, { type: blobType });
        recordedObjectURL = URL.createObjectURL(recordedBlob);
        audioPreview.src = recordedObjectURL;
        audioPreview.hidden = false;
        uploadBtn.disabled = false;
    };

    mediaRecorder.start();

    elapsed = 0;
    timerDisplay.textContent = '00:00';
    timerInterval = setInterval(() => {
        elapsed++;
        timerDisplay.textContent = formatTime(elapsed);
    }, 1000);

    recordBtn.style.display = 'none';
    recordingControls.style.display = 'flex';
    pauseBtn.textContent = 'Pause';
    timerDisplay.style.display = '';
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
    timerInterval = null;
    recordingControls.style.display = 'none';
    recordBtn.style.display = '';
    timerDisplay.style.display = 'none';
    setStatus('Recording ended. Preview below or start a new recording.');
}

// --- Record tab event listeners ---
recordBtn.addEventListener('click', () => {
    startRecording();
});

pauseBtn.addEventListener('click', () => {
    if (!mediaRecorder) return;
    if (mediaRecorder.state === 'recording') {
        mediaRecorder.pause();
        clearInterval(timerInterval);
        timerInterval = null;
        pauseBtn.textContent = 'Resume';
        setStatus('Paused');
    } else if (mediaRecorder.state === 'paused') {
        mediaRecorder.resume();
        timerInterval = setInterval(() => {
            elapsed++;
            timerDisplay.textContent = formatTime(elapsed);
        }, 1000);
        pauseBtn.textContent = 'Pause';
        setStatus('Recording\u2026');
    }
});

endBtn.addEventListener('click', () => {
    stopRecording();
});

uploadBtn.addEventListener('click', async () => {
    if (!recordedBlob) return;

    const ext = mimeToExtension(activeMime);
    const formData = new FormData();
    formData.append('audio_file', recordedBlob, `recording${ext}`);

    uploadBtn.disabled = true;
    recordingControls.style.display = 'none';
    timerDisplay.style.display = 'none';
    statusMsg.style.display = 'none';
    showLoading(recordedObjectURL);

    try {
        const resp = await fetch('/api/upload/', {
            method: 'POST',
            headers: { 'X-CSRFToken': getCsrfToken() },
            body: formData,
        });
        const data = await resp.json();
        hideLoading();
        if (resp.ok) {
            showResult(data.transcript, recordedObjectURL, data.pk, data.filename, 'record');
        } else {
            recordBtn.style.display = '';
            statusMsg.style.display = '';
            setStatus('Upload failed. Please try again.', true);
            uploadBtn.disabled = false;
        }
    } catch (err) {
        hideLoading();
        recordBtn.style.display = '';
        statusMsg.style.display = '';
        setStatus(`Network error: ${err.message}`, true);
        uploadBtn.disabled = false;
    }
});

// --- Upload tab event listeners ---
fileInput.addEventListener('change', () => {
    if (uploadedObjectURL) { URL.revokeObjectURL(uploadedObjectURL); uploadedObjectURL = null; }
    uploadedFile = fileInput.files[0] || null;
    if (uploadedFile) {
        uploadedObjectURL = URL.createObjectURL(uploadedFile);
        transcribeFileBtn.disabled = false;
    } else {
        transcribeFileBtn.disabled = true;
    }
    uploadFileError.hidden = true;
    uploadFileError.textContent = '';
});

transcribeFileBtn.addEventListener('click', async () => {
    if (!uploadedFile) return;

    const formData = new FormData();
    formData.append('audio_file', uploadedFile, uploadedFile.name);
    transcribeFileBtn.disabled = true;
    showLoading(uploadedObjectURL);

    try {
        const resp = await fetch('/api/upload-file/', {
            method: 'POST',
            headers: { 'X-CSRFToken': getCsrfToken() },
            body: formData,
        });
        const data = await resp.json();
        hideLoading();
        if (resp.ok) {
            showResult(data.transcript, uploadedObjectURL, data.pk, data.filename, 'upload');
        } else {
            panelUpload.hidden = false;
            uploadFileError.textContent = 'Upload failed. Check the file format and try again.';
            uploadFileError.hidden = false;
            transcribeFileBtn.disabled = false;
        }
    } catch (err) {
        hideLoading();
        panelUpload.hidden = false;
        uploadFileError.textContent = `Network error: ${err.message}`;
        uploadFileError.hidden = false;
        transcribeFileBtn.disabled = false;
    }
});

// --- Result section ---
startOverBtn.addEventListener('click', () => {
    const activeTab = document.querySelector('.tab-btn[aria-selected="true"]')?.dataset.tab || 'record';
    clearState();
    panelRecord.hidden = activeTab !== 'record';
    panelUpload.hidden = activeTab !== 'upload';
});

// Copy button
const copyBtn = document.querySelector('.copy-transcript-btn');
let copyResetTimer = null;
if (copyBtn) {
    const setCopyState = (state, label = '') => {
        copyBtn.dataset.state = state;
        copyBtn.querySelector('.copy-transcript-status').textContent = label;
    };
    copyBtn.addEventListener('click', async () => {
        window.clearTimeout(copyResetTimer);
        try {
            await navigator.clipboard.writeText(resultTranscript.textContent);
            setCopyState('copied', 'Copied');
        } catch {
            setCopyState('failed', 'Failed');
        }
        copyResetTimer = window.setTimeout(() => setCopyState('idle'), 1800);
    });
}


// --- Tab switching ---
document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

// Initialize from server-provided default tab
if (typeof DEFAULT_TAB !== 'undefined' && DEFAULT_TAB === 'upload') {
    switchTab('upload');
}
