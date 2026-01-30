// ============================================
// AI SERVICE WITH COST OPTIMIZATION
// ============================================

const { GoogleGenerativeAI } = require('@google/generative-ai');
const { AIDataProcessor } = require('../middleware/aiDataProcessor');

class AIService {
    constructor() {
        this.genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        this.model = this.genAI.getGenerativeModel({ model: 'gemini-2.5-flash-lite' });
        this.processor = new AIDataProcessor();
        
        // Cost tracking
        this.costTracker = {
            tokensUsed: 0,
            requestsToday: 0,
            lastReset: new Date().toDateString()
        };
    }

    // MAIN AI REQUEST METHOD WITH ALL OPTIMIZATIONS
    async generateResponse(requestType, userId, userData, additionalData = {}) {
        try {
            // Phase 3: Check cache first
            const cacheKey = this.processor.getCacheKey(requestType, userId, [
                additionalData.date || new Date().toDateString()
            ]);
            
            const cached = this.processor.getCacheData(cacheKey);
            if (cached) {
                console.log(`💾 Cache hit for ${requestType}`);
                return cached;
            }

            // Phase 1: Compress input data
            const compressedPrompt = this.processor.generatePrompt(requestType, userData, additionalData);
            
            // Phase 2: Generate with constraints
            const response = await this.callAIWithConstraints(compressedPrompt);
            
            // Phase 3: Cache result
            const cacheMinutes = this.getCacheMinutes(requestType);
            this.processor.setCacheData(cacheKey, response, cacheMinutes);
            
            // Track costs
            this.trackUsage(compressedPrompt, response);
            
            return response;
            
        } catch (error) {
            console.error(`❌ AI Service error for ${requestType}:`, error);
            return this.getFallbackResponse(requestType);
        }
    }

   async callAIWithConstraints(compressedPrompt) {
    // UPDATED SYSTEM PROMPT - Now includes HR Zone requirements
    const systemPrompt = `
You are ZoneTrain AI, an elite running coach who specializes in Heart Rate Zone training.

BRAND IDENTITY: ZoneTrain = Zone-based training. Every workout MUST include HR Zone guidance.

CONSTRAINTS:
- Max ${compressedPrompt.constraints.maxTokens} tokens
- Use abbreviations: wkout=workout, tempo=T, easy=E, interval=I, long=L
- JSON format only
- Be concise and actionable

DATA FORMAT:
p=profile, goal=goals, rec=recovery, train=training, env=environment
a=age, g=gender, h=height, w=weight, hr=heart rate, hrv=HRV

REQUIRED OUTPUT FIELDS FOR WORKOUTS:
{
  "title": "...",
  "type": "easy_run | interval | tempo | long_run | rest",
  "distance": 5,
  "duration": 45,
  "hr_zone": "Zone 2 (Aerobic Base)" | "Zone 4 (Threshold)" | etc.,
  "hr_target": "135-145 bpm" (if max HR known),
  "description": "..."
}

HR ZONE GUIDE (Use this for all workouts):
- Zone 1: Recovery (50-60% max HR) - Very Easy
- Zone 2: Aerobic Base (60-70% max HR) - Easy/Conversational
- Zone 3: Tempo (70-80% max HR) - Moderate/Steady
- Zone 4: Threshold (80-90% max HR) - Hard/Uncomfortable
- Zone 5: VO2 Max (90-100% max HR) - Max Effort/Intervals

If user max HR is unknown, assume 220 - age as default.
`;

    const userPrompt = `${systemPrompt}\n\nTASK: ${compressedPrompt.task}\nDATA: ${JSON.stringify(compressedPrompt)}`;
    
    const result = await this.model.generateContent(userPrompt);
    const response = result.response;
    
    return this.parseAIResponse(response.text());
}


