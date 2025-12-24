// script.js - central site JS: theme toggle + chef mode + working commands
// Drop this file at the site root and add <script src="script.js"></script> before </body>.

/* ================= THEME (dark) ================= */
function toggleDarkMode() {
    const html = document.documentElement;
    const currentTheme = html.getAttribute('data-theme');
    const newTheme = currentTheme === 'dark' ? '' : 'dark';
    const buttons = document.querySelectorAll('.theme-toggle');
    html.setAttribute('data-theme', newTheme);
    localStorage.setItem('theme', newTheme);
    buttons.forEach(btn => btn.textContent = newTheme === 'dark' ? '☀️' : '🌙');
}
function loadSavedTheme() {
    const savedTheme = localStorage.getItem('theme');
    const buttons = document.querySelectorAll('.theme-toggle');
    if (savedTheme === 'dark') {
        document.documentElement.setAttribute('data-theme', 'dark');
        buttons.forEach(btn => btn.textContent = '☀️');
    } else {
        buttons.forEach(btn => btn.textContent = '🌙');
    }
}

/* ================= CHEF MODE / VOICE / TIMERS ================= */
// Steps - keep in sync with the recipe content
const steps = [
    { title: "Season the vegetables", text: "Mix peppers, onion, garlic, Cajun seasoning, and pepper.", timer: null },
    { title: "Sear the shrimp", text: "Cook 30–60 seconds per side.", timer: 45 },
    { title: "Cook the sausage", text: "Sauté 1 minute.", timer: 60 },
    { title: "Cook the vegetables", text: "Sear 3–4 minutes.", timer: 210 },
    { title: "Build the sauce", text: "Add stock + tomato sauce, simmer 5 minutes.", timer: 300 },
    { title: "Add pasta", text: "Toss 2–3 minutes until coated.", timer: 150 }
];

let currentStepIndex = 0;
let chefMode = false;
let wakeLock = null;
let timerInterval = null;
let timerSeconds = 0;
let timerRunning = false;
let recognition = null;
let recognitionActive = false;
let ingredientsVisible = false;
let videoWakeLock = null;

/* Video wake-lock fallback to keep screen on when Wake Lock API isn't available */
function enableVideoWakeLock() {
    if (videoWakeLock) return;
    videoWakeLock = document.createElement('video');
    videoWakeLock.loop = true;
    videoWakeLock.muted = true;
    videoWakeLock.playsInline = true;
    videoWakeLock.style.cssText = 'position:fixed;opacity:0;pointer-events:none;width:1px;height:1px';
    const c = document.createElement('canvas');
    c.width = c.height = 1;
    c.getContext('2d').fillRect(0,0,1,1);
    c.toBlob(b => {
        videoWakeLock.src = URL.createObjectURL(b);
        videoWakeLock.play().catch(()=>{});
    });
    document.body.appendChild(videoWakeLock);
}
function disableVideoWakeLock() {
    if (videoWakeLock) {
        videoWakeLock.pause();
        videoWakeLock.remove();
        videoWakeLock = null;
    }
}

/* Voice command processing (simple patterns) */
function processVoiceCommand(transcript) {
    const text = transcript.toLowerCase().trim();
    if (/\b(next|continue|forward)\b/.test(text)) {
        nextStep();
        speak("Next step");
        return;
    }
    if (/\b(back|previous)\b/.test(text)) {
        prevStep();
        speak("Going back");
        return;
    }
    if (/\brepeat\b/.test(text)) {
        speakCurrentStep();
        return;
    }
    const stepMatch = text.match(/\bstep\s*(\d+|one|two|three|four|five|six)\b/);
    if (stepMatch) {
        const nums = {one:1,two:2,three:3,four:4,five:5,six:6};
        const num = isNaN(stepMatch[1]) ? nums[stepMatch[1]] : parseInt(stepMatch[1],10);
        if (num >= 1 && num <= steps.length) {
            currentStepIndex = num - 1;
            updateChefMode();
            speakCurrentStep();
            return;
        }
    }
    if (/\b(start|set|begin)\s*(timer|clock)\b/.test(text)) {
        const step = steps[currentStepIndex];
        if (step.timer) {
            startTimer(step.timer);
            speak(`Starting timer for ${Math.floor(step.timer/60)} minutes`);
        } else {
            speak("No timer for this step");
        }
        return;
    }
    if (/\bshow\s*(ingredient|ingredients)\b/.test(text)) {
        if (!ingredientsVisible) toggleIngredientsView();
        speak("Showing ingredients");
        return;
    }
    if (/\bhide\s*(ingredient|ingredients)\b/.test(text)) {
        if (ingredientsVisible) toggleIngredientsView();
        speak("Hiding ingredients");
        return;
    }
    speak("I didn't understand that");
    showVoiceIndicator("Command not recognized");
}

