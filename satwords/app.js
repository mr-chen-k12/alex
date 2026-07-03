// SAT Vocabulary Reviewer Core Application Logic

// Application State Structure
let state = {
  words: [],
  settings: {
    dailyGoal: 5,
    theme: "dark"
  },
  history: {
    streak: 0,
    lastStudyDate: null,
    reviewsToday: 0,
    correctToday: 0,
    incorrectToday: 0,
    completedDates: []
  }
};

// Leitner Spaced Repetition System Intervals (in days)
const SRS_INTERVALS = {
  0: 0,      // Unlearned
  1: 1,      // Stage 1: Review in 1 day
  2: 3,      // Stage 2: Review in 3 days
  3: 7,      // Stage 3: Review in 7 days
  4: 14,     // Stage 4: Review in 14 days
  5: 30      // Stage 5: Mastered, review in 30 days
};

// Session States
let currentSession = {
  type: null, // "learning" or "review"
  words: [],  // list of word objects in current session
  currentIndex: 0,
  flashcardFlipped: false,
  answers: {}, // word -> boolean (true: correct, false: wrong)
  quizAttempts: {} // word -> count of attempts
};

let cardGesture = {
  pointerId: null,
  startX: 0,
  startY: 0,
  currentX: 0,
  currentY: 0,
  dragging: false
};
let suppressNextCardClick = false;

// Elements DOM Cache
const elements = {
  themeToggle: document.getElementById("theme-toggle"),
  themeIcon: document.getElementById("theme-icon"),
  headerWordCount: document.getElementById("header-word-count"),
  syncStatus: document.getElementById("sync-status"),
  syncPassword: document.getElementById("sync-password"),
  rememberPassword: document.getElementById("remember-password"),
  btnSavePassword: document.getElementById("btn-save-password"),
  btnSyncNow: document.getElementById("btn-sync-now"),
  btnPushNow: document.getElementById("btn-push-now"),
  btnClearPassword: document.getElementById("btn-clear-password"),
  
  // Scoreboard
  streakCount: document.getElementById("streak-count"),
  reviewsTodayCount: document.getElementById("reviews-today"),
  dailyProgressBar: document.getElementById("daily-progress-bar"),
  dailyProgressText: document.getElementById("daily-progress-text"),
  
  // Dashboard Action Triggers
  btnStartLearn: document.getElementById("btn-start-learn"),
  btnStartReview: document.getElementById("btn-start-review"),
  btnSmartReview: document.getElementById("btn-smart-review"),
  btnOpenAddModal: document.getElementById("btn-open-add-modal"),
  
  // Queue Dynamic Counts
  learnQueueCount: document.getElementById("learn-queue-count"),
  reviewQueueCount: document.getElementById("review-queue-count"),
  smartReviewCount: document.getElementById("smart-review-count"),
  
  // Views
  dashboardView: document.getElementById("dashboard-view"),
  sessionView: document.getElementById("session-view"),
  
  // Session UI Panels
  sessionTitle: document.getElementById("session-title"),
  sessionProgressText: document.getElementById("session-progress-text"),
  sessionProgressBar: document.getElementById("session-progress-bar"),
  
  // Flashcard Components
  flashcard: document.getElementById("flashcard"),
  cardWord: document.getElementById("card-word"),
  cardPos: document.getElementById("card-pos"),
  cardDefinition: document.getElementById("card-definition"),
  cardExample: document.getElementById("card-example"),
  cardStageBadge: document.getElementById("card-stage-badge"),
  
  // Flashcard Control Triggers
  btnFlip: document.getElementById("btn-flip"),
  actionButtons: document.getElementById("action-buttons"),
  btnCorrect: document.getElementById("btn-correct"),
  btnIncorrect: document.getElementById("btn-incorrect"),
  btnNext: document.getElementById("btn-next"),
  btnPrevCard: document.getElementById("btn-prev-card"),
  btnSessionFlip: document.getElementById("btn-session-flip"),
  btnSessionNext: document.getElementById("btn-session-next"),
  btnExitSession: document.getElementById("btn-exit-session"),
  
  // Management View Table Elements
  wordsTableBody: document.getElementById("words-table-body"),
  searchWords: document.getElementById("search-words"),
  filterStage: document.getElementById("filter-stage"),
  
  // Add New Word Modal Dialog
  addWordDialog: document.getElementById("add-word-dialog"),
  addWordForm: document.getElementById("add-word-form"),
  btnCancelAddWord: document.getElementById("btn-cancel-add-word"),
  
  // Toast Alert Container
  toast: document.getElementById("notification-toast"),
  toastMessage: document.getElementById("toast-message"),
  toastIcon: document.getElementById("toast-icon")
};

