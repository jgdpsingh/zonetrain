// services/workoutAnalyticsService.js - HYBRID FINAL VERSION

const StravaService = require('./stravaService');

class WorkoutAnalyticsService {
    constructor(db, aiService) {
        this.db = db;
        this.aiService = aiService; 
        this.stravaService = new StravaService(db, aiService);
    }

    // -------------------------------------------------------------------------
    // 1. DATA INGESTION & AI ANALYSIS
    // -------------------------------------------------------------------------

    async processNewActivity(userId, activityData) {
        console.log(`🧠 AI Analyzing Activity: ${activityData.name} (${activityData.distance}km)`);

        try {
            // 1. Find a matching scheduled workout (by date)
            const activityDate = new Date(activityData.startDate);
            const startOfDay = new Date(activityDate); startOfDay.setHours(0,0,0,0);
            const endOfDay = new Date(activityDate); endOfDay.setHours(23,59,59,999);

            const scheduledSnap = await this.db.collection('workouts')
                .where('userId', '==', userId)
                .where('scheduledDate', '>=', startOfDay)
                .where('scheduledDate', '<=', endOfDay)
                .limit(1)
                .get();

            let workoutId = null;
            let plannedWorkout = null;
            let docRef = null;

            if (!scheduledSnap.empty) {
                // Case A: Found a scheduled workout - Update it!
                const doc = scheduledSnap.docs[0];
                workoutId = doc.id;
                plannedWorkout = doc.data();
                docRef = doc.ref;
                console.log(`✅ Matched with scheduled workout: ${workoutId}`);
            } else {
                // Case B: Unplanned Run - Create new
                console.log(`🆕 Unplanned run detected. Creating new workout entry...`);
                docRef = this.db.collection('workouts').doc();
                workoutId = docRef.id;
                
                plannedWorkout = {
                    userId,
                    title: activityData.name,
                    type: 'Run',
                    description: 'Unplanned activity synced from Strava',
                    distance: 0,
                    duration: 0,
                    scheduledDate: activityDate,
                    createdAt: new Date()
                };
            }

            // 2. Generate AI Analysis
            if (!this.aiService) throw new Error("AI Service not initialized");
            
            const analysis = await this.aiService.analyzeWorkoutPerformance(plannedWorkout, activityData);

            // 3. Update DB
            await docRef.set({
                ...plannedWorkout,
                completed: true,
                completedAt: new Date(),
                stravaActivityId: activityData.stravaActivityId || activityData.id,
                actualDistance: activityData.distance,
                actualDuration: activityData.movingTime,
                averagePace: this.calculatePace(activityData.movingTime, activityData.distance),
                averageHeartrate: activityData.averageHeartrate,
                aiAnalysis: {
                    matchscore: analysis.matchScore,
                    feedback: analysis.feedback,
                    tip: analysis.tip,
                    generatedAt: new Date()
                },
                type: 'Run' 
            }, { merge: true });

            console.log(`💾 Analysis saved to workouts/${workoutId}`);
            return { success: true, workoutId };

        } catch (error) {
            console.error('❌ Error processing activity:', error);
            return { success: false, error: error.message };
        }
    }

    calculatePace(minutes, km) {
        if (!km || km === 0) return '0:00';
        const paceDec = minutes / km;
        const mm = Math.floor(paceDec);
        const ss = Math.round((paceDec - mm) * 60);
        return `${mm}:${ss.toString().padStart(2, '0')}`;
    }

    // -------------------------------------------------------------------------
    // 2. DATA RETRIEVAL (History & Stats)
    // -------------------------------------------------------------------------

    async getWorkoutHistory(userId, days = 30) {
        try {
            // Try Sync First
            await this.stravaService.syncActivities(userId);
            
            // Return fresh data
            return await this.fetchLocalWorkoutHistory(userId, days);
        } catch (error) {
            console.warn('⚠️ Strava Sync failed, falling back to cache:', error.message);
            // Fallback: Return what we have locally
            return await this.fetchLocalWorkoutHistory(userId, days);
        }
    }

    // Shared method for fetching from DB (Hybrid: Workouts + Strava Activities)
    async fetchLocalWorkoutHistory(userId, days) {
        try {
            const startDate = new Date();
            startDate.setDate(startDate.getDate() - days);

            // 1. Fetch AI-Analyzed Workouts (Rich Data)
            const workoutsSnap = await this.db.collection('workouts')
                .where('userId', '==', userId)
                .where('scheduledDate', '>=', startDate)
                .where('completed', '==', true)
                .orderBy('scheduledDate', 'desc')
                .get();

            // 2. Fetch Raw Strava Activities (Historical Data)
            const stravaSnap = await this.db.collection('strava_activities')
                .where('userId', '==', userId)
                .where('startDate', '>=', startDate)
                .orderBy('startDate', 'desc')
                .get();

            // 3. Merge & Deduplicate
            const processedIds = new Set();
            const mergedWorkouts = [];

            // Add Analyzed Workouts First
            workoutsSnap.forEach(doc => {
                const data = doc.data();
                const stravaId = data.stravaActivityId;
                if (stravaId) processedIds.add(String(stravaId));
                
                mergedWorkouts.push({
                    id: doc.id,
                    ...data,
                    startDate: data.scheduledDate?.toDate(), 
                    source: 'workout_db'
                });
            });

            // Add Raw Strava Activities (if not already processed)
            stravaSnap.forEach(doc => {
                const data = doc.data();
                const stravaId = data.stravaActivityId || data.id; 
                
                if (!processedIds.has(String(stravaId))) {
                    mergedWorkouts.push({
                        id: doc.id,
                        ...data,
                        title: data.name,
                        distance: data.distance, // Strava raw (km if normalized in service, or raw meters / 1000 here)
                        movingTime: data.movingTime, 
                        startDate: data.startDate?.toDate(),
                        source: 'strava_raw'
                    });
                }
            });

            // Sort merged list by date (newest first)
            mergedWorkouts.sort((a, b) => b.startDate - a.startDate);

            const stats = this.calculateWorkoutStats(mergedWorkouts);

            return {
                workouts: mergedWorkouts,
                stats,
                period: { days, startDate, endDate: new Date() },
                source: 'hybrid_merged'
            };
        } catch (error) {
            console.error('Fetch local history error:', error);
            return { workouts: [], stats: {}, error: error.message };
        }
    }

