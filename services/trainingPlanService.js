// services/trainingPlanService.js - UPDATED VERSION
class TrainingPlanService {
    constructor(db, aiService) {
        this.db = db;
        this.aiService = aiService; // Your existing AIService
    }

    // Get current training plan
    // services/trainingPlanService.js

    // Get current training plan
 // In trainingPlanService.js

async getCurrentPlan(userId) {
    try {
        console.log(`📋 Fetching plan for user: ${userId}`);

        // 1. Get ALL active plans for user
        // Filter by 'isActive' == true at the query level for efficiency
        const snapshot = await this.db.collection('trainingplans')
            .where('userId', '==', userId)
            .where('isActive', '==', true)
            .get();

        if (snapshot.empty) {
            console.log('❌ No active plans found for this userId.');
            return null;
        }

        console.log(`🔎 Found ${snapshot.size} active plan documents.`);

        // 2. Sort by creation date (Newest First) to get the LATEST active plan
        const plans = snapshot.docs.map(doc => {
            const data = doc.data();
            return {
                id: doc.id,
                ...data,
                // Robust date handling: Timestamp -> Date, String -> Date, Date -> Date, or fallback
                createdAtDate: data.createdAt && typeof data.createdAt.toDate === 'function' 
                    ? data.createdAt.toDate() 
                    : new Date(data.createdAt || 0)
            };
        });

        // Sort Descending (Newest first)
        plans.sort((a, b) => b.createdAtDate - a.createdAtDate);

        // The first one is the winner
        const plan = plans[0];
        if (plan.isActive === false) {
             console.log('⚠️ Latest plan is inactive. Returning null.');
             return null;
        }

        // OPTIONAL: Auto-deactivate older "active" plans to keep data clean
        if (plans.length > 1) {
             console.warn(`User ${userId} has multiple active plans. Deactivating older ones.`);
             const batch = this.db.batch();
             for (let i = 1; i < plans.length; i++) { // Skip the first one (index 0)
                 const ref = this.db.collection('trainingplans').doc(plans[i].id);
                 batch.update(ref, { 
                     isActive: false, 
                     deactivationReason: 'Auto-cleanup: Multiple active plans detected' 
                 });
             }
             await batch.commit().catch(err => console.error("Auto-cleanup failed", err));
        }

        console.log(`✅ Found latest active plan: ${plan.id} (${plan.planType})`);


        // 3. Get Workouts Logic (Simplified & Robust)
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        // Calculate Week Boundaries (Monday to Sunday)
        const currentDay = today.getDay(); // 0=Sun, 1=Mon...
        const diffToMon = currentDay === 0 ? -6 : 1 - currentDay;
        const weekStart = new Date(today);
        weekStart.setDate(today.getDate() + diffToMon);
        weekStart.setHours(0, 0, 0, 0);
        
        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekStart.getDate() + 7);
        weekEnd.setHours(23, 59, 59, 999);

        // Fetch workouts from 'workouts' collection
        const workoutsSnapshot = await this.db.collection('workouts')
            .where('userId', '==', userId)
            .where('scheduledDate', '>=', weekStart)
            .where('scheduledDate', '<=', weekEnd)
            .get();

        console.log(`📅 Found ${workoutsSnapshot.size} workouts in collection for this week.`);

        // 3a. Use Workouts from Collection if available
        if (!workoutsSnapshot.empty) {
             const relevantWorkouts = workoutsSnapshot.docs
                .map(doc => ({ id: doc.id, ...doc.data() }))
                // Ensure workout belongs to THIS specific plan (if planId is stored)
                .filter(w => !w.planId || w.planId === plan.id);
             
             if (relevantWorkouts.length > 0) {
                 plan.thisWeekWorkouts = relevantWorkouts.map(w => ({
                    ...w,
                    scheduledDate: w.scheduledDate.toDate ? w.scheduledDate.toDate() : new Date(w.scheduledDate)
                 }));
                 return plan;
             }
        }

        // 3b. Fallback: Extract from JSON Plan Data
        console.log('⚠️ No workouts in collection, attempting JSON fallback...');
        
        if (plan.planData && plan.planData.weeks) {
             const planStart = plan.createdAtDate;
             const diffTime = Math.abs(today - planStart);
             const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)); 
             let currentWeekIndex = Math.floor(diffDays / 7);
             