// ==========================================
// ASYNC STATE INITIALIZATION & SYNC
// ==========================================

// Asynchronously loads profile from Google Sheet with localStorage offline fallback layers
async function initializeState() {
  try {
    const cloudState = await SheetsService.fetchState();
    
    if (cloudState && cloudState.words && cloudState.words.length > 0) {
      state = normalizeLoadedState(cloudState);
      
      // Inject safety updates for standard built-in vocab terms
      const existingWordSet = new Set(state.words.map(w => w.word.toLowerCase()));
      if (typeof DEFAULT_SAT_WORDS !== 'undefined') {
        DEFAULT_SAT_WORDS.forEach(defaultWord => {
          if (!existingWordSet.has(defaultWord.word.toLowerCase())) {
            state.words.push({
              ...defaultWord,
              stage: 0,
              lastReviewed: null,
              nextReviewDate: null,
              custom: false
            });
          }
        });
      }
      // Save local backup reference
      localStorage.setItem("sat_vocab_state", JSON.stringify(state));
      if (typeof showToast === 'function') {
        showToast("Cloud profile loaded successfully!", "cloud-check", "var(--success)");
      }
      updateSyncStatus(true);
    } else {
      await fallbackToLocalOrReset();
      updateSyncStatus(false);
    }
  } catch (e) {
    console.warn("Cloud infrastructure unreachable, defaulting to offline cache:", e);
    await fallbackToLocalOrReset();
    updateSyncStatus(false);
  }
  
  validateStreak();
}

async function fallbackToLocalOrReset() {
  const savedState = localStorage.getItem("sat_vocab_state");
  if (savedState) {
    try {
      state = normalizeLoadedState(JSON.parse(savedState));
    } catch(err) {
      resetToDefaultState();
    }
  } else {
    resetToDefaultState();
  }
}

function resetToDefaultState() {
  state.words = typeof DEFAULT_SAT_WORDS !== 'undefined' ? DEFAULT_SAT_WORDS.map(w => ({
    ...w,
    stage: 0,
    lastReviewed: null,
    nextReviewDate: null,
    custom: false
  })) : [];
  state.settings = { dailyGoal: 5, theme: "dark" };
  state.history = {
    streak: 0,
    lastStudyDate: null,
    reviewsToday: 0,
    correctToday: 0,
    incorrectToday: 0,
    completedDates: []
  };
  localStorage.setItem("sat_vocab_state", JSON.stringify(state));
}

function normalizeLoadedState(loadedState) {
  const loadedWords = Array.isArray(loadedState.words) ? loadedState.words : [];
  return {
    words: loadedWords.map(normalizeWordRecord).filter(word => word.word && word.definition),
    settings: {
      dailyGoal: Number(loadedState.settings?.dailyGoal) || 5,
      theme: loadedState.settings?.theme === "light" ? "light" : "dark"
    },
    history: {
      streak: Number(loadedState.history?.streak) || 0,
      lastStudyDate: loadedState.history?.lastStudyDate || null,
      reviewsToday: Number(loadedState.history?.reviewsToday) || 0,
      correctToday: Number(loadedState.history?.correctToday) || 0,
      incorrectToday: Number(loadedState.history?.incorrectToday) || 0,
      completedDates: Array.isArray(loadedState.history?.completedDates) ? loadedState.history.completedDates : []
    }
  };
}

function normalizeWordRecord(word) {
  const stage = Number(word.stage ?? word.Stage ?? 0);
  return {
    word: String(word.word ?? word.Word ?? "").trim(),
    pos: String(word.pos ?? word.partOfSpeech ?? word["Part of Speech"] ?? "noun").trim(),
    definition: String(word.definition ?? word.Definition ?? "").trim(),
    example: String(word.example ?? word.Example ?? word["Example Sentence"] ?? "").trim(),
    stage: Number.isFinite(stage) ? Math.max(0, Math.min(stage, 5)) : 0,
    lastReviewed: normalizeDateValue(word.lastReviewed ?? word["Last Reviewed"]),
    nextReviewDate: normalizeDateValue(word.nextReviewDate ?? word["Next Review Date"]),
    custom: parseBooleanValue(word.custom)
  };
}

function parseBooleanValue(value) {
  return value === true || String(value).toLowerCase() === "true" || String(value) === "1";
}

