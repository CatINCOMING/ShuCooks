// script.js - central site JS: theme toggle + chef mode + working commands
// Place this file in the site root and add <script src="script.js"></script> before </body>.

/* ================= THEME (dark) ================= */
let previousThemeBeforeChef = null;
let voiceMuted = false;

function toggleDarkMode() {
    const html = document.documentElement;
    const currentTheme = html.getAttribute('data-theme');
    const newTheme = currentTheme === 'dark' ? '' : 'dark';
    applyTheme(newTheme);
}

function applyTheme(theme) {
    const html = document.documentElement;
    html.setAttribute('data-theme', theme || '');
    localStorage.setItem('theme', theme || '');
    document.querySelectorAll('.theme-toggle').forEach(btn => {
        btn.textContent = theme === 'dark' ? '☀️' : '🌙';
    });
}

function loadSavedTheme() {
    const savedTheme = localStorage.getItem('theme');
    applyTheme(savedTheme);
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

/* Speech / speak with mute support */
function speak(txt) {
    if (voiceMuted) return;
    if ('speechSynthesis' in window && txt) {
        const u = new SpeechSynthesisUtterance(txt);
        u.rate = 0.95;
        speechSynthesis.cancel();
        speechSynthesis.speak(u);
    }
}

/* ================== VOICE COMMAND PROCESSING (expanded list) ================== */
function parseNumber(text) {
    // simple numbers for minutes/steps (digits or words up to 60)
    const words = {
        zero:0, one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10,
        eleven:11,twelve:12,thirteen:13,fourteen:14,fifteen:15,sixteen:16,seventeen:17,eighteen:18,nineteen:19,twenty:20,
        thirty:30,forty:40,fifty:50,sixty:60
    };
    const digitMatch = text.match(/(\d+)/);
    if (digitMatch) return parseInt(digitMatch[1], 10);
    // sum words e.g. "twenty five"
    const parts = text.toLowerCase().split(/[\s-]+/);
    let total = 0;
    parts.forEach(p => {
        if (words[p] !== undefined) total += words[p];
    });
    return total || null;
}

function processVoiceCommand(transcript) {
    const text = transcript.toLowerCase().trim();
    console.log('Processing voice:', text);

    // Basic navigation
    if (/\b(next|continue|forward)\b/.test(text)) { nextStep(); speak("Next step"); return; }
    if (/\b(back|previous|go back)\b/.test(text)) { prevStep(); speak("Going back"); return; }
    if (/\brepeat\b/.test(text)) { speakCurrentStep(); return; }
    if (/\b(current step|what is (the )?step)\b/.test(text)) { speakCurrentStep(); return; }

    // Jump to step: "go to step 3" or "jump to step three"
    let stepMatch = text.match(/\b(step|go to step|jump to step)\s*(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\b/);
    if (stepMatch) {
        const n = parseNumber(stepMatch[2]) || parseInt(stepMatch[2],10);
        if (n && n >=1 && n <= steps.length) {
            currentStepIndex = n - 1;
            updateChefMode();
            speakCurrentStep();
            return;
        }
    }

    // Start timer: "start timer" or "set timer for 2 minutes"
    if (/\b(start|set|begin)\s*(timer|clock)\b/.test(text)) {
        // try to parse custom duration "set timer for 2 minutes"
        const m = text.match(/(\d+|one|two|three|four|five|ten|fifteen|twenty|thirty)\s*(seconds|second|minutes|minute|mins|min)/);
        if (m) {
            const num = parseNumber(m[1]) || parseInt(m[1],10);
            const unit = m[2];
            let sec = num;
            if (/min|minute/.test(unit)) sec = num * 60;
            if (/sec/.test(unit)) sec = num;
            startTimer(sec);
            speak(`Starting timer for ${num} ${unit}`);
            return;
        }
        // fallback to step timer if available
        const step = steps[currentStepIndex];
        if (step.timer) { startTimer(step.timer); speak(`Starting timer for ${Math.round(step.timer/60)} minutes`); return; }
        speak("No timer for this step");
        return;
    }

    // Pause/resume timer
    if (/\b(pause|hold)\b.*timer\b/.test(text) || /\bpause\b/.test(text) && /\btimer\b/.test(text)) { if (timerRunning) { pauseTimer(); speak("Timer paused"); } else { speak("Timer is not running"); } return; }
    if (/\b(resume|continue)\b.*timer\b/.test(text) || /\bresume\b/.test(text) && /\btimer\b/.test(text)) { if (!timerRunning && timerSeconds>0) { pauseTimer(); speak("Timer resumed"); } else { speak("No timer to resume"); } return; }
    if (/\b(reset|stop)\b.*timer\b/.test(text)) { resetTimer(); speak("Timer reset"); return; }

    // Ingredients visibility
    if (/\b(show|display|reveal)\b.*ingredients?\b/.test(text)) { if (!ingredientsVisible) toggleIngredientsView(); speak("Showing ingredients"); return; }
    if (/\b(hide|dismiss|close)\b.*ingredients?\b/.test(text)) { if (ingredientsVisible) toggleIngredientsView(); speak("Hiding ingredients"); return; }

    // Ingredient size controls
    if (/\b(increase|bigger|larger|zoom in|zoom)\b.*ingredients?\b/.test(text) || /\bincrease the size of the ingredients\b/.test(text)) { increaseIngredientsSize(); speak("Increasing ingredient text size"); return; }
    if (/\b(decrease|smaller|shrink|zoom out)\b.*ingredients?\b/.test(text)) { decreaseIngredientsSize(); speak("Decreasing ingredient text size"); return; }
    if (/\b(reset|normal|default)\b.*ingredients?\b/.test(text)) { resetIngredientsSize(); speak("Ingredient text size reset"); return; }

    // Check/uncheck ingredient by number "check off ingredient 2" or "check ingredient two"
    let checkNum = text.match(/\b(check( off)?|tick)\b.*ingredient\s*(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\b/);
    if (checkNum) {
        const n = parseNumber(checkNum[3]) || parseInt(checkNum[3],10);
        if (n) { toggleIngredientByIndex(n-1, true); speak(`Checked ingredient ${n}`); } else speak("Couldn't find that ingredient number");
        return;
    }
    let uncheckNum = text.match(/\b(uncheck|undo|untick|uncheck off)\b.*ingredient\s*(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\b/);
    if (uncheckNum) {
        const n = parseNumber(uncheckNum[2]) || parseInt(uncheckNum[2],10);
        if (n) { toggleIngredientByIndex(n-1, false); speak(`Unchecked ingredient ${n}`); } else speak("Couldn't find that ingredient number");
        return;
    }

    // Check/uncheck by name: "check off the shrimp" or "uncheck shrimp"
    let checkName = text.match(/\b(check|check off|tick)\b.*the?\s*([a-z0-9 ,'-]+)$/);
    if (checkName) {
        const name = checkName[2].trim();
        if (toggleIngredientByName(name, true)) speak(`Checked ${name}`); else speak(`Couldn't find ${name}`);
        return;
    }
    let uncheckName = text.match(/\b(uncheck|undo|untick)\b.*the?\s*([a-z0-9 ,'-]+)$/);
    if (uncheckName) {
        const name = uncheckName[2].trim();
        if (toggleIngredientByName(name, false)) speak(`Unchecked ${name}`); else speak(`Couldn't find ${name}`);
        return;
    }

    // Read ingredients or read first N ingredients
    if (/\b(read|say|list)\b.*ingredients?\b/.test(text)) {
        const nMatch = text.match(/first\s*(\d+|one|two|three|four|five)/);
        if (nMatch) {
            const n = parseNumber(nMatch[1]) || parseInt(nMatch[1], 10);
            readFirstNIngredients(n);
        } else {
            readAllIngredients();
        }
        return;
    }

    // Mute/unmute voice
    if (/\b(mute|silence)\b( speech| voice)?\b/.test(text)) { voiceMuted = true; speak("Muted"); return; }
    if (/\b(unmute|sound on|speak)\b/.test(text)) { voiceMuted = false; speak("Unmuted"); return; }

    // Start/stop listening
    if (/\b(stop listening|don't listen|disable voice)\b/.test(text)) { if (recognition) { recognition.stop(); speak("Stopped listening"); } return; }
    if (/\b(start listening|listen|enable voice)\b/.test(text)) { if (recognition && chefMode) { try{ recognition.start(); } catch(e){} speak("Listening"); } return; }

    // Working commands modal and list commands
    if (/\b(open|show)\b.*(working commands|commands list|commands)\b/.test(text) || /\blist commands\b/.test(text)) { showWorkingCommandsModal(); speak("Opening command list"); return; }
    if (/\b(close|hide|dismiss)\b.*(commands|working commands|command list)\b/.test(text)) { closeWorkingCommandsModal(); speak("Closing command list"); return; }

    // Toggle chef mode via voice
    if (/\b(open chef mode|enter chef mode|start chef)\b/.test(text)) { if (!chefMode) toggleChefMode(); return; }
    if (/\b(exit chef mode|leave chef mode|close chef)\b/.test(text)) { if (chefMode) toggleChefMode(); return; }

    // Increase/decrease font size globally while chef mode active
    if (/\b(increase|bigger|larger)\b.*text\b/.test(text)) { document.documentElement.style.fontSize = (parseFloat(getComputedStyle(document.documentElement).fontSize) + 1) + 'px'; speak("Increased page text size"); return; }
    if (/\b(decrease|smaller|shrink)\b.*text\b/.test(text)) { document.documentElement.style.fontSize = (parseFloat(getComputedStyle(document.documentElement).fontSize) - 1) + 'px'; speak("Decreased page text size"); return; }

    // If not recognized
    speak("I didn't understand that command");
    showVoiceIndicator("Command not recognized");
}

/* =========== Helper functions for ingredient toggles and reading =========== */
function toggleIngredientByIndex(index, checkValue) {
    const items = document.querySelectorAll('#ingredientsList .ingredient-item');
    if (!items || index < 0 || index >= items.length) return false;
    const el = items[index];
    const cb = el.querySelector('input[type="checkbox"]');
    if (cb) cb.checked = !!checkValue;
    el.classList.toggle('checked', !!checkValue);
    updateChefIngredients();
    return true;
}
function toggleIngredientByName(name, checkValue) {
    const items = Array.from(document.querySelectorAll('#ingredientsList .ingredient-item'));
    const found = items.find(it => (it.textContent || '').toLowerCase().includes(name.toLowerCase()));
    if (!found) return false;
    const cb = found.querySelector('input[type="checkbox"]');
    if (cb) cb.checked = !!checkValue;
    found.classList.toggle('checked', !!checkValue);
    updateChefIngredients();
    return true;
}
function readAllIngredients() {
    const items = Array.from(document.querySelectorAll('#ingredientsList .ingredient-item span')).map(s => s.textContent.trim());
    if (!items.length) { speak("No ingredients found"); return; }
    speak("Ingredients are: " + items.join(', '));
}
function readFirstNIngredients(n) {
    const items = Array.from(document.querySelectorAll('#ingredientsList .ingredient-item span')).slice(0, n).map(s=>s.textContent.trim());
    if (!items.length) { speak("No ingredients found"); return; }
    speak("First " + items.length + " ingredients: " + items.join(', '));
}

/* ========== Ingredient size controls (chef) ========== */
let ingredientSizeStep = 0; // negative smaller, positive larger
function updateIngredientsSizeClass(rootEl) {
    rootEl.classList.remove('larger-1','larger-2','larger-3','smaller-1','smaller-2');
    if (ingredientSizeStep >= 3) rootEl.classList.add('larger-3');
    else if (ingredientSizeStep === 2) rootEl.classList.add('larger-2');
    else if (ingredientSizeStep === 1) rootEl.classList.add('larger-1');
    else if (ingredientSizeStep === -1) rootEl.classList.add('smaller-1');
    else if (ingredientSizeStep <= -2) rootEl.classList.add('smaller-2');
}
function increaseIngredientsSize() {
    ingredientSizeStep = Math.min(3, ingredientSizeStep + 1);
    const root = document.querySelector('.chef-ingredients-root');
    if (root) updateIngredientsSizeClass(root);
}
function decreaseIngredientsSize() {
    ingredientSizeStep = Math.max(-2, ingredientSizeStep - 1);
    const root = document.querySelector('.chef-ingredients-root');
    if (root) updateIngredientsSizeClass(root);
}
function resetIngredientsSize() {
    ingredientSizeStep = 0;
    const root = document.querySelector('.chef-ingredients-root');
    if (root) updateIngredientsSizeClass(root);
}

/* =========== Speech recognition setup =========== */
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
        console.log('Heard:', transcript);
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
    const themeButtons = document.querySelectorAll('.theme-toggle');

    if (!cont) return;
    chefMode = !chefMode;
    if (chefMode) {
        // store previous theme and force dark for chef mode
        previousThemeBeforeChef = document.documentElement.getAttribute('data-theme') || '';
        applyTheme('dark');

        // disable theme toggles while chef mode active (so the chef view remains consistent)
        themeButtons.forEach(b => { b.setAttribute('disabled',''); });

        if (btn) btn.classList.add('chef-on');
        cont.classList.add('active');
        cont.setAttribute('aria-hidden','false');
        document.body.style.overflow = 'hidden';
        currentStepIndex = 0;
        updateChefMode();
        renderStepsPreview();
        updateChefIngredients();
        resetIngredientsSize(); // reset to default

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
        // restore previous theme
        applyTheme(previousThemeBeforeChef || '');
        themeButtons.forEach(b => { b.removeAttribute('disabled'); });

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

/* speak current step */
function speakCurrentStep() {
    const s = steps[currentStepIndex];
    speak(`Step ${currentStepIndex+1}: ${s.title}. ${s.text}`);
}

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
document.addEventListener('click', (e) => {
    const modal = document.getElementById('workingCommandsModal');
    if (!modal || !modal.classList.contains('active')) return;
    if (e.target === modal) closeWorkingCommandsModal();
});

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

    // ensure chef ingredients container has base class for font sizing
    const root = document.querySelector('.chef-ingredients-root');
    if (!root) {
        const holder = document.getElementById('chefIngredientsList');
        if (holder) {
            const r = holder.querySelector('#chefIngredientsContent');
            if (r) r.classList.add('chef-ingredients-root');
            // ensure there's a wrapper element we can add classes on
            const wrapper = holder.querySelector('#chefIngredientsContent');
            if (wrapper && !wrapper.classList.contains('chef-ingredients-root')) wrapper.classList.add('chef-ingredients-root');
        }
    }
}

/* Print */
function printRecipe() { window.print(); }

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
