require('dotenv').config();
const express = require('express');
// AI SERVICE INTEGRATION - Add after your existing requires
const { AIService } = require('./services/aiService');
const aiService = new AIService();


const admin = require('firebase-admin');
admin.initializeApp({
  credential: admin.credential.cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
  }),
});

const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const session = require('express-session');
const db = admin.firestore();
const axios = require('axios');
const path = require('path');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { GoogleGenerativeAI } = require('@google/generative-ai');
// Add these imports after your existing requires
const { initializeAccessControl, authenticateToken, requireFeatureAccess, trackFeatureUsage, checkFeatureAccess, FEATURE_ACCESS } = require('./middleware/accessControl');
// Optional security middleware
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const app = express();
const port = process.env.PORT || 3000;

app.use('/js', express.static(path.join(__dirname, 'public/js'), {
    setHeaders: (res, path) => {
        if (path.endsWith('.js')) res.setHeader('Content-Type', 'application/javascript');
    }
}));
app.use('/css', express.static(path.join(__dirname, 'public/css'), {
    setHeaders: (res, path) => {
        if (path.endsWith('.css')) res.setHeader('Content-Type', 'text/css');
    }
}));


// Global variables for Strava tokens
let storedTokens = {
  access_token: null,
  refresh_token: null
};


// Security middleware (optional but recommended)
app.use(helmet({
  contentSecurityPolicy: false, // Disable for development
}));
app.use(cors());

// Add this helper function
function validatePassword(password) {
  const minLength = 8;
  const hasUpperCase = /[A-Z]/.test(password);
  const hasLowerCase = /[a-z]/.test(password);
  const hasNumber = /\d/.test(password);
  
  if (password.length < minLength) {
    return { valid: false, message: 'Password must be at least 8 characters long' };
  }
  if (!hasUpperCase) {
    return { valid: false, message: 'Password must contain at least one uppercase letter' };
  }
  if (!hasLowerCase) {
    return { valid: false, message: 'Password must contain at least one lowercase letter' };
  }
  if (!hasNumber) {
    return { valid: false, message: 'Password must contain at least one number' };
  }
  
  return { valid: true };
}


// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.'
});
app.use('/api/', limiter);

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/components', express.static(path.join(__dirname, 'public/components')));


// Add this to serve static files properly (add after your existing middleware)
app.use('/js', express.static(path.join(__dirname, 'public/js'), {
    setHeaders: (res, path) => {
        if (path.endsWith('.js')) {
            res.setHeader('Content-Type', 'application/javascript');
        }
    }
}));

app.use('/css', express.static(path.join(__dirname, 'public/css'), {
    setHeaders: (res, path) => {
        if (path.endsWith('.css')) {
            res.setHeader('Content-Type', 'text/css');
        }
    }
}));