             // Bounds checking
             if (currentWeekIndex >= plan.planData.weeks.length) currentWeekIndex = plan.planData.weeks.length - 1;
             if (currentWeekIndex < 0) currentWeekIndex = 0;

             const currentWeekData = plan.planData.weeks[currentWeekIndex];

             if (currentWeekData && Array.isArray(currentWeekData.days)) {
                 plan.thisWeekWorkouts = currentWeekData.days.map((day, dayIndex) => {
                     const workoutDate = new Date(weekStart);
                     workoutDate.setDate(workoutDate.getDate() + dayIndex); 
                     
                     return {
                         id: `json-week-${currentWeekIndex}-day-${dayIndex}`,
                         dayName: day.dayName,
                         type: day.type || 'rest',
                         title: day.type || 'Workout',
                         description: day.description || '',
                         distance: day.distanceKm || 0,
                         duration: day.durationMin || 0,
                         intensity: day.intensity || 'easy',
                         scheduledDate: workoutDate,
                         completed: false
                     };
                 });
             } else {
                 plan.thisWeekWorkouts = [];
             }
             return plan;
        }

        plan.thisWeekWorkouts = [];
        return plan;

    } catch (error) {
        console.error('Get current plan error:', error);
        return null;
    }
}



    // Get training calendar
    async getTrainingCalendar(userId, days = 30) {
        try {
            const today = new Date();
            const endDate = new Date(today);
            endDate.setDate(today.getDate() + days);

            const snapshot = await this.db.collection('workouts')
                .where('userId', '==', userId)
                .where('scheduledDate', '>=', today)
                .where('scheduledDate', '<=', endDate)
                .orderBy('scheduledDate', 'asc')
                .get();

            const calendar = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data(),
                scheduledDate: doc.data().scheduledDate?.toDate()
            }));

            return this.groupByDate(calendar);
        } catch (error) {
            console.error('Get training calendar error:', error);
            throw error;
        }
    }

    groupByDate(workouts) {
        const grouped = {};

        workouts.forEach(workout => {
            const dateKey = workout.scheduledDate.toISOString().split('T')[0];
            
            if (!grouped[dateKey]) {
                grouped[dateKey] = [];
            }
            
            grouped[dateKey].push(workout);
        });

        return grouped;
    }

    // Request workout modification - USES YOUR AI SERVICE
    async requestModification(userId, workoutId, reason, preferences) {
        try {
            const workoutDoc = await this.db.collection('workouts').doc(workoutId).get();
            
            if (!workoutDoc.exists) {
                throw new Error('Workout not found');
            }

            const workout = workoutDoc.data();
            const userDoc = await this.db.collection('users').doc(userId).get();
            const userData = userDoc.data();

            // Use YOUR existing AI service to modify workout
            const modifiedWorkout = await this.aiService.adjustTrainingPlan(
                userId,
                userData,
                `Modify workout: ${reason}. Preferences: ${JSON.stringify(preferences)}`
            );

            // Save modification
            const modificationRef = await this.db.collection('workout_modifications').add({
                userId,
                workoutId,
                originalWorkout: workout,
                modifiedWorkout,
                reason,
                preferences,
                status: 'pending',
                createdAt: new Date()
            });

            return {
                success: true,
                modificationId: modificationRef.id,
                modifiedWorkout
            };
        } catch (error) {
            console.error('Request modification error:', error);
            throw error;
        }
    }

    // Apply modification
    async applyModification(modificationId) {
        try {
            const modDoc = await this.db.collection('workout_modifications').doc(modificationId).get();
            
            if (!modDoc.exists) {
                throw new Error('Modification not found');
            }

            const mod = modDoc.data();

            await this.db.collection('workouts').doc(mod.workoutId).update({
                ...mod.modifiedWorkout,
                modified: true,
                modifiedAt: new Date(),
                originalWorkout: mod.originalWorkout
            });

            await modDoc.ref.update({
                status: 'applied',
                appliedAt: new Date()
            });

            return { success: true };
        } catch (error) {
            console.error('Apply modification error:', error);
            throw error;
        }
    }

    // Get injury prevention tips - USES YOUR AI
    async getInjuryPreventionTips(userId) {
        try {
            const userDoc = await this.db.collection('users').doc(userId).get();
            const userData = userDoc.data();

            const recentWorkouts = await this.db.collection('workouts')
                .where('userId', '==', userId)
                .orderBy('completedAt', 'desc')
                .limit(7)
                .get();

            const workouts = recentWorkouts.docs.map(doc => doc.data());

            // Use your AI to generate tips
            const tips = await this.aiService.generateResponse(
                'injury_prevention',
                userId,
                userData,
                { recentWorkouts: workouts }
            );

            return tips;
        } catch (error) {
            console.error('Get injury prevention tips error:', error);
            return {
                tips: [
                    'Gradually increase training volume',
                    'Include rest days in your schedule',
                    'Focus on proper running form',
                    'Listen to your body signals'
                ],
                generated: 'fallback'
            };
        }
    }

    // Suggest recovery day
    async suggestRecoveryDay(userId) {
        try {
            const snapshot = await this.db.collection('workouts')
                .where('userId', '==', userId)
                .orderBy('completedAt', 'desc')
                .limit(14)
                .get();

            const workouts = snapshot.docs.map(doc => doc.data());

            const totalDistance = workouts.reduce((sum, w) => sum + (w.distance || 0), 0);
            const avgIntensity = workouts.reduce((sum, w) => sum + (w.intensity || 5), 0) / workouts.length;

            const needsRecovery = totalDistance > 50 || avgIntensity > 7;

            if (needsRecovery) {
                return {
                    recommended: true,
                    reason: totalDistance > 50 ? 'High training volume' : 'High training intensity',
                    totalDistance,
                    avgIntensity,
                    suggestions: [
                        'Take a complete rest day',
                        'Do light stretching or yoga',
                        'Get 8+ hours of sleep',
                        'Focus on nutrition and hydration',
                        'Consider a massage or foam rolling'
                    ]
                };
            }

            return {
                recommended: false,
                message: 'Training load is manageable. Continue with your plan.',
                totalDistance,
                avgIntensity
            };
        } catch (error) {
            console.error('Suggest recovery error:', error);
            throw error;
        }
    }
   async archiveCurrentPlan(userId) {
        console.log(`🧹 Archiving plan and cleaning calendar for user: ${userId}`);
        const batch = this.db.batch();

        // 1. Deactivate active plans AND WIPE DATA
        const planSnapshot = await this.db.collection('trainingplans')
            .where('userId', '==', userId)
            .where('isActive', '==', true)
            .get();

        planSnapshot.forEach(doc => {
            const planRef = this.db.collection('trainingplans').doc(doc.id);
            batch.update(planRef, { 
                isActive: false, 
                deactivatedAt: new Date(),
                deactivationReason: 'Plan Upgrade/Reset',
                // ➤ CRITICAL ADDITION: Destroy the data so it can't be reused
                planData: {}, 
                'planData.weeks': [] 
            });
        });

        // 2. Delete FUTURE workouts (Clean the calendar)
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const workoutsSnapshot = await this.db.collection('workouts')
            .where('userId', '==', userId)
            .where('scheduledDate', '>=', today)
            .get();

        workoutsSnapshot.forEach(doc => {
            batch.delete(doc.ref);
        });

        // 3. Commit
        if (!planSnapshot.empty || !workoutsSnapshot.empty) {
            await batch.commit();
            console.log('✅ Plan reset complete. Data wiped.');
        }
    }

    async updateSchedulePreferences(userId, preferences) {
        const { longRunDay } = preferences; // e.g., "Sunday"
        const daysOfWeek = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
        const targetDayIndex = daysOfWeek.indexOf(longRunDay);

        if (targetDayIndex === -1) throw new Error('Invalid day selected');

        // 1. Get the Active Plan
        const plansRef = this.db.collection('trainingPlans');
        const snapshot = await plansRef
            .where('userId', '==', userId)
            .where('status', '==', 'active')
            .limit(1)
            .get();

        if (snapshot.empty) throw new Error('No active plan found');
        const planDoc = snapshot.docs[0];
        const planId = planDoc.id;

        // 2. Fetch all FUTURE workouts
        const workoutsRef = this.db.collection('workouts');
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const futureWorkoutsSnapshot = await workoutsRef
            .where('planId', '==', planId)
            .where('date', '>=', today)
            .orderBy('date', 'asc')
            .get();

        if (futureWorkoutsSnapshot.empty) {
            // Just update the preference if no workouts exist yet
             await planDoc.ref.update({ 'preferences.longRunDay': longRunDay });
             return { success: true, message: "Preferences saved (no future workouts to update)." };
        }

        const batch = this.db.batch();
        
        // Group workouts by "Week Start Date" (Monday)
        const workoutsByWeek = this._groupWorkoutsByWeek(futureWorkoutsSnapshot.docs);

        // 3. Process each week to reshuffle
        for (const [weekStartStr, weeklyDocs] of Object.entries(workoutsByWeek)) {
            
            // A. Identify current key sessions
            let longRunDoc = null;
            let qualityDoc = null; 
            
            weeklyDocs.forEach(doc => {
                const data = doc.data();
                const type = (data.type || '').toLowerCase();
                const title = (data.title || '').toLowerCase();
                
                // Identify Long Run
                if (type === 'long_run' || title.includes('long run')) {
                    longRunDoc = doc;
                } 
                // Identify Quality (Intervals/Tempo)
                else if (title.includes('interval') || title.includes('tempo') || title.includes('threshold') || title.includes('fartlek')) {
                    qualityDoc = doc;
                }
            });

            if (!longRunDoc) continue; // Skip weeks without a long run (e.g. taper/race week)

            // B. Calculate Target Dates
            const weekStart = new Date(weekStartStr);
            
            // New Long Run Date
            const newLongRunDate = new Date(weekStart);
            newLongRunDate.setDate(weekStart.getDate() + targetDayIndex);

            // Calculate Optimal Quality Day (3-4 days apart)
            // If Long Run is Sunday (6), Quality is Wednesday (2)
            // If Long Run is Saturday (5), Quality is Tuesday (1) or Wednesday (2)
            let qualityDayIndex = (targetDayIndex + 3) % 7; 
            // Avoid adjacent days for hard sessions
            if (Math.abs(qualityDayIndex - targetDayIndex) < 2) {
                qualityDayIndex = (targetDayIndex + 4) % 7; 
            }
            
            const newQualityDate = new Date(weekStart);
            newQualityDate.setDate(weekStart.getDate() + qualityDayIndex);

            // C. Apply Updates via Batch
            
            // 1. Move Long Run (if date changed)
            if (!this._isSameDate(longRunDoc.data().date.toDate(), newLongRunDate)) {
                // Find doc at the target date
                const targetDoc = weeklyDocs.find(d => this._isSameDate(d.data().date.toDate(), newLongRunDate));
                
                if (targetDoc && targetDoc.id !== longRunDoc.id) {
                    // Swap Logic:
                    // Target becomes Long Run
                    batch.update(targetDoc.ref, {
                        type: 'long_run',
                        title: longRunDoc.data().title,
                        distance: longRunDoc.data().distance,
                        duration: longRunDoc.data().duration || null,
                        description: longRunDoc.data().description,
                        isKeyWorkout: true
                    });

                    // Old Long Run spot becomes Recovery (Easy)
                    batch.update(longRunDoc.ref, {
                        type: 'easy_run',
                        title: 'Recovery Run',
                        distance: 5, // Default recovery distance
                        duration: 30,
                        description: 'Easy recovery run.',
                        isKeyWorkout: false
                    });
                }
            }

            // 2. Move Quality Session (if needed)
            if (qualityDoc) {
                 const currentQDate = qualityDoc.data().date.toDate();
                 // Check if current quality date is problematic (adjacent to new long run)
                 const diffDays = Math.abs((newLongRunDate - currentQDate) / (1000 * 60 * 60 * 24));
                 
                 // If collision or adjacent (less than 2 days gap), move it
                 if (diffDays < 2) {
                     const targetQDoc = weeklyDocs.find(d => this._isSameDate(d.data().date.toDate(), newQualityDate));
                     
                     if (targetQDoc && targetQDoc.id !== qualityDoc.id && targetQDoc.id !== longRunDoc.id) {
                        // Move Quality Content to target
                        batch.update(targetQDoc.ref, {
                            type: qualityDoc.data().type,
                            title: qualityDoc.data().title,
                            distance: qualityDoc.data().distance,
                            description: qualityDoc.data().description,
                            isKeyWorkout: true
                        });
                        
                        // Old Quality spot becomes Rest/Cross
                        batch.update(qualityDoc.ref, {
                            type: 'rest',
                            title: 'Rest Day',
                            distance: 0,
                            duration: 0,
                            description: 'Rest and recovery.',
                            isKeyWorkout: false
                        });
                     }
                 }
            }
        }

        await batch.commit();

        // 4. Save Preference
        await planDoc.ref.update({
            'preferences.longRunDay': longRunDay,
            'updatedAt': new Date()
        });

        return { success: true };
    }

    // --- Helpers ---

    _groupWorkoutsByWeek(docs) {
        const weeks = {};
        docs.forEach(doc => {
            const date = doc.data().date.toDate();
            // Get Monday
            const day = date.getDay();
            const diff = date.getDate() - day + (day === 0 ? -6 : 1); 
            const monday = new Date(date);
            monday.setDate(diff);
            monday.setHours(0,0,0,0);
            
            const key = monday.toISOString();
            if (!weeks[key]) weeks[key] = [];
            weeks[key].push(doc);
        });
        return weeks;
    }
    
    _isSameDate(d1, d2) {
        return d1.getFullYear() === d2.getFullYear() &&
               d1.getMonth() === d2.getMonth() &&
               d1.getDate() === d2.getDate();
    }

