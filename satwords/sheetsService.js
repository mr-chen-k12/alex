// sheetsService.js - Encrypted Cloud Sync Layer

// 1. Paste your generated ciphertext string right here:
const ENCRYPTED_SCRIPT_URL = "U2FsdGVkX18Sk2uZus18+GFguFPQqb+7w00fQA8WM9YVh/mRgNJkak/WoDfEH7TA4V8bEPSSJm8tKjuqUVw3yBWI5G+uLN6t14b6CgH5vYvMg24vHVQjGIJZ8MwMG6XgdC0FXhbJrfexEO2hXlxmaYpY1NilLHxTjXVRo26JiBiwsncjuBoU+WdZJhkAR/+u"

let decryptedUrl = null;

const SheetsService = {
  
  // Confirms the password and unlocks the URL into memory
  ensureAuthenticated() {
    // If already unlocked during this session, proceed immediately
    if (decryptedUrl) return true; 

    const password = prompt("Enter the security access password to sync your vocabulary database cloud profile:");
    
    if (!password) {
      alert("Password required. Operating in offline local storage mode.");
      return false;
    }

    try {
      // Attempt to decrypt the ciphertext using the provided password
      const bytes = CryptoJS.AES.decrypt(ENCRYPTED_SCRIPT_URL, password);
      const decryptedText = bytes.toString(CryptoJS.enc.Utf8);

      // Verify the decryption resulted in a valid Google Script URL
      if (decryptedText.startsWith("https://script.google.com")) {
        decryptedUrl = decryptedText;
        return true;
      } else {
        alert("Incorrect authentication token. Running local mode fallback.");
        return false;
      }
    } catch (error) {
      alert("Incorrect authentication token. Running local mode fallback.");
      return false;
    }
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
      if (!decryptedUrl) return false;

      await fetch(decryptedUrl, {
        method: "POST",
        mode: "no-cors", // Required by Google Web Apps security policies
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(stateData)
      });
      return true;
    } catch (error) {
      console.error("SheetsService Save Error:", error);
      throw error;
    }
  }
};
