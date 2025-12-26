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

        // 1. Deactivate active plans
        const planSnapshot = await this.db.collection('trainingplans')
            .where('userId', '==', userId)
            .where('isActive', '==', true)
            .get();

        planSnapshot.forEach(doc => {
            batch.update(doc.ref, { 
                isActive: false, 
                deactivatedAt: new Date(),
                deactivationReason: 'Plan Upgrade/Reset'
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
            console.log('✅ Plan reset complete.');
        }
    }
}



module.exports = TrainingPlanService;
