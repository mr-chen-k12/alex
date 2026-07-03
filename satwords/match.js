const MATCH_INIT_KEY = "sat_vocab_match_initialized";
const MATCH_PENDING_KEY = "sat_vocab_match_pending_results";
const MATCH_ROUND_SIZE = 6;

let matchState = {
  words: [],
  settings: { theme: "dark" },
  history: {},
  roundWords: [],
  selectedWord: null,
  correct: 0,
  attempts: 0,
  startedAt: null,
  results: [],
  matchActionsSupported: false
};

const matchEls = {
  syncStatus: document.getElementById("sync-status"),
  initPanel: document.getElementById("match-init-panel"),
  syncPassword: document.getElementById("sync-password"),
  rememberPassword: document.getElementById("remember-password"),
  btnInitializeMatch: document.getElementById("btn-initialize-match"),
  btnSkipInit: document.getElementById("btn-skip-init"),
  matchSource: document.getElementById("match-source"),
  btnNewRound: document.getElementById("btn-new-round"),
  btnSyncResults: document.getElementById("btn-sync-results"),
  wordCardList: document.getElementById("word-card-list"),
  definitionDropList: document.getElementById("definition-drop-list"),
  correctCount: document.getElementById("match-correct-count"),
  attemptCount: document.getElementById("match-attempt-count"),
  roundSize: document.getElementById("match-round-size"),
  syncState: document.getElementById("match-sync-state"),
  toast: document.getElementById("notification-toast"),
  toastIcon: document.getElementById("toast-icon"),
  toastMessage: document.getElementById("toast-message")
};

document.addEventListener("DOMContentLoaded", async () => {
  hydratePassword();
  await loadMatchState();
  applyMatchTheme();
  setupMatchEvents();
  applySourceFromUrl();
  updateInitPanel();
  startNewMatchRound();
  lucide.createIcons();
});

function hydratePassword() {
  const savedPassword = SheetsService.getSavedPassword();
  if (savedPassword) {
    matchEls.syncPassword.value = savedPassword;
    matchEls.rememberPassword.checked = true;
  }
}

async function loadMatchState() {
  try {
    const cloudState = await SheetsService.fetchState();
    if (cloudState && Array.isArray(cloudState.words)) {
      matchState.words = cloudState.words.map(normalizeWord).filter(word => word.word && word.definition);
      matchState.settings = cloudState.settings || matchState.settings;
      matchState.history = cloudState.history || {};
      matchState.matchActionsSupported = cloudState.matchActionsSupported === true || Number(cloudState.apiVersion || 0) >= 2;
      localStorage.setItem("sat_vocab_state", JSON.stringify(cloudState));
      setSyncStatus(true);
      return;
    }
  } catch (error) {
    console.warn("Match page using local/offline data:", error);
  }

  const localState = localStorage.getItem("sat_vocab_state");
  if (localState) {
    try {
      const parsed = JSON.parse(localState);
      matchState.words = (parsed.words || []).map(normalizeWord).filter(word => word.word && word.definition);
      matchState.settings = parsed.settings || matchState.settings;
      matchState.history = parsed.history || {};
    } catch (error) {
      matchState.words = [];
    }
  }

  if (matchState.words.length === 0 && typeof DEFAULT_SAT_WORDS !== "undefined") {
    matchState.words = DEFAULT_SAT_WORDS.map(word => normalizeWord({ ...word, stage: 0, custom: false }));
  }
  setSyncStatus(SheetsService.isUnlocked());
}

function normalizeWord(word) {
  return {
    word: String(word.word || "").trim(),
    pos: String(word.pos || "noun").trim(),
    definition: String(word.definition || "").trim(),
    example: String(word.example || "").trim(),
    stage: Number(word.stage || 0),
    lastReviewed: word.lastReviewed || null,
    nextReviewDate: word.nextReviewDate || null,
    custom: word.custom === true || String(word.custom).toLowerCase() === "true"
  };
}

function applyMatchTheme() {
  document.documentElement.setAttribute("data-theme", matchState.settings.theme === "light" ? "light" : "dark");
}

function setupMatchEvents() {
  matchEls.btnInitializeMatch.addEventListener("click", initializeMatchSync);
  matchEls.btnSkipInit.addEventListener("click", () => {
    localStorage.setItem(MATCH_INIT_KEY, "local");
    updateInitPanel();
    showToast("Matching game will store results locally for now.", "info", "var(--warning)");
  });
  matchEls.btnNewRound.addEventListener("click", startNewMatchRound);
  matchEls.btnSyncResults.addEventListener("click", syncPendingResults);
  matchEls.matchSource.addEventListener("change", startNewMatchRound);
}