function normalizeDateValue(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return formatDateString(value);
  }
  
  const text = String(value).trim();
  if (!text) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) {
    return text.slice(0, 10);
  }
  
  const parsedDate = new Date(text);
  if (!Number.isNaN(parsedDate.getTime())) {
    return formatDateString(parsedDate);
  }
  
  return null;
}

// Saves local runtime frame instantaneously and silently syncs sheet in background
function saveState() {
  localStorage.setItem("sat_vocab_state", JSON.stringify(state));
  
  return SheetsService.saveState(state)
    .then((didSync) => {
      updateSyncStatus(Boolean(didSync));
      if (didSync) console.log("Google Sheets database synchronized fully.");
      return didSync;
    })
    .catch(err => {
      updateSyncStatus(false);
      console.error("Google Sheets database sync deferred:", err);
      return false;
    });
}

async function syncNow() {
  if (!unlockFromPasswordInput()) return;
  
  try {
    showToast("Syncing Google Sheet...", "refresh-cw", "var(--primary)");
    const cloudState = await SheetsService.fetchState();
    if (cloudState && cloudState.words) {
      state = normalizeLoadedState(cloudState);
      localStorage.setItem("sat_vocab_state", JSON.stringify(state));
      validateStreak();
      applySettings();
      updateUI();
      updateSyncStatus(true);
      showToast("Google Sheet synced.", "cloud-check", "var(--success)");
    }
  } catch (error) {
    updateSyncStatus(false);
    showToast("Could not sync Google Sheet. Check the password.", "alert-triangle", "var(--danger)");
  }
}

async function pushLocalNow() {
  if (!unlockFromPasswordInput()) return;
  
  showToast("Pushing local vocabulary to Google Sheet...", "upload-cloud", "var(--primary)");
  const didSync = await saveState();
  if (didSync) {
    showToast("Local vocabulary pushed to Google Sheet.", "cloud-check", "var(--success)");
  } else {
    showToast("Push failed. Check the saved password and Apps Script deployment.", "alert-triangle", "var(--danger)");
  }
}

function unlockFromPasswordInput() {
  const password = elements.syncPassword.value.trim();
  const remember = elements.rememberPassword.checked;
  
  if (!password) {
    showToast("Enter the sheet password first.", "lock", "var(--warning)");
    return false;
  }
  
  if (!SheetsService.unlockWithPassword(password, remember)) {
    updateSyncStatus(false);
    showToast("Password did not unlock the Sheet connection.", "lock-keyhole", "var(--danger)");
    return false;
  }
  
  if (remember) {
    elements.syncPassword.value = password;
  }
  updateSyncStatus(true);
  showToast(remember ? "Password saved for this device." : "Sheet unlocked for this session.", "unlock", "var(--success)");
  return true;
}

function hydrateSyncControls() {
  const savedPassword = SheetsService.getSavedPassword();
  if (savedPassword) {
    elements.syncPassword.value = savedPassword;
    elements.rememberPassword.checked = true;
  }
  updateSyncStatus(SheetsService.isUnlocked());
}

function updateSyncStatus(isOnline) {
  if (!elements.syncStatus) return;
  elements.syncStatus.textContent = isOnline ? "Sheet connected" : "Offline";
  elements.syncStatus.classList.toggle("online", Boolean(isOnline));
}

// Check and maintain streaks across daily calendar logs
function validateStreak() {
  const today = getTodayDateString();
  const yesterday = getYesterdayDateString();
  
  if (!state.history.completedDates) {
    state.history.completedDates = [];
  }
  
  if (state.history.lastStudyDate) {
    if (state.history.lastStudyDate !== today && state.history.lastStudyDate !== yesterday) {
      state.history.streak = 0;
    }
  }
  
  if (state.history.lastStudyDate !== today) {
    state.history.reviewsToday = 0;
    state.history.correctToday = 0;
    state.history.incorrectToday = 0;
  }
}