    calculateWorkoutStats(workouts) {
        if (!workouts || workouts.length === 0) {
            return {
                totalWorkouts: 0, totalDistance: 0, totalDuration: 0,
                averagePace: '0:00', weeklyBreakdown: [], progressTrend: 'no_data'
            };
        }

        const stats = {
            totalWorkouts: workouts.length,
            totalDistance: 0,
            totalDuration: 0,
            weeklyBreakdown: {}
        };

        workouts.forEach(workout => {
            const dist = workout.actualDistance || workout.distance || 0;
            const dur = workout.actualDuration || workout.movingTime || workout.duration || 0;

            stats.totalDistance += dist;
            stats.totalDuration += dur;

            const dateObj = workout.startDate || workout.scheduledDate;
            if (dateObj) {
                const weekKey = this.getWeekKey(dateObj);
                if (!stats.weeklyBreakdown[weekKey]) {
                    stats.weeklyBreakdown[weekKey] = { week: weekKey, distance: 0 };
                }
                stats.weeklyBreakdown[weekKey].distance += dist;
            }
        });

        stats.averagePace = this.calculatePace(stats.totalDuration, stats.totalDistance);
        
        stats.weeklyBreakdown = Object.values(stats.weeklyBreakdown).sort((a, b) => 
            a.week.localeCompare(b.week)
        );
        stats.progressTrend = this.calculateTrend(stats.weeklyBreakdown);

        return stats;
    }

    getWeekKey(date) {
        const d = new Date(date);
        const year = d.getFullYear();
        const week = Math.ceil((d - new Date(year, 0, 1)) / (7 * 24 * 60 * 60 * 1000));
        return `${year}-W${String(week).padStart(2, '0')}`;
    }

    calculateTrend(weeklyData) {
        if (weeklyData.length < 2) return 'stable';
        const last = weeklyData[weeklyData.length - 1];
        const prev = weeklyData[weeklyData.length - 2];
        if (!prev.distance) return 'stable';
        const change = ((last.distance - prev.distance) / prev.distance) * 100;
        if (change > 10) return 'improving';
        if (change < -10) return 'declining';
        return 'stable';
    }

    // -------------------------------------------------------------------------
    // 3. PERSONAL RECORDS & CHARTS
    // -------------------------------------------------------------------------

   // services/workoutAnalyticsService.js

    // ... existing code ...

    // ✅ FIXED: Calculate Personal Records from LOCAL DB (Reliable)
    async getPersonalRecords(userId) {
        try {
            // 1. Fetch ALL Strava activities for this user
            // Note: For very large datasets, you might want to cache this summary in the user doc.
            // But for a dashboard, querying the collection is usually fine for <1000 runs.
            const activitiesSnap = await this.db.collection('strava_activities')
                .where('userId', '==', userId)
                .get();

            let totalRuns = 0;
            let totalDistance = 0;
            let totalMovingTime = 0; // seconds
            let longestRun = { distance: 0, date: 'N/A' };

            activitiesSnap.forEach(doc => {
                const data = doc.data();
                
                // Only count Runs
                if (data.type === 'Run' || data.type === 'run') {
                    totalRuns++;
                    
                    // Strava stores distance in METERS in strava_activities
                    // But some legacy syncs might be KM. Let's normalize.
                    // Heuristic: If distance > 1000, it's meters.
                    let distKm = data.distance;
                    if (distKm > 500) distKm = distKm / 1000;
                    
                    totalDistance += distKm;
                    totalMovingTime += (data.movingTime || 0);

                    // Check Longest Run
                    if (distKm > longestRun.distance) {
                        longestRun = {
                            distance: distKm,
                            date: data.startDate ? new Date(data.startDate.toDate()).toLocaleDateString() : 'N/A'
                        };
                    }
                }
            });

            // Convert time to hours
            const totalHours = Math.round((totalMovingTime / 60) / 60);

            return {
                success: true,
                totalRuns,
                totalDistance: totalDistance.toFixed(0),
                totalTime: totalHours,
                longestRun: {
                    distance: longestRun.distance.toFixed(2),
                    date: longestRun.date
                },
                source: 'local_db_aggregation'
            };

        } catch (error) {
            console.error('❌ Personal records error:', error);
            return { 
                success: false, 
                totalRuns: 0, 
                totalDistance: 0, 
                longestRun: { distance: 0, date: 'N/A' } 
            };
        }
    }

    // ... rest of class ...

    async getProgressChartData(userId, metric = 'distance', days = 90) {
        try {
            const history = await this.getWorkoutHistory(userId, days);
            return {
                metric,
                data: history.stats.weeklyBreakdown.map(week => ({
                    week: week.week,
                    value: week[metric] || 0
                })),
                source: 'db'
            };
        } catch (error) {
            return { metric, data: [], error: 'No data' };
        }
    }
}

module.exports = WorkoutAnalyticsService;