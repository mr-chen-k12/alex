// sheetsService.js - Encrypted Cloud Sync Layer

// 1. Paste your generated ciphertext string right here:
const ENCRYPTED_SCRIPT_URL = "U2FsdGVkX18Sk2uZus18+GFguFPQqb+7w00fQA8WM9YVh/mRgNJkak/WoDfEH7TA4V8bEPSSJm8tKjuqUVw3yBWI5G+uLN6t14b6CgH5vYvMg24vHVQjGIJZ8MwMG6XgdC0FXhbJrfexEO2hXlxmaYpY1NilLHxTjXVRo26JiBiwsncjuBoU+WdZJhkAR/+u"
let decryptedUrl = null;
const SYNC_PASSWORD_KEY = "sat_vocab_sync_password";

const SheetsService = {
  getSavedPassword() {
    return localStorage.getItem(SYNC_PASSWORD_KEY) || "";
  },
  
  rememberPassword(password) {
    if (password) localStorage.setItem(SYNC_PASSWORD_KEY, password);
  },
  
  clearSavedPassword() {
    localStorage.removeItem(SYNC_PASSWORD_KEY);
    decryptedUrl = null;
  },
  
  unlockWithPassword(password, remember = false) {
    if (!password) return false;
    
    try {
      const bytes = CryptoJS.AES.decrypt(ENCRYPTED_SCRIPT_URL, password);
      const decryptedText = bytes.toString(CryptoJS.enc.Utf8);
      
      if (decryptedText.startsWith("https://script.google.com")) {
        decryptedUrl = decryptedText;
        if (remember) this.rememberPassword(password);
        return true;
      }
    } catch (error) {
      console.warn("Password unlock failed:", error);
    }
    
    return false;
  },
  
  // Confirms the password and unlocks the URL into memory
  ensureAuthenticated() {
    // If already unlocked during this session, proceed immediately
    if (decryptedUrl) return true; 

    const savedPassword = this.getSavedPassword();
    return this.unlockWithPassword(savedPassword, false);
  },
  
  isUnlocked() {
    return Boolean(decryptedUrl);
  },

  // Pulls the latest vocabulary and history state from Google Sheets
  async fetchState() {
    try {
      if (!this.ensureAuthenticated()) return null;

      const response = await fetch(decryptedUrl);
      if (!response.ok) throw new Error("Network cloud error during fetch operation.");
      
      return await response.json();
    } catch (error) {
      console.error("SheetsService Fetch Error:", error);
      throw error;
    }
  },

  // Pushes the local state to Google Sheets to overwrite and save
  async saveState(stateData) {
    try {
      if (!this.ensureAuthenticated()) return false;

      await this.postPayload(stateData);
      return true;
    } catch (error) {
      console.error("SheetsService Save Error:", error);
      throw error;
    }
  },

  async postPayload(payload) {
    if (!this.ensureAuthenticated()) return false;

    await fetch(decryptedUrl, {
      method: "POST",
      mode: "no-cors",
      headers: {
        "Content-Type": "text/plain;charset=utf-8"
      },
      body: JSON.stringify(payload)
    });
    return true;
  },

  async initializeMatchSync() {
    return this.postPayload({
      action: "initializeMatch",
      requestedAt: new Date().toISOString()
    });
  },

  async saveMatchRound(roundData) {
    return this.postPayload({
      action: "saveMatchRound",
      round: roundData,
      requestedAt: new Date().toISOString()
    });
  }
};
