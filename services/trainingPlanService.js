// services/trainingPlanService.js - UPDATED VERSION
class TrainingPlanService {
    constructor(db, aiService) {
        this.db = db;
        this.aiService = aiService; // Your existing AIService
    }

    // Get current training plan
    // services/trainingPlanService.js

    // Get current training plan
    async getCurrentPlan(userId) {
        try {
            // 1. Fetch the active plan using CORRECT collection and field names
            const snapshot = await this.db.collection('trainingplans')
                .where('userId', '==', userId)
                .where('isActive', '==', true)
                .orderBy('createdAt', 'desc')
                .limit(1)
                .get();

            if (snapshot.empty) {
                return null;
            }

            const planDoc = snapshot.docs[0];
            const plan = {
                id: planDoc.id,
                ...planDoc.data()
            };

            // 2. Define Week Range
            const today = new Date();
            today.setHours(0, 0, 0, 0); // Normalize today to midnight
            
            const weekStart = new Date(today);
            weekStart.setDate(today.getDate() - today.getDay()); // Last Sunday
            weekStart.setHours(0, 0, 0, 0);

            const weekEnd = new Date(weekStart);
            weekEnd.setDate(weekStart.getDate() + 7); // Next Sunday

            // 3. Try fetching from 'workouts' collection first (The "Correct" Way)
            const workoutsSnapshot = await this.db.collection('workouts')
                .where('userId', '==', userId)
                .where('planId', '==', plan.id)
                .where('scheduledDate', '>=', weekStart)
                .where('scheduledDate', '<', weekEnd)
                .orderBy('scheduledDate', 'asc')
                .get();

            if (!workoutsSnapshot.empty) {
                // ✅ Success: Found individual workout documents
                plan.thisWeekWorkouts = workoutsSnapshot.docs.map(doc => ({
                    id: doc.id,
                    ...doc.data(),
                    scheduledDate: doc.data().scheduledDate?.toDate()
                }));
            } else {
                // ⚠️ FALLBACK: Workouts not in collection? Extract from plan.planData JSON
                console.log("⚠️ Workouts collection empty. extracting from planData JSON...");

                if (plan.planData && plan.planData.weeks) {
                    // Calculate current week index (0-based)
                    const planStart = plan.createdAt.toDate ? plan.createdAt.toDate() : new Date(plan.createdAt);
                    
                    // Calculate difference in weeks
                    const diffTime = Math.abs(today - planStart);
                    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)); 
                    const currentWeekIndex = Math.floor(diffDays / 7); 

                    // Get the specific week object from the array
                    const currentWeekData = plan.planData.weeks[currentWeekIndex];

                    if (currentWeekData && Array.isArray(currentWeekData.days)) {
                        plan.thisWeekWorkouts = currentWeekData.days.map((day, dayIndex) => {
                            // Reconstruct the date for this specific day
                            const workoutDate = new Date(weekStart);
                            workoutDate.setDate(workoutDate.getDate() + dayIndex); 
                            
                            return {
                                id: `json-week-${currentWeekIndex}-day-${dayIndex}`,
                                dayName: day.dayName,
                                type: day.type || 'rest',
                                name: day.type || 'Workout',
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
                } else {
                     plan.thisWeekWorkouts = [];
                }
            }

            return plan;
        } catch (error) {
            console.error('Get current plan error:', error);
            throw error;
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
}

module.exports = TrainingPlanService;
