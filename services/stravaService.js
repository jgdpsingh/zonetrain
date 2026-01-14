// services/stravaService.js
const axios = require('axios');

class StravaService {
    constructor(db) {
        this.db = db;
        this.aiService = aiService;
        this.baseURL = 'https://www.strava.com/api/v3';
    }

    // Get user's Strava access token
    // In services/stravaService.js

async getAccessToken(userId) {
    const userDoc = await this.db.collection('users').doc(userId).get();
    const user = userDoc.data();

    if (!user || !user.stravaAccessToken) {
        throw new Error('Strava not connected');
    }

    // --- FIX: Robust Expiration Check ---
    let expiryDate;

    // Check if expiry exists and handle different formats safely
    if (user.stravaTokenExpiry) {
        if (typeof user.stravaTokenExpiry.toDate === 'function') {
            // It's a Firestore Timestamp (Ideal case)
            expiryDate = user.stravaTokenExpiry.toDate();
        } else if (user.stravaTokenExpiry instanceof Date) {
            // It's already a JS Date object
            expiryDate = user.stravaTokenExpiry;
        } else if (typeof user.stravaTokenExpiry === 'number') {
             // It's a timestamp (seconds or milliseconds)
             // Strava returns seconds (epoch), JS uses milliseconds
             // Heuristic: if it's small (e.g. 1700000000), it's seconds.
             const isSeconds = user.stravaTokenExpiry < 10000000000; 
             expiryDate = new Date(user.stravaTokenExpiry * (isSeconds ? 1000 : 1));
        } else {
             // Try parsing as string
             expiryDate = new Date(user.stravaTokenExpiry);
        }
    } else {
        // Expiry is missing entirely. Force refresh.
        console.warn(`⚠️ User ${userId} has no stravaTokenExpiry. Forcing refresh.`);
        expiryDate = new Date(0); // 1970 (definitely expired)
    }

    // 2. Add a 5-minute safety buffer
    const refreshThreshold = new Date(Date.now() + 300000);

    // 3. Check if we need to refresh (Expires BEFORE "Now + 5 mins")
    // Also check for Invalid Date if parsing failed
    if (isNaN(expiryDate.getTime()) || expiryDate < refreshThreshold) {
        console.log(`🔄 Token expiring/expired/invalid (at ${expiryDate}). Refreshing...`);
        try {
            return await this.refreshAccessToken(userId, user.stravaRefreshToken);
        } catch (error) {
            console.error(`❌ Failed to refresh token for user ${userId}:`, error.message);
            // Fallback: Return existing token and hope it works, or re-throw
            // throw new Error("Please reconnect Strava"); 
            return user.stravaAccessToken; 
        }
    }

    // 4. Token is valid, return it
    return user.stravaAccessToken;
}



    // Refresh Strava token
    async refreshAccessToken(userId, refreshToken) {
        try {
            const response = await axios.post('https://www.strava.com/oauth/token', {
                client_id: process.env.STRAVA_CLIENT_ID,
                client_secret: process.env.STRAVA_CLIENT_SECRET,
                refresh_token: refreshToken,
                grant_type: 'refresh_token'
            });

            const { access_token, expires_at, refresh_token: newRefreshToken } = response.data;

            // Update tokens in database
            await this.db.collection('users').doc(userId).update({
                stravaAccessToken: access_token,
                stravaRefreshToken: newRefreshToken,
                stravaTokenExpiry: new Date(expires_at * 1000)
            });

            return access_token;
        } catch (error) {
            console.error('Refresh token error:', error);
            throw error;
        }
    }

    // Get athlete's activities (workouts)
    async getActivities(userId, params = {}) {
        try {
            const accessToken = await this.getAccessToken(userId);

            const defaultParams = {
                per_page: 30,
                page: 1,
                ...params
            };

            const response = await axios.get(`${this.baseURL}/athlete/activities`, {
                headers: { 'Authorization': `Bearer ${accessToken}` },
                params: defaultParams
            });

            return response.data;
        } catch (error) {
            console.error('Get activities error:', error);
            throw error;
        }
    }

    // Get activities within date range
    async getActivitiesInRange(userId, startDate, endDate) {
        try {
            const after = Math.floor(startDate.getTime() / 1000);
            const before = Math.floor(endDate.getTime() / 1000);

            return await this.getActivities(userId, {
                after,
                before,
                per_page: 200
            });
        } catch (error) {
            console.error('Get activities in range error:', error);
            throw error;
        }
    }

    // Get detailed activity
    async getActivityDetails(userId, activityId) {
        try {
            const accessToken = await this.getAccessToken(userId);

            const response = await axios.get(`${this.baseURL}/activities/${activityId}`, {
                headers: { 'Authorization': `Bearer ${accessToken}` }
            });

            return response.data;
        } catch (error) {
            console.error('Get activity details error:', error);
            throw error;
        }
    }