// ADD THIS SESSION AND PASSPORT MIDDLEWARE HERE:
// Session configuration
app.use(session({
  secret: process.env.SESSION_SECRET || 'your-session-secret-key-zonetrain-2025',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false, // Set to true in production with HTTPS
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

// Initialize passport
app.use(passport.initialize());
app.use(passport.session());

// Updated welcome page route - replace your existing '/' route
app.get('/', (req, res) => {
  const html = `
  <!DOCTYPE html>
  <html lang="en">
  <head>
  <link rel="stylesheet" href="css/cookies.css">
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>ZoneTrain - AI-Powered Running Coaching & Personalized Training Plans</title>
    <meta name="description" content="Get AI-powered running coaching with personalized training plans based on HRV data.">
    <style>
    html { background: linear-gradient(135deg, #6B46C1, #8B5CF6); }
    body { 
        background: linear-gradient(135deg, #6B46C1, #8B5CF6);
        margin: 0;
        font-family: 'Segoe UI', sans-serif;
    }
      /* ... existing CSS variables and base styles ... */
      :root {
        --deep-purple: #6B46C1;
        --light-purple: #A78BFA;
        --accent-purple: #8B5CF6;
        --white: #FFFFFF;
        --dark-gray: #1F2937;
        --success-green: #10B981;
        --warning-orange: #F59E0B;
        --strava-orange: #FC4C02;
      }

      * { margin: 0; padding: 0; box-sizing: border-box; }
      
      body {
        font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
        background: var(--white);
        color: var(--dark-gray);
        line-height: 1.6;
        scroll-behavior: smooth;
      }

      /* ... existing header styles ... */
      .header {
        background: var(--deep-purple);
        padding: 15px 0;
        position: sticky;
        top: 0;
        z-index: 100;
        box-shadow: 0 2px 10px rgba(107, 70, 193, 0.2);
      }

      .nav {
        max-width: 1200px;
        margin: 0 auto;
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 0 20px;
      }

      .logo-container {
        display: flex;
        align-items: center;
        gap: 12px;
        text-decoration: none;
        transition: transform 0.3s ease;
      }

      .logo-container:hover {
        transform: scale(1.05);
      }

      .logo-img {
        width: 45px;
        height: 45px;
        object-fit: contain;
        filter: brightness(1.3) contrast(1.2);
        transition: all 0.3s ease;
      }

      .logo-text {
        font-size: 1.8rem;
        font-weight: 700;
        color: var(--white);
      }

      .nav-links {
        display: flex;
        gap: 30px;
        list-style: none;
        align-items: center;
      }

      .nav-links a {
        color: var(--white);
        text-decoration: none;
        font-weight: 500;
        transition: color 0.3s ease;
        opacity: 0.9;
      }

      .nav-links a:hover {
        opacity: 1;
        color: var(--light-purple);
      }

      /* UPDATED AUTH BUTTONS - Removed extra Strava button */
      .auth-buttons {
        display: flex;
        gap: 10px;
        align-items: center;
      }

      .btn-auth {
        padding: 8px 16px;
        border-radius: 20px;
        text-decoration: none;
        font-weight: 600;
        font-size: 0.9rem;
        transition: all 0.3s ease;
        border: none;
        cursor: pointer;
      }

      .btn-login {
        background: transparent;
        color: var(--white);
        border: 2px solid var(--light-purple);
      }

      .btn-login:hover {
        background: var(--light-purple);
        color: var(--white);
      }

      .btn-signup {
        background: var(--success-green);
        color: var(--white);
      }

      .btn-signup:hover {
        background: #059669;
        transform: translateY(-1px);
      }

      /* ... existing hero and other styles ... */
      .hero-section {
        background: linear-gradient(135deg, var(--deep-purple) 0%, var(--accent-purple) 100%);
        color: var(--white);
        text-align: center;
        padding: 80px 20px;
        position: relative;
        overflow: hidden;
      }

      .hero-section::before {
        content: '';
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        width: 500px;
        height: 500px;
        background-image: url('/logo.jpeg');
        background-size: contain;
        background-repeat: no-repeat;
        background-position: center;
        opacity: 0.25;
        z-index: 1;
        filter: brightness(1.8) contrast(1.3);
      }

      .hero-content {
        position: relative;
        z-index: 2;
        max-width: 1000px;
        margin: 0 auto;
      }

      h1 {
        font-size: 3.5rem;
        font-weight: 700;
        margin-bottom: 20px;
        text-shadow: 2px 2px 4px rgba(0, 0, 0, 0.3);
      }

      .tagline {
        font-size: 1.4rem;
        margin-bottom: 15px;
        font-weight: 500;
        opacity: 0.95;
      }

      .description {
        font-size: 1.1rem;
        margin-bottom: 40px;
        line-height: 1.6;
        opacity: 0.9;
        max-width: 600px;
        margin-left: auto;
        margin-right: auto;
      }

      /* SCROLL TO STRAVA BUTTON */
      .scroll-to-strava {
        cursor: pointer;
        transition: all 0.3s ease;
      }

      .scroll-to-strava:hover {
        transform: translateY(-2px);
        box-shadow: 0 8px 25px rgba(107, 70, 193, 0.4);
      }

      .strava-section {
        background: var(--white);
        padding: 80px 20px;
        text-align: center;
        border-bottom: 2px solid #F3F4F6;
        position: relative;
      }

      .strava-section::before {
        content: '';
        position: absolute;
        top: 30px;
        right: 30px;
        width: 150px;
        height: 150px;
        background-image: url('/logo.jpeg');
        background-size: contain;
        background-repeat: no-repeat;
        background-position: center;
        opacity: 0.3;
        z-index: 1;
        filter: brightness(1.4) contrast(1.2) saturate(1.3);
        animation: float 6s ease-in-out infinite;
      }

      @keyframes float {
        0%, 100% { transform: translateY(0px); }
        50% { transform: translateY(-10px); }
      }

      .strava-container {
        max-width: 1000px;
        margin: 0 auto;
        position: relative;
        z-index: 2;
      }

      .strava-header {
        margin-bottom: 50px;
      }

      .strava-title {
        font-size: 2.8rem;
        color: var(--deep-purple);
        margin-bottom: 20px;
        font-weight: 700;
      }

      .strava-subtitle {
        font-size: 1.3rem;
        color: var(--dark-gray);
        margin-bottom: 15px;
        font-weight: 500;
      }

      .strava-description {
        font-size: 1.1rem;
        color: #6B7280;
        max-width: 700px;
        margin: 0 auto 40px;
        line-height: 1.6;
      }

      .strava-features {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
        gap: 30px;
        margin-bottom: 50px;
      }

      .strava-feature {
        background: #F9FAFB;
        padding: 25px;
        border-radius: 15px;
        border-left: 4px solid var(--strava-orange);
        position: relative;
        transition: transform 0.3s ease;
      }

      .strava-feature:hover {
        transform: translateY(-3px);
      }

      .strava-feature:nth-child(2)::after {
        content: '';
        position: absolute;
        top: 10px;
        right: 15px;
        width: 40px;
        height: 40px;
        background-image: url('/logo.jpeg');
        background-size: contain;
        background-repeat: no-repeat;
        background-position: center;
        opacity: 0.4;
        filter: brightness(1.2);
      }

      .strava-feature-icon {
        font-size: 2rem;
        margin-bottom: 15px;
      }

      .strava-feature h3 {
        color: var(--deep-purple);
        margin-bottom: 10px;
        font-size: 1.2rem;
      }

      .strava-feature p {
        color: #6B7280;
        line-height: 1.5;
      }

      .strava-cta {
        background: linear-gradient(135deg, var(--strava-orange) 0%, #E03D00 100%);
        padding: 40px;
        border-radius: 20px;
        color: var(--white);
        margin-bottom: 30px;
        position: relative;
        overflow: hidden;
      }

      .strava-cta::before {
        content: '';
        position: absolute;
        bottom: -20px;
        right: -20px;
        width: 120px;
        height: 120px;
        background-image: url('/logo.jpeg');
        background-size: contain;
        background-repeat: no-repeat;
        background-position: center;
        opacity: 0.2;
        z-index: 1;
        filter: brightness(2) contrast(1.5);
        transform: rotate(15deg);
      }

      .strava-cta h3 {
        font-size: 1.8rem;
        margin-bottom: 15px;
        position: relative;
        z-index: 2;
      }

      .strava-cta p {
        font-size: 1rem;
        opacity: 0.9;
        margin-bottom: 25px;
        position: relative;
        z-index: 2;
      }

      .btn-strava {
        background: var(--white);
        color: var(--strava-orange);
        padding: 15px 40px;
        border-radius: 50px;
        text-decoration: none;
        font-weight: 700;
        font-size: 1.1rem;
        transition: all 0.3s ease;
        box-shadow: 0 4px 15px rgba(0, 0, 0, 0.1);
        display: inline-flex;
        align-items: center;
        gap: 10px;
        position: relative;
        z-index: 2;
      }

      .btn-strava:hover {
        transform: translateY(-2px);
        box-shadow: 0 8px 25px rgba(0, 0, 0, 0.2);
        background: #FFF8F6;
      }

      .strava-icon {
        width: 24px;
        height: 24px;
        fill: currentColor;
      }

      .free-badge {
        background: var(--success-green);
        color: var(--white);
        padding: 5px 12px;
        border-radius: 20px;
        font-size: 0.8rem;
        font-weight: 600;
        display: inline-block;
        margin-bottom: 10px;
      }

      /* NEW USP SECTION */
      .usp-section {
        background: #F8FAFC;
        padding: 30px 20px;
        text-align: center;
        border-top: 2px solid var(--light-purple);
        border-bottom: 2px solid #F3F4F6;
      }

      .usp-container {
        max-width: 800px;
        margin: 0 auto;
      }

      .usp-title {
        font-size: 1.6rem;
        color: var(--deep-purple);
        margin-bottom: 20px;
        font-weight: 600;
      }

      .usp-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
        gap: 25px;
        margin-bottom: 25px;
      }

      .usp-item {
        background: var(--white);
        padding: 20px;
        border-radius: 12px;
        box-shadow: 0 2px 8px rgba(107, 70, 193, 0.1);
        border: 1px solid var(--light-purple);
        transition: transform 0.3s ease;
      }

      .usp-item:hover {
        transform: translateY(-3px);
        box-shadow: 0 4px 15px rgba(107, 70, 193, 0.2);
      }

      .usp-icon {
        font-size: 2rem;
        margin-bottom: 10px;
        color: var(--accent-purple);
      }

      .usp-label {
        font-size: 1.1rem;
        font-weight: 600;
        color: var(--deep-purple);
        margin-bottom: 5px;
      }

      .usp-value {
        font-size: 0.9rem;
        color: #6B7280;
      }

      .usp-cta {
        margin-top: 25px;
      }

      .btn-usp {
        background: linear-gradient(135deg, var(--deep-purple) 0%, var(--accent-purple) 100%);
        color: var(--white);
        padding: 12px 30px;
        border-radius: 25px;
        text-decoration: none;
        font-weight: 600;
        font-size: 1rem;
        transition: all 0.3s ease;
        box-shadow: 0 4px 15px rgba(107, 70, 193, 0.3);
      }

      .btn-usp:hover {
        transform: translateY(-2px);
        box-shadow: 0 6px 20px rgba(107, 70, 193, 0.4);
      }

      .features-section {
        padding: 80px 20px;
        max-width: 1200px;
        margin: 0 auto;
        position: relative;
      }

      .features-section::before {
        content: '';
        position: absolute;
        top: 100px;
        left: 50px;
        width: 80px;
        height: 80px;
        background-image: url('/logo.jpeg');
        background-size: contain;
        background-repeat: no-repeat;
        background-position: center;
        opacity: 0.15;
        z-index: 1;
        filter: brightness(1.3) saturate(1.2);
        animation: float 8s ease-in-out infinite reverse;
      }

      .features-title {
        text-align: center;
        font-size: 2.5rem;
        color: var(--deep-purple);
        margin-bottom: 50px;
        position: relative;
        z-index: 2;
      }

      .features-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
        gap: 30px;
        margin-bottom: 50px;
        position: relative;
        z-index: 2;
      }

      .feature-card {
        background: var(--light-purple);
        background: linear-gradient(135deg, var(--light-purple) 0%, rgba(167, 139, 250, 0.8) 100%);
        padding: 30px;
        border-radius: 15px;
        text-align: center;
        box-shadow: 0 4px 15px rgba(107, 70, 193, 0.2);
        transition: transform 0.3s ease, box-shadow 0.3s ease;
        color: var(--white);
      }

      .feature-card:hover {
        transform: translateY(-5px);
        box-shadow: 0 8px 25px rgba(107, 70, 193, 0.3);
      }

      .feature-icon { font-size: 2.5rem; margin-bottom: 15px; }
      .feature-title { font-size: 1.3rem; font-weight: 600; margin-bottom: 15px; }

      .action-buttons {
        display: flex;
        gap: 20px;
        justify-content: center;
        flex-wrap: wrap;
        margin-top: 40px;
      }

      .btn {
        padding: 15px 30px;
        border-radius: 50px;
        text-decoration: none;
        font-weight: 600;
        font-size: 1rem;
        transition: all 0.3s ease;
        box-shadow: 0 4px 15px rgba(0, 0, 0, 0.1);
        cursor: pointer;
        border: none;
      }

      .btn-primary {
        background: var(--deep-purple);
        color: var(--white);
      }

      .btn-primary:hover {
        background: var(--accent-purple);
        transform: translateY(-2px);
      }

      .btn-secondary {
        background: var(--white);
        color: var(--deep-purple);
        border: 2px solid var(--light-purple);
      }

      .btn-secondary:hover {
        background: var(--light-purple);
        color: var(--white);
      }

      .cta-section {
        background: linear-gradient(135deg, var(--accent-purple) 0%, var(--deep-purple) 100%);
        color: var(--white);
        padding: 60px 20px;
        text-align: center;
        position: relative;
        overflow: hidden;
      }

      .cta-section::before {
        content: '';
        position: absolute;
        bottom: 20px;
        left: 20px;
        width: 120px;
        height: 120px;
        background-image: url('/logo.jpeg');
        background-size: contain;
        background-repeat: no-repeat;
        background-position: center;
        opacity: 0.3;
        z-index: 1;
        filter: brightness(2.2) contrast(1.4) saturate(1.5);
        transform: rotate(-15deg);
      }

      .cta-section::after {
        content: '';
        position: absolute;
        top: 20px;
        right: 50px;
        width: 100px;
        height: 100px;
        background-image: url('/logo.jpeg');
        background-size: contain;
        background-repeat: no-repeat;
        background-position: center;
        opacity: 0.25;
        z-index: 1;
        filter: brightness(1.8) contrast(1.3);
        animation: float 10s ease-in-out infinite;
      }

      .cta-title { 
        font-size: 2.2rem; 
        margin-bottom: 20px;
        position: relative;
        z-index: 2;
      }

      .footer {
        background: var(--dark-gray);
        color: var(--white);
        padding: 40px 20px 20px;
      }

      .footer-content {
        max-width: 1200px;
        margin: 0 auto;
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
        gap: 30px;
      }

      .footer-section h3 { color: var(--light-purple); margin-bottom: 15px; }
      .footer-section a { color: rgba(255, 255, 255, 0.8); text-decoration: none; }
      .footer-section a:hover { color: var(--light-purple); }

      @media (max-width: 768px) {
        .nav-links { display: none; }
        .auth-buttons { gap: 5px; }
        .btn-auth { padding: 6px 12px; font-size: 0.8rem; }
        h1 { font-size: 2.5rem; }
        .strava-title { font-size: 2.2rem; }
        .strava-features { grid-template-columns: 1fr; }
        .usp-grid { grid-template-columns: 1fr; }
        .hero-section::before { width: 300px; height: 300px; }
        .strava-section::before { width: 100px; height: 100px; top: 20px; right: 20px; }
        .features-section::before { display: none; }
        .cta-section::before { width: 80px; height: 80px; }
        .cta-section::after { display: none; }
      }
    </style>
  </head>


</body>

        <!-- ZoneTrain Cookie Consent Banner -->
        <div id="ztCookieBanner" class="zt-cookie-banner">
            <div class="zt-cookie-container">
                <div class="zt-cookie-content">
                    <div class="zt-cookie-title">
                        🍪 We value your privacy
                    </div>
                    <div class="zt-cookie-text">
                        We use cookies to enhance your ZoneTrain experience, analyze performance, and provide personalized training insights. 
                        Your data helps us improve our AI coaching algorithms.
                    </div>
                    <div class="zt-cookie-links">
                        <a href="/privacy-policy" class="zt-cookie-link">Privacy Policy</a>
                        <a href="/cookie-policy" class="zt-cookie-link">Cookie Policy</a>
                    </div>
                </div>
                <div class="zt-cookie-actions">
                    <button class="zt-cookie-btn zt-cookie-decline" onclick="ztCookies.declineNonEssential()">
                        Decline
                    </button>
                    <button class="zt-cookie-btn zt-cookie-settings" onclick="ztCookies.showSettings()">
                        Settings
                    </button>
                    <button class="zt-cookie-btn zt-cookie-accept" onclick="ztCookies.acceptAll()">
                        Accept All
                    </button>
                </div>
            </div>
        </div>

        <!-- Cookie Settings Modal -->
        <div id="ztCookieModal" class="zt-cookie-modal">
            <div class="zt-cookie-modal-content">
                <div class="zt-cookie-modal-header">
                    <h3 class="zt-cookie-modal-title">Cookie Preferences</h3>
                    <button class="zt-cookie-close" onclick="ztCookies.hideSettings()">&times;</button>
                </div>
                
                <div class="zt-cookie-category">
                    <div class="zt-cookie-category-header">
                        <h4 class="zt-cookie-category-title">Essential Cookies</h4>
                        <div class="zt-cookie-toggle active disabled">
                            <div class="zt-cookie-toggle-slider"></div>
                        </div>
                    </div>
                    <div class="zt-cookie-category-desc">
                        Required for ZoneTrain to function. Enable user authentication, security, and core training analysis features.
                    </div>
                </div>
                
                <div class="zt-cookie-category">
                    <div class="zt-cookie-category-header">
                        <h4 class="zt-cookie-category-title">Analytics Cookies</h4>
                        <div class="zt-cookie-toggle" id="ztanalyticsToggle" onclick="ztCookies.toggleCategory('analytics')">
                            <div class="zt-cookie-toggle-slider"></div>
                        </div>
                    </div>
                    <div class="zt-cookie-category-desc">
                        Help us understand how you use ZoneTrain training analysis. Track feature usage, user journeys, and conversion optimization.
                    </div>
                </div>
                
                <div class="zt-cookie-category">
                    <div class="zt-cookie-category-header">
                        <h4 class="zt-cookie-category-title">Marketing Cookies</h4>
                        <div class="zt-cookie-toggle" id="ztmarketingToggle" onclick="ztCookies.toggleCategory('marketing')">
                            <div class="zt-cookie-toggle-slider"></div>
                        </div>
                    </div>
                    <div class="zt-cookie-category-desc">
                        Enable retargeting for users who tried our free analysis. Help us show relevant training content and measure campaign effectiveness.
                    </div>
                </div>
                
                <div class="zt-cookie-category">
                    <div class="zt-cookie-category-header">
                        <h4 class="zt-cookie-category-title">Functional Cookies</h4>
                        <div class="zt-cookie-toggle" id="ztfunctionalToggle" onclick="ztCookies.toggleCategory('functional')">
                            <div class="zt-cookie-toggle-slider"></div>
                        </div>
                    </div>
                    <div class="zt-cookie-category-desc">
                        Remember your training preferences, analysis history, and dashboard customizations for a personalized ZoneTrain experience.
                    </div>
                </div>
                
                <div class="zt-cookie-modal-actions">
                    <button class="zt-cookie-btn zt-cookie-decline" onclick="ztCookies.declineNonEssential(); ztCookies.hideSettings();">
                        Decline All
                    </button>
                    <button class="zt-cookie-btn zt-cookie-accept" onclick="ztCookies.saveSettings()">
                        Save Preferences
                    </button>
                </div>
            </div>
        </div>

        <!-- Load Cookie System -->
        <link rel="stylesheet" href="css/cookies.css">
        ${getCookieBannerHTML()}
    ${getCookieModalHTML()}
        <script src="js/cookies.js"></script>
    </body>


  <body>
    <header class="header">
      <nav class="nav">
        <a href="/" class="logo-container">
          <img src="/logo.jpeg" alt="ZoneTrain Logo" class="logo-img">
          <span class="logo-text">ZoneTrain</span>
        </a>
        <ul class="nav-links">
          <li><a href="/">Home</a></li>
          <li><a href="/about">About</a></li>
          <li><a href="/contact">Contact</a></li>
          <li><a href="/plans">Training Plans</a></li>
        </ul>
        <div class="auth-buttons">
          <a href="/login" class="btn-auth btn-login">Login</a>
          <a href="/signup" class="btn-auth btn-signup">Sign Up</a>
        </div>
      </nav>
    </header>

    <main>
      <section class="hero-section">
        <div class="hero-content">
          <h1>ZoneTrain</h1>
          <p class="tagline">AI-Powered Running Coaching & Personalized Training Plans (Rs.99 monthly only)</p>
          <p class="description">
            Transform your running performance with intelligent coaching that adapts to your daily HRV readings, 
            analyzes your training zones, and delivers personalized workout recommendations.
          </p>
          <div class="action-buttons">
            <button onclick="scrollToStrava()" class="btn btn-primary scroll-to-strava">🎯 Try Free Analysis</button>
            <a href="/plans" class="btn btn-secondary">View Training Plans</a>
          </div>
          <div style="margin-top: 15px; font-size: 0.9rem; opacity: 0.8;">
            <p>✅ No signup required for free analysis • Connect Strava in 10 seconds</p>
          </div>
        </div>
      </section>

      <section id="strava-section" class="strava-section">
        <div class="strava-container">
          <div class="strava-header">
            <div class="free-badge">100% FREE</div>
            <h2 class="strava-title">Get Your Free Training Zone Analysis</h2>
            <p class="strava-subtitle">Connect your Strava account and get AI-powered insights instantly</p>
            <p class="strava-description">
              No signup required! Connect your Strava account to analyze your recent running activities and get personalized zone distribution insights powered by our advanced AI technology.
            </p>
          </div>

          <div class="strava-features">
            <div class="strava-feature">
              <div class="strava-feature-icon">🎯</div>
              <h3>Zone Analysis</h3>
              <p>Get detailed breakdown of your training zones from recent running activities</p>
            </div>
            <div class="strava-feature">
              <div class="strava-feature-icon">🤖</div>
              <h3>AI Insights</h3>
              <p>Receive personalized recommendations based on your zone distribution patterns</p>
            </div>
            <div class="strava-feature">
              <div class="strava-feature-icon">📊</div>
              <h3>Instant Results</h3>
              <p>Analysis is automatically added to your latest Strava activity description</p>
            </div>
          </div>

          <div class="strava-cta">
            <h3>🏃‍♂️ Ready for Your Free Analysis?</h3>
            <p>Connect with Strava in seconds and discover how to optimize your training zones</p>
            <a href="/strava-connect" class="btn-strava">
              <svg class="strava-icon" viewBox="0 0 24 24">
                <path d="M15.387 17.944l-2.089-4.116h-3.065L15.387 24l5.15-10.172h-3.066m-7.008-5.599l2.836 5.599h4.172L10.463 0l-7 13.828h4.172"/>
              </svg>
              Connect with Strava - It's Free!
            </a>
          </div>

          <div style="text-align: center; margin-top: 20px; color: #6B7280; font-size: 0.9rem;">
            <p>✅ No account creation required &nbsp;•&nbsp; ✅ Instant analysis &nbsp;•&nbsp; ✅ Privacy protected</p>
          </div>
        </div>
      </section>

      <!-- NEW USP SECTION -->
      <section class="usp-section">
        <div class="usp-container">
          <h2 class="usp-title">💡 Want More? Check Out Our Super-Affordable Premium Plans!</h2>
          
          <div class="usp-grid">
            <div class="usp-item">
              <div class="usp-icon">💰</div>
              <div class="usp-label">Ultra Cheap</div>
              <div class="usp-value">Starting ₹99/month only</div>
            </div>
            <div class="usp-item">
              <div class="usp-icon">🔬</div>
              <div class="usp-label">Scientific</div>
              <div class="usp-value">AI + Sports Science</div>
            </div>
            <div class="usp-item">
              <div class="usp-icon">🎯</div>
              <div class="usp-label">Personalized</div>
              <div class="usp-value">HRV-based coaching</div>
            </div>
            <div class="usp-item">
              <div class="usp-icon">📱</div>
              <div class="usp-label">WhatsApp</div>
              <div class="usp-value">Daily coaching messages</div>
            </div>
          </div>

          <div class="usp-cta">
            <a href="/plans" class="btn-usp">🚀 View Our Crazy Affordable Plans</a>
            <p style="margin-top: 10px; font-size: 0.85rem; color: #6B7280;">
              14-day free trial • Cancel anytime • No hidden fees
            </p>
          </div>
        </div>
      </section>

      <section class="features-section">
        <h2 class="features-title">Why Choose ZoneTrain?</h2>
        <div class="features-grid">
          <div class="feature-card">
            <div class="feature-icon">🎯</div>
            <h3 class="feature-title">Smart Zone Analysis</h3>
            <p>AI-powered analysis of your training zones with actionable insights</p>
          </div>
          <div class="feature-card">
            <div class="feature-icon">📊</div>
            <h3 class="feature-title">HRV-Based Coaching</h3>
            <p>Daily workout adjustments based on your heart rate variability</p>
          </div>
          <div class="feature-card">
            <div class="feature-icon">🏃‍♂️</div>
            <h3 class="feature-title">Personalized Plans</h3>
            <p>Custom training programs designed for your specific goals</p>
          </div>
        </div>
      </section>

      <section class="cta-section">
        <h2 class="cta-title">Ready to Transform Your Running?</h2>
        <p>Start with our free analysis, then see why thousands choose our affordable plans</p>
        <div class="action-buttons">
          <a href="/plans" class="btn btn-primary">💰 See Affordable Plans</a>
          <button onclick="scrollToStrava()" class="btn btn-secondary">🎯 Try Free Analysis First</button>
        </div>
      </section>
    </main>

    <footer class="footer">
      <div class="footer-content">
        <div class="footer-section">
          <h3>ZoneTrain</h3>
          <p>Professional AI-powered fitness coaching services for runners.</p>
        </div>
        <div class="footer-section">
          <h3>Contact</h3>
          <p>Email: zonetrain@zohomail.in</p>
          <p>New Delhi, India</p>
        </div>
        <div class="footer-section">
          <h3>Legal</h3>
          <p><a href="/privacy">Privacy Policy</a></p>
          <p><a href="/terms">Terms of Service</a></p>
        </div>
      </div>
    </footer>

    <script>
      function scrollToStrava() {
        document.getElementById('strava-section').scrollIntoView({
          behavior: 'smooth',
          block: 'center'
        });
      }

      // Add smooth scrolling for all internal links
      document.addEventListener('DOMContentLoaded', function() {
        // Smooth scroll behavior already added via CSS
        console.log('ZoneTrain loaded successfully!');
      });
    </script>
            <!-- ZoneTrain Cookie Consent Banner -->
        <div id="ztCookieBanner" class="zt-cookie-banner">
            <div class="zt-cookie-container">
                <div class="zt-cookie-content">
                    <div class="zt-cookie-title">
                        🍪 We value your privacy
                    </div>
                    <div class="zt-cookie-text">
                        We use cookies to enhance your ZoneTrain experience, analyze performance, and provide personalized training insights. 
                        Your data helps us improve our AI coaching algorithms.
                    </div>
                    <div class="zt-cookie-links">
                        <a href="/privacy-policy" class="zt-cookie-link">Privacy Policy</a>
                        <a href="/cookie-policy" class="zt-cookie-link">Cookie Policy</a>
                    </div>
                </div>
                <div class="zt-cookie-actions">
                    <button class="zt-cookie-btn zt-cookie-decline" onclick="ztCookies.declineNonEssential()">
                        Decline
                    </button>
                    <button class="zt-cookie-btn zt-cookie-settings" onclick="ztCookies.showSettings()">
                        Settings
                    </button>
                    <button class="zt-cookie-btn zt-cookie-accept" onclick="ztCookies.acceptAll()">
                        Accept All
                    </button>
                </div>
            </div>
        </div>

        <!-- Cookie Settings Modal -->
        <div id="ztCookieModal" class="zt-cookie-modal">
            <div class="zt-cookie-modal-content">
                <div class="zt-cookie-modal-header">
                    <h3 class="zt-cookie-modal-title">Cookie Preferences</h3>
                    <button class="zt-cookie-close" onclick="ztCookies.hideSettings()">&times;</button>
                </div>
                
                <div class="zt-cookie-category">
                    <div class="zt-cookie-category-header">
                        <h4 class="zt-cookie-category-title">Essential Cookies</h4>
                        <div class="zt-cookie-toggle active disabled">
                            <div class="zt-cookie-toggle-slider"></div>
                        </div>
                    </div>
                    <div class="zt-cookie-category-desc">
                        Required for ZoneTrain to function. Enable user authentication, security, and core training analysis features.
                    </div>
                </div>
                
                <div class="zt-cookie-category">
                    <div class="zt-cookie-category-header">
                        <h4 class="zt-cookie-category-title">Analytics Cookies</h4>
                        <div class="zt-cookie-toggle" id="ztanalyticsToggle" onclick="ztCookies.toggleCategory('analytics')">
                            <div class="zt-cookie-toggle-slider"></div>
                        </div>
                    </div>
                    <div class="zt-cookie-category-desc">
                        Help us understand how you use ZoneTrain training analysis. Track feature usage, user journeys, and conversion optimization.
                    </div>
                </div>
                
                <div class="zt-cookie-category">
                    <div class="zt-cookie-category-header">
                        <h4 class="zt-cookie-category-title">Marketing Cookies</h4>
                        <div class="zt-cookie-toggle" id="ztmarketingToggle" onclick="ztCookies.toggleCategory('marketing')">
                            <div class="zt-cookie-toggle-slider"></div>
                        </div>
                    </div>
                    <div class="zt-cookie-category-desc">
                        Enable retargeting for users who tried our free analysis. Help us show relevant training content and measure campaign effectiveness.
                    </div>
                </div>
                
                <div class="zt-cookie-category">
                    <div class="zt-cookie-category-header">
                        <h4 class="zt-cookie-category-title">Functional Cookies</h4>
                        <div class="zt-cookie-toggle" id="ztfunctionalToggle" onclick="ztCookies.toggleCategory('functional')">
                            <div class="zt-cookie-toggle-slider"></div>
                        </div>
                    </div>
                    <div class="zt-cookie-category-desc">
                        Remember your training preferences, analysis history, and dashboard customizations for a personalized ZoneTrain experience.
                    </div>
                </div>
                
                <div class="zt-cookie-modal-actions">
                    <button class="zt-cookie-btn zt-cookie-decline" onclick="ztCookies.declineNonEssential(); ztCookies.hideSettings();">
                        Decline All
                    </button>
                    <button class="zt-cookie-btn zt-cookie-accept" onclick="ztCookies.saveSettings()">
                        Save Preferences
                    </button>
                </div>
            </div>
        </div>

        <!-- Load Cookie System -->
        <link rel="stylesheet" href="css/cookies.css">
        ${getCookieBannerHTML()}
    ${getCookieModalHTML()}
        <script src="js/cookies.js"></script>
        
    </body>
</html>`;
  res.send(html);
});




app.get('/login', (req, res) => {
  const html = `
  <!DOCTYPE html>
  <html lang="en">
  <head>
  <link rel="stylesheet" href="css/cookies.css">
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Login - ZoneTrain</title>
    <style>
      :root {
        --deep-purple: #6B46C1;
        --light-purple: #A78BFA;
        --accent-purple: #8B5CF6;
        --white: #FFFFFF;
        --dark-gray: #1F2937;
        --success-green: #10B981;
        --error-red: #EF4444;
      }

      * { margin: 0; padding: 0; box-sizing: border-box; }

      body {
        font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
        background: linear-gradient(135deg, var(--deep-purple) 0%, var(--accent-purple) 100%);
        min-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 20px;
      }

      .login-container {
        background: var(--white);
        border-radius: 20px;
        box-shadow: 0 20px 40px rgba(0, 0, 0, 0.3);
        padding: 40px;
        width: 100%;
        max-width: 450px;
        position: relative;
      }

      .login-container h1 {
        color: #667eea;
        text-align: center;
        margin-bottom: 10px;
        font-size: 28px;
    }

    .login-container h2 {
        text-align: center;
        color: #374151;
        margin-bottom: 30px;
        font-size: 20px;
        font-weight: 500;
    }


      .back-btn {
        position: relative;
        top: 20px;
        left: 20px;
        color: var(--deep-purple);
        text-decoration: none;
        font-size: 1.5rem;
        transition: transform 0.3s ease;
      }

      .back-btn:hover { transform: translateX(-5px); }

      .logo {
        text-align: center;
        font-size: 2rem;
        font-weight: 700;
        color: var(--deep-purple);
        margin-bottom: 30px;
      }

      h2 {
        text-align: center;
        color: var(--dark-gray);
        margin-bottom: 30px;
        font-size: 1.8rem;
      }

      .form-group {
        margin-bottom: 20px;
      }

      label {
        display: block;
        margin-bottom: 8px;
        color: var(--dark-gray);
        font-weight: 500;
      }

      input[type="email"], input[type="password"] {
        width: 100%;
        padding: 12px 15px;
        border: 2px solid #E5E7EB;
        border-radius: 10px;
        font-size: 1rem;
        transition: border-color 0.3s ease;
      }

      input[type="email"]:focus, input[type="password"]:focus {
        outline: none;
        border-color: var(--accent-purple);
        box-shadow: 0 0 0 3px rgba(139, 92, 246, 0.1);
      }

      .forgot-password {
        text-align: right;
        margin-top: 10px;
      }

      .forgot-password a {
        color: var(--accent-purple);
        text-decoration: none;
        font-size: 0.9rem;
      }

      .forgot-password a:hover { text-decoration: underline; }

      .btn {
        width: 100%;
        padding: 15px;
        border: none;
        border-radius: 10px;
        font-size: 1rem;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.3s ease;
        margin-bottom: 15px;
      }

      .btn-primary {
        background: var(--deep-purple);
        color: var(--white);
      }

      .btn-primary:hover {
        background: var(--accent-purple);
        transform: translateY(-2px);
        box-shadow: 0 6px 20px rgba(107, 70, 193, 0.3);
      }

      .btn-google {
        background: var(--white);
        color: var(--dark-gray);
        border: 2px solid #E5E7EB;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 10px;
      }

      .btn-google:hover {
        background: #F9FAFB;
        border-color: var(--light-purple);
      }

      .divider {
        text-align: center;
        margin: 25px 0;
        position: relative;
        color: #9CA3AF;
      }

      .divider::before {
        content: '';
        position: absolute;
        top: 50%;
        left: 0;
        right: 0;
        height: 1px;
        background: #E5E7EB;
        z-index: 1;
      }

      .divider span {
        background: var(--white);
        padding: 0 15px;
        position: relative;
        z-index: 2;
      }

      .signup-link {
        text-align: center;
        margin-top: 25px;
        color: var(--dark-gray);
      }

      .signup-link a {
        color: var(--accent-purple);
        text-decoration: none;
        font-weight: 600;
      }

      .signup-link a:hover { text-decoration: underline; }

      .error-message {
        background: #FEE2E2;
        color: var(--error-red);
        padding: 10px 15px;
        border-radius: 8px;
        margin-bottom: 20px;
        font-size: 0.9rem;
        display: none;
      }

      .error-message.error {
    background: #FEE2E2;
    color: #EF4444;
}

.error-message.success {
    background: #D1FAE5;
    color: #10B981;
}

.error-message.info {
    background: #E0E7FF;
    color: #6366F1;
}

      @media (max-width: 480px) {
        .login-container { padding: 30px 25px; }
      }

      /* Add this to your existing login page CSS */
.divider {
  text-align: center;
  margin: 25px 0;
  position: relative;
  color: #9CA3AF;
}

.divider::before {
  content: '';
  position: absolute;
  top: 50%;
  left: 0;
  right: 0;
  height: 1px;
  background: #E5E7EB;
  z-index: 1;
}

.divider span {
  background: var(--white);
  padding: 0 15px;
  position: relative;
  z-index: 2;
}

.social-buttons {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.btn-social {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 12px 20px;
  border: 2px solid #E5E7EB;
  border-radius: 10px;
  text-decoration: none;
  font-weight: 600;
  transition: all 0.3s ease;
  background: white;
}

.btn-google {
  color: #4285f4;
  border-color: #4285f4;
}

.btn-google:hover {
  background: #4285f4;
  color: white;
}

    </style>
  </head>
  <body>
    <div class="login-container">
      <a href="/" class="back-btn">←</a>
      
      <div class="logo">ZoneTrain</div>
      <h2>Welcome Back</h2>

      <div id="errorMessage" class="error-message"></div>

      <form id="loginForm">
        <div class="form-group">
          <label for="email">Email Address</label>
          <input type="email" id="email" name="email" required>
        </div>

        <div class="form-group">
          <label for="password">Password</label>
          <input type="password" id="password" name="password" required>
          <div class="forgot-password">
            <a href="/forgot-password">Forgot Password?</a>
          </div>
        </div>

        <button type="submit" class="btn btn-primary">Sign In</button>
      </form>

      

      <!-- ADD THIS SOCIAL LOGIN SECTION -->
<div class="divider">
  <span>OR</span>
</div>

<div class="social-buttons">
  <a href="/auth/google" class="btn-social btn-google">
    <svg width="20" height="20" viewBox="0 0 24 24">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
    </svg>
    Continue with Google
  </a>
</div>

      

      <div class="signup-link">
        Don't have an account? <a href="/signup">Sign Up</a>
      </div>
    </div>

    <script>
      document.getElementById('loginForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const formData = new FormData(e.target);
        const loginData = {
          email: formData.get('email'),
          password: formData.get('password')
        };
       

    try {
        console.log('📡 Sending login request...');
        
        const response = await fetch('/api/auth/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(loginData)
        });

        const result = await response.json();
        console.log('📡 Login response:', result);

        if (result.success) {
            // Store user session data
            localStorage.setItem('userToken', result.token);
            localStorage.setItem('userId', result.user.id);
            localStorage.setItem('userEmail', result.user.email);
            localStorage.setItem('userType', result.userType);
            localStorage.setItem('userInfo', JSON.stringify(result.user));

            console.log('✅ Login successful, user type:', result.userType);
            console.log('🚀 Redirecting to:', result.redirect);

            // Handle pending subscription
            const pendingSubscription = sessionStorage.getItem('pendingSubscription');
            if (pendingSubscription) {
                localStorage.setItem('mockSubscription', pendingSubscription);
                sessionStorage.removeItem('pendingSubscription');
            }

            // Show success message
            showMessage('Welcome back! Redirecting...', 'success');

            // Redirect based on user type and preferences
            setTimeout(() => {
                window.location.href = result.redirect;
            }, 1000);

        } else {
            console.log('❌ Login failed:', result.message);
            showMessage(result.message, 'error');
        }

    } catch (error) {
        console.error('❌ Login error:', error);
        showMessage('Login failed. Please try again.', 'error');
    }
});

function showMessage(message, type) {
    const errorDiv = document.getElementById('errorMessage');
    errorDiv.textContent = message;
    errorDiv.className = 'error-message ' + type;
    errorDiv.style.display = 'block';
    
    // Auto-hide success messages
    if (type === 'success') {
        setTimeout(() => {
            errorDiv.style.display = 'none';
        }, 3000);
    } else {
        // Hide error messages after 5 seconds
        setTimeout(() => {
            errorDiv.style.display = 'none';
        }, 5000);
    }
}
    </script>
    <script>
// Show/Hide Password functionality
document.addEventListener('DOMContentLoaded', function() {
  // For login page
  const togglePassword = document.getElementById('togglePassword');
  const passwordField = document.getElementById('password');
  
  if (togglePassword && passwordField) {
    togglePassword.addEventListener('click', function() {
      const type = passwordField.getAttribute('type') === 'password' ? 'text' : 'password';
      passwordField.setAttribute('type', type);
      this.textContent = type === 'password' ? '👁️' : '🙈';
    });
  }

  // For signup page (confirm password)
  const toggleConfirmPassword = document.getElementById('toggleConfirmPassword');
  const confirmPasswordField = document.getElementById('confirmPassword');
  
  if (toggleConfirmPassword && confirmPasswordField) {
    toggleConfirmPassword.addEventListener('click', function() {
      const type = confirmPasswordField.getAttribute('type') === 'password' ? 'text' : 'password';
      confirmPasswordField.setAttribute('type', type);
      this.textContent = type === 'password' ? '👁️' : '🙈';
    });
  }
});
</script>

<div id="ztCookieBanner" class="zt-cookie-banner">
        <div class="zt-cookie-container">
            <div class="zt-cookie-content">
                <div class="zt-cookie-title">🍪 We value your privacy</div>
                <div class="zt-cookie-text">
                    We use cookies to enhance your ZoneTrain experience and provide personalized coaching.
                </div>
                <div class="zt-cookie-links">
                    <a href="/privacy-policy" class="zt-cookie-link">Privacy Policy</a>
                    <a href="/cookie-policy" class="zt-cookie-link">Cookie Policy</a>
                </div>
            </div>
            <div class="zt-cookie-actions">
                <button class="zt-cookie-btn zt-cookie-decline" onclick="ztCookies.declineNonEssential()">
                    Decline
                </button>
                <button class="zt-cookie-btn zt-cookie-settings" onclick="ztCookies.showSettings()">
                    Settings
                </button>
                <button class="zt-cookie-btn zt-cookie-accept" onclick="ztCookies.acceptAll()">
                    Accept All
                </button>
            </div>
        </div>
    </div>

    <!-- Cookie Settings Modal -->
    ${getCookieModalHTML()}
${getCookieBannerHTML()}
    
    <script src="js/cookies.js"></script>
    <script src="/components/nav-header.js"></script>

  </body>
  </html>
  `;
  res.send(html);
});

app.get('/signup', (req, res) => {
  const html = `
  <!DOCTYPE html>
  <html lang="en">
  <head>
  <link rel="stylesheet" href="css/cookies.css">
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Sign Up - ZoneTrain</title>
    <style>
      :root {
        --deep-purple: #6B46C1;
        --light-purple: #A78BFA;
        --accent-purple: #8B5CF6;
        --white: #FFFFFF;
        --dark-gray: #1F2937;
        --success-green: #10B981;
        --error-red: #EF4444;
      }

      * { margin: 0; padding: 0; box-sizing: border-box; }

      body {

        font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
        background: linear-gradient(135deg, var(--deep-purple) 0%, var(--accent-purple) 100%);
        min-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 20px;
        padding-top: 110px;
      }

      .signup-container {
        background: var(--white);
        border-radius: 20px;
        box-shadow: 0 20px 40px rgba(0, 0, 0, 0.3);
        padding: 40px;
        width: 100%;
        max-width: 500px;
        position: relative;
        margin-top: 0;
      }

      .back-btn {
        position: absolute;
        top: 20px;
        left: 20px;
        color: var(--deep-purple);
        text-decoration: none;
        font-size: 1.5rem;
        transition: transform 0.3s ease;
        z-index: 10;
      }

      .back-btn:hover { transform: translateX(-5px); }

      .signup-container h1,
      .signup-container > *:first-child {
        margin-top: 40px; /* Space for back button */
      }

      .logo {
        text-align: center;
        font-size: 2rem;
        font-weight: 700;
        color: var(--deep-purple);
        margin-bottom: 20px;
      }

      h2 {
        text-align: center;
        color: var(--dark-gray);
        margin-bottom: 30px;
        font-size: 1.8rem;
      }

      .form-row {
        display: flex;
        gap: 15px;
      }

      .form-group {
        margin-bottom: 20px;
        flex: 1;
      }

      label {
        display: block;
        margin-bottom: 5px;
        color: var(--dark-gray);
        font-weight: 500;
      }

      input[type="text"], input[type="email"], input[type="password"], input[type="tel"] {
        width: 100%;
        padding: 12px 15px;
        border: 2px solid #E5E7EB;
        border-radius: 10px;
        font-size: 1rem;
        transition: border-color 0.3s ease;
      }

      input:focus {
        outline: none;
        border-color: var(--accent-purple);
        box-shadow: 0 0 0 3px rgba(139, 92, 246, 0.1);
      }

      .password-requirements {
        font-size: 0.8rem;
        color: #6B7280;
        margin-top: 5px;
      }

      .btn {
        width: 100%;
        padding: 15px;
        border: none;
        border-radius: 10px;
        font-size: 1rem;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.3s ease;
        margin-bottom: 15px;
      }

      .btn-primary {
        background: var(--deep-purple);
        color: var(--white);
      }

      .btn-primary:hover {
        background: var(--accent-purple);
        transform: translateY(-2px);
        box-shadow: 0 6px 20px rgba(107, 70, 193, 0.3);
      }

      .btn-google {
        background: var(--white);
        color: var(--dark-gray);
        border: 2px solid #E5E7EB;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 10px;
      }

      .btn-google:hover {
        background: #F9FAFB;
        border-color: var(--light-purple);
      }

      .divider {
        text-align: center;
        margin: 25px 0;
        position: relative;
        color: #9CA3AF;
      }

      .divider::before {
        content: '';
        position: absolute;
        top: 50%;
        left: 0;
        right: 0;
        height: 1px;
        background: #E5E7EB;
        z-index: 1;
      }

      .divider span {
        background: var(--white);
        padding: 0 15px;
        position: relative;
        z-index: 2;
      }

      .login-link {
        text-align: center;
        margin-top: 25px;
        color: var(--dark-gray);
      }

      .login-link a {
        color: var(--accent-purple);
        text-decoration: none;
        font-weight: 600;
      }

      .login-link a:hover { text-decoration: underline; }

      .error-message, .success-message {
        padding: 10px 15px;
        border-radius: 8px;
        margin-bottom: 20px;
        font-size: 0.9rem;
        display: none;
      }

      .error-message {
        background: #FEE2E2;
        color: var(--error-red);
      }

      .success-message {
        background: #D1FAE5;
        color: var(--success-green);
      }

      .terms-agreement {
        font-size: 0.85rem;
        color: #6B7280;
        margin-bottom: 20px;
        line-height: 1.5;
      }

      .terms-agreement a {
        color: var(--accent-purple);
        text-decoration: none;
      }

      .terms-agreement a:hover { text-decoration: underline; }

      @media (max-width: 480px) {
        .signup-container { padding: 30px 25px; }
        .form-row { flex-direction: column; gap: 0; }
      }

      /* Add this to your existing login page CSS */
.divider {
  text-align: center;
  margin: 25px 0;
  position: relative;
  color: #9CA3AF;
}

.divider::before {
  content: '';
  position: absolute;
  top: 50%;
  left: 0;
  right: 0;
  height: 1px;
  background: #E5E7EB;
  z-index: 1;
}

.divider span {
  background: var(--white);
  padding: 0 15px;
  position: relative;
  z-index: 2;
}

.social-buttons {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.btn-social {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 12px 20px;
  border: 2px solid #E5E7EB;
  border-radius: 10px;
  text-decoration: none;
  font-weight: 600;
  transition: all 0.3s ease;
  background: white;
}

.btn-google {
  color: #4285f4;
  border-color: #4285f4;
}

.btn-google:hover {
  background: #4285f4;
  color: white;
}

    </style>
  </head>
  <body>
    <div class="signup-container">
      <a href="/" class="back-btn">←</a>
      
      <div class="logo">ZoneTrain</div>
      <h2>Create Your Account</h2>

      <div id="errorMessage" class="error-message"></div>
      <div id="successMessage" class="success-message"></div>

      <form id="signupForm">
        <div class="form-row">
          <div class="form-group">
            <label for="firstName">First Name</label>
            <input type="text" id="firstName" name="firstName" required>
          </div>
          <div class="form-group">
            <label for="lastName">Last Name</label>
            <input type="text" id="lastName" name="lastName" required>
          </div>
        </div>

        <div class="form-group">
          <label for="email">Email Address</label>
          <input type="email" id="email" name="email" required>
        </div>

        <div class="form-group">
          <label for="phoneNumber">Phone Number (Optional)</label>
          <input type="tel" id="phoneNumber" name="phoneNumber" placeholder="+91 98765 43210">
        </div>

        <div class="form-group">
  <label for="password">Password</label>
  <div style="position: relative;">
    <input type="password" id="password" name="password" required style="padding-right: 45px;">
    <button type="button" id="togglePassword" style="position: absolute; right: 12px; top: 50%; transform: translateY(-50%); background: none; border: none; cursor: pointer; font-size: 1.2rem;">👁️</button>
  </div>
  <div class="password-requirements">
    At least 8 characters with uppercase, lowercase, and number
  </div>
</div>


        <div class="form-group">
          <label for="confirmPassword">Confirm Password</label>
          <div style="position: relative;">
    <input type="password" id="confirmPassword" name="confirmPassword" required style="padding-right: 45px;">
  </div>
        </div>

        <div class="terms-agreement">
          By creating an account, you agree to our 
          <a href="/terms" target="_blank">Terms of Service</a> and 
          <a href="/privacy" target="_blank">Privacy Policy</a>.
        </div>

        <button type="submit" class="btn btn-primary">Create Account</button>
      </form>
      <!-- ADD THIS SOCIAL LOGIN SECTION -->
<div class="divider">
  <span>OR</span>
</div>

<div class="social-buttons">
  <a href="/auth/google" class="btn-social btn-google">
    <svg width="20" height="20" viewBox="0 0 24 24">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
    </svg>
    Continue with Google
  </a>
</div>

      <div class="divider">
        <span>or</span>
      </div>

   

      <div class="login-link">
        Already have an account? <a href="/login">Sign In</a>
      </div>
    </div>

    <script>
      document.getElementById('signupForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const formData = new FormData(e.target);
        const password = formData.get('password');
        const confirmPassword = formData.get('confirmPassword');

        // Validate password match
        if (password !== confirmPassword) {
          showError('Passwords do not match');
          return;
        }

        // Validate password strength
        if (!isValidPassword(password)) {
          showError('Password must be at least 8 characters with uppercase, lowercase, and number');
          return;
        }

        const signupData = {
          firstName: formData.get('firstName'),
          lastName: formData.get('lastName'),
          email: formData.get('email'),
          phoneNumber: formData.get('phoneNumber') || null,
          password: password
        };

        const urlParams = new URLSearchParams(window.location.search);
    const redirect = urlParams.get('redirect');
    if (redirect) {
        signupData.redirect = redirect;
    }

        try {
          const response = await fetch('/api/auth/register', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(signupData)
          });

          const result = await response.json();

          if (result.success) {
          localStorage.setItem('userToken', result.token);
            localStorage.setItem('userId', result.user.id);
            localStorage.setItem('userEmail', result.user.email);
            
            // ADD THIS: Handle pending subscription
            const pendingSubscription = sessionStorage.getItem('pendingSubscription');
            if (pendingSubscription) {
                localStorage.setItem('mockSubscription', pendingSubscription);
                sessionStorage.removeItem('pendingSubscription');
            }
            
            showSuccess('Account created successfully! Redirecting...');
            setTimeout(() => {
              window.location.href = '/login?message=Account created successfully';
            }, 2000);
          } else {
            showError(result.message);
          }
        } catch (error) {
          console.error('Signup error:', error);
          showError('Signup failed. Please try again.');
        }
      });

      function isValidPassword(password) {
        return password.length >= 8 && 
               /[A-Z]/.test(password) && 
               /[a-z]/.test(password) && 
               /[0-9]/.test(password);
      }

      function showError(message) {
        const errorDiv = document.getElementById('errorMessage');
        const successDiv = document.getElementById('successMessage');
        successDiv.style.display = 'none';
        errorDiv.textContent = message;
        errorDiv.style.display = 'block';
        errorDiv.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }

      function showSuccess(message) {
        const errorDiv = document.getElementById('errorMessage');
        const successDiv = document.getElementById('successMessage');
        errorDiv.style.display = 'none';
        successDiv.textContent = message;
        successDiv.style.display = 'block';
        successDiv.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }

      function signupWithGoogle() {
        alert('Google signup will be implemented with Google OAuth');
      }
    </script>
    <script>
<script>
// Show/Hide Password functionality
document.addEventListener('DOMContentLoaded', function() {
  console.log('🔧 Password toggle script loaded'); // Debug log
  
  // For login/signup page
  const togglePassword = document.getElementById('togglePassword');
  const passwordField = document.getElementById('password');
  
  if (togglePassword && passwordField) {
    console.log('✅ Password toggle elements found'); // Debug log
    
    togglePassword.addEventListener('click', function() {
      console.log('👁️ Password toggle clicked'); // Debug log
      
      const type = passwordField.getAttribute('type') === 'password' ? 'text' : 'password';
      passwordField.setAttribute('type', type);
      this.textContent = type === 'password' ? '👁️' : '🙈';
      
      console.log('🔄 Password type changed to:', type); // Debug log
    });
  } else {
    console.log('❌ Password toggle elements not found'); // Debug log
  }
  
  // For signup page - confirm password field
  const toggleConfirmPassword = document.getElementById('toggleConfirmPassword');
  const confirmPasswordField = document.getElementById('confirmPassword');
  
  if (toggleConfirmPassword && confirmPasswordField) {
    console.log('✅ Confirm password toggle found'); // Debug log
    
    toggleConfirmPassword.addEventListener('click', function() {
      console.log('👁️ Confirm password toggle clicked'); // Debug log
      
      const type = confirmPasswordField.getAttribute('type') === 'password' ? 'text' : 'password';
      confirmPasswordField.setAttribute('type', type);
      this.textContent = type === 'password' ? '👁️' : '🙈';
    });
  }
});
</script>

<div id="ztCookieBanner" class="zt-cookie-banner">
        <div class="zt-cookie-container">
            <div class="zt-cookie-content">
                <div class="zt-cookie-title">🍪 We value your privacy</div>
                <div class="zt-cookie-text">
                    We use cookies to enhance your ZoneTrain experience and provide personalized coaching.
                </div>
                <div class="zt-cookie-links">
                    <a href="/privacy-policy" class="zt-cookie-link">Privacy Policy</a>
                    <a href="/cookie-policy" class="zt-cookie-link">Cookie Policy</a>
                </div>
            </div>
            <div class="zt-cookie-actions">
                <button class="zt-cookie-btn zt-cookie-decline" onclick="ztCookies.declineNonEssential()">
                    Decline
                </button>
                <button class="zt-cookie-btn zt-cookie-settings" onclick="ztCookies.showSettings()">
                    Settings
                </button>
                <button class="zt-cookie-btn zt-cookie-accept" onclick="ztCookies.acceptAll()">
                    Accept All
                </button>
            </div>
        </div>
    </div>

    <!-- Cookie Settings Modal -->
    ${getCookieModalHTML()}
    ${getCookieBannerHTML()}
    

    <script src="js/cookies.js"></script>
    <script src="/components/nav-header.js"></script>

  </body>
  </html>
  `;
  res.send(html);
});



// Helper function to calculate training zone distribution
function analyzeTrainingZones(activities) {
  // Heart rate zones as % of estimated max HR (customize as needed)
  const zoneThresholds = [
    { name: 'Zone 1 (Recovery)', min: 0.50, max: 0.60 },
    { name: 'Zone 2 (Endurance)', min: 0.60, max: 0.70 },
    { name: 'Zone 3 (Tempo)', min: 0.70, max: 0.80 },
    { name: 'Zone 4 (Threshold)', min: 0.80, max: 0.90 },
    { name: 'Zone 5 (VO2 Max)', min: 0.90, max: 1.00 }
  ];

  let zoneDistribution = [0, 0, 0, 0, 0]; // Time in each zone
  let totalTime = 0;
  let activitiesWithHR = 0;

  activities.forEach(activity => {
    if (activity.has_heartrate && activity.average_heartrate > 0) {
      activitiesWithHR++;
      const estimatedMaxHR = 220 - 30; // Assume age 30, customize later
      const hrPercent = activity.average_heartrate / estimatedMaxHR;
      const duration = activity.moving_time;
      
      // Find which zone this activity falls into
      for (let i = 0; i < zoneThresholds.length; i++) {
        if (hrPercent >= zoneThresholds[i].min && hrPercent < zoneThresholds[i].max) {
          zoneDistribution[i] += duration;
          break;
        }
      }
      totalTime += duration;
    }
  });

  // Convert to percentages
  const zonePercentages = zoneDistribution.map(time => 
    totalTime > 0 ? Math.round((time / totalTime) * 100) : 0
  );

  return {
    percentages: zonePercentages,
    totalActivities: activitiesWithHR,
    zoneNames: zoneThresholds.map(z => z.name)
  };
}

// Generate training insights based on zone distribution
function generateZoneInsights(zonePercentages) {
  const [z1, z2, z3, z4, z5] = zonePercentages;
  let insights = [];

  if (z1 < 10) insights.push("Add more recovery rides (Zone 1)");
  if (z2 > 70) insights.push("Great endurance base! Consider tempo work");
  if (z2 < 40) insights.push("Build more aerobic base (Zone 2)");
  if (z4 + z5 < 10) insights.push("Missing high-intensity training");
  if (z5 > 20) insights.push("Reduce VO2 max work, focus on threshold");
  if (z3 > 30) insights.push("Good tempo training balance");

const baseInsight = insights.length > 0 
    ? insights.slice(0, 2).join('. ') 
    : "Maintain current training distribution";

  // Add ZoneTrain branding
  return `🏃 ${baseInsight} | Powered by zonetrain.fit`;}

// Homepage
app.get('/', (req, res) => {
  const html = `
  <!DOCTYPE html>
  <html lang="en">
  <head>
  <link rel="stylesheet" href="css/cookies.css">
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>ZoneTrain - AI-Powered Running Coaching & Personalized Training Plans</title>
    <meta name="description" content="Get AI-powered running coaching with personalized training plans based on HRV data. Professional fitness coaching services for runners of all levels.">
    <style>
      :root {
        --deep-purple: #6B46C1;
        --light-purple: #A78BFA;
        --accent-purple: #8B5CF6;
        --white: #FFFFFF;
        --dark-gray: #1F2937;
        --success-green: #10B981;
        --warning-orange: #F59E0B;
      }

      * { margin: 0; padding: 0; box-sizing: border-box; }
      
      body {
        font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
        background: var(--white);
        color: var(--dark-gray);
        line-height: 1.6;
      }

      .header {
        background: var(--deep-purple);
        padding: 15px 0;
        position: sticky;
        top: 0;
        z-index: 100;
        box-shadow: 0 2px 10px rgba(107, 70, 193, 0.2);
      }

      .nav {
        max-width: 1200px;
        margin: 0 auto;
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 0 20px;
      }

      .logo {
        font-size: 1.8rem;
        font-weight: 700;
        color: var(--white);
        text-decoration: none;
      }

      .nav-links {
        display: flex;
        gap: 30px;
        list-style: none;
      }

      .nav-links a {
        color: var(--white);
        text-decoration: none;
        font-weight: 500;
        transition: color 0.3s ease;
        opacity: 0.9;
      }

      .nav-links a:hover {
        opacity: 1;
        color: var(--light-purple);
      }

      .hero-section {
        background: linear-gradient(135deg, var(--deep-purple) 0%, var(--accent-purple) 100%);
        color: var(--white);
        text-align: center;
        padding: 80px 20px;
        position: relative;
        overflow: hidden;
      }

      .hero-section::before {
        content: '';
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: url('data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><pattern id="grain" width="100" height="100" patternUnits="userSpaceOnUse"><circle cx="20" cy="20" r="1" fill="rgba(255,255,255,0.1)"/><circle cx="80" cy="80" r="1" fill="rgba(255,255,255,0.1)"/><circle cx="40" cy="60" r="1" fill="rgba(255,255,255,0.1)"/></pattern></defs><rect width="100" height="100" fill="url(%23grain)"/></svg>');
        opacity: 0.3;
      }

      .hero-content {
        position: relative;
        z-index: 1;
        max-width: 1000px;
        margin: 0 auto;
      }

      h1 {
        font-size: 3.5rem;
        font-weight: 700;
        margin-bottom: 20px;
        text-shadow: 2px 2px 4px rgba(0, 0, 0, 0.3);
      }

      .tagline {
        font-size: 1.4rem;
        margin-bottom: 15px;
        font-weight: 500;
        opacity: 0.95;
      }

      .description {
        font-size: 1.1rem;
        margin-bottom: 40px;
        line-height: 1.6;
        opacity: 0.9;
        max-width: 600px;
        margin-left: auto;
        margin-right: auto;
      }

      .features-section {
        padding: 80px 20px;
        max-width: 1200px;
        margin: 0 auto;
      }

      .features-title {
        text-align: center;
        font-size: 2.5rem;
        color: var(--deep-purple);
        margin-bottom: 50px;
      }

      .features-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
        gap: 30px;
        margin-bottom: 50px;
      }

      .feature-card {
        background: var(--light-purple);
        background: linear-gradient(135deg, var(--light-purple) 0%, rgba(167, 139, 250, 0.8) 100%);
        padding: 30px;
        border-radius: 15px;
        text-align: center;
        box-shadow: 0 4px 15px rgba(107, 70, 193, 0.2);
        transition: transform 0.3s ease, box-shadow 0.3s ease;
        color: var(--white);
      }

      .feature-card:hover {
        transform: translateY(-5px);
        box-shadow: 0 8px 25px rgba(107, 70, 193, 0.3);
      }

      .feature-icon {
        font-size: 2.5rem;
        margin-bottom: 15px;
      }

      .feature-title {
        font-size: 1.3rem;
        font-weight: 600;
        margin-bottom: 15px;
      }

      .feature-description {
        opacity: 0.95;
        line-height: 1.6;
      }

      .action-buttons {
        display: flex;
        gap: 20px;
        justify-content: center;
        flex-wrap: wrap;
        margin-top: 40px;
      }

      .btn {
        padding: 15px 30px;
        border-radius: 50px;
        text-decoration: none;
        font-weight: 600;
        font-size: 1rem;
        transition: all 0.3s ease;
        box-shadow: 0 4px 15px rgba(0, 0, 0, 0.1);
        cursor: pointer;
        border: none;
      }

      .btn-primary {
        background: var(--deep-purple);
        color: var(--white);
      }

      .btn-primary:hover {
        background: var(--accent-purple);
        transform: translateY(-2px);
        box-shadow: 0 6px 20px rgba(107, 70, 193, 0.3);
      }

      .btn-secondary {
        background: var(--white);
        color: var(--deep-purple);
        border: 2px solid var(--light-purple);
      }

      .btn-secondary:hover {
        background: var(--light-purple);
        color: var(--white);
        transform: translateY(-2px);
      }

      .btn-success {
        background: var(--success-green);
        color: var(--white);
      }

      .btn-success:hover {
        background: #059669;
        transform: translateY(-2px);
        box-shadow: 0 6px 20px rgba(16, 185, 129, 0.3);
      }

      .cta-section {
        background: linear-gradient(135deg, var(--accent-purple) 0%, var(--deep-purple) 100%);
        color: var(--white);
        padding: 60px 20px;
        text-align: center;
      }

      .cta-title {
        font-size: 2.2rem;
        margin-bottom: 20px;
      }

      .cta-description {
        font-size: 1.1rem;
        margin-bottom: 30px;
        opacity: 0.9;
      }

      .footer {
        background: var(--dark-gray);
        color: var(--white);
        padding: 40px 20px 20px;
      }

      .footer-content {
        max-width: 1200px;
        margin: 0 auto;
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
        gap: 30px;
      }

      .footer-section h3 {
        color: var(--light-purple);
        margin-bottom: 15px;
      }

      .footer-section p, .footer-section a {
        color: rgba(255, 255, 255, 0.8);
        text-decoration: none;
        line-height: 1.6;
      }

      .footer-section a:hover {
        color: var(--light-purple);
      }

      .footer-bottom {
        text-align: center;
        margin-top: 30px;
        padding-top: 20px;
        border-top: 1px solid rgba(255, 255, 255, 0.2);
        color: rgba(255, 255, 255, 0.7);
      }

      @media (max-width: 768px) {
        .nav-links { display: none; }
        h1 { font-size: 2.5rem; }
        .features-grid { grid-template-columns: 1fr; }
        .action-buttons { flex-direction: column; align-items: center; }
        .btn { width: 100%; max-width: 280px; }
      }
    </style>
  </head>
  <body>
    

    <main>
      <section class="hero-section">
        <div class="hero-content">
          <h1>ZoneTrain</h1>
          <p class="tagline">AI-Powered Running Coaching & Personalized Training Plans</p>
          <p class="description">
            Transform your running performance with intelligent coaching that adapts to your daily HRV readings, 
            analyzes your training zones, and delivers personalized workout recommendations through advanced AI technology.
          </p>
          <div class="action-buttons">
            <a href="/login" class="btn btn-success">🔗 Connect with Strava</a>
            <a href="/analyze-zones" class="btn btn-secondary">📈 Analyze Your Training</a>
          </div>
        </div>
      </section>

      <section class="features-section">
        <h2 class="features-title">Why Choose ZoneTrain?</h2>
        <div class="features-grid">
          <div class="feature-card">
            <div class="feature-icon">🎯</div>
            <h3 class="feature-title">Smart Zone Analysis</h3>
            <p class="feature-description">AI-powered analysis of your training zones with actionable insights to optimize your running performance</p>
          </div>
          <div class="feature-card">
            <div class="feature-icon">📊</div>
            <h3 class="feature-title">HRV-Based Coaching</h3>
            <p class="feature-description">Daily workout adjustments based on your heart rate variability for optimal training adaptation</p>
          </div>
          <div class="feature-card">
            <div class="feature-icon">🏃‍♂️</div>
            <h3 class="feature-title">Personalized Plans</h3>
            <p class="feature-description">Custom training programs designed for your specific goals and current fitness level</p>
          </div>
        </div>
      </section>

      <section class="cta-section">
        <h2 class="cta-title">Ready to Transform Your Running?</h2>
        <p class="cta-description">Join thousands of runners who have improved their performance with ZoneTrain's AI coaching</p>
        <div class="action-buttons">
          <a href="/plans.html" class="btn btn-primary">View Training Plans</a>
          <a href="/login" class="btn btn-secondary">Start Free Analysis</a>
        </div>
      </section>
    </main>

    <footer class="footer">
      <div class="footer-content">
        <div class="footer-section">
          <h3>ZoneTrain</h3>
          <p>Professional AI-powered fitness coaching services specializing in running performance optimization and personalized training plans.</p>
        </div>
        <div class="footer-section">
          <h3>Contact Information</h3>
          <p>Email: zonetrain@zohomail.in</p>
          <p>Address: AP Block, Pitampura<br>New Delhi-110034, India</p>
        </div>
        <div class="footer-section">
          <h3>Legal</h3>
          <p><a href="/privacy">Privacy Policy</a></p>
          <p><a href="/terms">Terms of Service</a></p>
        </div>
      </div>
      <div class="footer-bottom">
        <p>&copy; 2025 ZoneTrain. All rights reserved. | Professional Fitness Coaching Services</p>
      </div>
    </footer>
    ${getCookieBannerHTML()}
    ${getCookieModalHTML()}
    <script src="/components/nav-header.js"></script>
  </body>
  </html>
  `;
  res.send(html);
});


app.get('/about', (req, res) => {
  const html = `
  <!DOCTYPE html>
  <html lang="en">
  <head>
  <link rel="stylesheet" href="css/cookies.css">
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>About ZoneTrain - AI-Powered Running Coaching</title>
    <meta name="description" content="Learn about ZoneTrain's mission to revolutionize running coaching through AI technology and personalized training plans.">
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      
      body {
        font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        min-height: 100vh;
        color: white;
      }

      .header {
        background: rgba(0, 0, 0, 0.1);
        padding: 15px 0;
        backdrop-filter: blur(10px);
      }

      .nav {
        max-width: 1200px;
        margin: 0 auto;
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 0 20px;
      }

      .logo {
        font-size: 1.8rem;
        font-weight: 700;
        color: #ffd700;
        text-decoration: none;
      }

      .nav-links {
        display: flex;
        gap: 30px;
        list-style: none;
      }

      .nav-links a {
        color: white;
        text-decoration: none;
        font-weight: 500;
        transition: color 0.3s ease;
      }

      .nav-links a:hover {
        color: #ffd700;
      }

      .container {
        max-width: 800px;
        margin: 0 auto;
        padding: 40px 20px;
      }

      h1 {
        font-size: 2.8rem;
        text-align: center;
        margin-bottom: 30px;
        color: #ffd700;
        text-shadow: 2px 2px 4px rgba(0, 0, 0, 0.3);
      }

      .content-section {
        background: rgba(255, 255, 255, 0.1);
        backdrop-filter: blur(15px);
        border-radius: 20px;
        padding: 40px;
        margin-bottom: 30px;
        border: 1px solid rgba(255, 255, 255, 0.2);
      }

      h2 {
        color: #ffd700;
        margin-bottom: 20px;
        font-size: 1.8rem;
      }

      p {
        line-height: 1.7;
        margin-bottom: 20px;
        font-size: 1.1rem;
        opacity: 0.95;
      }

      .mission-values {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
        gap: 30px;
        margin: 40px 0;
      }

      .value-card {
        background: rgba(255, 255, 255, 0.1);
        padding: 25px;
        border-radius: 15px;
        text-align: center;
      }

      .value-icon {
        font-size: 2rem;
        margin-bottom: 15px;
      }

      .btn-back {
        display: inline-block;
        margin-top: 30px;
        padding: 15px 30px;
        background: linear-gradient(45deg, #ffd700, #ffb700);
        color: #333;
        text-decoration: none;
        border-radius: 25px;
        font-weight: 600;
        transition: all 0.3s ease;
      }

      .btn-back:hover {
        transform: translateY(-2px);
        box-shadow: 0 6px 20px rgba(0, 0, 0, 0.3);
      }

      @media (max-width: 768px) {
        .nav-links { display: none; }
        h1 { font-size: 2.2rem; }
        .container { padding: 20px 15px; }
        .content-section { padding: 25px; }
      }
    </style>
  </head>
  <body>
    <header class="header">
      <nav class="nav">
        <a href="/" class="logo">ZoneTrain</a>
        <ul class="nav-links">
          <li><a href="/">Home</a></li>
          <li><a href="/about">About</a></li>
          <li><a href="/contact">Contact</a></li>
          <li><a href="/plans.html">Training Plans</a></li>
        </ul>
      </nav>
    </header>

    <div class="container">
      <h1>About ZoneTrain</h1>

      <div class="content-section">
        <h2>Our Mission</h2>
        <p>ZoneTrain revolutionizes running coaching by combining cutting-edge artificial intelligence with proven sports science methodologies. We believe every runner deserves personalized, data-driven guidance to achieve their performance goals safely and effectively.</p>
        
        <p>Our platform analyzes your daily Heart Rate Variability (HRV) readings, training history, and performance patterns to deliver intelligent workout recommendations that adapt to your body's recovery state and training needs.</p>
      </div>

      <div class="content-section">
        <h2>What We Do</h2>
        <p><strong>AI-Powered Training Zone Analysis:</strong> Our proprietary algorithms analyze your Strava activities to provide detailed insights into your training zone distribution, helping you optimize your training intensity for maximum performance gains.</p>
        
        <p><strong>HRV-Based Daily Coaching:</strong> By monitoring your Heart Rate Variability, we provide personalized daily workout recommendations that align with your body's recovery status, preventing overtraining and optimizing adaptation.</p>
        
        <p><strong>Personalized Training Plans:</strong> Our three-tier coaching system offers progressively advanced training programs designed for runners at every level, from fitness enthusiasts to competitive athletes.</p>
      </div>

      <div class="mission-values">
        <div class="value-card">
          <div class="value-icon">🎯</div>
          <h3>Precision</h3>
          <p>Data-driven coaching decisions based on scientific principles and individual biomarkers</p>
        </div>
        <div class="value-card">
          <div class="value-icon">📈</div>
          <h3>Progress</h3>
          <p>Continuous improvement through intelligent training progression and adaptation</p>
        </div>
        <div class="value-card">
          <div class="value-icon">🏃‍♂️</div>
          <h3>Performance</h3>
          <p>Maximizing your running potential while maintaining long-term health and motivation</p>
        </div>
      </div>

      <div class="content-section">
        <h2>Why Choose ZoneTrain?</h2>
        <p>Traditional training plans follow a one-size-fits-all approach that ignores your individual recovery patterns and daily readiness to train. ZoneTrain's AI coaching adapts to your unique physiology, ensuring you train hard when your body is ready and recover properly when needed.</p>
        
        <p>Our integration with Strava provides seamless activity analysis, while our WhatsApp-based coaching delivers convenient, personalized guidance directly to your phone. This combination of advanced technology and practical accessibility makes professional-level coaching available to every runner.</p>
      </div>

      <a href="/" class="btn-back">← Back to Home</a>
    </div>
    ${getCookieBannerHTML()}

    ${getCookieModalHTML()}

    <script src="/components/nav-header.js"></script>
  </body>
  </html>
  `;
  res.send(html);
});

app.get('/contact', (req, res) => {
  const html = `
  <!DOCTYPE html>
  <html lang="en">
  <head>
  <link rel="stylesheet" href="css/cookies.css">
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Contact ZoneTrain - Professional Fitness Coaching Services</title>
    <meta name="description" content="Get in touch with ZoneTrain for AI-powered running coaching and personalized training plans. Professional fitness coaching services.">
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      
      body {
        font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        min-height: 100vh;
        color: white;
      }

      .header {
        background: rgba(0, 0, 0, 0.1);
        padding: 15px 0;
        backdrop-filter: blur(10px);
      }

      .nav {
        max-width: 1200px;
        margin: 0 auto;
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 0 20px;
      }

      .logo {
        font-size: 1.8rem;
        font-weight: 700;
        color: #ffd700;
        text-decoration: none;
      }

      .nav-links {
        display: flex;
        gap: 30px;
        list-style: none;
      }

      .nav-links a {
        color: white;
        text-decoration: none;
        font-weight: 500;
        transition: color 0.3s ease;
      }

      .nav-links a:hover {
        color: #ffd700;
      }

      .container {
        max-width: 800px;
        margin: 0 auto;
        padding: 40px 20px;
      }

      h1 {
        font-size: 2.8rem;
        text-align: center;
        margin-bottom: 30px;
        color: #ffd700;
        text-shadow: 2px 2px 4px rgba(0, 0, 0, 0.3);
      }

      .contact-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
        gap: 30px;
        margin-bottom: 40px;
      }

      .contact-card {
        background: rgba(255, 255, 255, 0.1);
        backdrop-filter: blur(15px);
        border-radius: 20px;
        padding: 30px;
        text-align: center;
        border: 1px solid rgba(255, 255, 255, 0.2);
      }

      .contact-icon {
        font-size: 2.5rem;
        margin-bottom: 20px;
        color: #ffd700;
      }

      .contact-title {
        font-size: 1.3rem;
        font-weight: 600;
        margin-bottom: 15px;
        color: #ffd700;
      }

      .contact-info {
        font-size: 1.1rem;
        line-height: 1.6;
        opacity: 0.95;
      }

      .contact-info a {
        color: white;
        text-decoration: none;
        transition: color 0.3s ease;
      }

      .contact-info a:hover {
        color: #ffd700;
      }

      .business-hours {
        background: rgba(255, 255, 255, 0.1);
        backdrop-filter: blur(15px);
        border-radius: 20px;
        padding: 30px;
        margin-bottom: 30px;
        border: 1px solid rgba(255, 255, 255, 0.2);
      }

      .business-hours h2 {
        color: #ffd700;
        margin-bottom: 20px;
        text-align: center;
      }

      .hours-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
        gap: 15px;
      }

      .hour-item {
        display: flex;
        justify-content: space-between;
        padding: 10px 15px;
        background: rgba(255, 255, 255, 0.1);
        border-radius: 10px;
      }

      .btn-back {
        display: inline-block;
        margin-top: 30px;
        padding: 15px 30px;
        background: linear-gradient(45deg, #ffd700, #ffb700);
        color: #333;
        text-decoration: none;
        border-radius: 25px;
        font-weight: 600;
        transition: all 0.3s ease;
      }

      .btn-back:hover {
        transform: translateY(-2px);
        box-shadow: 0 6px 20px rgba(0, 0, 0, 0.3);
      }

      @media (max-width: 768px) {
        .nav-links { display: none; }
        h1 { font-size: 2.2rem; }
        .container { padding: 20px 15px; }
        .contact-grid { grid-template-columns: 1fr; }
      }
    </style>
  </head>
  <body>
    

    <div class="container">
      <h1>Contact ZoneTrain</h1>

      <div class="contact-grid">
        <div class="contact-card">
          <div class="contact-icon">📧</div>
          <h3 class="contact-title">Email Support</h3>
          <div class="contact-info">
            <a href="mailto:zonetrain@zohomail.in">zonetrain@zohomail.in</a>
            <p style="margin-top: 10px; font-size: 0.95rem; opacity: 0.8;">
              For coaching inquiries, technical support, and partnership opportunities
            </p>
          </div>
        </div>

        <div class="contact-card">
          <div class="contact-icon">📍</div>
          <h3 class="contact-title">Business Address</h3>
          <div class="contact-info">
            ZoneTrain<br>
            AP Block, Pitampura<br>
            New Delhi-110034<br>
            India
          </div>
        </div>

        <div class="contact-card">
          <div class="contact-icon">🏢</div>
          <h3 class="contact-title">Business Information</h3>
          <div class="contact-info">
            <strong>Service:</strong> AI-powered running coaching and personalized training plans<br><br>
            <strong>Specialization:</strong> Professional fitness coaching services for runners
          </div>
        </div>
      </div>

      <div class="business-hours">
        <h2>Support Hours</h2>
        <div class="hours-grid">
          <div class="hour-item">
            <span>Monday - Friday</span>
            <span>9:00 AM - 6:00 PM IST</span>
          </div>
          <div class="hour-item">
            <span>Saturday</span>
            <span>10:00 AM - 4:00 PM IST</span>
          </div>
          <div class="hour-item">
            <span>Sunday</span>
            <span>Closed</span>
          </div>
        </div>
        <p style="text-align: center; margin-top: 20px; opacity: 0.8; font-size: 0.95rem;">
          We typically respond to all inquiries within 24 hours during business days.
        </p>
      </div>

      <a href="/" class="btn-back">← Back to Home</a>
    </div>
    ${getCookieBannerHTML()}
    ${getCookieModalHTML()}
    <script src="/components/nav-header.js"></script>
  </body>
  </html>
  `;
  res.send(html);
});

app.get('/privacy', (req, res) => {
  const html = `
  <!DOCTYPE html>
  <html lang="en">
  <head>
  <link rel="stylesheet" href="css/cookies.css">
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Privacy Policy - ZoneTrain</title>
    <meta name="description" content="ZoneTrain Privacy Policy - How we collect, use, and protect your personal information and fitness data.">
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      
      body {
        font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        min-height: 100vh;
        color: white;
        line-height: 1.6;
      }

      .header {
        background: rgba(0, 0, 0, 0.1);
        padding: 15px 0;
        backdrop-filter: blur(10px);
      }

      .nav {
        max-width: 1200px;
        margin: 0 auto;
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 0 20px;
      }

      .logo {
        font-size: 1.8rem;
        font-weight: 700;
        color: #ffd700;
        text-decoration: none;
      }

      .container {
        max-width: 900px;
        margin: 0 auto;
        padding: 40px 20px;
      }

      h1 {
        font-size: 2.5rem;
        text-align: center;
        margin-bottom: 30px;
        color: #ffd700;
        text-shadow: 2px 2px 4px rgba(0, 0, 0, 0.3);
      }

      .content {
        background: rgba(255, 255, 255, 0.1);
        backdrop-filter: blur(15px);
        border-radius: 20px;
        padding: 40px;
        border: 1px solid rgba(255, 255, 255, 0.2);
      }

      h2 {
        color: #ffd700;
        margin: 30px 0 15px 0;
        font-size: 1.5rem;
      }

      h2:first-of-type {
        margin-top: 0;
      }

      p {
        margin-bottom: 15px;
        opacity: 0.95;
      }

      ul {
        margin: 15px 0 15px 20px;
      }

      li {
        margin-bottom: 8px;
        opacity: 0.95;
      }

      .effective-date {
        text-align: center;
        font-style: italic;
        opacity: 0.8;
        margin-bottom: 30px;
      }

      .btn-back {
        display: inline-block;
        margin-top: 30px;
        padding: 15px 30px;
        background: linear-gradient(45deg, #ffd700, #ffb700);
        color: #333;
        text-decoration: none;
        border-radius: 25px;
        font-weight: 600;
        transition: all 0.3s ease;
      }

      .btn-back:hover {
        transform: translateY(-2px);
        box-shadow: 0 6px 20px rgba(0, 0, 0, 0.3);
      }

      @media (max-width: 768px) {
        .container { padding: 20px 15px; }
        .content { padding: 25px; }
        h1 { font-size: 2rem; }
      }
    </style>
  </head>
  <body>
    <header class="header">
      <nav class="nav">
        <a href="/" class="logo">ZoneTrain</a>
      </nav>
    </header>

    <div class="container">
      <h1>Privacy Policy</h1>
      <p class="effective-date">Effective Date: September 18, 2025</p>

      <div class="content">
        <h2>1. Introduction</h2>
        <p>ZoneTrain ("we," "our," or "us") is committed to protecting your privacy. This Privacy Policy explains how we collect, use, disclose, and safeguard your information when you use our AI-powered running coaching and personalized training plan services, including our website, mobile applications, and WhatsApp-based coaching communications.</p>

        <h2>2. Information We Collect</h2>
        <p><strong>Personal Information:</strong></p>
        <ul>
          <li>Name, email address, and contact information</li>
          <li>Account credentials and profile information</li>
          <li>Payment and billing information (processed securely through third-party processors)</li>
          <li>Communication preferences and WhatsApp phone number (with your consent)</li>
        </ul>

        <p><strong>Fitness and Health Data:</strong></p>
        <ul>
          <li>Heart Rate Variability (HRV) readings you provide</li>
          <li>Training activities and performance data from connected fitness platforms (Strava)</li>
          <li>Workout responses and subjective wellness questionnaire data</li>
          <li>Training zone analysis and progression metrics</li>
        </ul>

        <p><strong>Technical Information:</strong></p>
        <ul>
          <li>Device information, IP address, and browser details</li>
          <li>Usage patterns and interaction data with our services</li>
          <li>Cookies and similar tracking technologies</li>
        </ul>

        <h2>3. How We Use Your Information</h2>
        <p>We use your information to:</p>
        <ul>
          <li>Provide personalized AI-powered coaching recommendations</li>
          <li>Analyze your training data and generate customized workout plans</li>
          <li>Send daily HRV prompts and training suggestions via WhatsApp (with your consent)</li>
          <li>Process payments and manage your subscription</li>
          <li>Improve our AI algorithms and service quality</li>
          <li>Communicate important service updates and support</li>
          <li>Comply with legal obligations and protect our rights</li>
        </ul>

        <h2>4. Information Sharing and Disclosure</h2>
        <p>We do not sell, rent, or trade your personal information. We may share your information only in the following circumstances:</p>
        <ul>
          <li><strong>Service Providers:</strong> With trusted third parties who help us operate our services (payment processors, cloud storage, AI processing)</li>
          <li><strong>Connected Services:</strong> With platforms you choose to connect (like Strava), as authorized by you</li>
          <li><strong>Legal Requirements:</strong> When required by law, court order, or to protect our rights and safety</li>
          <li><strong>Business Transfers:</strong> In connection with a merger, acquisition, or sale of assets</li>
        </ul>

        <h2>5. Data Security</h2>
        <p>We implement appropriate technical and organizational security measures to protect your information against unauthorized access, alteration, disclosure, or destruction. This includes encryption, secure data transmission, and regular security assessments. However, no method of transmission over the internet is 100% secure.</p>

        <h2>6. WhatsApp Communications</h2>
        <p>Our WhatsApp-based coaching service operates with your explicit consent. We use WhatsApp Business API to send you daily HRV prompts and personalized training recommendations. You can opt out of WhatsApp communications at any time by replying "STOP" or contacting us directly.</p>

        <h2>7. Data Retention</h2>
        <p>We retain your information for as long as necessary to provide our services and fulfill the purposes outlined in this policy. You may request deletion of your account and associated data at any time, subject to legal obligations to retain certain information.</p>

        <h2>8. Your Rights</h2>
        <p>Depending on your location, you may have the right to:</p>
        <ul>
          <li>Access, update, or delete your personal information</li>
          <li>Withdraw consent for data processing</li>
          <li>Request data portability</li>
          <li>Object to certain processing activities</li>
          <li>File complaints with data protection authorities</li>
        </ul>

        <h2>9. International Data Transfers</h2>
        <p>Your information may be transferred to and processed in countries other than your own. We ensure appropriate safeguards are in place to protect your information in accordance with applicable data protection laws.</p>

        <h2>10. Changes to This Policy</h2>
        <p>We may update this Privacy Policy from time to time. We will notify you of any material changes by posting the new policy on our website and, where appropriate, through other communication channels.</p>

        <h2>11. Contact Us</h2>
        <p>If you have any questions about this Privacy Policy or our data practices, please contact us at:</p>
        <p>Email: zonetrain@zohomail.in<br>
        Address: ZoneTrain, AP Block, Pitampura, New Delhi-110034, India</p>
      </div>

      <a href="/" class="btn-back">← Back to Home</a>
    </div>
    ${getCookieBannerHTML()}
    ${getCookieModalHTML()}
    <script src="/components/nav-header.js"></script>
  </body>
  </html>
  `;
  res.send(html);
});

app.get('/terms', (req, res) => {
  const html = `
  <!DOCTYPE html>
  <html lang="en">
  <head>
  <link rel="stylesheet" href="css/cookies.css">
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Terms of Service - ZoneTrain</title>
    <meta name="description" content="ZoneTrain Terms of Service - Legal terms and conditions for using our AI-powered fitness coaching services.">
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      
      body {
        font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        min-height: 100vh;
        color: white;
        line-height: 1.6;
      }

      .header {
        background: rgba(0, 0, 0, 0.1);
        padding: 15px 0;
        backdrop-filter: blur(10px);
      }

      .nav {
        max-width: 1200px;
        margin: 0 auto;
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 0 20px;
      }

      .logo {
        font-size: 1.8rem;
        font-weight: 700;
        color: #ffd700;
        text-decoration: none;
      }

      .container {
        max-width: 900px;
        margin: 0 auto;
        padding: 40px 20px;
      }

      h1 {
        font-size: 2.5rem;
        text-align: center;
        margin-bottom: 30px;
        color: #ffd700;
        text-shadow: 2px 2px 4px rgba(0, 0, 0, 0.3);
      }

      .content {
        background: rgba(255, 255, 255, 0.1);
        backdrop-filter: blur(15px);
        border-radius: 20px;
        padding: 40px;
        border: 1px solid rgba(255, 255, 255, 0.2);
      }

      h2 {
        color: #ffd700;
        margin: 30px 0 15px 0;
        font-size: 1.5rem;
      }

      h2:first-of-type {
        margin-top: 0;
      }

      p {
        margin-bottom: 15px;
        opacity: 0.95;
      }

      ul {
        margin: 15px 0 15px 20px;
      }

      li {
        margin-bottom: 8px;
        opacity: 0.95;
      }

      .effective-date {
        text-align: center;
        font-style: italic;
        opacity: 0.8;
        margin-bottom: 30px;
      }

      .btn-back {
        display: inline-block;
        margin-top: 30px;
        padding: 15px 30px;
        background: linear-gradient(45deg, #ffd700, #ffb700);
        color: #333;
        text-decoration: none;
        border-radius: 25px;
        font-weight: 600;
        transition: all 0.3s ease;
      }

      .btn-back:hover {
        transform: translateY(-2px);
        box-shadow: 0 6px 20px rgba(0, 0, 0, 0.3);
      }

      @media (max-width: 768px) {
        .container { padding: 20px 15px; }
        .content { padding: 25px; }
        h1 { font-size: 2rem; }
      }
    </style>
  </head>
  <body>
    <header class="header">
      <nav class="nav">
        <a href="/" class="logo">ZoneTrain</a>
      </nav>
    </header>

    <div class="container">
      <h1>Terms of Service</h1>
      <p class="effective-date">Effective Date: September 18, 2025</p>

      <div class="content">
        <h2>1. Acceptance of Terms</h2>
        <p>By accessing and using ZoneTrain's AI-powered running coaching and personalized training plan services ("Services"), you agree to be bound by these Terms of Service ("Terms"). If you do not agree to these Terms, please do not use our Services.</p>

        <h2>2. Description of Services</h2>
        <p>ZoneTrain provides professional fitness coaching services including:</p>
        <ul>
          <li>AI-powered analysis of training zones based on Strava activity data</li>
          <li>Personalized workout recommendations based on Heart Rate Variability (HRV) readings</li>
          <li>Daily coaching guidance delivered through WhatsApp Business API</li>
          <li>Customized training plans for runners at various skill levels</li>
          <li>Performance tracking and progress analysis</li>
        </ul>

        <h2>3. User Accounts and Registration</h2>
        <p>To access our Services, you must create an account and provide accurate, current information. You are responsible for maintaining the confidentiality of your account credentials and for all activities that occur under your account. You must be at least 18 years old to use our Services.</p>

        <h2>4. Subscription Plans and Payment</h2>
        <p>Our Services are offered through various subscription plans with different features and pricing. By subscribing, you agree to pay all applicable fees. Subscriptions automatically renew unless cancelled. We offer a 14-day free trial for new users with no credit card required.</p>

        <p><strong>Cancellation:</strong> You may cancel your subscription at any time through your account settings or by contacting us. Cancellations take effect at the end of the current billing period.</p>

        <h2>5. Acceptable Use</h2>
        <p>You agree to use our Services only for lawful purposes and in accordance with these Terms. You must not:</p>
        <ul>
          <li>Provide false or misleading health information</li>
          <li>Share your account with others</li>
          <li>Attempt to reverse engineer or copy our AI algorithms</li>
          <li>Use our Services for any commercial purpose without authorization</li>
          <li>Violate any applicable laws or regulations</li>
        </ul>

        <h2>6. Health and Fitness Disclaimers</h2>
        <p><strong>Not Medical Advice:</strong> Our Services provide fitness coaching and training recommendations based on data analysis. This is not medical advice and should not replace consultation with qualified healthcare professionals.</p>

        <p><strong>Assumption of Risk:</strong> Physical exercise carries inherent risks. You participate in recommended activities at your own risk and should consult with a physician before beginning any exercise program.</p>

        <p><strong>Personal Responsibility:</strong> You are solely responsible for monitoring your health and modifying or stopping activities if you experience any adverse symptoms.</p>

        <h2>7. WhatsApp Communications</h2>
        <p>By providing your WhatsApp number, you consent to receive automated coaching messages and workout recommendations via WhatsApp Business API. You may opt out at any time by replying "STOP" to any message or contacting us directly.</p>

        <h2>8. Data and Privacy</h2>
        <p>Your privacy is important to us. Our collection and use of your information is governed by our Privacy Policy, which is incorporated into these Terms by reference. By using our Services, you consent to the collection and use of your information as described in our Privacy Policy.</p>

        <h2>9. Intellectual Property</h2>
        <p>All content, features, and functionality of our Services, including our AI algorithms, training methodologies, and user interface, are owned by ZoneTrain and protected by copyright, trademark, and other intellectual property laws.</p>

        <h2>10. Third-Party Integrations</h2>
        <p>Our Services integrate with third-party platforms like Strava and WhatsApp. Your use of these integrations is subject to their respective terms of service and privacy policies. We are not responsible for the availability or functionality of third-party services.</p>

        <h2>11. Limitation of Liability</h2>
        <p>To the maximum extent permitted by law, ZoneTrain shall not be liable for any indirect, incidental, special, consequential, or punitive damages arising from your use of our Services, including but not limited to injuries, loss of data, or business interruption.</p>

        <h2>12. Indemnification</h2>
        <p>You agree to indemnify and hold ZoneTrain harmless from any claims, damages, or expenses arising from your use of our Services, violation of these Terms, or infringement of any third-party rights.</p>

        <h2>13. Service Availability</h2>
        <p>We strive to maintain high service availability but do not guarantee uninterrupted access. We may temporarily suspend or restrict access for maintenance, updates, or other operational reasons.</p>

        <h2>14. Modifications to Terms</h2>
        <p>We reserve the right to modify these Terms at any time. We will notify users of material changes through our website or other communication channels. Continued use of our Services after changes constitutes acceptance of the new Terms.</p>

        <h2>15. Termination</h2>
        <p>Either party may terminate the agreement at any time. We may suspend or terminate your account for violation of these Terms. Upon termination, your right to use the Services ceases immediately.</p>

        <h2>16. Governing Law</h2>
        <p>These Terms are governed by the laws of India. Any disputes arising from these Terms or the use of our Services shall be subject to the exclusive jurisdiction of the courts in New Delhi, India.</p>

        <h2>17. Contact Information</h2>
        <p>If you have any questions about these Terms, please contact us at:</p>
        <p>Email: zonetrain@zohomail.in<br>
        Address: ZoneTrain, AP Block, Pitampura, New Delhi-110034, India</p>

        <h2>18. Severability</h2>
        <p>If any provision of these Terms is found to be unenforceable or invalid, the remaining provisions will continue to be valid and enforceable to the fullest extent permitted by law.</p>
      </div>

      <a href="/" class="btn-back">← Back to Home</a>
    </div>
    ${getCookieBannerHTML()}
    ${getCookieModalHTML()}
    <script src="/components/nav-header.js"></script>
  </body>
  </html>
  `;
  res.send(html);
});


// Direct Strava connection route (bypasses login)
// Make sure this route exists and works correctly
app.get('/strava-connect', (req, res) => {
    const userToken = req.query.userToken;
    console.log('🔗 Strava connect request, userToken:', userToken ? 'Present' : 'Missing');
    
    let stateValue;
    
    if (userToken) {
        // Authenticated user
        stateValue = userToken;
        console.log('👤 Authenticated user connection');
    } else {
        // Guest user
        stateValue = 'guest_' + Date.now() + '_' + Math.random().toString(36).substring(2);
        console.log('🎯 Guest user connection');
    }
    
    const stravaAuthUrl = 
        'https://www.strava.com/oauth/authorize?' +
        `client_id=${process.env.STRAVA_CLIENT_ID}&` +
        'response_type=code&' +
        `redirect_uri=${encodeURIComponent(process.env.STRAVA_REDIRECT_URI)}&` +
        'approval_prompt=force&' +
        'scope=read,activity:read_all&' +
        `state=${encodeURIComponent(stateValue)}`;
    
    console.log('🔗 Redirecting to Strava');
    res.redirect(stravaAuthUrl);
});





// Update your existing /login route to also redirect to Strava
app.get('/login', (req, res) => {
  const stravaAuthUrl = `https://www.strava.com/oauth/authorize?client_id=${process.env.STRAVA_CLIENT_ID}&response_type=code&redirect_uri=${process.env.STRAVA_REDIRECT_URI}&approval_prompt=force&scope=read,activity:read_all`;
  res.redirect(stravaAuthUrl);
});


// Redirect to Strava for authorization
app.get('/login', (req, res) => {
  const authUrl = `https://www.strava.com/oauth/authorize?client_id=${process.env.STRAVA_CLIENT_ID}&redirect_uri=${process.env.STRAVA_REDIRECT_URI}&response_type=code&scope=read,activity:read_all,activity:write`;
  res.redirect(authUrl);
});

// Handle callback and exchange for tokens
// REPLACE your existing app.get('/callback', ...) with this FIXED version:
// REPLACE your existing app.get('/callback', ...) with this FIXED version:
// REPLACE your existing /callback route with this enhanced version
app.get('/callback', async (req, res) => {
    console.log('🎯 STRAVA CALLBACK START');
    console.log('Query:', req.query);
    
    const { code, state } = req.query;
    
    if (!code) {
        console.log('❌ No code');
        return res.redirect('/?error=no_code');
    }
    
    if (!state) {
        console.log('❌ No state (userToken or guest session)');
        return res.redirect('/?error=no_state');
    }
    
    try {
        // Get tokens from Strava
        console.log('📡 Getting tokens from Strava...');
        const tokenResponse = await axios.post('https://www.strava.com/oauth/token', {
            client_id: process.env.STRAVA_CLIENT_ID,
            client_secret: process.env.STRAVA_CLIENT_SECRET,
            code: code,
            grant_type: 'authorization_code'
        });
        
        const { access_token, refresh_token } = tokenResponse.data;
        console.log('✅ Got tokens:', !!access_token, !!refresh_token);
        
        // Check if this is a guest user or authenticated user
        if (state.startsWith('guest_')) {
            console.log('👤 Guest user detected');
            
            // For guests: Store tokens temporarily and redirect to instant analysis
            const guestData = {
                sessionId: state,
                accessToken: access_token,
                refreshToken: refresh_token,
                connectedAt: new Date(),
                expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000) // 2 hours
            };
            
            // Store in memory (or temporary DB collection)
            global.guestSessions = global.guestSessions || new Map();
            global.guestSessions.set(state, guestData);
            
            console.log('✅ Guest session created, redirecting to analysis');
            return res.redirect(`/guest-analysis?session=${encodeURIComponent(state)}`);
            
        } else {
            console.log('🔓 Authenticated user detected');
            
            // Existing authenticated user flow
            const decoded = jwt.verify(state, process.env.JWT_SECRET);
            console.log('✅ User ID:', decoded.userId);
            
            // Save to database
            await db.collection('users').doc(decoded.userId).update({
                stravaAccessToken: access_token,
                stravaRefreshToken: refresh_token,
                stravaConnectedAt: new Date(),
                updatedAt: new Date()
            });
            
            console.log('✅ Database updated');
            return res.redirect('/dashboard.html?strava=connected');
        }
        
    } catch (error) {
        console.error('💥 ERROR:', error.message);
        if (state?.startsWith('guest_')) {
            return res.redirect('/?error=guest_failed');
        } else {
            return res.redirect('/dashboard.html?error=failed');
        }
    }
});






// View activities (existing)
// Updated activities route
app.get('/activities', async (req, res) => {
  const access_token = storedTokens.access_token;
  if (!access_token) {
    return res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
    <link rel="stylesheet" href="css/cookies.css">
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>ZoneTrain - Connect Required</title>
      <style>
        :root {
          --deep-purple: #6B46C1;
          --light-purple: #A78BFA;
          --accent-purple: #8B5CF6;
          --white: #FFFFFF;
          --dark-gray: #1F2937;
          --success-green: #10B981;
        }
        
        body {
          font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
          background: linear-gradient(135deg, var(--deep-purple) 0%, var(--accent-purple) 100%);
          min-height: 100vh;
          display: flex;
          justify-content: center;
          align-items: center;
          color: var(--white);
          text-align: center;
          padding: 20px;
        }
        
        .connect-prompt {
          background: rgba(255, 255, 255, 0.1);
          padding: 40px;
          border-radius: 20px;
          backdrop-filter: blur(15px);
          border: 1px solid rgba(255, 255, 255, 0.2);
          max-width: 500px;
        }
        
        h1 { 
          color: var(--white);
          margin-bottom: 20px; 
          font-size: 2rem;
          text-shadow: 2px 2px 4px rgba(0, 0, 0, 0.3);
        }
        
        .btn {
          display: inline-block;
          margin: 10px;
          padding: 15px 30px;
          text-decoration: none;
          border-radius: 25px;
          font-weight: 600;
          transition: all 0.3s ease;
        }
        
        .btn-primary {
          background: var(--success-green);
          color: var(--white);
        }
        
        .btn-secondary {
          background: rgba(255, 255, 255, 0.2);
          color: var(--white);
          border: 2px solid rgba(255, 255, 255, 0.3);
        }
        
        .btn:hover { 
          transform: translateY(-2px);
          box-shadow: 0 6px 15px rgba(0, 0, 0, 0.3);
        }
      </style>
    </head>
    <body>
      <div class="connect-prompt">
        <h1>🔗 Connect to Strava First</h1>
        <p>Please connect your Strava account to view activities</p>
        <a href="/login" class="btn btn-primary">Connect with Strava</a>
        <a href="/" class="btn btn-secondary">Back to Home</a>
      </div>
      ${getCookieBannerHTML()}
    ${getCookieModalHTML()}
    <script src="/components/nav-header.js"></script>
    </body>
    </html>
    `);
  }

  try {
    const activities = await axios.get('https://www.strava.com/api/v3/athlete/activities?per_page=10', {
      headers: { Authorization: `Bearer ${access_token}` }
    });

    const html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>ZoneTrain - Your Activities</title>
      <style>
        :root {
          --deep-purple: #6B46C1;
          --light-purple: #A78BFA;
          --accent-purple: #8B5CF6;
          --white: #FFFFFF;
          --dark-gray: #1F2937;
          --success-green: #10B981;
        }

        * { margin: 0; padding: 0; box-sizing: border-box; }

        body {
          font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
          background: var(--white);
          color: var(--dark-gray);
          min-height: 100vh;
        }

        .header {
          background: var(--deep-purple);
          color: var(--white);
          padding: 30px 20px;
          text-align: center;
        }

        .header h1 {
          font-size: 2.5rem;
          margin-bottom: 10px;
          text-shadow: 2px 2px 4px rgba(0, 0, 0, 0.3);
        }

        .subtitle {
          font-size: 1.1rem;
          opacity: 0.9;
        }

        .container {
          max-width: 900px;
          margin: 0 auto;
          padding: 40px 20px;
        }

        .activities-grid {
          display: grid;
          gap: 20px;
          margin-bottom: 40px;
        }

        .activity-card {
          background: var(--white);
          border-radius: 15px;
          padding: 25px;
          box-shadow: 0 4px 15px rgba(107, 70, 193, 0.1);
          border-left: 4px solid var(--accent-purple);
          transition: all 0.3s ease;
        }

        .activity-card:hover {
          transform: translateY(-2px);
          box-shadow: 0 8px 25px rgba(107, 70, 193, 0.2);
        }

        .activity-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          margin-bottom: 15px;
        }

        .activity-name {
          font-size: 1.3rem;
          font-weight: 600;
          color: var(--deep-purple);
          margin-bottom: 5px;
        }

        .activity-type {
          font-size: 0.9rem;
          background: var(--light-purple);
          color: var(--white);
          padding: 4px 12px;
          border-radius: 12px;
        }

        .activity-stats {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
          gap: 15px;
          margin-top: 15px;
        }

        .stat-item {
          text-align: center;
          background: linear-gradient(135deg, var(--light-purple), rgba(167, 139, 250, 0.8));
          color: var(--white);
          padding: 12px;
          border-radius: 10px;
        }

        .stat-label {
          font-size: 0.8rem;
          opacity: 0.9;
          margin-bottom: 5px;
        }

        .stat-value {
          font-size: 1.1rem;
          font-weight: 600;
        }

        .navigation {
          display: flex;
          justify-content: center;
          gap: 15px;
          flex-wrap: wrap;
        }

        .btn {
          padding: 12px 25px;
          border-radius: 25px;
          text-decoration: none;
          font-weight: 600;
          transition: all 0.3s ease;
          text-align: center;
        }

        .btn-primary {
          background: var(--deep-purple);
          color: var(--white);
        }

        .btn-secondary {
          background: var(--white);
          color: var(--deep-purple);
          border: 2px solid var(--light-purple);
        }

        .btn:hover {
          transform: translateY(-2px);
          box-shadow: 0 6px 15px rgba(0, 0, 0, 0.2);
        }

        .btn-primary:hover {
          background: var(--accent-purple);
        }

        .btn-secondary:hover {
          background: var(--light-purple);
          color: var(--white);
        }

        .empty-state {
          text-align: center;
          padding: 60px 20px;
          background: linear-gradient(135deg, var(--light-purple), rgba(167, 139, 250, 0.8));
          color: var(--white);
          border-radius: 15px;
        }

        @media (max-width: 768px) {
          .container { padding: 20px 10px; }
          .header h1 { font-size: 2rem; }
          .activity-header { flex-direction: column; gap: 10px; }
          .navigation { flex-direction: column; align-items: center; }
          .btn { width: 100%; max-width: 280px; }
        }
      </style>
    </head>
    
    <body>
      <div class="header">
        <h1>🏃‍♂️ Your Activities</h1>
        <p class="subtitle">Recent workouts from your Strava account</p>
      </div>

      <div class="container">
        <div class="activities-grid">
          ${activities.data.length > 0 ? activities.data.map(activity => {
            const distanceKm = (activity.distance / 1000).toFixed(2);
            const timeMinutes = Math.floor(activity.moving_time / 60);
            const avgHR = activity.has_heartrate ? activity.average_heartrate : 'N/A';
            const elevationGain = activity.total_elevation_gain || 0;
            
            return `
            <div class="activity-card">
              <div class="activity-header">
                <div>
                  <div class="activity-name">${activity.name}</div>
                  <div class="activity-type">${activity.type}</div>
                </div>
              </div>
              
              <div class="activity-stats">
                <div class="stat-item">
                  <div class="stat-label">Distance</div>
                  <div class="stat-value">${distanceKm} km</div>
                </div>
                <div class="stat-item">
                  <div class="stat-label">Time</div>
                  <div class="stat-value">${timeMinutes} min</div>
                </div>
                <div class="stat-item">
                  <div class="stat-label">Avg HR</div>
                  <div class="stat-value">${avgHR}${avgHR !== 'N/A' ? ' bpm' : ''}</div>
                </div>
                <div class="stat-item">
                  <div class="stat-label">Elevation</div>
                  <div class="stat-value">${elevationGain}m</div>
                </div>
              </div>
            </div>
            `;
          }).join('') : `
          <div class="empty-state">
            <h2>No Activities Found</h2>
            <p>Upload some activities to Strava to see them here!</p>
          </div>
          `}
        </div>

        <div class="navigation">
          <a href="/analyze-zones" class="btn btn-primary">🎯 Analyze Training Zones</a>
          <a href="/" class="btn btn-secondary">🏠 Back to Home</a>
        </div>
      </div>
      ${getCookieBannerHTML()}
    ${getCookieModalHTML()}
    <script src="/components/nav-header.js"></script>
    </body>
    </html>
    `;

    res.send(html);
  } catch (error) {
    // Error handling with purple theme...
  }
});


// NEW: Analyze training zones and update Strava
// Updated analyze-zones route with beautiful styling
// REPLACE your existing app.get('/analyze-zones', ...) with this:
// Make sure your analyze-zones route looks like this:
app.get('/analyze-zones', authenticateToken, async (req, res) => {
    try {
        console.log('🏃 Zone Analysis - User ID:', req.user.userId);
        
        // Get user's Strava tokens
        const tokens = await userManager.getStravaTokens(req.user.userId);
        
        if (!tokens) {
            console.log('❌ No Strava tokens found for user');
            return res.redirect('/dashboard.html?action=connect_strava');
        }

        console.log('✅ Found Strava tokens, fetching activities...');

        // Test token validity and fetch activities
        const activitiesResponse = await axios.get('https://www.strava.com/api/v3/athlete/activities?per_page=15', {
            headers: { 'Authorization': `Bearer ${tokens.accessToken}` }
        });

        const activities = activitiesResponse.data;
        const runningActivities = activities.filter(a => a.has_heartrate && a.type === 'Run');

        console.log(`Found ${runningActivities.length} running activities with HR data`);

        if (runningActivities.length < 3) {
            return res.send(generateInsufficientDataHTML(runningActivities.length));
        }

        // Analyze zones
        const zoneAnalysis = analyzeTrainingZones(runningActivities);
        
        // Generate AI insight
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
        
        const zoneSummary = zoneAnalysis.zoneNames.map((name, i) => 
            `${name}: ${zoneAnalysis.percentages[i]}%`
        ).join(', ');
        
        const prompt = `Based on this running zone distribution: ${zoneSummary}. Generate a brief training insight (max 20 words) focusing on what the runner should do next.`;
        const aiResponse = await model.generateContent(prompt);
        const aiInsight = aiResponse.response.text().trim();

        // Save analysis to database
        const analysisData = {
            percentages: zoneAnalysis.percentages,
            totalActivities: zoneAnalysis.totalActivities,
            aiInsight: aiInsight,
            zoneNames: zoneAnalysis.zoneNames
        };
        if (window.ztCookies && window.ztCookies.hasConsent('analytics')) {
    ztCookies.trackEvent('zone_analysis_completed', {
        userId: req.user.userId,
        totalActivities: analysisData.totalActivities,
        analysisType: 'authenticated_user',
        aiInsightGenerated: true
    });
}
        
        await userManager.saveZoneAnalysis(req.user.userId, analysisData);

        console.log('✅ Analysis complete, showing results');
        
        // Return beautiful analysis page WITH DASHBOARD LINK
        res.send(generateAnalysisHTML(analysisData, true));

    } catch (error) {
        console.error('❌ Zone analysis error:', error);
        
        if (error.response?.status === 401) {
            return res.redirect('/dashboard.html?action=reconnect_strava');
        }
        
        res.send(generateErrorHTML(error.message));
    }
});



// Add these NEW routes to your app.js

// Dashboard data endpoint - ADD THIS NEW ROUTE
// Make sure this route calls the right method
// Make sure this route calls the right method
app.get('/api/dashboard/data', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        
        console.log('📊 Loading dashboard for user:', userId);
        
        // Get user from userManager (may not exist in Firestore users collection)
        let user = null;
        try {
            user = await userManager.getUserById(userId);
        } catch (userError) {
            console.warn('⚠️ User not found in userManager:', userId);
        }
        
        // Get AI profile from Firestore
        let aiProfile = null;
        let hasCompletedOnboarding = false;
        try {
            const profileDoc = await db.collection('aiprofiles').doc(userId).get();
            if (profileDoc.exists) {
                aiProfile = profileDoc.data();
                hasCompletedOnboarding = true;
                console.log('✅ AI profile found');
            }
        } catch (profileError) {
            console.warn('⚠️ No AI profile:', profileError.message);
        }
        
        // Get active training plan
        let trainingPlan = null;
        try {
            const planSnapshot = await db.collection('trainingplans')
                .where('userId', '==', userId)
                .where('isActive', '==', true)
                .orderBy('createdAt', 'desc')
                .limit(1)
                .get();

                const hasPlan = !planSnapshot.empty && planSnapshot.docs[0].data().isActive;
const plan = hasPlan ? planSnapshot.docs[0].data() : null;
            
            if (!planSnapshot.empty) {
                trainingPlan = planSnapshot.docs[0].data();
                console.log('✅ Training plan found');
            }
        } catch (planError) {
            console.warn('⚠️ No training plan:', planError.message);
        }
        
        // Get latest zone analysis (if user exists)
        let latestAnalysis = null;
        let stravaConnected = false;
        
        if (user) {
            try {
                latestAnalysis = await userManager.getLatestZoneAnalysis(userId);
                const stravaTokens = await userManager.getStravaTokens(userId);
                stravaConnected = !!stravaTokens;
            } catch (error) {
                console.warn('⚠️ Could not load user data:', error.message);
            }
        }
        
        // Build response
        res.json({
            success: true,
            data: {
                user: user ? {
                    name: user.firstName || user.email.split('@')[0],
                    email: user.email,
                    subscriptionStatus: user.subscriptionStatus || 'free',
                    currentPlan: user.currentPlan
                } : {
                    name: 'User',
                    subscriptionStatus: 'free'
                },
                strava: {
                    connected: stravaConnected,
                    connectionDate: user?.stravaConnectedAt || null
                },
                latestAnalysis: latestAnalysis,
                
                // ADD AI PROFILE & PLAN DATA
                aiCoaching: {
                    onboardingCompleted: hasCompletedOnboarding,
                    profile: aiProfile,
                    activePlan: trainingPlan,
                    planType: trainingPlan?.planType || null,
                    weeksRemaining: trainingPlan ? calculateWeeksRemaining(trainingPlan, aiProfile) : null
                }
            }
        });
        
        console.log('✅ Dashboard data loaded');
        
    } catch (error) {
        console.error('❌ Dashboard data error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to load dashboard data'
        });
    }
});