    parseAIResponse(aiText) {
        try {
            // Try to extract JSON from response
            const jsonMatch = aiText.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                return JSON.parse(jsonMatch[0]);
            }
            
            // Fallback: structure the text response
            return {
                type: 'text',
                content: aiText,
                generated: true
            };
        } catch (error) {
            console.error('❌ Error parsing AI response:', error);
            return { error: 'Failed to parse AI response', raw: aiText };
        }
    }

    // SPECIFIC AI METHODS WITH TEMPLATES
    async generateDailyWorkout(userId, userData, weatherData) {
        const requestType = 'daily_plan';
        
        // Check if we can use a template (50% faster)
        if (this.canUseTemplate(userData, 'easy_run')) {
            return this.generateFromTemplate('easy_run', userData, weatherData);
        }
        
        return this.generateResponse(requestType, userId, userData, { weather: weatherData });
    }

    async analyzeWorkoutFeedback(userId, userData, workoutData, feedbackData) {
        const requestType = 'workout_feedback';
        return this.generateResponse(requestType, userId, userData, { 
            workout: workoutData, 
            feedback: feedbackData 
        });
    }

    async generateWeeklyAnalysis(userId, userData, weekWorkouts) {
        const requestType = 'weekly_analysis';
        
        // This can be batched for cost savings
        this.processor.addToBatchQueue(requestType, userData, { weekWorkouts }, 'normal');
        
        // Return immediate template response while batch processes
        return this.generateWeeklyTemplate(userData, weekWorkouts);
    }

    // In aiService.js