    // Get athlete stats
    async getAthleteStats(userId) {
        try {
            const accessToken = await this.getAccessToken(userId);

            // Get athlete ID
            const athleteResponse = await axios.get(`${this.baseURL}/athlete`, {
                headers: { 'Authorization': `Bearer ${accessToken}` }
            });

            const athleteId = athleteResponse.data.id;

            // Get stats
            const statsResponse = await axios.get(`${this.baseURL}/athletes/${athleteId}/stats`, {
                headers: { 'Authorization': `Bearer ${accessToken}` }
            });

            return statsResponse.data;
        } catch (error) {
            console.error('Get athlete stats error:', error);
            throw error;
        }
    }

    async updateActivity(userId, activityId, updateData) {
        try {
            const accessToken = await this.getAccessToken(userId);
            console.log(`📝 Updating Strava activity ${activityId}...`);

            const response = await axios.put(`${this.baseURL}/activities/${activityId}`, 
                updateData, 
                { headers: { 'Authorization': `Bearer ${accessToken}` } }
            );

            return response.data;
        } catch (error) {
            // Log specific Strava API error if available
            const msg = error.response?.data?.message || error.message;
            console.error(`❌ Failed to update Strava activity: ${msg}`);
            return null; // Return null so we don't crash the caller
        }
    }

    // Sync activities to local database (for caching)
    async syncActivities(userId) {
        try {
            console.log('🔄 Syncing Strava activities for user:', userId);

            // Get activities from last 90 days (or shorter window for efficiency)
            const endDate = new Date();
            const startDate = new Date();
            startDate.setDate(endDate.getDate() - 7); // OPTIMIZATION: Only check last 7 days for sync to save API calls

            const activities = await this.getActivitiesInRange(userId, startDate, endDate);

            // Get User Profile for AI Context
            const userDoc = await this.db.collection('users').doc(userId).get();
            const userData = userDoc.data();

            const batch = this.db.batch();
            let analysisCount = 0;

            for (const activity of activities) {
                const activityRef = this.db.collection('strava_activities').doc(`${userId}_${activity.id}`);
                
                // 1. Save Strava Activity
                batch.set(activityRef, {
                    userId,
                    stravaActivityId: activity.id,
                    name: activity.name,
                    type: activity.type,
                    distance: activity.distance / 1000, 
                    movingTime: activity.moving_time / 60,
                    elapsedTime: activity.elapsed_time / 60,
                    totalElevationGain: activity.total_elevation_gain,
                    startDate: new Date(activity.start_date),
                    averageSpeed: activity.average_speed * 3.6,
                    maxSpeed: activity.max_speed * 3.6,
                    averageHeartrate: activity.average_heartrate || null,
                    maxHeartrate: activity.max_heartrate || null,
                    hasHeartrate: activity.has_heartrate || false,
                    synced: true,
                    syncedAt: new Date()
                }, { merge: true });

                // 2. AI ANALYSIS TRIGGER (The New Part)
                if (this.aiService) {
                    // Find if there was a PLANNED workout for this date
                    const activityDate = new Date(activity.start_date);
                    activityDate.setHours(0,0,0,0); // Normalize time
                    
                    // Query for a workout on this date
                    // Note: This query inside a loop isn't ideal for bulk syncs, 
                    // but for 1-2 new activities it's fine.
                    const plannedWorkoutsSnapshot = await this.db.collection('workouts')
                        .where('userId', '==', userId)
                        .where('date', '==', activityDate)
                        .limit(1)
                        .get();

                    if (!plannedWorkoutsSnapshot.empty) {
                        const plannedWorkoutDoc = plannedWorkoutsSnapshot.docs[0];
                        const plannedData = plannedWorkoutDoc.data();

                        // Only analyze if not already analyzed
                        if (!plannedData.aiAnalysis) {
                            console.log(`🤖 Generating AI analysis for workout on ${activityDate.toDateString()}...`);
                            
                            // Generate Analysis
                            const analysis = await this.aiService.generateWorkoutAnalysis(
                                userData, 
                                plannedData, 
                                activity
                            );

                            // Update the PLANNED workout doc with the analysis
                            // (We don't batch this because it depends on the async AI call)
                            await plannedWorkoutDoc.ref.update({
                                aiAnalysis: analysis,
                                completed: true, // Mark as completed since we found a Strava match
                                actualDistance: activity.distance / 1000,
                                actualDuration: activity.moving_time / 60,
                                stravaActivityId: activity.id,
                                analyzedAt: new Date()
                            });
                            
                            analysisCount++;
                        }
                    }
                }
            }

            await batch.commit();

            console.log(`✅ Synced ${activities.length} activities, Generated ${analysisCount} AI analyses`);
            
            await this.db.collection('users').doc(userId).update({
                stravaLastSync: new Date()
            });

            return {
                success: true,
                count: activities.length,
                analyzed: analysisCount
            };
        } catch (error) {
            console.error('Sync activities error:', error);
            throw error;
        }
    }
}


module.exports = StravaService;
