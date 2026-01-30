// services/workoutAnalyticsService.js - HYBRID FINAL VERSION

const StravaService = require('./stravaService');

const RUN_TYPES = new Set(['run', 'trailrun', 'virtualrun']);

function isRunType(t) {
  return RUN_TYPES.has(String(t || '').trim().toLowerCase());
}

function toJsDate(v) {
  if (!v) return null;
  if (typeof v.toDate === 'function') return v.toDate();
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

class WorkoutAnalyticsService {
    constructor(db, aiService) {
        this.db = db;
        this.aiService = aiService; 
        this.stravaService = new StravaService(db, aiService);
    }

    // -------------------------------------------------------------------------
    // 1. DATA INGESTION & AI ANALYSIS
    // -------------------------------------------------------------------------

   // Inside services/workoutAnalyticsService.js (same class)
// Drop-in replacement for async processNewActivity(userId, activityData)

async processNewActivity(userId, activityData) {
  const stravaId = activityData.stravaActivityId || activityData.id;

  // ---- Normalize units defensively ----
  let distanceKm = Number(activityData.distance ?? activityData.actualDistance ?? 0);
  // Heuristic: if it's huge, it's probably meters
  if (distanceKm > 500) distanceKm = distanceKm / 1000;

  let movingMin = Number(
    activityData.movingTime ?? activityData.actualDuration ?? activityData.duration ?? 0
  );
  // Heuristic: if it's huge, it's probably seconds
  if (movingMin > 1000) movingMin = movingMin / 60;

  const activityDate = new Date(activityData.startDate || activityData.scheduledDate || Date.now());
  const startOfDay = new Date(activityDate); startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(activityDate);   endOfDay.setHours(23, 59, 59, 999);

  console.log(`🧠 AI Analyzing Activity: ${activityData.name || 'Run'} (${distanceKm}km)`);

  const looksRestWorkout = (w = {}) => {
    const t = String(w.type || '').toLowerCase();
    const title = String(w.title || w.name || '').toLowerCase();
    return t.includes('rest') || title.includes('rest');
  };

  try {
    let workoutId = null;
    let plannedWorkout = null;
    let docRef = null;

    // ------------------------------------------------------------------
    // 1) BEST MATCH: existing workout already linked to this Strava activity
    // ------------------------------------------------------------------
    if (stravaId) {
      const byStravaSnap = await this.db.collection('workouts')
        .where('userId', '==', userId)
        .where('stravaActivityId', '==', stravaId)
        .limit(1)
        .get();

      if (!byStravaSnap.empty) {
        const doc = byStravaSnap.docs[0];
        workoutId = doc.id;
        plannedWorkout = doc.data();
        docRef = doc.ref;
        console.log(`✅ Matched by stravaActivityId: ${workoutId}`);
      }
    }

    // ------------------------------------------------------------------
    // 2) FALLBACK MATCH: same-day scheduled workout (but NEVER a Rest day)
    // ------------------------------------------------------------------
    if (!docRef) {
      const scheduledSnap = await this.db.collection('workouts')
        .where('userId', '==', userId)
        .where('scheduledDate', '>=', startOfDay)
        .where('scheduledDate', '<=', endOfDay)
        .limit(10) // grab a few; we'll pick the best client-side
        .get();

      if (!scheduledSnap.empty) {
        // Prefer non-rest workouts (and ideally non-completed ones)
        const candidates = scheduledSnap.docs
          .map(d => ({ id: d.id, ref: d.ref, data: d.data() }))
          .filter(x => !looksRestWorkout(x.data));

        // Choose: not completed first, else any
        const best =
          candidates.find(x => !x.data.completed && x.data.status !== 'skipped') ||
          candidates[0];

        if (best) {
          workoutId = best.id;
          plannedWorkout = best.data;
          docRef = best.ref;
          console.log(`✅ Matched with scheduled workout (non-rest): ${workoutId}`);
        }
      }
    }

    // ------------------------------------------------------------------
    // 3) CREATE: no suitable scheduled workout (or only rest days existed)
    // ------------------------------------------------------------------
    if (!docRef) {
      console.log(`🆕 No suitable scheduled workout found (or only Rest). Creating new workout entry...`);
      docRef = this.db.collection('workouts').doc();
      workoutId = docRef.id;

      plannedWorkout = {
        userId,
        title: activityData.name || 'Strava Run',
        type: 'Run',
        description: 'Unplanned activity synced from Strava',
        distance: 0,
        duration: 0,
        scheduledDate: activityDate,
        createdAt: new Date(),
      };
    }

    // If a scheduled workout somehow still looks like Rest, do NOT overwrite it.
    // Create a new run instead (protects planned rest days).
    if (plannedWorkout && looksRestWorkout(plannedWorkout)) {
      console.log(`⚠️ Scheduled workout looked like Rest. Creating a separate run workout instead.`);
      docRef = this.db.collection('workouts').doc();
      workoutId = docRef.id;

      plannedWorkout = {
        userId,
        title: activityData.name || 'Strava Run',
        type: 'Run',
        description: 'Run detected on a planned rest day (synced from Strava)',
        distance: 0,
        duration: 0,
        scheduledDate: activityDate,
        createdAt: new Date(),
      };
    }

    // ------------------------------------------------------------------
    // 4) AI analysis
    // ------------------------------------------------------------------
    if (!this.aiService) throw new Error('AI Service not initialized');

    const analysis = await this.aiService.analyzeWorkoutPerformance(plannedWorkout, {
      ...activityData,
      distance: distanceKm,
      movingTime: movingMin,
      stravaActivityId: stravaId,
      startDate: activityDate,
    });

    // Decide what title to store on the workout doc
    const resolvedTitle =
      (plannedWorkout?.title && !looksRestWorkout(plannedWorkout))
        ? plannedWorkout.title
        : (activityData.name || plannedWorkout?.title || 'Run');

    // ------------------------------------------------------------------
    // 5) Save to workouts
    // ------------------------------------------------------------------
    await docRef.set(
      {
        ...plannedWorkout,

        // identity + display
        title: resolvedTitle,
        name: activityData.name || plannedWorkout?.name || resolvedTitle,
        type: 'Run',

        // completion/linkage
        completed: true,
        completedAt: activityDate, // IMPORTANT: use activity date, not "now"
        stravaActivityId: stravaId || null,

        // actuals (normalized)
        actualDistance: distanceKm,
        actualDuration: movingMin,
        averagePace: this.calculatePace(movingMin, distanceKm),
        averageHeartrate: activityData.averageHeartrate ?? null,

        // analysis
        aiAnalysis: {
          matchscore: analysis.matchScore,
          feedback: analysis.feedback,
          tip: analysis.tip,
          generatedAt: new Date(),
        },

        updatedAt: new Date(),
      },
      { merge: true }
    );

    // ------------------------------------------------------------------
    // 6) Best-effort: mirror aiAnalysis back into stravaactivities for UI
    // Note: your stravaactivities doc id pattern is `${userId}${activity.id}`
    // ------------------------------------------------------------------
    if (stravaId) {
      try {
        const stravaDocId = `${userId}${stravaId}`;
        await this.db.collection('stravaactivities').doc(stravaDocId).set(
          {
            aiAnalysis: {
              matchscore: analysis.matchScore,
              feedback: analysis.feedback,
              tip: analysis.tip,
              generatedAt: new Date(),
            },
            aiAnalyzedAt: new Date(),
            updatedAt: new Date(),
          },
          { merge: true }
        );
      } catch (mirrorErr) {
        console.warn('⚠️ Could not mirror aiAnalysis to stravaactivities:', mirrorErr.message);
      }
    }

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

      const workoutsSnap = await this.db.collection('workouts')
        .where('userId', '==', userId)
        .where('scheduledDate', '>=', startDate)
        .where('completed', '==', true)
        .orderBy('scheduledDate', 'desc')
        .get();

      const stravaSnap = await this.db.collection('stravaactivities')
        .where('userId', '==', userId)
        .where('startDate', '>=', startDate)
        .orderBy('startDate', 'desc')
        .get();

      const processedIds = new Set();
      const mergedWorkouts = [];

      // A) Workouts DB (AI-analyzed) — normalize for UI
      workoutsSnap.forEach((doc) => {
        const data = doc.data();

        const title = (data.title || data.name || '').toLowerCase();
        if (title.includes('rest')) return;

        // Filter: only keep run-like workouts in history
        if (!isRunType(data.type) && !data.stravaActivityId) return;

        const stravaId = data.stravaActivityId;
        if (stravaId) processedIds.add(String(stravaId));

        const distance = Number(data.actualDistance ?? data.distance ?? 0);
        const movingTime = Number(data.actualDuration ?? data.movingTime ?? data.duration ?? 0);
        const start = toJsDate(data.completedAt) || toJsDate(data.scheduledDate) || new Date();

        mergedWorkouts.push({
          id: doc.id,
          ...data,
          // Normalize fields used by frontend widgets
          title: data.title || data.name || 'Run',
          name: data.name || data.title || 'Run',
          distance,
          movingTime,
          startDate: start,
          source: 'workoutdb',
        });
      });

      // B) Strava cache — normalize for UI, filter to runs only
      stravaSnap.forEach((doc) => {
        const data = doc.data();
        const stravaId = data.stravaActivityId || data.id;

        const name = (data.name || '').toLowerCase();
        if (name.includes('rest')) return;

        if (!isRunType(data.type) || processedIds.has(String(stravaId))) return;

        const distance = Number(data.distance ?? 0);      // already km in your sync
        const movingTime = Number(data.movingTime ?? 0);  // already minutes in your sync
        const start = toJsDate(data.startDate) || new Date();

        mergedWorkouts.push({
          id: doc.id,
          ...data,
          title: data.name || 'Strava Run',
          name: data.name || 'Strava Run',
          distance,
          movingTime,
          startDate: start,
          source: 'stravaraw',
        });
      });

      mergedWorkouts.sort((a, b) => (b.startDate || 0) - (a.startDate || 0));

      const stats = this.calculateWorkoutStats(mergedWorkouts);
      return { workouts: mergedWorkouts, stats, period: days, startDate, endDate: new Date(), source: 'hybridmerged' };
    } catch (error) {
      console.error('Fetch local history error', error);
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
    // -------------------------------------------------------------------------
    // 3. PERSONAL RECORDS (Debug Version)
    // -------------------------------------------------------------------------

    async getPersonalRecords(userId) {
        try {
            console.log(`🏆 Fetching personal records for user: ${userId}...`);

            // 1. Fetch All-Time Stats directly from Strava API
            const stravaStats = await this.stravaService.getAthleteStats(userId);

            // DEBUG: Uncomment to see full raw data if needed
            // console.log("Strava Stats Response:", JSON.stringify(stravaStats, null, 2));

            if (!stravaStats) {
                console.warn("⚠️ Strava stats returned null/undefined.");
                throw new Error("Empty stats response from Strava");
            }

            // 2. Extract Run Stats
            const runStats = stravaStats.all_run_totals; 
            const biggestRunMeters = stravaStats.biggest_run_distance; 

            // Check if runStats exists (it might be missing if the user has 0 runs)
            if (!runStats) {
                console.warn("⚠️ User has no 'all_run_totals' in Strava stats.");
                return { 
                    success: true, 
                    records: { totalRuns: 0, totalDistance: 0, totalTime: 0, longestRun: { distance: 0, date: 'N/A' } },
                    source: 'strava_empty'
                };
            }

            // 3. Format for Dashboard (Safely handle missing values)
            const records = {
                totalRuns: runStats.count || 0,
                // Convert meters to km
                totalDistance: ((runStats.distance || 0) / 1000).toFixed(0), 
                // Convert seconds to hours
                totalTime: ((runStats.moving_time || 0) / 3600).toFixed(0),
                longestRun: { 
                    distance: ((biggestRunMeters || 0) / 1000).toFixed(2), 
                    date: 'All-Time Best' 
                }
            };

            console.log(`✅ Personal Records Processed: ${records.totalRuns} runs, ${records.totalDistance} km`);

            return {
                success: true,
                records: records,
                source: 'strava_api_all_time'
            };

        } catch (error) {
            // CRITICAL: Log the actual error to understand why it's failing
            console.error('❌ Personal Records Error:', error.message);
            if (error.response) {
                console.error('   Strava API Details:', error.response.status, error.response.data);
            }

            // Fallback: Return zeros so the UI doesn't crash
            return { 
                success: false, 
                records: { totalRuns: 0, totalDistance: 0, totalTime: 0, longestRun: { distance: 0 } } 
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