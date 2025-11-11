require('dotenv').config();
const express = require('express');
const app = express();

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
const FileStore = require('session-file-store')(session);
const axios = require('axios');
const path = require('path');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { GoogleGenerativeAI } = require('@google/generative-ai');



// Add these imports after your existing requires
const { authenticateToken, requirePlan, requireAdmin, optionalAuth } = require('./middleware/accessControl');
const nodemailer = require('nodemailer'); // You'll need: npm install nodemailer
// Optional security middleware
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // 100 requests per 15 minutes
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => process.env.NODE_ENV !== 'production', // Disable in dev
  keyGenerator: (req) => req.ip || req.socket.remoteAddress, // Fallback for rate limiting
});

// Stricter limiter for auth endpoints (prevent brute force)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // Only 5 login/signup attempts
  message: 'Too many login/signup attempts, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => process.env.NODE_ENV !== 'production',
  keyGenerator: (req) => req.ip || req.socket.remoteAddress,
});


const port = process.env.PORT || 3000;

const cron = require('node-cron');

console.log('🔍 Validating environment variables...');

const requiredEnvVars = {
  // Authentication & Security
  JWT_SECRET: { minLength: 32, description: 'JWT signing secret' },
  SESSION_SECRET: { minLength: 32, description: 'Session encryption secret' },
  
  // Firebase (Database)
  FIREBASE_PROJECT_ID: { minLength: 1, description: 'Firebase project ID' },
  FIREBASE_PRIVATE_KEY: { minLength: 100, description: 'Firebase service account private key' },
  FIREBASE_CLIENT_EMAIL: { minLength: 1, description: 'Firebase service account email' },
  
  // Razorpay (Payments)
  RAZORPAY_KEY_ID: { minLength: 1, description: 'Razorpay API key ID' },
  RAZORPAY_KEY_SECRET: { minLength: 1, description: 'Razorpay API secret' },
  RAZORPAY_WEBHOOK_SECRET: { minLength: 20, description: 'Razorpay webhook signature secret', optional: process.env.NODE_ENV !== 'production' },
  
  // OAuth (Google/Facebook)
  GOOGLE_CLIENT_ID: { minLength: 1, description: 'Google OAuth client ID', optional: true },
  GOOGLE_CLIENT_SECRET: { minLength: 1, description: 'Google OAuth client secret', optional: true },
  
  // Email (Zoho/SMTP)
  ZOHO_EMAIL: { minLength: 1, description: 'Email sender address', optional: true },
  ZOHO_PASSWORD: { minLength: 1, description: 'Email account password', optional: true },

  WHATSAPP_API_KEY: { minLength: 1, description: 'WhatsApp Business API key', optional: true },
  WHATSAPP_PHONE_NUMBER: { minLength: 10, description: 'WhatsApp sender phone number', optional: true },
  WHATSAPP_ACCOUNT_SID: { minLength: 1, description: 'WhatsApp account SID (if using Twilio)', optional: true }

};

let hasErrors = false;

Object.entries(requiredEnvVars).forEach(([varName, config]) => {
  const value = process.env[varName];
  
  // Check if variable exists
  if (!value || value.trim() === '') {
    if (config.optional) {
      console.warn(`⚠️  Optional: ${varName} not set (${config.description})`);
    } else {
      console.error(`❌ MISSING: ${varName} (${config.description})`);
      hasErrors = true;
    }
    return;
  }
  
  // Check minimum length
  if (config.minLength && value.length < config.minLength) {
    console.error(`❌ INVALID: ${varName} is too short (min ${config.minLength} chars, got ${value.length})`);
    console.error(`   Description: ${config.description}`);
    hasErrors = true;
    return;
  }
  
  // Success
  console.log(`✅ ${varName}: Valid (${value.length} chars)`);
});

// Additional security checks
if (process.env.JWT_SECRET === process.env.SESSION_SECRET) {
  console.warn('⚠️  WARNING: JWT_SECRET and SESSION_SECRET should be different for security');
}

if (process.env.JWT_SECRET && (
  process.env.JWT_SECRET.includes('your-secret') || 
  process.env.JWT_SECRET.includes('changeme') ||
  process.env.JWT_SECRET.includes('example')
)) {
  console.error('❌ SECURITY RISK: JWT_SECRET contains default/example value - change it!');
  hasErrors = true;
}

// Check production-specific requirements
if (process.env.NODE_ENV === 'production') {
  console.log('🚀 Production mode detected - enforcing strict validation');
  
  if (!process.env.RAZORPAY_WEBHOOK_SECRET) {
    console.error('❌ CRITICAL: RAZORPAY_WEBHOOK_SECRET must be set in production');
    hasErrors = true;
  }
  
  if (process.env.RAZORPAY_KEY_ID?.startsWith('rzp_test')) {
    console.error('❌ CRITICAL: Using TEST Razorpay keys in PRODUCTION mode!');
    console.error('   Switch to LIVE keys (rzp_live_...) before deploying');
    hasErrors = true;
  }
}

// Exit if critical errors found
if (hasErrors) {
  console.error('\n❌❌❌ FATAL: Missing or invalid environment variables ❌❌❌');
  console.error('Please check your .env file and fix the errors above.');
  console.error('Server startup ABORTED.\n');
  process.exit(1); // Stop server
}

console.log('✅ All required environment variables validated successfully\n');

// Add after your app initialization and before routes
// Schedule cleanup job - runs every hour at minute 0
cron.schedule('0 * * * *', async () => {
    console.log('🔍 Running unverified user cleanup job at:', new Date().toISOString());
    
    try {
        const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
        
        // Find unverified users created more than 24 hours ago
        const unverifiedUsersSnapshot = await db.collection('users')
            .where('emailVerified', '==', false)
            .where('authProvider', '==', 'email')
            .where('active', '!=', false)
            .get();
        
        if (unverifiedUsersSnapshot.empty) {
            console.log('✅ No unverified users to block');
            return;
        }
        
        // Filter by creation date (Firestore doesn't support multiple inequality filters)
        const usersToBlock = [];
        unverifiedUsersSnapshot.docs.forEach(doc => {
            const userData = doc.data();
            const createdAt = userData.createdAt?.toDate?.() || new Date(userData.createdAt);
            
            if (createdAt <= twentyFourHoursAgo) {
                usersToBlock.push({
                    id: doc.id,
                    email: userData.email,
                    createdAt: createdAt
                });
            }
        });
        
        if (usersToBlock.length === 0) {
            console.log('✅ No unverified users older than 24 hours');
            return;
        }
        
        console.log(`⚠️ Found ${usersToBlock.length} unverified users to block:`, 
            usersToBlock.map(u => u.email));
        
        // Block each unverified user
        const batch = db.batch();
        usersToBlock.forEach(user => {
            const userRef = db.collection('users').doc(user.id);
            batch.update(userRef, {
                active: false,
                blockedReason: 'Email not verified within 24 hours',
                blockedAt: new Date()
            });
        });
        
        await batch.commit();
        console.log(`✅ Successfully blocked ${usersToBlock.length} unverified users`);
        
        // Track in activity log
        for (const user of usersToBlock) {
            try {
                await userManager.trackActivity(user.id, 'account_blocked', {
                    reason: 'email_not_verified',
                    createdAt: user.createdAt,
                    blockedAt: new Date()
                });
            } catch (trackError) {
                console.error('Failed to track blocking activity:', trackError);
            }
        }
        
    } catch (error) {
        console.error('❌ Cleanup job error:', error);
    }
});

console.log('✅ Scheduled job initialized: Unverified user cleanup runs every hour');
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

app.use('/components', express.static(path.join(__dirname, 'public/components')));

const compression = require('compression');
app.use(compression());

// Trust proxy - Required for rate limiting behind reverse proxies
app.set('trust proxy', 1);
const cookieParser = require('cookie-parser');
app.use(cookieParser());

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

app.get('/dashboard-basic', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard-basic.html'));
});

app.get('/dashboard-free', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard-free.html'));
});

app.get('/dashboard-race', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard-race.html'));
});

// Catch-all for other static pages (e.g., /plans, /subscription)
app.get('/:page', (req, res) => {
  const filePath = path.join(__dirname, 'public', `${req.params.page}.html`);
  res.sendFile(filePath, (err) => {
    if (err) {
      console.error(`❌ File not found: ${filePath}`);
      res.status(404).json({ success: false, error: 'Page not found' });
    }
  });
});

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

// Global variables for Strava tokens
let storedTokens = {
  access_token: null,
  refresh_token: null
};

if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1); // Important for accurate IP detection behind proxy
}

// Security middleware (optional but recommended)
// In app.js - Replace your existing helmet configuration
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: [
        "'self'", 
        "'unsafe-inline'", 
        "https://fonts.googleapis.com",
        "https://cdnjs.cloudflare.com"
      ],
      fontSrc: [
        "'self'", 
        "data:", 
        "https://fonts.gstatic.com",
        "https://cdnjs.cloudflare.com"
      ],
      scriptSrc: [
        "'self'", 
        "'unsafe-inline'", 
        "'unsafe-eval'",
        "https://checkout.razorpay.com",
        "https://www.gstatic.com",
        "https://www.googletagmanager.com",
        "https://apis.google.com",
        "https://www.google.com/recaptcha/",
        "https://www.gstatic.com/recaptcha/",
        "https://www.recaptcha.net"
      ],
      scriptSrcAttr: ["'unsafe-inline'"],
      imgSrc: [
        "'self'", 
        "data:", 
        "https:", 
        "blob:",
        "https://cdn.razorpay.com"
      ],
      connectSrc: [
        "'self'",
        "https://www.strava.com",
        "https://generativelanguage.googleapis.com",
        "https://api.razorpay.com",
        "https://lumberjack.razorpay.com",
        "https://*.googleapis.com",
        "https://*.firebaseio.com",
        "https://*.cloudfunctions.net",
        "https://identitytoolkit.googleapis.com",
        "https://securetoken.googleapis.com",
        "https://www.gstatic.com",
        "https://www.google.com"
      ],
      frameSrc: [
        "'self'",
        "https://api.razorpay.com",
        "https://*.firebaseapp.com",
        "https://www.google.com",
        "https://www.recaptcha.net"
      ],
      formAction: [
        "'self'", 
        "https://api.razorpay.com"
      ]
    }
  },
  referrerPolicy: { policy: 'no-referrer' }
}));

app.use(cors({
  origin: process.env.NODE_ENV === 'production' 
    ? [process.env.WEB_ORIGIN, process.env.ADMIN_ORIGIN].filter(Boolean)
    : '*',
  credentials: true
}));
// Body parsing middleware


// Session configuration - PRODUCTION READY with Firebase Firestore
app.use(session({
  store: new FileStore({
    path: path.join(__dirname, 'sessions'), // Stored in your app directory
    ttl: 24 * 60 * 60, // 24 hours
    retries: 5,
    reapInterval: 60 * 60 // Clean up every hour
  }),
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 24 * 60 * 60 * 1000
  }
}));

// Apply limiters
app.use('/api/', apiLimiter); // ← Your rate limiter (general API)
app.use('/auth/', authLimiter); // Stricter for auth

// Initialize passport
app.use(passport.initialize());
app.use(passport.session());

// Add this helper function near the top of app.js





