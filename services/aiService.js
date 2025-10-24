// ============================================
// AI SERVICE WITH COST OPTIMIZATION
// ============================================

const { GoogleGenerativeAI } = require('@google/generative-ai');
const { AIDataProcessor } = require('../middleware/aiDataProcessor');

class AIService {
    constructor() {
        this.genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        this.model = this.genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
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
        const systemPrompt = `
You are ZoneTrain AI, a running coach. 
CONSTRAINTS:
- Max ${compressedPrompt.constraints.maxTokens} tokens
- Use abbreviations: wkout=workout, tempo=T, easy=E, interval=I, long=L
- JSON format only
- Be concise and actionable

DATA FORMAT:
p=profile, goal=goals, rec=recovery, train=training, env=environment
a=age, g=gender, h=height, w=weight, hr=heart rate, hrv=HRV
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

    async adjustTrainingPlan(userId, userData, adjustmentReason) {
        const requestType = 'plan_adjustment';
        return this.generateResponse(requestType, userId, userData, { 
            reason: adjustmentReason 
        });
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
}

module.exports = { AIService };
