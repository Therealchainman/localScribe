/* Audio recorder using the MediaRecorder API */

const MIME_PREFERENCE = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/ogg',
    'audio/mp4',
];
const TRANSCRIPTION_API_URL = typeof API_UPLOAD_URL !== 'undefined' ? API_UPLOAD_URL : '/api/upload/';

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
const modelSizeSelect   = document.getElementById('model-size-select');
const resultFormatSelect = document.getElementById('result-format-select');
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
const resultRetryBtn    = document.getElementById('result-retry-btn');
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
let uploadedFile            = null;
let uploadedObjectURL       = null;
let transcriptDownloadURL   = null;
let resultAudioFile         = null;
let currentResultSourceTab  = null;
let isPreparingDownload     = false;
let transcribeTimerInterval = null;
let transcribeElapsed       = 0;
let skipNextStop            = false;  // guard for async onstop after tab switch
let rawResultTranscript     = '';

const textEncoder = new TextEncoder();
const crcTable = (() => {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
        let c = i;
        for (let j = 0; j < 8; j++) {
            c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        }
        table[i] = c >>> 0;
    }
    return table;
})();

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

function getSelectedModelSize() {
    return modelSizeSelect ? modelSizeSelect.value : 'large';
}

function getSelectedResultFormat() {
    return resultFormatSelect ? resultFormatSelect.value : 'prompt';
}

function formatTranscriptForResult(transcript) {
    if (getSelectedResultFormat() === 'transcript') {
        return transcript;
    }

    return [
        '1. Executive Summary',
        'Give a concise summary of the transcript in 5 to 10 bullets or a short paragraph.',
        'Focus on the main purpose, major decisions, important topics, and final outcomes.',
        '',
        '2. Detailed Breakdown',
        'Organize the content by topic, theme, or timeline.',
        'Explain what was discussed in each section with enough detail that someone who did not read the transcript can understand it.',
        'Include key arguments, explanations, decisions, open questions, disagreements, and notable insights.',
        'When useful, mention who said what, but only if it is clear from the transcript.',
        '',
        '3. Action Items',
        'Extract all action items, next steps, follow-ups, and commitments.',
        'For each action item, include:',
        'Task',
        'Deadline or timeframe, if mentioned',
        'Relevant context',
        '',
        'Transcript:',
        '<<<TRANSCRIPT_START>>>',
        transcript,
        '<<<TRANSCRIPT_END>>>',
    ].join('\n');
}

function renderResultTranscript() {
    resultTranscript.textContent = rawResultTranscript
        ? formatTranscriptForResult(rawResultTranscript)
        : '';
}

function revokeTranscriptDownloadURL() {
    if (!transcriptDownloadURL) return;
    URL.revokeObjectURL(transcriptDownloadURL);
    transcriptDownloadURL = null;
}

function getArchiveAudioFilename(filename) {
    const dot = filename.lastIndexOf('.');
    const ext = dot >= 0 ? filename.slice(dot) : '.bin';
    return `audio${ext}`;
}