// Temporary admin endpoint - remove in production
app.post('/api/admin/block-user', async (req, res) => {
    try {
        const { email } = req.body;
        
        const user = await userManager.getUserByEmail(email);
        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }
        
        await userManager.updateUser(user.id, {
            active: false,
            blockedReason: 'Email not verified within 24 hours',
            blockedAt: new Date()
        });
        
        res.json({ 
            success: true, 
            message: 'User blocked successfully',
            email: email 
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Test email configuration endpoint
// Fixed test email configuration endpoint
app.get('/test-email-config', async (req, res) => {
    try {
        
        
        //console.log('📧 Testing email configuration...');
        //console.log('Host:', process.env.EMAIL_HOST);
        //console.log('Port:', process.env.EMAIL_PORT);
        //console.log('User:', process.env.ZOHO_EMAIL);
        //console.log('Password set:', !!process.env.ZOHO_PASSWORD);
        
        if (!process.env.ZOHO_EMAIL || !process.env.ZOHO_PASSWORD) {
            return res.json({
                success: false,
                error: 'Email credentials not configured',
                details: {
                    ZOHO_EMAIL: process.env.ZOHO_EMAIL ? 'Set' : 'Missing',
                    ZOHO_PASSWORD: process.env.ZOHO_PASSWORD ? 'Set' : 'Missing',
                    EMAIL_HOST: process.env.EMAIL_HOST || 'Missing',
                    EMAIL_PORT: process.env.EMAIL_PORT || 'Missing'
                }
            });
        }
        
        // Create transporter
        const transporter = nodemailer.createTransport({
            host: process.env.EMAIL_HOST,
            port: parseInt(process.env.EMAIL_PORT),
            secure: true,
            auth: {
                user: process.env.ZOHO_EMAIL,
                pass: process.env.ZOHO_PASSWORD
            },
            tls: {
                rejectUnauthorized: true,
                minVersion: 'TLSv1.2'
            }
        });

        // Verify connection
        console.log('🔍 Verifying SMTP connection...');
        await transporter.verify();
        console.log('✅ SMTP connection verified successfully');

        // Send test email
        console.log('📨 Sending test email...');
        const info = await transporter.sendMail({
            from: `"ZoneTrain Test" <${process.env.ZOHO_EMAIL}>`,
            to: process.env.ZOHO_EMAIL,
            subject: 'ZoneTrain Email Test - ' + new Date().toLocaleString(),
            text: 'If you receive this, your Zoho SMTP configuration is working!',
            html: '<b>✅ Success!</b><p>Your Zoho SMTP is working correctly!</p>'
        });

        console.log('✅ Test email sent:', info.messageId);
        
        res.json({
            success: true,
            message: 'Email sent successfully! Check your inbox at ' + process.env.ZOHO_EMAIL,
            messageId: info.messageId,
            config: {
                host: process.env.EMAIL_HOST,
                port: process.env.EMAIL_PORT,
                from: process.env.ZOHO_EMAIL
            }
        });

    } catch (error) {
        console.error('❌ Email test failed:', error);
        
        res.json({
            success: false,
            error: error.message,
            code: error.code,
            response: error.response,
            command: error.command,
            details: {
                EMAIL_HOST: process.env.EMAIL_HOST,
                EMAIL_PORT: process.env.EMAIL_PORT,
                ZOHO_EMAIL: process.env.ZOHO_EMAIL,
                ZOHO_PASSWORD_SET: !!process.env.ZOHO_PASSWORD
            }
        });
    }
});

// Add this temporarily to your app.js to verify env variables
//console.log('🔧 Email config check:');
//console.log('EMAIL_HOST:', process.env.EMAIL_HOST);
//console.log('EMAIL_PORT:', process.env.EMAIL_PORT);
//console.log('ZOHO_EMAIL:', process.env.ZOHO_EMAIL ? 'Set ✅' : 'Missing ❌');
//console.log('ZOHO_PASSWORD:', process.env.ZOHO_PASSWORD ? 'Set ✅' : 'Missing ❌');


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

  app.get('/login', apiLimiter, (req, res) => {
  const redirect = req.query.redirect || '';
  const error = req.query.error || '';
  
  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com https://cdnjs.cloudflare.com;">
    <title>Login - ZoneTrain</title>
    <link rel="stylesheet" href="css/cookies.css">
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

        * { 
            margin: 0; 
            padding: 0; 
            box-sizing: border-box; 
        }

        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background: linear-gradient(135deg, var(--deep-purple) 0%, var(--accent-purple) 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
        }

        .back-btn {
            position: fixed;
            top: 20px;
            left: 20px;
            display: flex;
            align-items: center;
            gap: 8px;
            color: white;
            text-decoration: none;
            font-size: 14px;
            font-weight: 600;
            padding: 10px 16px;
            background: rgba(255, 255, 255, 0.15);
            border-radius: 25px;
            backdrop-filter: blur(10px);
            transition: all 0.3s ease;
            z-index: 1000;
        }

        .back-btn:hover { 
            background: rgba(255, 255, 255, 0.25);
            transform: translateX(-3px);
        }

        .login-container {
            background: var(--white);
            border-radius: 20px;
            box-shadow: 0 20px 40px rgba(0, 0, 0, 0.3);
            padding: 40px;
            width: 100%;
            max-width: 450px;
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

        .form-group {
            margin-bottom: 20px;
        }

        label {
            display: block;
            margin-bottom: 8px;
            color: var(--dark-gray);
            font-weight: 500;
        }

        input[type="email"], 
        input[type="password"] {
            width: 100%;
            padding: 12px 15px;
            border: 2px solid #E5E7EB;
            border-radius: 10px;
            font-size: 1rem;
            transition: border-color 0.3s ease;
            font-family: inherit;
        }

        input:focus {
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

        .forgot-password a:hover { 
            text-decoration: underline; 
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
            font-family: inherit;
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

        .btn-primary:disabled {
            opacity: 0.7;
            cursor: not-allowed;
        }

        .btn-social {
            width: 100%;
            padding: 12px;
            background: white;
            border: 2px solid #E5E7EB;
            border-radius: 10px;
            font-size: 15px;
            font-weight: 600;
            color: #374151;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 10px;
            transition: all 0.3s ease;
            text-decoration: none;
            margin-bottom: 12px;
            font-family: inherit;
        }

        .btn-social:hover {
            transform: translateY(-2px);
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        }

        .btn-google:hover {
            background: #F9FAFB;
            border-color: #D1D5DB;
        }

        .btn-facebook {
            border-color: #1877F2;
        }

        .btn-facebook:hover {
            background: #EFF6FF;
            border-color: #1877F2;
        }

        .btn-phone {
            border-color: #10B981;
        }

        .btn-phone:hover {
            background: #ECFDF5;
            border-color: #10B981;
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

        .signup-section {
            text-align: center;
            margin-top: 25px;
            padding: 18px;
            background: #F3F4F6;
            border-radius: 12px;
        }

        .signup-section p {
            margin: 0;
            color: #6B7280;
            font-size: 14px;
        }

        .signup-section a {
            color: var(--accent-purple);
            text-decoration: none;
            font-weight: 600;
        }

        .signup-section a:hover {
            text-decoration: underline;
        }

        .cookie-links {
            display: flex;
            justify-content: center;
            gap: 20px;
            margin-top: 20px;
            padding-top: 20px;
            border-top: 1px solid #E5E7EB;
        }

        .cookie-links a {
            color: var(--accent-purple);
            text-decoration: none;
            font-size: 12px;
            font-weight: 500;
        }

        .cookie-links a:hover {
            text-decoration: underline;
        }

        .error-message {
            padding: 12px;
            margin-bottom: 20px;
            border-radius: 8px;
            font-size: 14px;
            display: none;
            line-height: 1.6;
        }

        .error-message.error {
            background: #FEE2E2;
            color: var(--error-red);
            display: block;
        }

        .error-message.success {
            background: #D1FAE5;
            color: var(--success-green);
            display: block;
        }

        .error-message.urgent {
            background: linear-gradient(135deg, #FEF3C7 0%, #FDE68A 100%);
            color: #92400E;
            border: 1px solid #F59E0B;
            animation: pulse-warning 2s infinite;
            display: block;
        }

        @keyframes pulse-warning {
            0%, 100% {
                transform: scale(1);
                box-shadow: 0 4px 6px rgba(245, 158, 11, 0.1);
            }
            50% {
                transform: scale(1.02);
                box-shadow: 0 6px 12px rgba(245, 158, 11, 0.3);
            }
        }

        @media screen and (max-width: 768px) {
            body { padding: 15px; }
            .login-container { padding: 35px 30px; }
            .back-btn { top: 15px; left: 15px; padding: 9px 14px; font-size: 13px; }
        }

        @media screen and (max-width: 576px) {
            body { padding: 10px; }
            .back-btn { top: 12px; left: 12px; padding: 8px 12px; }
            .login-container { padding: 30px 20px; border-radius: 15px; }
            .cookie-links { flex-direction: column; gap: 12px; }
        }

        @media screen and (max-width: 400px) {
            .back-btn { top: 10px; left: 10px; padding: 7px 10px; font-size: 12px; }
            .login-container { padding: 25px 18px; }
        }
    </style>
</head>
<body>
    <a href="/" class="back-btn">
        <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"/>
        </svg>
        Back
    </a>

    <div class="login-container">
        <h1>🏃 ZoneTrain</h1>
        <h2>Welcome Back</h2>

        <div id="errorMessage" class="error-message"></div>

        <!-- Social Login Buttons -->
        <a href="/auth/google" class="btn-social btn-google">
            <svg width="18" height="18" viewBox="0 0 18 18">
                <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z"/>
                <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.258c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332C2.438 15.983 5.482 18 9 18z"/>
                <path fill="#FBBC05" d="M3.964 10.707c-.18-.54-.282-1.117-.282-1.707s.102-1.167.282-1.707V4.96H.957C.347 6.175 0 7.55 0 9s.348 2.825.957 4.04l3.007-2.333z"/>
                <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0 5.482 0 2.438 2.017.957 4.96L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"/>
            </svg>
            Continue with Google
        </a>

        <a href="/auth/facebook" class="btn-social btn-facebook">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="#1877F2">
                <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
            </svg>
            Continue with Facebook
        </a>

        <a href="/phone-login" class="btn-social btn-phone">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#10B981" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"/>
            </svg>
            Continue with Phone
        </a>

        <div class="divider"><span>OR</span></div>

        <!-- Email/Password Login Form -->
        <form id="loginForm">
            <div class="form-group">
                <label for="email">Email Address</label>
                <input type="email" id="email" name="email" required autocomplete="email">
            </div>

            <div class="form-group">
                <label for="password">Password</label>
                <input type="password" id="password" name="password" required autocomplete="current-password">
                <div class="forgot-password">
                    <a href="/forgot-password">Forgot Password?</a>
                </div>
            </div>

            <button type="submit" class="btn btn-primary">Sign In</button>
        </form>

        <div class="signup-section">
            <p>Don't have an account? <a href="/signup">Sign Up Here</a></p>
        </div>

        <div class="cookie-links">
            <a href="/privacy">Privacy Policy</a>
            <a href="/cookie-policy">Cookie Policy</a>
        </div>
    </div>

    <script>
// Check if already logged in
(function() {
    const userToken = localStorage.getItem('userToken');
    const userEmail = localStorage.getItem('userEmail');
    if (userToken && userEmail) {
        window.location.href = '/dashboard';
    }
})();

// Show error message from URL params
window.addEventListener('DOMContentLoaded', function() {
    const urlParams = new URLSearchParams(window.location.search);
    const error = urlParams.get('error');
    
    const errorMessages = {
    'auth_required': 'Authentication required. Please login to continue.',
        'session_expired': 'Your session has expired. Please login again.',
        'token_invalid': 'Your login token is invalid. Please login again.',
        'token_corrupted': '⚠️ Login session corrupted. Please clear your browser cache and login again.',
        'token_tampered': '🚨 Security alert: Your session may have been tampered with. Please login again.',
        'token_early': 'Session not yet valid. Please check your system time and login again.',
        'no_token': 'No authentication found. Please login.',
        'facebook-failed': 'Facebook login failed. Please try again.',
        'facebook-no-email': 'Facebook did not provide your email. Please allow email access or use another login method.',
        'facebook-callback-failed': 'Facebook login callback failed. Please try again.',
        'google-failed': 'Google login failed. Please try again.',
        'google-no-email': 'Google did not provide your email. Please allow email access or use another login method.',
        'google-callback-failed': 'Google login callback failed. Please try again.',
        'phone-failed': 'Phone authentication failed. Please try again.',
        'session-expired': 'Your session expired. Please login again.',
        'auth-failed': 'Authentication failed. Please try again.',
        'oauth_failed': 'Social login failed. Please try again or use email/password.',
        'account-blocked': 'Your account has been blocked. Please contact support.',
        'email-not-verified': 'Please verify your email address to continue.'
    };
    
    if (error && errorMessages[error]) {
        showMessage(errorMessages[error], 'error');

        if (error === 'token_corrupted' || error === 'token_tampered') {
            localStorage.clear();
            console.log('🧹 Cleared localStorage due to token issue');
        }
    }
});

// Login form handler
// In your login.html <script> section - IMPROVED VERSION
document.getElementById('loginForm').addEventListener('submit', async function(e) {
    e.preventDefault();
    
    const submitButton = e.target.querySelector('button[type="submit"]');
    const originalText = submitButton.textContent;
    submitButton.disabled = true;
    submitButton.textContent = 'Signing in...';
    
    const formData = new FormData(e.target);
    const loginData = {
        email: formData.get('email'),
        password: formData.get('password')
    };

    try {
        console.log('🔄 Login attempt for:', loginData.email);
        
        const response = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json' 
            },
            credentials: 'include',
            body: JSON.stringify(loginData)
        });

        const result = await response.json();
        console.log('📋 Login response received');
        console.log('   Success:', result.success);
        //console.log('   Has token:', !!result.token);

        // ✅ FIX 1: Check response.ok first, BEFORE checking result.success
        if (!response.ok) {
            console.error('❌ HTTP error:', response.status, response.statusText);
            
            if (result.blocked) {
                showMessage('🚫 Account Blocked: ' + result.message, 'error');
            } else {
                showMessage(result.message || 'Login failed. Please check your credentials.', 'error');
            }
            
            submitButton.disabled = false;
            submitButton.textContent = originalText;
            return;
        }

        if (result.success) {
            // ✅ FIX 2: Validate token exists and is not empty/null before saving
            if (!result.token || result.token === 'null' || result.token === 'undefined') {
                console.error('❌ CRITICAL: No valid token in response!');
                //console.log('   Token value:', result.token);
                //console.log('   Full response:', result);
                showMessage('Login failed: Server did not provide authentication token', 'error');
                submitButton.disabled = false;
                submitButton.textContent = originalText;
                return;
            }

            // ✅ FIX 3: Validate token structure before saving
            const tokenParts = result.token.split('.');
            if (tokenParts.length !== 3) {
                console.error('❌ Token structure invalid!');
                // console.log('   Expected 3 parts, got:', tokenParts.length);
                // console.log('   Token:', result.token);
                showMessage('Login failed: Invalid authentication token received', 'error');
                submitButton.disabled = false;
                submitButton.textContent = originalText;
                return;
            }

            // ✅ Save all user data to localStorage
            console.log('💾 Saving authentication data...');
            //console.log('   Token length:', result.token.length);
            //console.log('   Token preview:', result.token.substring(0, 30) + '...');
            //console.log('   Token structure: Valid (3 parts)');

            localStorage.setItem('userToken', result.token);
            localStorage.setItem('userId', result.user.id);
            localStorage.setItem('userEmail', result.user.email);
            localStorage.setItem('userName', result.user.firstName || 'User');
            localStorage.setItem('userType', result.userType || 'free');
            localStorage.setItem('subscriptionStatus', result.user.subscriptionStatus || 'free');
            localStorage.setItem('currentPlan', result.user.currentPlan || 'free');
            localStorage.setItem('userInfo', JSON.stringify(result.user));

            // ✅ Verify token was saved correctly
            const savedToken = localStorage.getItem('userToken');
            if (savedToken !== result.token) {
                console.error('❌ CRITICAL: Token save verification failed!');
                //console.log('   Expected:', result.token.substring(0, 30) + '...');
                //console.log('   Got:', savedToken?.substring(0, 30) + '...');
                showMessage('Login failed: Could not save authentication', 'error');
                submitButton.disabled = false;
                submitButton.textContent = originalText;
                return;
            }

            console.log('✅ Token saved and verified successfully');

            // Email verification check
            if (result.requiresVerification) {
                console.log('⚠️ Email verification required');
                
                let warningMessage = result.message || 'Please verify your email address.';
                
                if (result.hoursRemaining !== undefined) {
                    if (result.hoursRemaining === 0) {
                        warningMessage = '🚨 URGENT: Your account will be blocked soon! Verify your email immediately.';
                    } else if (result.hoursRemaining < 2) {
                        warningMessage = "⚠️ URGENT: Only " + result.hoursRemaining + " hour(s) left to verify your email!";
                    } else {
                        warningMessage = "⏰ Please verify your email within " + result.hoursRemaining + " hours.";
                    }
                }
                
                showMessage(warningMessage, 'urgent');
                
                setTimeout(function() {
                    console.log('🔄 Redirecting to email verification...');
                    window.location.href = result.redirect || '/dashboard?verify=required';
                }, 2000);
                
                return;
            }

            // ✅ Verified email - normal login
            const urlParams = new URLSearchParams(window.location.search);
            const redirectParam = urlParams.get('redirect');

            showMessage('✅ Welcome back! Redirecting...', 'success');

            setTimeout(function() {
                console.log('🔄 Login complete, redirecting...');
                
                // Determine dashboard based on plan
                let dashboardUrl = '/dashboard';
                const currentPlan = result.user.currentPlan || 'free';
                
                if (redirectParam === 'plans') {
                    dashboardUrl = '/plans.html';
                } else if (result.redirect) {
                    dashboardUrl = result.redirect;
                } else if (currentPlan === 'race') {
                    dashboardUrl = '/dashboard-race.html';
                } else {
                    dashboardUrl = '/dashboard';
                }
                
                console.log('   Target URL:', dashboardUrl);
                window.location.href = dashboardUrl;
            }, 1000);
            
        } else {
            // result.success is false
            console.error('❌ Login failed:', result.message);
            
            if (result.blocked) {
                showMessage('🚫 Account Blocked: ' + result.message, 'error');
            } else {
                showMessage(result.message || 'Login failed. Please check your credentials.', 'error');
            }
            
            submitButton.disabled = false;
            submitButton.textContent = originalText;
        }
        
    } catch (error) {
        console.error('❌ Login error:', error);
        console.log('   Error name:', error.name);
        console.log('   Error message:', error.message);
        showMessage('❌ Login failed: ' + error.message, 'error');
        submitButton.disabled = false;
        submitButton.textContent = originalText;
    }
});

// Enhanced message display
function showMessage(message, type) {
    const errorDiv = document.getElementById('errorMessage');
    if (!errorDiv) {
        console.error('❌ Error message div not found!');
        alert(message); // Fallback to alert
        return;
    }
    
    errorDiv.textContent = message;
    errorDiv.className = 'error-message ' + type;
    errorDiv.style.display = 'block';
    
    console.log('📢 Message displayed:', type.toUpperCase(), '-', message);
    
    // Auto-hide only success messages
    if (type === 'success') {
        setTimeout(function() {
            errorDiv.style.display = 'none';
        }, 3000);
    }
}


    </script>

    <!-- Cookie Banner -->
    <script src="js/cookies.js"></script>
</body>
</html>
  `;
  res.send(html);
});


app.get('/signup', apiLimiter, (req, res) => {
  const redirect = req.query.redirect || '';
  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Sign Up - ZoneTrain</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background: linear-gradient(135deg, #6B46C1 0%, #8B5CF6 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
        }

        .back-btn {
            position: fixed;
            top: 20px;
            left: 20px;
            display: flex;
            align-items: center;
            gap: 6px;
            padding: 10px 18px;
            background: rgba(255, 255, 255, 0.15);
            color: white;
            text-decoration: none;
            border-radius: 25px;
            font-size: 14px;
            font-weight: 600;
            backdrop-filter: blur(10px);
            transition: all 0.3s ease;
            z-index: 1000;
            border: none;
            cursor: pointer;
        }

        .back-btn:hover {
            background: rgba(255, 255, 255, 0.25);
            transform: translateX(-3px);
        }

        .signup-container {
            background: white;
            border-radius: 20px;
            box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
            padding: 40px;
            width: 100%;
            max-width: 500px;
        }

        .logo-text {
            text-align: center;
            font-size: 32px;
            font-weight: 700;
            background: linear-gradient(135deg, #6B46C1, #8B5CF6);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            margin-bottom: 8px;
        }

        .welcome-text {
            text-align: center;
            font-size: 22px;
            color: #1F2937;
            margin-bottom: 30px;
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
            margin-bottom: 6px;
            color: #374151;
            font-weight: 500;
            font-size: 14px;
        }

        input {
            width: 100%;
            padding: 12px 15px;
            border: 2px solid #E5E7EB;
            border-radius: 10px;
            font-size: 15px;
            transition: all 0.3s ease;
        }

        input:focus {
            outline: none;
            border-color: #8B5CF6;
            box-shadow: 0 0 0 3px rgba(139, 92, 246, 0.1);
        }

        .password-requirements {
            font-size: 12px;
            color: #6B7280;
            margin-top: 5px;
        }

        .btn-submit {
            width: 100%;
            padding: 14px;
            background: linear-gradient(135deg, #6B46C1, #8B5CF6);
            color: white;
            border: none;
            border-radius: 10px;
            font-size: 16px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.3s ease;
            margin-top: 10px;
        }

        .btn-submit:hover {
            transform: translateY(-2px);
            box-shadow: 0 8px 20px rgba(107, 70, 193, 0.4);
        }

        .btn-submit:disabled {
            opacity: 0.6;
            cursor: not-allowed;
        }

        .terms-agreement {
            font-size: 12px;
            color: #6B7280;
            margin-bottom: 15px;
            line-height: 1.5;
        }

        .terms-agreement a {
            color: #8B5CF6;
            text-decoration: none;
        }

        .divider {
            display: flex;
            align-items: center;
            margin: 25px 0;
            color: #9CA3AF;
            font-size: 13px;
        }

        .divider::before, .divider::after {
            content: '';
            flex: 1;
            border-bottom: 1px solid #E5E7EB;
        }

        .divider span { padding: 0 15px; }

        .btn-social {
            width: 100%;
            padding: 12px;
            background: white;
            border: 2px solid #E5E7EB;
            border-radius: 10px;
            font-size: 15px;
            font-weight: 600;
            color: #374151;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 10px;
            transition: all 0.3s ease;
            text-decoration: none;
            margin-bottom: 12px;
        }

        .btn-social:hover {
            background: #F9FAFB;
            border-color: #D1D5DB;
        }

        .btn-facebook {
            border-color: #1877F2;
        }

        .btn-facebook:hover {
            background: #EFF6FF;
            border-color: #1877F2;
        }

        .btn-phone {
            border-color: #10B981;
        }

        .btn-phone:hover {
            background: #ECFDF5;
            border-color: #10B981;
        }

        .login-section {
            text-align: center;
            margin-top: 25px;
            padding: 18px;
            background: #F3F4F6;
            border-radius: 12px;
        }

        .login-section p {
            margin: 0;
            color: #6B7280;
            font-size: 14px;
        }

        .login-section a {
            color: #8B5CF6;
            font-weight: 600;
            text-decoration: none;
        }

        .login-section a:hover {
            text-decoration: underline;
        }

        .error-message, .success-message {
            display: none;
            padding: 12px;
            margin-bottom: 20px;
            border-radius: 8px;
            font-size: 14px;
        }

        .error-message {
            background: #FEE2E2;
            color: #DC2626;
            border: 1px solid #DC2626;
        }

        .success-message {
            background: #D1FAE5;
            color: #059669;
            border: 1px solid #059669;
        }

        @media (max-width: 576px) {
            .signup-container { padding: 30px 20px; }
            .back-btn { top: 15px; left: 15px; font-size: 13px; padding: 8px 14px; }
            .logo-text { font-size: 28px; }
            .welcome-text { font-size: 20px; }
            .form-row { flex-direction: column; gap: 0; }
        }
    </style>
</head>
<body>
    <a href="/" class="back-btn">
        <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"/>
        </svg>
        Back
    </a>

    <div class="signup-container">
        <div class="logo-text">ZoneTrain</div>
        <h2 class="welcome-text">Create Your Account</h2>

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
                <input type="password" id="password" name="password" required>
                <div class="password-requirements">
                    At least 8 characters with uppercase, lowercase, and number
                </div>
            </div>

            <div class="form-group">
                <label for="confirmPassword">Confirm Password</label>
                <input type="password" id="confirmPassword" name="confirmPassword" required>
            </div>

            <div class="terms-agreement">
                By creating an account, you agree to our 
                <a href="/terms" target="_blank">Terms of Service</a> and 
                <a href="/privacy" target="_blank">Privacy Policy</a>.
            </div>

            <button type="submit" class="btn-submit">Create Account</button>
        </form>

        <div class="divider"><span>OR</span></div>

        <a href="/auth/google" class="btn-social">
            <svg width="18" height="18" viewBox="0 0 18 18">
                <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z"/>
                <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.258c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332C2.438 15.983 5.482 18 9 18z"/>
                <path fill="#FBBC05" d="M3.964 10.707c-.18-.54-.282-1.117-.282-1.707s.102-1.167.282-1.707V4.96H.957C.347 6.175 0 7.55 0 9s.348 2.825.957 4.04l3.007-2.333z"/>
                <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0 5.482 0 2.438 2.017.957 4.96L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"/>
            </svg>
            Continue with Google
        </a>

        <a href="/auth/facebook" class="btn-social btn-facebook">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="#1877F2">
                <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
            </svg>
            Continue with Facebook
        </a>

        <a href="/phone-login" class="btn-social btn-phone">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#10B981" stroke-width="2">
                <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path>
            </svg>
            Continue with Phone
        </a>

        <div class="login-section">
            <p>Already have an account? <a href="/login" id="login-link">Login Here</a></p>
        </div>
    </div>

    <script>
    (function() {
        const userToken = localStorage.getItem('userToken');
        const userEmail = localStorage.getItem('userEmail');
        if (userToken && userEmail) {
            window.location.href = '/dashboard';
        }
    })();

    
document.getElementById('signupForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const formData = new FormData(e.target);
    const password = formData.get('password');
    const confirmPassword = formData.get('confirmPassword');
    
    if (password !== confirmPassword) {
        showError('Passwords do not match');
        return;
    }
    
    if (!isValidPassword(password)) {
        showError('Password must be at least 8 characters with uppercase, lowercase, and number');
        return;
    }
    
    const signupData = {
        firstName: formData.get('firstName'),
        lastName: formData.get('lastName'),
        email: formData.get('email'),
        phoneNumber: formData.get('phoneNumber') || null,
        password: password,
        provider: 'email'
    };
    
    const submitButton = document.querySelector('#signupForm button[type="submit"]');
    const originalButtonText = submitButton.textContent;
    submitButton.disabled = true;
    submitButton.textContent = 'Creating account...';
    
    try {
        console.log('📝 Attempting signup for:', signupData.email);
        
        const response = await fetch('/api/signup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include', // ✅ CRITICAL: Include cookies
            body: JSON.stringify(signupData)
        });
        
        const result = await response.json();
        console.log('✅ Signup response:', result.success);
        
        if (result.success) {
            console.log('✅ Signup successful');
            
            // ✅ Save token and user data
            localStorage.setItem('userEmail', signupData.email);
            localStorage.setItem('userName', signupData.firstName);
            localStorage.setItem('userToken', result.token);
            localStorage.setItem('userId', result.user.id);
            localStorage.setItem('subscriptionStatus', result.user.subscriptionStatus || 'free');
            
            if (result.emailVerificationSent) {
                showSuccess('✅ Account created! Check your email to verify. Redirecting...');
            } else {
                showSuccess('✅ Account created successfully! Redirecting...');
            }
            
            setTimeout(() => {
                console.log('🔄 Signup complete, redirecting...');
                window.history.replaceState({}, document.title, '/signup');
                window.location.href = result.redirect || '/dashboard';
            }, 3000);
            
        } else {
            console.error('❌ Signup failed:', result.message);
            
            if (result.message.includes('already exists')) {
                showError('An account with this email already exists. Please login instead.');
            } else if (result.message.includes('domain does not exist')) {
                showError('Please use a valid email address. The email domain does not exist.');
            } else if (result.message.includes('Disposable email')) {
                showError('Disposable email addresses are not allowed.');
            } else {
                showError(result.message);
            }
            
            submitButton.disabled = false;
            submitButton.textContent = originalButtonText;
        }
        
    } catch (error) {
        console.error('❌ Signup error:', error);
        showError('Signup failed: ' + error.message);
        submitButton.disabled = false;
        submitButton.textContent = originalButtonText;
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
    if (successDiv) successDiv.style.display = 'none';
    errorDiv.textContent = message;
    errorDiv.style.display = 'block';
    console.error('❌ Error:', message);
}

function showSuccess(message) {
    const errorDiv = document.getElementById('errorMessage');
    const successDiv = document.getElementById('successMessage');
    if (errorDiv) errorDiv.style.display = 'none';
    successDiv.textContent = message;
    successDiv.style.display = 'block';
    console.log('✅ Success:', message);
}
    </script>
</body>
</html>
  `;
  res.send(html);
});


// Make sure this route exists and works correctly
app.get('/strava-connect', (req, res) => {
    const userToken = req.query.userToken;
    //console.log('🔗 Strava connect request, userToken:', userToken ? 'Present' : 'Missing');
    
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
        //console.log('✅ Got tokens:', !!access_token, !!refresh_token);
        
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

// Phone login page route
app.get('/phone-login', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'phone-login.html'));
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

// Get calendar workouts
app.get('/api/workouts/calendar', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        
        // Get workouts for current month ± 1 month
        const startDate = new Date();
        startDate.setMonth(startDate.getMonth() - 1);
        startDate.setDate(1);
        
        const endDate = new Date();
        endDate.setMonth(endDate.getMonth() + 2);
        endDate.setDate(0);

        const workoutsSnapshot = await db.collection('workouts')
            .where('userId', '==', userId)
            .where('date', '>=', startDate)
            .where('date', '<=', endDate)
            .get();

        const workouts = workoutsSnapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data(),
            date: doc.data().date.toDate ? doc.data().date.toDate().toISOString() : doc.data().date
        }));

        res.json({
            success: true,
            workouts
        });
    } catch (error) {
        console.error('Calendar error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

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

// Weather API - Using Google Maps Platform Weather API
app.get('/api/weather', authenticateToken, async (req, res) => {
    try {
        const { lat, lon } = req.query;
        
        if (!lat || !lon) {
            return res.status(400).json({ 
                success: false, 
                message: 'Location coordinates required' 
            });
        }

        console.log(`🌤️ Fetching weather from Google Weather API for lat:${lat}, lon:${lon}`);

        const GOOGLE_WEATHER_API_KEY = process.env.GOOGLE_WEATHER_API_KEY || process.env.GOOGLE_MAPS_API_KEY;
        
        if (!GOOGLE_WEATHER_API_KEY) {
            console.error('❌ No Google Weather API key found');
            return res.status(500).json({ 
                success: false, 
                message: 'Weather API key not configured' 
            });
        }

        // Google Weather API endpoint for current conditions
      
        const weatherUrl = `https://weather.googleapis.com/v1/currentConditions:lookup?key=${GOOGLE_WEATHER_API_KEY}&location.latitude=${lat}&location.longitude=${lon}&unitsSystem=METRIC`;
        
        const response = await axios.get(weatherUrl);
        const data = response.data;
        
        // Parse Google Weather API response
        const weatherData = {
            temperature: Math.round(data.temperature.degrees),
            condition: data.weatherCondition.description.text,
            description: data.weatherCondition.description.text.toLowerCase(),
            humidity: data.relativeHumidity,
            windSpeed: Math.round(data.wind.speed.value), // Already in km/h
            icon: data.weatherCondition.type.toLowerCase(), // CLOUDY, RAINY, SUNNY, etc.
            feelsLike: Math.round(data.feelsLikeTemperature.degrees),
            uvIndex: data.uvIndex || 0,
            visibility: data.visibility?.distance || 10,
            cloudCover: data.cloudCover || 0
        };
        
        console.log('✅ Real weather data from Google:', weatherData);
        
        return res.json({ 
            success: true, 
            weather: weatherData,
            mock: false 
        });
        
    } catch (error) {
        console.error('❌ Google Weather API error:', error.response?.data || error.message);
        
        // Return fallback mock data on error
        res.json({ 
            success: true, 
            weather: {
                temperature: 22,
                condition: 'Partly Cloudy',
                description: 'partly cloudy',
                humidity: 65,
                windSpeed: 12,
                icon: 'cloudy',
                feelsLike: 21,
                uvIndex: 3,
                visibility: 10,
                cloudCover: 50
            },
            mock: true,
            error: error.message
        });
    }
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

/**
 * Calculate running pace (min:sec per km)
 * @param {string} distance - Race distance ('5k', '10k', 'half_marathon', 'marathon')
 * @param {string} time - Time in HH:MM:SS format
 * @returns {string} Pace in MM:SS/km format
 */
/**
 * Calculate pace - flexible for both use cases
 * 
 * @param {number|string} distance - Distance in km OR preset ('5k', '10k', 'half_marathon', 'marathon')
 * @param {string} time - Time in HH:MM:SS format
 * @param {string} format - Output format: 'numeric' or 'formatted' (default: 'formatted')
 * 
 * @returns {number|string} - Pace per km as number or formatted string
 */
function calculatePace(distance, time, format = 'formatted') {
    try {
        // ========== STEP 1: Normalize distance ==========
        let distanceKm;
        
        if (typeof distance === 'string') {
            // Handle preset distances
            const presets = {
                '5k': 5,
                '10k': 10,
                'half_marathon': 21.1,
                'marathon': 42.2
            };
            distanceKm = presets[distance.toLowerCase()] || parseFloat(distance);
        } else {
            distanceKm = parseFloat(distance);
        }
        
        if (!distanceKm || distanceKm <= 0) {
            throw new Error('Invalid distance');
        }
        
        // ========== STEP 2: Parse time string ==========
        const timeParts = time.split(':').map(Number);
        
        if (timeParts.length < 2) {
            throw new Error('Time format should be HH:MM:SS or MM:SS');
        }
        
        const hours = timeParts.length === 3 ? timeParts[0] : 0;
        const minutes = timeParts.length === 3 ? timeParts[1] : timeParts[0];
        const seconds = timeParts.length === 3 ? timeParts[2] : timeParts[1];
        
        const totalMinutes = hours * 60 + minutes + seconds / 60;
        
        // ========== STEP 3: Calculate pace ==========
        const paceMinPerKm = totalMinutes / distanceKm;
        
        // ========== STEP 4: Format output ==========
        if (format === 'numeric') {
            // Return as decimal number (e.g., 5.25)
            return parseFloat(paceMinPerKm.toFixed(2));
        } else {
            // Return as formatted string (e.g., "5:15/km")
            const paceMinutes = Math.floor(paceMinPerKm);
            const paceSeconds = Math.round((paceMinPerKm - paceMinutes) * 60);
            
            return `${paceMinutes}:${paceSeconds.toString().padStart(2, '0')}/km`;
        }
        
    } catch (error) {
        console.error('Error calculating pace:', error);
        return format === 'numeric' ? 0 : 'N/A';
    }
}

/**
 * Additional helper: Get pace category/intensity level
 */
function getPaceCategory(pacePerKm) {
    try {
        const pace = typeof pacePerKm === 'string' 
            ? parseFloat(pacePerKm) 
            : pacePerKm;
        
        if (pace <= 4.5) return 'Elite';
        if (pace <= 5.5) return 'Fast';
        if (pace <= 6.5) return 'Moderate';
        if (pace <= 7.5) return 'Easy';
        return 'Recovery';
    } catch (e) {
        return 'Unknown';
    }
}

/**
 * Convert pace string to numeric value
 * Usage: "5:30/km" → 5.5
 */
function parsePaceToNumeric(paceString) {
    try {
        const [minutes, seconds] = paceString.split(':').map(Number);
        return minutes + seconds / 60;
    } catch (e) {
        return 0;
    }
}

/**
 * Format numeric pace to string
 * Usage: 5.5 → "5:30/km"
 */
function formatPaceToString(numericPace) {
    try {
        const minutes = Math.floor(numericPace);
        const seconds = Math.round((numericPace - minutes) * 60);
        return `${minutes}:${seconds.toString().padStart(2, '0')}/km`;
    } catch (e) {
        return 'N/A';
    }
}


// Save AI onboarding data
app.post('/api/ai-onboarding', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        const onboardingData = req.body;
        const planType = onboardingData.planType || 'race';
        
        console.log('🤖 Saving AI onboarding data for user:', userId, `(${planType})`);
        
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
                    pace: calculatePace(onboardingData.pb_distance, onboardingData.pb_time, 'numeric')
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

            // Location
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
        
        // Save AI profile
        await db.collection('aiprofiles').doc(userId).set(aiProfile);
        console.log('✅ AI profile saved');

        // Initialize notification preferences if missing
        const userDoc = await db.collection('users').doc(userId).get();
        
        if (!userDoc.data().notificationPreferences) {
            const defaultPreferences = {
                email: true,
                workout: true,
                payment: true,
                recovery: true,
                upgrade: true,
                race: true
            };
            
            await db.collection('users').doc(userId).update({
                notificationPreferences: defaultPreferences
            });
            
            console.log(`✅ Notification preferences initialized`);
        }

        // Update user record (non-critical)
        try {
            await userManager.updateUser(userId, {
                aiOnboardingCompleted: true,
                planType: planType,
                aiProfileCreatedAt: new Date().toISOString()
            });
            console.log('✅ User record updated');
        } catch (userUpdateError) {
            console.warn('⚠️ User update failed (non-critical):', userUpdateError.message);
        }

        // Generate initial training plan
        console.log(`🎯 Generating ${planType} training plan...`);
        let trainingPlan;
        
        try {
            trainingPlan = await generateInitialTrainingPlan(aiProfile, planType);
        } catch (planError) {
            console.error('⚠️ Plan generation failed, using fallback');
            trainingPlan = {
                type: 'fallback_error',
                error: planError.message,
                generatedAt: new Date().toISOString()
            };
        }
        
        // Save training plan
        const planDoc = await db.collection('trainingplans').add({
            userId: userId,
            profileId: userId,
            planType: planType,
            planData: trainingPlan,
            isActive: true,
            createdAt: new Date(),
            version: 'v1'
        });
        
        console.log('✅ Training plan saved:', planDoc.id);

        // Track analytics
        try {
            await db.collection('analytics_events').add({
                event: 'ai_onboarding_completed',
                userId: userId,
                planType: planType,
                data: {
                    targetDistance: onboardingData.target_distance,
                    daysToRace: calculateDaysToRace(onboardingData.target_date),
                    weeklyMileage: onboardingData.weekly_mileage,
                    intensityPreference: onboardingData.intensity_preference
                },
                timestamp: new Date(),
                source: 'ai_onboarding_system'
            });
        } catch (analyticsError) {
            console.warn('⚠️ Analytics tracking failed (non-critical):', analyticsError.message);
        }
        
        console.log('✅ AI onboarding completed successfully for user:', userId);
        
        res.json({
            success: true,
            message: 'AI coaching profile created successfully',
            userId: userId,
            trainingPlanId: planDoc.id,
            planType: planType,
            nextStep: 'training_plan_generated'
        });
        
    } catch (error) {
        console.error('❌ AI onboarding error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to complete AI onboarding setup',
            error: error.message
        });
    }
});

// ==================== UPDATE RACE GOALS & REGENERATE PLAN ====================

/**
 * Update race goals and regenerate training plan
 * POST /api/race-goals/update
 * 
 * This endpoint allows users to update their race goals and automatically
 * regenerates a new training plan based on the updated information
 */
app.post('/api/race-goals/update', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        const { targetDistance, targetDate, targetTime, newGoals, constraints } = req.body;
        
        console.log('🎯 Updating race goals for user:', userId);
        
        // Validate at least one field is provided
        if (!targetDistance && !targetDate && !targetTime && !newGoals) {
            return res.status(400).json({
                success: false,
                message: 'Please provide at least one field to update (targetDistance, targetDate, targetTime, or newGoals)'
            });
        }
        
        // Get current AI profile
        const profileDoc = await db.collection('aiprofiles').doc(userId).get();
        
        if (!profileDoc.exists) {
            return res.status(404).json({
                success: false,
                message: 'AI profile not found. Please complete onboarding first.'
            });
        }
        
        const currentProfile = profileDoc.data();
        
        // ========== STEP 1: UPDATE AI PROFILE WITH NEW GOALS ==========
        const updatedProfile = {
            ...currentProfile,
            raceHistory: {
                ...currentProfile.raceHistory,
                targetRace: {
                    ...currentProfile.raceHistory.targetRace,
                    distance: targetDistance || currentProfile.raceHistory.targetRace.distance,
                    targetTime: targetTime || currentProfile.raceHistory.targetRace.targetTime,
                    raceDate: targetDate || currentProfile.raceHistory.targetRace.raceDate,
                    daysToRace: targetDate ? calculateDaysToRace(targetDate) : currentProfile.raceHistory.targetRace.daysToRace
                }
            },
            trainingStructure: {
                ...currentProfile.trainingStructure,
                constraints: constraints || currentProfile.trainingStructure.constraints
            },
            updatedAt: new Date()
        };
        
        // Save updated profile
        await db.collection('aiprofiles').doc(userId).update(updatedProfile);
        console.log('✅ Race goals updated');
        
        // ========== STEP 2: REGENERATE TRAINING PLAN ==========
        console.log('🤖 Regenerating training plan with updated goals...');
        
        // Get current plan type
        const currentPlanDoc = await db.collection('trainingplans')
            .where('userId', '==', userId)
            .where('isActive', '==', true)
            .limit(1)
            .get();
        
        const planType = currentPlanDoc.empty ? 'race' : currentPlanDoc.docs[0].data().planType;
        
        let newTrainingPlan;
        try {
            newTrainingPlan = await generateInitialTrainingPlan(updatedProfile, planType);
        } catch (planError) {
            console.error('⚠️ Plan regeneration failed:', planError.message);
            newTrainingPlan = {
                type: 'fallback_error',
                error: planError.message,
                generatedAt: new Date().toISOString()
            };
        }
        
        // ========== STEP 3: DEACTIVATE OLD PLAN ==========
        if (!currentPlanDoc.empty) {
            await db.collection('trainingplans')
                .doc(currentPlanDoc.docs[0].id)
                .update({
                    isActive: false,
                    deactivatedAt: new Date(),
                    deactivationReason: 'Goals updated'
                });
            console.log('✅ Old plan deactivated');
        }
        
        // ========== STEP 4: SAVE NEW PLAN ==========
        const newPlanDoc = await db.collection('trainingplans').add({
            userId: userId,
            profileId: userId,
            planType: planType,
            planData: newTrainingPlan,
            isActive: true,
            createdAt: new Date(),
            version: 'v1',
            reason: 'Goals updated',
            previousGoals: {
                distance: currentProfile.raceHistory.targetRace.distance,
                date: currentProfile.raceHistory.targetRace.raceDate,
                daysToRace: currentProfile.raceHistory.targetRace.daysToRace
            },
            newGoals: {
                distance: updatedProfile.raceHistory.targetRace.distance,
                date: updatedProfile.raceHistory.targetRace.raceDate,
                daysToRace: updatedProfile.raceHistory.targetRace.daysToRace
            }
        });
        
        console.log('✅ New training plan generated:', newPlanDoc.id);
        
        // ========== STEP 5: SEND NOTIFICATION ==========
        try {
            const notificationService = new NotificationService(db);
            await notificationService.createNotification(
                userId,
                'race_goals_updated',
                '🎯 Training Plan Updated',
                `Your race goals have been updated! New training plan generated for ${updatedProfile.raceHistory.targetRace.distance}km race in ${updatedProfile.raceHistory.targetRace.daysToRace} days.`,
                '/dashboard',
                {
                    oldGoals: currentProfile.raceHistory.targetRace.distance,
                    newGoals: targetDistance
                }
            );
        } catch (notificationError) {
            console.warn('⚠️ Notification failed (non-critical):', notificationError.message);
        }
        
        // ========== STEP 6: TRACK ANALYTICS ==========
        try {
            await db.collection('analytics_events').add({
                event: 'race_goals_updated',
                userId: userId,
                oldGoals: {
                    distance: currentProfile.raceHistory.targetRace.distance,
                    daysToRace: currentProfile.raceHistory.targetRace.daysToRace
                },
                newGoals: {
                    distance: updatedProfile.raceHistory.targetRace.distance,
                    daysToRace: updatedProfile.raceHistory.targetRace.daysToRace
                },
                timestamp: new Date(),
                source: 'race_goals_update'
            });
        } catch (analyticsError) {
            console.warn('⚠️ Analytics tracking failed (non-critical):', analyticsError.message);
        }
        
        console.log('✅ Race goals update completed');
        
        res.json({
            success: true,
            message: 'Race goals updated successfully! New training plan generated.',
            previousPlan: {
                distance: currentProfile.raceHistory.targetRace.distance,
                daysToRace: currentProfile.raceHistory.targetRace.daysToRace
            },
            newPlan: {
                id: newPlanDoc.id,
                distance: updatedProfile.raceHistory.targetRace.distance,
                daysToRace: updatedProfile.raceHistory.targetRace.daysToRace,
                type: planType
            },
            recommendations: {
                weeksToPeak: Math.floor(updatedProfile.raceHistory.targetRace.daysToRace / 7),
                periodization: generatePeriodizationSummary(updatedProfile)
            }
        });
        
    } catch (error) {
        console.error('❌ Race goals update error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update race goals',
            error: error.message
        });
    }
});

// ==================== HELPER FUNCTIONS ====================

/**
 * Generate periodization summary for the updated plan
 */
function generatePeriodizationSummary(profile) {
    const daysToRace = profile.raceHistory.targetRace.daysToRace;
    const totalWeeks = Math.min(16, Math.floor(daysToRace / 7));
    
    return {
        totalWeeks: totalWeeks,
        buildingWeeks: Math.floor(totalWeeks * 0.40),
        intensityWeeks: Math.floor(totalWeeks * 0.35),
        peakWeeks: Math.floor(totalWeeks * 0.15),
        taperWeeks: totalWeeks - Math.floor(totalWeeks * 0.40) - Math.floor(totalWeeks * 0.35) - Math.floor(totalWeeks * 0.15),
        currentWeeklyMileage: profile.raceHistory.currentWeeklyMileage,
        expectedPeakMileage: Math.round(profile.raceHistory.currentWeeklyMileage * 1.2),
        notes: 'Plan adjusted for new race date and goals'
    };
}

/**
 * Get current plan and compare with potential updates
 * POST /api/race-goals/compare
 * 
 * Allows user to preview what changes would occur if they updated goals
 */
app.post('/api/race-goals/compare', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        const { targetDistance, targetDate, targetTime } = req.body;
        
        console.log('🔍 Comparing race goal changes for user:', userId);
        
        // Get current profile
        const profileDoc = await db.collection('aiprofiles').doc(userId).get();
        
        if (!profileDoc.exists) {
            return res.status(404).json({
                success: false,
                message: 'AI profile not found'
            });
        }
        
        const currentProfile = profileDoc.data();
        const currentGoals = currentProfile.raceHistory.targetRace;
        
        // Calculate new values
        const newDaysToRace = targetDate ? calculateDaysToRace(targetDate) : currentGoals.daysToRace;
        const newDistance = targetDistance || currentGoals.distance;
        
        // Calculate implications
        const implications = {
            daysChange: newDaysToRace - currentGoals.daysToRace,
            distanceChange: newDistance - currentGoals.distance,
            weeksDifference: Math.floor(newDaysToRace / 7) - Math.floor(currentGoals.daysToRace / 7),
            impact: ''
        };
        
        // Determine impact
        if (implications.daysChange < 0) {
            implications.impact = '⚠️ AGGRESSIVE - Less time to prepare';
        } else if (implications.daysChange > 30) {
            implications.impact = '✅ RELAXED - More preparation time';
        } else {
            implications.impact = '⚖️ SIMILAR - Similar preparation timeline';
        }
        
        res.json({
            success: true,
            currentGoals: {
                distance: currentGoals.distance,
                date: currentGoals.raceDate,
                daysToRace: currentGoals.daysToRace
            },
            proposedGoals: {
                distance: newDistance,
                date: targetDate || currentGoals.raceDate,
                daysToRace: newDaysToRace
            },
            implications: implications,
            recommendation: generateComparisonRecommendation(implications, currentProfile)
        });
        
    } catch (error) {
        console.error('❌ Race goals comparison error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to compare race goals',
            error: error.message
        });
    }
});