// ==========================================
// CORE DOM EVENT LISTENERS
// ==========================================
function setupEventListeners() {
  // Google Sheet password controls
  elements.btnSavePassword.addEventListener("click", unlockFromPasswordInput);
  elements.btnSyncNow.addEventListener("click", syncNow);
  elements.btnPushNow.addEventListener("click", pushLocalNow);
  elements.btnClearPassword.addEventListener("click", () => {
    SheetsService.clearSavedPassword();
    elements.syncPassword.value = "";
    elements.rememberPassword.checked = false;
    updateSyncStatus(false);
    showToast("Saved sheet password cleared.", "lock-keyhole", "var(--warning)");
  });
  
  // Theme Toggle Listener
  elements.themeToggle.addEventListener("change", () => {
    state.settings.theme = elements.themeToggle.checked ? "light" : "dark";
    applySettings();
    saveState();
  });
  
  // Dashboard Action Session Triggers
  elements.btnStartLearn.addEventListener("click", () => startSession("learning"));
  elements.btnStartReview.addEventListener("click", () => startSession("review"));
  elements.btnSmartReview.addEventListener("click", startSmartReview);
  
  // Flashcard Control Hooks
  elements.btnFlip.addEventListener("click", flipCard);
  elements.btnSessionFlip.addEventListener("click", flipCard);
  elements.flashcard.addEventListener("click", (e) => {
    if (suppressNextCardClick) {
      suppressNextCardClick = false;
      return;
    }
    if (!cardGesture.dragging && !e.target.closest('button')) flipCard();
  });
  elements.flashcard.addEventListener("pointerdown", handleCardPointerDown);
  elements.flashcard.addEventListener("pointermove", handleCardPointerMove);
  elements.flashcard.addEventListener("pointerup", handleCardPointerUp);
  elements.flashcard.addEventListener("pointercancel", resetCardGesture);
  
  elements.btnCorrect.addEventListener("click", () => handleAnswer(true));
  elements.btnIncorrect.addEventListener("click", () => handleAnswer(false));
  elements.btnNext.addEventListener("click", nextCard);
  elements.btnPrevCard.addEventListener("click", previousCard);
  elements.btnSessionNext.addEventListener("click", nextCard);
  elements.btnExitSession.addEventListener("click", exitSession);
  document.addEventListener("keydown", handleKeyboardShortcuts);
  
  // Filtering & Search Listeners
  elements.searchWords.addEventListener("input", updateWordsTable);
  elements.filterStage.addEventListener("change", updateWordsTable);
  
  // Word Adding Modal Management
  elements.btnOpenAddModal.addEventListener("click", () => elements.addWordDialog.showModal());
  elements.btnCancelAddWord.addEventListener("click", () => {
    elements.addWordForm.reset();
    elements.addWordDialog.close();
  });
  
  elements.addWordForm.addEventListener("submit", handleAddWord);
}