/* Speech recognition setup (if available) */
function setupSpeechRecognition() {
    if (!('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)) return;
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    recognition = new SR();
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = 'en-US';

    recognition.onstart = () => {
        recognitionActive = true;
        const vs = document.getElementById('voiceStatus');
        if (vs) { vs.textContent = '🎤 Listening'; vs.style.background = '#8fd694'; }
    };
    recognition.onerror = (e) => {
        recognitionActive = false;
        const vs = document.getElementById('voiceStatus');
        if (e.error && vs) {
            if (e.error === 'no-speech' || e.error === 'aborted' || e.error === 'audio-capture') return;
            vs.textContent = '🎤 Click to Retry';
            vs.style.background = '#ff4444';
        }
    };
    recognition.onend = () => {
        recognitionActive = false;
        // Auto-restart while chef mode is active
        if (chefMode && !recognitionActive) {
            setTimeout(() => {
                try { recognition.start(); } catch(e) {}
            }, 1000);
        }
    };
    recognition.onresult = (e) => {
        const transcript = e.results[e.results.length-1][0].transcript.trim();
        showVoiceIndicator(`"${transcript}"`);
        processVoiceCommand(transcript);
    };
}

/* Small voice indicator toast */
function showVoiceIndicator(t) {
    const el = document.getElementById('voiceIndicator');
    if (!el) return;
    el.textContent = t || '🎤 Listening...';
    el.classList.add('active');
    setTimeout(() => el.classList.remove('active'), 2800);
}

/* Ingredient toggles (main page) */
function toggleIngredient(el) {
    const cb = el.querySelector('input[type="checkbox"]');
    if (!cb) return;
    cb.checked = !cb.checked;
    el.classList.toggle('checked');
    updateChefIngredients();
}
function toggleChefIngredient(el) {
    const cb = el.querySelector('input[type="checkbox"]');
    const idx = parseInt(el.dataset.index, 10);
    if (!cb) return;
    cb.checked = !cb.checked;
    el.classList.toggle('checked');
    const main = document.querySelectorAll('#ingredientsList .ingredient-item')[idx];
    if (main) {
        main.querySelector('input').checked = cb.checked;
        main.classList.toggle('checked', cb.checked);
    }
}

/* Ingredients panel toggle inside chef mode */
function toggleIngredientsView() {
    ingredientsVisible = !ingredientsVisible;
    const list = document.getElementById('chefIngredientsList');
    const icon = document.getElementById('ingredientsToggleIcon');
    if (list) list.style.display = ingredientsVisible ? 'block' : 'none';
    if (icon) icon.textContent = ingredientsVisible ? '▲' : '▼';
}

/* Enter/Exit chef mode (full-page) */
async function toggleChefMode() {
    const btn = document.getElementById('chefBtn');
    const cont = document.getElementById('chefModeContainer');
    if (!cont) return;
    chefMode = !chefMode;
    if (chefMode) {
        if (btn) btn.classList.add('chef-on');
        cont.classList.add('active');
        cont.setAttribute('aria-hidden','false');
        document.body.style.overflow = 'hidden';
        currentStepIndex = 0;
        updateChefMode();
        renderStepsPreview();
        updateChefIngredients();
        try {
            if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen');
        } catch(e) {
            enableVideoWakeLock();
        }
        if (recognition) {
            try { recognition.start(); } catch(e) {}
        }
        speakCurrentStep();
    } else {
        if (btn) btn.classList.remove('chef-on');
        cont.classList.remove('active');
        cont.setAttribute('aria-hidden','true');
        document.body.style.overflow = 'auto';
        try {
            if (wakeLock) { wakeLock.release(); wakeLock = null; }
        } catch(e) {}
        disableVideoWakeLock();
        if (recognition) { try { recognition.stop(); } catch(e) {} }
        resetTimer();
    }
}

/* Update chef UI content */
function updateChefMode() {
    const s = steps[currentStepIndex];
    const title = document.getElementById('stepTitle');
    const text = document.getElementById('stepText');
    const fill = document.getElementById('progressFill');
    const prevBtn = document.getElementById('prevBtn');
    const nextBtn = document.getElementById('nextBtn');
    if (title) title.textContent = `Step ${currentStepIndex+1}: ${s.title}`;
    if (text) text.textContent = s.text;
    if (fill) fill.style.width = `${((currentStepIndex+1)/steps.length)*100}%`;
    if (prevBtn) prevBtn.disabled = currentStepIndex === 0;
    if (nextBtn) nextBtn.disabled = currentStepIndex === steps.length - 1;
    const ts = document.getElementById('timerSection');
    if (ts) ts.style.display = s.timer ? 'block' : 'none';
    resetTimer();
    renderStepsPreview();
}

/* Navigation */
function nextStep() { if (currentStepIndex < steps.length - 1) { currentStepIndex++; updateChefMode(); speakCurrentStep(); } }
function prevStep() { if (currentStepIndex > 0) { currentStepIndex--; updateChefMode(); speakCurrentStep(); } }

/* Steps preview rendering */
function renderStepsPreview() {
    const c = document.getElementById('stepsPreview');
    if (!c) return;
    c.innerHTML = '';
    steps.forEach((s,i) => {
        const d = document.createElement('div');
        d.className = 'step-preview';
        if (i === currentStepIndex) d.classList.add('active');
        d.innerHTML = `<strong>Step ${i+1}:</strong> ${s.title}`;
        d.onclick = () => { currentStepIndex = i; updateChefMode(); speakCurrentStep(); };
        c.appendChild(d);
    });
}

/* Timer functions */
function startTimer(sec) {
    resetTimer();
    timerSeconds = sec;
    timerRunning = true;
    updateTimerDisplay();
    timerInterval = setInterval(() => {
        if (timerRunning && timerSeconds > 0) {
            timerSeconds--;
            updateTimerDisplay();
            if (timerSeconds === 0) {
                timerRunning = false;
                playTimerSound();
                speak('Timer done!');
            }
        }
    }, 1000);
}
function pauseTimer() {
    timerRunning = !timerRunning;
    const pb = document.querySelector('.timer-buttons button:nth-child(4)');
    if (pb) pb.textContent = timerRunning ? '⏸ Pause' : '▶️ Resume';
}
function resetTimer() {
    if (timerInterval) clearInterval(timerInterval);
    timerSeconds = 0;
    timerRunning = false;
    updateTimerDisplay();
    const pb = document.querySelector('.timer-buttons button:nth-child(4)');
    if (pb) pb.textContent = '⏸ Pause';
}
function updateTimerDisplay() {
    const el = document.getElementById('timerDisplay');
    if (!el) return;
    const m = Math.floor(timerSeconds / 60), s = timerSeconds % 60;
    el.textContent = `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}
function playTimerSound() {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator(), g = ctx.createGain();
        osc.connect(g); g.connect(ctx.destination);
        osc.frequency.value = 800; osc.type = 'sine';
        g.gain.setValueAtTime(0.3, ctx.currentTime);
        g.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5);
        osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.5);
    } catch(e) {}
}

/* Speech / speak */
function speak(txt) {
    if ('speechSynthesis' in window && txt) {
        const u = new SpeechSynthesisUtterance(txt);
        u.rate = 0.9;
        speechSynthesis.cancel();
        speechSynthesis.speak(u);
    }
}
function speakCurrentStep() {
    const s = steps[currentStepIndex];
    speak(`Step ${currentStepIndex+1}: ${s.title}. ${s.text}`);
}
function retryVoice() {
    if (recognition && chefMode) {
        try { recognition.stop(); setTimeout(() => recognition.start(), 500); } catch(e) {}
    }
}

/* Sync chef ingredient list with main page */
function updateChefIngredients() {
    const c = document.getElementById('chefIngredientsContent');
    if (!c) return;
    c.innerHTML = '';
    document.querySelectorAll('#ingredientsList .ingredient-item').forEach((it,i) => {
        const d = document.createElement('div');
        d.className = 'chef-ingredient-item';
        d.dataset.index = i;
        const cb = document.createElement('input'); cb.type = 'checkbox';
        cb.checked = !!it.querySelector('input')?.checked;
        const sp = document.createElement('span'); sp.textContent = it.querySelector('span')?.textContent || '';
        if (it.classList.contains('checked')) d.classList.add('checked');
        d.appendChild(cb); d.appendChild(sp);
        d.onclick = () => toggleChefIngredient(d);
        c.appendChild(d);
    });
}

/* Print */
function printRecipe() { window.print(); }

/* WORKING COMMANDS MODAL (above chef mode) */
function showWorkingCommandsModal() {
    const m = document.getElementById('workingCommandsModal');
    if (!m) return;
    m.classList.add('active');
    m.setAttribute('aria-hidden','false');
    document.body.style.overflow = 'hidden'; // keep page from scrolling
    const closeBtn = m.querySelector('.working-commands-close');
    if (closeBtn) closeBtn.focus();
    const card = m.querySelector('.working-commands-card');
    if (card) card.addEventListener('click', e => e.stopPropagation());
}
function closeWorkingCommandsModal() {
    const m = document.getElementById('workingCommandsModal');
    if (!m) return;
    m.classList.remove('active');
    m.setAttribute('aria-hidden','true');
    // restore scroll only if chef mode is not active
    document.body.style.overflow = (document.getElementById('chefModeContainer')?.classList.contains('active')) ? 'hidden' : 'auto';
}
/* Backdrop click only closes when clicking the overlay backdrop */
document.addEventListener('click', (e) => {
    const modal = document.getElementById('workingCommandsModal');
    if (!modal || !modal.classList.contains('active')) return;
    if (e.target === modal) closeWorkingCommandsModal();
});

/* Init / DOM wiring */
window.addEventListener('DOMContentLoaded', () => {
    // Theme buttons
    loadSavedTheme();
    document.querySelectorAll('.theme-toggle').forEach(btn => {
        btn.addEventListener('click', toggleDarkMode);
    });

    // Chef mode button (if present)
    const chefBtn = document.getElementById('chefBtn');
    if (chefBtn) chefBtn.addEventListener('click', toggleChefMode);

    // Working commands open/close (in chef, button has class working-commands-btn)
    document.querySelectorAll('.working-commands-btn').forEach(b => b.addEventListener('click', showWorkingCommandsModal));
    document.querySelectorAll('.working-commands-close').forEach(b => b.addEventListener('click', closeWorkingCommandsModal));

    // Wire up ingredient toggles on main page if present
    document.querySelectorAll('#ingredientsList .ingredient-item').forEach(el => {
        el.addEventListener('click', () => toggleIngredient(el));
    });

    // Wire up retry voice status if present
    const vs = document.getElementById('voiceStatus');
    if (vs) vs.addEventListener('click', retryVoice);

    // Prepare speech recognition but only start when chef mode opens
    setupSpeechRecognition();

    // Ensure chef ingredient list updates when main checklist changes (use input/change)
    const ingList = document.getElementById('ingredientsList');
    if (ingList) ingList.addEventListener('change', updateChefIngredients);
});