/**
 * Generate recommendation based on goal changes
 */
function generateComparisonRecommendation(implications, profile) {
    if (implications.daysChange < -30) {
        return '🚨 Warning: Very aggressive timeline. Consider increasing weekly mileage carefully to avoid injury.';
    } else if (implications.daysChange < 0) {
        return '⚠️ Shorter timeline ahead. We\'ll intensify training to match new deadline.';
    } else if (implications.daysChange > 60) {
        return '✅ More time available. We\'ll build more gradually and focus on building aerobic base.';
    } else {
        return '⚖️ Similar timeline. Minor plan adjustments will be made.';
    }
}

/**
 * Get all previous plans (history)
 * GET /api/race-plans/history
 */
app.get('/api/race-plans/history', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        const limit = parseInt(req.query.limit) || 10;
        
        const plansSnapshot = await db.collection('trainingplans')
            .where('userId', '==', userId)
            .orderBy('createdAt', 'desc')
            .limit(limit)
            .get();
        
        const plans = plansSnapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data(),
            createdAt: doc.data().createdAt.toDate?.() || doc.data().createdAt
        }));
        
        res.json({
            success: true,
            totalPlans: plans.length,
            plans: plans
        });
        
    } catch (error) {
        console.error('❌ Error fetching plan history:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch plan history',
            error: error.message
        });
    }
});


// ==================== GET ENDPOINTS FOR RACE GOALS ====================

/**
 * GET current race goals
 * GET /api/race-goals/current
 */
app.get('/api/race-goals/current', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        
        // Get AI profile with current goals
        const profileDoc = await db.collection('aiprofiles').doc(userId).get();
        
        if (!profileDoc.exists) {
            return res.status(404).json({
                success: false,
                message: 'No AI profile found'
            });
        }
        
        const profile = profileDoc.data();
        const currentGoals = profile.raceHistory.targetRace;
        
        res.json({
            success: true,
            goals: {
                distance: currentGoals.distance,
                date: currentGoals.raceDate,
                targetTime: currentGoals.targetTime,
                daysToRace: currentGoals.daysToRace,
                location: currentGoals.location
            },
            profile: {
                weeklyMileage: profile.raceHistory.currentWeeklyMileage,
                trainingDays: profile.trainingStructure.preferredDays,
                intensityPreference: profile.trainingStructure.intensityPreference
            }
        });
        
    } catch (error) {
        console.error('Error fetching current goals:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch goals',
            error: error.message
        });
    }
});

/**
 * GET active training plan
 * GET /api/race-goals/plan/current
 */
app.get('/api/race-goals/plan/current', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        
        // Get current active plan
        const planDoc = await db.collection('trainingplans')
            .where('userId', '==', userId)
            .where('isActive', '==', true)
            .limit(1)
            .get();
        
        if (planDoc.empty) {
            return res.status(404).json({
                success: false,
                message: 'No active training plan found'
            });
        }
        
        const plan = planDoc.docs[0].data();
        
        res.json({
            success: true,
            planId: planDoc.docs[0].id,
            planType: plan.planType,
            coachType: plan.planData?.coachType || 'race',
            createdAt: plan.createdAt,
            data: plan.planData,
            progress: {
                weeksElapsed: calculateWeeksElapsed(plan.createdAt),
                totalWeeks: getTotalWeeks(plan.planData)
            }
        });
        
    } catch (error) {
        console.error('Error fetching current plan:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch training plan',
            error: error.message
        });
    }
});

/**
 * GET plan history
 * GET /api/race-goals/plans/history?limit=10
 */
app.get('/api/race-goals/plans/history', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        const limit = parseInt(req.query.limit) || 10;
        
        const plansSnapshot = await db.collection('trainingplans')
            .where('userId', '==', userId)
            .orderBy('createdAt', 'desc')
            .limit(limit)
            .get();
        
        if (plansSnapshot.empty) {
            return res.json({
                success: true,
                totalPlans: 0,
                plans: []
            });
        }
        
        const plans = plansSnapshot.docs.map(doc => ({
            id: doc.id,
            planType: doc.data().planType,
            isActive: doc.data().isActive,
            createdAt: doc.data().createdAt,
            reason: doc.data().reason || 'Initial plan',
            goals: doc.data().newGoals || doc.data().previousGoals
        }));
        
        res.json({
            success: true,
            totalPlans: plans.length,
            plans: plans
        });
        
    } catch (error) {
        console.error('Error fetching plan history:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch plan history',
            error: error.message
        });
    }
});

/**
 * GET plan details
 * GET /api/race-goals/plan/:planId
 */
app.get('/api/race-goals/plan/:planId', authenticateToken, async (req, res) => {
    try {
        const { planId } = req.params;
        const userId = req.user.userId;
        
        // Verify ownership
        const planDoc = await db.collection('trainingplans').doc(planId).get();
        
        if (!planDoc.exists) {
            return res.status(404).json({
                success: false,
                message: 'Plan not found'
            });
        }
        
        if (planDoc.data().userId !== userId) {
            return res.status(403).json({
                success: false,
                message: 'Unauthorized'
            });
        }
        
        const plan = planDoc.data();
        
        res.json({
            success: true,
            id: planId,
            planType: plan.planType,
            planData: plan.planData,
            createdAt: plan.createdAt,
            isActive: plan.isActive,
            details: {
                previousGoals: plan.previousGoals || null,
                newGoals: plan.newGoals || null,
                reason: plan.reason || 'Initial plan'
            }
        });
        
    } catch (error) {
        console.error('Error fetching plan details:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch plan',
            error: error.message
        });
    }
});

/**
 * GET goals comparison (current vs what they could be)
 * GET /api/race-goals/comparison?targetDistance=42.2&targetDate=2025-12-15
 */
app.get('/api/race-goals/comparison', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        const { targetDistance, targetDate, targetTime } = req.query;
        
        // Get current profile
        const profileDoc = await db.collection('aiprofiles').doc(userId).get();
        
        if (!profileDoc.exists) {
            return res.status(404).json({
                success: false,
                message: 'AI profile not found'
            });
        }
        
        const profile = profileDoc.data();
        const currentGoals = profile.raceHistory.targetRace;
        
        // Calculate new values
        const newDaysToRace = targetDate ? calculateDaysToRace(targetDate) : currentGoals.daysToRace;
        const newDistance = targetDistance ? parseFloat(targetDistance) : currentGoals.distance;
        
        // Calculate implications
        const implications = {
            daysChange: newDaysToRace - currentGoals.daysToRace,
            distanceChange: newDistance - currentGoals.distance,
            weeksDifference: Math.floor(newDaysToRace / 7) - Math.floor(currentGoals.daysToRace / 7)
        };
        
        // Determine impact
        let impactLevel = 'SIMILAR';
        if (implications.daysChange < -30) {
            impactLevel = 'AGGRESSIVE';
        } else if (implications.daysChange > 30) {
            impactLevel = 'RELAXED';
        }
        
        res.json({
            success: true,
            comparison: {
                current: {
                    distance: currentGoals.distance,
                    date: currentGoals.raceDate,
                    daysToRace: currentGoals.daysToRace,
                    time: currentGoals.targetTime
                },
                proposed: {
                    distance: newDistance,
                    date: targetDate || currentGoals.raceDate,
                    daysToRace: newDaysToRace,
                    time: targetTime || currentGoals.targetTime
                },
                implications: implications,
                impactLevel: impactLevel,
                recommendation: generateComparisonRecommendation(implications, profile)
            }
        });
        
    } catch (error) {
        console.error('Error fetching comparison:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch comparison',
            error: error.message
        });
    }
});

/**
 * GET goals summary for dashboard
 * GET /api/race-goals/summary
 */
app.get('/api/race-goals/summary', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        
        // Get current goals
        const profileDoc = await db.collection('aiprofiles').doc(userId).get();
        if (!profileDoc.exists) {
            return res.status(404).json({
                success: false,
                message: 'No profile'
            });
        }
        
        const profile = profileDoc.data();
        const goals = profile.raceHistory.targetRace;
        
        // Get current plan
        const planDoc = await db.collection('trainingplans')
            .where('userId', '==', userId)
            .where('isActive', '==', true)
            .limit(1)
            .get();
        
        const summary = {
            raceGoal: {
                distance: goals.distance,
                date: goals.raceDate,
                daysRemaining: goals.daysToRace,
                targetTime: goals.targetTime,
                location: goals.location
            },
            currentTraining: {
                weeklyMileage: profile.raceHistory.currentWeeklyMileage,
                trainingDays: profile.trainingStructure.preferredDays.length,
                coachType: planDoc.empty ? 'none' : planDoc.docs[0].data().planType,
                planCreated: planDoc.empty ? null : planDoc.docs[0].data().createdAt
            },
            personalBest: {
                distance: profile.raceHistory.recentPB.distance,
                time: profile.raceHistory.recentPB.time,
                pace: profile.raceHistory.recentPB.pace,
                date: profile.raceHistory.recentPB.date
            },
            statistics: {
                weeksToPeak: Math.floor(goals.daysToRace / 7),
                estimatedPeakMileage: Math.round(profile.raceHistory.currentWeeklyMileage * 1.2),
                recoveryFocus: profile.trainingStructure.intensityPreference
            }
        };
        
        res.json({
            success: true,
            summary: summary
        });
        
    } catch (error) {
        console.error('Error fetching summary:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch summary',
            error: error.message
        });
    }
});

/**
 * GET goals with previous versions
 * GET /api/race-goals/timeline
 */
