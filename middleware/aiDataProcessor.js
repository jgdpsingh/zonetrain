// ============================================
// AI DATA OPTIMIZATION MIDDLEWARE
// Phase 1: Input Compression & Standardization
// ============================================

class AIDataProcessor {
    constructor() {
        this.schemas = {
            user: this.getUserSchema(),
            workout: this.getWorkoutSchema(),
            plan: this.getPlanSchema(),
            weather: this.getWeatherSchema()
        };
        
        this.templates = this.getTemplateResponses();
        this.cache = new Map();
    }

    // PHASE 1: COMPRESSED SCHEMAS
    getUserSchema() {
        return {
            // Profile data (compressed keys)
            p: {
                a: 'age',           // age
                g: 'gender',        // gender  
                h: 'height',        // height
                w: 'weight',        // weight
                inj: 'injuries'     // injury_history
            },
            
            // Goals & targets
            goal: {
                pb: {
                    d: 'distance',   // pb_distance
                    t: 'time',       // pb_time
                    dt: 'date',      // pb_date
                    loc: 'location'  // pb_location
                },
                tgt: {
                    d: 'distance',   // target_distance
                    t: 'time',       // target_time
                    dt: 'date',      // target_date
                    loc: 'location'  // target_location
                },
                wm: 'weekly_miles'   // weekly_mileage
            },
            
            // Recovery metrics
            rec: {
                hr: 'resting_hr',    // resting_hr
                hrv: 'hrv_baseline', // baseline_hrv
                slp: 'sleep_quality', // sleep_quality
                mhr: 'max_hr',       // max_hr
                tools: 'rec_tools'   // recovery_tools
            },
            
            // Training preferences
            train: {
                days: 'run_days',    // running_days
                int: 'intensity',    // intensity_preference
                cons: 'constraints'  // constraints
            },
            
            // Location & weather
            env: {
                lat: 'latitude',
                lng: 'longitude', 
                temp: 'temp',
                hum: 'humidity',
                elev: 'elevation'
            }
        };
    }

    getWorkoutSchema() {
        return {
            // Workout essentials
            id: 'workout_id',
            dt: 'date',
            type: 'workout_type',    // easy/tempo/interval/long
            dur: 'duration_min',     // duration in minutes
            dist: 'distance_km',     // distance in km
            
            // Performance metrics
            perf: {
                pace: 'avg_pace',    // average pace
                hr: 'avg_hr',       // average heart rate
                hrz: 'hr_zones',    // time in each HR zone
                eff: 'efficiency',   // running efficiency score
                rpe: 'rpe'          // rate of perceived exertion
            },
            
            // Feedback
            feed: {
                feel: 'feeling',     // how did it feel (1-10)
                fatigue: 'fatigue',  // fatigue level (1-10)
                pain: 'pain_areas',  // any pain/discomfort
                notes: 'notes'       // additional notes
            },
            
            // Environmental
            env: {
                temp: 'temperature',
                hum: 'humidity',
                wind: 'wind_speed',
                aqi: 'air_quality'
            }
        };
    }

    getPlanSchema() {
        return {
            // Plan metadata
            id: 'plan_id',
            week: 'week_number',
            phase: 'training_phase',  // base/build/peak/taper
            
            // Weekly structure
            wks: {
                vol: 'volume_km',      // total weekly volume
                int: 'intensity_pct',   // percentage high intensity
                load: 'training_load',  // calculated training load
                stress: 'stress_score'  // training stress score
            },
            
            // Daily workouts
            days: [
                {
                    day: 'day_name',
                    type: 'workout_type',
                    dur: 'duration',
                    int: 'intensity',
                    desc: 'description'
                }
            ]
        };
    }

    getWeatherSchema() {
        return {
            temp: 'temperature',
            hum: 'humidity', 
            wind: 'wind_speed',
            aqi: 'air_quality',
            uv: 'uv_index',
            precip: 'precipitation'
        };
    }

    // PHASE 1: COMPRESSION METHODS
    compressUserData(userData) {
        const compressed = {
            p: {
                a: userData.age,
                g: userData.gender,
                h: userData.height,
                w: userData.weight,
                inj: this.summarizeInjuries(userData.injury_history)
            },
            goal: {
                pb: {
                    d: userData.pb_distance,
                    t: this.timeToSeconds(userData.pb_time),
                    dt: userData.pb_date,
                    loc: userData.pb_location
                },
                tgt: {
                    d: userData.target_distance,
                    t: userData.target_time ? this.timeToSeconds(userData.target_time) : null,
                    dt: userData.target_date,
                    loc: userData.target_location
                },
                wm: userData.weekly_mileage
            },
            rec: {
                hr: userData.resting_hr,
                hrv: userData.baseline_hrv,
                slp: userData.sleep_quality,
                mhr: userData.max_hr,
                tools: userData.recovery_tools
            },
            train: {
                days: userData.running_days,
                int: userData.intensity_preference,
                cons: userData.constraints
            },
            env: {
                lat: userData.latitude,
                lng: userData.longitude,
                temp: userData.usual_temp,
                hum: userData.usual_humidity,
                elev: userData.elevation
            }
        };

        return this.removeNullValues(compressed);
    }

