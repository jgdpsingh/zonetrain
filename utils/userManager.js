// utils/userManager.js
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const axios = require('axios');
const nodemailer = require('nodemailer');
const emailValidator = require('email-validator');
const dns = require('dns').promises;

class UserManager {
  constructor(database) {
    this.db = database;
  }

  // ==================== EMAIL VERIFICATION METHODS ====================
  
  /**
   * Validate email format and check if disposable
   */
  async validateEmailFormat(email) {
    try {
        console.log('🔍 Validating email:', email);
        
        // Basic format validation
        if (!emailValidator.validate(email)) {
            return {
                valid: false,
                reason: 'Invalid email format'
            };
        }

        const domain = email.split('@')[1].toLowerCase();
        
        // Check against disposable email domains
        const disposableDomains = [
            'tempmail.com', 'guerrillamail.com', '10minutemail.com',
            'throwaway.email', 'mailinator.com', 'trashmail.com',
            'yopmail.com', 'maildrop.cc', 'getnada.com', 'temp-mail.org',
            'fakeinbox.com', 'spam4.me', 'sharklasers.com', 'mintemail.com',
            'temp-mail.io', 'mohmal.com', 'dispostable.com', 'emailondeck.com'
        ];

        if (disposableDomains.includes(domain)) {
            return {
                valid: false,
                reason: 'Disposable email addresses are not allowed'
            };
        }

        // **NEW: Verify domain has valid MX records**
        try {
            console.log('🔍 Checking MX records for domain:', domain);
            const mxRecords = await dns.resolveMx(domain);
            
            if (!mxRecords || mxRecords.length === 0) {
                console.log('❌ No MX records found for domain:', domain);
                return {
                    valid: false,
                    reason: 'Email domain does not exist or cannot receive emails'
                };
            }
            
            console.log('✅ Valid MX records found:', mxRecords.length);
        } catch (dnsError) {
            console.log('❌ DNS lookup failed for domain:', domain, dnsError.code);
            
            // If DNS lookup fails, it means the domain doesn't exist
            return {
                valid: false,
                reason: 'Email domain does not exist. Please use a valid email address.'
            };
        }

        console.log('✅ Email validation passed for:', email);
        return {
            valid: true,
            reason: 'Email format is valid'
        };

    } catch (error) {
        console.error('❌ Email validation error:', error);
        return {
            valid: false,
            reason: 'Email validation failed'
        };
    }
}

  /**
   * Generate email verification token
   */
  generateEmailVerificationToken(userId, email) {
    try {
      const token = jwt.sign(
        { 
          userId: userId,
          email: email,
          type: 'email_verification'
        },
        process.env.JWT_SECRET,
        { expiresIn: '24h' }
      );
      
      return token;
    } catch (error) {
      console.error('Token generation error:', error);
      throw error;
    }
  }