app.get('/api/race-goals/timeline', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        
        // Get all plans in chronological order
        const plansSnapshot = await db.collection('trainingplans')
            .where('userId', '==', userId)
            .orderBy('createdAt', 'asc')
            .get();
        
        if (plansSnapshot.empty) {
            return res.json({
                success: true,
                timeline: [],
                message: 'No training history'
            });
        }
        
        const timeline = plansSnapshot.docs.map((doc, index) => ({
            version: index + 1,
            date: doc.data().createdAt,
            goals: doc.data().newGoals || doc.data().previousGoals,
            reason: doc.data().reason || 'Initial plan',
            isActive: doc.data().isActive,
            planType: doc.data().planType
        }));
        
        res.json({
            success: true,
            totalVersions: timeline.length,
            timeline: timeline
        });
        
    } catch (error) {
        console.error('Error fetching timeline:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch timeline',
            error: error.message
        });
    }
});

// ==================== HELPER FUNCTIONS ====================

function calculateWeeksElapsed(createdAt) {
    const now = new Date();
    const created = createdAt.toDate ? createdAt.toDate() : new Date(createdAt);
    const diffMs = now - created;
    return Math.floor(diffMs / (7 * 24 * 60 * 60 * 1000));
}

function getTotalWeeks(planData) {
    return planData?.weeklyPlans?.length || 16;
}

/**
 * Calculate days until race date
 * ✅ Handles past dates (returns 0)
 * ✅ Rounds up for accuracy (partial days = full day)
 * ✅ Works with string and Date inputs
 */
function calculateDaysToRace(targetDate) {
    try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);  // Reset time to midnight (accurate day calculation)
        
        const race = new Date(targetDate);
        race.setHours(0, 0, 0, 0);   // Reset time to midnight
        
        const diffTime = race - today;
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        
        return diffDays > 0 ? diffDays : 0;  // Never negative
    } catch (error) {
        console.error('Invalid date:', error);
        return 0;  // Safe fallback
    }
}

function generateComparisonRecommendation(implications, profile) {
    if (implications.daysChange < -30) {
        return '🚨 Warning: Very aggressive timeline. Consider gradual increases.';
    } else if (implications.daysChange < 0) {
        return '⚠️ Shorter timeline. We\'ll intensify training carefully.';
    } else if (implications.daysChange > 60) {
        return '✅ More time available. Focus on aerobic base building.';
    } else {
        return '⚖️ Similar timeline. Minor plan adjustments.';
    }
}



// ============================================
// AI ONBOARDING ROUTES (Frontend Pages)
// ============================================

// Race Coach Onboarding (for Premium/Race plan users)
app.get('/ai-onboarding-race', authenticateToken, (req, res) => {
    // Check if user has race/premium plan
    const userPlan = req.user.currentPlan || req.user.subscriptionStatus;
    
    if (userPlan !== 'race' && userPlan !== 'premium') {
        return res.redirect('/dashboard?error=access_denied');
    }
    
    res.sendFile(path.join(__dirname, 'public', 'ai-onboarding.html'));
});

// Basic Coach Onboarding (for Basic plan users)
app.get('/ai-onboarding-basic', authenticateToken, (req, res) => {
    // Check if user has basic plan
    const userPlan = req.user.currentPlan || req.user.subscriptionStatus;
    
    if (userPlan !== 'basic') {
        return res.redirect('/dashboard?error=access_denied');
    }
    
    res.sendFile(path.join(__dirname, 'public', 'ai-onboarding-basic.html'));
});

// Legacy redirect (for backward compatibility)
app.get('/ai-onboarding-active', authenticateToken, (req, res) => {
    const userPlan = req.user.currentPlan || req.user.subscriptionStatus;
    
    if (userPlan === 'race' || userPlan === 'premium') {
        res.redirect('/ai-onboarding-race');
    } else if (userPlan === 'basic') {
        res.redirect('/ai-onboarding-basic');
    } else {
        res.redirect('/plans.html'); // Free users go to plans page
    }
});

// Helper functions for AI onboarding


// ==================== TRAINING PLAN GENERATION ====================

/**
 * Main function to generate initial training plan with AI + fallback
 * PRODUCTION READY
/**
 * RACE COACH PLAN GENERATOR
 * Optimized for periodization, peak performance, race strategy
 */
async function generateRaceCoachPlan(profile) {
    try {
        console.log('🤖 Generating RACE COACH plan for:', profile.personalProfile.email);
        
        const daysToRace = profile.raceHistory.targetRace.daysToRace;
        
        const prompt = `Create an advanced race-focused periodized training plan:

Profile:
- Age: ${profile.personalProfile.age}, Gender: ${profile.personalProfile.gender}
- Current weekly mileage: ${profile.raceHistory.currentWeeklyMileage}km
- Target race: ${profile.raceHistory.targetRace.distance} in ${daysToRace} days
- Target time: ${profile.raceHistory.targetRace.targetTime || 'Personal best attempt'}
- Training days: ${profile.trainingStructure.preferredDays?.join(', ')}
- Recent PB: ${profile.raceHistory.recentPB?.distance} in ${profile.raceHistory.recentPB?.time || 'N/A'}

Create a ${Math.min(16, Math.floor(daysToRace / 7))}-week plan with:
1. PERIODIZATION: Build → Intensity → Peak → Taper phases
2. Race-specific workouts (tempo, intervals, threshold)
3. Strategic mileage progression
4. HRV-based recovery guidance
5. Race day strategy

Format as JSON with detailed weekly breakdowns.`;
        
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
        
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const planText = response.text();
        
        let trainingPlan;
        try {
            const cleanedText = planText.replace(/``````/g, '').trim();
            trainingPlan = JSON.parse(cleanedText);
            trainingPlan.type = 'ai_generated_race';
        } catch (e) {
            trainingPlan = {
                type: 'ai_text',
                content: planText
            };
        }
        
        console.log('✅ AI RACE COACH plan generated');
        return {
            ...trainingPlan,
            coachType: 'race',
            source: 'ai_gemini_race',
            generatedAt: new Date().toISOString()
        };
        
    } catch (error) {
        console.error('❌ Race coach plan generation failed:', error.message);
        return {
            type: 'template_fallback',
            coachType: 'race',
            source: 'fallback_template_race',
            plan: generateRaceFallbackPlan(profile),
            fallbackReason: error.message,
            generatedAt: new Date().toISOString()
        };
    }
}

/**
 * BASIC COACH PLAN GENERATOR
 * Optimized for habit formation, consistency, beginner-friendly
 */
async function generateBasicCoachPlan(profile) {
    try {
        console.log('🤖 Generating BASIC COACH plan for:', profile.personalProfile.email);
        
        const prompt = `Create a beginner-friendly running plan focused on HABIT FORMATION:

Profile:
- Age: ${profile.personalProfile.age}, Gender: ${profile.personalProfile.gender}
- Current weekly mileage: ${profile.raceHistory.currentWeeklyMileage}km
- Training days per week: ${profile.trainingStructure.daysPerWeek}
- Preferred days: ${profile.trainingStructure.preferredDays?.join(', ')}

Focus on:
1. Building running habits (consistency over intensity)
2. Sustainable easy paces
3. Gradual progression (max 5-10% weekly increase)
4. Making running enjoyable
5. Recovery emphasis

Create a 4-week plan emphasizing CONSISTENCY with daily structure, motivation tips.
Format as JSON.`;
        
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
        
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const planText = response.text();
        
        let trainingPlan;
        try {
            const cleanedText = planText.replace(/``````/g, '').trim();
            trainingPlan = JSON.parse(cleanedText);
            trainingPlan.type = 'ai_generated_basic';
        } catch (e) {
            trainingPlan = {
                type: 'ai_text',
                content: planText
            };
        }
        
        console.log('✅ AI BASIC COACH plan generated');
        return {
            ...trainingPlan,
            coachType: 'basic',
            source: 'ai_gemini_basic',
            generatedAt: new Date().toISOString()
        };
        
    } catch (error) {
        console.error('❌ Basic coach plan generation failed:', error.message);
        return {
            type: 'template_fallback',
            coachType: 'basic',
            source: 'fallback_template_basic',
            plan: generateBasicFallbackPlan(profile),
            fallbackReason: error.message,
            generatedAt: new Date().toISOString()
        };
    }
}

/**
 * RACE FALLBACK: Safe template if AI fails
 */
function generateRaceFallbackPlan(profile) {
    const daysToRace = profile.raceHistory.targetRace.daysToRace;
    const totalWeeks = Math.min(16, Math.floor(daysToRace / 7));
    
    return {
        planType: 'race_template',
        totalWeeks,
        phases: {
            building: Math.floor(totalWeeks * 0.40),
            intensity: Math.floor(totalWeeks * 0.35),
            peak: Math.floor(totalWeeks * 0.15),
            taper: totalWeeks - Math.floor(totalWeeks * 0.40) - Math.floor(totalWeeks * 0.35) - Math.floor(totalWeeks * 0.15)
        },
        notes: 'Periodized approach: Build → Intensity → Peak → Taper'
    };
}

/**
 * BASIC FALLBACK: Safe template if AI fails
 */
function generateBasicFallbackPlan(profile) {
    const daysPerWeek = profile.trainingStructure.daysPerWeek || 3;
    
    return {
        planType: 'basic_template',
        weeklyStructure: {
            totalDays: daysPerWeek,
            easyRuns: daysPerWeek - 1,
            moderateRun: 1,
            restDays: 7 - daysPerWeek
        },
        notes: 'Start easy, focus on showing up, enjoy the process'
    };
}

/**
 * FACTORY FUNCTION: Route to correct generator based on plan type
 */
async function generateInitialTrainingPlan(profile, planType = 'race') {
    console.log(`🎯 Routing to ${planType} coach plan generator...`);
    
    if (planType === 'basic') {
        return generateBasicCoachPlan(profile);
    } else if (planType === 'race') {
        return generateRaceCoachPlan(profile);
    } else {
        throw new Error(`Unknown plan type: ${planType}`);
    }
}


/**
 * Helper: Get training intensity preference as string
 */
function getIntensityLabel(profile) {
    const pref = profile.trainingStructure.intensityPreference || 'moderate';
    const labels = {
        'low': 'Easy (Base building)',
        'moderate': 'Balanced (Speed + Endurance)',
        'high': 'Aggressive (Race prep)'
    };
    return labels[pref] || labels['moderate'];
}


console.log('🤖 AI Onboarding System Routes Added');

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
app.get('/api/ai/cost-status', authenticateToken, requireAdmin, (req, res) => {
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



app.get('/dashboard', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        
        console.log(`📊 Dashboard request from user: ${userId}`);
        
        // Get user from Firestore
        const userDoc = await db.collection('users').doc(userId).get();
        
        if (!userDoc.exists) {
            console.log('❌ User not found, redirecting to login');
            return res.redirect('/login');
        }
        
        const user = userDoc.data();
        
        // ✅ FIX: Check multiple fields for plan type
        // Priority: currentPlan > plan > subscriptionStatus
        let planType = user.currentPlan || user.plan || user.subscriptionStatus || 'free';
        
        console.log(`🔍 Raw plan data:`, {
            currentPlan: user.currentPlan,
            plan: user.plan,
            subscriptionStatus: user.subscriptionStatus
        });
        
        // Map plan types to dashboard files
        // Handle different naming conventions
        const planMapping = {
            // Free tier
            'free': 'free',
            
            // Basic tier (Fitness Coach)
            'basic': 'basic',
            'fitness': 'basic',
            'active': 'basic',     // Status "active" defaults to basic
            
            // Race tier (Race Coach)
            'race': 'race',
            'premium': 'race',
            'performance': 'race'
        };
        
        // Normalize and map the plan
        const normalizedPlan = planType.toLowerCase();
        const mappedPlan = planMapping[normalizedPlan] || 'free';
        
        console.log(`✅ Plan resolution: "${planType}" → "${mappedPlan}"`);
        
        // Map to dashboard files
        const dashboardFiles = {
            'free': 'dashboard-free.html',
            'basic': 'dashboard-basic.html',
            'race': 'dashboard-race.html'
        };
        
        const dashboardFile = dashboardFiles[mappedPlan];
        
        console.log(`📄 Serving: ${dashboardFile}`);
        
        res.sendFile(path.join(__dirname, 'public', dashboardFile));
    } catch (error) {
        console.error('❌ Dashboard error:', error);
        res.status(500).send('Error loading dashboard');
    }
});


// Backward compatibility - redirect .html URLs
app.get('/dashboard.html', authenticateToken, (req, res) => {
    res.redirect('/dashboard');
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

// Logout endpoint
app.post('/api/auth/logout', (req, res) => {
    console.log('🚪 User logging out');
    
    // Clear the cookie
    res.clearCookie('userToken', {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        path: '/'
    });
    
    res.json({ 
        success: true, 
        message: 'Logged out successfully',
        redirect: '/login'
    });
});

// Get Razorpay config for frontend
app.get('/api/payment/config', authenticateToken, (req, res) => {
    res.json({
        success: true,
        key: process.env.RAZORPAY_KEY_ID,
        testMode: process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_ID.startsWith('rzp_test')
    });
});

// Get Razorpay Key (needed by payment.js)
app.get('/api/payment/razorpay-key', (req, res) => {
    res.json({
        success: true,
        key: window.RAZORPAY_KEY_ID || ''
    });
});

// Create payment order
app.post('/api/payment/create-order', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        const { planType, amount } = req.body;
        
        console.log(`💳 Creating order for user ${userId}, plan: ${planType}`);
        
        // Get user details
        const userDoc = await db.collection('users').doc(userId).get();
        if (!userDoc.exists) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }
        
        const user = userDoc.data();
        
        // Create Razorpay order
        const order = await razorpayService.createOrder({
            amount: amount,
            userId: userId,
            userEmail: user.email,
            planType: planType
        });
        
        // Store order in Firestore
        await db.collection('orders').add({
            orderId: order.id,
            userId: userId,
            userEmail: user.email,
            planType: planType,
            amount: amount,
            currency: 'INR',
            status: 'created',
            createdAt: new Date().toISOString()
        });
        
        res.json({
            success: true,
            order: {
                id: order.id,
                amount: order.amount,
                currency: order.currency
            }
        });
        
    } catch (error) {
        console.error('❌ Order creation error:', error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// Verify payment
app.post('/api/payment/verify', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        const { razorpay_order_id, razorpay_payment_id, razorpay_signature, planType } = req.body;
        
        console.log(`🔍 Verifying payment for user ${userId}`);
        
        // Verify signature
        const isValid = razorpayService.verifyPaymentSignature({
            razorpay_order_id,
            razorpay_payment_id,
            razorpay_signature
        });
        
        if (!isValid) {
            console.log('❌ Invalid payment signature');
            return res.status(400).json({
                success: false,
                message: 'Payment verification failed'
            });
        }
        
        console.log('✅ Payment signature verified');
        
        // Get payment details
        const payment = await razorpayService.getPayment(razorpay_payment_id);
        
        // Update order status in Firestore
        const orderQuery = await db.collection('orders')
            .where('orderId', '==', razorpay_order_id)
            .limit(1)
            .get();
        
        if (!orderQuery.empty) {
            await orderQuery.docs[0].ref.update({
                paymentId: razorpay_payment_id,
                status: 'paid',
                paidAt: new Date().toISOString(),
                paymentMethod: payment.method
            });
        }
        
        // Upgrade user subscription
        await db.collection('users').doc(userId).update({
            subscriptionStatus: 'active',
            currentPlan: planType,
            paymentId: razorpay_payment_id,
            subscriptionStartDate: new Date().toISOString(),
            subscriptionEndDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString() // 30 days
        });
        
        console.log(`✅ User ${userId} upgraded to ${planType} plan`);
        
        res.json({
            success: true,
            message: 'Payment successful! Your account has been upgraded.',
            planType: planType
        });
        
    } catch (error) {
        console.error('❌ Payment verification error:', error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});


// Razorpay Webhook Handler
// Razorpay Webhook Handler
// ✅ CRITICAL: Webhook route MUST come BEFORE app.use(express.json())
// Or use express.raw() specifically for this route
app.post('/api/payment/webhook', 
  express.raw({ type: 'application/json' }), // ✅ Keep raw body for signature verification
  async (req, res) => {
    try {
      const webhookSignature = req.headers['x-razorpay-signature'];
      const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
      
      //console.log('🔔 Webhook received');
      //console.log('   Signature header:', webhookSignature ? 'Present' : 'Missing');
      //console.log('   Secret configured:', !!webhookSecret);
      
      // ✅ CRITICAL: Verify signature with RAW body
      if (webhookSecret && webhookSignature) {
        const expectedSignature = crypto
          .createHmac('sha256', webhookSecret)
          .update(req.body) // req.body is Buffer (raw bytes)
          .digest('hex');
        
        if (webhookSignature !== expectedSignature) {
          console.error('❌ Invalid webhook signature');
          console.error('   Expected:', expectedSignature.substring(0, 20) + '...');
          console.error('   Received:', webhookSignature.substring(0, 20) + '...');
          return res.status(400).json({ success: false, error: 'Invalid signature' });
        }
        
        console.log('✅ Webhook signature verified');
      } else {
        console.warn('⚠️ Webhook signature verification skipped');
        if (!webhookSecret) console.warn('   Reason: RAZORPAY_WEBHOOK_SECRET not set');
        if (!webhookSignature) console.warn('   Reason: x-razorpay-signature header missing');
        
        // ❌ PRODUCTION: Reject if secret is configured but signature missing
        if (process.env.NODE_ENV === 'production' && webhookSecret && !webhookSignature) {
          return res.status(400).json({ success: false, error: 'Signature required' });
        }
      }
      
      // ✅ Parse body AFTER signature verification
      const webhookBody = JSON.parse(req.body.toString('utf8'));
      const event = webhookBody.event;
      const payload = webhookBody.payload;
      
      console.log('📦 Event:', event);
      
      // Handle different webhook events
      switch (event) {
        case 'payment.captured':
          console.log('✅ Payment captured:', payload.payment.entity.id);
          await handlePaymentCaptured(payload.payment.entity);
          break;
          
        case 'payment.authorized':
          console.log('⏳ Payment authorized:', payload.payment.entity.id);
          // Payment authorized but not captured yet
          break;
          
        case 'payment.failed':
          console.log('❌ Payment failed:', payload.payment.entity.id);
          await handlePaymentFailure(payload.payment.entity);
          break;
          
        case 'order.paid':
          console.log('💰 Order paid:', payload.order.entity.id);
          await handleOrderPaid(payload.order.entity);
          break;
          
        case 'refund.created':
          console.log('💸 Refund created:', payload.refund.entity.id);
          await handleRefundCreated(payload.refund.entity);
          break;
          
        default:
          console.log('ℹ️ Unhandled webhook event:', event);
      }
      
      // ✅ Always return 200 to prevent retries
      res.status(200).json({ success: true });
      
    } catch (error) {
      console.error('❌ Webhook processing error:', error.message);
      // Don't log full error object (may contain sensitive data)
      
      // ✅ Return 500 to trigger Razorpay retry
      res.status(500).json({ success: false, error: 'Internal error' });
    }
  }
);


// Helper functions for webhook handlers
async function handlePaymentCaptured(payment) {
    console.log('Processing captured payment:', payment.id);
    
    // Update order status
    const orderQuery = await db.collection('orders')
        .where('orderId', '==', payment.order_id)
        .limit(1)
        .get();
    
    if (!orderQuery.empty) {
        const orderDoc = orderQuery.docs[0];
        const orderData = orderDoc.data();
        
        await orderDoc.ref.update({
            paymentId: payment.id,
            status: 'paid',
            paidAt: new Date().toISOString(),
            paymentMethod: payment.method,
            amount: payment.amount / 100
        });
        
        // Upgrade user if not already done
        if (orderData.userId) {
            const userDoc = await db.collection('users').doc(orderData.userId).get();
            if (userDoc.exists && userDoc.data().subscriptionStatus !== 'active') {
                await db.collection('users').doc(orderData.userId).update({
                    subscriptionStatus: 'active',
                    currentPlan: orderData.planType,
                    paymentId: payment.id,
                    subscriptionStartDate: new Date().toISOString(),
                    subscriptionEndDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
                });
                console.log('✅ User upgraded via webhook');
            }
        }
    }
}

async function handlePaymentFailure(payment) {
    console.log('Processing failed payment:', payment.id);
    
    // Update order status
    const orderQuery = await db.collection('orders')
        .where('orderId', '==', payment.order_id)
        .limit(1)
        .get();
    
    if (!orderQuery.empty) {
        await orderQuery.docs[0].ref.update({
            status: 'failed',
            failedAt: new Date().toISOString(),
            errorCode: payment.error_code,
            errorDescription: payment.error_description
        });
    }
}

async function handleOrderPaid(order) {
    console.log('Processing paid order:', order.id);
    
    // This is a backup - usually payment.captured handles everything
    const orderQuery = await db.collection('orders')
        .where('orderId', '==', order.id)
        .limit(1)
        .get();
    
    if (!orderQuery.empty) {
        await orderQuery.docs[0].ref.update({
            status: 'paid',
            paidAt: new Date().toISOString()
        });
    }
}

async function handleRefundCreated(refund) {
    console.log('Processing refund:', refund.id);
    
    // Log refund
    await db.collection('refunds').add({
        refundId: refund.id,
        paymentId: refund.payment_id,
        amount: refund.amount / 100,
        status: refund.status,
        createdAt: new Date().toISOString()
    });
    
    // Optionally downgrade user
    const orderQuery = await db.collection('orders')
        .where('paymentId', '==', refund.payment_id)
        .limit(1)
        .get();
    
    if (!orderQuery.empty) {
        const userId = orderQuery.docs[0].data().userId;
        if (userId) {
            await db.collection('users').doc(userId).update({
                subscriptionStatus: 'refunded',
                currentPlan: 'free',
                refundedAt: new Date().toISOString()
            });
            console.log('✅ User downgraded due to refund');
        }
    }
}

const DailyWorkoutScheduler = require('./services/dailyWorkoutScheduler');

// Initialize scheduler
const workoutScheduler = new DailyWorkoutScheduler(db, aiService);
workoutScheduler.start();

console.log('✅ WhatsApp daily workout scheduler initialized');



// Phone authentication endpoint
// Phone Authentication Endpoint - COMPLETE VERSION
app.post('/api/auth/phone-login', async (req, res) => {
    try {
        const { phoneNumber, firebaseUid, idToken } = req.body;

        // Validate input
        if (!phoneNumber || !firebaseUid || !idToken) {
            return res.status(400).json({ 
                success: false, 
                message: 'Missing required fields: phoneNumber, firebaseUid, or idToken' 
            });
        }

        console.log('📱 Phone login attempt:', phoneNumber);

        // Verify Firebase ID token
        let decodedToken;
        try {
            decodedToken = await admin.auth().verifyIdToken(idToken);
            console.log('✅ Firebase token verified');
        } catch (verifyError) {
            console.error('❌ Token verification failed:', verifyError);
            return res.status(401).json({ 
                success: false, 
                message: 'Invalid Firebase token' 
            });
        }
        
        // Verify phone number matches token
        if (decodedToken.phone_number !== phoneNumber) {
            console.error('❌ Phone number mismatch');
            return res.status(400).json({ 
                success: false, 
                message: 'Phone number mismatch' 
            });
        }

        // Check if user exists with this phone
        let user = await userManager.getUserByPhone(phoneNumber);

        if (!user) {
            // Create new user via phone
            console.log('📝 Creating new user with phone:', phoneNumber);
            
            user = await userManager.createUser({
                phoneNumber: phoneNumber,
                firebaseUid: firebaseUid,
                email: `${phoneNumber.replace('+', '')}@phone.zonetrain.com`, // Temporary email
                firstName: 'User',
                lastName: '',
                provider: 'phone',
                emailVerified: false,
                subscriptionStatus: 'free',
                currentPlan: null,
                active: true
            });

            console.log('✅ New user created via phone:', user.id);
            
            // Track signup activity
            try {
                await userManager.trackActivity(user.id, 'phone_signup', {
                    provider: 'phone',
                    phoneNumber: phoneNumber
                });
            } catch (trackError) {
                console.warn('⚠️ Failed to track activity:', trackError.message);
            }
        } else {
            // Update existing user's last login
            console.log('👤 Existing user found:', user.id);
            
            await userManager.updateUser(user.id, {
                lastLogin: new Date(),
                loginCount: (user.loginCount || 0) + 1,
                firebaseUid: firebaseUid // Update if changed
            });

            // Track login activity
            try {
                await userManager.trackActivity(user.id, 'phone_login', {
                    phoneNumber: phoneNumber
                });
            } catch (trackError) {
                console.warn('⚠️ Failed to track activity:', trackError.message);
            }

            // Refresh user data
            user = await userManager.getUserById(user.id);
        }

        // Generate JWT token
        const token = jwt.sign(
            {
                userId: user.id,
                phoneNumber: phoneNumber,
                plan: user.currentPlan || null,
                status: user.subscriptionStatus || 'free'
            },
            process.env.JWT_SECRET,
            { expiresIn: '7d' }
        );

        // Set HTTP-only cookie
        res.cookie('userToken', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
            sameSite: 'lax',
            path: '/'
        });

        console.log('✅ Phone login successful for user:', user.id);

        // Return success response
        res.json({
            success: true,
            token: token,
            user: userManager.sanitizeUser(user),
            message: 'Login successful',
            redirect: '/dashboard'
        });

    } catch (error) {
        console.error('❌ Phone login error:', error);
        res.status(500).json({
            success: false,
            message: 'Phone authentication failed: ' + error.message
        });
    }
});


const WhatsAppService = require('./services/whatsappService');
const whatsappService = new WhatsAppService();

// WhatsApp webhook verification (required by Meta)
app.get('/webhook/whatsapp', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    // Verify token (set this in your .env as WHATSAPP_VERIFY_TOKEN)
    const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN || 'zonetrain_verify_123';

    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
        console.log('✅ WhatsApp webhook verified');
        res.status(200).send(challenge);
    } else {
        res.status(403).send('Forbidden');
    }
});