function applySourceFromUrl() {
  const source = new URLSearchParams(window.location.search).get("source");
  if (!source) return;
  const option = matchEls.matchSource.querySelector(`option[value="${cssEscape(source)}"]`);
  if (option) matchEls.matchSource.value = source;
}

async function initializeMatchSync() {
  if (!unlockFromMatchPassword()) return;
  if (!matchState.matchActionsSupported) {
    showToast("Paste and redeploy google_apps_script_with_match.gs first, then reload this page.", "alert-triangle", "var(--warning)");
    return;
  }

  try {
    await SheetsService.initializeMatchSync();
    localStorage.setItem(MATCH_INIT_KEY, "cloud");
    setSyncStatus(true);
    updateInitPanel();
    showToast("MatchStats setup request sent to Google Sheets.", "cloud-check", "var(--success)");
  } catch (error) {
    showToast("Could not initialize MatchStats. Check the Apps Script update.", "alert-triangle", "var(--danger)");
  }
}

function unlockFromMatchPassword() {
  const password = matchEls.syncPassword.value.trim();
  if (!password) {
    showToast("Enter the sheet password first.", "lock", "var(--warning)");
    return false;
  }
  const unlocked = SheetsService.unlockWithPassword(password, matchEls.rememberPassword.checked);
  setSyncStatus(unlocked);
  if (!unlocked) showToast("Password did not unlock the Sheet connection.", "lock-keyhole", "var(--danger)");
  return unlocked;
}

function updateInitPanel() {
  if (matchState.settings && matchState.settings.matchInitialized) {
    localStorage.setItem(MATCH_INIT_KEY, "cloud");
  }
  const initialized = localStorage.getItem(MATCH_INIT_KEY);
  matchEls.initPanel.style.display = initialized ? "none" : "flex";
}

function startNewMatchRound() {
  const sourceWords = getSourceWords(matchEls.matchSource.value);
  if (sourceWords.length < 3) {
    showToast("Add at least three words to play matching.", "alert-triangle", "var(--warning)");
    return;
  }

  const shuffled = shuffle([...sourceWords]);
  matchState.roundWords = shuffled.slice(0, Math.min(MATCH_ROUND_SIZE, shuffled.length));
  matchState.selectedWord = null;
  matchState.correct = 0;
  matchState.attempts = 0;
  matchState.startedAt = Date.now();
  matchState.results = [];
  renderMatchRound();
  updateScoreboard();
  if (matchEls.matchSource.value === "mastered" && sourceWords.filter(word => word.stage === 5).length < 3) {
    showToast("Not enough mastered words yet, so this round uses your broader word bank.", "info", "var(--warning)");
  }
}

function getSourceWords(source) {
  if (source === "mastered") {
    const mastered = matchState.words.filter(word => word.stage === 5);
    return mastered.length >= 3 ? mastered : matchState.words;
  }
  if (source === "custom") {
    return matchState.words.filter(word => word.custom);
  }
  if (source === "learning") {
    return matchState.words.filter(word => word.stage > 0 && word.stage < 5);
  }
  if (source === "smart") {
    const learning = matchState.words.filter(word => word.stage > 0 && word.stage < 5);
    const custom = matchState.words.filter(word => word.custom);
    const combined = [...learning, ...custom];
    return uniqueWords(combined.length >= 3 ? combined : matchState.words);
  }
  return matchState.words;
}

function renderMatchRound() {
  matchEls.wordCardList.innerHTML = "";
  matchEls.definitionDropList.innerHTML = "";

  shuffle([...matchState.roundWords]).forEach(word => {
    const card = document.createElement("button");
    card.className = "match-word-card";
    card.draggable = true;
    card.dataset.word = word.word;
    card.innerHTML = `<strong>${escapeHtml(word.word)}</strong><span>${escapeHtml(word.pos || "")}</span>`;
    card.addEventListener("dragstart", event => {
      event.dataTransfer.setData("text/plain", word.word);
      selectWordCard(card, word.word);
    });
    card.addEventListener("click", () => selectWordCard(card, word.word));
    matchEls.wordCardList.appendChild(card);
  });

  shuffle([...matchState.roundWords]).forEach(word => {
    const drop = document.createElement("button");
    drop.className = "match-definition-card";
    drop.dataset.word = word.word;
    drop.innerHTML = `<span>${escapeHtml(word.definition)}</span>`;
    drop.addEventListener("dragover", event => event.preventDefault());
    drop.addEventListener("drop", event => {
      event.preventDefault();
      attemptMatch(event.dataTransfer.getData("text/plain"), word.word);
    });
    drop.addEventListener("click", () => {
      if (matchState.selectedWord) attemptMatch(matchState.selectedWord, word.word);
    });
    matchEls.definitionDropList.appendChild(drop);
  });
}

function selectWordCard(card, word) {
  matchState.selectedWord = word;
  document.querySelectorAll(".match-word-card").forEach(item => item.classList.remove("selected"));
  card.classList.add("selected");
}

