// Firebase Phone Authentication
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { 
    getAuth, 
    RecaptchaVerifier, 
    signInWithPhoneNumber 
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';

// Import config
// phone-auth.js
// Import Firebase config using CommonJS
const { firebaseConfig } = require('../firebase-config.js');

// These will be loaded from CDN in HTML
let auth;
let RecaptchaVerifier;
let signInWithPhoneNumber;

// Initialize Firebase when DOM is ready
function initializeFirebase() {
  if (typeof firebase === 'undefined') {
    console.error('Firebase not loaded');
    return false;
  }
  
  // Initialize Firebase app if not already initialized
  if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
  }
  
  auth = firebase.auth();
  RecaptchaVerifier = firebase.auth.RecaptchaVerifier;
  signInWithPhoneNumber = firebase.auth().signInWithPhoneNumber;
  
  // Disable app verification for testing
  auth.settings.appVerificationDisabledForTesting = false;
  
  return true;
}

// Global variable for confirmation result
window.confirmationResult = null;

// Setup reCAPTCHA verifier
function setupRecaptcha(buttonId) {
  if (!auth) {
    console.error('Firebase not initialized');
    return;
  }
  
  if (window.recaptchaVerifier) {
    window.recaptchaVerifier.clear();
  }

  window.recaptchaVerifier = new RecaptchaVerifier(buttonId, {
    'size': 'invisible',
    'callback': (response) => {
      console.log('✅ reCAPTCHA solved');
    },
    'expired-callback': () => {
      console.log('❌ reCAPTCHA expired');
      window.recaptchaVerifier = null;
    }
  }, auth);
}

// Send OTP to phone number
async function sendOTP(phoneNumber) {
  try {
    if (!auth) {
      throw new Error('Firebase not initialized. Please refresh the page.');
    }
    
    if (!window.recaptchaVerifier) {
      setupRecaptcha('send-otp-button');
    }

    const appVerifier = window.recaptchaVerifier;
    
    // Format phone number (must include country code)
    const formattedPhone = phoneNumber.startsWith('+') ? phoneNumber : `+91${phoneNumber}`;
    
    //console.log('📱 Sending OTP to:', formattedPhone);
    
    const confirmationResult = await auth.signInWithPhoneNumber(formattedPhone, appVerifier);
    
    window.confirmationResult = confirmationResult;
    console.log('✅ OTP sent successfully');
    
    return { success: true, message: 'OTP sent successfully!' };
  } catch (error) {
    console.error('❌ Error sending OTP:', error);
    
    // Reset reCAPTCHA on error
    if (window.recaptchaVerifier) {
      window.recaptchaVerifier.clear();
      window.recaptchaVerifier = null;
    }

    let errorMessage = 'Failed to send OTP';
    if (error.code === 'auth/invalid-phone-number') {
      errorMessage = 'Invalid phone number format';
    } else if (error.code === 'auth/too-many-requests') {
      errorMessage = 'Too many requests. Please try again later';
    } else if (error.code === 'auth/quota-exceeded') {
      errorMessage = 'SMS quota exceeded. Please try again tomorrow';
    }

    return {
      success: false,
      message: errorMessage
    };
  }
}

// Verify OTP
async function verifyOTP(otp) {
  try {
    if (!window.confirmationResult) {
      throw new Error('Please request OTP first');
    }

    console.log('🔐 Verifying OTP...');
    
    const result = await window.confirmationResult.confirm(otp);
    const user = result.user;
    
    console.log('✅ Phone verified:', user.phoneNumber);
    
    // Get Firebase ID token
    const idToken = await user.getIdToken();
    
    return {
      success: true,
      phoneNumber: user.phoneNumber,
      firebaseUid: user.uid,
      idToken: idToken
    };
  } catch (error) {
    console.error('❌ Error verifying OTP:', error);
    
    let errorMessage = 'Invalid OTP';
    if (error.code === 'auth/invalid-verification-code') {
      errorMessage = 'Invalid OTP code';
    } else if (error.code === 'auth/code-expired') {
      errorMessage = 'OTP has expired. Please request a new one';
    }

    return {
      success: false,
      message: errorMessage
    };
  }
}

// Export functions for use in HTML
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { initializeFirebase, setupRecaptcha, sendOTP, verifyOTP };
}