  /**
   * Send verification email
   */
  async sendVerificationEmail(userId, email, firstName) {
    try {
      console.log('📧 Sending verification email to:', email);

      // Generate verification token
      const token = this.generateEmailVerificationToken(userId, email);
      
      // Create verification URL
      const verificationUrl = `${process.env.APP_URL || 'http://localhost:3000'}/verify-email?token=${token}`;

      // Configure nodemailer transporter
      const transporter = nodemailer.createTransport({
        host: process.env.EMAIL_HOST || 'smtp.zoho.com',
        port: process.env.EMAIL_PORT || 465,
        secure: true,
        auth: {
          user: process.env.ZOHO_EMAIL,
          pass: process.env.ZOHO_PASSWORD
        },
        tls: {
                rejectUnauthorized: true,
                minVersion: 'TLSv1.2'
            },
            // Connection timeout
            connectionTimeout: 10000,
            greetingTimeout: 10000,
            socketTimeout: 10000
      });

      // Email template
      const mailOptions = {
        from: `"ZoneTrain" <${process.env.ZOHO_EMAIL}>`,
        to: email,
        subject: 'Verify Your Email - ZoneTrain',
        html: `
          <!DOCTYPE html>
          <html>
          <head>
            <style>
              body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
              .container { max-width: 600px; margin: 0 auto; padding: 20px; }
              .header { background: linear-gradient(135deg, #6B46C1 0%, #8B5CF6 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
              .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
              .button { display: inline-block; background: #6B46C1; color: white; padding: 15px 30px; text-decoration: none; border-radius: 5px; margin: 20px 0; font-weight: bold; }
              .footer { text-align: center; margin-top: 20px; color: #666; font-size: 12px; }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="header">
                <h1>🏃 Welcome to ZoneTrain!</h1>
              </div>
              <div class="content">
                <h2>Hi ${firstName || 'there'}!</h2>
                <p>Thank you for signing up with ZoneTrain. We're excited to have you on board!</p>
                <p>To get started, please verify your email address by clicking the button below:</p>
                <center>
                  <a href="${verificationUrl}" class="button">Verify Email Address</a>
                </center>
                <p>Or copy and paste this link into your browser:</p>
                <p style="background: #fff; padding: 10px; border-radius: 5px; word-break: break-all;">
                  ${verificationUrl}
                </p>
                <p><strong>This link will expire in 24 hours.</strong></p>
                <p>If you didn't create an account with ZoneTrain, please ignore this email.</p>
              </div>
              <div class="footer">
                <p>© 2025 ZoneTrain. All rights reserved.</p>
                <p>AI-Powered Running Coach</p>
              </div>
            </div>
          </body>
          </html>
        `
      };

      // Send email
      const info = await transporter.sendMail(mailOptions);
      console.log('✅ Verification email sent:', info.messageId);

      // Store token in database
      await this.db.collection('users').doc(userId).update({
        emailVerificationToken: token,
        emailVerificationSentAt: new Date(),
        updatedAt: new Date()
      });

      return {
        success: true,
        messageId: info.messageId
      };

    } catch (error) {
      console.error('❌ Send verification email error:', error);
      throw error;
    }
  }

  /**
   * Verify email token
   */
  async verifyEmailToken(token) {
    try {
      console.log('🔐 Verifying email token...');

      // Decode and verify JWT token
      const decoded = jwt.verify(token, process.env.JWT_SECRET);

      if (decoded.type !== 'email_verification') {
        throw new Error('Invalid token type');
      }

      // Get user
      const user = await this.getUserById(decoded.userId);
      if (!user) {
        throw new Error('User not found');
      }

      // Check if already verified
      if (user.emailVerified) {
        return {
          success: true,
          alreadyVerified: true,
          message: 'Email already verified'
        };
      }

      // Update user as verified
      await this.db.collection('users').doc(decoded.userId).update({
        emailVerified: true,
        emailVerifiedAt: new Date(),
        emailVerificationToken: null,
        updatedAt: new Date()
      });

      // Track verification
      await this.trackActivity(decoded.userId, 'email_verified');

      console.log('✅ Email verified for user:', decoded.userId);

      return {
        success: true,
        alreadyVerified: false,
        userId: decoded.userId,
        message: 'Email verified successfully'
      };

    } catch (error) {
      console.error('❌ Email verification error:', error);
      
      if (error.name === 'TokenExpiredError') {
        throw new Error('Verification link has expired');
      } else if (error.name === 'JsonWebTokenError') {
        throw new Error('Invalid verification link');
      }
      
      throw error;
    }
  }

  /**
   * Resend verification email
   */
  async resendVerificationEmail(userId) {
    try {
      const user = await this.getUserById(userId);
      if (!user) {
        throw new Error('User not found');
      }

      if (user.emailVerified) {
        throw new Error('Email already verified');
      }

      // Check rate limiting (max 1 email per hour)
      if (user.emailVerificationSentAt) {
        const lastSent = user.emailVerificationSentAt.toDate();
        const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
        
        if (lastSent > hourAgo) {
          throw new Error('Please wait before requesting another verification email');
        }
      }

      // Send new verification email
      await this.sendVerificationEmail(userId, user.email, user.firstName);

      return {
        success: true,
        message: 'Verification email sent'
      };

    } catch (error) {
      console.error('Resend verification email error:', error);
      throw error;
    }
  }