function attemptMatch(wordText, definitionWord) {
  const word = matchState.roundWords.find(item => item.word === wordText);
  if (!word) return;

  matchState.attempts += 1;
  const isCorrect = wordText === definitionWord;
  const elapsedMs = Date.now() - matchState.startedAt;
  const stageBefore = word.stage || 0;

  if (isCorrect) {
    word.stage = Math.min(5, stageBefore + 1);
    matchState.correct += 1;
    lockMatchedPair(wordText, definitionWord);
  } else {
    word.stage = Math.max(1, stageBefore - 1);
    markIncorrect(definitionWord);
  }

  matchState.results.push({
    timestamp: new Date().toISOString(),
    mode: "drag_match",
    word: word.word,
    definition: word.definition,
    correct: isCorrect,
    attempts: matchState.attempts,
    elapsedMs,
    stageBefore,
    stageAfter: word.stage,
    custom: word.custom
  });

  updateScoreboard();
  savePendingResults();

  if (matchState.correct === matchState.roundWords.length) {
    showToast("Round complete. Results are ready to sync.", "party-popper", "var(--success)");
    syncPendingResults();
  }
}

function lockMatchedPair(wordText, definitionWord) {
  const wordCard = document.querySelector(`.match-word-card[data-word="${cssEscape(wordText)}"]`);
  const definitionCard = document.querySelector(`.match-definition-card[data-word="${cssEscape(definitionWord)}"]`);
  if (wordCard) {
    wordCard.classList.add("matched");
    wordCard.disabled = true;
  }
  if (definitionCard) {
    definitionCard.classList.add("matched");
    definitionCard.disabled = true;
  }
  matchState.selectedWord = null;
}

function markIncorrect(definitionWord) {
  const definitionCard = document.querySelector(`.match-definition-card[data-word="${cssEscape(definitionWord)}"]`);
  if (!definitionCard) return;
  definitionCard.classList.add("incorrect");
  setTimeout(() => definitionCard.classList.remove("incorrect"), 450);
}

function updateScoreboard() {
  matchEls.correctCount.textContent = matchState.correct;
  matchEls.attemptCount.textContent = matchState.attempts;
  matchEls.roundSize.textContent = matchState.roundWords.length;
  const pending = getPendingResults().length;
  matchEls.syncState.textContent = pending > 0 ? `${pending} pending` : (SheetsService.isUnlocked() ? "Synced" : "Local");
}

function savePendingResults() {
  const pending = getPendingResults();
  localStorage.setItem(MATCH_PENDING_KEY, JSON.stringify([...pending, ...matchState.results.slice(-1)]));
}

function getPendingResults() {
  try {
    return JSON.parse(localStorage.getItem(MATCH_PENDING_KEY) || "[]");
  } catch (error) {
    return [];
  }
}

async function syncPendingResults() {
  if (!unlockFromMatchPassword()) return;
  if (!matchState.matchActionsSupported && !localStorage.getItem(MATCH_INIT_KEY)) {
    showToast("Update Apps Script first, then initialize MatchStats before syncing match results.", "alert-triangle", "var(--warning)");
    return;
  }
  const pending = getPendingResults();
  if (pending.length === 0) {
    showToast("No match results waiting to sync.", "check-circle", "var(--success)");
    return;
  }

  try {
    await SheetsService.saveMatchRound({
      initialized: true,
      results: pending
    });
    localStorage.removeItem(MATCH_PENDING_KEY);
    localStorage.setItem(MATCH_INIT_KEY, "cloud");
    updateScoreboard();
    updateInitPanel();
    setSyncStatus(true);
    showToast("Match results sent to Google Sheets.", "cloud-check", "var(--success)");
  } catch (error) {
    showToast("Could not sync match results yet.", "cloud-off", "var(--warning)");
  }
}

function setSyncStatus(isOnline) {
  matchEls.syncStatus.textContent = isOnline ? "Sheet connected" : "Offline";
  matchEls.syncStatus.classList.toggle("online", Boolean(isOnline));
}

function showToast(message, iconName = "info", color = "var(--primary)") {
  matchEls.toastMessage.textContent = message;
  matchEls.toastIcon.setAttribute("data-lucide", iconName);
  matchEls.toastIcon.style.color = color;
  lucide.createIcons();
  matchEls.toast.classList.add("show");
  setTimeout(() => matchEls.toast.classList.remove("show"), 3200);
}

function uniqueWords(words) {
  const seen = new Set();
  return words.filter(word => {
    const key = word.word.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function shuffle(items) {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[char]);
}

function cssEscape(value) {
  if (window.CSS && CSS.escape) return CSS.escape(value);
  return String(value).replace(/"/g, '\\"');
}
