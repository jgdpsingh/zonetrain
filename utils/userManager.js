// utils/userManager.js
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
// Add this at the top of userManager.js if not already there
const axios = require('axios');


class UserManager {
  constructor(database) {
  this.db = database;
}

// Initialize User Manager (add this AFTER the class definition)

// Add to your UserManager class
async saveStravaTokens(userId, accessToken, refreshToken) {
    try {
        console.log('Saving Strava tokens for user:', userId);
        console.log('Tokens to save:', {
            accessToken: accessToken ? 'Present' : 'Missing',
            refreshToken: refreshToken ? 'Present' : 'Missing'
        });
        
        if (!accessToken || !refreshToken) {
            throw new Error('Missing access or refresh token');
        }

        await this.db.collection('users').doc(userId).update({
            stravaAccessToken: accessToken,
            stravaRefreshToken: refreshToken,
            stravaConnectedAt: new Date(),
            updatedAt: new Date()
        });
        
        console.log('✅ Tokens saved successfully');
        return true;
    } catch (error) {
        console.error('❌ Save Strava tokens failed:', error.message);
        console.error('Full error:', error);
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
        
        // Save to zone_analyses collection
        const docRef = await this.db.collection('zone_analyses').add(analysisDoc);
        
        // Update user's latest analysis
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

// Add these methods to your UserManager class

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

        // Save new tokens
        await this.db.collection('users').doc(userId).update({
            stravaAccessToken: access_token,
            stravaRefreshToken: refresh_token || user.stravaRefreshToken, // Keep old if no new one
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

        // First try with existing token
        try {
            const testResponse = await axios.get('https://www.strava.com/api/v3/athlete', {
                headers: { 'Authorization': `Bearer ${tokens.accessToken}` },
                timeout: 5000
            });
            
            console.log('✅ Existing Strava token is valid');
            return tokens;
        } catch (error) {
            if (error.response?.status === 401) {
                console.log('🔄 Token expired, attempting refresh...');
                
                // Token expired, try to refresh
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


async getLatestZoneAnalysis(userId) {
    try {
        const user = await this.getUserById(userId);
        return user?.latestZoneAnalysis || null;
    } catch (error) {
        console.error('Get latest analysis error:', error);
        return null;
    }
}


// Add these methods to your existing UserManager class
async checkFeatureAccess(userId, feature) {
    try {
        const user = await this.getUserById(userId);
        if (!user) return false;

        const featureMatrix = {
            'strava-analysis': ['free', 'trial', 'active'], // Free feature
            'hrv-coaching': ['trial', 'active'], // Premium feature
            'whatsapp-coaching': ['trial', 'active'], // Premium feature
            'advanced-analytics': ['active'], // Paid only
            'race-planning': ['active'] // Paid only
        };

        const allowedStatuses = featureMatrix[feature];
        const hasAccess = allowedStatuses?.includes(user.subscriptionStatus);

        // Track feature access attempt
        await this.trackActivity(userId, 'feature-access', { 
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

  // ==================== USER CREATION ====================
  
  async createUser(userData) {
    try {
      const { email, password, firstName, lastName, phoneNumber, referralCode } = userData;
      
      // Check if user exists
      const existingUser = await this.getUserByEmail(email);
      if (existingUser) {
        throw new Error('User already exists');
      }

      // Hash password
      const hashedPassword = await bcrypt.hash(password, 12);
      
      // Generate unique referral code
      const userReferralCode = await this.generateReferralCode(firstName, lastName);
      
      // Create user object
      const newUser = {
        email: email.toLowerCase(),
        firstName,
        lastName,
        phoneNumber: phoneNumber || null,
        password: hashedPassword,
        emailVerified: false,
        
        // Subscription defaults
        subscriptionStatus: 'free',
        currentPlan: null,
        currentPrice: 0,
        originalPrice: 0,
        
        // Trial setup (14 days)
        trialStartDate: null,
        trialEndDate: null,
        
        // Usage tracking
        loginCount: 0,
        totalAnalyses: 0,
        whatsappOptIn: false,
        
        // Marketing
        promoCodesUsed: [],
        referralCode: userReferralCode,
        referredBy: referralCode || null,
        
        // Metadata
        createdAt: new Date(),
        updatedAt: new Date(),
        active: true
      };

      // Save to database
      const userRef = await this.db.collection('users').add(newUser);
      
      // Track user creation
      await this.trackActivity(userRef.id, 'user_created', { 
        referralCode: referralCode || null 
      });
      
      return {
        id: userRef.id,
        ...newUser,
        password: undefined // Don't return password
      };

    } catch (error) {
      console.error('Create user error:', error);
      throw error;
    }
  }

  // Add this method to UserManager class - OAuth user creation
async createOAuthUser(userData) {
    try {
        const { googleId, email, firstName, lastName, avatar, provider } = userData;
        
        // Check if user exists
        const existingUser = await this.getUserByEmail(email);
        if (existingUser) {
            // Update existing user with OAuth data
            await this.updateUser(existingUser.id, {
                googleId: googleId,
                firstName: firstName || existingUser.firstName,
                lastName: lastName || existingUser.lastName,
                avatar: avatar || existingUser.avatar,
                lastLogin: new Date(),
                emailVerified: true
            });
            return existingUser;
        }
        
        const userReferralCode = await this.generateReferralCode(firstName, lastName);
        
        const newUser = {
            email: email.toLowerCase(),
            firstName,
            lastName,
            googleId,
            avatar: avatar || null,
            password: crypto.randomBytes(16).toString('hex'), // Random password for OAuth
            emailVerified: true, // OAuth accounts are pre-verified
            
            // Subscription defaults
            subscriptionStatus: 'free',
            currentPlan: null,
            currentPrice: 0,
            originalPrice: 0,
            
            // Marketing
            referralCode: userReferralCode,
            
            // Metadata  
            createdAt: new Date(),
            updatedAt: new Date(),
            active: true,
            authProvider: provider || 'google'
        };
        
        const userRef = await this.db.collection('users').add(newUser);
        await this.trackActivity(userRef.id, 'oauth_signup', { provider });
        
        return { id: userRef.id, ...newUser, password: undefined };
    } catch (error) {
        console.error('Create OAuth user error:', error);
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
      console.log('👤 User found:', user.id);
        console.log('🔑 Stored password hash:', user.password.substring(0, 20) + '...');
        console.log('🔑 Testing password:', password);

      const isValidPassword = await bcrypt.compare(password, user.password);
      console.log('🔑 Password match result:', isValidPassword);
      if (!isValidPassword) {
        console.log('❌ Password mismatch for:', email);
        throw new Error('Invalid credentials');
      }
      console.log('✅ Authentication successful for:', email);

      // Update login stats
      await this.updateUser(user.id, {
        lastLogin: new Date(),
        loginCount: (user.loginCount || 0) + 1
      });

      // Track login
      await this.trackActivity(user.id, 'login');

      // Generate JWT token
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
      
      // Check if already had a trial
      if (user.trialStartDate) {
        throw new Error('Trial already used');
      }

      const trialStart = new Date();
      const trialEnd = new Date();
      trialEnd.setDate(trialEnd.getDate() + 14); // 14 days

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

      // Track trial start
      await this.trackActivity(userId, 'trial_started', { planType });
      
      // Schedule trial end reminder (you'd implement this)
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

      // Calculate pricing with promo
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

      // Record subscription history
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

      // Track conversion
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
        'strava_analysis': ['free', 'trial', 'active'], // Free feature
        'hrv_coaching': ['trial', 'active'], // Premium feature
        'whatsapp_coaching': ['trial', 'active'], // Premium feature
        'advanced_analytics': ['active'], // Paid only
        'race_planning': ['active'] // Paid only
      };

      const allowedStatuses = featureMatrix[feature] || [];
      const hasAccess = allowedStatuses.includes(user.subscriptionStatus);

      // Track feature access attempt
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

  async createOAuthUser(userData) {
  try {
    const { googleId, email, firstName, lastName, avatar, provider } = userData;
    
    const userReferralCode = await this.generateReferralCode(firstName, lastName);
    
    const newUser = {
      email: email.toLowerCase(),
      firstName,
      lastName,
      googleId: googleId || null,
      avatar: avatar || null,
      password: crypto.randomBytes(16).toString('hex'), // Random password for OAuth
      emailVerified: true, // OAuth accounts are pre-verified
      
      // Subscription defaults
      subscriptionStatus: 'free',
      currentPlan: null,
      
      // Marketing
      referralCode: userReferralCode,
      
      // Metadata
      createdAt: new Date(),
      updatedAt: new Date(),
      active: true,
      authProvider: provider || 'google'
    };

    const userRef = await this.db.collection('users').add(newUser);
    
    await this.trackActivity(userRef.id, 'oauth_signup', { provider });
    
    return {
      id: userRef.id,
      ...newUser,
      password: undefined
    };

  } catch (error) {
    console.error('Create OAuth user error:', error);
    throw error;
  }
}

  async getUserAnalytics(userId) {
    try {
      const user = await this.getUserById(userId);
      if (!user) throw new Error('User not found');

      // Get activity history
      const activitySnapshot = await this.db.collection('userActivity')
        .where('userId', '==', userId)
        .orderBy('timestamp', 'desc')
        .limit(50)
        .get();

      const activities = activitySnapshot.docs.map(doc => doc.data());

      // Calculate engagement metrics
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
    // Remove sensitive data before sending to frontend
    const { password, stravaAccessToken, stravaRefreshToken, ...safeUser } = user;
    return safeUser;
  }

  async generateReferralCode(firstName, lastName) {
    const base = (firstName.substring(0, 2) + lastName.substring(0, 2)).toUpperCase();
    const random = crypto.randomBytes(2).toString('hex').toUpperCase();
    return `${base}${random}`;
  }

  calculateEngagementScore(activities) {
    // Simple engagement scoring algorithm
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
}

module.exports = UserManager;

// Add this function to test different user types
// Create test users function - add this AFTER module.exports
async function createTestUsers(userManager) {
  try {
    console.log('🔧 Creating test users...');
    
    // Create free test user
    const freeUser = {
      email: 'free@test.com',
      password: 'password123',
      firstName: 'Free',
      lastName: 'User',
      phoneNumber: null
    };
    
    try {
      await userManager.createUser(freeUser);
      console.log('✅ Free test user created');
    } catch (error) {
      if (error.message === 'User already exists') {
        console.log('✅ Free test user already exists');
      } else {
        throw error;
      }
    }
    
    // Create premium test user
    const premiumUserData = {
      email: 'premium@test.com',
      password: 'password123',
      firstName: 'Premium',
      lastName: 'User', 
      phoneNumber: null
    };
    
    try {
      const premiumUser = await userManager.createUser(premiumUserData);
      // Update to premium status
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
        console.log('✅ Premium test user already exists');
      } else {
        throw error;
      }
    }
    
  } catch (error) {
    console.error('❌ Error creating test users:', error);
  }
}

// Export the function
module.exports.createTestUsers = createTestUsers;

// Add this method to userManager or directly in app.js
async function getUserByPhone(phoneNumber) {
    try {
        const usersRef = db.collection('users');
        const snapshot = await usersRef.where('phoneNumber', '==', phoneNumber).limit(1).get();
        
        if (snapshot.empty) {
            return null;
        }
        
        const doc = snapshot.docs[0];
        return { id: doc.id, ...doc.data() };
    } catch (error) {
        console.error('Error getting user by phone:', error);
        return null;
    }
}


// Call this when server starts (add to your app.js)
// createTestUsers();