function crc32(bytes) {
    let crc = 0xFFFFFFFF;
    for (const byte of bytes) {
        crc = crcTable[(crc ^ byte) & 0xFF] ^ (crc >>> 8);
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
}

function concatUint8Arrays(parts) {
    const totalLength = parts.reduce((sum, part) => sum + part.length, 0);
    const out = new Uint8Array(totalLength);
    let offset = 0;
    for (const part of parts) {
        out.set(part, offset);
        offset += part.length;
    }
    return out;
}

async function createZipBlob(entries) {
    const localParts = [];
    const centralParts = [];
    let offset = 0;

    for (const entry of entries) {
        const nameBytes = textEncoder.encode(entry.name);
        const data = new Uint8Array(await entry.blob.arrayBuffer());
        const header = new Uint8Array(30 + nameBytes.length);
        const headerView = new DataView(header.buffer);
        const crc = crc32(data);

        headerView.setUint32(0, 0x04034B50, true);
        headerView.setUint16(4, 20, true);
        headerView.setUint16(6, 0, true);
        headerView.setUint16(8, 0, true);
        headerView.setUint16(10, 0, true);
        headerView.setUint16(12, 0, true);
        headerView.setUint32(14, crc, true);
        headerView.setUint32(18, data.length, true);
        headerView.setUint32(22, data.length, true);
        headerView.setUint16(26, nameBytes.length, true);
        headerView.setUint16(28, 0, true);
        header.set(nameBytes, 30);
        localParts.push(header, data);

        const central = new Uint8Array(46 + nameBytes.length);
        const centralView = new DataView(central.buffer);
        centralView.setUint32(0, 0x02014B50, true);
        centralView.setUint16(4, 20, true);
        centralView.setUint16(6, 20, true);
        centralView.setUint16(8, 0, true);
        centralView.setUint16(10, 0, true);
        centralView.setUint16(12, 0, true);
        centralView.setUint16(14, 0, true);
        centralView.setUint32(16, crc, true);
        centralView.setUint32(20, data.length, true);
        centralView.setUint32(24, data.length, true);
        centralView.setUint16(28, nameBytes.length, true);
        centralView.setUint16(30, 0, true);
        centralView.setUint16(32, 0, true);
        centralView.setUint16(34, 0, true);
        centralView.setUint16(36, 0, true);
        centralView.setUint32(38, 0, true);
        centralView.setUint32(42, offset, true);
        central.set(nameBytes, 46);
        centralParts.push(central);

        offset += header.length + data.length;
    }

    const centralDirectory = concatUint8Arrays(centralParts);
    const end = new Uint8Array(22);
    const endView = new DataView(end.buffer);
    endView.setUint32(0, 0x06054B50, true);
    endView.setUint16(4, 0, true);
    endView.setUint16(6, 0, true);
    endView.setUint16(8, entries.length, true);
    endView.setUint16(10, entries.length, true);
    endView.setUint32(12, centralDirectory.length, true);
    endView.setUint32(16, offset, true);
    endView.setUint16(20, 0, true);

    return new Blob([...localParts, centralDirectory, end], { type: 'application/zip' });
}

async function ensureTranscriptDownload(filename, transcript) {
    if (transcriptDownloadURL) return transcriptDownloadURL;
    if (!resultAudioFile) throw new Error('No audio available for download.');

    const transcriptText = transcript.endsWith('\n') ? transcript : `${transcript}\n`;
    const zipBlob = await createZipBlob([
        { name: getArchiveAudioFilename(filename), blob: resultAudioFile },
        { name: 'transcription.txt', blob: new Blob([transcriptText], { type: 'text/plain;charset=utf-8' }) },
    ]);

    transcriptDownloadURL = URL.createObjectURL(zipBlob);
    return transcriptDownloadURL;
}

// --- State management ---
function clearState() {
    // Revoke object URLs before nulling them
    resultAudio.src = '';
    if (recordedObjectURL) { URL.revokeObjectURL(recordedObjectURL); recordedObjectURL = null; }
    if (uploadedObjectURL) { URL.revokeObjectURL(uploadedObjectURL); uploadedObjectURL = null; }
    revokeTranscriptDownloadURL();
    recordedBlob = null;
    uploadedFile = null;
    resultAudioFile = null;
    currentResultSourceTab = null;
    isPreparingDownload = false;
    rawResultTranscript = '';
    // Reset result section
    resultSection.hidden = true;
    resultTranscript.textContent = '';
    resultFilename.textContent = '';
    resultMeta.textContent = '';
    resultDownloadBtn.href = '#';
    resultDownloadBtn.removeAttribute('download');
    // Reset upload tab
    fileInput.value = '';
    transcribeFileBtn.disabled = true;
    uploadFileError.hidden = true;
    uploadFileError.textContent = '';
}

function showLoading(audioURL) {
    panelRecord.hidden = true;
    panelUpload.hidden = true;
    resultSection.hidden = true;
    document.querySelectorAll('.tab-btn').forEach(b => { b.disabled = true; });
    if (modelSizeSelect) modelSizeSelect.disabled = true;
    if (resultFormatSelect) resultFormatSelect.disabled = true;
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
    if (modelSizeSelect) modelSizeSelect.disabled = false;
    if (resultFormatSelect) resultFormatSelect.disabled = false;
}

function showResult(transcript, audioObjectURL, filename, downloadFilename, sourceTab) {
    revokeTranscriptDownloadURL();
    resultFilename.textContent = filename;
    resultMeta.textContent = `Transcribed in ${formatTimeLong(transcribeElapsed)}`;
    rawResultTranscript = transcript;
    renderResultTranscript();
    resultAudio.src = audioObjectURL;
    resultAudioFile = sourceTab === 'record' ? recordedBlob : uploadedFile;
    currentResultSourceTab = sourceTab;
    resultDownloadBtn.dataset.filename = downloadFilename;
    startOverBtn.textContent = sourceTab === 'record' ? 'Record Another' : 'Transcribe Another';
    resultSection.hidden = false;
}

function buildTranscriptionRequest(sourceTab) {
    const formData = new FormData();

    if (sourceTab === 'record') {
        if (!recordedBlob || !recordedObjectURL) return null;
        const ext = mimeToExtension(activeMime);
        formData.append('audio_file', recordedBlob, `recording${ext}`);
        formData.append('model_size', getSelectedModelSize());
        return { formData, audioURL: recordedObjectURL };
    }

    if (sourceTab === 'upload') {
        if (!uploadedFile || !uploadedObjectURL) return null;
        formData.append('audio_file', uploadedFile, uploadedFile.name);
        formData.append('model_size', getSelectedModelSize());
        return { formData, audioURL: uploadedObjectURL };
    }

    return null;
}

function prepareTranscriptionUI(sourceTab) {
    if (sourceTab === 'record') {
        uploadBtn.disabled = true;
        recordingControls.style.display = 'none';
        timerDisplay.style.display = 'none';
        statusMsg.style.display = 'none';
        return;
    }

    transcribeFileBtn.disabled = true;
    uploadFileError.hidden = true;
    uploadFileError.textContent = '';
}

function restoreTranscriptionUIAfterFailure(sourceTab, errorText) {
    if (sourceTab === 'record') {
        recordBtn.style.display = '';
        statusMsg.style.display = '';
        setStatus(errorText, true);
        uploadBtn.disabled = false;
        return;
    }

    panelUpload.hidden = false;
    uploadFileError.textContent = errorText;
    uploadFileError.hidden = false;
    transcribeFileBtn.disabled = false;
}

async function readApiResponse(resp) {
    const rawText = await resp.text();
    if (!rawText) return { data: null, rawText: '' };

    try {
        return { data: JSON.parse(rawText), rawText };
    } catch (_err) {
        return { data: null, rawText };
    }
}

function getServerErrorMessage(data, fallbackText) {
    if (!data || typeof data !== 'object') return fallbackText;
    const parts = [];
    if (typeof data.error === 'string' && data.error.trim()) {
        parts.push(data.error.trim());
    }
    if (typeof data.traceback === 'string' && data.traceback.trim()) {
        parts.push(data.traceback.trim());
    }
    if (parts.length > 0) return parts.join('\n\n');
    return fallbackText;
}

function getResponseFallbackError(resp, rawText, defaultText) {
    const trimmedText = (rawText || '').trim();
    if (trimmedText) {
        return `${defaultText}\n\n${trimmedText}`;
    }
    return `${defaultText} (HTTP ${resp.status})`;
}

async function transcribeSource(sourceTab) {
    const request = buildTranscriptionRequest(sourceTab);
    if (!request) return;

    prepareTranscriptionUI(sourceTab);
    showLoading(request.audioURL);

    try {
        const resp = await fetch(TRANSCRIPTION_API_URL, {
            method: 'POST',
            headers: { 'X-CSRFToken': getCsrfToken() },
            body: request.formData,
        });
        const { data, rawText } = await readApiResponse(resp);
        hideLoading();
        if (resp.ok) {
            showResult(data.transcript, request.audioURL, data.filename, data.download_filename, sourceTab);
        } else {
            const fallbackText = sourceTab === 'record'
                ? 'Upload failed. Please try again.'
                : 'Upload failed. Check the file format and try again.';
            const errorText = data
                ? getServerErrorMessage(data, fallbackText)
                : getResponseFallbackError(resp, rawText, fallbackText);
            restoreTranscriptionUIAfterFailure(sourceTab, errorText);
        }
    } catch (err) {
        hideLoading();
        restoreTranscriptionUIAfterFailure(sourceTab, `Network error: ${err.message}`);
    }
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
    await transcribeSource('record');
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
    await transcribeSource('upload');
});