async adjustTrainingPlan(userId, userData, adjustmentReason) {
    // 1. Construct the exact prompt you need
    const systemPrompt = `
    You are an expert running coach.
    TASK: Regenerate a training schedule for a user who missed a workout or needs an adjustment.
    
    USER CONTEXT:
    - User Goal: ${userData.currentRace ? userData.currentRace.name : "General Fitness"}
    - Current Fitness: ${userData.fitnessLevel || "Intermediate"}
    - Reason for Adjustment: "${adjustmentReason}"
    
    OUTPUT REQUIREMENTS:
    - Provide a JSON object with a 'workouts' array.
    - Plan for the next 3-7 days to get them back on track.
    - If the user missed a key session, try to reschedule it soon.
    
    STRICT JSON FORMAT:
    {
      "reason": "Brief explanation of the changes...",
      "workouts": [
        {
          "dayOffset": 0, // 0 for today, 1 for tomorrow...
          "type": "easy_run", // or interval, long_run, rest
          "title": "Recovery Run",
          "distance": 5, // in km
          "description": "Keep HR in Zone 2.",
          "hr_zone": "Zone 2",
          "hr_target": "135-145 bpm"
        }
      ]
    }
    `;

    try {
        // 2. Call Gemini Direct (Bypassing AIDataProcessor for this complex request)
        this.trackUsage(systemPrompt, ""); // Track input cost
        
        const result = await this.model.generateContent(systemPrompt);
        const response = result.response;
        const text = response.text();
        
        this.trackUsage("", text); // Track output cost
        
        return this.parseAIResponse(text);

    } catch (error) {
        console.error("❌ Plan adjustment error:", error);
        // Fallback: Return empty plan so the app doesn't crash
        return { 
            reason: "AI unavailable, no changes made.", 
            workouts: [] 
        };
    }
}


    // TEMPLATE SYSTEM (COST SAVINGS)
    canUseTemplate(userData, templateType) {
        const templates = this.processor.getTemplateResponses();
        const template = templates[templateType];
        
        if (!template) return false;
        
        // Logic to determine if template is suitable
        switch(templateType) {
            case 'easy_run':
                return userData.intensity_preference !== 'aggressive';
            case 'interval_workout':
                return userData.training_experience > 6; // months
            default:
                return false;
        }
    }

  generateFromTemplate(templateType, userData, additionalData = {}) {
    const templates = this.processor.getTemplateResponses();
    const template = templates[templateType];
    
    if (!template) return null;
    
    // Customize template with user data
    const customized = { ...template };
    
    // Replace placeholders
    if (templateType === 'easy_run') {
        customized.structure.main = customized.structure.main
            .replace('{duration}', this.calculateEasyRunDuration(userData))
            .replace('{pace}', this.calculateEasyPace(userData));
        
        // ADD HR ZONE DATA to template
        const maxHr = userData.maxHeartRate || (220 - (userData.age || 30));
        const zone2Low = Math.round(maxHr * 0.60);
        const zone2High = Math.round(maxHr * 0.70);
        
        customized.hr_zone = "Zone 2 (Aerobic Base)";
        customized.hr_target = `${zone2Low}-${zone2High} bpm`;
    }
    
    customized.generated = 'template';
    customized.timestamp = new Date().toISOString();
    
    return customized;
}


    calculateEasyRunDuration(userData) {
        const baseMinutes = userData.goal.wm * 8; // 8 min per km of weekly mileage
        return Math.max(30, Math.min(90, baseMinutes)); // 30-90 min range
    }

    calculateEasyPace(userData) {
        if (userData.goal.pb?.t) {
            const pbPacePerKm = userData.goal.pb.t / this.getDistanceKm(userData.goal.pb.d);
            return `${Math.round(pbPacePerKm * 1.3)}s/km`; // 30% slower than PB pace
        }
        return '5:30/km'; // Default
    }

    generateWeeklyTemplate(userData, workouts) {
        const totalDistance = workouts.reduce((sum, w) => sum + (w.distance || 0), 0);
        const avgPace = this.calculateAveragePace(workouts);
        const completionRate = (workouts.length / 7) * 100;
        
        return {
            type: 'weekly_summary',
            week: {
                total_km: totalDistance,
                avg_pace: avgPace,
                completion: completionRate,
                trend: this.calculateTrend(userData, workouts),
                next_week: this.getNextWeekFocus(userData, workouts)
            },
            generated: 'template',
            cost_saved: true
        };
    }

    // COST TRACKING & LIMITS
    trackUsage(prompt, response) {
        const today = new Date().toDateString();
        if (this.costTracker.lastReset !== today) {
            this.costTracker.requestsToday = 0;
            this.costTracker.lastReset = today;
        }
        
        this.costTracker.requestsToday++;
        this.costTracker.tokensUsed += this.estimateTokens(prompt) + this.estimateTokens(response);
        
        if (this.costTracker.requestsToday > 1000) {
            console.warn('⚠️ Daily AI request limit approaching');
        }
    }

    estimateTokens(data) {
        const text = typeof data === 'string' ? data : JSON.stringify(data);
        return Math.ceil(text.length / 4); // Rough estimation
    }

    getCacheMinutes(requestType) {
        const cacheTimes = {
            'daily_plan': 360,      // 6 hours
            'workout_feedback': 1440, // 24 hours
            'weekly_analysis': 10080, // 1 week
            'plan_adjustment': 60,   // 1 hour
            'nutrition_advice': 720, // 12 hours
            'recovery_tips': 1440   // 24 hours
        };
        return cacheTimes[requestType] || 60;
    }

    getFallbackResponse(requestType) {
        const fallbacks = {
            'daily_plan': {
                type: 'easy',
                duration: '45min',
                pace: 'conversational',
                notes: 'Take it easy today',
                fallback: true
            },
            'workout_feedback': {
                message: 'Great job completing your workout!',
                next_focus: 'Focus on recovery',
                fallback: true
            },
            'weekly_analysis': {
                summary: 'Good week of training',
                trend: 'stable',
                fallback: true
            }
        };
        
        return fallbacks[requestType] || { message: 'AI temporarily unavailable', fallback: true };
    }

    // UTILITY METHODS
    getDistanceKm(distance) {
        const distances = {
            '5k': 5,
            '10k': 10,
            '15k': 15,
            'half_marathon': 21.1,
            'marathon': 42.2
        };
        return distances[distance] || 10;
    }

    calculateAveragePace(workouts) {
        const validWorkouts = workouts.filter(w => w.pace);
        if (validWorkouts.length === 0) return 'N/A';
        
        const totalPaceSeconds = validWorkouts.reduce((sum, w) => {
            return sum + this.paceToSeconds(w.pace);
        }, 0);
        
        const avgSeconds = totalPaceSeconds / validWorkouts.length;
        return this.secondsToPace(avgSeconds);
    }

    paceToSeconds(paceString) {
        const parts = paceString.split(':');
        return parseInt(parts[0]) * 60 + parseInt(parts[1]);
    }

    secondsToPace(seconds) {
        const mins = Math.floor(seconds / 60);
        const secs = Math.round(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }

    calculateTrend(userData, workouts) {
        // Simple trend calculation
        const recent = workouts.slice(-3);
        const earlier = workouts.slice(-6, -3);
        
        if (recent.length === 0) return 'insufficient_data';
        
        const recentAvg = recent.reduce((sum, w) => sum + (w.feeling || 5), 0) / recent.length;
        const earlierAvg = earlier.length > 0 ? 
            earlier.reduce((sum, w) => sum + (w.feeling || 5), 0) / earlier.length : recentAvg;
        
        if (recentAvg > earlierAvg + 0.5) return 'improving';
        if (recentAvg < earlierAvg - 0.5) return 'declining';
        return 'stable';
    }

    getNextWeekFocus(userData, workouts) {
        const totalKm = workouts.reduce((sum, w) => sum + (w.distance || 0), 0);
        const targetKm = userData.goal?.wm || 30;
        
        if (totalKm < targetKm * 0.8) return 'increase_volume';
        if (totalKm > targetKm * 1.2) return 'recovery_focus';
        return 'maintain_consistency';
    }

    async generateWorkoutAnalysis(userProfile, workoutDoc, stravaActivity) {
        const requestType = 'workout_analysis';

        // 1. Calculate Context Variables
        const raceName = userProfile.currentRace?.name || "Target Race";
        const raceDate = userProfile.currentRace?.date ? new Date(userProfile.currentRace.date) : null;
        let timeToRace = "Unknown date";
        
        if (raceDate) {
            const diffTime = raceDate - new Date();
            const diffWeeks = Math.ceil(diffTime / (1000 * 60 * 60 * 24 * 7));
            timeToRace = `${diffWeeks} weeks away`;
        }

        const planPhase = workoutDoc.phase || "General Training";
        const plannedType = workoutDoc.type || "Run";
        const plannedDistance = workoutDoc.distance ? `${workoutDoc.distance}km` : "N/A";
        const plannedPace = workoutDoc.targetPace ? `${workoutDoc.targetPace}/km` : "N/A";
        const plannedZone = workoutDoc.hr_zone || "N/A"; // ADD THIS
const plannedHrTarget = workoutDoc.hr_target || "N/A"; 
        
        // Actuals
        const actualDistance = (stravaActivity.distance / 1000).toFixed(2) + "km";
        const movingTimeMinutes = Math.floor(stravaActivity.moving_time / 60);
        const actualPaceSeconds = stravaActivity.distance > 0 ? (stravaActivity.moving_time / (stravaActivity.distance / 1000)) : 0;
        const actualPace = this.secondsToPace(actualPaceSeconds);
        const avgHr = stravaActivity.average_heartrate ? `${Math.round(stravaActivity.average_heartrate)} bpm` : "N/A";

        // 2. Build Prompt (Optimized for Gemini)
        const systemPrompt = `
        ACT AS: Elite Running Coach.
        TASK: Compare PLANNED vs ACTUAL workout. 
        CONTEXT: User training for ${raceName} (${timeToRace}). Phase: ${planPhase}.
        
        PLANNED: ${plannedType}, ${plannedDistance} @ ${plannedPace}. Target HR Zone: ${plannedZone} (${plannedHrTarget}).
ACTUAL: ${actualDistance} in ${movingTimeMinutes}min @ ${actualPace}. HR: ${avgHr}.

        
        OUTPUT JSON ONLY:
        {
            "match_score": 1-10 (how well did they execute?),
            "feedback": "2 sentences max. Be specific about pace/HR adherence.",
            "tip": "1 actionable tip for next time."
        }
        `;

        try {
            // Track cost before call
            this.trackUsage(systemPrompt, "");

            // Call Gemini
            const result = await this.model.generateContent(systemPrompt);
            const response = result.response;
            const text = response.text();
            
            // Track response cost
            this.trackUsage("", text);

            return this.parseAIResponse(text);

        } catch (error) {
            console.error("❌ Error generating workout analysis:", error);
            // Return fallback structure
            return {
                match_score: 5,
                feedback: "Good effort logging your run! Compare your actual pace to the target manually this time.",
                tip: "Consistency is key.",
                fallback: true
            };
        }
    }

// services/aiService.js

  async generateAdaptiveWeek(userProfile, weekStats, nextWeekTemplate) {
    const prompt = `
      ACT AS: Elite Running Coach.
      TASK: Adapt Week ${weekStats.weekNumber + 1} of a training plan based on Week ${weekStats.weekNumber} performance.

      ATHLETE PROFILE:
      - Name: ${userProfile.name}
      - Goal: ${userProfile.raceGoal || 'General Fitness'}
      - Status: ${weekStats.feeling || 'Good'}

      PERFORMANCE REPORT (WEEK ${weekStats.weekNumber}):
      - Planned Distance: ${weekStats.plannedDistance} km
      - Actual Distance: ${weekStats.actualDistance} km
      - Completion Rate: ${weekStats.completionRate}%
      - Key Insight: ${weekStats.insight || 'Training volume met.'}

      ORIGINAL PLAN FOR NEXT WEEK (WEEK ${weekStats.weekNumber + 1}):
      ${JSON.stringify(nextWeekTemplate)}

      INSTRUCTIONS:
      1. Analyze the performance. If the user missed workouts or struggled, reduce volume/intensity for next week. If they excelled easily, maintain or slightly optimize.
      2. Generate a valid JSON object for the NEW Week ${weekStats.weekNumber + 1}.
      3. Keep the same structure: { "weekNumber": ${weekStats.weekNumber + 1}, "focus": "...", "days": [...] }
      4. Ensure "days" array has exactly 7 days.

      RESPONSE FORMAT: JSON ONLY. No markdown.
    `;

    try {
      const result = await this.model.generateContent(prompt);
      const responseText = result.response.text();
      // Clean markdown if present
      const cleaned = responseText.replace(/```json|```/g, '').trim();
      return JSON.parse(cleaned);
    } catch (error) {
      console.error("AI Adaptive Gen Error:", error);
      // Fallback: return the original template if AI fails
      return nextWeekTemplate;
    }
  }

  async generateRaceWeekNutritionPlan({ profile, workouts = [], targets }) {
    const systemPrompt = `
You are ZoneTrain AI, acting as a sports nutrition coach for endurance runners.

TASK:
Generate a 7-day "last week to race day" nutrition plan (Day -6 to Day 0).
You MUST respect the provided macro/hydration targets (do not change numbers).
You MUST respect dietary constraints and injuries/health notes.
Keep it practical with Indian-friendly options if location is India, but do not assume spicy foods.

OUTPUT:
Return JSON ONLY (no markdown). Schema:
{
  "type": "race_week_nutrition",
  "raceDate": "YYYY-MM-DD",
  "raceDistanceKm": number,
  "notes": [string],
  "days": [
    {
      "dayOffsetFromRace": -6..0,
      "date": "YYYY-MM-DD",
      "focus": "string",
      "targets": { "carbs_g": number, "protein_g": number, "fat_g": number, "fluids_ml": number, "sodium_mg": number },
      "meals": [
        { "slot": "Breakfast|Lunch|Snack|Dinner|Pre-run|Post-run", "items": [string], "why": "string" }
      ],
      "trainingFueling": [string],
      "avoid": [string]
    }
  ],
  "raceDay": {
    "preRace": [string],
    "during": [string],
    "postRace": [string]
  }
}

Rules:
- Keep meal item lists short and realistic. Both veg and non-veg options.
- Prefer low-fiber/low-fat choices on Day -1 and Day 0.
- If workouts list shows a run that day, include "Pre-run" + "Post-run" slot.
`.trim();

    const athlete = {
      age: profile?.personalProfile?.age ?? null,
      gender: profile?.personalProfile?.gender ?? "other",
      heightCm: profile?.personalProfile?.height ?? null,
      weightKg: profile?.personalProfile?.weight ?? null,
      injuries: profile?.personalProfile?.injuries ?? "",
      constraints: profile?.trainingStructure?.constraints ?? "",
      intensityPreference: profile?.trainingStructure?.intensityPreference ?? "balanced",
      race: profile?.raceHistory?.targetRace ?? {}
    };

    const payload = {
      athlete,
      workouts: workouts.map(w => ({
        date: w.date,
        type: w.type,
        title: w.title,
        distanceKm: w.distanceKm,
        durationMin: w.durationMin
      })),
      targets
    };

    try {
      this.trackUsage(systemPrompt, ""); // optional cost tracking [file:33] style
      const result = await this.model.generateContent(systemPrompt + "\n\nINPUT:\n" + JSON.stringify(payload));
      const text = result.response.text();
      return this.parseAIResponse(text); // already exists and extracts JSON [file:33]
    } catch (e) {
      return { error: "AI nutrition generation failed", fallback: true, details: e.message };
    }
  }

  async generateContentDirect(promptText) {
    try {
        const result = await this.model.generateContent(promptText);
        const response = result.response;
        return this.parseAIResponse(response.text());
    } catch (error) {
        console.error("AI Direct Generation Error:", error);
        return null;
    }
}


}

module.exports = { AIService };
