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

    // Shared method for fetching from DB (used by both Live and Cache paths)
    async fetchLocalWorkoutHistory(userId, days) {
        try {
            const startDate = new Date();
            startDate.setDate(startDate.getDate() - days);

            // Query 'workouts' collection where completed=true
            const snapshot = await this.db.collection('workouts')
                .where('userId', '==', userId)
                .where('scheduledDate', '>=', startDate)
                .where('completed', '==', true)
                .orderBy('scheduledDate', 'desc')
                .get();

            const workouts = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data(),
                startDate: doc.data().scheduledDate?.toDate()
            }));

            const stats = this.calculateWorkoutStats(workouts);

            return {
                workouts,
                stats,
                period: { days, startDate, endDate: new Date() },
                source: 'workouts_db'
            };
        } catch (error) {
            console.error('Fetch local history error:', error);
            return { workouts: [], stats: {}, error: error.message };
        }
    }

    calculateWorkoutStats(workouts) {
        if (workouts.length === 0) {
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

            const weekKey = this.getWeekKey(workout.startDate || workout.scheduledDate);
            if (!stats.weeklyBreakdown[weekKey]) {
                stats.weeklyBreakdown[weekKey] = { week: weekKey, distance: 0 };
            }
            stats.weeklyBreakdown[weekKey].distance += dist;
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

    async getPersonalRecords(userId) {
        try {
            // Get accurate totals from Strava
            const stats = await this.stravaService.getAthleteStats(userId);
            
            // Get longest run from local DB (faster)
            const longestRunSnap = await this.db.collection('workouts')
                .where('userId', '==', userId)
                .where('completed', '==', true)
                .orderBy('distance', 'desc')
                .limit(1)
                .get();
            
            let longestRun = { distance: 0, date: 'N/A' };
            if (!longestRunSnap.empty) {
                const lr = longestRunSnap.docs[0].data();
                longestRun = {
                    distance: lr.actualDistance || lr.distance,
                    date: new Date(lr.scheduledDate).toLocaleDateString()
                };
            }

            return {
                totalRuns: stats.all_run_totals?.count || 0,
                totalDistance: (stats.all_run_totals?.distance / 1000).toFixed(2) || '0.00',
                totalTime: Math.round((stats.all_run_totals?.moving_time || 0) / 3600),
                longestRun,
                source: 'mixed'
            };
        } catch (error) {
            return { totalRuns: 0, totalDistance: 0, longestRun: { distance: 0, date: 'N/A' } };
        }
    }

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