    compressWorkoutData(workoutData) {
        return this.removeNullValues({
            id: workoutData.id,
            dt: workoutData.date,
            type: workoutData.type,
            dur: workoutData.duration,
            dist: workoutData.distance,
            perf: {
                pace: workoutData.avg_pace,
                hr: workoutData.avg_hr,
                hrz: workoutData.hr_zones,
                eff: workoutData.efficiency,
                rpe: workoutData.rpe
            },
            feed: {
                feel: workoutData.feeling,
                fatigue: workoutData.fatigue,
                pain: workoutData.pain_areas,
                notes: workoutData.notes
            },
            env: {
                temp: workoutData.temperature,
                hum: workoutData.humidity,
                wind: workoutData.wind_speed,
                aqi: workoutData.air_quality
            }
        });
    }

    // PHASE 2: OUTPUT CONSTRAINTS
    generatePrompt(requestType, userData, additionalData = {}) {
        const prompt = {
            task: requestType,
            user: this.compressUserData(userData),
            constraints: {
                maxTokens: this.getTokenLimit(requestType),
                format: 'json',
                abbreviations: true,
                concise: true
            }
        };

        // Add context based on request type
        switch(requestType) {
            case 'daily_plan':
                prompt.context = this.compressWorkoutData(additionalData.recentWorkouts || {});
                prompt.weather = additionalData.weather;
                break;
            case 'weekly_analysis':
                prompt.workouts = additionalData.weekWorkouts?.map(w => this.compressWorkoutData(w));
                break;
            case 'plan_adjustment':
                prompt.feedback = additionalData.feedback;
                break;
        }

        return prompt;
    }

    getTokenLimit(requestType) {
        const limits = {
            'daily_plan': 800,
            'workout_feedback': 400,
            'weekly_analysis': 1200,
            'plan_adjustment': 600,
            'nutrition_advice': 300,
            'recovery_tips': 250
        };
        return limits[requestType] || 500;
    }

    // PHASE 3: TEMPLATE RESPONSES
    getTemplateResponses() {
        return {
            easy_run: {
                type: 'easy',
                structure: {
                    warmup: '10min easy',
                    main: '{duration}min @ {pace}',
                    cooldown: '5min walk',
                    notes: 'Conversational pace'
                }
            },
            interval_workout: {
                type: 'interval',
                structure: {
                    warmup: '15min easy',
                    main: '{reps}x{distance} @ {pace} ({rest} rest)',
                    cooldown: '10min easy',
                    notes: 'Focus on form'
                }
            },
            tempo_run: {
                type: 'tempo',
                structure: {
                    warmup: '15min easy',
                    main: '{duration}min @ {pace}',
                    cooldown: '10min easy',
                    notes: 'Comfortably hard effort'
                }
            },
            long_run: {
                type: 'long',
                structure: {
                    warmup: '10min easy',
                    main: '{duration}min @ {pace}',
                    cooldown: '5min walk',
                    notes: 'Build endurance gradually'
                }
            }
        };
    }

    // PHASE 3: CONTEXT CACHING
    getCacheKey(requestType, userId, additionalKeys = []) {
        return `${requestType}_${userId}_${additionalKeys.join('_')}`;
    }

    setCacheData(key, data, ttlMinutes = 60) {
        const expiry = Date.now() + (ttlMinutes * 60 * 1000);
        this.cache.set(key, { data, expiry });
    }

    getCacheData(key) {
        const cached = this.cache.get(key);
        if (!cached) return null;
        
        if (Date.now() > cached.expiry) {
            this.cache.delete(key);
            return null;
        }
        
        return cached.data;
    }

    // UTILITY METHODS
    timeToSeconds(timeString) {
        if (!timeString) return null;
        const parts = timeString.split(':');
        return parseInt(parts[0]) * 3600 + parseInt(parts[1]) * 60 + parseInt(parts[2] || 0);
    }

    summarizeInjuries(injuryText) {
        if (!injuryText || injuryText.toLowerCase().includes('none')) return null;
        return injuryText.substring(0, 100); // Truncate long descriptions
    }

    removeNullValues(obj) {
        const cleaned = {};
        for (const [key, value] of Object.entries(obj)) {
            if (value !== null && value !== undefined && value !== '') {
                if (typeof value === 'object' && !Array.isArray(value)) {
                    const cleanedNested = this.removeNullValues(value);
                    if (Object.keys(cleanedNested).length > 0) {
                        cleaned[key] = cleanedNested;
                    }
                } else {
                    cleaned[key] = value;
                }
            }
        }
        return cleaned;
    }

    // BATCH PROCESSING QUEUE
    batchQueue = [];
    
    addToBatchQueue(requestType, userData, additionalData, priority = 'normal') {
        this.batchQueue.push({
            id: Date.now(),
            type: requestType,
            user: userData,
            data: additionalData,
            priority,
            timestamp: Date.now()
        });
        
        // Process batch if queue is full or has high priority items
        if (this.batchQueue.length >= 5 || priority === 'high') {
            this.processBatchQueue();
        }
    }

    processBatchQueue() {
        if (this.batchQueue.length === 0) return;
        
        console.log(`🔄 Processing batch of ${this.batchQueue.length} AI requests`);
        
        // Group by request type for efficiency
        const grouped = this.batchQueue.reduce((acc, request) => {
            if (!acc[request.type]) acc[request.type] = [];
            acc[request.type].push(request);
            return acc;
        }, {});
        
        // Process each group
        Object.entries(grouped).forEach(([type, requests]) => {
            this.processBatchGroup(type, requests);
        });
        
        this.batchQueue = [];
    }

    processBatchGroup(type, requests) {
        console.log(`📦 Processing ${requests.length} ${type} requests`);
        // Implementation would call AI service with batched data
        // This reduces API calls by ~50%
    }
}

module.exports = { AIDataProcessor };