// In trainingPlanService.js

// 1. UPDATED Handle Skipped Workout Logic
async handleSkippedWorkout(userId, workoutId, reason) {
    console.log(`Analyzing skip for workout ${workoutId} (${reason})`);
    
    const doc = await this.db.collection('workouts').doc(workoutId).get();
    if (!doc.exists) throw new Error("Workout not found");
    
    const workout = doc.data();
    const isKey = workout.type === 'long_run' || workout.type === 'interval' || workout.type === 'tempo';

    // A. Trivial Case: Skipped a recovery run -> Do nothing
    if (!isKey) {
        return { 
            adjusted: false, 
            message: "Skipped recovery run. No schedule changes needed. Rest well!" 
        };
    }

    // B. Key Workout Case: Try Simple Shift (Move to Tomorrow)
    const tomorrow = new Date(workout.date.toDate());
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    // Check if tomorrow is "free" (Rest or Easy)
    const nextDocs = await this.db.collection('workouts')
        .where('userId', '==', userId)
        .where('date', '==', tomorrow)
        .limit(1)
        .get();

    if (!nextDocs.empty) {
        const nextDoc = nextDocs.docs[0];
        const nextWorkout = nextDoc.data();
        
        if (nextWorkout.type === 'rest' || nextWorkout.type === 'easy_run') {
            // SWAP: Move Key Workout here
            await nextDoc.ref.update({
                type: workout.type,
                title: workout.title + ' (Rescheduled)',
                distance: workout.distance,
                description: `Rescheduled from yesterday due to: ${reason}. \n` + workout.description,
                hr_zone: workout.hr_zone || 'Zone 2', // Carry over HR data
                hr_target: workout.hr_target || '',
                isKeyWorkout: true
            });
            return { adjusted: true, message: "Moved skipped key workout to tomorrow." };
        }
    }

    // C. Complex Case: Tomorrow is busy too -> FULL REGENERATION
    // We need to ask AI to re-plan the rest of the week/plan from today onwards.
    console.log("⚠️ Simple shift failed. Triggering AI regeneration...");
    
    await this.regenerateScheduleFromDate(userId, workout.planId, new Date());
    
    return { 
        adjusted: true, 
        message: "Your schedule has been fully regenerated to accommodate the missed session." 
    };
}