// Helper function
function calculateWeeksRemaining(plan, profile) {
    if (!profile?.raceHistory?.targetRace?.daysToRace) return null;
    return Math.ceil(profile.raceHistory.targetRace.daysToRace / 7);
}




// Add these NEW functions to your app.js

// Updated analysis HTML generator with dashboard navigation
function generateAnalysisHTML(analysisData, showDashboardLink = false) {
    const backLink = showDashboardLink ? 
        `<a href="/dashboard.html" class="btn btn-secondary">← Back to Dashboard</a>` :
        `<a href="/" class="btn btn-secondary">Back to Home</a>`;

    return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
    <link rel="stylesheet" href="css/cookies.css">
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Training Zone Analysis - ZoneTrain</title>
        <style>
            body {
                font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                min-height: 100vh;
                color: white;
                padding: 20px;
                margin: 0;
            }
            .container { max-width: 900px; margin: 0 auto; }
            .header { text-align: center; margin-bottom: 40px; }
            .zones-container {
                background: rgba(255, 255, 255, 0.1);
                backdrop-filter: blur(15px);
                border-radius: 20px;
                padding: 30px;
                margin-bottom: 30px;
                border: 1px solid rgba(255, 255, 255, 0.2);
            }
            .zone-item {
                display: flex;
                justify-content: space-between;
                padding: 15px 20px;
                margin-bottom: 12px;
                background: rgba(255, 255, 255, 0.1);
                border-radius: 12px;
                border-left: 4px solid #4CAF50;
            }
            .insight-container {
                background: linear-gradient(45deg, rgba(255, 215, 0, 0.2), rgba(255, 183, 0, 0.2));
                border-radius: 20px;
                padding: 30px;
                margin-bottom: 30px;
                text-align: center;
                border: 2px solid rgba(255, 215, 0, 0.3);
            }
            .navigation {
                display: flex;
                justify-content: center;
                gap: 20px;
                flex-wrap: wrap;
            }
            .btn {
                padding: 15px 30px;
                border-radius: 25px;
                text-decoration: none;
                font-weight: 600;
                transition: all 0.3s ease;
                cursor: pointer;
                border: none;
                font-size: 1rem;
                display: inline-block;
            }
            .btn-primary {
                background: linear-gradient(45deg, #FFD700, #FFB700);
                color: #333;
            }
            .btn-secondary {
                background: rgba(255, 255, 255, 0.2);
                color: white;
                border: 2px solid rgba(255, 255, 255, 0.3);
            }
            .btn:hover {
                transform: translateY(-3px);
                box-shadow: 0 6px 20px rgba(0, 0, 0, 0.3);
            }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>Training Zone Analysis Complete!</h1>
                <p>Your running zone distribution analyzed</p>
            </div>

            <div class="zones-container">
                <h3>Your Running Zone Distribution</h3>
                ${analysisData.zoneNames.map((name, i) => `
                    <div class="zone-item">
                        <span class="zone-name">${name}</span>
                        <span class="zone-percentage">${analysisData.percentages[i].toFixed(1)}%</span>
                    </div>
                `).join('')}
            </div>

            <div class="insight-container">
                <h3>💡 AI-Powered Insight</h3>
                <div class="ai-insight">${analysisData.aiInsight}</div>
            </div>

            <div class="navigation">
                ${backLink}
                <button class="btn btn-primary" onclick="refreshAnalysis()">Refresh Analysis</button>
                <a href="/plans.html" class="btn btn-primary">Upgrade Training Plans</a>
            </div>
        </div>

        <script>
            function refreshAnalysis() {
                window.location.reload();
            }
        </script>
        ${getCookieBannerHTML()}
    ${getCookieModalHTML()}
    <script src="/components/nav-header.js"></script>
    </body>
    </html>
    `;
}

function generateInsufficientDataHTML(foundActivities) {
    return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
    <link rel="stylesheet" href="css/cookies.css">
        <meta charset="UTF-8">
        <title>Need More Data - ZoneTrain</title>
        <style>
            body {
                font-family: 'Segoe UI', sans-serif;
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                min-height: 100vh;
                display: flex;
                justify-content: center;
                align-items: center;
                color: white;
                text-align: center;
                padding: 20px;
                margin: 0;
            }
            .insufficient-data {
                background: rgba(255, 255, 255, 0.1);
                padding: 40px;
                border-radius: 20px;
                backdrop-filter: blur(15px);
                border: 1px solid rgba(255, 255, 255, 0.2);
            }
            .btn {
                display: inline-block;
                margin: 10px;
                padding: 15px 30px;
                background: #FFD700;
                color: #333;
                text-decoration: none;
                border-radius: 25px;
                font-weight: 600;
                transition: all 0.3s ease;
            }
            .btn:hover { transform: translateY(-2px); }
        </style>
    </head>
    <body>
        <div class="insufficient-data">
            <h1>🏃‍♂️ Need More Running Data</h1>
            <p>We need at least 3 running activities with heart rate data for accurate zone analysis.</p>
            <div class="requirement">
                <strong>Found:</strong> ${foundActivities} running activities with HR data<br>
                <strong>Required:</strong> 3+ activities
            </div>
            <p>Go for a few more runs with your heart rate monitor, then come back!</p>
            <div class="navigation">
                <a href="/dashboard.html" class="btn">← Back to Dashboard</a>
                <button class="btn" onclick="window.location.reload()">Check Again</button>
            </div>
        </div>
        ${getCookieBannerHTML()}
    ${getCookieModalHTML()}
    <script src="/components/nav-header.js"></script>
    </body>
    </html>
    `;
}

function generateErrorHTML(errorMessage) {
    return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
    <link rel="stylesheet" href="css/cookies.css">
        <meta charset="UTF-8">
        <title>Analysis Error - ZoneTrain</title>
        <style>
            body {
                font-family: 'Segoe UI', sans-serif;
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                min-height: 100vh;
                display: flex;
                justify-content: center;
                align-items: center;
                color: white;
                text-align: center;
                padding: 20px;
                margin: 0;
            }
            .error-container {
                background: rgba(255, 0, 0, 0.1);
                padding: 40px;
                border-radius: 20px;
                backdrop-filter: blur(15px);
                border: 2px solid rgba(255, 0, 0, 0.3);
            }
            .btn {
                display: inline-block;
                margin: 10px;
                padding: 15px 25px;
                background: #FFD700;
                color: #333;
                text-decoration: none;
                border-radius: 25px;
                font-weight: 600;
                transition: all 0.3s ease;
            }
            .btn:hover { transform: translateY(-2px); }
        </style>
    </head>
    <body>
        <div class="error-container">
            <h1>⚠️ Analysis Error</h1>
            <p>We encountered an error while analyzing your training zones.</p>
            <div class="error-details">${errorMessage}</div>
            <a href="/dashboard.html" class="btn">← Back to Dashboard</a>
            <a href="/strava-connect" class="btn">Reconnect to Strava</a>
        </div>
        ${getCookieBannerHTML()}
    ${getCookieModalHTML()}
    <script src="/components/nav-header.js"></script>
    </body>
    </html>
    `;
}

function generateGuestAnalysisHTML(analysisData) {
    return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
    <link rel="stylesheet" href="css/cookies.css">
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Your Running Zone Analysis | ZoneTrain</title>
        <style>
            body { 
                font-family: 'Inter', sans-serif; 
                background: linear-gradient(135deg, #0f0f23, #1a1a2e); 
                color: white; 
                margin: 0; 
                padding: 20px; 
            }
            .container { max-width: 800px; margin: 0 auto; }
            .hero { text-align: center; margin-bottom: 40px; }
            .analysis-card { 
                background: rgba(255,255,255,0.05); 
                border-radius: 20px; 
                padding: 30px; 
                margin-bottom: 30px;
                border: 1px solid rgba(255,255,255,0.1);
            }
            .zones-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 20px; }
            .zone-item { text-align: center; padding: 20px; background: rgba(99,102,241,0.1); border-radius: 15px; }
            .ai-insight { 
                background: linear-gradient(135deg, #6366f1, #8b5cf6); 
                padding: 25px; 
                border-radius: 15px; 
                margin: 30px 0; 
                text-align: center;
            }
            .signup-cta { 
                background: linear-gradient(135deg, #f59e0b, #fbbf24); 
                padding: 40px; 
                border-radius: 20px; 
                text-align: center; 
                color: #1f2937;
                margin-top: 40px;
            }
            .btn { 
                background: #1f2937; 
                color: white; 
                padding: 15px 30px; 
                border-radius: 25px; 
                text-decoration: none; 
                font-weight: 600; 
                margin: 10px;
                display: inline-block;
            }
            .btn-primary { background: linear-gradient(135deg, #6366f1, #8b5cf6); }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="hero">
                <h1>🎉 Your Running Zone Analysis</h1>
                <p>Based on ${analysisData.totalActivities} activities from your Strava</p>
            </div>

            <div class="analysis-card">
                <h2>Training Zone Distribution</h2>
                <div class="zones-grid">
                    ${analysisData.zoneNames.map((name, i) => `
                        <div class="zone-item">
                            <div style="font-size: 2rem; font-weight: bold; color: #6366f1;">
                                ${analysisData.percentages[i]}%
                            </div>
                            <div style="margin-top: 10px; opacity: 0.8;">
                                ${name}
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>

            <div class="ai-insight">
                <h3>🧠 AI Training Insight</h3>
                <p style="font-size: 1.1rem; margin-top: 15px;">
                    ${analysisData.aiInsight}
                </p>
            </div>

            <div class="signup-cta">
                <h2>🚀 Want More Insights?</h2>
                <p>Create a free account to track your progress, get personalized coaching, and access advanced analytics.</p>
                <a href="/signup" class="btn btn-primary">Create Free Account</a>
                <a href="/" class="btn">Try Another Analysis</a>
            </div>
        </div>
        ${getCookieBannerHTML()}
    ${getCookieModalHTML()}
    <script src="/components/nav-header.js"></script>
    </body>
    </html>
    `;
}


// Dashboard data API route - ADD THIS
app.get('/api/dashboard/data', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        const user = await userManager.getUserById(userId);
        
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }
        
        // Get latest zone analysis
        const latestAnalysis = await userManager.getLatestZoneAnalysis(userId);
        
        // Check Strava connection
        const stravaTokens = await userManager.getStravaTokens(userId);
        const stravaConnected = !!stravaTokens;

        res.json({
            success: true,
            data: {
                user: {
                    name: user.firstName || user.email.split('@')[0],
                    email: user.email,
                    subscriptionStatus: user.subscriptionStatus || 'free',
                    currentPlan: user.currentPlan
                },
                strava: {
                    connected: stravaConnected,
                    connectionDate: user.stravaConnectedAt
                },
                latestAnalysis: latestAnalysis
            }
        });
    } catch (error) {
        console.error('Dashboard data error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to load dashboard data'
        });
    }
});

// ============================================
// ZONETRAIN COOKIE CONSENT SYSTEM - ADD THESE ROUTES
// ============================================

// Cookie Consent Logging (GDPR/DPDP Compliance)
app.post('/api/cookie-consent', async (req, res) => {
    try {
        console.log('📝 Logging cookie consent for compliance');
        
        const consentData = {
            ...req.body,
            ip: req.ip,
            userAgent: req.headers['user-agent'],
            timestamp: new Date(),
            source: 'zonetrain_banner',
            app: 'zonetrain'
        };
        
        // Log to Firebase for compliance audit trail
        await db.collection('cookie_consents').add(consentData);
        
        console.log('✅ Cookie consent logged:', consentData.categories);
        res.json({ 
            success: true,
            message: 'Consent preferences saved',
            timestamp: consentData.timestamp
        });
    } catch (error) {
        console.error('❌ Error logging cookie consent:', error);
        res.status(500).json({ 
            success: false,
            error: 'Failed to save consent preferences' 
        });
    }
});

// Get User's Cookie Consent Status
app.get('/api/cookie-consent/status', async (req, res) => {
    try {
        const userId = req.query.userId || req.user?.userId;
        
        if (userId) {
            // Get latest consent for authenticated user
            const consentQuery = await db.collection('cookie_consents')
                .where('userId', '==', userId)
                .orderBy('timestamp', 'desc')
                .limit(1)
                .get();
            
            if (!consentQuery.empty) {
                const latestConsent = consentQuery.docs[0].data();
                return res.json({
                    hasConsent: true,
                    consent: latestConsent,
                    source: 'database'
                });
            }
        }
        
        // Return default response for guests or users without consent
        res.json({ 
            hasConsent: false,
            message: 'No consent record found',
            defaultCategories: {
                essential: true,
                analytics: false,
                marketing: false,
                functional: false
            }
        });
    } catch (error) {
        console.error('❌ Error getting consent status:', error);
        res.status(500).json({ 
            error: 'Failed to get consent status' 
        });
    }
});

// Analytics Event Tracking (Only if consent given)
app.post('/api/analytics/track', async (req, res) => {
    try {
        const { event, data, timestamp, source } = req.body;
        
        console.log('📊 Analytics event:', event, 'from', source);
        
        // Store analytics event in database
        const analyticsEvent = {
            event,
            data,
            timestamp: timestamp || new Date(),
            source: source || 'unknown',
            ip: req.ip,
            userAgent: req.headers['user-agent'],
            app: 'zonetrain'
        };
        
        await db.collection('analytics_events').add(analyticsEvent);
        
        res.json({ success: true });
    } catch (error) {
        console.error('❌ Analytics tracking error:', error);
        res.json({ success: false }); // Don't break user experience
    }
});

// Privacy Policy Route (If you don't have one)
app.get('/privacy-policy', (req, res) => {
    res.send(`
    <!DOCTYPE html>
    <html>
    <head>
    <link rel="stylesheet" href="css/cookies.css">
        <title>Privacy Policy - ZoneTrain</title>
        <link rel="stylesheet" href="css/main.css">
    </head>
    <body style="padding: 40px; background: linear-gradient(135deg, #6B46C1, #8B5CF6); color: white;">
        <div style="max-width: 800px; margin: 0 auto;">
            <h1>ZoneTrain Privacy Policy</h1>
            <p><strong>Last updated:</strong> ${new Date().toLocaleDateString()}</p>
            
            <h2>Information We Collect</h2>
            <p>We collect information you provide directly, such as when you create an account, connect your Strava account, or use our training analysis features.</p>
            
            <h2>How We Use Your Information</h2>
            <p>We use your information to provide personalized training analysis, improve our services, and communicate with you about your training progress.</p>
            
            <h2>Cookies and Tracking</h2>
            <p>We use cookies to enhance your experience, analyze site usage, and provide personalized content. You can control cookie preferences through our cookie banner.</p>
            
            <h2>Data Sharing</h2>
            <p>We do not sell your personal data. We may share data with service providers who help us operate our platform.</p>
            
            <h2>Contact Us</h2>
            <p>If you have questions about this privacy policy, contact us at privacy@zonetrain.com</p>
            
            <p><a href="/" style="color: #A78BFA;">← Back to ZoneTrain</a></p>
        </div>
        ${getCookieBannerHTML()}
    ${getCookieModalHTML()}
    <script src="/components/nav-header.js"></script>
    </body>
    </html>
    `);
});

// Cookie Policy Route
// ============================================
// ZONETRAIN COOKIE CONSENT SYSTEM - ADD THESE ROUTES
// ============================================

// Cookie Consent Logging (GDPR/DPDP Compliance)
app.post('/api/cookie-consent', async (req, res) => {
    try {
        console.log('📝 Logging cookie consent for compliance');
        
        const consentData = {
            ...req.body,
            ip: req.ip,
            userAgent: req.headers['user-agent'],
            timestamp: new Date(),
            source: 'zonetrain_banner',
            app: 'zonetrain'
        };
        
        // Log to Firebase for compliance audit trail
        await db.collection('cookie_consents').add(consentData);
        
        console.log('✅ Cookie consent logged:', consentData.categories);
        res.json({ 
            success: true,
            message: 'Consent preferences saved',
            timestamp: consentData.timestamp
        });
    } catch (error) {
        console.error('❌ Error logging cookie consent:', error);
        res.status(500).json({ 
            success: false,
            error: 'Failed to save consent preferences' 
        });
    }
});

// Get User's Cookie Consent Status
app.get('/api/cookie-consent/status', async (req, res) => {
    try {
        const userId = req.query.userId || req.user?.userId;
        
        if (userId) {
            // Get latest consent for authenticated user
            const consentQuery = await db.collection('cookie_consents')
                .where('userId', '==', userId)
                .orderBy('timestamp', 'desc')
                .limit(1)
                .get();
            
            if (!consentQuery.empty) {
                const latestConsent = consentQuery.docs[0].data();
                return res.json({
                    hasConsent: true,
                    consent: latestConsent,
                    source: 'database'
                });
            }
        }
        
        // Return default response for guests or users without consent
        res.json({ 
            hasConsent: false,
            message: 'No consent record found',
            defaultCategories: {
                essential: true,
                analytics: false,
                marketing: false,
                functional: false
            }
        });
    } catch (error) {
        console.error('❌ Error getting consent status:', error);
        res.status(500).json({ 
            error: 'Failed to get consent status' 
        });
    }
});

// Analytics Event Tracking (Only if consent given)
app.post('/api/analytics/track', async (req, res) => {
    try {
        const { event, data, timestamp, source } = req.body;
        
        console.log('📊 Analytics event:', event, 'from', source);
        
        // Store analytics event in database
        const analyticsEvent = {
            event,
            data,
            timestamp: timestamp || new Date(),
            source: source || 'unknown',
            ip: req.ip,
            userAgent: req.headers['user-agent'],
            app: 'zonetrain'
        };
        
        await db.collection('analytics_events').add(analyticsEvent);
        
        res.json({ success: true });
    } catch (error) {
        console.error('❌ Analytics tracking error:', error);
        res.json({ success: false }); // Don't break user experience
    }
});

// Privacy Policy Route (If you don't have one)
app.get('/privacy-policy', (req, res) => {
    res.send(`
    <!DOCTYPE html>
    <html>
    <head>
    <link rel="stylesheet" href="css/cookies.css">
        <title>Privacy Policy - ZoneTrain</title>
        <link rel="stylesheet" href="css/main.css">
    </head>
    <body style="padding: 40px; background: linear-gradient(135deg, #6B46C1, #8B5CF6); color: white;">
        <div style="max-width: 800px; margin: 0 auto;">
            <h1>ZoneTrain Privacy Policy</h1>
            <p><strong>Last updated:</strong> ${new Date().toLocaleDateString()}</p>
            
            <h2>Information We Collect</h2>
            <p>We collect information you provide directly, such as when you create an account, connect your Strava account, or use our training analysis features.</p>
            
            <h2>How We Use Your Information</h2>
            <p>We use your information to provide personalized training analysis, improve our services, and communicate with you about your training progress.</p>
            
            <h2>Cookies and Tracking</h2>
            <p>We use cookies to enhance your experience, analyze site usage, and provide personalized content. You can control cookie preferences through our cookie banner.</p>
            
            <h2>Data Sharing</h2>
            <p>We do not sell your personal data. We may share data with service providers who help us operate our platform.</p>
            
            <h2>Contact Us</h2>
            <p>If you have questions about this privacy policy, contact us at privacy@zonetrain.com</p>
            
            <p><a href="/" style="color: #A78BFA;">← Back to ZoneTrain</a></p>
        </div>
        ${getCookieBannerHTML()}
    ${getCookieModalHTML()}
    <script src="/components/nav-header.js"></script>
    </body>
    </html>
    `);
});

// Cookie Policy Route
app.get('/cookie-policy', (req, res) => {
    res.send(`
    <!DOCTYPE html>
    <html>
    <head>
    <link rel="stylesheet" href="css/cookies.css">
        <title>Cookie Policy - ZoneTrain</title>
        <link rel="stylesheet" href="css/main.css">
    </head>
    <body style="padding: 40px; background: linear-gradient(135deg, #6B46C1, #8B5CF6); color: white;">
        <div style="max-width: 800px; margin: 0 auto;">
            <h1>ZoneTrain Cookie Policy</h1>
            
            <h2>What Are Cookies</h2>
            <p>Cookies are small text files stored on your device to help us provide a better experience.</p>
            
            <h2>Essential Cookies</h2>
            <p>Required for the website to function properly. These cannot be disabled.</p>
            
            <h2>Analytics Cookies</h2>
            <p>Help us understand how you use ZoneTrain to improve our training analysis features.</p>
            
            <h2>Marketing Cookies</h2>
            <p>Used to show you relevant content and track the effectiveness of our campaigns.</p>
            
            <h2>Functional Cookies</h2>
            <p>Enable enhanced features like remembering your preferences and training history.</p>
            
            <p><a href="/" style="color: #A78BFA;">← Back to ZoneTrain</a></p>
        </div>
        ${getCookieBannerHTML()}
    ${getCookieModalHTML()}
    <script src="/components/nav-header.js"></script>
    </body>
    </html>
    `);
});

console.log('🍪 ZoneTrain Cookie System Routes Added');

// Add a test route to make sure server is working
app.get('/test-ai', (req, res) => {
    res.json({
        success: true,
        message: "AI onboarding route is working!",
        timestamp: new Date()
    });
});

console.log('🤖 AI Onboarding routes added');

app.get('/ai-onboarding', (req, res) => {
    res.sendFile(path.join(__dirname, 'public/ai-onboarding.html'));
});

// Weather preview API
app.post('/api/weather-preview', async (req, res) => {
    try {
        const { location } = req.body;
        
        // Here you would call Google Maps API for weather
        // For now, return mock data
        const weatherData = {
            temperature: 28,
            humidity: 65,
            aqi: 'Moderate',
            bestTrainingTime: 'Early Morning (6-8 AM)'
        };
        
        res.json(weatherData);
    } catch (error) {
        console.error('Weather preview error:', error);
        res.status(500).json({ error: 'Weather data unavailable' });
    }
});

// Helper functions for AI onboarding
function calculateBMI(heightCm, weightKg) {
    const heightM = heightCm / 100;
    return (weightKg / (heightM * heightM)).toFixed(1);
}

function calculatePace(distance, time) {
    // Convert time HH:MM:SS to total minutes
    const timeParts = time.split(':');
    const totalMinutes = parseInt(timeParts[0]) * 60 + parseInt(timeParts[1]);
    
    // Distance in km
    const distanceKm = {
        '5k': 5,
        '10k': 10,
        'half_marathon': 21.1,
        'marathon': 42.2
    }[distance] || 10;
    
    const paceMinPerKm = totalMinutes / distanceKm;
    const minutes = Math.floor(paceMinPerKm);
    const seconds = Math.round((paceMinPerKm - minutes) * 60);
    
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function calculateDaysToRace(raceDate) {
    const race = new Date(raceDate);
    const today = new Date();
    const diffTime = race - today;
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays;
}

async function generateInitialTrainingPlan(aiProfile) {
    try {
        const daysToRace = aiProfile.raceHistory.targetRace.daysToRace;
        const weeklyMileage = aiProfile.raceHistory.currentWeeklyMileage;
        const trainingDays = aiProfile.trainingStructure.preferredDays;
        
        console.log(`📅 Generating plan: ${daysToRace} days to race, ${weeklyMileage}km/week, ${trainingDays.length} days/week`);
        
        // Simple template plan for now
        return {
            planType: 'beginner_marathon',
            totalWeeks: Math.min(16, Math.floor(daysToRace / 7)),
            weeklySchedule: trainingDays.map((day, idx) => ({
                day: day,
                type: idx === trainingDays.length - 1 ? 'long_run' : (idx % 2 === 0 ? 'easy' : 'tempo'),
                distance: idx === trainingDays.length - 1 ? weeklyMileage * 0.4 : weeklyMileage / trainingDays.length
            })),
            progressionStrategy: 'conservative',
            peakWeek: Math.floor(daysToRace / 7) - 3
        };
    } catch (error) {
        console.error('⚠️ Plan generation error:', error);
        return { planType: 'template', error: error.message };
    }
}

// Save AI onboarding data
app.post('/api/ai-onboarding', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        const onboardingData = req.body;
        
        console.log('🤖 Saving AI onboarding data for user:', userId);
        
        // Validate required fields
        const requiredFields = ['age', 'gender', 'height', 'weight', 'pb_distance', 'pb_time', 
                               'target_distance', 'target_date', 'weekly_mileage', 'running_days', 
                               'intensity_preference'];
        
        const missingFields = requiredFields.filter(field => !onboardingData[field]);
        
        if (missingFields.length > 0) {
            return res.status(400).json({
                success: false,
                message: `Missing required fields: ${missingFields.join(', ')}`
            });
        }
        
        // Create AI profile document
        const aiProfile = {
            userId: userId,
            
            // Personal Profile
            personalProfile: {
                age: parseInt(onboardingData.age),
                gender: onboardingData.gender,
                height: parseFloat(onboardingData.height),
                weight: parseFloat(onboardingData.weight),
                injuries: onboardingData.injuries || [],
                bmi: calculateBMI(parseFloat(onboardingData.height), parseFloat(onboardingData.weight))
            },
            
            // Race History & Goals
            raceHistory: {
                recentPB: {
                    distance: onboardingData.pb_distance,
                    time: onboardingData.pb_time,
                    date: onboardingData.pb_date || null,
                    location: onboardingData.pb_location || null,
                    pace: calculatePace(onboardingData.pb_distance, onboardingData.pb_time)
                },
                targetRace: {
                    distance: onboardingData.target_distance,
                    targetTime: onboardingData.target_time || null,
                    raceDate: onboardingData.target_date,
                    location: onboardingData.target_location || null,
                    daysToRace: calculateDaysToRace(onboardingData.target_date)
                },
                currentWeeklyMileage: parseFloat(onboardingData.weekly_mileage)
            },
            
            // Recovery Metrics
            recoveryBaseline: {
                restingHeartRate: onboardingData.resting_hr ? parseInt(onboardingData.resting_hr) : null,
                hrvBaseline: onboardingData.hrv_baseline ? parseFloat(onboardingData.hrv_baseline) : null,
                sleepQuality: parseInt(onboardingData.sleep_quality || 7),
                trackingDevices: onboardingData.devices || []
            },
            
            // Training Structure
            trainingStructure: {
                preferredDays: onboardingData.running_days || [],
                intensityPreference: onboardingData.intensity_preference,
                constraints: onboardingData.constraints || null,
                daysPerWeek: (onboardingData.running_days || []).length
            },

            location: {
    usualTemp: onboardingData.usual_temp || null,
    usualHumidity: onboardingData.usual_humidity || null,
    elevation: onboardingData.elevation ? parseInt(onboardingData.elevation) : null,
    raceClimate: onboardingData.race_climate || null
},
stravaConnected: onboardingData.strava_connected === 'true',

            createdAt: new Date(),
            updatedAt: new Date()
        };
          
          
        
        // Save to Firestore
        // Save AI profile
await db.collection('aiprofiles').doc(userId).set(aiProfile);
console.log('✅ AI profile saved');

// Try to update user record (non-critical)
try {
    await userManager.updateUser(userId, {
        aiOnboardingCompleted: true,
        aiProfileCreatedAt: new Date().toISOString()
    });
    console.log('✅ User record updated');
} catch (userUpdateError) {
    // User update failed but profile is saved, so continue
    console.warn('⚠️ User update failed (non-critical):', userUpdateError.message);
}


        
        // Generate initial training plan
        console.log('🎯 Generating initial AI training plan...');
        const initialPlan = await generateInitialTrainingPlan(aiProfile);
        
        // Save training plan
        await db.collection('trainingplans').add({
            userId: userId,
            planType: 'ai_generated',
            planData: initialPlan,
            createdAt: new Date(),
            isActive: true
        });
        
        console.log('✅ AI onboarding completed successfully for user:', userId);
        
        // Track onboarding completion
        await db.collection('analytics_events').add({
            event: 'ai_onboarding_completed',
            userId: userId,
            data: {
                targetDistance: onboardingData.target_distance,
                daysToRace: calculateDaysToRace(onboardingData.target_date),
                weeklyMileage: onboardingData.weekly_mileage,
                intensityPreference: onboardingData.intensity_preference
            },
            timestamp: new Date(),
            source: 'ai_onboarding_system'
        });
        
        res.json({
            success: true,
            message: 'AI coaching profile created successfully',
            userId: userId,
            nextStep: 'training_plan_generated'
        });
        
    } catch (error) {
        console.error('❌ AI onboarding error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to complete AI onboarding setup'
        });
    }
});

// Basic Coach AI Onboarding (for habit-building users)
app.post('/api/ai-onboarding-basic', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        const data = req.body;

        console.log('🎯 Creating Basic Coach profile for:', userId);

        // Create Basic Coach AI profile (no race goals, focus on habits & HRV)
        const basicProfile = {
            userId: userId,
            planType: 'basic',
            
            // Personal info
            personalInfo: {
                age: parseInt(data.age),
                gender: data.gender,
                height: parseInt(data.height),
                weight: parseFloat(data.weight),
                injuryHistory: data.injury_history || ''
            },

            // Location for weather-based coaching
            location: {
                latitude: parseFloat(data.latitude),
                longitude: parseFloat(data.longitude)
            },

            // Current activity level
            activityLevel: {
                experienceLevel: data.experience_level,
                currentFrequency: parseInt(data.weekly_frequency) || 0,
                targetFrequency: parseInt(data.target_frequency),
                preferredDays: data.preferred_days || []
            },

            // Goals (habit-focused, not race-focused)
            goals: {
                primaryGoal: data.primary_goal,
                focusArea: 'habit_building'  // vs race_training
            },

            // HRV & Recovery (critical for Basic Coach)
            recovery: {
                restingHR: parseInt(data.resting_hr) || null,
                baselineHRV: parseInt(data.baseline_hrv) || null,
                hasHRVDevice: data.has_hrv_device,
                devices: data.devices || [],
                sleepQuality: parseInt(data.sleep_quality) || 7
            },

            createdAt: new Date(),
            lastUpdated: new Date()
        };

        // Save to Firestore
        await db.collection('aiprofiles').doc(userId).set(basicProfile);
        console.log('✅ Basic Coach profile saved');

        // Generate habit-building training plan (adaptive, not race-specific)
        const habitPlan = {
            userId: userId,
            planType: 'habit_building',
            duration: '12_weeks',  // Focus on building 12-week habit
            
            // Weekly structure based on target frequency
            weeklyStructure: {
                daysPerWeek: parseInt(data.target_frequency),
                workoutTypes: ['easy_run', 'progression_run', 'fun_run'],  // No race-pace workouts
                averageDuration: 30,  // Start with 30 min runs
                buildupRate: 'conservative'  // Slow, steady progression
            },

            // HRV-adaptive logic
            adaptiveLogic: {
                hrvThreshold: 'auto',  // Calculate from baseline
                autoRest: true,  // Rest when HRV is low
                progressionBased: 'recovery'  // Progress based on recovery, not calendar
            },

            createdAt: new Date(),
            isActive: true
        };

        await db.collection('trainingplans').add(habitPlan);
        console.log('✅ Habit-building plan created');

        res.json({
            success: true,
            message: 'Basic Coach profile created successfully',
            profile: basicProfile
        });

    } catch (error) {
        console.error('❌ Basic Coach onboarding error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to create Basic Coach profile'
        });
    }
});


// Helper functions
// Helper functions for AI onboarding
function calculateBMI(height, weight) {
    // Height in cm, weight in kg
    const heightInMeters = height / 100;
    return (weight / (heightInMeters * heightInMeters)).toFixed(1);
}

function calculatePace(distance, time) {
    // Distance like "5k", "10k", "half_marathon", "marathon"
    // Time like "00:25:30"
    const distances = {
        '5k': 5,
        '10k': 10,
        'half_marathon': 21.1,
        'marathon': 42.2
    };
    
    const km = distances[distance] || 0;
    if (km === 0) return null;
    
    const [hours, minutes, seconds] = time.split(':').map(Number);
    const totalMinutes = hours * 60 + minutes + seconds / 60;
    const paceMinutes = totalMinutes / km;
    
    const paceMin = Math.floor(paceMinutes);
    const paceSec = Math.round((paceMinutes - paceMin) * 60);
    
    return `${paceMin}:${paceSec.toString().padStart(2, '0')}/km`;
}

function calculateDaysToRace(raceDate) {
    const today = new Date();
    const race = new Date(raceDate);
    const diffTime = race - today;
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays > 0 ? diffDays : 0;
}

async function generateInitialTrainingPlan(profile) {
    // Simple template plan for now
    const daysToRace = profile.raceHistory.targetRace.daysToRace;
    const weeklyMileage = profile.raceHistory.currentWeeklyMileage;
    const trainingDays = profile.trainingStructure.daysPerWeek;
    
    return {
        type: 'template_based',
        weeks: Math.min(Math.floor(daysToRace / 7), 16),
        weeklyStructure: {
            baseWeeklyMileage: weeklyMileage,
            progressionRate: 0.10,
            workoutDays: trainingDays,
            intensityDistribution: profile.trainingStructure.intensityPreference
        },
        targetRace: {
            distance: profile.raceHistory.targetRace.distance,
            date: profile.raceHistory.targetRace.raceDate,
            targetTime: profile.raceHistory.targetRace.targetTime
        },
        generatedAt: new Date(),
        source: 'ai_template'
    };
}


// Generate initial training plan using AI
async function generateInitialTrainingPlan(profile) {
    try {
        console.log('🤖 Generating AI training plan...');
        
        const prompt = `Create a personalized training plan for:
        
        Profile:
        - Age: ${profile.personalProfile.age}, Gender: ${profile.personalProfile.gender}
        - Current weekly mileage: ${profile.raceHistory.currentWeeklyMileage}km
        - Target race: ${profile.raceHistory.targetRace.distance} in ${profile.raceHistory.targetRace.daysToRace} days
        - Preferred intensity: ${profile.trainingStructure.intensityPreference}
        - Training days: ${profile.trainingStructure.preferredDays.join(', ')}
        - Injuries: ${profile.personalProfile.injuries.join(', ') || 'None'}
        
        Generate a 4-week training block with:
        1. Weekly structure
        2. Daily workouts
        3. Progression plan
        4. Recovery recommendations
        
        Format as JSON.`;
        
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
        
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const planText = response.text();
        
        // Try to parse JSON, fallback to structured text
        let trainingPlan;
        try {
            trainingPlan = JSON.parse(planText);
        } catch (e) {
            trainingPlan = {
                type: 'text',
                content: planText,
                generatedAt: new Date()
            };
        }
        
        console.log('✅ AI training plan generated successfully');
        return trainingPlan;
        
    } catch (error) {
        console.error('❌ Training plan generation failed:', error);
        
        // Return basic fallback plan
        return {
            type: 'fallback',
            message: 'AI plan generation failed, using template',
            basicPlan: generateFallbackPlan(profile),
            generatedAt: new Date()
        };
    }
}

function generateFallbackPlan(profile) {
    // Basic template plan based on user preferences
    const daysPerWeek = profile.trainingStructure.daysPerWeek;
    const currentMileage = profile.raceHistory.currentWeeklyMileage;
    
    return {
        weeklyStructure: {
            totalDays: daysPerWeek,
            weeklyMileage: currentMileage,
            easyRuns: Math.max(1, daysPerWeek - 2),
            hardWorkouts: Math.min(2, daysPerWeek - 1),
            longRun: daysPerWeek >= 4 ? 1 : 0
        },
        progression: '10% weekly increase',
        recoveryDays: 7 - daysPerWeek
    };
}

console.log('🤖 AI Onboarding System Routes Added');

// AI SERVICE INTEGRATION

// ============================================
// AI ENDPOINTS WITH COST OPTIMIZATION
// ============================================

// Get daily workout plan
app.post('/api/ai/daily-workout', authenticateToken, async (req, res) => {
    try {
        const { userId } = req.user;
        const { weatherData, preferences } = req.body;
        
        // Get user data (you'll need to implement getUserData)
        const userData = await getUserData(userId);
        
        const workout = await aiService.generateDailyWorkout(userId, userData, weatherData);
        
        res.json({
            success: true,
            workout,
            cached: workout.generated === 'template',
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('❌ Daily workout generation error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to generate workout',
            fallback: aiService.getFallbackResponse('daily_plan')
        });
    }
});

// Submit workout feedback
app.post('/api/ai/workout-feedback', authenticateToken, async (req, res) => {
    try {
        const { userId } = req.user;
        const { workoutId, feedback } = req.body;
        
        const userData = await getUserData(userId);
        const workoutData = await getWorkoutData(workoutId);
        
        const analysis = await aiService.analyzeWorkoutFeedback(
            userId, userData, workoutData, feedback
        );
        
        res.json({
            success: true,
            analysis,
            recommendations: analysis.recommendations || []
        });
        
    } catch (error) {
        console.error('❌ Workout feedback error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to process feedback'
        });
    }
});

// Get weekly analysis
app.get('/api/ai/weekly-analysis/:week', authenticateToken, async (req, res) => {
    try {
        const { userId } = req.user;
        const { week } = req.params;
        
        const userData = await getUserData(userId);
        const weekWorkouts = await getWeekWorkouts(userId, week);
        
        const analysis = await aiService.generateWeeklyAnalysis(
            userId, userData, weekWorkouts
        );
        
        res.json({
            success: true,
            analysis,
            week: week,
            cost_optimized: analysis.generated === 'template'
        });
        
    } catch (error) {
        console.error('❌ Weekly analysis error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to generate weekly analysis'
        });
    }
});

// Adjust training plan
app.post('/api/ai/adjust-plan', authenticateToken, async (req, res) => {
    try {
        const { userId } = req.user;
        const { reason, adjustmentType } = req.body;
        
        const userData = await getUserData(userId);
        
        const adjustment = await aiService.adjustTrainingPlan(
            userId, userData, { reason, type: adjustmentType }
        );
        
        res.json({
            success: true,
            adjustment,
            applied: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('❌ Plan adjustment error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to adjust plan'
        });
    }
});

// AI cost monitoring endpoint
app.get('/api/ai/cost-status', authenticateToken, requireFeatureAccess('admin'), (req, res) => {
    const costStatus = {
        today: {
            requests: aiService.costTracker.requestsToday,
            estimated_tokens: aiService.costTracker.tokensUsed,
            cache_hit_rate: aiService.processor.cache.size
        },
        optimizations: {
            templates_used: 'Available',
            caching: 'Enabled',
            batch_processing: 'Enabled'
        },
        savings: {
            estimated_cost_reduction: '50-70%',
            template_usage: 'High',
            cache_effectiveness: 'Good'
        }
    };
    
    res.json({
        success: true,
        cost_status: costStatus
    });
});


// Helper functions (implement based on your database structure)
async function getUserData(userId) {
    // Implement based on your user data storage
    // Return compressed user data for AI processing
    return {
        // This would come from your database
        age: 30,
        gender: 'male',
        // ... other user data from onboarding
    };
}

async function getWorkoutData(workoutId) {
    // Implement workout data retrieval
    return {};
}

async function getWeekWorkouts(userId, week) {
    // Implement week workouts retrieval
    return [];
}


// ============================================
// AI ENDPOINTS WITH COST OPTIMIZATION
// ============================================

// Get daily workout plan
app.post('/api/ai/daily-workout', async (req, res) => {
    try {
        const { weatherData, preferences } = req.body;
        
        // Mock user data for testing (replace with real user data later)
        const userData = {
            age: 30,
            gender: 'male',
            height: 175,
            weight: 70,
            pb_time: '00:24:30',
            pb_distance: '5k',
            weekly_mileage: 30,
            resting_hr: 60,
            injury_history: 'None'
        };
        
        console.log('🤖 Generating daily workout...');
        const workout = await aiService.generateDailyWorkout('test-user', userData, weatherData);
        
        res.json({
            success: true,
            workout,
            cached: workout.generated === 'template',
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('❌ Daily workout generation error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to generate workout',
            fallback: {
                type: 'easy',
                duration: '45min',
                pace: 'conversational',
                notes: 'Take it easy today',
                fallback: true
            }
        });
    }
});

// Submit workout feedback
app.post('/api/ai/workout-feedback', async (req, res) => {
    try {
        const { workoutId, feedback } = req.body;
        
        console.log('🤖 Processing workout feedback...');
        const analysis = {
            message: 'Great job on your workout!',
            recommendations: ['Keep up the good work', 'Focus on recovery tomorrow'],
            next_focus: 'Maintain consistency'
        };
        
        res.json({
            success: true,
            analysis,
            recommendations: analysis.recommendations
        });
        
    } catch (error) {
        console.error('❌ Workout feedback error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to process feedback'
        });
    }
});

// Test endpoint to check if AI system is working
app.get('/api/ai/test', (req, res) => {
    res.json({
        success: true,
        message: 'AI system is online',
        timestamp: new Date().toISOString(),
        services: {
            aiService: 'loaded',
            dataProcessor: 'loaded'
        }
    });
});

// ============================================
// PREMIUM DASHBOARD ROUTING
// ============================================

// Premium Dashboard Route
app.get('/premium-dashboard', async (req, res) => {
    try {
        // Check if user is premium (implement your auth logic)
        const userToken = req.headers.authorization || req.query.token;
        
        // Replace with your actual user verification
        const userStatus = await verifyUserStatus(userToken);
        
        if (userStatus === 'premium') {
            res.sendFile(path.join(__dirname, 'public', 'premium-dashboard.html'));
        } else {
            res.redirect('/dashboard'); // Redirect to free dashboard
        }
    } catch (error) {
        console.error('Premium dashboard error:', error);
        res.redirect('/dashboard');
    }
});

// Free Dashboard Route (existing)
app.get('/dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// User status verification function
async function verifyUserStatus(token) {
    // Implement your user verification logic here
    // This is a placeholder - replace with actual database check
    
    try {
        // Example: Check user subscription status
        // const user = await User.findByToken(token);
        // return user.subscriptionStatus; // 'premium' or 'free'
        
        // For demo purposes, return 'premium'
        return 'premium';
    } catch (error) {
        return 'free';
    }
}

// RESET TEST USERS - Add this route temporarily
app.get('/debug/reset-test-users', async (req, res) => {
    try {
        // Delete existing test users
        const freeUserSnapshot = await db.collection('users').where('email', '==', 'free@test.com').get();
        const premiumUserSnapshot = await db.collection('users').where('email', '==', 'premium@test.com').get();
        
        for (const doc of freeUserSnapshot.docs) {
            await doc.ref.delete();
            console.log('🗑️ Deleted free test user');
        }
        
        for (const doc of premiumUserSnapshot.docs) {
            await doc.ref.delete();
            console.log('🗑️ Deleted premium test user');
        }
        
        // Create fresh test users
        console.log('🔧 Creating fresh test users...');
        
        // Free user
        const freeUser = await userManager.createUser({
            email: 'free@test.com',
            password: 'password123',
            firstName: 'Free',
            lastName: 'User',
            phoneNumber: null
        });
        console.log('✅ Free test user created:', freeUser.id);
        
        // Premium user
        const premiumUser = await userManager.createUser({
            email: 'premium@test.com',
            password: 'password123',
            firstName: 'Premium',
            lastName: 'User',
            phoneNumber: null
        });
        
        await userManager.updateUser(premiumUser.id, {
            subscriptionStatus: 'active',
            currentPlan: 'fitness',
            currentPrice: 199,
            originalPrice: 199,
            planStartDate: new Date()
        });
        console.log('✅ Premium test user created and upgraded:', premiumUser.id);
        
        res.json({
            success: true,
            message: 'Test users reset successfully',
            users: {
                free: freeUser.id,
                premium: premiumUser.id
            }
        });
        
    } catch (error) {
        console.error('❌ Reset error:', error);
        res.json({
            success: false,
            error: error.message
        });
    }
});




app.listen(port, () => {
  console.log(`ZoneTrain analyzer running at http://localhost:${port}`);
});