function applySettings() {
  const isLight = state.settings.theme === "light";
  document.documentElement.setAttribute("data-theme", isLight ? "light" : "dark");
  elements.themeToggle.checked = isLight;
  
  if (isLight) {
    elements.themeIcon.setAttribute("data-lucide", "moon");
  } else {
    elements.themeIcon.setAttribute("data-lucide", "sun");
  }
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

// ==========================================
// LEITNER QUEUE GENERATION LOGIC
// ==========================================
function getQueues() {
  const todayStr = getTodayDateString();
  const learnQueue = [];
  const reviewQueue = [];
  
  state.words.forEach(word => {
    if (word.stage === 0) {
      learnQueue.push(word);
    } else if (word.nextReviewDate) {
      if (word.nextReviewDate <= todayStr) {
        reviewQueue.push(word);
      }
    } else {
      word.nextReviewDate = todayStr;
      reviewQueue.push(word);
    }
  });
  
  return { learnQueue, reviewQueue };
}

function getSmartReviewQueue() {
  const { reviewQueue } = getQueues();
  if (reviewQueue.length > 0) {
    return reviewQueue.slice(0, 10);
  }
  
  const activeWords = state.words
    .filter(word => word.stage > 0 && word.stage < 5)
    .sort((a, b) => {
      const stageDiff = (a.stage || 0) - (b.stage || 0);
      if (stageDiff !== 0) return stageDiff;
      return String(a.lastReviewed || "").localeCompare(String(b.lastReviewed || ""));
    });
  
  if (activeWords.length > 0) {
    return activeWords.slice(0, 10);
  }
  
  return state.words.filter(word => word.stage === 0).slice(0, state.settings.dailyGoal || 5);
}

function updateUI() {
  const { learnQueue, reviewQueue } = getQueues();
  const smartReviewQueue = getSmartReviewQueue();
  
  elements.headerWordCount.textContent = state.words.length;
  elements.streakCount.textContent = state.history.streak || 0;
  elements.reviewsTodayCount.textContent = state.history.reviewsToday || 0;
  
  elements.learnQueueCount.textContent = `${learnQueue.length} words left`;
  elements.reviewQueueCount.textContent = `${reviewQueue.length} words left`;
  elements.smartReviewCount.textContent = `${smartReviewQueue.length} suggested`;
  
  elements.btnStartLearn.disabled = learnQueue.length === 0;
  elements.btnStartReview.disabled = reviewQueue.length === 0;
  elements.btnSmartReview.disabled = smartReviewQueue.length === 0;
  
  // Progress computation metrics
  const goal = state.settings.dailyGoal || 5;
  const currentProgress = state.history.reviewsToday || 0;
  const progressPercent = Math.min(100, Math.round((currentProgress / goal) * 100));
  
  elements.dailyProgressBar.style.width = `${progressPercent}%`;
  elements.dailyProgressText.textContent = `${progressPercent}% completed (${currentProgress}/${goal} reviews)`;
  
  updateWordsTable();
}

// ==========================================
// SESSION MANAGEMENT FLOW
// ==========================================
function startSession(type) {
  const { learnQueue, reviewQueue } = getQueues();
  let targetWords = type === "learning" ? learnQueue : reviewQueue;
  
  if (targetWords.length === 0) {
    if (typeof showToast === 'function') showToast("No words inside this session queue!", "info", "var(--primary)");
    return;
  }
  
  // Slice target bounds for learning
  if (type === "learning") {
    targetWords = targetWords.slice(0, state.settings.dailyGoal || 5);
  }
  
  currentSession = {
    type: type,
    words: shuffleArray([...targetWords]),
    currentIndex: 0,
    flashcardFlipped: false,
    answers: {},
    quizAttempts: {}
  };
  
  elements.sessionTitle.textContent = type === "learning" ? "New Terms Learning Block" : "Spaced Repetition Review Deck";
  elements.dashboardView.classList.add("hidden");
  elements.sessionView.classList.remove("hidden");
  elements.dashboardView.style.display = "none";
  elements.sessionView.style.display = "flex";
  
  renderCurrentCard();
}

function startSmartReview() {
  const targetWords = getSmartReviewQueue();
  if (targetWords.length === 0) {
    showToast("No words are ready for smart review.", "check-circle", "var(--success)");
    return;
  }
  
  currentSession = {
    type: "smart",
    words: shuffleArray([...targetWords]),
    currentIndex: 0,
    flashcardFlipped: false,
    answers: {},
    quizAttempts: {}
  };
  
  elements.sessionTitle.textContent = "Smart Review Deck";
  elements.dashboardView.classList.add("hidden");
  elements.sessionView.classList.remove("hidden");
  elements.dashboardView.style.display = "none";
  elements.sessionView.style.display = "flex";
  
  renderCurrentCard();
}

function renderCurrentCard() {
  const wordObj = currentSession.words[currentSession.currentIndex];
  if (!wordObj) return;
  
  currentSession.flashcardFlipped = false;
  elements.flashcard.classList.remove("flipped");
  setFlashcardBackVisible(false);
  
  // Inject details into front element panels
  elements.cardWord.textContent = wordObj.word;
  elements.cardPos.textContent = wordObj.pos || "";
  elements.cardDefinition.textContent = wordObj.definition || "";
  elements.cardExample.textContent = wordObj.example ? `"${wordObj.example}"` : "";
  
  // Render Stage Badging labels
  elements.cardStageBadge.className = `stage-badge stage-${wordObj.stage || 0}`;
  elements.cardStageBadge.textContent = wordObj.stage === 5 ? "Mastered" : `Stage ${wordObj.stage || 0}`;
  
  // Update structural trackers
  const total = currentSession.words.length;
  const current = currentSession.currentIndex + 1;
  const progressPercent = Math.round((current / total) * 100);
  
  elements.sessionProgressText.textContent = `Card ${current} of ${total}`;
  elements.sessionProgressBar.style.width = `${progressPercent}%`;
  
  elements.btnFlip.classList.remove("hidden");
  elements.btnFlip.textContent = "Show Answer";
  elements.actionButtons.classList.add("hidden");
  elements.actionButtons.style.display = "none";
  elements.btnNext.classList.add("hidden");
  elements.btnPrevCard.disabled = currentSession.currentIndex === 0;
  elements.btnSessionNext.disabled = currentSession.currentIndex >= currentSession.words.length - 1;
}

function flipCard() {
  if (!currentSession.type) return;
  setFlashcardBackVisible(!currentSession.flashcardFlipped);
}

function setFlashcardBackVisible(isVisible) {
  currentSession.flashcardFlipped = Boolean(isVisible);
  elements.flashcard.classList.toggle("flipped", isVisible);
  const wordObj = currentSession.words[currentSession.currentIndex];
  const alreadyAnswered = Boolean(wordObj && currentSession.answers[wordObj.word] !== undefined);
  
  const backContent = elements.flashcard.querySelector(".back-content");
  if (backContent) {
    backContent.style.display = isVisible ? "block" : "none";
    backContent.style.transform = "none";
    backContent.style.opacity = isVisible ? "1" : "0";
  }
  
  elements.cardWord.style.display = isVisible ? "none" : "";
  elements.cardPos.style.display = isVisible ? "none" : "";
  elements.btnFlip.classList.remove("hidden");
  elements.btnFlip.textContent = isVisible ? "Show Term" : "Show Answer";
  
  if (isVisible && !alreadyAnswered) {
    elements.actionButtons.classList.remove("hidden");
    elements.actionButtons.style.display = "flex";
  } else {
    elements.actionButtons.classList.add("hidden");
    elements.actionButtons.style.display = "none";
  }
  
  elements.btnNext.classList.add("hidden");
}

function handleAnswer(isCorrect) {
  const wordObj = currentSession.words[currentSession.currentIndex];
  if (!wordObj || currentSession.answers[wordObj.word] !== undefined) return;
  currentSession.answers[wordObj.word] = isCorrect;
  
  elements.actionButtons.classList.add("hidden");
  elements.actionButtons.style.display = "none";
  elements.btnNext.classList.remove("hidden");
  
  processCurrentAnswer();
}

function processCurrentAnswer() {
  const wordObj = currentSession.words[currentSession.currentIndex];
  if (!wordObj) {
    finishSession();
    return;
  }
  const isCorrect = currentSession.answers[wordObj.word];
  
  // Leitner SRS calculation core logic
  let initialStage = wordObj.stage || 0;
  if (isCorrect) {
    wordObj.stage = Math.min(5, initialStage + 1);
  } else {
    wordObj.stage = Math.max(1, initialStage - 1); // Drop one step, fallback to 1 minimal
  }
  
  const todayStr = getTodayDateString();
  wordObj.lastReviewed = todayStr;
  
  const daysToIncrement = SRS_INTERVALS[wordObj.stage] || 1;
  const nextDate = new Date();
  nextDate.setDate(nextDate.getDate() + daysToIncrement);
  wordObj.nextReviewDate = formatDateString(nextDate);
  
  // Increment history totals
  state.history.reviewsToday = (state.history.reviewsToday || 0) + 1;
  if (isCorrect) state.history.correctToday = (state.history.correctToday || 0) + 1;
  else state.history.incorrectToday = (state.history.incorrectToday || 0) + 1;
  
  currentSession.currentIndex += 1;
  
  if (currentSession.currentIndex < currentSession.words.length) {
    renderCurrentCard();
  } else {
    finishSession();
  }
}

function nextCard() {
  if (!currentSession.type) return;
  if (currentSession.currentIndex < currentSession.words.length - 1) {
    currentSession.currentIndex += 1;
    renderCurrentCard();
  } else {
    showToast("You are on the last card. Mark it correct or incorrect to finish.", "info", "var(--primary)");
  }
}

function previousCard() {
  if (!currentSession.type || currentSession.currentIndex === 0) return;
  currentSession.currentIndex -= 1;
  renderCurrentCard();
}

function answerCurrentCard(isCorrect) {
  if (!currentSession.type) return;
  if (!currentSession.flashcardFlipped) {
    flipCard();
    return;
  }
  handleAnswer(isCorrect);
}

function handleKeyboardShortcuts(event) {
  if (!currentSession.type) return;
  const activeTag = document.activeElement?.tagName?.toLowerCase();
  if (["input", "textarea", "select"].includes(activeTag)) return;
  
  if (event.key === " " || event.key.toLowerCase() === "f") {
    event.preventDefault();
    flipCard();
  } else if (event.key === "ArrowUp" || event.key === "2") {
    event.preventDefault();
    answerCurrentCard(true);
  } else if (event.key === "ArrowDown" || event.key === "1") {
    event.preventDefault();
    answerCurrentCard(false);
  } else if (event.key === "ArrowLeft") {
    event.preventDefault();
    previousCard();
  } else if (event.key === "ArrowRight" || event.key === "Enter") {
    event.preventDefault();
    nextCard();
  } else if (event.key === "Escape") {
    event.preventDefault();
    exitSession();
  }
}

function handleCardPointerDown(event) {
  if (!currentSession.type) return;
  cardGesture = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    currentX: event.clientX,
    currentY: event.clientY,
    dragging: false
  };
  elements.flashcard.setPointerCapture(event.pointerId);
}