  // ==================== PHONE AUTHENTICATION METHODS ====================
  
  async getUserByPhone(phoneNumber) {
    try {
      console.log('📱 Looking up user by phone:', phoneNumber);
      
      const snapshot = await this.db.collection('users')
        .where('phoneNumber', '==', phoneNumber)
        .limit(1)
        .get();
      
      if (snapshot.empty) {
        console.log('❌ No user found with phone:', phoneNumber);
        return null;
      }
      
      const doc = snapshot.docs[0];
      console.log('✅ User found with phone:', phoneNumber);
      return { id: doc.id, ...doc.data() };
    } catch (error) {
      console.error('❌ Error getting user by phone:', error);
      throw error;
    }
  }

  async createPhoneUser(phoneData) {
    try {
      const { phoneNumber, firebaseUid, firstName, lastName } = phoneData;
      
      console.log('📝 Creating new phone user:', phoneNumber);
      
      const existingUser = await this.getUserByPhone(phoneNumber);
      if (existingUser) {
        throw new Error('User already exists with this phone number');
      }
      
      const userReferralCode = await this.generateReferralCode(
        firstName || 'User', 
        lastName || 'Phone'
      );
      
      const defaultPreferences = {
        email: true,
        workout: true,
        payment: true,
        recovery: true,
        upgrade: true,
        race: true
      };

      const tempEmail = `${phoneNumber.replace('+', '')}@phone.zonetrain.com`;
      
      const newUser = {
        phoneNumber: phoneNumber,
        firebaseUid: firebaseUid,
        email: tempEmail,
        firstName: firstName || 'User',
        lastName: lastName || '',
        avatar: null,
        
        password: crypto.randomBytes(16).toString('hex'),
        emailVerified: false,
        emailVerificationToken: null,
        emailVerificationSentAt: null,
        phoneVerified: true,
        authProvider: 'phone',
        
        subscriptionStatus: 'free',
        currentPlan: null,
        currentPrice: 0,
        originalPrice: 0,
        
        trialStartDate: null,
        trialEndDate: null,
        
        loginCount: 1,
        totalAnalyses: 0,
        whatsappOptIn: false,
        
        promoCodesUsed: [],
        referralCode: userReferralCode,
        referredBy: null,

        notificationPreferences: defaultPreferences,
        
        createdAt: new Date(),
        updatedAt: new Date(),
        lastLogin: new Date(),
        active: true
      };
      
      const userRef = await this.db.collection('users').add(newUser);
      console.log('✅ Phone user created:', userRef.id);
      
      await this.trackActivity(userRef.id, 'phone_signup', { 
        phoneNumber: phoneNumber 
      });
      
      return {
        id: userRef.id,
        ...newUser,
        password: undefined
      };
      
    } catch (error) {
      console.error('❌ Create phone user error:', error);
      throw error;
    }
  }

  async updatePhoneUser(userId, updateData) {
    try {
      const updates = {
        ...updateData,
        updatedAt: new Date()
      };
      
      delete updates.phoneNumber;
      delete updates.firebaseUid;
      
      await this.db.collection('users').doc(userId).update(updates);
      console.log('✅ Phone user updated:', userId);
      
      return await this.getUserById(userId);
    } catch (error) {
      console.error('❌ Update phone user error:', error);
      throw error;
    }
  }

  // ==================== STRAVA INTEGRATION ====================
  