// WhatsApp webhook to receive messages
// WhatsApp webhook to receive messages
app.post('/webhook/whatsapp', async (req, res) => {
    try {
        const body = req.body;

        // Always respond 200 OK immediately (Meta requirement)
        res.status(200).send('OK');

        // Process asynchronously (don't block webhook response)
        if (body.object === 'whatsapp_business_account') {
            const entries = body.entry;

            for (const entry of entries) {
                const changes = entry.changes;

                for (const change of changes) {
                    if (change.field === 'messages') {
                        const messages = change.value.messages;

                        if (messages) {
                            for (const message of messages) {
                                const from = message.from; // Phone number
                                const messageBody = message.text?.body || 
                                                   message.interactive?.button_reply?.title ||
                                                   message.interactive?.list_reply?.title;

                                console.log(`📩 WhatsApp from ${from}: ${messageBody}`);

                                // Process message async
                                processWhatsAppMessage(from, messageBody).catch(err => {
                                    console.error('Error processing message:', err);
                                });
                            }
                        }
                    }
                }
            }
        }
    } catch (error) {
        console.error('❌ Webhook error:', error);
    }
});

// Process incoming WhatsApp messages
async function processWhatsAppMessage(phoneNumber, messageBody) {
    try {
        // Find user by phone
        const usersSnapshot = await db.collection('users')
            .where('phoneNumber', '==', `+${phoneNumber}`)
            .limit(1)
            .get();

        if (usersSnapshot.empty) {
            console.log(`⚠️ User not found for phone: +${phoneNumber}`);
            return;
        }

        const userId = usersSnapshot.docs[0].id;
        const user = usersSnapshot.docs[0].data();

        // Parse the message
        const parsed = parseHRVResponse(messageBody);

        if (!parsed) {
            // Unknown message - send help
            await whatsappService.sendMessage(
                `+${phoneNumber}`,
                "❓ I didn't understand that. Please reply with:\n• 1-4 (recovery state)\n• GREAT/GOOD/OK/TIRED\n• HRV [number] (e.g., HRV 52)"
            );
            return;
        }

        // Store the data
        await db.collection('daily_recovery').add({
            userId,
            date: new Date(),
            recovery: parsed.recovery,
            hrv: parsed.hrv,
            source: 'whatsapp',
            createdAt: new Date()
        });

        console.log(`✅ Stored recovery data for user ${userId}:`, parsed);

        // Generate AI workout based on recovery
        const workout = await generateWorkoutFromRecovery(userId, parsed);

        // Send workout via WhatsApp
        await sendWorkoutToUser(phoneNumber, user, workout);

    } catch (error) {
        console.error('Error in processWhatsAppMessage:', error);
    }
}

// Parse user response
function parseHRVResponse(message) {
    const text = message.trim().toUpperCase();

    // HRV number (e.g., "HRV 52")
    if (text.startsWith('HRV')) {
        const match = text.match(/HRV\s+(\d+)/);
        if (match) {
            return {
                type: 'hrv',
                hrv: parseInt(match[1]),
                recovery: null
            };
        }
    }

    // Recovery state mappings
    const recoveryMap = {
        '1': 'great',
        '2': 'good',
        '3': 'ok',
        '4': 'tired',
        'GREAT': 'great',
        'GOOD': 'good',
        'OK': 'ok',
        'TIRED': 'tired'
    };

    if (recoveryMap[text]) {
        return {
            type: 'recovery',
            recovery: recoveryMap[text],
            hrv: null
        };
    }

    return null; // Unknown format
}

// Generate workout based on recovery/HRV
async function generateWorkoutFromRecovery(userId, recoveryData) {
    try {
        // Get user profile
        const userDoc = await db.collection('users').doc(userId).get();
        const user = userDoc.data();

        // Get AI profile
        const aiProfileDoc = await db.collection('aiprofiles').doc(userId).get();
        const aiProfile = aiProfileDoc.exists ? aiProfileDoc.data() : null;

        // Get recent workouts (last 7 days)
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

        const workoutsSnapshot = await db.collection('workouts')
            .where('userId', '==', userId)
            .where('date', '>=', sevenDaysAgo)
            .orderBy('date', 'desc')
            .limit(7)
            .get();

        const recentWorkouts = workoutsSnapshot.docs.map(doc => doc.data());

        // Build AI prompt
        const prompt = buildWorkoutPrompt(user, aiProfile, recoveryData, recentWorkouts);

        // Call your AI service (OpenAI/Gemini/etc)
        const aiResponse = await callAIForWorkout(prompt);

        // Parse and structure the response
        const workout = parseAIWorkoutResponse(aiResponse);

        // Store workout in Firestore
        const workoutRef = await db.collection('workouts').add({
            userId,
            date: new Date(),
            type: workout.type,
            description: workout.description,
            distance: workout.distance,
            duration: workout.duration,
            pace: workout.pace,
            zone: workout.zone,
            recovery: recoveryData.recovery,
            hrv: recoveryData.hrv,
            source: 'ai_daily',
            createdAt: new Date()
        });

        workout.id = workoutRef.id;
        return workout;

    } catch (error) {
        console.error('Error generating workout:', error);
        throw error;
    }
}

// Build AI prompt
function buildWorkoutPrompt(user, aiProfile, recoveryData, recentWorkouts) {
    const recoveryLevel = recoveryData.hrv 
        ? (recoveryData.hrv > 60 ? 'good' : recoveryData.hrv > 40 ? 'moderate' : 'low')
        : recoveryData.recovery;

    return `
You are ZoneTrain, an AI running coach. Generate today's workout.

ATHLETE PROFILE:
- Name: ${user.name}
- Subscription: ${user.subscriptionPlan}
- Race Goal: ${aiProfile?.raceDistance || 'None'} on ${aiProfile?.raceDate || 'TBD'}
- Max HR: ${aiProfile?.maxHR || 180} bpm
- Recent HRV: ${recoveryData.hrv || 'N/A'}
- Recovery State: ${recoveryLevel}

RECENT WORKOUTS (last 7 days):
${recentWorkouts.map(w => `- ${w.type}: ${w.distance || w.duration}`).join('\n')}

INSTRUCTIONS:
1. Consider recovery state (${recoveryLevel})
2. If recovery is "tired" or HRV < 40, prescribe easy/rest day
3. If recovery is "great" or HRV > 60, prescribe quality workout
4. Include HR zones based on max HR
5. Keep it conversational and motivating

FORMAT YOUR RESPONSE AS JSON:
{
  "type": "easy|interval|long|tempo|rest",
  "description": "Today's workout description",
  "distance": "8km",
  "duration": "45 min",
  "pace": "5:30/km",
  "zone": "Zone 2 (120-135 bpm)",
  "motivation": "Short motivational message"
}
`;
}

// Call AI (use your existing AI service)
async function callAIForWorkout(prompt) {
    
    // Or if you have Gemini
     const gemini = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
     const model = gemini.getGenerativeModel({ model: 'gemini-pro' });
     const result = await model.generateContent(prompt);
     return result.response.text();
    
    throw new Error('No AI service configured');
}

// Parse AI response
function parseAIWorkoutResponse(aiResponse) {
    try {
        // Try to parse as JSON
        const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            const workout = JSON.parse(jsonMatch[0]);
            return workout;
        }
    } catch (error) {
        console.error('Failed to parse AI response:', error);
    }
    
    // Fallback: return basic structure
    return {
        type: 'easy',
        description: aiResponse,
        distance: '5km',
        duration: '30 min',
        pace: '6:00/km',
        zone: 'Zone 2',
        motivation: 'Keep it easy today!'
    };
}

// Send workout to user via WhatsApp
async function sendWorkoutToUser(phoneNumber, user, workout) {
    const message = `
🏃‍♂️ *${user.name || 'Athlete'}, here's your workout for today!*

📋 *${workout.type.toUpperCase()} RUN*
${workout.description}

📏 *Distance:* ${workout.distance}
⏱️ *Duration:* ${workout.duration}
⚡ *Pace:* ${workout.pace}
❤️ *Heart Rate:* ${workout.zone}

💬 ${workout.motivation}

📱 View full details: https://zonetrain.app/dashboard

Reply:
• *DONE* when completed
• *SKIP* if you need to rest
    `.trim();

    await whatsappService.sendMessage(`+${phoneNumber}`, message);
    console.log(`✅ Workout sent to ${phoneNumber}`);
}


// ============================================
// 🧪 WHATSAPP TESTING ENDPOINTS
// ============================================