function handleCardPointerMove(event) {
  if (cardGesture.pointerId !== event.pointerId) return;
  
  const deltaX = event.clientX - cardGesture.startX;
  const deltaY = event.clientY - cardGesture.startY;
  cardGesture.currentX = event.clientX;
  cardGesture.currentY = event.clientY;
  
  if (Math.abs(deltaX) > 12 || Math.abs(deltaY) > 12) {
    cardGesture.dragging = true;
    const rotate = deltaX / 28;
    elements.flashcard.style.transform = `translate(${deltaX * 0.22}px, ${deltaY * 0.12}px) rotate(${rotate}deg)`;
    elements.flashcard.classList.toggle("swipe-correct", deltaX > 70);
    elements.flashcard.classList.toggle("swipe-again", deltaX < -70);
  }
}

function handleCardPointerUp(event) {
  if (cardGesture.pointerId !== event.pointerId) return;
  
  const deltaX = cardGesture.currentX - cardGesture.startX;
  const deltaY = cardGesture.currentY - cardGesture.startY;
  const wasDragging = cardGesture.dragging;
  resetCardGesture();
  
  if (!wasDragging) return;
  suppressNextCardClick = true;
  
  if (Math.abs(deltaX) > 90 && Math.abs(deltaX) > Math.abs(deltaY)) {
    answerCurrentCard(deltaX > 0);
  } else if (deltaY < -80 || deltaY > 80) {
    flipCard();
  }
  
  setTimeout(() => {
    suppressNextCardClick = false;
  }, 250);
}