  async saveStravaTokens(userId, accessToken, refreshToken) {
    try {
      console.log('💾 Saving Strava tokens for user:', userId);
      
      if (!accessToken || !refreshToken) {
        throw new Error('Missing access or refresh token');
      }

      await this.db.collection('users').doc(userId).update({
        stravaAccessToken: accessToken,
        stravaRefreshToken: refreshToken,
        stravaConnectedAt: new Date(),
        updatedAt: new Date()
      });
      
      console.log('✅ Strava tokens saved successfully');
      return true;
    } catch (error) {
      console.error('❌ Save Strava tokens failed:', error.message);
      throw error;
    }
  }

  async getStravaTokens(userId) {
    try {
      const user = await this.getUserById(userId);
      if (!user || !user.stravaAccessToken) {
        return null;
      }
      return {
        accessToken: user.stravaAccessToken,
        refreshToken: user.stravaRefreshToken
      };
    } catch (error) {
      console.error('Get Strava tokens error:', error);
      return null;
    }
  }

  async refreshStravaToken(userId) {
    try {
      console.log('🔄 Refreshing Strava token for user:', userId);
      
      const user = await this.getUserById(userId);
      if (!user || !user.stravaRefreshToken) {
        console.log('❌ No refresh token found');
        return null;
      }

      const response = await axios.post('https://www.strava.com/oauth/token', {
        client_id: process.env.STRAVA_CLIENT_ID,
        client_secret: process.env.STRAVA_CLIENT_SECRET,
        grant_type: 'refresh_token',
        refresh_token: user.stravaRefreshToken
      });

      const { access_token, refresh_token } = response.data;
      console.log('✅ New Strava tokens received');

      await this.db.collection('users').doc(userId).update({
        stravaAccessToken: access_token,
        stravaRefreshToken: refresh_token || user.stravaRefreshToken,
        stravaTokenRefreshedAt: new Date(),
        updatedAt: new Date()
      });

      console.log('✅ Strava tokens refreshed and saved');
      return {
        accessToken: access_token,
        refreshToken: refresh_token || user.stravaRefreshToken
      };

    } catch (error) {
      console.error('❌ Token refresh failed:', error.response?.data || error.message);
      return null;
    }
  }

  async getValidStravaTokens(userId) {
    try {
      let tokens = await this.getStravaTokens(userId);
      if (!tokens) {
        console.log('❌ No Strava tokens found');
        return null;
      }

      try {
        await axios.get('https://www.strava.com/api/v3/athlete', {
          headers: { 'Authorization': `Bearer ${tokens.accessToken}` },
          timeout: 5000
        });
        
        console.log('✅ Existing Strava token is valid');
        return tokens;
      } catch (error) {
        if (error.response?.status === 401) {
          console.log('🔄 Token expired, attempting refresh...');
          
          const refreshedTokens = await this.refreshStravaToken(userId);
          if (refreshedTokens) {
            console.log('✅ Token refresh successful');
            return refreshedTokens;
          } else {
            console.log('❌ Token refresh failed');
            return null;
          }
        } else {
          console.log('❌ Token validation failed:', error.message);
          return null;
        }
      }
    } catch (error) {
      console.error('❌ Get valid tokens error:', error);
      return null;
    }
  }

  // ==================== ZONE ANALYSIS ====================
  
  async saveZoneAnalysis(userId, analysisData) {
    try {
      const analysisDoc = {
        userId,
        analysisDate: new Date(),
        zonePercentages: analysisData.percentages,
        totalActivities: analysisData.totalActivities,
        aiInsight: analysisData.aiInsight,
        zoneNames: analysisData.zoneNames,
        createdAt: new Date()
      };
      
      const docRef = await this.db.collection('zone_analyses').add(analysisDoc);
      
      await this.updateUser(userId, {
        latestZoneAnalysis: {
          id: docRef.id,
          date: new Date(),
          summary: analysisData.aiInsight
        }
      });
      
      return docRef.id;
    } catch (error) {
      console.error('Save zone analysis error:', error);
      throw error;
    }
  }