// Add this to your existing app.js
// Add this route to your app.js (after your existing routes)
app.get('/plans', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'plans.html'));
});


// Update your homepage to include the plans link
app.get('/', (req, res) => {
  res.send(`
    <h1>ZoneTrain Strava Analyzer</h1>
    <a href="/login">Connect with Strava</a><br>
    <a href="/activities">View Activities</a><br>
    <a href="/analyze-zones">Analyze Training Zones</a><br>
    <a href="/plans">View Training Plans</a>
  `);
});

// Test route to check if everything is working
app.get('/api/test/status', (req, res) => {
  res.json({
    success: true,
    message: 'ZoneTrain API is running!',
    timestamp: new Date(),
    firebase: 'Connected',
    version: '1.0.0'
  });
});


// Add to your app.js - Database Models
const USER_SCHEMAS = {
  // Main user profile
  users: {
    // Basic Info
    email: 'string', // Primary identifier
    firstName: 'string',
    lastName: 'string', 
    phoneNumber: 'string', // For WhatsApp integration
    avatar: 'string', // Profile picture URL
    
    // Authentication
    password: 'string', // Hashed with bcrypt
    emailVerified: 'boolean',
    lastLogin: 'timestamp',
    loginCount: 'number',
    
    // Subscription Management
    subscriptionStatus: 'string', // 'free', 'trial', 'active', 'cancelled', 'expired'
    currentPlan: 'string', // 'fitness', 'race'
    planStartDate: 'timestamp',
    planEndDate: 'timestamp',
    trialStartDate: 'timestamp',
    trialEndDate: 'timestamp',
    
    // Payment Info
    currentPrice: 'number', // What they're paying (with promos)
    originalPrice: 'number', // Base price
    stripeCustomerId: 'string', // For payment processing
    lastPaymentDate: 'timestamp',
    nextBillingDate: 'timestamp',
    
    // Integrations
    stravaUserId: 'string',
    stravaAccessToken: 'string', // Encrypted
    stravaRefreshToken: 'string', // Encrypted
    
    // Usage Tracking
    lastActivityAnalysis: 'timestamp',
    totalAnalyses: 'number',
    whatsappOptIn: 'boolean',
    
    // Promo & Marketing
    promoCodesUsed: 'array',
    referralCode: 'string', // Their unique code
    referredBy: 'string', // Who referred them
    
    // Metadata
    createdAt: 'timestamp',
    updatedAt: 'timestamp',
    active: 'boolean'
  },
  
  // Subscription history
  subscriptions: {
    userId: 'string',
    planType: 'string',
    status: 'string',
    startDate: 'timestamp',
    endDate: 'timestamp',
    amount: 'number',
    currency: 'string',
    promoCode: 'string',
    paymentMethod: 'string'
  },
  
  // Usage analytics
  userActivity: {
    userId: 'string',
    action: 'string', // 'login', 'analysis', 'plan_view', etc.
    timestamp: 'timestamp',
    metadata: 'object' // Additional context
  },
  
  // HRV readings for coaching
  hrvReadings: {
    userId: 'string',
    value: 'number',
    date: 'date',
    timestamp: 'timestamp',
    source: 'string' // 'manual', 'garmin', etc.
  }
};
const UserManager = require('./utils/userManager');

