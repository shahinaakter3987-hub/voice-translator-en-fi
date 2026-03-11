// Web Speech API
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const recognition = SpeechRecognition ? new SpeechRecognition() : null;

// UI Elements
const micBtn = document.getElementById('mic-btn');
const micInstruction = document.getElementById('mic-instruction');
const transcriptArea = document.getElementById('transcript');
const translationArea = document.getElementById('translation');
const modeToggle = document.getElementById('mode-toggle');
const inputLabel = document.getElementById('input-label');
const outputLabel = document.getElementById('output-label');
const statusMsg = document.getElementById('status');
const videoFeed = document.getElementById('video-feed');
const subtitleOverlay = document.getElementById('subtitles');
const canvas = document.getElementById('visualizer');
const canvasCtx = canvas.getContext('2d');
const visualizerContainer = document.querySelector('.visualizer-container');

// Audio Context State
let audioCtx;
let analyser;
let source;
let animationId;

// State
let isListening = false;
let currentMode = 'en-fi'; // 'en-fi' or 'fi-en'
let translationTimeout = null;

if (!recognition) {
    statusMsg.textContent = 'Speech recognition not supported in this browser. Try Chrome.';
    micBtn.disabled = true;
} else {
    recognition.continuous = true;
    recognition.interimResults = true;
    updateRecognitionSettings();
    startCamera();
}

async function startCamera() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        statusMsg.textContent = "Your browser does not support camera access or you are not in a secure context (HTTPS/localhost).";
        return;
    }
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        videoFeed.srcObject = stream;
    } catch (err) {
        console.error("Error accessing camera:", err);
        if (err.name === 'NotAllowedError') {
            statusMsg.textContent = "Camera access denied by user. Please check permissions.";
        } else {
            statusMsg.textContent = `Camera Error: ${err.message}`;
        }
    }
}

// Toggle Mode Logic
modeToggle.addEventListener('click', () => {
    currentMode = currentMode === 'en-fi' ? 'fi-en' : 'en-fi';
    modeToggle.classList.toggle('fin-en');
    
    if (currentMode === 'en-fi') {
        inputLabel.textContent = 'Speech Input (English)';
        outputLabel.textContent = 'Translation (Finnish)';
        recognition.lang = 'en-US';
    } else {
        inputLabel.textContent = 'Speech Input (Finnish)';
        outputLabel.textContent = 'Translation (English)';
        recognition.lang = 'fi-FI';
    }
    
    // Reset areas
    transcriptArea.textContent = '';
    translationArea.textContent = '';
    
    // Stop if listening to apply new lang
    if (isListening) {
        recognition.stop();
        setTimeout(() => recognition.start(), 200);
    }
});

function updateRecognitionSettings() {
    recognition.lang = currentMode === 'en-fi' ? 'en-US' : 'fi-FI';
}

// Mic Button Control
micBtn.addEventListener('click', async () => {
    if (isListening) {
        stopListening();
    } else {
        await startListening();
    }
});

async function startListening() {
    try {
        // First try to get a raw audio stream to prove the mic works
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        initVisualizer(stream);
        
        recognition.start();
        transcriptArea.textContent = '';
        translationArea.textContent = '';
    } catch (err) {
        console.error('Error starting microphone:', err);
        statusMsg.textContent = 'Could not access microphone. Please check permissions.';
    }
}

function stopListening() {
    recognition.stop();
    if (audioCtx) {
        audioCtx.close();
        audioCtx = null;
    }
    cancelAnimationFrame(animationId);
    visualizerContainer.classList.remove('active');
}

function initVisualizer(stream) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    analyser = audioCtx.createAnalyser();
    source = audioCtx.createMediaStreamSource(stream);
    source.connect(analyser);
    
    analyser.fftSize = 256;
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    
    visualizerContainer.classList.add('active');
    
    function draw() {
        animationId = requestAnimationFrame(draw);
        analyser.getByteFrequencyData(dataArray);
        
        canvasCtx.clearRect(0, 0, canvas.width, canvas.height);
        
        const barWidth = (canvas.width / bufferLength) * 2.5;
        let barHeight;
        let x = 0;
        
        for(let i = 0; i < bufferLength; i++) {
            barHeight = dataArray[i] / 2;
            canvasCtx.fillStyle = `rgb(99, 102, 241)`;
            canvasCtx.fillRect(x, canvas.height - barHeight, barWidth, barHeight);
            x += barWidth + 1;
        }
    }
    draw();
}

// Recognition Event Handlers
recognition.onstart = () => {
    isListening = true;
    micBtn.classList.add('active');
    micInstruction.textContent = 'Listening... Tap to stop';
    statusMsg.textContent = '';
};

recognition.onend = () => {
    isListening = false;
    micBtn.classList.remove('active');
    micInstruction.textContent = 'Press to start listening';
    // Visualizer will stop via stopListening if button clicked, 
    // but we also stop it here if recognition ends naturally
    if (audioCtx && audioCtx.state !== 'closed') {
        stopListening();
    }
};

recognition.onresult = (event) => {
    let interimTranscript = '';
    let finalTranscript = '';

    for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (event.results[i].isFinal) {
            finalTranscript += event.results[i][0].transcript;
        } else {
            interimTranscript += event.results[i][0].transcript;
        }
    }

    const currentText = finalTranscript || interimTranscript;
    if (currentText) {
        transcriptArea.textContent = currentText;
        // Debounce translation to avoid hitting API limits too hard
        debounceTranslate(currentText);
    }
};

recognition.onerror = (event) => {
    console.error('Speech recognition error:', event.error);
    if (event.error === 'not-allowed') {
        statusMsg.textContent = 'Microphone permission denied. Please enable it in browser settings.';
    } else if (event.error === 'service-not-allowed') {
        statusMsg.textContent = 'Speech service not allowed. Are you in a secure context (localhost/HTTPS)?';
    } else {
        statusMsg.textContent = `Error: ${event.error}`;
    }
    isListening = false;
    micBtn.classList.remove('active');
};

// Translation Logic
function debounceTranslate(text) {
    if (translationTimeout) clearTimeout(translationTimeout);
    translationTimeout = setTimeout(() => {
        translateText(text);
    }, 500); // Wait 500ms after speech stops to translate
}

async function translateText(text) {
    if (!text.trim()) return;

    const [from, to] = currentMode === 'en-fi' ? ['en', 'fi'] : ['fi', 'en'];
    
    try {
        // Using MyMemory Free API (standard for demo purposes)
        // Note: For production, a paid API like Google or DeepL is recommended for "no latency"
        const response = await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${from}|${to}`);
        const data = await response.json();
        
        if (data.responseData) {
            const translatedText = data.responseData.translatedText;
            translationArea.textContent = translatedText;
            subtitleOverlay.textContent = translatedText;
        } else {
            translationArea.textContent = 'Translation error...';
        }
    } catch (error) {
        console.error('Translation error:', error);
        translationArea.textContent = 'Service unavailable. Check connection.';
    }
}