  async getLatestZoneAnalysis(userId) {
    try {
      const user = await this.getUserById(userId);
      return user?.latestZoneAnalysis || null;
    } catch (error) {
      console.error('Get latest analysis error:', error);
      return null;
    }
  }

  // ==================== USER CREATION ====================
  
  async createUser(userData) {
    try {
        const { email, password, firstName, lastName, phoneNumber, referralCode, provider } = userData;
        
        // **VALIDATE EMAIL FORMAT**
        if (email) {
            const emailValidation = await this.validateEmailFormat(email);
            if (!emailValidation.valid) {
                throw new Error(emailValidation.reason);
            }
        }
        
        // Check if user exists by email
        if (email) {
            const existingUser = await this.getUserByEmail(email);
            if (existingUser) {
                throw new Error('User already exists');
            }
        }
        
        // Check if user exists by phone
        if (phoneNumber) {
            const existingPhone = await this.getUserByPhone(phoneNumber);
            if (existingPhone) {
                throw new Error('User already exists with this phone number');
            }
        }

        // Hash password if provided
        let hashedPassword = null;
        if (password) {
            hashedPassword = await bcrypt.hash(password, 12);
        } else {
            hashedPassword = crypto.randomBytes(16).toString('hex');
        }
        
        const userReferralCode = await this.generateReferralCode(
            firstName || 'User', 
            lastName || 'New'
        );
        
        // ✅ DEFAULT NOTIFICATION PREFERENCES (Already there - great!)
        const defaultPreferences = {
            email: true,
            workout: true,
            payment: true,
            recovery: true,
            upgrade: true,
            race: true
        };

        const newUser = {
            email: email ? email.toLowerCase() : null,
            phoneNumber: phoneNumber || null,
            firstName: firstName || 'User',
            lastName: lastName || '',
            password: hashedPassword,
            emailVerified: false,
            emailVerificationToken: null,
            emailVerificationSentAt: null,
            phoneVerified: phoneNumber ? true : false,
            
            authProvider: provider || 'email',
            firebaseUid: userData.firebaseUid || null,
            googleId: userData.googleId || null,
            facebookId: userData.facebookId || null,
            
            subscriptionStatus: 'free',
            currentPlan: null,
            currentPrice: 0,
            originalPrice: 0,
            
            trialStartDate: null,
            trialEndDate: null,
            
            loginCount: 0,
            totalAnalyses: 0,
            whatsappOptIn: false,
            
            promoCodesUsed: [],
            referralCode: userReferralCode,
            referredBy: referralCode || null,

            // ✅ NOTIFICATION PREFERENCES (Already included - perfect!)
            notificationPreferences: defaultPreferences,
            
            createdAt: new Date(),
            updatedAt: new Date(),
            active: true
        };

        const userRef = await this.db.collection('users').add(newUser);
        
        // ✅ OPTIMIZATION: Log preferences setup
        await this.trackActivity(userRef.id, 'user_created', { 
            referralCode: referralCode || null,
            provider: provider || 'email',
            preferencesInitialized: true  // Add this
        });
        
        const createdUser = {
            id: userRef.id,
            ...newUser,
            password: undefined  // Don't return password
        };

        // **SEND VERIFICATION EMAIL**
        if (email && provider === 'email') {
            try {
                await this.sendVerificationEmail(userRef.id, email, firstName);
                console.log('✅ Verification email queued for:', email);
            } catch (emailError) {
                console.warn('⚠️ Failed to send verification email:', emailError.message);
                // Don't throw - email is non-critical
            }
        }
        
        console.log(`✅ User created with notification preferences:`, userRef.id);
        return createdUser;

    } catch (error) {
        console.error('Create user error:', error);
        throw error;
    }
}