function resetCardGesture() {
  elements.flashcard.style.transform = "";
  elements.flashcard.classList.remove("swipe-correct", "swipe-again");
  cardGesture = {
    pointerId: null,
    startX: 0,
    startY: 0,
    currentX: 0,
    currentY: 0,
    dragging: false
  };
}

function finishSession() {
  const todayStr = getTodayDateString();
  state.history.lastStudyDate = todayStr;
  if (!state.history.completedDates) state.history.completedDates = [];
  
  if (!state.history.completedDates.includes(todayStr)) {
    const dailyGoal = state.settings.dailyGoal || 5;
    if (state.history.reviewsToday >= dailyGoal) {
      state.history.completedDates.push(todayStr);
      state.history.streak += 1;
      if (typeof showToast === 'function') showToast(`Daily Goal Hit! Active Streak: ${state.history.streak} days!`, "award", "var(--secondary)");
    } else {
      if (typeof showToast === 'function') showToast("Session complete! Keep reviewing to maintain daily goals.", "check-circle", "var(--success)");
    }
  } else {
    if (typeof showToast === 'function') showToast("Session records updated and pushed successfully.", "check-circle", "var(--success)");
  }
  
  exitSession();
}

function exitSession() {
  currentSession = { type: null, words: [], currentIndex: 0, flashcardFlipped: false, answers: {}, quizAttempts: {} };
  elements.sessionView.classList.add("hidden");
  elements.dashboardView.classList.remove("hidden");
  elements.sessionView.style.display = "none";
  elements.dashboardView.style.display = "";
  setFlashcardBackVisible(false);
  saveState();
  updateUI();
}

