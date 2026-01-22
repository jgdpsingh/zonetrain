// services/workoutAnalyticsService.js - FIXED & UPDATED

const StravaService = require('./stravaService');

class WorkoutAnalyticsService {
    constructor(db, aiService) {
        this.db = db;
        this.aiService = aiService; // ✅ Correctly assign AI Service
        this.stravaService = new StravaService(db, aiService);
    }

    // ✅ CRITICAL MISSING FUNCTION: Analyze and Save Workout
    async processNewActivity(userId, activityData) {
        console.log(`🧠 AI Analyzing Activity: ${activityData.name} (${activityData.distance}km)`);

        try {
            // 1. Find a matching scheduled workout (by date)
            // We look for a workout scheduled for the SAME DAY as the activity
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
                // Case B: Unplanned Run - Create a new workout entry!
                console.log(`🆕 Unplanned run detected. Creating new workout entry...`);
                docRef = this.db.collection('workouts').doc();
                workoutId = docRef.id;
                
                // Create a basic workout structure from the Strava data
                plannedWorkout = {
                    userId,
                    title: activityData.name,
                    type: 'Run',
                    description: 'Unplanned activity synced from Strava',
                    distance: 0, // No "planned" distance
                    duration: 0,
                    scheduledDate: activityDate,
                    createdAt: new Date()
                };
            }

            // 2. Generate AI Analysis
            // We compare actual (activityData) vs planned (plannedWorkout)
            // Ensure aiService is available
            if (!this.aiService) {
                throw new Error("AI Service not initialized in WorkoutAnalyticsService");
            }
            
            const analysis = await this.aiService.analyzeWorkoutPerformance(plannedWorkout, activityData);

            // 3. Update the Workout Document with Analysis & Strava Data
            await docRef.set({
                ...plannedWorkout, // Keep existing plan data if any
                
                // Merge actual performance data
                completed: true,
                completedAt: new Date(),
                stravaActivityId: activityData.stravaActivityId || activityData.id,
                actualDistance: activityData.distance,
                actualDuration: activityData.movingTime,
                averagePace: this.calculatePace(activityData.movingTime, activityData.distance),
                averageHeartrate: activityData.averageHeartrate,
                
                // Save the AI Analysis
                aiAnalysis: {
                    matchscore: analysis.matchScore,
                    feedback: analysis.feedback,
                    tip: analysis.tip,
                    generatedAt: new Date()
                },
                
                // Ensure it shows up as a "Run"
                type: 'Run' 
            }, { merge: true });

            console.log(`💾 Analysis saved to workouts/${workoutId}`);
            return { success: true, workoutId };

        } catch (error) {
            console.error('❌ Error processing activity:', error);
            return { success: false, error: error.message };
        }
    }

    // Helper: Calculate pace string (min/km)
    calculatePace(minutes, km) {
        if (!km || km === 0) return '0:00';
        const paceDec = minutes / km;
        const mm = Math.floor(paceDec);
        const ss = Math.round((paceDec - mm) * 60);
        return `${mm}:${ss.toString().padStart(2, '0')}`;
    }

    // --- Existing Methods (Kept as is) ---

    async getWorkoutHistory(userId, days = 30) {
        try {
            // First, sync latest Strava data
            await this.stravaService.syncActivities(userId);

            // Get activities from local cache (using 'workouts' collection if preferred, or 'strava_activities')
            // NOTE: Changing this to 'workouts' to unify data source for the dashboard
            const startDate = new Date();
            startDate.setDate(startDate.getDate() - days);

            // Fetch from 'workouts' where completed = true (contains analysis)
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
            console.error('Get workout history error:', error);
            return { workouts: [], stats: {}, error: error.message };
        }
    }

    // Calculate stats 
    calculateWorkoutStats(workouts) {
        if (workouts.length === 0) {
            return {
                totalWorkouts: 0,
                totalDistance: 0,
                totalDuration: 0,
                averagePace: '0:00',
                weeklyBreakdown: [],
                progressTrend: 'no_data'
            };
        }

        const stats = {
            totalWorkouts: workouts.length,
            totalDistance: 0,
            totalDuration: 0,
            weeklyBreakdown: {}
        };

        workouts.forEach(workout => {
            // Handle both structure types (direct or nested)
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
        const lastWeek = weeklyData[weeklyData.length - 1];
        const prevWeek = weeklyData[weeklyData.length - 2];
        if (!prevWeek.distance) return 'stable';
        
        const change = ((lastWeek.distance - prevWeek.distance) / prevWeek.distance) * 100;
        if (change > 10) return 'improving';
        if (change < -10) return 'declining';
        return 'stable';
    }

    // Get personal records
    async getPersonalRecords(userId) {
        try {
            // Using Strava Service for aggregated stats
            const stats = await this.stravaService.getAthleteStats(userId);
            
            // Helper to find longest run from local DB to save API calls
            const longestRunSnap = await this.db.collection('workouts')
                .where('userId', '==', userId)
                .where('completed', '==', true)
                .orderBy('distance', 'desc') // Ensure you index 'distance'
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
                longestRun,
                source: 'mixed'
            };
        } catch (error) {
            console.error('Personal records error:', error);
            return { totalRuns: 0, totalDistance: 0 };
        }
    }

    // Get progress chart data
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