  async createOAuthUser(userData) {
    try {
        const { 
            googleId, 
            facebookId, 
            email, 
            firstName, 
            lastName, 
            avatar, 
            provider,
            notificationPreferences  // ✅ Accept as parameter (for flexibility)
        } = userData;

        console.log(`👤 Creating OAuth user: ${email} via ${provider}`);

        // ✅ Check if user exists
        const existingUser = await this.getUserByEmail(email);
        if (existingUser) {
            console.log(`⚠️ User already exists, updating login info instead`);
            
            const updates = {
                lastLogin: new Date(),
                emailVerified: true,
                loginCount: (existingUser.loginCount || 0) + 1
            };
            
            // ✅ Only update if values provided (avoid overwriting)
            if (googleId && !existingUser.googleId) updates.googleId = googleId;
            if (facebookId && !existingUser.facebookId) updates.facebookId = facebookId;
            if (avatar && !existingUser.avatar) updates.avatar = avatar;
            if (firstName) updates.firstName = firstName;
            if (lastName) updates.lastName = lastName;
            
            // ✅ Initialize preferences if missing
            if (!existingUser.notificationPreferences) {
                updates.notificationPreferences = {
                    email: true,
                    workout: true,
                    payment: true,
                    recovery: true,
                    upgrade: true,
                    race: true
                };
                console.log(`⚠️ Preferences missing, initializing for existing user`);
            }
            
            await this.updateUser(existingUser.id, updates);
            const updatedUser = await this.getUserById(existingUser.id);
            
            // Track login activity
            await this.trackActivity(existingUser.id, 'oauth_login', { 
                provider,
                method: 'oauth_existing_user'
            });
            
            console.log(`✅ Existing user logged in via ${provider}`);
            return updatedUser;
        }

        // ========== CREATE NEW USER ==========
        console.log(`📝 Creating new OAuth user via ${provider}`);

        const userReferralCode = await this.generateReferralCode(firstName, lastName);

        // ✅ Default notification preferences
        const defaultPreferences = notificationPreferences || {
            email: true,
            workout: true,
            payment: true,
            recovery: true,
            upgrade: true,
            race: true
        };

        // ✅ Generate secure random password (for security purposes)
        const crypto = require('crypto');
        const randomPassword = crypto.randomBytes(16).toString('hex');

        const newUser = {
            email: email.toLowerCase(),
            firstName: firstName || 'User',
            lastName: lastName || '',
            googleId: googleId || null,
            facebookId: facebookId || null,
            avatar: avatar || null,
            
            // Security: Random password (user won't use it - OAuth only)
            password: randomPassword,
            
            // Subscription
            subscriptionStatus: 'free',
            currentPlan: null,
            currentPrice: 0,
            originalPrice: 0,
            
            // Referral & Preferences
            referralCode: userReferralCode,
            notificationPreferences: defaultPreferences,  // ✅ ADDED
            
            // Metadata
            createdAt: new Date(),
            updatedAt: new Date(),
            lastLogin: new Date(),
            loginCount: 1,
            active: true,
            authProvider: provider || 'oauth',
            emailVerified: true  // ✅ OAuth emails pre-verified
        };

        // ✅ Create user with explicit ID strategy (optional - Firebase auto-generates if not provided)
        const userRef = await this.db.collection('users').add(newUser);
        
        console.log(`✅ New OAuth user created: ${userRef.id}`);

        // ✅ Track signup activity
        await this.trackActivity(userRef.id, 'oauth_signup', { 
            provider,
            method: 'new_oauth_user'
        });

        // ✅ Return user WITHOUT password
        return { 
            id: userRef.id, 
            ...newUser, 
            password: undefined  // Don't return password
        };

    } catch (error) {
        console.error('❌ Create OAuth user error:', error);
        throw error;
    }
}

  // ==================== AUTHENTICATION ====================
  