// ==========================================
// VOCABULARY BANK DATA TABLE PANEL
// ==========================================
function updateWordsTable() {
  if (!elements.wordsTableBody) return;
  
  const searchQuery = elements.searchWords.value.toLowerCase();
  const filterStageValue = elements.filterStage.value;
  
  elements.wordsTableBody.innerHTML = "";
  
  const filteredWords = state.words.filter(word => {
    const matchesSearch = word.word.toLowerCase().includes(searchQuery) || 
                          word.definition.toLowerCase().includes(searchQuery);
    
    let matchesStage = true;
    if (filterStageValue !== "all") {
      matchesStage = String(word.stage || 0) === filterStageValue;
    }
    
    return matchesSearch && matchesStage;
  });
  
  if (filteredWords.length === 0) {
    elements.wordsTableBody.innerHTML = `<tr><td colspan="5" class="text-center" style="padding: 2rem; color: var(--text-muted);">No vocabulary words found matching filters.</td></tr>`;
    return;
  }
  
  filteredWords.forEach((word, idx) => {
    const tr = document.createElement("tr");
    
    tr.innerHTML = `
      <td><strong>${word.word}</strong></td>
      <td><span class="pos-tag">${word.pos}</span></td>
      <td class="def-cell">${word.definition}</td>
      <td><span class="stage-badge stage-${word.stage || 0}">${word.stage === 5 ? 'Mastered' : 'Stage ' + (word.stage || 0)}</span></td>
      <td>
        <button class="btn-delete-word" data-word="${word.word.replace(/"/g, '&quot;')}" style="background:none; border:none; color:var(--danger); cursor:pointer; padding:4px;">
           <i data-lucide="trash-2" style="width:16px; height:16px;"></i>
        </button>
      </td>
    `;
    
    // Add delete hook attachment
    const deleteBtn = tr.querySelector(".btn-delete-word");
    deleteBtn.addEventListener("click", () => deleteWord(word.word));
    
    elements.wordsTableBody.appendChild(tr);
  });
  
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

async function handleAddWord(e) {
  e.preventDefault();
  
  const wordInput = document.getElementById("new-word-name").value.trim();
  const posInput = document.getElementById("new-word-pos").value;
  const defInput = document.getElementById("new-word-definition").value.trim();
  const exInput = document.getElementById("new-word-example").value.trim();
  
  if (!wordInput || !defInput) {
    if (typeof showToast === 'function') showToast("Missing required structural information fields.", "alert-triangle", "var(--danger)");
    return;
  }
  
  // Duplicate check assertion
  const exists = state.words.some(w => w.word.toLowerCase() === wordInput.toLowerCase());
  if (exists) {
    if (typeof showToast === 'function') showToast("That word configuration is already in your active dictionary.", "alert-triangle", "var(--warning)");
    return;
  }
  
  const newWordObj = {
    word: wordInput,
    pos: posInput,
    definition: defInput,
    example: exInput || null,
    stage: 0,
    lastReviewed: null,
    nextReviewDate: getTodayDateString(),
    custom: true
  };
  
  state.words.push(newWordObj);
  updateUI();
  
  elements.addWordForm.reset();
  elements.addWordDialog.close();
  if (typeof showToast === 'function') showToast(`"${wordInput}" added locally. Syncing Sheet...`, "plus-circle", "var(--primary)");
  
  const didSync = await saveState();
  if (typeof showToast === 'function') {
    if (didSync) {
      showToast(`"${wordInput}" added and sent to Google Sheet.`, "cloud-check", "var(--success)");
    } else {
      showToast(`"${wordInput}" is local only. Save the Sheet password, then press Sync Now.`, "cloud-off", "var(--warning)");
    }
  }
}

function deleteWord(wordName) {
  if (!confirm(`Are you certain you wish to delete "${wordName}"?`)) return;
  
  state.words = state.words.filter(w => w.word.toLowerCase() !== wordName.toLowerCase());
  saveState();
  updateUI();
  if (typeof showToast === 'function') showToast("Word profile expunged from stack.", "trash-2", "var(--danger)");
}

// ==========================================
// APPLICATION LOADER ENGINE CORNER
// ==========================================

// Simple global toast definition so it doesn't break if defined elsewhere previously
window.showToast = function(message, iconName = "info", color = "var(--primary)") {
  if (!elements.toast || !elements.toastMessage || !elements.toastIcon) return;
  elements.toastMessage.textContent = message;
  elements.toastIcon.setAttribute("data-lucide", iconName);
  elements.toastIcon.style.color = color;
  if (typeof lucide !== 'undefined') lucide.createIcons();
  
  elements.toast.classList.add("show");
  setTimeout(() => elements.toast.classList.remove("show"), 3500);
}

document.addEventListener("DOMContentLoaded", async () => {
  hydrateSyncControls();
  
  if (typeof showToast === 'function') {
    showToast("Syncing database profiles...", "refresh-cw", "var(--primary)");
  }
  
  // Await decryption auth parsing handshake from SheetsService
  await initializeState();
  
  applySettings();
  setupEventListeners();
  updateUI();
  
  if (typeof lucide !== 'undefined') {
    lucide.createIcons();
  }
});

// Helper utility functions
function getTodayDateString() { return formatDateString(new Date()); }
function getYesterdayDateString() {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  return formatDateString(yesterday);
}
function formatDateString(dateObj) {
  const yyyy = dateObj.getFullYear();
  const mm = String(dateObj.getMonth() + 1).padStart(2, '0');
  const dd = String(dateObj.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}
function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}