// ✅ Test All Template Types
app.post('/api/test/whatsapp-templates', authenticateToken, async (req, res) => {
    const { templateType, phoneNumber } = req.body;
    
    // Use provided phone or get from user profile
    let targetPhone = phoneNumber;
    if (!targetPhone) {
        const userDoc = await db.collection('users').doc(req.user.userId).get();
        targetPhone = userDoc.data().phoneNumber;
    }

    if (!targetPhone) {
        return res.status(400).json({ 
            success: false, 
            error: 'No phone number provided. Add phoneNumber to request or update your profile.' 
        });
    }

    try {
        let result;
        const today = new Date().toLocaleDateString('en-US', { 
            weekday: 'long', 
            month: 'short', 
            day: 'numeric' 
        });
        
        switch (templateType) {
            // ✅ Basic Templates
            case 'hello':
                result = await whatsappService.sendHelloWorld(targetPhone);
                break;
            
            // ✅ Recovery & Training
            case 'recovery':
                result = await whatsappService.sendRecoveryCheck(targetPhone);
                break;
            
            case 'easy_run':
                result = await whatsappService.sendEasyRunReminder(
                    targetPhone,
                    '8km',
                    '45 min',
                    '5:30/km',
                    'Zone 2 (120-135 bpm)'
                );
                break;
            
            case 'interval':
                result = await whatsappService.sendIntervalWorkout(
                    targetPhone,
                    '4',
                    '800m',
                    '90 sec',
                    'Zone 4 (155-165 bpm)'
                );
                break;
            
            case 'long_run':
                result = await whatsappService.sendLongRun(
                    targetPhone,
                    '16km',
                    '1 hour 30 min',
                    'Zone 2-3 (130-150 bpm)'
                );
                break;
            
            case 'tempo':
                result = await whatsappService.sendTempoRun(
                    targetPhone,
                    '10km',
                    '50 min',
                    '5:00/km',
                    'Zone 3-4 (145-160 bpm)'
                );
                break;
            
            case 'threshold':
                result = await whatsappService.sendThresholdRun(
                    targetPhone,
                    '8km',
                    '40 min',
                    '5:00/km',
                    'Zone 4 (155-165 bpm)'
                );
                break;
            
            case 'fartlek':
                result = await whatsappService.sendFartlekRun(
                    targetPhone,
                    '45 min',
                    '8x (2 min fast, 2 min easy)',
                    'Zone 2-4 (130-165 bpm)'
                );
                break;
            
            case 'strides':
                result = await whatsappService.sendStridesWorkout(
                    targetPhone,
                    '6',
                    '100m',
                    '90 sec'
                );
                break;
            
            // ✅ Payment Templates
            case 'payment_reminder':
                result = await whatsappService.sendPaymentReminder(
                    targetPhone,
                    '3',
                    '₹399'
                );
                break;
            
            case 'payment_success':
                const nextMonth = new Date();
                nextMonth.setMonth(nextMonth.getMonth() + 1);
                result = await whatsappService.sendPaymentSuccess(
                    targetPhone,
                    '₹399',
                    'Basic Coach',
                    nextMonth.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                );
                break;
            
            case 'payment_failed':
                result = await whatsappService.sendPaymentFailed(
                    targetPhone,
                    '₹399',
                    'Insufficient funds'
                );
                break;
            
            // ✅ Onboarding & Account
            case 'account_setup':
                result = await whatsappService.sendAccountSetup(
                    targetPhone,
                    'https://zonetrain.app/strava/connect',
                    'https://zonetrain.app/dashboard'
                );
                break;
            
            case 'subscription_expired':
                result = await whatsappService.sendSubscriptionExpired(
                    targetPhone,
                    today,
                    'https://zonetrain.app/upgrade'
                );
                break;
            
            default:
                return res.status(400).json({ 
                    success: false, 
                    error: `Invalid template type: ${templateType}. Valid options: hello, recovery, easy_run, interval, long_run, tempo, threshold, fartlek, strides, payment_reminder, payment_success, payment_failed, account_setup, subscription_expired` 
                });
        }

        res.json({
            success: true,
            templateType,
            phone: targetPhone,
            result
        });
    } catch (error) {
        console.error('Test template error:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
});

// ✅ Test Connection
app.get('/api/test/whatsapp-connection', async (req, res) => {
    try {
        const result = await whatsappService.testConnection();
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ✅ Send Workout Reminder Based on Actual User Data
app.post('/api/whatsapp/send-workout', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        const { workoutId } = req.body;

        // Get user phone
        const userDoc = await db.collection('users').doc(userId).get();
        const user = userDoc.data();

        if (!user.phoneNumber || !user.whatsappOptIn) {
            return res.status(400).json({ 
                success: false, 
                error: 'WhatsApp notifications not enabled or phone number missing' 
            });
        }

        // Get workout details
        const workoutDoc = await db.collection('workouts').doc(workoutId).get();
        if (!workoutDoc.exists) {
            return res.status(404).json({ success: false, error: 'Workout not found' });
        }

        const workout = workoutDoc.data();
        let result;

        // Send appropriate template based on workout type
        switch (workout.type) {
            case 'easy':
                result = await whatsappService.sendEasyRunReminder(
                    user.phoneNumber,
                    workout.distance || '8km',
                    workout.duration || '45 min',
                    workout.pace || '5:30/km',
                    workout.zone || 'Zone 2'
                );
                break;
            
            case 'interval':
                result = await whatsappService.sendIntervalWorkout(
                    user.phoneNumber,
                    workout.sets || '4',
                    workout.intervals || '800m',
                    workout.recovery || '90 sec',
                    workout.zone || 'Zone 4'
                );
                break;
            
            case 'long':
                result = await whatsappService.sendLongRun(
                    user.phoneNumber,
                    workout.distance || '16km',
                    workout.duration || '1:30',
                    workout.zone || 'Zone 2-3'
                );
                break;
            
            case 'tempo':
                result = await whatsappService.sendTempoRun(
                    user.phoneNumber,
                    workout.distance || '10km',
                    workout.duration || '50 min',
                    workout.pace || '5:00/km',
                    workout.zone || 'Zone 3-4'
                );
                break;
            
            default:
                return res.status(400).json({ 
                    success: false, 
                    error: `Unsupported workout type: ${workout.type}` 
                });
        }

        // Log the notification
        await db.collection('notifications').add({
            userId,
            type: 'workout',
            workoutId,
            channel: 'whatsapp',
            sent: result.success,
            messageId: result.messageId,
            error: result.error,
            createdAt: new Date()
        });

        res.json(result);
    } catch (error) {
        console.error('Send workout error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ✅ Bulk Send Morning Recovery Check
app.post('/api/whatsapp/send-recovery-bulk', authenticateToken, async (req, res) => {
    try {
        // Only allow admins
        const userDoc = await db.collection('users').doc(req.user.userId).get();
        if (userDoc.data().role !== 'admin') {
            return res.status(403).json({ success: false, error: 'Admin access required' });
        }

        const today = new Date().toLocaleDateString('en-US', { 
            weekday: 'long', 
            month: 'short', 
            day: 'numeric' 
        });

        // Get all active users with WhatsApp enabled
        const usersSnapshot = await db.collection('users')
            .where('whatsappOptIn', '==', true)
            .where('subscriptionStatus', '==', 'active')
            .get();

        const results = {
            total: usersSnapshot.size,
            sent: 0,
            failed: 0,
            errors: []
        };

        for (const doc of usersSnapshot.docs) {
            const user = doc.data();
            
            if (user.phoneNumber) {
                try {
                    const result = await whatsappService.sendRecoveryCheck(
                        user.phoneNumber
                    );

                    if (result.success) {
                        results.sent++;
                    } else {
                        results.failed++;
                        results.errors.push({
                            userId: doc.id,
                            phone: user.phoneNumber,
                            error: result.error
                        });
                    }

                    // Rate limiting - 1 message per second
                    await new Promise(resolve => setTimeout(resolve, 1000));
                } catch (error) {
                    results.failed++;
                    results.errors.push({
                        userId: doc.id,
                        phone: user.phoneNumber,
                        error: error.message
                    });
                }
            }
        }

        res.json({
            success: true,
            results
        });
    } catch (error) {
        console.error('Bulk send error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});


// Test WhatsApp with Meta's hello_world template
app.get('/test/whatsapp', async (req, res) => {
    try {
        const whatsapp = new WhatsAppService();
        
        // Test connection first
        const connectionTest = await whatsapp.testConnection();
        console.log('Connection test:', connectionTest);
        
        // Send hello_world template to your number
        const result = await whatsapp.sendTemplateMessage(
            '+919711317547',  // Your number
            'hello_world',    // Meta's pre-approved template
            'en_US'
        );
        
        res.json({
            connectionTest,
            messageResult: result
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Test with custom message (after 24-hour window opens)
app.get('/test/whatsapp-custom', async (req, res) => {
    try {
        const whatsapp = new WhatsAppService();
        const message = req.query.message || '🏃‍♂️ Test from ZoneTrain!';
        
        const result = await whatsapp.sendMessage('+919711317547', message);
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==================== SUBSCRIPTION & PAYMENT ROUTES ====================

// Import services at the top of app.js

const SubscriptionService = require('./services/subscriptionService');
const PaymentReminderService = require('./services/paymentReminderService');

const razorpayService = require('./services/razorpayService');
const subscriptionService = new SubscriptionService(db, razorpayService);
const reminderService = new PaymentReminderService(db, subscriptionService);

// Start payment reminder scheduler
reminderService.start();
console.log('✅ Payment reminder service started');

// ==================== PROMO CODE VALIDATION ====================

// Validate promo code
app.post('/api/subscription/validate-promo', async (req, res) => {
    try {
        const { promoCode, transactionType, plan, billingCycle } = req.body;

        console.log('🎟️ Validating promo code:', promoCode);

        const validation = subscriptionService.validatePromoCode(promoCode, transactionType);
        
        if (!validation.valid) {
            return res.json({ 
                success: false, 
                message: validation.error 
            });
        }

        // Calculate discount
        const originalAmount = subscriptionService.pricing[plan][billingCycle];
        const discountResult = subscriptionService.applyPromoCode(originalAmount, promoCode);

        res.json({
            success: true,
            valid: true,
            description: validation.description,
            originalAmount: originalAmount,
            discountAmount: discountResult.discountAmount,
            discountedAmount: discountResult.discountedAmount,
            discountPercent: discountResult.discountPercent
        });
    } catch (error) {
        console.error('Validate promo error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ==================== RENEWAL FLOW ====================

// Get renewal information
app.get('/api/subscription/renewal-info', async (req, res) => {
    try {
        const { token } = req.query;

        //console.log('📋 Getting renewal info for token:', token);

        // Validate token
        const validation = await reminderService.validateRenewalToken(token);
        if (!validation.valid) {
            return res.status(400).json({ success: false, message: validation.error });
        }

        const userDoc = await db.collection('users').doc(validation.userId).get();
        const user = { id: userDoc.id, ...userDoc.data() };

        // Calculate days remaining
        const endDate = new Date(user.subscriptionEndDate);
        const today = new Date();
        const daysRemaining = Math.ceil((endDate - today) / (1000 * 60 * 60 * 24));

        // Get renewal options
        const renewalOptions = subscriptionService.getRenewalOptions(user);

        res.json({
            success: true,
            user: {
                firstName: user.firstName,
                email: user.email,
                currentPlan: user.currentPlan,
                billingCycle: user.billingCycle,
                subscriptionEndDate: user.subscriptionEndDate
            },
            renewalOptions,
            daysRemaining
        });
    } catch (error) {
        console.error('❌ Renewal info error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Create renewal order
app.post('/api/subscription/create-renewal-order', async (req, res) => {
    try {
        const { token, plan, billingCycle } = req.body;

        //console.log('💳 Creating renewal order:', { token, plan, billingCycle });

        const validation = await reminderService.validateRenewalToken(token);
        if (!validation.valid) {
            return res.status(400).json({ success: false, message: validation.error });
        }

        const userId = validation.userId;
        const userDoc = await db.collection('users').doc(userId).get();
        const user = { id: userDoc.id, ...userDoc.data() };

        // Get pricing
        const amount = subscriptionService.pricing[plan][billingCycle];

        // Create Razorpay order
        const order = await razorpayService.createOrder({
            amount: amount,
            currency: 'INR',
            receipt: `renewal_${userId}_${Date.now()}`,
            notes: {
                userId,
                type: 'renewal',
                plan,
                billingCycle,
                renewalToken: token
            }
        });

        console.log('✅ Renewal order created:', order.id);

        res.json({
            success: true,
            order: {
                orderId: order.id,
                amount: order.amount,
                currency: order.currency,
                razorpayKeyId: process.env.RAZORPAY_KEY_ID,
                plan,
                email: user.email
            }
        });
    } catch (error) {
        console.error('❌ Create renewal order error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Verify renewal payment
app.post('/api/subscription/verify-renewal', async (req, res) => {
    try {
        const { token, paymentId, orderId, signature } = req.body;

        //console.log('🔍 Verifying renewal payment:', { token, paymentId, orderId });

        // Verify signature
        const isValid = razorpayService.verifySignature(orderId, paymentId, signature);
        if (!isValid) {
            return res.status(400).json({ success: false, message: 'Invalid payment signature' });
        }

        const validation = await reminderService.validateRenewalToken(token);
        if (!validation.valid) {
            return res.status(400).json({ success: false, message: validation.error });
        }

        const userId = validation.userId;
        const order = await razorpayService.getOrder(orderId);
        const { plan, billingCycle } = order.notes;

        // Calculate new end date
        const newEndDate = new Date();
        const months = billingCycle === 'annual' ? 12 : billingCycle === 'quarterly' ? 3 : 1;
        newEndDate.setMonth(newEndDate.getMonth() + months);

        // Update user subscription
        await db.collection('users').doc(userId).update({
            currentPlan: plan,
            billingCycle: billingCycle,
            subscriptionStatus: 'active',
            subscriptionStartDate: new Date(),
            subscriptionEndDate: newEndDate,
            lastPaymentDate: new Date(),
            lastPaymentAmount: order.amount / 100,
            renewalReminderSent: false,
            updatedAt: new Date()
        });

        // Mark token as used
        await db.collection('renewal_tokens').doc(token).update({ 
            used: true,
            usedAt: new Date()
        });

        // Log transaction
        await db.collection('transactions').add({
            userId,
            type: 'renewal',
            plan,
            amount: order.amount / 100,
            currency: 'INR',
            paymentId,
            orderId,
            status: 'success',
            billingCycle,
            createdAt: new Date()
        });

        console.log('✅ Renewal verified and applied');

        res.json({ 
            success: true, 
            message: 'Subscription renewed successfully!',
            validUntil: newEndDate
        });
    } catch (error) {
        console.error('❌ Verify renewal error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ==================== SUBSCRIPTION MANAGEMENT ====================

// Get subscription details
app.get('/api/subscription/details', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;

        const userDoc = await db.collection('users').doc(userId).get();
        const user = userDoc.data();

        // Get latest transaction
        const transactionsSnapshot = await db.collection('transactions')
            .where('userId', '==', userId)
            .orderBy('createdAt', 'desc')
            .limit(5)
            .get();

        const transactions = transactionsSnapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        }));

        res.json({
            success: true,
            subscription: {
                status: user.subscriptionStatus || 'free',
                currentPlan: user.currentPlan || null,
                billingCycle: user.billingCycle || null,
                subscriptionEndDate: user.subscriptionEndDate || null,
                lastPaymentDate: user.lastPaymentDate || null,
                lastPaymentAmount: user.lastPaymentAmount || null,
                totalSavingsFromPromos: user.totalSavingsFromPromos || 0
            },
            transactions: transactions
        });
    } catch (error) {
        console.error('Get subscription details error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Cancel subscription
app.post('/api/subscription/cancel', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        const { reason } = req.body;

        console.log('❌ Cancelling subscription:', { userId, reason });

        const userDoc = await db.collection('users').doc(userId).get();
        const user = userDoc.data();

        await db.collection('users').doc(userId).update({
            subscriptionStatus: 'cancelled',
            cancelledAt: new Date(),
            cancelReason: reason || 'Not provided',
            // Keep access until end of billing period
            accessUntil: user.subscriptionEndDate || new Date()
        });

        // Log cancellation
        await db.collection('transactions').add({
            userId,
            type: 'cancellation',
            plan: user.currentPlan,
            reason: reason,
            cancelledAt: new Date(),
            accessUntil: user.subscriptionEndDate,
            status: 'completed',
            createdAt: new Date()
        });

        console.log('✅ Subscription cancelled');

        res.json({
            success: true,
            message: 'Subscription cancelled. You will have access until ' + 
                     (user.subscriptionEndDate ? new Date(user.subscriptionEndDate).toLocaleDateString() : 'end of billing period'),
            accessUntil: user.subscriptionEndDate
        });
    } catch (error) {
        console.error('Cancel subscription error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

console.log('✅ All subscription routes initialized');

// Race status endpoints
app.get('/api/race/status', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        
        const userDoc = await db.collection('users').doc(userId).get();
        const user = userDoc.data();
        
        let raceCompleted = false;
        let completedRaceName = '';
        
        if (user.activeRace) {
            const raceDate = new Date(user.activeRace.date);
            const today = new Date();
            
            if (today > raceDate) {
                raceCompleted = true;
                completedRaceName = user.activeRace.name;
            }
        }
        
        res.json({
            success: true,
            raceCompleted,
            completedRaceName,
            postRaceDismissed: user.postRaceDismissed || false
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.post('/api/race/dismiss-banner', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        
        await db.collection('users').doc(userId).update({
            postRaceDismissed: true
        });
        
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.post('/api/race/create', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        const { name, date, distance, goalTime } = req.body;
        
        // Create new race
        const raceData = {
            name,
            date,
            distance: parseFloat(distance),
            goalTime,
            createdAt: new Date(),
            status: 'active'
        };
        
        // Update user's active race
        await db.collection('users').doc(userId).update({
            activeRace: raceData,
            postRaceDismissed: false
        });
        
        // Create notification
        await db.collection('notifications').add({
            userId,
            type: 'race',
            title: '🏁 New Race Goal Set',
            message: `Training plan for ${name} is being generated. Check back in a few minutes!`,
            read: false,
            createdAt: new Date()
        });
        
        // TODO: Trigger training plan generation
        
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Helper function
function getTimeAgo(date) {
    const seconds = Math.floor((new Date() - date) / 1000);
    
    if (seconds < 60) return 'Just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
    return date.toLocaleDateString();
}

// Serve notifications page
app.get('/notifications', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'notifications.html'));
});

// Mark workout as complete
app.post('/api/workouts/:workoutId/complete', authenticateToken, async (req, res) => {
    try {
        const { workoutId } = req.params;
        const userId = req.user.userId;

        // Verify workout belongs to user
        const workoutRef = db.collection('workouts').doc(workoutId);
        const workout = await workoutRef.get();

        if (!workout.exists || workout.data().userId !== userId) {
            return res.status(404).json({ success: false, error: 'Workout not found' });
        }

        // Update workout status
        await workoutRef.update({
            status: 'completed',
            completedAt: new Date(),
            updatedAt: new Date()
        });

        res.json({
            success: true,
            message: 'Workout marked as complete'
        });
    } catch (error) {
        console.error('Error completing workout:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Email verification endpoint
app.get('/verify-email', async (req, res) => {
    try {
        const { token } = req.query;

        if (!token) {
            return res.status(400).send(`
                <!DOCTYPE html>
                <html>
                <head>
                    <title>Verification Failed</title>
                    <style>
                        body { font-family: Arial; text-align: center; padding: 50px; }
                        .error { color: #EF4444; }
                    </style>
                </head>
                <body>
                    <h1 class="error">❌ Verification Failed</h1>
                    <p>No verification token provided.</p>
                    <a href="/login">Go to Login</a>
                </body>
                </html>
            `);
        }

        const result = await userManager.verifyEmailToken(token);

        if (result.success) {
            return res.send(`
                <!DOCTYPE html>
                <html>
                <head>
                    <title>Email Verified</title>
                    <style>
                        body { 
                            font-family: Arial; 
                            text-align: center; 
                            padding: 50px;
                            background: linear-gradient(135deg, #6B46C1 0%, #8B5CF6 100%);
                            color: white;
                        }
                        .success { 
                            background: white; 
                            color: #10B981; 
                            padding: 40px; 
                            border-radius: 10px;
                            max-width: 500px;
                            margin: 0 auto;
                        }
                        .button {
                            display: inline-block;
                            background: #6B46C1;
                            color: white;
                            padding: 15px 30px;
                            text-decoration: none;
                            border-radius: 5px;
                            margin-top: 20px;
                        }
                    </style>
                </head>
                <body>
                    <div class="success">
                        <h1>✅ Email Verified!</h1>
                        <p>${result.alreadyVerified ? 'Your email was already verified.' : 'Your email has been successfully verified.'}</p>
                        <p>You can now log in and start using ZoneTrain.</p>
                        <a href="/login" class="button">Go to Login</a>
                    </div>
                </body>
                </html>
            `);
        }

    } catch (error) {
        console.error('Verification error:', error);
        
        return res.status(400).send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Verification Failed</title>
                <style>
                    body { font-family: Arial; text-align: center; padding: 50px; }
                    .error { color: #EF4444; }
                </style>
            </head>
            <body>
                <h1 class="error">❌ Verification Failed</h1>
                <p>${error.message}</p>
                <a href="/resend-verification">Resend Verification Email</a>
            </body>
            </html>
        `);
    }
});

// Resend verification email endpoint
app.post('/api/auth/resend-verification', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;

        await userManager.resendVerificationEmail(userId);

        res.json({
            success: true,
            message: 'Verification email sent. Please check your inbox.'
        });

    } catch (error) {
        console.error('Resend verification error:', error);
        res.status(400).json({
            success: false,
            message: error.message
        });
    }
});

// Check email verification status
app.get('/api/auth/email-verification-status', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        const user = await userManager.getUserById(userId);

        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        res.json({
            success: true,
            emailVerified: user.emailVerified || false,
            email: user.email
        });

    } catch (error) {
        console.error('Check verification status error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to check verification status'
        });
    }
});


// Add this to your existing app.js
// Add this route to your app.js (after your existing routes)
app.get('/plans', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'plans.html'));
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
        //console.log('✅ Training plan found:', planSnapshot.docs[0].id);
        
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
        
        // 1. FREE TEST USER
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
            } else {
                console.error('❌ Error creating free user:', error.message);
            }
        }
        
        // 2. BASIC COACH TEST USER
        try {
            const basicUser = await userManager.createUser({
                email: 'basic@test.com',
                password: 'password123',
                firstName: 'Basic',
                lastName: 'Coach',
                phoneNumber: null
            });
            
            // Upgrade to basic plan
            await userManager.updateUser(basicUser.id, {
                subscriptionStatus: 'active',
                currentPlan: 'basic',
                currentPrice: 299,
                originalPrice: 299,
                planStartDate: new Date()
            });
            console.log('✅ Basic Coach test user created and upgraded');
        } catch (error) {
            if (error.message === 'User already exists') {
                // Find existing user and upgrade
                const existingUser = await userManager.getUserByEmail('basic@test.com');
                if (existingUser) {
                    await userManager.updateUser(existingUser.id, {
                        subscriptionStatus: 'active',
                        currentPlan: 'basic',
                        currentPrice: 299,
                        originalPrice: 299,
                        planStartDate: new Date()
                    });
                    console.log('✅ Basic Coach test user upgraded');
                }
            } else {
                console.error('❌ Error creating basic user:', error.message);
            }
        }
        
        // 3. RACE COACH TEST USER
        try {
            const raceUser = await userManager.createUser({
                email: 'race@test.com',
                password: 'password123',
                firstName: 'Race',
                lastName: 'Coach',
                phoneNumber: null
            });
            
            // Upgrade to race plan
            await userManager.updateUser(raceUser.id, {
                subscriptionStatus: 'active',
                currentPlan: 'race',
                currentPrice: 599,
                originalPrice: 599,
                planStartDate: new Date()
            });
            console.log('✅ Race Coach test user created and upgraded');
        } catch (error) {
            if (error.message === 'User already exists') {
                // Find existing user and upgrade
                const existingUser = await userManager.getUserByEmail('race@test.com');
                if (existingUser) {
                    await userManager.updateUser(existingUser.id, {
                        subscriptionStatus: 'active',
                        currentPlan: 'race',
                        currentPrice: 599,
                        originalPrice: 599,
                        planStartDate: new Date()
                    });
                    console.log('✅ Race Coach test user upgraded');
                }
            } else {
                console.error('❌ Error creating race user:', error.message);
            }
        }
        
        // Also update your existing premium user to basic
        try {
            const premiumUser = await userManager.getUserByEmail('premium@test.com');
            if (premiumUser) {
                await userManager.updateUser(premiumUser.id, {
                    subscriptionStatus: 'active',
                    currentPlan: 'basic',  // Changed from 'fitness' to 'basic'
                    currentPrice: 299,
                    originalPrice: 299,
                    planStartDate: new Date()
                });
                console.log('✅ Premium test user updated to basic plan');
            }
        } catch (error) {
            console.log('ℹ️ Premium user not found or already updated');
        }
        
        console.log('\n🎉 All test users ready!');
        console.log('📧 Login credentials (all use password: password123):');
        console.log('   • free@test.com → Free Dashboard');
        console.log('   • basic@test.com → Basic Coach Dashboard');
        console.log('   • race@test.com → Race Coach Dashboard');
        console.log('   • premium@test.com → Basic Coach Dashboard\n');
        
    } catch (error) {
        console.error('❌ Error initializing test users:', error);
    }
}

// Initialize test users (this line should already exist)
initializeTestUsers();


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

// Complete Login Route with Block Check and Countdown

app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        console.log('🔄 Login attempt for:', email);
        
        // Authenticate user
        const result = await userManager.authenticateUser(email, password);
        
        if (result && result.user && result.token) {
            console.log('✅ Authentication successful for:', email);
            
            // ✅ NEW: Validate and sanitize token immediately
            const rawToken = result.token;
            const cleanToken = rawToken.trim(); // Remove whitespace
            
            // Validate token structure
            const tokenParts = cleanToken.split('.');
            if (tokenParts.length !== 3) {
                //console.error('❌ CRITICAL: Token generated with invalid structure!');
                //console.error('   Expected 3 parts, got:', tokenParts.length);
                //console.error('   Raw token length:', rawToken.length);
                //console.error('   Clean token length:', cleanToken.length);
                //console.error('   Token preview:', cleanToken.substring(0, 50) + '...');
                
                return res.status(500).json({
                    success: false,
                    message: 'Token generation failed. Please try again.',
                    code: 'TOKEN_GENERATION_ERROR'
                });
            }
            
            // ✅ NEW: Log token validation details
            //console.log('🔐 Token validation:');
            //console.log('   Raw length:', rawToken.length);
           // console.log('   Clean length:', cleanToken.length);
           // console.log('   Whitespace removed:', rawToken.length - cleanToken.length, 'chars');
            //console.log('   Structure: ✅ Valid (3 parts)');
            //console.log('   Preview:', cleanToken.substring(0, 30) + '...');
            //console.log('   Header part length:', tokenParts[0].length);
            //console.log('   Payload part length:', tokenParts[1].length);
            //console.log('   Signature part length:', tokenParts[2].length);
            
            // ✅ NEW: Verify token can be decoded (self-test)
            try {
                const decoded = jwt.verify(cleanToken, process.env.JWT_SECRET);
                //console.log('✅ Token self-test passed');
                //console.log('   User ID in token:', decoded.userId);
                //console.log('   Email in token:', decoded.email);
                //console.log('   Expires:', decoded.exp ? new Date(decoded.exp * 1000).toLocaleString() : 'Never');
            } catch (verifyError) {
                console.error('❌ CRITICAL: Generated token failed self-verification!');
                console.error('   Error:', verifyError.message);
                console.error('   This indicates JWT_SECRET mismatch or corruption');
                
                return res.status(500).json({
                    success: false,
                    message: 'Token generation failed verification. Please contact support.',
                    code: 'TOKEN_VERIFICATION_FAILED'
                });
            }
            
            // **CHECK IF ACCOUNT IS BLOCKED/INACTIVE**
            if (result.user.active === false) {
                console.log('🚫 Account blocked:', email);
                
                const blockReason = result.user.blockedReason || 'Account has been deactivated';
                
                return res.status(403).json({
                    success: false,
                    blocked: true,
                    message: blockReason,
                    help: 'Please contact support if you believe this is an error.'
                });
            }
            
            console.log('📧 Email verified:', result.user.emailVerified);
            console.log('📊 Subscription status:', result.user.subscriptionStatus);
            console.log('👤 Account active:', result.user.active !== false);
            
            // ✅ Set token as HTTP-only cookie with CLEAN token
            res.cookie('userToken', cleanToken, {
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production',
                maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
                sameSite: 'lax',
                path: '/'
            });
            
            //console.log('🍪 Token set as cookie (sanitized)');
            
            // Check email verification status
            const isEmailVerified = result.user.emailVerified || false;
            const authProvider = result.user.authProvider || 'email';
            
            // OAuth users (Google/Facebook) are auto-verified, skip check
            const requiresVerification = authProvider === 'email' && !isEmailVerified;
            
            if (requiresVerification) {
                console.log('⚠️ Email not verified for:', email);
                
                // Calculate hours remaining until account block
                let hoursRemaining = null;
                if (result.user.createdAt) {
                    const createdAt = result.user.createdAt.toDate 
                        ? result.user.createdAt.toDate() 
                        : new Date(result.user.createdAt);
                    const hoursSinceCreation = (Date.now() - createdAt.getTime()) / (1000 * 60 * 60);
                    hoursRemaining = Math.max(0, Math.floor(24 - hoursSinceCreation));
                    
                    console.log(`⏰ Hours remaining until block: ${hoursRemaining}`);
                }
                
                return res.json({
                    success: true,
                    token: cleanToken, // ✅ Return CLEAN token
                    user: {
                        id: result.user.id,
                        email: result.user.email,
                        firstName: result.user.firstName,
                        subscriptionStatus: result.user.subscriptionStatus || 'free',
                        currentPlan: result.user.currentPlan,
                        emailVerified: false
                    },
                    emailVerified: false,
                    requiresVerification: true,
                    hoursRemaining: hoursRemaining,
                    userType: result.user.subscriptionStatus === 'active' ? 'premium' : 'free',
                    message: hoursRemaining !== null && hoursRemaining < 2 
                        ? `⚠️ URGENT: Verify your email within ${hoursRemaining} hour(s) or your account will be blocked!`
                        : 'Please verify your email address. Account will be blocked if not verified within 24 hours.',
                    redirect: '/dashboard?verify=required'
                });
            }
            
            // Email is verified or OAuth login - full access
            console.log('✅ Login complete for verified user:', email);
            
            const response = {
                success: true,
                token: cleanToken, // ✅ Return CLEAN token
                user: {
                    id: result.user.id,
                    email: result.user.email,
                    firstName: result.user.firstName,
                    lastName: result.user.lastName,
                    subscriptionStatus: result.user.subscriptionStatus || 'free',
                    currentPlan: result.user.currentPlan,
                    emailVerified: isEmailVerified
                },
                emailVerified: true,
                requiresVerification: false,
                userType: result.user.subscriptionStatus === 'active' ? 'premium' : 'free',
                message: 'Login successful',
                redirect: '/dashboard'
            };
            
            return res.json(response);
            
        } else {
            console.log('❌ Authentication failed for:', email);
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
    const userId = req.user.userId;
    
    // Get user document
    const userDoc = await db.collection('users').doc(userId).get();
    
    if (!userDoc.exists) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const userData = userDoc.data();
    
    // Try to get analytics, but don't fail if unavailable
    let analytics = null;
    try {
      analytics = await userManager.getUserAnalytics(userId);
    } catch (analyticsError) {
      // Log for monitoring, but don't expose to user
      console.warn(`Analytics unavailable for user ${userId}:`, analyticsError.code || analyticsError.message);
      // Analytics will be null - that's fine
    }

    // Always return success with available data
    res.json({
      success: true,
      data: analytics,  // Will be null if unavailable
      email: userData.email,
      name: userData.name || userData.email.split('@')[0],
      planType: userData.planType || 'free',
      raceDate: userData.raceDate || null,
      raceName: userData.raceName || null,
      raceDistance: userData.raceDistance || null,
      stravaConnected: !!userData.stravaRefreshToken,
      createdAt: userData.createdAt
    });
  } catch (error) {
    console.error('Profile fetch error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch profile'
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
        const userId = req.user.userId;
        const { planType } = req.body;

        console.log('🎁 Starting trial for:', { userId, planType });

        // Validate plan type
        const validPlans = ['basic', 'race'];
        if (!validPlans.includes(planType)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid plan type'
            });
        }

        // Check if user already has trial/subscription
        const userDoc = await db.collection('users').doc(userId).get();
        const user = userDoc.data();

        if (user.currentPlan && user.currentPlan !== 'free') {
            return res.status(400).json({
                success: false,
                message: 'User already has an active subscription'
            });
        }

        // NEW: Check if trial was already used
        if (user.trialUsed) {
            return res.status(400).json({
                success: false,
                message: 'Trial already used. Please subscribe to continue.'
            });
        }

        const trialEndDate = new Date();
        trialEndDate.setDate(trialEndDate.getDate() + 14); // CHANGED: 14-day trial

        await db.collection('users').doc(userId).update({
            currentPlan: planType,
            subscriptionStatus: 'trial',
            trialStartDate: new Date(),
            trialEndDate: trialEndDate,
            trialUsed: true, // NEW: Mark trial as used
            updatedAt: new Date()
        });

        // Track trial start
        await db.collection('transactions').add({
            userId,
            type: 'trial_start',
            plan: planType,
            trialEndDate: trialEndDate,
            status: 'active',
            createdAt: new Date()
        });

        console.log('✅ Trial started:', { userId, planType, endDate: trialEndDate });

        res.json({
            success: true,
            message: 'Trial started successfully',
            trialEndDate: trialEndDate
        });
    } catch (error) {
        console.error('❌ Trial start error:', error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// Check if user is eligible for trial
app.get('/api/subscription/trial-eligibility', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    
    const userDoc = await db.collection('users').doc(userId).get();
    const user = userDoc.data();
    
    const isEligible = (
      (!user.trialUsed || user.trialUsed === false) && 
      (user.currentPlan === 'free' || !user.currentPlan) &&
      user.subscriptionStatus !== 'active'
    );
    
    res.json({
      success: true,
      eligible: isEligible,
      reason: isEligible ? null : (
        user.trialUsed ? 'Trial already used' : 
        user.subscriptionStatus === 'active' ? 'Already subscribed' : 
        'Unknown'
      ),
      currentPlan: user.currentPlan || 'free',
      subscriptionStatus: user.subscriptionStatus || 'free'
    });
    
  } catch (error) {
    console.error('Trial eligibility check error:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});



app.post('/api/subscription/upgrade', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        const { newPlan, billingCycle, promoCode } = req.body;

        console.log('💰 Processing upgrade:', { userId, newPlan, billingCycle, promoCode });

        // Validate inputs
        if (!newPlan || !billingCycle) {
            return res.status(400).json({
                success: false,
                message: 'newPlan and billingCycle are required'
            });
        }

        // ✅ Validate plan exists in pricing
        if (!subscriptionService.pricing[newPlan]) {
            return res.status(400).json({
                success: false,
                message: `Invalid plan: ${newPlan}`
            });
        }

        // ✅ Validate billing cycle
        const validCycles = ['monthly', 'quarterly', 'annual'];
        if (!validCycles.includes(billingCycle)) {
            return res.status(400).json({
                success: false,
                message: `Invalid billing cycle. Must be: ${validCycles.join(', ')}`
            });
        }

        const userDoc = await db.collection('users').doc(userId).get();
        if (!userDoc.exists) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        const user = { id: userDoc.id, ...userDoc.data() };

        // ✅ Check if already on same plan
        if (user.currentPlan === newPlan && user.billingCycle === billingCycle) {
            return res.status(400).json({
                success: false,
                message: 'User already has this plan'
            });
        }

        // Calculate final amount with promo
        const calculation = subscriptionService.calculateProRataUpgrade(
            user,
            newPlan,
            billingCycle,
            promoCode || null
        );

        console.log('Calculated amount to pay:', calculation.amountToPay);

        // Create Razorpay order
        const order = await razorpayService.createOrder({
            amount: calculation.amountToPay,
            currency: 'INR',
            receipt: `upgrade_${userId}_${Date.now()}`,
            notes: {
                userId,
                type: 'upgrade',
                fromPlan: user.currentPlan || 'free',
                toPlan: newPlan,
                billingCycle,
                promoCode: promoCode || 'none',
                originalAmount: calculation.originalAmount || calculation.proRataCharge,
                discountAmount: calculation.promoApplied?.discountAmount || 0,
                discountPercent: calculation.promoApplied?.discount || 0
            }
        });

        //console.log('✅ Order created:', order.id);

        res.json({
            success: true,
            paymentOrder: {
                orderId: order.id,
                amount: order.amount,
                currency: order.currency,
                razorpayKeyId: process.env.RAZORPAY_KEY_ID,
                plan: newPlan,
                billingCycle: billingCycle,
                email: user.email
            }
        });
    } catch (error) {
        console.error('❌ Upgrade error:', error);
        res.status(500).json({ 
            success: false, 
            message: error.message 
        });
    }
});


app.get('/api/subscription', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        console.log('🔍 Fetching subscription for user:', userId);

        const userDoc = await db.collection('users').doc(userId).get();

        if (!userDoc.exists) {
            console.error('❌ User not found:', userId);
            return res.status(404).json({ 
                success: false, 
                message: 'User not found' 
            });
        }

        const user = userDoc.data();
        console.log('✅ User found:', user.email);

        // ✅ Get pricing from subscriptionService
        const plan = user.currentPlan || 'free';
        const billingCycle = user.billingCycle || 'monthly';
        let price = 0;

        if (plan !== 'free' && subscriptionService.pricing[plan]) {
            price = subscriptionService.pricing[plan][billingCycle] || 0;
        }

        const subscription = {
            plan: plan,
            status: user.subscriptionStatus || 'active',
            startDate: user.subscriptionStartDate || user.createdAt || new Date(),
            endDate: user.subscriptionEndDate || null,
            price: price,  // ✅ Dynamic pricing
            billingCycle: billingCycle,
            trialEndDate: user.trialEndDate || null,
            isTrialActive: user.subscriptionStatus === 'trial'
        };

        res.json({ 
            success: true, 
            subscription 
        });
    } catch (error) {
        console.error('❌ Subscription fetch error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error fetching subscription: ' + error.message 
        });
    }
});


app.post('/api/subscription/verify-upgrade', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        const { paymentId, orderId, signature } = req.body;

        console.log('🔍 Verifying upgrade payment:', { userId, paymentId, orderId });

        // Verify signature
        const isValid = razorpayService.verifySignature(orderId, paymentId, signature);

        if (!isValid) {
            console.error('❌ Invalid signature');
            return res.status(400).json({ 
                success: false, 
                message: 'Invalid payment signature' 
            });
        }

        // Get order details
        const order = await razorpayService.getOrder(orderId);
        const { toPlan, billingCycle, promoCode, originalAmount, discountAmount } = order.notes;

        //('Order details:', order.notes);

        // Calculate new subscription end date
        const subscriptionEndDate = new Date();
        const months = billingCycle === 'annual' ? 12 : billingCycle === 'quarterly' ? 3 : 1;
        subscriptionEndDate.setMonth(subscriptionEndDate.getMonth() + months);

        // Update user subscription
        await db.collection('users').doc(userId).update({
            currentPlan: toPlan,
            billingCycle: billingCycle,
            subscriptionStatus: 'active',
            subscriptionStartDate: new Date(),
            subscriptionEndDate: subscriptionEndDate,
            lastPaymentDate: new Date(),
            lastPaymentAmount: order.amount / 100,
            renewalReminderSent: false,
            lastPromoCodeUsed: promoCode !== 'none' ? promoCode : null,
            lastPromoDiscount: parseInt(discountAmount) || 0,
            totalSavingsFromPromos: admin.firestore.FieldValue.increment(parseInt(discountAmount) || 0),
            trialStartDate: null,  // ✅ Clear trial dates
            trialEndDate: null,
            updatedAt: new Date()
        });

        // Log transaction
        await db.collection('transactions').add({
            userId,
            type: 'upgrade',
            fromPlan: order.notes.fromPlan,
            toPlan: toPlan,
            amount: order.amount / 100,
            originalAmount: parseInt(originalAmount) || (order.amount / 100),
            discountAmount: parseInt(discountAmount) || 0,
            promoCode: promoCode !== 'none' ? promoCode : null,
            currency: 'INR',
            paymentId,
            orderId,
            status: 'success',
            billingCycle,
            createdAt: new Date()
        });

        console.log('✅ Upgrade verified and applied');

        res.json({
            success: true,
            message: 'Upgrade successful! Your new plan is now active.',
            newPlan: toPlan,
            validUntil: subscriptionEndDate
        });
    } catch (error) {
        console.error('❌ Verify upgrade error:', error);
        res.status(500).json({ 
            success: false, 
            message: error.message 
        });
    }
});

app.post('/api/subscription/downgrade', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        const { newPlan } = req.body;

        console.log('📉 Processing downgrade:', { userId, newPlan });

        // ✅ Validate plan
        if (!subscriptionService.pricing[newPlan]) {
            return res.status(400).json({
                success: false,
                message: `Invalid plan: ${newPlan}`
            });
        }

        const userDoc = await db.collection('users').doc(userId).get();
        if (!userDoc.exists) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        const user = { id: userDoc.id, ...userDoc.data() };

        // Validate downgrade is to lower-cost plan
        const planHierarchy = { free: 0, basic: 1, race: 2 };
        if (planHierarchy[newPlan] >= planHierarchy[user.currentPlan]) {
            return res.status(400).json({
                success: false,
                message: 'Can only downgrade to a lower-tier plan'
            });
        }

        // ✅ Use service method for calculation
        const calculation = subscriptionService.calculateDowngradeWithCredit(user, newPlan);

        console.log('Downgrade calculation:', calculation);

        // Update user subscription
        await db.collection('users').doc(userId).update({
            currentPlan: newPlan,
            subscriptionEndDate: calculation.extendedEndDate,
            previousPlan: user.currentPlan,
            downgradeDate: new Date(),
            creditedDays: calculation.extraDaysGranted,
            updatedAt: new Date()
        });

        // Log transaction
        await db.collection('transactions').add({
            userId,
            type: 'downgrade',
            fromPlan: user.currentPlan,  // ✅ Use actual plan, not calculation.currentPlan
            toPlan: newPlan,
            creditAmount: calculation.creditAmount,
            extraDaysGranted: calculation.extraDaysGranted,
            originalEndDate: calculation.originalEndDate,
            extendedEndDate: calculation.extendedEndDate,
            status: 'completed',
            createdAt: new Date()
        });

        console.log('✅ Downgrade completed');

        res.json({
            success: true,
            message: calculation.message,
            details: {
                newPlan: newPlan,
                extendedEndDate: calculation.extendedEndDate,
                extraDays: calculation.extraDaysGranted,
                savings: calculation.creditAmount
            }
        });
    } catch (error) {
        console.error('❌ Downgrade error:', error);
        res.status(500).json({ 
            success: false, 
            message: error.message 
        });
    }
});

app.post('/api/subscription/cancel', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        const { reason } = req.body;

        console.log('❌ Cancelling subscription for:', userId);

        // Call service method
        const result = await subscriptionService.cancelSubscription(userId, reason);

        console.log('✅ Subscription cancelled');

        res.json({
            success: true,
            message: 'Subscription cancelled successfully. You will have access until ' + result.accessUntil.toDateString(),
            accessUntil: result.accessUntil
        });
    } catch (error) {
        console.error('❌ Cancellation error:', error);
        res.status(500).json({
            success: false,
            message: error.message
        });
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
        let aiProfile = null;
        let aiOnboardingCompleted = false;
        
        try {
            const aiProfileDoc = await db.collection('aiprofiles').doc(userId).get();
            if (aiProfileDoc.exists) {
                aiProfile = aiProfileDoc.data();
                aiOnboardingCompleted = true;
                console.log('✅ AI profile found');
            } else {
                console.log('ℹ️ No AI profile found');
            }
        } catch (e) {
            console.log('ℹ️ No AI profile:', e.message);
        }

        // ✅ Build complete response with all required fields
        res.json({
            success: true,
            user: {
                email: user.email,
                name: user.name || user.firstName || user.displayName || '',
                subscriptionStatus: user.subscriptionStatus || 'free',
                currentPlan: user.currentPlan || user.subscriptionStatus || 'free', // ✅ Add currentPlan
                aiProfile: aiProfile // ✅ Return full AI profile object
            },
            aiProfile: aiProfile, // ✅ Also at top level for easier access
            aiOnboardingCompleted: aiOnboardingCompleted // ✅ Boolean flag
        });
    } catch (error) {
        console.error('❌ Profile error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error fetching profile: ' + error.message 
        });
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
app.post('/api/analyze-zones', authenticateToken, requirePlan(['basic', 'race']), async (req, res) => {try {
            const accessToken = storedTokens.accessToken;
            if (!accessToken) {
                return res.status(401).json({
                    success: false,
                    message: 'Strava not connected'
                });
            }
            try {
                await db.collection('feature_usage').add({
                    userId: userId,
                    feature: 'hrv-coaching',
                    timestamp: new Date(),
                    data: {
                        hrvValue: hrvData?.value,
                        coachingType: coaching.intensity
                    }
                });
            } catch (logError) {
                console.warn('Failed to log usage:', logError.message);
            }
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
app.post('/api/hrv-coaching', authenticateToken, requirePlan(['basic', 'race']), async (req, res) => {
  // HRV coaching functionality
});

// Paid-only feature
app.get('/api/advanced-analytics', authenticateToken, requirePlan(['basic', 'race']), async (req, res) => {
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
// Updated Signup Route with Email Verification
app.post('/api/signup', async (req, res) => {
    try {
        const { email, password, firstName, lastName, referralCode } = req.body;
        
        console.log('📝 Signup attempt for:', email);

        // Validate required fields
        if (!email || !password || !firstName) {
            return res.status(400).json({
                success: false,
                message: 'Email, password, and first name are required'
            });
        }

        // Validate password strength
        const passwordValidation = validatePassword(password);
        if (!passwordValidation.valid) {
            return res.status(400).json({
                success: false,
                message: passwordValidation.message
            });
        }

        // Create user (email validation happens inside createUser)
        const user = await userManager.createUser({
            email,
            password,
            firstName,
            lastName: lastName || '',
            referralCode: referralCode || null,
            provider: 'email'
        });

        console.log('✅ User created successfully:', user.id);

        // Generate JWT token for immediate login
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

        // Set token as HTTP-only cookie
        res.cookie('userToken', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
            sameSite: 'lax',
            path: '/'
        });

        //console.log('🍪 Token set as cookie');
        console.log('📧 Verification email sent to:', email);

        // Return success response
        res.json({
            success: true,
            message: 'Account created successfully! Please check your email to verify your account.',
            token: token,
            user: {
                id: user.id,
                email: user.email,
                firstName: user.firstName,
                lastName: user.lastName,
                emailVerified: false,
                subscriptionStatus: user.subscriptionStatus
            },
            emailVerificationSent: true,
            redirect: '/dashboard?verify=required'
        });

    } catch (error) {
        console.error('❌ Signup error:', error);
        
        // Handle specific error cases
        if (error.message.includes('already exists')) {
            return res.status(400).json({
                success: false,
                message: 'An account with this email already exists. Please login instead.'
            });
        } else if (error.message.includes('domain does not exist')) {
            return res.status(400).json({
                success: false,
                message: 'Please use a valid email address. The email domain does not exist.'
            });
        } else if (error.message.includes('Disposable email')) {
            return res.status(400).json({
                success: false,
                message: 'Disposable email addresses are not allowed. Please use a permanent email address.'
            });
        } else if (error.message.includes('email')) {
            return res.status(400).json({
                success: false,
                message: error.message
            });
        }
        
        res.status(500).json({
            success: false,
            message: 'Signup failed. Please try again later.'
        });
    }
});


// Add these helper functions first


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

// Google OAuth Strategy - Improved with error handling
passport.use(new GoogleStrategy({
  clientID: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  callbackURL: `${process.env.BASE_URL || 'http://localhost:3000'}/auth/google/callback`,
  userProfileURL: 'https://www.googleapis.com/oauth2/v3/userinfo'
}, async (accessToken, refreshToken, profile, done) => {
  try {
    console.log('🔵 Google OAuth callback received');
    //console.log('Profile ID:', profile.id);
   // console.log('Profile emails:', profile.emails);
    
    // Validate email exists
    if (!profile.emails || !profile.emails[0]) {
      console.error('❌ No email provided by Google');
      return done(new Error('EMAIL_NOT_PROVIDED'), null);
    }
    
    const email = profile.emails[0].value;
    //console.log('📧 Email:', email);
    
    // Check if user already exists
    let user = await userManager.getUserByEmail(email);
    
    if (user) {
      // User exists, update their info
      console.log('👤 Existing user found:', user.id);

      const userDoc = await db.collection('users').doc(user.id).get();
      const hasPreferences = userDoc.data().notificationPreferences;
      
      const updateData = {
        googleId: profile.id,
        firstName: profile.name?.givenName || user.firstName,
        lastName: profile.name?.familyName || user.lastName,
        avatar: profile.photos?.[0]?.value || user.avatar,
        lastLogin: new Date(),
        loginCount: (user.loginCount || 0) + 1,
        emailVerified: true,
        authProvider: 'google'
      };
      
      // ✅ Add preferences if missing
      if (!hasPreferences) {
        console.log('⚠️ Preferences missing, initializing now');
        updateData.notificationPreferences = {
          email: true,
          workout: true,
          payment: true,
          recovery: true,
          upgrade: true,
          race: true
        };
      }
      
      await userManager.updateUser(user.id, updateData);
      
      // Refresh user data
      user = await userManager.getUserById(user.id);
      
      // Track login activity
      await userManager.trackActivity(user.id, 'google_login', {
        provider: 'google'
      });
      
      console.log('✅ Existing user logged in via Google');
      return done(null, user);
      
    } else {
      // Create new user with proper OAuth data
      console.log('📝 Creating new user with Google data');
      
      const newUser = await userManager.createOAuthUser({
        googleId: profile.id,
        email: email,
        firstName: profile.name?.givenName || 'User',
        lastName: profile.name?.familyName || '',
        avatar: profile.photos?.[0]?.value || null,
        provider: 'google',
        notificationPreferences: {
          email: true,
          workout: true,
          payment: true,
          recovery: true,
          upgrade: true,
          race: true
        }
      });
      
      console.log('✅ New user created via Google:', newUser.id);
      
      // Track signup activity
      await userManager.trackActivity(newUser.id, 'google_signup', { 
        provider: 'google' 
      });
      
      return done(null, newUser);
    }
    
  } catch (error) {
    console.error('❌ Google OAuth error:', error);
    return done(error, null);
  }
}));

// ==================== GOOGLE OAUTH ROUTES ====================

// Initiate Google OAuth
app.get('/auth/google', (req, res, next) => {
  console.log('🚀 Initiating Google OAuth flow');
  passport.authenticate('google', { 
    scope: ['profile', 'email'],
    session: false
  })(req, res, next);
});

app.get('/auth/google/callback', (req, res, next) => {
  passport.authenticate('google', { 
    session: false,
    failureRedirect: '/login?error=google-failed'
  }, async (err, user, info) => {
    try {
      if (err) {
        console.error('❌ Google OAuth error:', err.message);
        
        if (err.message === 'EMAIL_NOT_PROVIDED') {
          return res.redirect('/login?error=google-no-email');
        }
        
        return res.redirect('/login?error=google-failed');
      }
      
      if (!user) {
        console.error('❌ No user returned from Google OAuth');
        return res.redirect('/login?error=google-failed');
      }
      
     // console.log('✅ Google OAuth successful for user:', user.id);
      
      const token = jwt.sign(
        { 
          userId: user.id, 
          email: user.email,
          plan: user.currentPlan || null,
          status: user.subscriptionStatus || 'free'
        },
        process.env.JWT_SECRET,
        { expiresIn: '7d' }
      );
      
      res.cookie('userToken', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        maxAge: 7 * 24 * 60 * 60 * 1000,
        sameSite: 'lax',
        path: '/'
      });
      
      //console.log('✅ Token set, redirecting through intermediate page to save token in localStorage');

const dashboardUrl = user.currentPlan === 'race'
  ? '/dashboard-race.html'
  : '/dashboard';

res.redirect(`/auth/success?token=${encodeURIComponent(token)}&redirect=${encodeURIComponent(dashboardUrl)}`);

      
    } catch (error) {
      console.error('❌ Google callback error:', error);
      res.redirect('/login?error=google-callback-failed');
    }
  })(req, res, next);
});






const FacebookStrategy = require('passport-facebook').Strategy;

// Facebook OAuth Strategy
passport.use(new FacebookStrategy({
    clientID: process.env.FACEBOOK_APP_ID,
    clientSecret: process.env.FACEBOOK_APP_SECRET,
    callbackURL: `${process.env.BASE_URL || 'http://localhost:3000'}/auth/facebook/callback`,
    profileFields: ['id', 'emails', 'name', 'photos', 'displayName'],
    enableProof: true
}, async (accessToken, refreshToken, profile, done) => {
    try {
        console.log('📘 Facebook OAuth callback received');
        //console.log('Profile ID:', profile.id);
        
        if (!profile.emails || profile.emails.length === 0) {
            console.error('❌ No email provided by Facebook');
            return done(new Error('EMAIL_NOT_PROVIDED'), null);
        }
        
        const email = profile.emails[0].value;
        //console.log('📧 Email:', email);
        
        let user = await userManager.getUserByEmail(email);
        
        if (user) {
            console.log('👤 Existing user found:', user.id);
            
            await userManager.updateUser(user.id, {
                facebookId: profile.id,
                firstName: profile.name?.givenName || user.firstName,
                lastName: profile.name?.familyName || user.lastName,
                avatar: profile.photos?.[0]?.value || user.avatar,
                lastLogin: new Date(),
                loginCount: (user.loginCount || 0) + 1,
                authProvider: 'facebook'
            });
            
            user = await userManager.getUserById(user.id);
            await userManager.trackActivity(user.id, 'facebook_login', { provider: 'facebook' });
            
            console.log('✅ Existing user logged in via Facebook');
            return done(null, user);
            
        } else {
            console.log('📝 Creating new user with Facebook data');
            
            const newUser = await userManager.createOAuthUser({
                facebookId: profile.id,
                email: email,
                firstName: profile.name?.givenName || profile.displayName?.split(' ')[0] || 'User',
                lastName: profile.name?.familyName || profile.displayName?.split(' ')[1] || '',
                avatar: profile.photos?.[0]?.value || null,
                provider: 'facebook'
            });
            
            console.log('✅ New user created via Facebook:', newUser.id);
            await userManager.trackActivity(newUser.id, 'facebook_signup', { provider: 'facebook' });
            
            return done(null, newUser);
        }
        
    } catch (error) {
        console.error('❌ Facebook OAuth error:', error);
        return done(error, null);
    }
}));


// Initiate Facebook login
app.get('/auth/facebook', (req, res, next) => {
  //console.log('🚀 Initiating Facebook OAuth flow');
  passport.authenticate('facebook', { 
    scope: ['email', 'public_profile'],
    session: false
  })(req, res, next);
});

// Facebook OAuth callback with comprehensive error handling
app.get('/auth/facebook/callback', (req, res, next) => {
    passport.authenticate('facebook', { 
        session: false,
        failureRedirect: '/login?error=facebook-failed'
    }, async (err, user, info) => {
        try {
            if (err) {
                console.error('❌ Facebook OAuth error:', err.message);
                
                if (err.message === 'EMAIL_NOT_PROVIDED') {
                    return res.redirect('/login?error=facebook-no-email');
                }
                
                return res.redirect('/login?error=facebook-failed');
            }
            
            if (!user) {
                console.error('❌ No user returned from Facebook OAuth');
                return res.redirect('/login?error=facebook-failed');
            }
            
            //console.log('✅ Facebook OAuth successful for user:', user.id);
            
            const token = jwt.sign(
                { 
                    userId: user.id, 
                    email: user.email,
                    plan: user.currentPlan || null,
                    status: user.subscriptionStatus || 'free'
                },
                process.env.JWT_SECRET,
                { expiresIn: '7d' }
            );
            
            res.cookie('userToken', token, {
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production',
                maxAge: 7 * 24 * 60 * 60 * 1000,
                sameSite: 'lax',
                path: '/'
            });
            
            console.log('✅ Token set, redirecting to dashboard');
            res.redirect('/dashboard?login=facebook');
            
        } catch (error) {
            console.error('❌ Facebook callback error:', error);
            res.redirect('/login?error=facebook-callback-failed');
        }
    })(req, res, next);
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

app.get('/auth/strava', (req, res) => {
    res.redirect('/connect-strava');
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
        
        //console.log('🔄 Exchanging Strava code for token...');
        
        // Exchange code for access token
        const tokenResponse = await axios.post('https://www.strava.com/oauth/token', {
            client_id: process.env.STRAVA_CLIENT_ID,
            client_secret: process.env.STRAVA_CLIENT_SECRET,
            code: code,
            grant_type: 'authorization_code'
        });
        
        const { access_token, refresh_token, athlete } = tokenResponse.data;
        
        //console.log('✅ Strava token received for athlete:', athlete.id);
        
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
    requirePlan(['basic', 'race']), 
    async (req, res) => {
        try {
            // Perform Strava analysis
            const analysisResult = await performStravaAnalysis(req.user.userId);
            
            // Track usage
            try {
                await db.collection('feature_usage').add({
                    userId: userId,
                    feature: 'hrv-coaching',
                    timestamp: new Date(),
                    data: {
                        hrvValue: hrvData?.value,
                        coachingType: coaching.intensity
                    }
                });
            } catch (logError) {
                console.warn('Failed to log usage:', logError.message);
            }

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

// ==================== HRV COACHING API ====================
app.post('/api/coaching/hrv', 
    authenticateToken, 
    requirePlan(['basic', 'race']), 
    async (req, res) => {
        try {
            const { hrvData, additionalData } = req.body;
            const userId = req.user.userId;
            
            console.log('🏃 HRV coaching request from:', userId);
            console.log('📊 HRV data:', hrvData);
            
            // Generate HRV-based coaching via dedicated function
            const coaching = await generateHRVCoaching(userId, hrvData, additionalData);
            
            // Log feature usage for analytics
            try {
                await db.collection('feature_usage').add({
                    userId: userId,
                    feature: 'hrv-coaching',
                    timestamp: new Date(),
                    hrvValue: hrvData?.value,
                    coachingIntensity: coaching.intensity
                });
            } catch (logError) {
                console.warn('⚠️ Failed to log HRV usage:', logError.message);
            }

            console.log('✅ HRV coaching generated:', coaching.intensity);
            res.json({
                success: true,
                coaching: coaching
            });
            
        } catch (error) {
            console.error('❌ HRV coaching error:', error);
            res.status(500).json({
                success: false,
                message: 'Coaching generation failed',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }
);

// Helper function for HRV coaching generation
async function generateHRVCoaching(userId, hrvData, additionalData) {
    try {
        const hrvValue = hrvData?.value || 50;
        const trend = hrvData?.trend || 'stable';
        
        // Determine coaching based on HRV
        let intensity, duration, recommendation;
        
        if (hrvValue > 70) {
            intensity = 'high';
            duration = '60 minutes';
            recommendation = 'Your HRV is excellent! You can handle intense training today. Consider intervals or tempo runs.';
        } else if (hrvValue >= 50) {
            intensity = 'moderate';
            duration = '45 minutes';
            recommendation = 'Your HRV is good. Moderate training recommended. Easy pace or steady-state runs.';
        } else {
            intensity = 'low';
            duration = '30 minutes';
            recommendation = 'Your HRV is low. Focus on recovery today. Easy runs, stretching, or rest.';
        }
        
        return {
            recommendation,
            intensity,
            duration,
            hrvValue,
            trend,
            generatedAt: new Date().toISOString()
        };
        
    } catch (error) {
        console.error('⚠️ HRV coaching generation error:', error);
        // Return safe default
        return {
            recommendation: 'Moderate training recommended.',
            intensity: 'moderate',
            duration: '45 minutes',
            hrvValue: 50,
            fallback: true
        };
    }
}

// WhatsApp coaching with usage tracking
app.post('/api/coaching/whatsapp', 
    authenticateToken, 
    requirePlan(['basic', 'race']), 
    async (req, res) => {
        try {
            const { message, phoneNumber } = req.body;
            const response = await sendWhatsAppCoaching(phoneNumber, message);
            
            try {
                await db.collection('feature_usage').add({
                    userId: userId,
                    feature: 'hrv-coaching',
                    timestamp: new Date(),
                    data: {
                        hrvValue: hrvData?.value,
                        coachingType: coaching.intensity
                    }
                });
            } catch (logError) {
                console.warn('Failed to log usage:', logError.message);
            }

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


// Add this DEBUG route to your app.js - TEMPORARY for debugging
app.get('/debug/user-tokens', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        //console.log('Debug: Looking up user:', userId);
        
        const user = await userManager.getUserById(userId);
        //console.log('Debug: User data:', {            id: user?.id,email: user?.email,hasStravaAccessToken: !!user?.stravaAccessToken,hasStravaRefreshToken: !!user?.stravaRefreshToken,stravaConnectedAt: user?.stravaConnectedAt});
        
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
            //console.log('❌ No token in URL');
            return res.redirect('/dashboard.html?error=no_token');
        }
        
        // Verify the user token
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const userId = decoded.userId;
        //console.log('✅ Token verified for user:', userId);
        
        // Get VALID Strava tokens (with auto-refresh)
        //console.log('🔍 Getting valid Strava tokens...');
        const tokens = await userManager.getValidStravaTokens(userId);
        
        if (!tokens) {
            //console.log('❌ No valid Strava tokens - need to reconnect');
            return res.redirect('/dashboard.html?action=reconnect_strava&message=Please reconnect your Strava account');
        }
        
        const stravaAccessToken = tokens.accessToken;
        //console.log('✅ Valid Strava token obtained');
        
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
            //console.log('🔄 User token invalid - redirecting to login');
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
                    <a href="/privacy" class="zt-cookie-link">Privacy Policy</a>
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

// ==================== STRAVA & ANALYTICS ROUTES ====================

const StravaService = require('./services/stravaService');
const WorkoutAnalyticsService = require('./services/workoutAnalyticsService');
const NotificationService = require('./services/notificationService');
const TrainingPlanService = require('./services/trainingPlanService');

const stravaService = new StravaService(db);
const analyticsService = new WorkoutAnalyticsService(db);
const notificationService = new NotificationService(db);
const trainingPlanService = new TrainingPlanService(db, aiService);

// ==================== STRAVA SYNC ROUTES ====================

// Sync Strava activities
app.post('/api/strava/sync', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        
        //console.log('🔄 Syncing Strava for user:', userId);
        
        const result = await stravaService.syncActivities(userId);
        
        res.json({
            success: true,
            message: `Synced ${result.count} activities`,
            count: result.count
        });
    } catch (error) {
        console.error('Strava sync error:', error);
        res.status(500).json({ 
            success: false, 
            message: error.message || 'Failed to sync Strava activities'
        });
    }
});

// Get Strava connection status
app.get('/api/strava/status', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        const userDoc = await db.collection('users').doc(userId).get();
        const user = userDoc.data();
        
        const connected = !!(user.stravaAccessToken);
        
        res.json({
            success: true,
            connected,
            athleteName: user.stravaAthleteName || null,
            lastSync: user.stravaLastSync || null
        });
    } catch (error) {
        console.error('Strava status error:', error);
        res.json({ success: false, connected: false });
    }
});

// ==================== WORKOUT ANALYTICS ROUTES ====================

// Get workout history from Strava
app.get('/api/analytics/workout-history', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        const days = parseInt(req.query.days) || 30;
        
        const history = await analyticsService.getWorkoutHistory(userId, days);
        
        res.json({
            success: true,
            ...history
        });
    } catch (error) {
        console.error('Workout history error:', error);
        res.status(500).json({ 
            success: false, 
            message: error.message,
            workouts: [],
            stats: {}
        });
    }
});

// Get progress chart data
app.get('/api/analytics/progress-chart', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        const metric = req.query.metric || 'distance';
        const days = parseInt(req.query.days) || 90;
        
        const chartData = await analyticsService.getProgressChartData(userId, metric, days);
        
        res.json({
            success: true,
            ...chartData
        });
    } catch (error) {
        console.error('Progress chart error:', error);
        res.status(500).json({ 
            success: false, 
            metric,
            data: []
        });
    }
});

// Get personal records from Strava
app.get('/api/analytics/personal-records', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        const records = await analyticsService.getPersonalRecords(userId);
        
        res.json({
            success: true,
            records
        });
    } catch (error) {
        console.error('Personal records error:', error);
        res.status(500).json({ 
            success: false, 
            records: {}
        });
    }
});

// ==================== NOTIFICATION ROUTES ====================

// Get user notifications
app.get('/api/notifications', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        const limit = parseInt(req.query.limit) || 20;
        
        // Use service for business logic
        const notifications = await notificationService.getUserNotifications(userId, limit);
        
        // Add time formatting (from Option 2)
        const formattedNotifications = notifications.map(notification => ({
            ...notification,
            timeAgo: getTimeAgo(notification.createdAt)
        }));
        
        const unreadCount = await notificationService.getUnreadCount(userId);
        
        res.json({
            success: true,
            notifications: formattedNotifications,
            unreadCount
        });
    } catch (error) {
        console.error('Get notifications error:', error);
        res.status(500).json({ 
            success: false, 
            notifications: [],
            unreadCount: 0
        });
    }
});

// Get unread notification count
app.get('/api/notifications/unread-count', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        const count = await notificationService.getUnreadCount(userId);
        
        res.json({ success: true, count });
    } catch (error) {
        res.json({ success: true, count: 0 });
    }
});

// Mark notification as read
app.post('/api/notifications/:id/read', authenticateToken, async (req, res) => {
    try {
        const notificationId = req.params.id;
        await notificationService.markAsRead(notificationId);
        
        res.json({ success: true });
    } catch (error) {
        console.error('Mark notification read error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Mark all notifications as read
app.post('/api/notifications/read-all', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        const result = await notificationService.markAllAsRead(userId);
        res.json({ success: true, count: result.count });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Delete notification
app.delete('/api/notifications/:id', authenticateToken, async (req, res) => {
    try {
        const notificationId = req.params.id;
        await notificationService.deleteNotification(notificationId);
        
        res.json({ success: true });
    } catch (error) {
        console.error('Delete notification error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * Update notification preferences
 */
app.post('/api/notifications/preferences', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        const { email, workout, payment, recovery, upgrade, race } = req.body;

        // Validate at least one preference is enabled
        const preferences = {
            email: email !== false,
            workout: workout !== false,
            payment: payment !== false,
            recovery: recovery !== false,
            upgrade: upgrade !== false,
            race: race !== false
        };

        // Don't allow all disabled
        if (Object.values(preferences).every(v => v === false)) {
            return res.status(400).json({
                success: false,
                message: 'At least one notification type must be enabled'
            });
        }

        await db.collection('users').doc(userId).update({
            notificationPreferences: preferences,
            updatedAt: new Date()
        });

        console.log(`✅ Notification preferences updated for ${userId}`);

        res.json({
            success: true,
            message: 'Preferences updated successfully',
            preferences
        });
    } catch (error) {
        console.error('Update preferences error:', error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

/**
 * Get notification preferences
 */
app.get('/api/notifications/preferences', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        const user = await db.collection('users').doc(userId).get();
        
        if (!user.exists) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        // Default preferences if not set
        const defaultPreferences = {
            email: true,
            workout: true,
            payment: true,
            recovery: true,
            upgrade: true,
            race: true
        };

        const preferences = user.data().notificationPreferences || defaultPreferences;

        res.json({
            success: true,
            preferences
        });
    } catch (error) {
        console.error('Get preferences error:', error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

app.post('/api/notifications/preferences/reset', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;

        const defaultPreferences = {
            email: true,
            workout: true,
            payment: true,
            recovery: true,
            upgrade: true,
            race: true
        };

        await db.collection('users').doc(userId).update({
            notificationPreferences: defaultPreferences,
            updatedAt: new Date()
        });

        res.json({
            success: true,
            message: 'Preferences reset to defaults',
            preferences: defaultPreferences
        });
    } catch (error) {
        console.error('Reset preferences error:', error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// ==================== TRAINING PLAN ROUTES ====================

// Get current training plan
app.get('/api/training-plan/current', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        const plan = await trainingPlanService.getCurrentPlan(userId);
        
        res.json({
            success: true,
            plan
        });
    } catch (error) {
        console.error('Get current plan error:', error);
        res.status(500).json({ 
            success: false, 
            message: error.message,
            plan: null
        });
    }
});

// Request workout modification
app.post('/api/training-plan/modify-workout', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        const { workoutId, reason, preferences } = req.body;
        
        const result = await trainingPlanService.requestModification(
            userId,
            workoutId,
            reason,
            preferences
        );
        
        res.json({ success: true, ...result });
    } catch (error) {
        console.error('Modify workout error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Apply workout modification
app.post('/api/training-plan/apply-modification/:id', authenticateToken, async (req, res) => {
    try {
        await trainingPlanService.applyModification(req.params.id);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Get injury prevention tips
app.get('/api/training-plan/injury-prevention', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        const tips = await trainingPlanService.getInjuryPreventionTips(userId);
        
        res.json({ success: true, tips });
    } catch (error) {
        console.error('Get injury tips error:', error);
        res.json({ 
            success: true, 
            tips: {
                tips: [
                    'Gradually increase training volume',
                    'Include rest days',
                    'Focus on proper form',
                    'Listen to your body'
                ],
                generated: 'fallback'
            }
        });
    }
});

// Get recovery suggestion
app.get('/api/training-plan/recovery-suggestion', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        const suggestion = await trainingPlanService.suggestRecoveryDay(userId);
        
        res.json({ success: true, suggestion });
    } catch (error) {
        res.json({ 
            success: true, 
            suggestion: {
                recommended: false,
                message: 'Unable to calculate recovery needs'
            }
        });
    }
});

console.log('✅ Strava analytics and notification routes initialized');

app.use(express.static(path.join(__dirname, 'public')));

// Updated welcome page route - replace your existing '/' route
app.get('/', optionalAuth, apiLimiter, (req, res) => {
  const referer = req.get('referer') || '';
  const isDashboardReferer = referer.includes('/dashboard');
  
  if (req.user && req.user.userId) {
    console.log('🔄 Authenticated user accessing homepage, redirecting to dashboard...');
    console.log('   User ID:', req.user.userId);
    console.log('   Current Plan:', req.user.currentPlan || 'free');
    console.log('   Referer:', referer);
    
    // ✅ Prevent redirect loop
    if (isDashboardReferer) {
      console.warn('⚠️ Redirect loop detected (came from dashboard), breaking loop');
      // Don't redirect back - just show homepage
      // This shouldn't happen, but prevents infinite loops
    } else {
      const plan = req.user.currentPlan || 'free';
      
      if (plan === 'race' || plan === 'basic') {
        console.log('✅ Redirecting to race/basic dashboard');
        return res.redirect('/dashboard-race.html');
      } else {
        console.log('✅ Redirecting to free dashboard');
        return res.redirect('/dashboard');
      }
    }
  }
  
  // ✅ User is NOT authenticated - show homepage
  console.log('📄 Serving homepage to unauthenticated user');
  
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
                        <a href="/privacy" class="zt-cookie-link">Privacy Policy</a>
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
        <!-- ✅ FIXED: Logo navigates home intelligently -->
        <a href="#" onclick="navigateToHome(event)" class="logo-container">
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

    // ✅ Smart logo navigation function
      function navigateToHome(event) {
        event.preventDefault();
        
        console.log('🏠 Logo clicked, checking authentication...');
        
        const token = localStorage.getItem('userToken');
        const currentPlan = localStorage.getItem('currentPlan');
        
        if (!token || token === 'null' || token === 'undefined') {
          console.log('   Not authenticated, staying on homepage');
          window.location.href = '/';
          return;
        }
        
        console.log('   Authenticated, redirecting to dashboard...');
        console.log('   Current plan:', currentPlan);
        
        // Navigate to appropriate dashboard
        if (currentPlan === 'race' || currentPlan === 'basic') {
          window.location.href = '/dashboard-race.html';
        } else {
          window.location.href = '/dashboard';
        }
      }

      function scrollToStrava() {
        document.getElementById('strava-section').scrollIntoView({
          behavior: 'smooth',
          block: 'center'
        });
      }

      // Add smooth scrolling for all internal links
      document.addEventListener('DOMContentLoaded', function() {
        console.log('📄 Homepage loaded');
        
        const token = localStorage.getItem('userToken');
        
        if (token && token !== 'null' && token !== 'undefined') {
          console.log('⚠️ User is authenticated but on homepage');
          console.log('   Checking if redirect needed...');
          
          // Verify token structure
          const parts = token.split('.');
          if (parts.length === 3) {
            console.log('   Token is valid, redirecting to dashboard...');
            const currentPlan = localStorage.getItem('currentPlan');
            
            if (currentPlan === 'race' || currentPlan === 'basic') {
              window.location.href = '/dashboard-race.html';
            } else {
              window.location.href = '/dashboard';
            }
          } else {
            console.warn('   Token structure invalid, clearing...');
            localStorage.clear();
          }
        }
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
                        <a href="/privacy" class="zt-cookie-link">Privacy Policy</a>
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

// Success page that transfers data to localStorage
app.get('/auth/success', (req, res) => {
  // ✅ Get token and redirect from URL query parameters (not session)
  const token = req.query.token;
  const redirect = req.query.redirect || '/dashboard';
  
  if (!token) {
    console.error('❌ No token in URL query');
    return res.redirect('/login?error=no_token');
  }
  
  console.log('✅ Auth success page loaded');
  //console.log('   Token length:', token.length);
  //console.log('   Redirect target:', redirect);

  const html = `
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Login Successful - ZoneTrain</title>
    <style>
      * {
        margin: 0;
        padding: 0;
        box-sizing: border-box;
      }
      
      body { 
        font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
        background: linear-gradient(135deg, #6B46C1, #8B5CF6);
        color: white; 
        min-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 20px;
      }
      
      .container { 
        background: rgba(255, 255, 255, 0.1);
        backdrop-filter: blur(10px);
        padding: 60px 40px;
        border-radius: 20px;
        text-align: center;
        max-width: 500px;
        box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
      }
      
      .spinner { 
        font-size: 4rem;
        animation: bounce 1s ease-in-out infinite;
        margin-bottom: 20px;
      }
      
      @keyframes bounce {
        0%, 100% { transform: translateY(0); }
        50% { transform: translateY(-20px); }
      }
      
      h2 {
        font-size: 2rem;
        margin-bottom: 15px;
        font-weight: 600;
      }
      
      p {
        font-size: 1.1rem;
        opacity: 0.9;
      }
      
      .progress-bar {
        width: 100%;
        height: 4px;
        background: rgba(255, 255, 255, 0.2);
        border-radius: 2px;
        margin-top: 30px;
        overflow: hidden;
      }
      
      .progress-fill {
        height: 100%;
        background: white;
        animation: progress 1.5s ease-in-out;
        border-radius: 2px;
      }
      
      @keyframes progress {
        0% { width: 0%; }
        100% { width: 100%; }
      }
      
      .error-container {
        display: none;
        background: rgba(239, 68, 68, 0.1);
        border: 2px solid #EF4444;
        padding: 20px;
        border-radius: 12px;
        margin-top: 20px;
      }
      
      .retry-btn {
        margin-top: 20px;
        padding: 12px 30px;
        background: white;
        color: #6B46C1;
        border: none;
        border-radius: 10px;
        font-size: 1rem;
        font-weight: 600;
        cursor: pointer;
        text-decoration: none;
        display: inline-block;
      }
      
      .retry-btn:hover {
        transform: translateY(-2px);
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
      }
    </style>
  </head>
  <body>
    <div class="container">
      <div class="spinner">🏃‍♂️</div>
      <h2>Login Successful!</h2>
      <p>Setting up your dashboard...</p>
      <div class="progress-bar">
        <div class="progress-fill"></div>
      </div>
      
      <div class="error-container" id="errorContainer">
        <p>⚠️ Something went wrong. Redirecting to login...</p>
        <a href="/login" class="retry-btn">Try Again</a>
      </div>
    </div>

    <script>
      (function() {
        try {
          console.log('🎯 OAuth Success page loaded');
          
          // ✅ Get token from the page (passed via template literal)
          const token = "${token.replace(/"/g, '\\"')}"; // Escape quotes
          const redirect = "${redirect}";
          
          //console.log('📋 Token received:', {length: token.length,preview: token.substring(0, 30) + '...',redirect: redirect});
          
          // ✅ Validate token
          if (!token || token === 'undefined' || token === 'null') {
            throw new Error('No token provided');
          }
          
          // ✅ Validate token structure
          const parts = token.split('.');
          if (parts.length !== 3) {
            throw new Error('Invalid token structure (expected 3 parts, got ' + parts.length + ')');
          }
          
          //console.log('✅ Token validation passed');
          
          // ✅ Store token in localStorage
          localStorage.setItem('userToken', token);
          //console.log('💾 Token saved to localStorage');
          
          // ✅ Decode token to extract user info
          try {
            const payload = JSON.parse(atob(parts[1]));
            //console.log('📦 Token payload:', payload);
            
            // ✅ Store user info in localStorage
            localStorage.setItem('userId', payload.userId || payload.id || '');
            localStorage.setItem('userEmail', payload.email || '');
            localStorage.setItem('currentPlan', payload.plan || 'free');
            localStorage.setItem('subscriptionStatus', payload.status || 'free');
            
            //console.log('✅ User data saved to localStorage:', {
              userId: payload.userId,
              email: payload.email,
              plan: payload.plan || 'free'
            });
            
          } catch (decodeError) {
            console.warn('⚠️ Could not decode token payload:', decodeError.message);
            // Continue anyway - token is still valid for auth
          }
          
          // ✅ Redirect to dashboard after short delay
          console.log('🚀 Redirecting to:', redirect);
          setTimeout(function() {
            window.location.href = redirect;
          }, 1500);
          
        } catch (error) {
          console.error('❌ OAuth success page error:', error);
          console.error('   Error message:', error.message);
          
          // Show error UI
          document.querySelector('.spinner').style.display = 'none';
          document.querySelector('h2').textContent = 'Oops!';
          document.querySelector('p').textContent = error.message || 'Something went wrong.';
          document.getElementById('errorContainer').style.display = 'block';
          
          // Clear any corrupted data
          localStorage.clear();
          
          // Redirect to login after delay
          setTimeout(function() {
            window.location.href = '/login?error=auth-failed';
          }, 5000);
        }
      })();
    </script>
  </body>
  </html>
  `;
  
  res.send(html);
});

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
        position: fixed;
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

// ============================================
// ERROR HANDLER - MUST BE LAST MIDDLEWARE
// ============================================

// 404 Handler (for undefined routes)
app.use((req, res, next) => {
  res.status(404).json({
    success: false,
    error: 'Route not found',
    path: req.path
  });
});



// Global Error Handler
app.use((err, req, res, next) => {
  // Log error details securely (don't log sensitive data)
  console.error('❌ Error occurred:');
  console.error('   Message:', err.message);
  console.error('   Status:', err.status || 500);
  console.error('   Path:', req.path);
  console.error('   Method:', req.method);
  
  // Only log stack trace in development
  if (process.env.NODE_ENV !== 'production') {
    console.error('   Stack:', err.stack);
  }
  
  // Determine error status code
  const statusCode = err.status || err.statusCode || 500;
  
  // Categorize error type
  let errorType = 'INTERNAL_ERROR';
  let clientMessage = 'An unexpected error occurred';
  
  if (statusCode === 400) {
    errorType = 'BAD_REQUEST';
    clientMessage = err.message || 'Invalid request';
  } else if (statusCode === 401) {
    errorType = 'UNAUTHORIZED';
    clientMessage = 'Authentication required';
  } else if (statusCode === 403) {
    errorType = 'FORBIDDEN';
    clientMessage = 'Access denied';
  } else if (statusCode === 404) {
    errorType = 'NOT_FOUND';
    clientMessage = 'Resource not found';
  } else if (statusCode === 429) {
    errorType = 'RATE_LIMIT_EXCEEDED';
    clientMessage = 'Too many requests, please try again later';
  } else if (statusCode >= 500) {
    errorType = 'SERVER_ERROR';
    clientMessage = 'Internal server error';
  }
  
  // Build error response
  const errorResponse = {
    success: false,
    error: process.env.NODE_ENV === 'production' ? clientMessage : err.message,
    code: errorType,
    timestamp: new Date().toISOString()
  };
  
  // Include stack trace in development only
  if (process.env.NODE_ENV !== 'production') {
    errorResponse.stack = err.stack;
    errorResponse.details = {
      path: req.path,
      method: req.method,
      query: req.query,
      body: sanitizeForLogging(req.body)
    };
  }
  
  // Send error response
  res.status(statusCode).json(errorResponse);
});

// Helper function to sanitize sensitive data from logs
function sanitizeForLogging(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  
  const sensitiveKeys = ['password', 'token', 'secret', 'apiKey', 'authorization'];
  const sanitized = { ...obj };
  
  for (const key of Object.keys(sanitized)) {
    if (sensitiveKeys.some(sensitive => key.toLowerCase().includes(sensitive))) {
      sanitized[key] = '[REDACTED]';
    }
  }
  
  return sanitized;
}

// ============================================
// START SERVER
// ============================================

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('✅ ZoneTrain server running on port', PORT);
  console.log('   Environment:', process.env.NODE_ENV || 'development');
  console.log('   Base URL:', process.env.BASE_URL || 'http://localhost:3000');
});