  async authenticateUser(email, password) {
    try {
      console.log('🔐 Authenticating:', email);
      const user = await this.getUserByEmail(email);
      if (!user) {
        console.log('❌ User not found:', email);
        throw new Error('Invalid credentials');
      }

      const isValidPassword = await bcrypt.compare(password, user.password);
      if (!isValidPassword) {
        console.log('❌ Password mismatch for:', email);
        throw new Error('Invalid credentials');
      }
      console.log('✅ Authentication successful for:', email);

      await this.updateUser(user.id, {
        lastLogin: new Date(),
        loginCount: (user.loginCount || 0) + 1
      });

      await this.trackActivity(user.id, 'login');

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

      return {
        user: this.sanitizeUser(user),
        token
      };

    } catch (error) {
      console.error('Authentication error:', error);
      throw error;
    }
  }

  // ==================== SUBSCRIPTION MANAGEMENT ====================
  
  async startTrial(userId, planType) {
    try {
      const user = await this.getUserById(userId);
      if (!user) throw new Error('User not found');
      
      if (user.trialStartDate) {
        throw new Error('Trial already used');
      }

      const trialStart = new Date();
      const trialEnd = new Date();
      trialEnd.setDate(trialEnd.getDate() + 14);

      const planPricing = {
        fitness: 199,
        race: 399
      };

      await this.updateUser(userId, {
        subscriptionStatus: 'trial',
        currentPlan: planType,
        trialStartDate: trialStart,
        trialEndDate: trialEnd,
        planStartDate: trialStart,
        originalPrice: planPricing[planType],
        currentPrice: planPricing[planType]
      });

      await this.trackActivity(userId, 'trial_started', { planType });
      await this.scheduleTrialReminder(userId, trialEnd);

      return true;
    } catch (error) {
      console.error('Start trial error:', error);
      throw error;
    }
  }

  async upgradeToPaid(userId, paymentData) {
    try {
      const { planType, promoCode, stripePaymentId } = paymentData;
      
      const user = await this.getUserById(userId);
      if (!user) throw new Error('User not found');

      const pricing = await this.calculatePricing(planType, promoCode, userId);
      
      const now = new Date();
      const nextBilling = new Date();
      nextBilling.setMonth(nextBilling.getMonth() + 1);

      await this.updateUser(userId, {
        subscriptionStatus: 'active',
        currentPlan: planType,
        planStartDate: now,
        currentPrice: pricing.finalPrice,
        originalPrice: pricing.originalPrice,
        lastPaymentDate: now,
        nextBillingDate: nextBilling,
        updatedAt: now
      });

      await this.db.collection('subscriptions').add({
        userId: userId,
        planType: planType,
        status: 'active',
        startDate: now,
        amount: pricing.finalPrice,
        currency: 'INR',
        promoCode: promoCode || null,
        paymentMethod: 'stripe',
        stripePaymentId: stripePaymentId
      });

      await this.trackActivity(userId, 'upgraded_to_paid', { 
        planType, 
        amount: pricing.finalPrice,
        promoCode: promoCode || null
      });

      return true;
    } catch (error) {
      console.error('Upgrade error:', error);
      throw error;
    }
  }

  // ==================== FEATURE ACCESS CONTROL ====================
  
  async checkFeatureAccess(userId, feature) {
    try {
      const user = await this.getUserById(userId);
      if (!user) return false;

      const featureMatrix = {
        'strava-analysis': ['free', 'trial', 'active'],
        'strava_analysis': ['free', 'trial', 'active'],
        'hrv-coaching': ['trial', 'active'],
        'hrv_coaching': ['trial', 'active'],
        'whatsapp-coaching': ['trial', 'active'],
        'whatsapp_coaching': ['trial', 'active'],
        'advanced-analytics': ['active'],
        'advanced_analytics': ['active'],
        'race-planning': ['active'],
        'race_planning': ['active']
      };

      const allowedStatuses = featureMatrix[feature];
      const hasAccess = allowedStatuses?.includes(user.subscriptionStatus);

      await this.trackActivity(userId, 'feature_access', { 
        feature, 
        hasAccess, 
        userStatus: user.subscriptionStatus 
      });

      return hasAccess;
    } catch (error) {
      console.error('Feature access check error:', error);
      return false;
    }
  }