const userManager = new UserManager(db);

// DEBUG ROUTE - Check user's AI training plan
app.get('/debug/my-plan', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        console.log('🔍 Checking training plan for user:', userId);
        
        // Get the latest training plan
        const planSnapshot = await db.collection('trainingplans')
            .where('userId', '==', userId)
            .orderBy('createdAt', 'desc')
            .limit(1)
            .get();
        
        if (planSnapshot.empty) {
            console.log('❌ No training plan found for user:', userId);
            return res.json({ 
                success: false,
                message: 'No training plan found. Complete AI onboarding first.',
                hasCompletedOnboarding: false
            });
        }
        
        const planData = planSnapshot.docs[0].data();
        console.log('✅ Training plan found:', planSnapshot.docs[0].id);
        
        // Get AI profile
        const profileSnapshot = await db.collection('aiprofiles')
            .where('userId', '==', userId)
            .limit(1)
            .get();
        
        const profileData = profileSnapshot.empty ? null : profileSnapshot.docs[0].data();
        
        res.json({
            success: true,
            trainingPlan: {
                id: planSnapshot.docs[0].id,
                ...planData
            },
            aiProfile: profileData,
            message: 'Training plan retrieved successfully'
        });
        
    } catch (error) {
        console.error('❌ Error fetching plan:', error);
        res.status(500).json({ 
            success: false,
            error: error.message 
        });
    }
});