// 2. NEW METHOD: Regenerate Schedule (The "AI Fix" Button)
async regenerateScheduleFromDate(userId, planId, startDate) {
    // 1. Fetch User Profile & Goal
    const userDoc = await this.db.collection('users').doc(userId).get();
    const userData = userDoc.data();
    
    // 2. Fetch the Plan Context
    const planDoc = await this.db.collection('trainingplans').doc(planId).get();
    const planData = planDoc.data();
    
    // 3. AI Request: "Re-plan from [Date]"
    // We use your existing AI service but with a specific adjustment prompt
    const promptContext = {
        currentPlan: planData.name || "Marathon Plan",
        missedWorkoutDate: startDate.toDateString(),
        goal: userData.currentRace || "General Fitness",
        weeksRemaining: 8 // You should calculate this dynamically
    };

    // CALL AI (using your existing adjustTrainingPlan or a new generic generator)
    // Here we reuse adjustTrainingPlan for simplicity
    const newSchedule = await this.aiService.adjustTrainingPlan(
        userId, 
        userData, 
        `User missed a key workout on ${startDate.toDateString()}. Regenerate the next 7 days to get back on track. Maintain volume if possible.`
    );

    // 4. Update Database with New Workouts
    // Assuming 'newSchedule' returns an array of workouts for the next week
    // We delete old future workouts and insert new ones
    
    const batch = this.db.batch();
    
    // A. Delete existing future workouts for this week
    const weekEnd = new Date(startDate);
    weekEnd.setDate(weekEnd.getDate() + 7);
    
    const futureDocs = await this.db.collection('workouts')
        .where('userId', '==', userId)
        .where('date', '>=', startDate)
        .where('date', '<=', weekEnd)
        .get();
        
    futureDocs.forEach(doc => batch.delete(doc.ref));

    // B. Insert New Workouts
    if (newSchedule && newSchedule.workouts) {
        newSchedule.workouts.forEach(w => {
            const ref = this.db.collection('workouts').doc();
            // Calculate actual date based on offset from startDate
            const wDate = new Date(startDate);
            wDate.setDate(wDate.getDate() + (w.dayOffset || 0)); // AI should return dayOffset (0=today, 1=tomorrow)
            
            batch.set(ref, {
                userId,
                planId,
                date: wDate,
                scheduledDate: wDate, // Keep consistent field names
                type: w.type,
                title: w.title,
                distance: w.distance,
                description: w.description,
                hr_zone: w.hr_zone,
                status: 'scheduled',
                createdAt: new Date()
            });
        });
    }

    await batch.commit();
    return true;
}


    
}




module.exports = TrainingPlanService;