// --- Result section ---
startOverBtn.addEventListener('click', () => {
    const activeTab = document.querySelector('.tab-btn[aria-selected="true"]')?.dataset.tab || 'record';
    clearState();
    panelRecord.hidden = activeTab !== 'record';
    panelUpload.hidden = activeTab !== 'upload';
});

resultRetryBtn.addEventListener('click', async () => {
    if (!currentResultSourceTab) return;
    await transcribeSource(currentResultSourceTab);
});

resultDownloadBtn.addEventListener('click', async (event) => {
    event.preventDefault();
    if (isPreparingDownload) return;

    isPreparingDownload = true;
    const originalLabel = resultDownloadBtn.textContent;
    resultDownloadBtn.textContent = 'Preparing...';

    try {
        const archiveURL = await ensureTranscriptDownload(
            resultFilename.textContent,
            resultTranscript.textContent,
        );
        resultDownloadBtn.href = archiveURL;
        const tempLink = document.createElement('a');
        tempLink.href = archiveURL;
        tempLink.download = resultDownloadBtn.dataset.filename || 'transcript.zip';
        document.body.appendChild(tempLink);
        tempLink.click();
        tempLink.remove();
    } catch (err) {
        setStatus(`Download failed: ${err.message}`, true);
        statusMsg.style.display = '';
    } finally {
        resultDownloadBtn.textContent = originalLabel;
        isPreparingDownload = false;
    }
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

if (resultFormatSelect) {
    resultFormatSelect.addEventListener('change', () => {
        revokeTranscriptDownloadURL();
        renderResultTranscript();
    });
}


// --- Tab switching ---
document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});