// DEBUG ROUTE - Check AI profile
app.get('/debug/my-profile', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        console.log('🔍 Checking AI profile for user:', userId);
        
        const profileSnapshot = await db.collection('aiprofiles')
            .where('userId', '==', userId)
            .limit(1)
            .get();
        
        if (profileSnapshot.empty) {
            return res.json({ 
                success: false,
                message: 'No AI profile found. Complete AI onboarding first.',
                redirect: '/ai-onboarding'
            });
        }
        
        const profileData = profileSnapshot.docs[0].data();
        console.log('✅ AI profile found:', profileSnapshot.docs[0].id);
        
        res.json({
            success: true,
            profile: {
                id: profileSnapshot.docs[0].id,
                ...profileData
            },
            message: 'AI profile retrieved successfully'
        });
        
    } catch (error) {
        console.error('❌ Error fetching profile:', error);
        res.status(500).json({ 
            success: false,
            error: error.message 
        });
    }
});

// DEBUG ROUTE - Check if onboarding is complete
app.get('/debug/onboarding-status', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        
        const user = await userManager.getUserById(userId);
        const hasProfile = user.aiOnboardingCompleted || false;
        
        const profileSnapshot = await db.collection('aiprofiles')
            .where('userId', '==', userId)
            .limit(1)
            .get();
        
        const planSnapshot = await db.collection('trainingplans')
            .where('userId', '==', userId)
            .limit(1)
            .get();
        
        res.json({
            success: true,
            status: {
                aiOnboardingCompleted: hasProfile,
                hasAIProfile: !profileSnapshot.empty,
                hasTrainingPlan: !planSnapshot.empty,
                profileId: profileSnapshot.empty ? null : profileSnapshot.docs[0].id,
                planId: planSnapshot.empty ? null : planSnapshot.docs[0].id
            }
        });
        
    } catch (error) {
        console.error('❌ Error checking status:', error);
        res.status(500).json({ 
            success: false,
            error: error.message 
        });
    }
});


async function initializeTestUsers() {
    try {
        console.log('🔧 Creating test users...');
        
        // Free test user
        try {
            const freeUser = {
                email: 'free@test.com',
                password: 'password123',
                firstName: 'Free',
                lastName: 'User',
                phoneNumber: null
            };
            await userManager.createUser(freeUser);
            console.log('✅ Free test user created');
        } catch (error) {
            if (error.message === 'User already exists') {
                console.log('✅ Free test user already exists');
            }
        }
        
        // Premium test user
        try {
            const premiumUser = await userManager.createUser({
                email: 'premium@test.com',
                password: 'password123',
                firstName: 'Premium',
                lastName: 'User',
                phoneNumber: null
            });
            
            // Upgrade to premium
            await userManager.updateUser(premiumUser.id, {
                subscriptionStatus: 'active',
                currentPlan: 'fitness',
                currentPrice: 199,
                originalPrice: 199,
                planStartDate: new Date()
            });
            console.log('✅ Premium test user created and upgraded');
        } catch (error) {
            if (error.message === 'User already exists') {
                // Find existing user and upgrade
                const existingUser = await userManager.getUserByEmail('premium@test.com');
                if (existingUser) {
                    await userManager.updateUser(existingUser.id, {
                        subscriptionStatus: 'active',
                        currentPlan: 'fitness',
                        currentPrice: 199,
                        originalPrice: 199,
                        planStartDate: new Date()
                    });
                    console.log('✅ Premium test user upgraded');
                }
            }
        }
        
    } catch (error) {
        console.error('❌ Error creating test users:', error);
    }
}

// Initialize test users
initializeTestUsers();

initializeAccessControl(db, userManager);

// ==================== AUTHENTICATION ROUTES ====================

app.post('/api/auth/register', async (req, res) => {
  try {
    const user = await userManager.createUser(req.body);
    if (signupSuccessful) {
            const response = {
                success: true,
                token: token,
                user: {
                    id: newUser.id,
                    email: newUser.email
                },
                message: 'Account created successfully'
            };
            
            // Check for redirect parameter
            const redirect = req.body.redirect || req.query.redirect;
            if (redirect === 'ai-onboarding') {
                response.redirect = '/ai-onboarding';
            } else {
                response.redirect = '/dashboard';
            }
            
            res.json(response);
        }
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
});

app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        console.log('🔄 Login attempt for:', email);
        
        const result = await userManager.authenticateUser(email, password);
        
        if (result && result.user && result.token) {
            console.log('✅ Login successful for:', email);
            console.log('User subscription status:', result.user.subscriptionStatus);
            
            const response = {
                success: true,
                token: result.token,
                user: {
                    id: result.user.id,
                    email: result.user.email,
                    firstName: result.user.firstName,
                    subscriptionStatus: result.user.subscriptionStatus || 'free',
                    currentPlan: result.user.currentPlan
                },
                userType: result.user.subscriptionStatus === 'active' ? 'premium' : 'free',
                message: 'Login successful',
                redirect: '/dashboard'
            };
            
            return res.json(response);
        } else {
            console.log('❌ Login failed for:', email);
            return res.status(401).json({ 
                success: false, 
                message: 'Invalid credentials' 
            });
        }
    } catch (error) {
        console.error('❌ Login error:', error);
        return res.status(401).json({ 
            success: false, 
            message: error.message || 'Login failed' 
        });
    }
});


// HRV coaching endpoint (Premium feature)
app.post('/api/coaching/hrv', 
    authenticateToken, 
    requireFeatureAccess('hrv-coaching'), 
    async (req, res) => {
        try {
            const { hrvData, additionalData } = req.body;
            
            // Your HRV coaching logic here
            const coaching = {
                recommendation: "Sample coaching based on HRV",
                intensity: "moderate",
                duration: "45 minutes"
            };
            
            await trackFeatureUsage(req.user.userId, 'hrv-coaching', {
                hrvValue: hrvData.value,
                coachingType: coaching.intensity
            });

            res.json({
                success: true,
                coaching: coaching
            });
        } catch (error) {
            console.error('HRV coaching error:', error);
            res.status(500).json({
                success: false,
                message: 'Coaching generation failed'
            });
        }
    }
);

// User access status endpoint - FIXED
app.get('/api/user/access-status', authenticateToken, async (req, res) => {
    try {
        const userId = req.user?.userId;
        
        if (!userId) {
            console.error('❌ No userId in request');
            return res.status(401).json({ 
                success: false, 
                message: 'User not authenticated' 
            });
        }
        
        const user = await userManager.getUserById(userId);
        
        if (!user) {
            console.error('❌ User not found:', userId);
            return res.status(404).json({ 
                success: false, 
                message: 'User not found' 
            });
        }
        
        const featureStatus = {};
        for (const feature of Object.keys(FEATURE_ACCESS)) {
            featureStatus[feature] = await checkFeatureAccess(user, feature);
        }
        
        // Check if user completed AI onboarding
        let aiOnboardingCompleted = false;
        try {
            const profileDoc = await db.collection('aiprofiles').doc(userId).get();
            aiOnboardingCompleted = profileDoc.exists;
        } catch (error) {
            console.warn('⚠️ Unable to check AI onboarding status:', error.message);
        }
        
        res.json({
            success: true,
            user: {
                id: user.id,
                subscriptionStatus: user.subscriptionStatus || 'free',
                currentPlan: user.currentPlan || null,
                trialEndDate: user.trialEndDate || null,
                aiOnboardingCompleted: aiOnboardingCompleted
            },
            features: featureStatus
        });
    } catch (error) {
        console.error('❌ Access status error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to get access status' 
        });
    }
});

app.get('/api/training-plan', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        
        const planSnapshot = await db.collection('trainingplans')
            .where('userId', '==', userId)
            .where('isActive', '==', true)
            .limit(1)
            .get();
        
        if (planSnapshot.empty) {
            return res.status(404).json({
                success: false,
                message: 'No active training plan found'
            });
        }
        
        const plan = planSnapshot.docs[0].data();
        
        res.json({
            success: true,
            plan: plan,
            planId: planSnapshot.docs[0].id
        });
        
    } catch (error) {
        console.error('❌ Training plan error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to load training plan'
        });
    }
});

app.get('/api/ai-profile', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        
        const profileDoc = await db.collection('aiprofiles').doc(userId).get();
        
        if (!profileDoc.exists) {
            return res.status(404).json({
                success: false,
                message: 'AI profile not found. Complete onboarding first.'
            });
        }
        
        res.json({
            success: true,
            profile: profileDoc.data()
        });
        
    } catch (error) {
        console.error('❌ AI profile error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to load AI profile'
        });
    }
});




// ==================== USER PROFILE ROUTES ====================