  // ==================== ANALYTICS & TRACKING ====================
  
  async trackActivity(userId, action, metadata = {}) {
    try {
      await this.db.collection('userActivity').add({
        userId: userId,
        action: action,
        timestamp: new Date(),
        metadata: metadata
      });
    } catch (error) {
      console.error('Track activity error:', error);
    }
  }

  async getUserAnalytics(userId) {
    try {
      const user = await this.getUserById(userId);
      if (!user) throw new Error('User not found');

      const activitySnapshot = await this.db.collection('userActivity')
        .where('userId', '==', userId)
        .orderBy('timestamp', 'desc')
        .limit(50)
        .get();

      const activities = activitySnapshot.docs.map(doc => doc.data());

      const lastWeekActivities = activities.filter(a => 
        a.timestamp.toDate() > new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
      );

      return {
        user: this.sanitizeUser(user),
        totalActivities: activities.length,
        lastWeekActivities: lastWeekActivities.length,
        lastActivity: activities[0]?.timestamp.toDate(),
        engagementScore: this.calculateEngagementScore(activities),
        churnRisk: this.calculateChurnRisk(user, activities)
      };

    } catch (error) {
      console.error('Get user analytics error:', error);
      throw error;
    }
  }

  // ==================== HELPER FUNCTIONS ====================
  
  async getUserById(userId) {
    try {
      const doc = await this.db.collection('users').doc(userId).get();
      if (!doc.exists) return null;
      return { id: doc.id, ...doc.data() };
    } catch (error) {
      console.error('Get user by ID error:', error);
      return null;
    }
  }

  async getUserByEmail(email) {
    try {
      if (!email) return null;
      
      const snapshot = await this.db.collection('users')
        .where('email', '==', email.toLowerCase())
        .limit(1)
        .get();
      
      if (snapshot.empty) return null;
      const doc = snapshot.docs[0];
      return { id: doc.id, ...doc.data() };
    } catch (error) {
      console.error('Get user by email error:', error);
      return null;
    }
  }

  async updateUser(userId, updateData) {
    try {
      updateData.updatedAt = new Date();
      await this.db.collection('users').doc(userId).update(updateData);
      return true;
    } catch (error) {
      console.error('Update user error:', error);
      throw error;
    }
  }

  sanitizeUser(user) {
    if (!user) return null;
    
    const { password, stravaAccessToken, stravaRefreshToken, firebaseUid, emailVerificationToken, ...safeUser } = user;
    return safeUser;
  }

  async generateReferralCode(firstName, lastName) {
    const base = (firstName.substring(0, 2) + lastName.substring(0, 2)).toUpperCase();
    const random = crypto.randomBytes(2).toString('hex').toUpperCase();
    return `${base}${random}`;
  }

  calculateEngagementScore(activities) {
    const recentActivities = activities.filter(a => 
      a.timestamp.toDate() > new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    );
    
    const analysisCount = recentActivities.filter(a => a.action === 'strava_analysis').length;
    const loginCount = recentActivities.filter(a => a.action === 'login').length;
    
    return Math.min(100, (analysisCount * 20) + (loginCount * 5));
  }

  calculateChurnRisk(user, activities) {
    const daysSinceLastActivity = activities.length > 0 ? 
      (Date.now() - activities[0].timestamp.toDate().getTime()) / (1000 * 60 * 60 * 24) : 
      999;
    
    if (daysSinceLastActivity > 14) return 'high';
    if (daysSinceLastActivity > 7) return 'medium';
    return 'low';
  }

  async scheduleTrialReminder(userId, trialEndDate) {
    console.log('Trial reminder scheduled for:', userId, trialEndDate);
  }

  async calculatePricing(planType, promoCode, userId) {
    const basePrices = {
      fitness: 199,
      race: 399
    };
    
    return {
      originalPrice: basePrices[planType],
      finalPrice: basePrices[planType],
      discount: 0
    };
  }
}

module.exports = UserManager;

