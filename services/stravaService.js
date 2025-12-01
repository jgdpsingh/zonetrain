// services/stravaService.js
const axios = require('axios');

class StravaService {
    constructor(db) {
        this.db = db;
        this.baseURL = 'https://www.strava.com/api/v3';
    }

    // Get user's Strava access token
    async getAccessToken(userId) {
        const userDoc = await this.db.collection('users').doc(userId).get();
        const user = userDoc.data();

        if (!user.stravaAccessToken) {
            throw new Error('Strava not connected');
        }

        // Check if token needs refresh
        if (user.stravaTokenExpiry && user.stravaTokenExpiry.toDate() < new Date()) {
            return await this.refreshAccessToken(userId, user.stravaRefreshToken);
        }

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

    // Sync activities to local database (for caching)
    async syncActivities(userId) {
        try {
            console.log('🔄 Syncing Strava activities for user:', userId);

            // Get activities from last 90 days
            const endDate = new Date();
            const startDate = new Date();
            startDate.setDate(endDate.getDate() - 90);

            const activities = await this.getActivitiesInRange(userId, startDate, endDate);

            // Store in database for quick access
            const batch = this.db.batch();

            activities.forEach(activity => {
                const activityRef = this.db.collection('strava_activities').doc(`${userId}_${activity.id}`);
                batch.set(activityRef, {
                    userId,
                    stravaActivityId: activity.id,
                    name: activity.name,
                    type: activity.type,
                    distance: activity.distance / 1000, // Convert to km
                    movingTime: activity.moving_time / 60, // Convert to minutes
                    elapsedTime: activity.elapsed_time / 60,
                    totalElevationGain: activity.total_elevation_gain,
                    startDate: new Date(activity.start_date),
                    averageSpeed: activity.average_speed * 3.6, // Convert to km/h
                    maxSpeed: activity.max_speed * 3.6,
                    averageHeartrate: activity.average_heartrate || null,
                    maxHeartrate: activity.max_heartrate || null,
                    calories: activity.calories || null,
                    sufferScore: activity.suffer_score || null,
                    hasHeartrate: activity.has_heartrate || false,
                    synced: true,
                    syncedAt: new Date()
                }, { merge: true });
            });

            await batch.commit();

            console.log(`✅ Synced ${activities.length} activities`);
            await this.db.collection('users').doc(userId).update({
  stravaLastSync: new Date()
}); 

            return {
                success: true,
                count: activities.length
            };
        } catch (error) {
            console.error('Sync activities error:', error);
            throw error;
        }
    }
}

module.exports = StravaService;