app.get('/api/user/profile', authenticateToken, async (req, res) => {
  try {
    const analytics = await userManager.getUserAnalytics(req.user.userId);
    res.json({
      success: true,
      data: analytics
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

app.put('/api/user/profile', authenticateToken, async (req, res) => {
  try {
    await userManager.updateUser(req.user.userId, req.body);
    res.json({
      success: true,
      message: 'Profile updated successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// ==================== SUBSCRIPTION ROUTES ====================

app.post('/api/subscription/start-trial', authenticateToken, async (req, res) => {
  try {
    const { planType } = req.body;
    await userManager.startTrial(req.user.userId, planType);
    
    res.json({
      success: true,
      message: 'Trial started successfully'
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
});

app.post('/api/subscription/upgrade', authenticateToken, async (req, res) => {
  try {
    await userManager.upgradeToPaid(req.user.userId, req.body);
    
    res.json({
      success: true,
      message: 'Subscription upgraded successfully'
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
});

app.get('/api/subscription', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        console.log('🔍 Fetching subscription for user:', userId);

        // Get user from Firestore
        const userDoc = await db.collection('users').doc(userId).get();
        
        if (!userDoc.exists) {
            console.error('❌ User not found:', userId);
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        const user = userDoc.data();
        console.log('✅ User found:', user.email);

        const subscription = {
            plan: user.subscriptionStatus || 'free',
            status: user.subscriptionActive !== false ? 'active' : 'inactive',
            startDate: user.subscriptionStartDate || user.createdAt || new Date(),
            renewalDate: user.subscriptionRenewalDate || null,
            price: user.subscriptionStatus === 'basic' ? 299 : user.subscriptionStatus === 'race' ? 499 : 0
        };

        res.json({ success: true, subscription });
    } catch (error) {
        console.error('❌ Subscription error:', error);
        res.status(500).json({ success: false, message: 'Error fetching subscription: ' + error.message });
    }
});

// Get user profile for profile page
app.get('/api/profile', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        console.log('🔍 Fetching profile for user:', userId);

        // Get user from Firestore
        const userDoc = await db.collection('users').doc(userId).get();
        
        if (!userDoc.exists) {
            console.error('❌ User not found:', userId);
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        const user = userDoc.data();
        console.log('✅ User found:', user.email);
        
        // Get AI profile if exists
        let aiProfile = {};
        try {
            const aiProfileDoc = await db.collection('aiprofiles').doc(userId).get();
            if (aiProfileDoc.exists) {
                aiProfile = aiProfileDoc.data();
                console.log('✅ AI profile found');
            } else {
                console.log('ℹ️ No AI profile found');
            }
        } catch (e) {
            console.log('ℹ️ No AI profile:', e.message);
        }

        res.json({
            success: true,
            user: {
                email: user.email,
                name: user.name || user.displayName || '',
                subscriptionStatus: user.subscriptionStatus || 'free',
                aiProfile: aiProfile
            }
        });
    } catch (error) {
        console.error('❌ Profile error:', error);
        res.status(500).json({ success: false, message: 'Error fetching profile: ' + error.message });
    }
});

// Update user profile
app.put('/api/profile', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        const { name, personalInfo, recovery } = req.body;

        console.log('📝 Updating profile for user:', userId);

        // Update user basic info
        await db.collection('users').doc(userId).update({
            name: name,
            updatedAt: new Date()
        });

        // Update AI profile
        const aiProfileRef = db.collection('aiprofiles').doc(userId);
        await aiProfileRef.set({
            personalInfo: personalInfo,
            recovery: recovery,
            lastUpdated: new Date()
        }, { merge: true });

        console.log('✅ Profile updated successfully');
        res.json({ success: true, message: 'Profile updated successfully' });
    } catch (error) {
        console.error('❌ Profile update error:', error);
        res.status(500).json({ success: false, message: 'Error updating profile: ' + error.message });
    }
});

// Serve subscription page
app.get('/subscription', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'subscription.html'));
});

// Serve profile page
app.get('/profile', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'profile.html'));
});

// ==================== PROTECTED ROUTES EXAMPLES ====================

// Free feature - everyone can access
app.post('/api/analyze-zones', authenticateToken, requireFeatureAccess('strava_analysis'), async (req, res) => {try {
            const accessToken = storedTokens.accessToken;
            if (!accessToken) {
                return res.status(401).json({
                    success: false,
                    message: 'Strava not connected'
                });
            }
            await trackFeatureUsage(req.user.userId, 'strava-analysis', {
                activitiesAnalyzed: runningActivities.length
            });
            res.json({
                success: true,
                analysis: analysis,
                usage: req.featureAccess.currentUsage + 1,
                remaining: req.featureAccess.remaining - 1
            });
            } catch (error) {
            console.error('Zone analysis error:', error);
            res.status(500).json({
                success: false,
                message: 'Analysis failed'
            });
        }
    
  // Your existing zone analysis code
});

// Premium feature - only trial/paid users
app.post('/api/hrv-coaching', authenticateToken, requireFeatureAccess('hrv_coaching'), async (req, res) => {
  // HRV coaching functionality
});

// Paid-only feature
app.get('/api/advanced-analytics', authenticateToken, requireFeatureAccess('advanced_analytics'), async (req, res) => {
  // Advanced analytics for paid users only
});

// ==================== MIDDLEWARE ====================


// Get monthly revenue
app.get('/api/admin/revenue', async (req, res) => {
  const revenue = await userManager.getMonthlyRevenue();
  // Use for: Business reporting, investor updates
});

// Identify at-risk users
app.get('/api/admin/churn-risk', async (req, res) => {
  const atRiskUsers = await userManager.getChurnRiskUsers();
  // Use for: Send retention emails, special offers
});

// Track which features are popular
app.get('/api/admin/feature-usage', async (req, res) => {
  const usage = await userManager.getFeatureUsageStats();
  // Use for: Product decisions, feature prioritization
});

// Get complete user context for support
app.get('/api/admin/user/:userId', async (req, res) => {
  const userContext = await userManager.getCompleteUserContext(req.params.userId);
  // Use for: Support tickets, user troubleshooting
});

app.get('/debug/tokens', (req, res) => {
  res.json({
    access_token: storedTokens?.access_token ? 'Present' : 'Missing',
    refresh_token: storedTokens?.refresh_token ? 'Present' : 'Missing',
    storedTokens_exists: typeof storedTokens !== 'undefined'
  });
});

app.get('/debug/test-token', async (req, res) => {
  const access_token = storedTokens.access_token;
  
  try {
    const response = await axios.get('https://www.strava.com/api/v3/athlete', {
      headers: { Authorization: `Bearer ${access_token}` }
    });
    
    res.json({
      status: 'Token works!',
      athlete: response.data.firstname + ' ' + response.data.lastname,
      token_length: access_token.length
    });
  } catch (error) {
    res.json({
      status: 'Token failed',
      error: error.response?.status,
      message: error.response?.data || error.message
    });
  }
});

// Add this route (duplicate for compatibility)
app.post('/api/signup', async (req, res) => {
  try {
    const passwordValidation = validatePassword(req.body.password);
    if (!passwordValidation.valid) {
      return res.status(400).json({
        success: false,
        message: passwordValidation.message
      });
    }
    const user = await userManager.createUser(req.body);
    res.json({
      success: true,
      message: 'Account created successfully!',
      user: user
    });
  } catch (error) {
    console.error('Signup error:', error);
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
});

// Add these helper functions first
const nodemailer = require('nodemailer'); // You'll need: npm install nodemailer

// Email transporter (you can use Gmail or any SMTP)
// Replace this in your app.js:
const emailTransporter = nodemailer.createTransport({
  host: 'smtp.zoho.in',
  port: 465,
  secure: true,
  auth: {
    user: process.env.ZOHO_EMAIL, // zonetrain@zohomail.in
    pass: process.env.ZOHO_PASSWORD // Your actual Zoho password
  }
  
});


// Generate reset token
function generateResetToken() {
  return crypto.randomBytes(32).toString('hex');
}

// Store reset tokens temporarily (in production, use Redis or database)
const passwordResetTokens = new Map();

// Forgot password page route
app.get('/forgot-password', (req, res) => {
  const html = `
  <!DOCTYPE html>
  <html lang="en">
  <head>
  <link rel="stylesheet" href="css/cookies.css">
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Forgot Password - ZoneTrain</title>
    <style>
      :root {
        --deep-purple: #6B46C1;
        --light-purple: #A78BFA;
        --accent-purple: #8B5CF6;
        --white: #FFFFFF;
        --dark-gray: #1F2937;
        --success-green: #10B981;
        --error-red: #EF4444;
      }

      * { margin: 0; padding: 0; box-sizing: border-box; }

      body {
        font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
        background: linear-gradient(135deg, var(--deep-purple) 0%, var(--accent-purple) 100%);
        min-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 20px;
      }

      .forgot-password-container {
        background: var(--white);
        border-radius: 20px;
        box-shadow: 0 20px 40px rgba(0, 0, 0, 0.3);
        padding: 40px;
        width: 100%;
        max-width: 450px;
        position: relative;
        text-align: center;
      }

      .back-btn {
        position: absolute;
        top: 20px;
        left: 20px;
        color: var(--deep-purple);
        text-decoration: none;
        font-size: 1.5rem;
        transition: transform 0.3s ease;
      }

      .back-btn:hover { transform: translateX(-5px); }

      .logo {
        font-size: 2rem;
        font-weight: 700;
        color: var(--deep-purple);
        margin-bottom: 30px;
      }

      h2 {
        color: var(--dark-gray);
        margin-bottom: 20px;
        font-size: 1.8rem;
      }

      .description {
        color: #6B7280;
        margin-bottom: 30px;
        line-height: 1.5;
      }

      .form-group {
        margin-bottom: 20px;
        text-align: left;
      }

      label {
        display: block;
        margin-bottom: 5px;
        color: var(--dark-gray);
        font-weight: 500;
      }

      input[type="email"] {
        width: 100%;
        padding: 12px 15px;
        border: 2px solid #E5E7EB;
        border-radius: 10px;
        font-size: 1rem;
        transition: border-color 0.3s ease;
      }

      input[type="email"]:focus {
        outline: none;
        border-color: var(--accent-purple);
        box-shadow: 0 0 0 3px rgba(139, 92, 246, 0.1);
      }

      .btn {
        width: 100%;
        padding: 15px;
        border: none;
        border-radius: 10px;
        font-size: 1rem;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.3s ease;
        margin-bottom: 15px;
      }

      .btn-primary {
        background: var(--deep-purple);
        color: var(--white);
      }

      .btn-primary:hover {
        background: var(--accent-purple);
        transform: translateY(-2px);
        box-shadow: 0 6px 20px rgba(107, 70, 193, 0.3);
      }

      .login-link {
        margin-top: 25px;
        color: var(--dark-gray);
      }

      .login-link a {
        color: var(--accent-purple);
        text-decoration: none;
        font-weight: 600;
      }

      .message {
        padding: 10px 15px;
        border-radius: 8px;
        margin-bottom: 20px;
        font-size: 0.9rem;
        display: none;
      }

      .success { background: #D1FAE5; color: var(--success-green); }
      .error { background: #FEE2E2; color: var(--error-red); }
    </style>
  </head>
  <body>
    <div class="forgot-password-container">
      <a href="/login" class="back-btn">←</a>
      
      <div class="logo">ZoneTrain</div>
      <h2>Reset Your Password</h2>
      <p class="description">
        Enter your email address and we'll send you a link to reset your password.
      </p>

      <div id="message" class="message"></div>

      <form id="forgotPasswordForm">
        <div class="form-group">
          <label for="email">Email Address</label>
          <input type="email" id="email" name="email" required>
        </div>

        <button type="submit" class="btn btn-primary">Send Reset Link</button>
      </form>

      <div class="login-link">
        Remember your password? <a href="/login">Sign In</a>
      </div>
    </div>

    <script>
      document.getElementById('forgotPasswordForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const email = document.getElementById('email').value;
        const messageDiv = document.getElementById('message');

        try {
          showMessage('Sending reset link...', 'info');

          const response = await fetch('/api/auth/forgot-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email })
          });

          const result = await response.json();

          if (result.success) {
            showMessage('Password reset link sent to your email! Check your inbox.', 'success');
            document.getElementById('forgotPasswordForm').style.display = 'none';
          } else {
            showMessage(result.message, 'error');
          }
        } catch (error) {
          showMessage('Error sending reset link. Please try again.', 'error');
        }
      });

      function showMessage(message, type) {
        const messageDiv = document.getElementById('message');
        messageDiv.textContent = message;
        messageDiv.className = \`message \${type}\`;
        messageDiv.style.display = 'block';
      }
    </script>
    <style>
    body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        margin: 0;
        padding: 20px;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        min-height: 100vh;
        padding-top: 110px; /* ← Space for fixed header */
    }
    
    .login-container {
        max-width: 450px;
        margin: 30px auto 20px auto;
        background: white;
        padding: 40px;
        border-radius: 16px;
        box-shadow: 0 10px 40px rgba(0,0,0,0.2);
    }
</style>

    <script src="/components/nav-header.js"></script>
  </body>
  </html>
  `;
  res.send(html);
});

// Forgot password API route
app.post('/api/auth/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    
    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Email is required'
      });
    }

    // Check if user exists
    const user = await userManager.getUserByEmail(email);
    if (!user) {
      // Don't reveal if email exists or not (security)
      return res.json({
        success: true,
        message: 'If an account with this email exists, you will receive a password reset link.'
      });
    }

    // Generate reset token
    const resetToken = generateResetToken();
    const resetExpiry = new Date(Date.now() + 1 * 60 * 60 * 1000); // 1 hour from now

    // Store token temporarily
    passwordResetTokens.set(resetToken, {
      userId: user.id,
      email: user.email,
      expiry: resetExpiry
    });

    // Send reset email
    const resetUrl = `http://localhost:${port}/reset-password?token=${resetToken}`;
    

const mailOptions = {
  from: process.env.ZOHO_EMAIL,
  to: email,
  subject: '🔐 ZoneTrain - Password Reset Request',
  html: `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background: #f9fafb; border-radius: 10px;">
      <div style="background: linear-gradient(135deg, #6B46C1, #8B5CF6); color: white; padding: 20px; border-radius: 10px; text-align: center; margin-bottom: 20px;">
        <h1>🏃‍♂️ ZoneTrain</h1>
        <h2>Password Reset Request</h2>
      </div>
      
      <div style="background: white; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
        <p>Hello <strong>${user.firstName}</strong>,</p>
        
        <p>You requested a password reset for your ZoneTrain account. Click the button below to reset your password:</p>
        
        <div style="text-align: center; margin: 30px 0;">
          <a href="${resetUrl}" style="background: #6B46C1; color: white; padding: 15px 30px; text-decoration: none; border-radius: 25px; font-weight: 600; display: inline-block;">
            🔐 Reset My Password
          </a>
        </div>
        
        <p><strong>This link will expire in 1 hour.</strong></p>
        
        <p>If you didn't request this password reset, please ignore this email or contact support if you have concerns.</p>
        
        <hr style="margin: 20px 0; border: none; border-top: 1px solid #e5e7eb;">
        
        <p style="font-size: 0.9rem; color: #6b7280;">
          If the button doesn't work, copy and paste this link into your browser:<br>
          <a href="${resetUrl}">${resetUrl}</a>
        </p>
      </div>
    </div>
  `
};
    
    await emailTransporter.sendMail(mailOptions);
    console.log('✅ Password reset email sent to:', email);

    // Track activity
    await userManager.trackActivity(user.id, 'password_reset_requested');

    res.json({
      success: true,
      message: 'Password reset link sent to your email!'
    });

  } catch (error) {
    console.error('❌ Email sending failed:', error);
    console.error('Forgot password error:', error);
    res.status(500).json({
      success: false,
      message: 'Error sending reset email',
      debug: error.message // Add this to see the actual error
      });
  }
});

// Reset password page route
// Reset password page route
app.get('/reset-password', (req, res) => {
  const token = req.query.token;
  
  if (!token) {
    return res.send(`
      <div style="text-align: center; padding: 50px; background: #6B46C1; color: white; min-height: 100vh;">
        <h1>❌ Invalid Reset Link</h1>
        <p>This password reset link is invalid or has expired.</p>
        <a href="/forgot-password" style="color: #FFD700;">Request New Reset Link</a>
      </div>
    `);
  }

  const resetData = passwordResetTokens.get(token);
  
  if (!resetData || new Date() > resetData.expiry) {
    return res.send(`
      <div style="text-align: center; padding: 50px; background: #6B46C1; color: white; min-height: 100vh;">
        <h1>⏰ Reset Link Expired</h1>
        <p>This password reset link has expired.</p>
        <a href="/forgot-password" style="color: #FFD700;">Request New Reset Link</a>
      </div>
    `);
  }

  // Reset password form (fix template literals here too)
  const html = `
  <!DOCTYPE html>
  <html lang="en">
  <head>
  <link rel="stylesheet" href="css/cookies.css">
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Reset Password - ZoneTrain</title>
    <style>
      /* Same styles as login page */
      :root {
        --deep-purple: #6B46C1;
        --accent-purple: #8B5CF6;
        --white: #FFFFFF;
        --dark-gray: #1F2937;
        --success-green: #10B981;
        --error-red: #EF4444;
      }
      
      * { margin: 0; padding: 0; box-sizing: border-box; }
      
      body {
        font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
        background: linear-gradient(135deg, var(--deep-purple) 0%, var(--accent-purple) 100%);
        min-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 20px;
      }
      
      .reset-container {
        background: var(--white);
        border-radius: 20px;
        box-shadow: 0 20px 40px rgba(0, 0, 0, 0.3);
        padding: 40px;
        width: 100%;
        max-width: 450px;
        text-align: center;
      }
      
      .logo { font-size: 2rem; font-weight: 700; color: var(--deep-purple); margin-bottom: 30px; }
      h2 { color: var(--dark-gray); margin-bottom: 20px; font-size: 1.8rem; }
      .form-group { margin-bottom: 20px; text-align: left; }
      label { display: block; margin-bottom: 5px; color: var(--dark-gray); font-weight: 500; }
      
      input[type="password"] {
        width: 100%;
        padding: 12px 15px;
        border: 2px solid #E5E7EB;
        border-radius: 10px;
        font-size: 1rem;
        transition: border-color 0.3s ease;
      }
      
      input[type="password"]:focus {
        outline: none;
        border-color: var(--accent-purple);
        box-shadow: 0 0 0 3px rgba(139, 92, 246, 0.1);
      }
      
      .btn {
        width: 100%;
        padding: 15px;
        border: none;
        border-radius: 10px;
        font-size: 1rem;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.3s ease;
        background: var(--deep-purple);
        color: var(--white);
      }
      
      .btn:hover {
        background: var(--accent-purple);
        transform: translateY(-2px);
      }
      
      .message {
        padding: 10px 15px;
        border-radius: 8px;
        margin-bottom: 20px;
        display: none;
      }
      
      .success { background: #D1FAE5; color: var(--success-green); }
      .error { background: #FEE2E2; color: var(--error-red); }
    </style>
  </head>
  <body>
    <div class="reset-container">
      <div class="logo">ZoneTrain</div>
      <h2>Set New Password</h2>
      
      <div id="message" class="message"></div>

      <form id="resetPasswordForm">
        <input type="hidden" name="token" value="${token}">
        
        <div class="form-group">
          <label for="password">New Password</label>
          <div style="position: relative;">
            <input type="password" id="password" name="password" required style="padding-right: 45px;">
            <button type="button" id="togglePassword" style="position: absolute; right: 12px; top: 50%; transform: translateY(-50%); background: none; border: none; cursor: pointer; font-size: 1.2rem;">👁️</button>
          </div>
          <div style="font-size: 0.8rem; color: #6B7280; margin-top: 5px;">
            At least 8 characters with uppercase, lowercase, and number
          </div>
        </div>

        <div class="form-group">
          <label for="confirmPassword">Confirm New Password</label>
          <div style="position: relative;">
            <input type="password" id="confirmPassword" name="confirmPassword" required style="padding-right: 45px;">
          </div>
        </div>

        <button type="submit" class="btn">Reset Password</button>
      </form>
    </div>

    <script>
      // Show/hide password functionality
      document.getElementById('togglePassword').addEventListener('click', function() {
        const passwordField = document.getElementById('password');
        const type = passwordField.getAttribute('type') === 'password' ? 'text' : 'password';
        passwordField.setAttribute('type', type);
        this.textContent = type === 'password' ? '👁️' : '🙈';
      });


      // Reset password form submission
      document.getElementById('resetPasswordForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const formData = new FormData(e.target);
        const password = formData.get('password');
        const confirmPassword = formData.get('confirmPassword');
        const token = formData.get('token');

        if (password !== confirmPassword) {
          showMessage('Passwords do not match', 'error');
          return;
        }

        if (!isValidPassword(password)) {
          showMessage('Password must be at least 8 characters with uppercase, lowercase, and number', 'error');
          return;
        }

        try {
          const response = await fetch('/api/auth/reset-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token, password })
          });

          const result = await response.json();

          if (result.success) {
            showMessage('Password reset successful! Redirecting to login...', 'success');
            setTimeout(() => {
              window.location.href = '/login?message=Password reset successful';
            }, 2000);
          } else {
            showMessage(result.message, 'error');
          }
        } catch (error) {
          showMessage('Error resetting password. Please try again.', 'error');
        }
      });

      function isValidPassword(password) {
        return password.length >= 8 && 
               /[A-Z]/.test(password) && 
               /[a-z]/.test(password) && 
               /[0-9]/.test(password);
      }

      function showMessage(message, type) {
        const messageDiv = document.getElementById('message');
        messageDiv.textContent = message;
        messageDiv.className = 'message ' + type;
        messageDiv.style.display = 'block';
      }
    </script>
    <script src="/components/nav-header.js"></script>
  </body>
  </html>
  `;
  
  res.send(html);
});

// Reset password API route
app.post('/api/auth/reset-password', async (req, res) => {
  try {
    const { token, password } = req.body;

    if (!token || !password) {
      return res.status(400).json({
        success: false,
        message: 'Token and password are required'
      });
    }

    // Validate password
    const passwordValidation = validatePassword(password);
    if (!passwordValidation.valid) {
      return res.status(400).json({
        success: false,
        message: passwordValidation.message
      });
    }

    // Check if token is valid
    const resetData = passwordResetTokens.get(token);
    if (!resetData || new Date() > resetData.expiry) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired reset token'
      });
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(password, 12);

    // Update user password
    await userManager.updateUser(resetData.userId, {
      password: hashedPassword
    });

    // Remove used token
    passwordResetTokens.delete(token);

    // Track activity
    await userManager.trackActivity(resetData.userId, 'password_reset_completed');

    res.json({
      success: true,
      message: 'Password reset successfully!'
    });

  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({
      success: false,
      message: 'Error resetting password'
    });
  }
});

// Add this route to your app.js (after your other routes)
app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// Also add route without .html extension for cleaner URLs
app.get('/dashboard.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// Privacy Policy page
app.get('/privacy', (req, res) => {
  const privacyHTML = `
  <!DOCTYPE html>
  <html lang="en">
  <head>
  <link rel="stylesheet" href="css/cookies.css">
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Privacy Policy - ZoneTrain</title>
    <style>
      body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 40px 20px; line-height: 1.6; }
      h1 { color: #6B46C1; }
      h2 { color: #333; margin-top: 30px; }
      .back-link { display: inline-block; margin-bottom: 20px; color: #6B46C1; text-decoration: none; }
    </style>
  </head>
  <body>
    <a href="/" class="back-link">← Back to ZoneTrain</a>
    <h1>Privacy Policy</h1>
    <p><strong>Last updated:</strong> ${new Date().toDateString()}</p>
    
    <h2>Information We Collect</h2>
    <p>When you use ZoneTrain, we collect:</p>
    <ul>
      <li><strong>Account Information:</strong> Name, email address when you sign up</li>
      <li><strong>Fitness Data:</strong> Running activities from Strava (with your permission)</li>
      <li><strong>Usage Data:</strong> How you interact with our app</li>
    </ul>

    <h2>How We Use Your Information</h2>
    <ul>
      <li>Provide personalized running coaching</li>
      <li>Analyze your training zones</li>
      <li>Send coaching updates via WhatsApp (with consent)</li>
      <li>Improve our services</li>
    </ul>

    <h2>Data Sharing</h2>
    <p>We do not sell your personal information. We may share data with:</p>
    <ul>
      <li><strong>Service Providers:</strong> Google (authentication), Strava (activity data)</li>
      <li><strong>Legal Requirements:</strong> When required by law</li>
    </ul>

    <h2>Your Rights</h2>
    <p>You can:</p>
    <ul>
      <li>Access your data</li>
      <li>Delete your account</li>
      <li>Opt out of communications</li>
    </ul>

    <h2>Contact Us</h2>
    <p>Questions? Email us at <a href="mailto:zonetrain@zohomail.in">zonetrain@zohomail.in</a></p>
  <script src="/components/nav-header.js"></script>
    </body>
  </html>
  `;
  res.send(privacyHTML);
});

// Terms of Service page
app.get('/terms', (req, res) => {
  const termsHTML = `
  <!DOCTYPE html>
  <html lang="en">
  <head>
  <link rel="stylesheet" href="css/cookies.css">
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Terms of Service - ZoneTrain</title>
    <style>
      body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 40px 20px; line-height: 1.6; }
      h1 { color: #6B46C1; }
      h2 { color: #333; margin-top: 30px; }
      .back-link { display: inline-block; margin-bottom: 20px; color: #6B46C1; text-decoration: none; }
    </style>
  </head>
  <body>
    <a href="/" class="back-link">← Back to ZoneTrain</a>
    <h1>Terms of Service</h1>
    <p><strong>Last updated:</strong> ${new Date().toDateString()}</p>
    
    <h2>Service Description</h2>
    <p>ZoneTrain provides AI-powered running coaching and personalized training plans.</p>

    <h2>User Accounts</h2>
    <ul>
      <li>You must provide accurate information when creating an account</li>
      <li>You are responsible for maintaining the security of your account</li>
      <li>One account per person</li>
    </ul>

    <h2>Subscription & Payments</h2>
    <ul>
      <li>Free tier includes basic Strava analysis</li>
      <li>Premium plans require monthly payment</li>
      <li>14-day free trial available</li>
      <li>Refunds available within 30 days</li>
    </ul>

    <h2>Prohibited Uses</h2>
    <p>You may not:</p>
    <ul>
      <li>Share your account with others</li>
      <li>Use the service for illegal purposes</li>
      <li>Attempt to reverse engineer our algorithms</li>
    </ul>

    <h2>Limitation of Liability</h2>
    <p>ZoneTrain is for informational purposes. Consult healthcare professionals before starting training programs.</p>

    <h2>Termination</h2>
    <p>We may terminate accounts that violate these terms. You can delete your account anytime.</p>

    <h2>Contact</h2>
    <p>Questions? Email <a href="mailto:zonetrain@zohomail.in">zonetrain@zohomail.in</a></p>
  <script src="/components/nav-header.js"></script>
    </body>
  </html>
  `;
  res.send(termsHTML);
});

// ADD THESE PASSPORT SERIALIZATION FUNCTIONS - MISSING FROM YOUR CODE!
passport.serializeUser((user, done) => {
    console.log('🔧 Serializing user:', user.id);
    done(null, user.id); // Only store user ID in session
});

passport.deserializeUser(async (id, done) => {
    try {
        console.log('🔧 Deserializing user ID:', id);
        const user = await userManager.getUserById(id);
        if (user) {
            console.log('✅ User deserialized successfully');
            done(null, user);
        } else {
            console.log('❌ User not found during deserialization');
            done(null, false);
        }
    } catch (error) {
        console.error('❌ Deserialization error:', error);
        done(error, null);
    }
});

// Passport serialization
// Google OAuth Strategy - FIXED VERSION
passport.use(new GoogleStrategy({
  clientID: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  callbackURL: '/auth/google/callback'
}, async (accessToken, refreshToken, profile, done) => {
  try {
    // Check if user already exists
    let user = await userManager.getUserByEmail(profile.emails[0].value);
    
    if (user) {
      // User exists, update their info and login
      await userManager.updateUser(user.id, {
        googleId: profile.id,
        firstName: profile.name.givenName,
        lastName: profile.name.familyName,
        avatar: profile.photos[0].value,
        lastLogin: new Date()
      });
      user = await userManager.getUserById(user.id);
      return done(null, user);
    } else {
      // Create new user with proper OAuth data
      const newUser = await userManager.createOAuthUser({
        googleId: profile.id,
        email: profile.emails[0].value,
        firstName: profile.name.givenName,
        lastName: profile.name.familyName,
        avatar: profile.photos[0].value,
        provider: 'google'
      });
      
      await userManager.trackActivity(newUser.id, 'google_signup', { provider: 'google' });
      return done(null, newUser);
    }
  } catch (error) {
    console.error('Google OAuth error:', error);
    return done(error, null);
  }
}));

passport.deserializeUser(async (id, done) => {
  try {
    const user = await userManager.getUserById(id);
    done(null, user);
  } catch (error) {
    done(error, null);
  }
});

// Google OAuth routes
app.get('/auth/google',
  passport.authenticate('google', { scope: ['profile', 'email'] })
);

app.get('/auth/google/callback',
  passport.authenticate('google', { failureRedirect: '/login?error=oauth_failed' }),
  async (req, res) => {
    // Successful authentication
    const user = req.user;
    
    // Generate JWT token for frontend
    const token = jwt.sign(
      { 
        userId: user.id, 
        email: user.email,
        plan: user.currentPlan,
        status: user.subscriptionStatus
      },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    // Set user data in session for the redirect
    req.session.authData = {
      token: token,
      user: userManager.sanitizeUser(user)
    };

    res.redirect('/auth/success');
  }
);

// Success page that transfers data to localStorage
app.get('/auth/success', (req, res) => {
  const authData = req.session.authData;
  
  if (!authData) {
    return res.redirect('/login?error=session_expired');
  }

  // Clear session data after use
  delete req.session.authData;

  const html = `
  <!DOCTYPE html>
  <html>
  <head>
  <link rel="stylesheet" href="css/cookies.css">
    <title>Login Successful - ZoneTrain</title>
    <style>
      body { 
        font-family: Arial, sans-serif; 
        background: linear-gradient(135deg, #6B46C1, #8B5CF6);
        color: white; 
        text-align: center; 
        padding: 50px; 
        min-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .container { background: rgba(255,255,255,0.1); padding: 40px; border-radius: 20px; }
      .spinner { font-size: 2rem; animation: spin 1s linear infinite; }
      @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
    </style>
  </head>
  <body>
    <div class="container">
      <div class="spinner">🏃‍♂️</div>
      <h2>Login Successful!</h2>
      <p>Redirecting to your dashboard...</p>
    </div>

    <script>
      // Store auth data in localStorage
      localStorage.setItem('userToken', '${authData.token}');
      localStorage.setItem('userId', '${authData.user.id}');
      localStorage.setItem('userEmail', '${authData.user.email}');
      
      // Redirect to dashboard
      setTimeout(() => {
        window.location.href = '/dashboard.html';
      }, 2000);
    </script>
    <script src="/components/nav-header.js"></script>
  </body>
  </html>
  `;
  
  res.send(html);
});

// ============================================
// STRAVA OAUTH ROUTES - FIXED
// ============================================

// Step 1: Initial redirect (no auth needed)
app.get('/connect-strava', (req, res) => {
    // Store a session token to identify user when they return
    const sessionToken = crypto.randomBytes(32).toString('hex');
    
    // Store this in memory or Redis (for production use Redis)
    // For now, we'll use a simple in-memory store
    if (!global.stravaOAuthSessions) {
        global.stravaOAuthSessions = {};
    }
    
    // Session expires in 10 minutes
    global.stravaOAuthSessions[sessionToken] = {
        timestamp: Date.now(),
        returnUrl: req.headers.referer || '/ai-onboarding?plan=race'
    };
    
    const redirectUri = encodeURIComponent(`${process.env.BASE_URL || 'http://localhost:3000'}/auth/strava/callback`);
    const stravaAuthUrl = `https://www.strava.com/oauth/authorize?` +
        `client_id=${process.env.STRAVA_CLIENT_ID}` +
        `&redirect_uri=${redirectUri}` +
        `&response_type=code` +
        `&scope=activity:read_all` +
        `&state=${sessionToken}` +  // Pass session token as state
        `&approval_prompt=auto`;
    
    res.redirect(stravaAuthUrl);
});

// Step 2: Strava OAuth Callback
app.get('/auth/strava/callback', async (req, res) => {
    const { code, state: sessionToken } = req.query;
    
    if (!code) {
        console.error('❌ No code in Strava callback');
        return res.redirect('/ai-onboarding?plan=race&strava=error&msg=no_code');
    }
    
    try {
        // Verify session token
        const session = global.stravaOAuthSessions?.[sessionToken];
        if (!session) {
            console.error('❌ Invalid or expired session token');
            return res.redirect('/ai-onboarding?plan=race&strava=error&msg=session_expired');
        }
        
        // Check if session is expired (10 minutes)
        if (Date.now() - session.timestamp > 10 * 60 * 1000) {
            delete global.stravaOAuthSessions[sessionToken];
            return res.redirect('/ai-onboarding?plan=race&strava=error&msg=timeout');
        }
        
        console.log('🔄 Exchanging Strava code for token...');
        
        // Exchange code for access token
        const tokenResponse = await axios.post('https://www.strava.com/oauth/token', {
            client_id: process.env.STRAVA_CLIENT_ID,
            client_secret: process.env.STRAVA_CLIENT_SECRET,
            code: code,
            grant_type: 'authorization_code'
        });
        
        const { access_token, refresh_token, athlete } = tokenResponse.data;
        
        console.log('✅ Strava token received for athlete:', athlete.id);
        
        // Get userId from the frontend's localStorage via a cookie/session
        // For now, we'll store the Strava data temporarily and let frontend claim it
        const stravaDataToken = crypto.randomBytes(16).toString('hex');
        
        if (!global.stravaConnections) {
            global.stravaConnections = {};
        }
        
        global.stravaConnections[stravaDataToken] = {
            accessToken: access_token,
            refreshToken: refresh_token,
            athleteId: athlete.id,
            athleteName: `${athlete.firstname} ${athlete.lastname}`,
            timestamp: Date.now()
        };
        
        // Clean up session
        delete global.stravaOAuthSessions[sessionToken];
        
        // Redirect back with success token
        const returnUrl = session.returnUrl || '/ai-onboarding?plan=race';
        const separator = returnUrl.includes('?') ? '&' : '?';
        res.redirect(`${returnUrl}${separator}strava=success&token=${stravaDataToken}`);
        
    } catch (error) {
        console.error('❌ Strava OAuth error:', error.response?.data || error.message);
        res.redirect('/ai-onboarding?plan=race&strava=error&msg=exchange_failed');
    }
});

// Step 3: Frontend claims Strava connection
app.post('/api/claim-strava-connection', authenticateToken, async (req, res) => {
    try {
        const { stravaToken } = req.body;
        const userId = req.user.userId;
        
        const stravaData = global.stravaConnections?.[stravaToken];
        
        if (!stravaData) {
            return res.status(400).json({
                success: false,
                message: 'Invalid or expired Strava connection token'
            });
        }
        
        // Check if not expired (5 minutes)
        if (Date.now() - stravaData.timestamp > 5 * 60 * 1000) {
            delete global.stravaConnections[stravaToken];
            return res.status(400).json({
                success: false,
                message: 'Strava connection expired. Please try again.'
            });
        }
        
        // Save to user's profile
        await userManager.updateUser(userId, {
            stravaAccessToken: stravaData.accessToken,
            stravaRefreshToken: stravaData.refreshToken,
            stravaAthleteId: stravaData.athleteId,
            stravaConnected: true,
            stravaConnectedAt: new Date().toISOString()
        });
        
        // Clean up
        delete global.stravaConnections[stravaToken];
        
        console.log('✅ Strava connected for user:', userId);
        
        res.json({
            success: true,
            message: 'Strava connected successfully',
            athleteName: stravaData.athleteName
        });
        
    } catch (error) {
        console.error('❌ Claim Strava connection error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to save Strava connection'
        });
    }
});



// Strava analysis with rate limiting
app.get('/api/strava/analyze', 
    authenticateToken, 
    requireFeatureAccess('strava-analysis'), 
    async (req, res) => {
        try {
            // Perform Strava analysis
            const analysisResult = await performStravaAnalysis(req.user.userId);
            
            // Track usage
            await trackFeatureUsage(req.user.userId, 'strava-analysis', {
                activitiesAnalyzed: analysisResult.activities.length
            });

            res.json({
                success: true,
                data: analysisResult,
                usage: req.featureAccess.currentUsage + 1,
                limit: req.featureAccess.limit,
                remaining: req.featureAccess.remaining - 1
            });
        } catch (error) {
            console.error('Strava analysis error:', error);
            res.status(500).json({
                success: false,
                message: 'Analysis failed'
            });
        }
    }
);

// HRV coaching endpoint
app.post('/api/coaching/hrv', 
    authenticateToken, 
    requireFeatureAccess('hrv-coaching'), 
    async (req, res) => {
        try {
            const { hrvData, additionalData } = req.body;
            const coaching = await generateHRVCoaching(req.user.userId, hrvData, additionalData);
            
            await trackFeatureUsage(req.user.userId, 'hrv-coaching', {
                hrvValue: hrvData.value,
                coachingType: coaching.type
            });

            res.json({
                success: true,
                coaching: coaching
            });
        } catch (error) {
            console.error('HRV coaching error:', error);
            res.status(500).json({
                success: false,
                message: 'Coaching generation failed'
            });
        }
    }
);

// WhatsApp coaching with usage tracking
app.post('/api/coaching/whatsapp', 
    authenticateToken, 
    requireFeatureAccess('whatsapp-coaching'), 
    async (req, res) => {
        try {
            const { message, phoneNumber } = req.body;
            const response = await sendWhatsAppCoaching(phoneNumber, message);
            
            await trackFeatureUsage(req.user.userId, 'whatsapp-coaching', {
                messageType: req.body.type || 'general',
                phoneNumber: phoneNumber.slice(-4) // Log last 4 digits only
            });

            res.json({
                success: true,
                message: 'Coaching message sent',
                remaining: req.featureAccess.remaining - 1
            });
        } catch (error) {
            console.error('WhatsApp coaching error:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to send coaching message'
            });
        }
    }
);

