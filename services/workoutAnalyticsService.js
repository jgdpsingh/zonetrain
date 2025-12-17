// services/workoutAnalyticsService.js - UPDATED TO USE STRAVA
const StravaService = require('./stravaService');

class WorkoutAnalyticsService {
    constructor(db) {
        this.db = db;
        this.stravaService = new StravaService(db);
    }

    // Get workout history from Strava
    async getWorkoutHistory(userId, days = 30) {
        try {
            // First, sync latest Strava data
            await this.stravaService.syncActivities(userId);

            // Get activities from local cache
            const startDate = new Date();
            startDate.setDate(startDate.getDate() - days);

            const snapshot = await this.db.collection('strava_activities')
                .where('userId', '==', userId)
                .where('startDate', '>=', startDate)
                .orderBy('startDate', 'desc')
                .get();

            const workouts = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data(),
                startDate: doc.data().startDate?.toDate()
            }));

            const stats = this.calculateWorkoutStats(workouts);

            return {
                workouts,
                stats,
                period: { days, startDate, endDate: new Date() },
                source: 'strava'
            };
        } catch (error) {
            console.error('Get workout history error:', error);
            
            // Fallback: try to get from cache without sync
            return await this.getWorkoutHistoryFromCache(userId, days);
        }
    }

    // Get from cache only (faster, but may be outdated)
    async getWorkoutHistoryFromCache(userId, days = 30) {
        try {
            const startDate = new Date();
            startDate.setDate(startDate.getDate() - days);

            const snapshot = await this.db.collection('strava_activities')
                .where('userId', '==', userId)
                .where('startDate', '>=', startDate)
                .orderBy('startDate', 'desc')
                .get();

            const workouts = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data(),
                startDate: doc.data().startDate?.toDate()
            }));

            const stats = this.calculateWorkoutStats(workouts);

            return {
                workouts,
                stats,
                period: { days, startDate, endDate: new Date() },
                source: 'cache',
                lastSync: workouts[0]?.syncedAt
            };
        } catch (error) {
            console.error('Get from cache error:', error);
            return {
                workouts: [],
                stats: this.calculateWorkoutStats([]),
                error: 'No data available'
            };
        }
    }

    // Calculate stats from Strava data
    calculateWorkoutStats(workouts) {
        if (workouts.length === 0) {
            return {
                totalWorkouts: 0,
                totalDistance: 0,
                totalDuration: 0,
                totalElevation: 0,
                averageSpeed: 0,
                workoutTypes: {},
                weeklyBreakdown: [],
                progressTrend: 'no_data'
            };
        }

        const stats = {
            totalWorkouts: workouts.length,
            totalDistance: 0,
            totalDuration: 0,
            totalElevation: 0,
            totalCalories: 0,
            workoutTypes: {},
            weeklyBreakdown: {}
        };

        workouts.forEach(workout => {
            stats.totalDistance += workout.distance || 0;
            stats.totalDuration += workout.movingTime || 0;
            stats.totalElevation += workout.totalElevationGain || 0;
            stats.totalCalories += workout.calories || 0;

            const type = workout.type || 'Run';
            stats.workoutTypes[type] = (stats.workoutTypes[type] || 0) + 1;

            const weekKey = this.getWeekKey(workout.startDate);
            if (!stats.weeklyBreakdown[weekKey]) {
                stats.weeklyBreakdown[weekKey] = {
                    week: weekKey,
                    count: 0,
                    distance: 0,
                    duration: 0,
                    elevation: 0
                };
            }
            stats.weeklyBreakdown[weekKey].count++;
            stats.weeklyBreakdown[weekKey].distance += workout.distance || 0;
            stats.weeklyBreakdown[weekKey].duration += workout.movingTime || 0;
            stats.weeklyBreakdown[weekKey].elevation += workout.totalElevationGain || 0;
        });

        stats.averageSpeed = stats.totalDistance > 0 
            ? ((stats.totalDistance / (stats.totalDuration / 60))).toFixed(2) // km/h
            : 0;
        stats.averagePace = stats.totalDistance > 0
            ? this.speedToPace(stats.averageSpeed)
            : '0:00';
        stats.averageDistance = (stats.totalDistance / stats.totalWorkouts).toFixed(2);
        stats.averageDuration = Math.round(stats.totalDuration / stats.totalWorkouts);

        stats.weeklyBreakdown = Object.values(stats.weeklyBreakdown).sort((a, b) => 
            a.week.localeCompare(b.week)
        );

        stats.progressTrend = this.calculateTrend(stats.weeklyBreakdown);

        return stats;
    }

    speedToPace(speedKmh) {
        if (!speedKmh || speedKmh === 0) return '0:00';
        const paceMinPerKm = 60 / speedKmh;
        const mins = Math.floor(paceMinPerKm);
        const secs = Math.round((paceMinPerKm - mins) * 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
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

    // Get personal records from Strava stats
   async getPersonalRecords(userId) {
    try {
        console.log(`📊 Fetching Personal Records for user ${userId}...`);

        // 1. Get Aggregated Totals (Total Runs, Dist, Time)
        // These are pre-calculated by Strava and are usually accurate.
        const stats = await this.stravaService.getAthleteStats(userId);

        // 2. Find Longest Run by fetching Activity List from API
        // We bypass the local DB because it might be out of sync.
        let longestRunDistance = 0;
        let longestRunDate = 'N/A';

        // Retrieve the user's Token to make the API call
        const userDoc = await this.db.collection('users').doc(userId).get();
        const accessToken = userDoc.data()?.stravaAccessToken; // Ensure this field name matches your DB

        if (accessToken) {
            const { default: axios } = await import('axios');
            
            // Fetch last 100 activities (enough to likely find a recent longest run)
            // Note: For a true "All Time" longest run without DB, you'd need to fetch all pages, 
            // but 100 is a good trade-off for speed vs accuracy in this fix.
            const activitiesRes = await axios.get('https://www.strava.com/api/v3/athlete/activities', {
                headers: { 'Authorization': `Bearer ${accessToken}` },
                params: { per_page: 100, page: 1 } 
            });

            const activities = activitiesRes.data || [];
            
            // Filter strictly for RUNS (ignoring that 1375km ride)
            const runs = activities.filter(a => a.type === 'Run');
            
            if (runs.length > 0) {
                // Find the max distance in this batch
                const longest = runs.reduce((max, curr) => (curr.distance > max.distance ? curr : max), { distance: 0 });
                
                longestRunDistance = (longest.distance / 1000).toFixed(2);
                longestRunDate = new Date(longest.start_date).toLocaleDateString();
            }
        }

        return {
            totalRuns: stats.all_run_totals?.count || 0,
            totalDistance: (stats.all_run_totals?.distance / 1000).toFixed(2) || '0.00',
            totalTime: Math.round((stats.all_run_totals?.moving_time || 0) / 3600),
            longestRun: {
                distance: longestRunDistance,
                date: longestRunDate
            },
            source: 'strava_api_live'
        };

    } catch (error) {
        console.error('❌ Personal records error:', error);
        return { 
            longestRun: { distance: 0, date: 'N/A' },
            totalRuns: 0, 
            totalDistance: 0, 
            totalTime: 0
        };
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
                source: 'strava'
            };
        } catch (error) {
            console.error('Get chart data error:', error);
            return { metric, data: [], error: 'No data available' };
        }
    }
}

module.exports = WorkoutAnalyticsService;