// Race planning (paid feature)
app.post('/api/planning/race', 
    authenticateToken, 
    requireFeatureAccess('race-planning'), 
    async (req, res) => {
        try {
            const { raceData, goals } = req.body;
            const racePlan = await generateRacePlan(req.user.userId, raceData, goals);
            
            await trackFeatureUsage(req.user.userId, 'race-planning', {
                raceDistance: raceData.distance,
                raceDate: raceData.date,
                goalTime: goals.targetTime
            });

            res.json({
                success: true,
                plan: racePlan
            });
        } catch (error) {
            console.error('Race planning error:', error);
            res.status(500).json({
                success: false,
                message: 'Race plan generation failed'
            });
        }
    }
);

// AI ONBOARDING - Save profile and generate training plan
app.post('/api/ai-onboarding', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        const onboardingData = req.body;
        
        console.log('🔧 Saving AI onboarding data for user:', userId);
        console.log('📋 Onboarding data received:', Object.keys(onboardingData));
        
        // Save AI profile to Firestore
        const aiProfile = {
            userId: userId,
            personalProfile: {
                age: parseInt(onboardingData.age),
                gender: onboardingData.gender,
                height: parseInt(onboardingData.height),
                weight: parseFloat(onboardingData.weight),
                injuries: onboardingData.injuries || []
            },
            raceHistory: {
                recentPB: {
                    distance: onboardingData.pbdistance,
                    time: onboardingData.pbtime,
                    date: onboardingData.pbdate,
                    location: onboardingData.pblocation
                },
                targetRace: {
                    distance: onboardingData.targetdistance,
                    date: onboardingData.targetdate,
                    targetTime: onboardingData.targettime,
                    location: onboardingData.targetlocation
                },
                currentWeeklyMileage: parseInt(onboardingData.weeklymileage)
            },
            recovery: {
                restingHR: parseInt(onboardingData.restinghr) || null,
                hrvBaseline: parseInt(onboardingData.hrvbaseline) || null,
                sleepQuality: parseInt(onboardingData.sleepquality) || 7,
                devices: onboardingData.devices || []
            },
            trainingStructure: {
                preferredDays: onboardingData.runningdays || [],
                intensityPreference: onboardingData.intensitypreference,
                constraints: onboardingData.constraints || ''
            },
            location: {
                homeLocation: onboardingData.homelocation,
                raceLocationWeather: onboardingData.racelocationweather || null
            },
            stravaConnected: onboardingData.stravaConnected || false,
            createdAt: new Date(),
            updatedAt: new Date()
        };
        
        // Save to Firestore
        const profileRef = await db.collection('aiprofiles').add(aiProfile);
        console.log('✅ AI profile saved:', profileRef.id);
        
        // Update user record
        await userManager.updateUser(userId, {
            aiOnboardingCompleted: true,
            aiProfileId: profileRef.id,
            updatedAt: new Date()
        });
        
        // Generate AI training plan
        console.log('🤖 Generating AI training plan...');
        const trainingPlan = await generateTrainingPlan(aiProfile);
        
        // Save training plan
        const planRef = await db.collection('trainingplans').add({
            userId: userId,
            profileId: profileRef.id,
            ...trainingPlan,
            createdAt: new Date(),
            status: 'active'
        });
        
        console.log('✅ Training plan saved:', planRef.id);
        
        res.json({
            success: true,
            message: 'AI onboarding completed successfully',
            profileId: profileRef.id,
            planId: planRef.id,
            userId: userId
        });
        
    } catch (error) {
        console.error('❌ AI onboarding error:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to complete AI onboarding'
        });
    }
});

// Generate training plan using Gemini AI
async function generateTrainingPlan(profile) {
    try {
        // Calculate days to race
        const raceDate = new Date(profile.raceHistory.targetRace.date);
        const today = new Date();
        const daysToRace = Math.floor((raceDate - today) / (1000 * 60 * 60 * 24));
        
        console.log(`📅 Race in ${daysToRace} days`);
        
        // If Gemini API key exists, use AI
        if (process.env.GEMINI_API_KEY) {
            const { GoogleGenerativeAI } = require('@google/generative-ai');
            const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
            const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
            
            const prompt = `Create a personalized running training plan:
            
Profile:
- Age: ${profile.personalProfile.age}, Gender: ${profile.personalProfile.gender}
- Current weekly mileage: ${profile.raceHistory.currentWeeklyMileage}km
- Target race: ${profile.raceHistory.targetRace.distance} in ${daysToRace} days
- Recent PB: ${profile.raceHistory.recentPB.distance} in ${profile.raceHistory.recentPB.time}
- Training days: ${profile.trainingStructure.preferredDays.join(', ')}
- Intensity preference: ${profile.trainingStructure.intensityPreference}
- Resting HR: ${profile.recovery.restingHR || 'unknown'} bpm

Generate a 4-week training block with:
1. Weekly structure (total km, easy runs, workouts, long run)
2. Daily breakdown for each training day
3. Progression plan
4. Recovery recommendations

Format as JSON with structure:
{
  "weeklyPlans": [
    {
      "week": 1,
      "totalDistance": 30,
      "days": [
        {"day": "Monday", "type": "Easy Run", "distance": 5, "pace": "5:30-6:00/km", "notes": "Focus on easy effort"}
      ]
    }
  ],
  "progression": "...",
  "recoveryGuidance": "..."
}`;

            const result = await model.generateContent(prompt);
            const response = await result.response;
            const text = response.text();
            
            // Parse JSON from response
            const jsonMatch = text.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                const plan = JSON.parse(jsonMatch[0]);
                console.log('✅ AI plan generated via Gemini');
                return {
                    type: 'ai-generated',
                    source: 'gemini',
                    ...plan
                };
            }
        }
        
        // Fallback template plan
        console.log('⚠️ Using template plan (no Gemini API key)');
        return generateTemplatePlan(profile, daysToRace);
        
    } catch (error) {
        console.error('⚠️ AI generation failed, using template:', error.message);
        const raceDate = new Date(profile.raceHistory.targetRace.date);
        const daysToRace = Math.floor((raceDate - new Date()) / (1000 * 60 * 60 * 24));
        return generateTemplatePlan(profile, daysToRace);
    }
}

// Template plan fallback
function generateTemplatePlan(profile, daysToRace) {
    const baseMileage = profile.raceHistory.currentWeeklyMileage;
    const trainingDays = profile.trainingStructure.preferredDays.length;
    
    return {
        type: 'template',
        weeklyPlans: [
            {
                week: 1,
                totalDistance: baseMileage,
                days: generateWeekDays(profile, baseMileage, 1)
            },
            {
                week: 2,
                totalDistance: Math.round(baseMileage * 1.1),
                days: generateWeekDays(profile, Math.round(baseMileage * 1.1), 2)
            },
            {
                week: 3,
                totalDistance: Math.round(baseMileage * 1.15),
                days: generateWeekDays(profile, Math.round(baseMileage * 1.15), 3)
            },
            {
                week: 4,
                totalDistance: Math.round(baseMileage * 0.8),
                days: generateWeekDays(profile, Math.round(baseMileage * 0.8), 4)
            }
        ],
        progression: '10% weekly increase, with deload every 4th week',
        recoveryGuidance: 'Monitor HRV, take rest days seriously, prioritize sleep'
    };
}

function generateWeekDays(profile, weeklyDistance, weekNumber) {
    const days = profile.trainingStructure.preferredDays;
    const distancePerDay = Math.floor(weeklyDistance / days.length);
    
    return days.map((day, index) => ({
        day: day.charAt(0).toUpperCase() + day.slice(1),
        type: index === days.length - 1 ? 'Long Run' : (index % 2 === 0 ? 'Easy Run' : 'Tempo Run'),
        distance: index === days.length - 1 ? Math.round(distancePerDay * 1.5) : distancePerDay,
        pace: '5:30-6:00/km',
        notes: `Week ${weekNumber} - ${index === days.length - 1 ? 'Build endurance' : 'Moderate effort'}`
    }));
}

const USER_FEATURE_MAP = {
    'strava_connect': ['free', 'premium'],
    'basic_dashboard': ['free', 'premium'],
    'ai_coaching': ['premium'],
    'zone_analysis': ['premium'],
    'training_plans': ['premium'],
    'race_predictions': ['premium'],
    'advanced_analytics': ['premium']
};

// Check if user has access to a specific feature
async function checkUserFeature(user, feature) {
    const userTier = user.subscriptionStatus || 'free';
    const allowedTiers = USER_FEATURE_MAP[feature] || [];
    return allowedTiers.includes(userTier);
}


// Add this route to your app.js - it's missing!
// Dashboard data endpoint - FIXED VERSION
app.get('/api/dashboard-data', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const user = await userManager.getUserById(userId);
    
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Get latest zone analysis
    const latestAnalysis = await userManager.getLatestZoneAnalysis(userId);
    
    // Check Strava connection
    const stravaTokens = await userManager.getStravaTokens(userId);
    const stravaConnected = !!stravaTokens;

    console.log('Dashboard API Response:', {
      userId: userId,
      subscriptionStatus: user.subscriptionStatus,
      currentPlan: user.currentPlan,
      stravaConnected: stravaConnected
    });

    res.json({
      success: true,
      data: {
        user: {
          name: user.firstName || user.email.split('@')[0],
          email: user.email,
          subscriptionStatus: user.subscriptionStatus || 'free',
          currentPlan: user.currentPlan || null,
          trialEndDate: user.trialEndDate || null,
          planStartDate: user.planStartDate || null
        },
        strava: {
          connected: stravaConnected,
          connectionDate: user.stravaConnectedAt || null
        },
        latestAnalysis: latestAnalysis
      }
    });
  } catch (error) {
    console.error('Dashboard data error:', error);
    res.status(500).json({ success: false, message: 'Failed to load dashboard data' });
  }
});


// Add this DEBUG route to your app.js - TEMPORARY for debugging
app.get('/debug/user-tokens', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        console.log('Debug: Looking up user:', userId);
        
        const user = await userManager.getUserById(userId);
        console.log('Debug: User data:', {
            id: user?.id,
            email: user?.email,
            hasStravaAccessToken: !!user?.stravaAccessToken,
            hasStravaRefreshToken: !!user?.stravaRefreshToken,
            stravaConnectedAt: user?.stravaConnectedAt
        });
        
        res.json({
            userId: userId,
            userExists: !!user,
            hasStravaAccessToken: !!user?.stravaAccessToken,
            hasStravaRefreshToken: !!user?.stravaRefreshToken,
            stravaConnectedAt: user?.stravaConnectedAt,
            rawTokens: {
                accessToken: user?.stravaAccessToken?.substring(0, 10) + '...',
                refreshToken: user?.stravaRefreshToken?.substring(0, 10) + '...'
            }
        });
    } catch (error) {
        console.error('Debug error:', error);
        res.json({ error: error.message });
    }
});

// Add this NEW route to your app.js - handles token via URL parameter
// REPLACE your existing /run-analysis route with this enhanced version
app.get('/run-analysis', async (req, res) => {
    try {
        console.log('🏃 Starting zone analysis...');
        
        // Get token from URL parameter
        const token = req.query.token;
        if (!token) {
            console.log('❌ No token in URL');
            return res.redirect('/dashboard.html?error=no_token');
        }
        
        // Verify the user token
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const userId = decoded.userId;
        console.log('✅ Token verified for user:', userId);
        
        // Get VALID Strava tokens (with auto-refresh)
        console.log('🔍 Getting valid Strava tokens...');
        const tokens = await userManager.getValidStravaTokens(userId);
        
        if (!tokens) {
            console.log('❌ No valid Strava tokens - need to reconnect');
            return res.redirect('/dashboard.html?action=reconnect_strava&message=Please reconnect your Strava account');
        }
        
        const stravaAccessToken = tokens.accessToken;
        console.log('✅ Valid Strava token obtained');
        
        // Fetch activities from Strava
        console.log('📡 Fetching activities from Strava...');
        const activitiesResponse = await axios.get('https://www.strava.com/api/v3/athlete/activities?per_page=20', {
            headers: { 'Authorization': `Bearer ${stravaAccessToken}` },
            timeout: 10000
        });

        const activities = activitiesResponse.data;
        const runningActivities = activities.filter(a => a.has_heartrate && a.type === 'Run');
        console.log(`✅ Found ${runningActivities.length} running activities with HR data out of ${activities.length} total activities`);

        if (runningActivities.length < 3) {
            console.log('⚠️ Insufficient running data');
            return res.send(generateInsufficientDataHTML(runningActivities.length));
        }

        // Analyze zones
        console.log('📊 Analyzing training zones...');
        const zoneAnalysis = analyzeTrainingZones(runningActivities);
        
        // Generate AI insight
        console.log('🤖 Generating AI insight...');
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
        
        const zoneSummary = zoneAnalysis.zoneNames.map((name, i) => 
            `${name}: ${zoneAnalysis.percentages[i]}%`
        ).join(', ');
        
        const prompt = `Based on this running zone distribution: ${zoneSummary}. Generate a brief training insight (max 25 words) focusing on what the runner should do next.`;
        const aiResponse = await model.generateContent(prompt);
        const aiInsight = aiResponse.response.text().trim();

        // Save analysis to database
        console.log('💾 Saving analysis to database...');
        const analysisData = {
            percentages: zoneAnalysis.percentages,
            totalActivities: zoneAnalysis.totalActivities,
            aiInsight: aiInsight,
            zoneNames: zoneAnalysis.zoneNames
        };
        
        // Save to database directly
        const analysisDoc = {
            userId,
            analysisDate: new Date(),
            zonePercentages: analysisData.percentages,
            totalActivities: analysisData.totalActivities,
            aiInsight: analysisData.aiInsight,
            zoneNames: analysisData.zoneNames,
            activitiesAnalyzed: runningActivities.length,
            createdAt: new Date()
        };
        
        const docRef = await db.collection('zone_analyses').add(analysisDoc);
        
        // Update user's latest analysis
        await db.collection('users').doc(userId).update({
            latestZoneAnalysis: {
                id: docRef.id,
                date: new Date(),
                summary: analysisData.aiInsight
            },
            lastAnalysisAt: new Date(),
            updatedAt: new Date()
        });

        console.log('✅ Analysis complete and saved');
        
        // Return analysis page
        res.send(generateAnalysisHTML(analysisData, true));

    } catch (error) {
        console.error('❌ Analysis error:', error.message);
        console.error('Full error:', error);
        
        if (error.response?.status === 401) {
            console.log('🔄 Strava auth failed - redirecting to reconnect');
            return res.redirect('/dashboard.html?action=reconnect_strava&message=Please reconnect your Strava account');
        }
        
        if (error.name === 'JsonWebTokenError') {
            console.log('🔄 User token invalid - redirecting to login');
            return res.redirect('/?error=session_expired');
        }
        
        res.send(generateErrorHTML(`Analysis failed: ${error.message}. Please try again or reconnect Strava.`));
    }
});

// Guest Strava Connect - No login required
app.get('/guest-strava-connect', (req, res) => {
    console.log('🎯 Guest Strava connection requested');
    
    // Generate a temporary session ID for guest user
    const guestSessionId = 'guest_' + Date.now() + '_' + Math.random().toString(36).substring(2);
    
    const stravaAuthUrl = 
        'https://www.strava.com/oauth/authorize?' +
        `client_id=${process.env.STRAVA_CLIENT_ID}&` +
        'response_type=code&' +
        `redirect_uri=${encodeURIComponent(process.env.STRAVA_REDIRECT_URI)}&` +
        'approval_prompt=force&' +
        'scope=read,activity:read_all&' +
        `state=${encodeURIComponent(guestSessionId)}`;
    
    console.log('🔗 Redirecting guest to Strava');
    res.redirect(stravaAuthUrl);
});

// Guest Analysis - No authentication required
app.get('/guest-analysis', async (req, res) => {
    try {
        const sessionId = req.query.session;
        console.log('🎯 Guest analysis requested for session:', sessionId);
        
        if (!sessionId || !sessionId.startsWith('guest_')) {
            return res.redirect('/?error=invalid_session');
        }
        
        // Get guest session data
        global.guestSessions = global.guestSessions || new Map();
        const guestData = global.guestSessions.get(sessionId);
        
        if (!guestData) {
            console.log('❌ Guest session not found');
            return res.redirect('/?error=session_expired');
        }
        
        // Check if session is expired
        if (new Date() > guestData.expiresAt) {
            console.log('❌ Guest session expired');
            global.guestSessions.delete(sessionId);
            return res.redirect('/?error=session_expired');
        }
        
        console.log('✅ Valid guest session found');
        
        // Fetch activities from Strava
        console.log('📡 Fetching activities from Strava...');
        const activitiesResponse = await axios.get('https://www.strava.com/api/v3/athlete/activities?per_page=20', {
            headers: { 'Authorization': `Bearer ${guestData.accessToken}` },
            timeout: 10000
        });

        const activities = activitiesResponse.data;
        const runningActivities = activities.filter(a => a.has_heartrate && a.type === 'Run');
        console.log(`✅ Found ${runningActivities.length} running activities with HR data`);

        if (runningActivities.length < 3) {
            return res.send(generateInsufficientDataHTML(runningActivities.length, true)); // Pass true for guest
        }

        // Analyze zones
        console.log('📊 Analyzing training zones...');
        const zoneAnalysis = analyzeTrainingZones(runningActivities);
        
        // Generate AI insight
        console.log('🤖 Generating AI insight...');
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
        
        const zoneSummary = zoneAnalysis.zoneNames.map((name, i) => 
            `${name}: ${zoneAnalysis.percentages[i]}%`
        ).join(', ');
        
        const prompt = `Based on this running zone distribution: ${zoneSummary}. Generate a brief training insight (max 25 words) focusing on what the runner should do next.`;
        const aiResponse = await model.generateContent(prompt);
        const aiInsight = aiResponse.response.text().trim();

        const analysisData = {
            percentages: zoneAnalysis.percentages,
            totalActivities: zoneAnalysis.totalActivities,
            aiInsight: aiInsight,
            zoneNames: zoneAnalysis.zoneNames,
            isGuest: true
        };

        console.log('✅ Guest analysis complete');
        
        // Return analysis page with signup prompt
        const baseHTML = generateGuestAnalysisHTML(analysisData);

// Create client-side tracking script (this will run in the browser)
const trackingScript = `
<script>
document.addEventListener('DOMContentLoaded', function() {
    console.log('🍪 Checking for cookie consent on analysis page');
    
    // This runs in the USER'S BROWSER where ztCookies exists
    if (window.ztCookies && window.ztCookies.hasConsent('analytics')) {
        ztCookies.trackEvent('guest_analysis_completed', {
            totalActivities: ${analysisData.totalActivities},
            userType: 'guest',
            source: 'strava_connection'
        });
    }
});
</script>
`;

// Inject the script into the HTML and send it
const finalHTML = baseHTML.replace('</body>', trackingScript + '</body>');
res.send(finalHTML);

    } catch (error) {
        console.error('❌ Guest analysis error:', error.message);
        
        if (error.response?.status === 401) {
            return res.redirect('/?error=strava_expired&action=reconnect');
        }
        
        res.send(generateErrorHTML(`Analysis failed: ${error.message}. Please try again.`, true));
    }
});

// Add this helper function at the top of your app.js
function getCookieModalHTML() {
    return `
    <div id="ztCookieModal" class="zt-cookie-modal">
        <div class="zt-cookie-modal-content">
            <div class="zt-cookie-modal-header">
                <h3 class="zt-cookie-modal-title">Cookie Preferences</h3>
                <button class="zt-cookie-close" onclick="ztCookies.hideSettings()">&times;</button>
            </div>
            
            <div class="zt-cookie-category">
                <div class="zt-cookie-category-header">
                    <h4 class="zt-cookie-category-title">Essential Cookies</h4>
                    <div class="zt-cookie-toggle active disabled">
                        <div class="zt-cookie-toggle-slider"></div>
                    </div>
                </div>
                <div class="zt-cookie-category-desc">
                    Required for ZoneTrain to function properly. Cannot be disabled.
                </div>
            </div>
            
            <div class="zt-cookie-category">
                <div class="zt-cookie-category-header">
                    <h4 class="zt-cookie-category-title">Analytics Cookies</h4>
                    <div class="zt-cookie-toggle" id="ztanalyticsToggle" onclick="ztCookies.toggleCategory('analytics')">
                        <div class="zt-cookie-toggle-slider"></div>
                    </div>
                </div>
                <div class="zt-cookie-category-desc">
                    Help us improve ZoneTrain by understanding feature usage and user behavior.
                </div>
            </div>
            
            <div class="zt-cookie-category">
                <div class="zt-cookie-category-header">
                    <h4 class="zt-cookie-category-title">Marketing Cookies</h4>
                    <div class="zt-cookie-toggle" id="ztmarketingToggle" onclick="ztCookies.toggleCategory('marketing')">
                        <div class="zt-cookie-toggle-slider"></div>
                    </div>
                </div>
                <div class="zt-cookie-category-desc">
                    Enable personalized content and measure marketing campaign effectiveness.
                </div>
            </div>
            
            <div class="zt-cookie-category">
                <div class="zt-cookie-category-header">
                    <h4 class="zt-cookie-category-title">Functional Cookies</h4>
                    <div class="zt-cookie-toggle" id="ztfunctionalToggle" onclick="ztCookies.toggleCategory('functional')">
                        <div class="zt-cookie-toggle-slider"></div>
                    </div>
                </div>
                <div class="zt-cookie-category-desc">
                    Remember your preferences and provide enhanced ZoneTrain features.
                </div>
            </div>
            
            <div class="zt-cookie-modal-actions">
                <button class="zt-cookie-btn zt-cookie-decline" onclick="ztCookies.declineNonEssential(); ztCookies.hideSettings();">
                    Decline All
                </button>
                <button class="zt-cookie-btn zt-cookie-accept" onclick="ztCookies.saveSettings()">
                    Save Preferences
                </button>
            </div>
        </div>
    </div>`;
}

function getCookieBannerHTML() {
    return `
    <div id="ztCookieBanner" class="zt-cookie-banner">
        <div class="zt-cookie-container">
            <div class="zt-cookie-content">
                <div class="zt-cookie-title">🍪 We value your privacy</div>
                <div class="zt-cookie-text">
                    We use cookies to enhance your ZoneTrain experience, analyze performance, and provide personalized training insights.
                </div>
                <div class="zt-cookie-links">
                    <a href="/privacy-policy" class="zt-cookie-link">Privacy Policy</a>
                    <a href="/cookie-policy" class="zt-cookie-link">Cookie Policy</a>
                </div>
            </div>
            <div class="zt-cookie-actions">
                <button class="zt-cookie-btn zt-cookie-decline" onclick="ztCookies.declineNonEssential()">
                    Decline
                </button>
                <button class="zt-cookie-btn zt-cookie-settings" onclick="ztCookies.showSettings()">
                    Settings
                </button>
                <button class="zt-cookie-btn zt-cookie-accept" onclick="ztCookies.acceptAll()">
                    Accept All
                </button>
            </div>
        </div>
    </div>`;
}

// ============================================
// AI ONBOARDING SYSTEM - ADD TO APP.JS
// ============================================

// Serve AI onboarding page (only for paid users)

// Add this route to your app.js
app.get('/api/user-status', authenticateToken, async (req, res) => {
    try {
        const userId = req.user?.userId;

        if (!userId) {
            return res.status(401).json({
                success: false,
                error: 'User not authenticated'
            });
        }
        
        // Get user data
        const userDoc = await db.collection('users').doc(userId).get();
        const userData = userDoc.data();
        
        // Get subscription status
        const subscriptionQuery = await db.collection('subscriptions')
            .where('userId', '==', userId)
            .where('status', '==', 'active')
            .limit(1)
            .get();
        
        let subscription = null;
        if (!subscriptionQuery.empty) {
            subscription = subscriptionQuery.docs[0].data();
        }
        
        // Check AI onboarding status
        const aiProfileDoc = await db.collection('ai_profiles').doc(userId).get();
        const aiOnboardingCompleted = aiProfileDoc.exists;
        
        res.json({
            success: true,
            user: {
                email: userData?.email || 'Unknown', // ← Add null check here
                name: userData?.name || userData?.firstName || 'User', // ← Add null check here
                joinedAt: userData?.createdAt || new Date() // ← Add null check here
            },
            subscription: subscription,
            aiOnboardingCompleted: aiOnboardingCompleted
        });
        
    } catch (error) {
        console.error('User status error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get user status'
        });
    }
});
