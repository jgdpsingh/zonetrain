// dashboard-race-widgets.js

class RaceDashboardWidgets {
    constructor() {
        this.token = localStorage.getItem('userToken');
        this.userLocation = JSON.parse(localStorage.getItem('userLocation') || '{}');
        this.currentWeekOffset = 0;
    }


    init() {
        console.log('🏎️ Initializing RACE Dashboard Widgets...');
        
        // Check for Login Notifications (moved from HTML)
        this.checkLoginNotifications();
        this.updateDashboardStats(); 

        this.renderWeatherWidget('weather-widget-container');
  this.renderTodayWorkoutWidget('today-workout-container');
  this.renderReadinessChart('readiness-chart-container');
  this.renderProgressChart('progress-chart-container');
  this.renderPersonalRecords('personal-records-container');

  this.renderHRVWidget('hrv-widget-container');

        // Render Widgets
        this.renderRaceCountdown('race-countdown-widget'); 
        this.renderWeeklyPlanWidget('weekly-plan-container');
        this.renderPerformanceChart('performance-chart-container');
        this.renderRacePlanningWidget('race-planning-container');
        this.renderAIInsightWidget('ai-insight-widget-container');
        this.renderPerformanceAnalyticsWidget('performance-analytics-container');
        
        // Subscription & Downgrade Logic
        this.loadSubscriptionDetails();
        this.setupDowngradeListeners();
        this.setupPauseResumeListeners(); // Added this since you had pause logic
    }

    isPlanGenerating() {
  const flag = sessionStorage.getItem('isGeneratingPlan') === 'true';
  const startedAt = parseInt(sessionStorage.getItem('planGenerationStartedAt') || '0', 10);
  const within2Min = startedAt && (Date.now() - startedAt) < 2 * 60 * 1000;
  return flag || within2Min;
}

clearPlanGenerating() {
  sessionStorage.removeItem('isGeneratingPlan');
  sessionStorage.removeItem('planGenerationStartedAt');
}


    static WEATHER_CACHE_KEY = 'zonetrain_weather_cache_v1';
  static WEATHER_MAX_AGE_MS = 2 * 60 * 60 * 1000; // 30 minutes

    // Weather Widget
    async renderWeatherWidget(containerId) {
        const container = document.getElementById(containerId);
        if (!container) return;

        try {
            const { latitude, longitude } = this.userLocation;
            
            if (!latitude || !longitude) {
                container.innerHTML = this.getLocationPrompt();
                return;
            }

            const lat = Number(latitude).toFixed(3);
      const lon = Number(longitude).toFixed(3);

      // 1) Try cache first
      const cacheRaw = localStorage.getItem(DashboardWidgets.WEATHER_CACHE_KEY);
      const now = Date.now();

      if (cacheRaw) {
        try {
          const cache = JSON.parse(cacheRaw);
          const sameLocation = cache.lat === lat && cache.lon === lon;
          const fresh = now - cache.ts < DashboardWidgets.WEATHER_MAX_AGE_MS;

          if (sameLocation && fresh && cache.weather) {
            container.innerHTML = this.weatherTemplate(cache.weather, cache.mock);
            return; // No network call
          }
        } catch (e) {
          console.warn('Weather cache parse error, ignoring', e);
        }
      }

            const response = await fetch(`/api/weather?lat=${latitude}&lon=${longitude}`, {
                headers: { 'Authorization': `Bearer ${this.token}` }
            });

            const data = await response.json();
            if (data.success) {
                localStorage.setItem(
          DashboardWidgets.WEATHER_CACHE_KEY,
          JSON.stringify({
            ts: now,
            lat,
            lon,
            weather: data.weather,
            mock: data.mock
          })
        );

                container.innerHTML = this.weatherTemplate(data.weather, data.mock);
            }
        } catch (error) {
            console.error('Weather widget error:', error);
            container.innerHTML = this.weatherErrorTemplate();
        }
    }

    weatherTemplate(weather, isMock) {
    // Extended icon map for Google Weather API conditions
    const weatherIcons = {
        'clear': '☀️',
        'sunny': '☀️',
        'partly_cloudy': '⛅',
        'partly-cloudy': '⛅',
        'cloudy': '☁️',
        'overcast': '☁️',
        'rainy': '🌧️',
        'rain': '🌧️',
        'snowy': '❄️',
        'snow': '❄️',
        'stormy': '⛈️',
        'thunderstorm': '⛈️',
        'foggy': '🌫️',
        'fog': '🌫️',
        'windy': '💨'
    };
    
    // Try to match by icon first, then by condition text
    const icon = weatherIcons[weather.icon] || 
                 weatherIcons[weather.condition?.toLowerCase()] || 
                 '🌤️';
    
    return `
        <div class="widget weather-widget">
            <div class="widget-header">
                <h3>☁️ Weather</h3>
                ${isMock ? '<span class="mock-badge">Demo</span>' : ''}
            </div>
            <div class="weather-content">
                <div class="weather-main">
                    <div class="weather-icon" style="font-size: 64px;">${icon}</div>
                    <div>
                        <div class="weather-temp" style="font-size: 48px; font-weight: 700; color: #1f2937;">
                            ${weather.temperature}°C
                        </div>
                        <div class="weather-condition" style="font-size: 16px; color: #6b7280; text-transform: capitalize; margin-top: 4px;">
                            ${weather.condition}
                        </div>
                        ${weather.feelsLike ? `<div style="font-size: 13px; color: #9ca3af; margin-top: 4px;">Feels like ${weather.feelsLike}°C</div>` : ''}
                    </div>
                </div>
                <div class="weather-details" style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 15px; margin-top: 20px;">
                    <div class="weather-item">
                        <span class="label">💧 Humidity</span>
                        <span class="value">${weather.humidity}%</span>
                    </div>
                    <div class="weather-item">
                        <span class="label">💨 Wind</span>
                        <span class="value">${weather.windSpeed} km/h</span>
                    </div>
                    ${weather.uvIndex !== undefined ? `
                    <div class="weather-item">
                        <span class="label">☀️ UV Index</span>
                        <span class="value">${weather.uvIndex}</span>
                    </div>
                    ` : ''}
                </div>
                <div class="weather-advice" style="margin-top: 15px; padding: 12px; background: #f3f4f6; border-radius: 8px; font-size: 14px; color: #4b5563;">
                    ${this.getWeatherAdvice(weather)}
                </div>
            </div>
        </div>
    `;
}


renderHRVWidget(containerId) {
        const container = document.getElementById(containerId);
        if (!container) return;

        container.innerHTML = `
            <div class="widget hrv-widget">
                <div class="widget-header" style="margin-bottom: 15px; border-bottom: none; padding-bottom: 0;">
                    <h3>❤️ Log HRV</h3>
                </div>
                <div style="display: flex; gap: 10px; align-items: center;">
                    <input 
                        type="number" 
                        id="hrv-input" 
                        min="1" 
                        max="300" 
                        placeholder="e.g. 55" 
                        style="flex: 1; padding: 10px; border-radius: 8px; border: 1px solid #d1d5db; font-size: 16px; width: 100%;"
                    />
                    <button 
                        onclick="window.dashboardWidgets.logHRV()" 
                        style="padding: 10px 16px; border-radius: 8px; border: none; background: #10b981; color: white; font-weight: 600; cursor: pointer; transition: background 0.2s;">
                        Save
                    </button>
                </div>
                <div id="hrv-status" style="margin-top: 8px; font-size: 13px; color: #6b7280; min-height: 20px;">
                    Enter your morning HRV score.
                </div>
            </div>
        `;
    }

    // --- NEW METHOD: POPULATE TOP STATS ---
    async updateDashboardStats() {
        console.log("📊 Updating Top Dashboard Stats...");
        
        try {
            // 1. Fetch last 7 days of data
            const response = await fetch('/api/analytics/workout-history?days=7', {
                headers: { 'Authorization': `Bearer ${this.token}` }
            });
            const data = await response.json();
            
            if (data.success && data.stats) {
                // UPDATE WEEKLY VOLUME
                const volEl = document.getElementById('weekly-volume');
                if (volEl) {
                    // Round to 1 decimal (e.g., "32.5 km")
                    volEl.textContent = `${data.stats.totalDistance.toFixed(1)} km`;
                }

                // UPDATE TRAINING LOAD (Estimate)
                // If backend doesn't provide explicit 'load', we calculate a simple TRIMP score
                // Load = Duration (mins) * RPE (1-10)
                const loadEl = document.getElementById('training-load');
                if (loadEl) {
                    let totalLoad = 0;
                    if (data.workouts && Array.isArray(data.workouts)) {
                        data.workouts.forEach(w => {
                            const mins = (w.movingTime ?? w.actualDuration ?? w.duration ?? 0);
totalLoad += (mins * rpe);
                            // Estimate RPE based on intensity label
                            let rpe = 3; // Default easy
                            const i = (w.intensity || '').toLowerCase();
                            if (i === 'moderate' || i === 'tempo') rpe = 5;
                            if (i === 'hard' || i === 'threshold') rpe = 7;
                            if (i === 'interval' || i === 'vo2max') rpe = 9;
                            
                            
                        });
                    }
                    loadEl.textContent = Math.round(totalLoad).toString();
                }
            }
        } catch (e) {
            console.error("Failed to update volume/load stats:", e);
        }

        // 2. AVG HRV (Fallback to local storage if API doesn't return history)
        const hrvEl = document.getElementById('avg-hrv');
        if (hrvEl) {
            const todayHRV = localStorage.getItem('todayHRV');
            // If you have a real backend endpoint for HRV history, fetch it here.
            // For now, we show the latest logged value or '--'
            hrvEl.textContent = todayHRV ? todayHRV : '--';
        }
    }


 getLocationPrompt() {
        return `
            <div class="widget weather-widget">
                <div class="widget-header">
                    <h3>🌤️ Weather</h3>
                </div>
                <div class="location-prompt">
                    <p>📍 Enable location to see weather updates</p>
                    <button onclick="window.dashboardWidgets.requestLocation()" class="btn-enable-location">
                        Enable Location
                    </button>
                </div>
            </div>
        `;
    }

    getWeatherAdvice(weather) {
        if (weather.temperature > 30) {
            return '🔥 Hot day! Hydrate well and consider early morning or evening runs.';
        } else if (weather.temperature < 10) {
            return '❄️ Cold weather. Warm up properly and dress in layers.';
        } else if (weather.condition.includes('rain')) {
            return '🌧️ Rainy conditions. Be cautious of slippery surfaces.';
        } else {
            return '✅ Perfect weather for running!';
        }
    }

    // Event Handlers
    async requestLocation() {
        if (!navigator.geolocation) {
            alert('Geolocation not supported by your browser');
            return;
        }

        navigator.geolocation.getCurrentPosition(
            (position) => {
                const location = {
                    latitude: position.coords.latitude,
                    longitude: position.coords.longitude
                };
                localStorage.setItem('userLocation', JSON.stringify(location));
                this.userLocation = location;
                this.renderWeatherWidget('weather-widget-container');
            },
            (error) => {
                alert('Unable to get location: ' + error.message);
            }
        );
    }

    async renderTodayWorkoutWidget(containerId) {
        const container = document.getElementById(containerId);
        if (!container) return;

        try {
            const hrv = localStorage.getItem('todayHRV') || '';
            console.log(`🔄 Fetching workout with HRV: ${hrv}`); // Debug Log

            const response = await fetch(`/api/training/today-workout?hrv=${hrv}&t=${Date.now()}`, {
            headers: { 'Authorization': `Bearer ${this.token}` }
        });

            const data = await response.json();
            console.log("✅ Workout Data Received:", data); // Debug Log
            if (data.success) {
            // Log if AI adjusted it
            if (data.adjustedFromPlanned) {
                console.log("⚠️ AI HAS ADJUSTED THIS WORKOUT");
            }
            container.innerHTML = this.todayWorkoutTemplate(data);
            this.attachWorkoutListeners();
        }
    } catch (error) {
        console.error('Today workout error:', error);
        container.innerHTML = `<div style="padding:20px; text-align:center; color:red;">Error loading workout</div>`;
    }
    }

    todayWorkoutTemplate(data) {
    // 1. ROBUST DATA PARSING
    // Handle both { workout: {...} } (API wrapper) and {...} (direct workout object)
    let workoutDetails = null;

    if (data) {
        if (data.workout && typeof data.workout === 'object') {
            workoutDetails = data.workout; // Standard case: Nested inside data
        } else if (data.title || data.intensity) {
            workoutDetails = data;         // Edge case: Direct workout object
        }
    }

    // Check for completion status
    if (workoutDetails && workoutDetails.completed) {
        return `
            <div class="widget today-workout-widget completed-state" style="text-align: center; padding: 40px 20px; background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: white; border-radius: 12px;">
                <div style="font-size: 50px; margin-bottom: 10px;">🎉</div>
                <h3 style="margin: 0; font-size: 24px;">Great Job!</h3>
                <p style="margin: 5px 0 20px 0; opacity: 0.9;">You crushed today's workout.</p>
                <div style="background: rgba(255,255,255,0.2); padding: 10px; border-radius: 8px; display: inline-block;">
                    <strong>${workoutDetails.title || 'Workout'}</strong> completed
                </div>
            </div>
        `;
    }

    // 2. CHECK FOR REST / EMPTY
    const isRest = !workoutDetails || 
                   workoutDetails.title === 'rest' || 
                   workoutDetails.intensity === 'rest' || 
                   data.isRestDay;

    if (isRest) {
        return `
            <div class="empty-state" style="text-align:center; padding:30px; background:#f8f9fa; border-radius:12px;">
                <div class="empty-icon" style="font-size:40px; margin-bottom:10px;">🛌</div>
                <h3 style="margin:0; color:#555;">Rest Day</h3>
                <p style="color:#777; margin:5px 0 0 0;">No workout scheduled for today.</p>
            </div>
        `;
    }

    // 3. DEFINE HRV COLORS & STATUS
    const hrvColors = {
        low: '#ef4444',     // Red
        normal: '#10b981',  // Green
        high: '#3b82f6',    // Blue
        push: '#3b82f6',    // Blue alias
        balanced: '#10b981' // Green alias
    };

    const statusKey = data.hrvStatus ? data.hrvStatus.toLowerCase() : 'normal';
    const hrvColor = hrvColors[statusKey] || hrvColors.normal;

    // 4. SAFE VARIABLE ACCESS
    const title = workoutDetails.title || workoutDetails.name || 'Workout';
    const duration = workoutDetails.duration || 0;
    const intensity = workoutDetails.intensity || 'Normal';
    const description = workoutDetails.description || '';
    const distance = workoutDetails.distance || '';
    const hrvValue = data.hrvValue || '--';

    // --- OPTION A LOGIC: Soften message for High HRV ---
    let recommendation = data.recommendation || 'Good to go!';
    
    if (statusKey === 'high' || statusKey === 'push') {
        recommendation = "High HRV: You may feel fresher today. Stick to the planned session; if everything feels great, optionally add 4–6 relaxed strides (15–20s) with full recovery.";
    }
    // ---------------------------------------------------

    // 5. RENDER WIDGET
    return `
        <div class="widget today-workout-widget">
            <div class="widget-header" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px;">
                <h3 style="margin:0;">🏃 Today's Workout</h3>
                <div class="hrv-indicator" style="background: ${hrvColor}20; color: ${hrvColor}; border: 1px solid ${hrvColor}; padding:4px 8px; border-radius:12px; font-size:12px; font-weight:600;">
                    HRV: ${hrvValue}
                </div>
            </div>
            
            <div class="workout-content" style="background:white; border:1px solid #eee; border-radius:12px; padding:20px;">
                <div class="workout-title" style="font-size:18px; font-weight:bold; color:#333; margin-bottom:10px;">
                    ${title}
                </div>
                
                <div class="workout-meta" style="display:flex; gap:15px; font-size:14px; color:#555; margin-bottom:15px;">
                    <span class="duration">⏱️ ${duration} min</span>
                    <span class="intensity">💪 ${intensity}</span>
                    ${distance ? `<span class="distance">📏 ${distance}</span>` : ''}
                </div>

                <div class="workout-description" style="font-size:14px; color:#666; line-height:1.5; margin-bottom:15px;">
                    ${description}
                </div>
                
                ${workoutDetails.zones && workoutDetails.zones.length > 0 ? `
                    <div class="workout-zones" style="font-size:13px; background:#f0f7ff; color:#0056b3; padding:8px; border-radius:6px; margin-bottom:15px;">
                        <strong>Target Zones:</strong> ${workoutDetails.zones.join(', ')}
                    </div>
                ` : ''}

                <div class="hrv-recommendation" style="background: ${hrvColor}10; border-left: 4px solid ${hrvColor}; padding:10px; font-size:13px; color:#444; margin-bottom:20px; border-radius:4px;">
                    ${recommendation}
                </div>

                <div style="display:flex; gap:10px;">
                    <button class="btn-start-workout" onclick="window.dashboardWidgets.startWorkout()" style="flex:1; background:#007bff; color:white; border:none; padding:10px; border-radius:6px; font-weight:600; cursor:pointer;">
                        Start Workout
                    </button>

                    <button class="btn-complete" onclick="window.dashboardWidgets.markComplete('${workoutDetails.id || ''}')" 
                        style="background:white; border:1px solid #28a745; color:#28a745; margin-left:10px;">
                        ✅ Mark Done
                    </button>
                    <button class="btn-log-hrv" onclick="window.dashboardWidgets.logHRV()" style="padding:10px; background:white; border:1px solid #ddd; border-radius:6px; cursor:pointer;">
                        Update HRV
                    </button>
                </div>
            </div>
        </div>
    `;
}


async markComplete(workoutId) {
  if (!confirm('Mark this workout as completed?')) return;

  try {
    const res = await fetch(`/api/workouts/${workoutId}/complete`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${this.token}` }
    });

    const data = await res.json();
    if (!data.success) throw new Error(data.error || data.message || 'Failed to complete workout');

    // Refresh widgets
    await this.renderTodayWorkoutWidget('today-workout-container');
    await this.renderWeeklyPlanWidget('weekly-plan-container');
    alert('Great job! Workout marked as complete.');
  } catch (e) {
    alert('Failed to update workout: ' + e.message);
  }
}


async logHRV() {
    // 1. Try to find the value in the dedicated input box
    const input = document.getElementById('hrv-input');
    const statusEl = document.getElementById('hrv-status'); // Optional status text
    
    let hrvValue = input ? input.value.trim() : null;

    // 2. Fallback: If input is empty, ask user via prompt
    if (!hrvValue) {
        hrvValue = prompt("Enter your HRV reading for today:");
    }

    // 3. Validation
    const numericValue = parseFloat(hrvValue);
    if (!numericValue || isNaN(numericValue) || numericValue <= 0) {
        alert('Please enter a valid HRV number.');
        return;
    }

    // 4. Update UI to show "Saving..."
    if (statusEl) {
        statusEl.textContent = 'Saving...';
        statusEl.style.color = '#6b7280';
    }

    try {
        // 5. API Call
        const res = await fetch('/api/hrv/log', { // Ensure this route matches your backend (/api/hrv or /api/hrv/log)
            method: 'POST',
            headers: {
                'Authorization': 'Bearer ' + this.token,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ value: numericValue, source: 'manual-dashboard' })
        });

        const data = await res.json();
        if (!data.success) throw new Error(data.message);

        // 6. Success Handling
        localStorage.setItem('todayHRV', String(numericValue));
        
        if (statusEl) {
            statusEl.textContent = `HRV logged: ${numericValue}`;
            statusEl.style.color = '#16a34a';
        }

        if (input) input.value = ''; // Clear input

        // 7. CRITICAL: Re-render the widget to apply AI adjustment
        await this.renderTodayWorkoutWidget('today-workout-container'); // Check this ID matches your HTML

        alert(`HRV updated to ${numericValue}. Workout adjusted!`);

    } catch (err) {
        console.error('HRV log error:', err);
        if (statusEl) {
            statusEl.textContent = 'Failed to save.';
            statusEl.style.color = '#dc2626';
        }
        alert('Failed to save HRV. Check console.');
    }
}


async renderStravaWorkoutHistory(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    // 1. Initial Loading State (Header + Button + Loading Text)
    container.innerHTML = `
        <div class="widget workout-history-widget">
            <div class="widget-header" style="display:flex; justify-content:space-between; align-items:center;">
                <h3>📜 Workout History</h3>
                <div style="display:flex; gap:8px;">
                    <button onclick="window.dashboardWidgets.triggerManualAnalysis()" 
                        id="btn-analyze-missed"
                        style="font-size:11px; padding:6px 12px; background:#eff6ff; color:#1d4ed8; border:1px solid #bfdbfe; border-radius:6px; cursor:pointer; font-weight:600; display:flex; align-items:center; gap:4px;">
                        <span>⚡ Analyze Missed</span>
                    </button>
                    </div>
            </div>
            <div id="history-list-content" style="min-height: 100px;">
                <div style="text-align:center; padding:20px; color:#6b7280;">Loading history...</div>
            </div>
        </div>
    `;

    try {
        const response = await fetch('/api/analytics/workout-history?days=30', {
            headers: { 'Authorization': `Bearer ${this.token}` }
        });

        const data = await response.json();
        
        // 2. Error / Empty State
        if (!data.success || !data.workouts || data.workouts.length === 0) {
            container.innerHTML = `
                <div class="widget empty-state-widget">
                    <div class="widget-header">
                        <h3>📜 Workout History</h3>
                    </div>
                    <div style="padding: 20px; text-align: center;">
                        <p>🏃‍♂️ No workouts found</p>
                        <p style="font-size: 14px; color: #666; margin-top: 8px;">
                            ${data.source === 'strava' ? 'Connect Strava to see your workout history' : 'Sync your Strava activities'}
                        </p>
                        <button onclick="window.location.href='/auth/strava'" class="btn-primary" style="margin-top: 15px;">
                            Connect Strava
                        </button>
                    </div>
                </div>
            `;
            return;
        }

        const { workouts, stats } = data;

        // 3. Final Render (Preserving the Button!)
        // We overwrite the container again, but this time we INCLUDE the button in the header.
        container.innerHTML = `
            <div class="widget workout-history-widget">
                <div class="widget-header" style="display:flex; justify-content:space-between; align-items:center;">
                    <h3>📊 Workout History <span style="font-size:12px; color:#6b7280; font-weight:400;">(Last 30 Days)</span></h3>
                    <div style="display:flex; gap:8px;">
                         <button onclick="window.dashboardWidgets.triggerManualAnalysis()" 
                            id="btn-analyze-missed"
                            title="Force analysis for recent runs"
                            style="font-size:11px; padding:6px 12px; background:#eff6ff; color:#1d4ed8; border:1px solid #bfdbfe; border-radius:6px; cursor:pointer; font-weight:600; display:flex; align-items:center; gap:4px;">
                            <span>⚡ Analyze</span>
                        </button>
                        <button onclick="window.dashboardWidgets.syncStrava()" class="btn-sync" title="Sync Strava" style="font-size:16px; padding:4px 8px;">
                            🔄
                        </button>
                    </div>
                </div>
                
                <div class="stats-summary" style="display:grid; grid-template-columns: repeat(4, 1fr); gap:10px; margin-bottom:15px;">
                    <div class="stat-card" style="text-align:center; padding:10px; background:#f9fafb; border-radius:8px;">
                        <div class="stat-value" style="font-weight:700; color:#1f2937;">${stats.totalWorkouts}</div>
                        <div class="stat-label" style="font-size:11px; color:#6b7280;">Runs</div>
                    </div>
                    <div class="stat-card" style="text-align:center; padding:10px; background:#f9fafb; border-radius:8px;">
                        <div class="stat-value" style="font-weight:700; color:#3b82f6;">${stats.totalDistance.toFixed(1)}</div>
                        <div class="stat-label" style="font-size:11px; color:#6b7280;">km</div>
                    </div>
                    <div class="stat-card" style="text-align:center; padding:10px; background:#f9fafb; border-radius:8px;">
                        <div class="stat-value" style="font-weight:700; color:#8b5cf6;">${Math.round(stats.totalDuration / 60)}</div>
                        <div class="stat-label" style="font-size:11px; color:#6b7280;">Hrs</div>
                    </div>
                    <div class="stat-card" style="text-align:center; padding:10px; background:#f9fafb; border-radius:8px;">
                        <div class="stat-value" style="font-weight:700; color:#10b981;">${stats.averagePace || '-'}</div>
                        <div class="stat-label" style="font-size:11px; color:#6b7280;">/km</div>
                    </div>
                </div>

                <div class="workout-list" style="display:flex; flex-direction:column; gap:10px;">
                    ${workouts.slice(0, 5).map(w => {
                        const displayName = (w.name || w.title || w.type || 'Run');
                         const hasAi = !!w.aiAnalysis;
                         return `
                         <div class="workout-name" style="font-size:14px; font-weight:600; color:#374151;">
  ${displayName}
</div>
                        <div class="workout-item" style="display:flex; align-items:center; justify-content:space-between; padding:12px; background:#fff; border:1px solid #f3f4f6; border-radius:10px;">
                            <div style="display:flex; align-items:center; gap:12px;">
                                <div style="font-size:20px;">${this.getWorkoutIcon(w.type)}</div>
                                <div class="workout-info">
                                    <div class="workout-name" style="font-size:14px; font-weight:600; color:#374151;">${w.name || w.type}</div>
                                    <div class="workout-meta" style="font-size:12px; color:#6b7280;">
                                        ${new Date(w.startDate).toLocaleDateString(undefined, {month:'short', day:'numeric'})} • 
                                        ${w.distance.toFixed(1)} km • 
                                        ${w.averagePace ? w.averagePace + '/km' : ''}
                                    </div>
                                </div>
                            </div>
                            
                            <div style="text-align:right;">
                                ${hasAi 
                                    ? `<span style="font-size:10px; background:#ecfdf5; color:#059669; padding:2px 6px; border-radius:4px;">Analyzed</span>` 
                                    : `<span style="font-size:10px; background:#fef2f2; color:#dc2626; padding:2px 6px; border-radius:4px;">Pending</span>`
                                }
                            </div>
                        </div>
                    `}).join('')}
                </div>

                <div class="widget-footer" style="margin-top:15px; text-align:center;">
                    <small style="color:#9ca3af;">Last synced: ${data.lastSync ? new Date(data.lastSync).toLocaleTimeString() : 'Just now'}</small>
                </div>
            </div>
        `;
    } catch (error) {
        console.error('Render workout history error:', error);
        container.innerHTML = `
            <div class="widget error-widget">
                <p style="color: #ef4444;">❌ Failed to load workout history</p>
                <button onclick="window.dashboardWidgets.renderStravaWorkoutHistory('${containerId}')" class="btn-secondary">
                    Retry
                </button>
            </div>
        `;
    }
}

// dashboard-race-widgets.js

    async triggerManualAnalysis() {
        const btn = document.getElementById('btn-analyze-missed');
        if(btn) {
            btn.innerHTML = `<span>⏳ Processing...</span>`;
            btn.disabled = true;
        }

        try {
            const res = await fetch('/api/workouts/analyze-missed', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${this.token}` }
            });
            const data = await res.json();

            if (data.success) {
                if (data.count > 0) {
                    alert(`✅ Success! Analyzed ${data.count} missed workouts. The dashboard will refresh.`);
                    window.location.reload(); // Reload to show new stats/insights
                } else {
                    alert("✅ All recent workouts are already analyzed.");
                }
            } else {
                alert("❌ Error: " + data.message);
            }
        } catch (e) {
            console.error(e);
            alert("❌ Network error. Please try again.");
        } finally {
            if(btn) {
                btn.innerHTML = `<span>⚡ Analyze Missed</span>`;
                btn.disabled = false;
            }
        }
    }

getWorkoutIcon(type) {
    const icons = {
        'Run': '🏃',
        'LongRun': '🏃‍♂️',
        'Workout': '💪',
        'Race': '🏁',
        'TrailRun': '⛰️',
        'VirtualRun': '💻'
    };
    return icons[type] || '🏃';
}

async syncStrava(evt) {
  const button = evt?.target; // safe

  try {
    if (button) { button.innerHTML = '⏳'; button.disabled = true; }

    const response = await fetch('/api/strava/sync', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${this.token}` }
    });

    const data = await response.json();

    if (data.success) {
      alert(`✅ Synced ${data.count} activities from Strava!`);
      await this.renderStravaWorkoutHistory('workout-history-container');
    } else {
      alert('❌ Failed to sync Strava: ' + data.message);
    }
  } catch (error) {
    console.error('Sync error:', error);
    alert('❌ Failed to sync Strava');
  } finally {
    if (button) { button.innerHTML = '🔄 Sync'; button.disabled = false; }
  }
}


    // UPDATED: Weekly Training Load (Volume Trend)
    async renderProgressChart(containerId) {
        const container = document.getElementById(containerId);
        if (!container) return;

        // Header with display area for hover/click values
        container.innerHTML = `
            <div class="widget-header">
                <div style="display:flex; align-items:center; justify-content:space-between; width:100%;">
                    <h3>📊 Weekly Load</h3>
                    <div id="load-display" style="font-size:12px; font-weight:600; color:#3b82f6; min-height:18px;">Last 12 Weeks</div>
                </div>
            </div>
            <div style="height: 180px; display:flex; align-items:center; justify-content:center;">
                <div class="loading-spinner"></div>
            </div>`;

        try {
            // Fetch 12 weeks (~84 days) of history to aggregate locally
            const response = await fetch('/api/analytics/workout-history?days=90', {
                headers: { 'Authorization': `Bearer ${this.token}` }
            });
            const data = await response.json();

            if (!data.success || !data.workouts || data.workouts.length === 0) {
                container.innerHTML = `<div class="widget-header"><h3>📊 Weekly Load</h3></div><div class="empty-state-widget"><p>No data available.</p></div>`;
                return;
            }

            // --- Aggregation Logic: Group by Week (Monday Start) ---
            const weeklyMap = new Map();
            const getMonday = (d) => {
                const date = new Date(d);
                const day = date.getDay();
                const diff = date.getDate() - day + (day === 0 ? -6 : 1); // adjust when day is sunday
                const monday = new Date(date.setDate(diff));
                monday.setHours(0,0,0,0);
                return monday.getTime();
            };

            data.workouts.forEach(w => {
                if (!w.distance) return;
                const dateObj = new Date(w.startDate || w.scheduledDate);
                const weekKey = getMonday(dateObj);
                
                if (!weeklyMap.has(weekKey)) weeklyMap.set(weekKey, 0);
                weeklyMap.set(weekKey, weeklyMap.get(weekKey) + (w.distance || 0));
            });

            // Convert to array and sort
            const weeks = Array.from(weeklyMap.entries())
                .map(([ts, dist]) => ({ date: new Date(ts), distance: dist }))
                .sort((a, b) => a.date - b.date)
                .slice(-12); // Last 12 weeks

            if (weeks.length === 0) {
                container.innerHTML = `<div class="widget-header"><h3>📊 Weekly Load</h3></div><div class="empty-state-widget"><p>No distance logged.</p></div>`;
                return;
            }

            const maxDist = Math.max(...weeks.map(w => w.distance)) || 10;
            const chartHeight = 140;

            const barsHtml = weeks.map(week => {
                const heightPct = (week.distance / maxDist) * 100;
                const heightPx = Math.max(4, Math.floor((heightPct / 100) * chartHeight));
                
                // Format dates: "Jan 15"
                const dateStr = week.date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
                const endOfWeek = new Date(week.date);
                endOfWeek.setDate(endOfWeek.getDate() + 6);
                const dateRange = `${dateStr} - ${endOfWeek.toLocaleDateString(undefined, { day: 'numeric' })}`;
                
                const labelText = `${dateRange}: ${week.distance.toFixed(1)} km`;

                // ✅ Added onclick for mobile support
                return `
                    <div style="display:flex; flex-direction:column; align-items:center; flex:1; gap:4px; cursor:pointer;"
                         onmouseenter="document.getElementById('load-display').innerText = '${labelText}'"
                         onclick="document.getElementById('load-display').innerText = '${labelText}'"
                         onmouseleave="document.getElementById('load-display').innerText = 'Last 12 Weeks'">
                        <div style="width:70%; background:${week.distance > 0 ? '#3b82f6' : '#e5e7eb'}; border-radius:4px 4px 0 0; height:${heightPx}px; opacity:0.8; transition: height 0.3s ease;"></div>
                    </div>
                `;
            }).join('');

            container.innerHTML = `
                <div class="widget-header">
                    <div style="display:flex; align-items:center; justify-content:space-between; width:100%;">
                        <h3>📊 Weekly Load</h3>
                        <div id="load-display" style="font-size:11px; font-weight:600; color:#3b82f6;">Last 12 Weeks</div>
                    </div>
                </div>
                <div style="height: ${chartHeight}px; display: flex; align-items: flex-end; justify-content: space-between; gap: 4px; padding-bottom: 5px; border-bottom: 1px solid #e5e7eb;">
                    ${barsHtml}
                </div>
                <div style="display:flex; justify-content:space-between; margin-top:5px; font-size:10px; color:#9ca3af;">
                    <span>${weeks[0].date.toLocaleDateString(undefined, {month:'short', day:'numeric'})}</span>
                    <span>Current</span>
                </div>
            `;

        } catch (error) {
            console.error('Weekly Load Chart Error:', error);
            container.innerHTML = `<p class="text-red-500 text-center">Failed to load chart.</p>`;
        }
    }

renderSimpleBarChart(data, metric) {
    const maxValue = Math.max(...data.map(d => d.value));
    const chartHeight = 200;

    let html = `
        <div class="widget progress-chart-widget">
            <div class="widget-header">
                <h3>📈 Progress - ${metric.charAt(0).toUpperCase() + metric.slice(1)}</h3>
            </div>
            <div class="chart-container" style="height: ${chartHeight}px; position: relative; padding: 10px;">
                <svg width="100%" height="${chartHeight}" style="position: absolute; top: 0; left: 0;">
    `;

    const barWidth = 100 / data.length;
    data.forEach((point, index) => {
        const barHeight = maxValue > 0 ? (point.value / maxValue) * (chartHeight - 40) : 0;
        const x = index * barWidth;
        const y = chartHeight - barHeight - 25;

        html += `
            <rect 
                x="${x}%" 
                y="${y}" 
                width="${barWidth * 0.7}%" 
                height="${barHeight}" 
                fill="#667eea" 
                opacity="0.8"
                rx="3"
            />
            <text 
                x="${x + (barWidth * 0.35)}%" 
                y="${chartHeight - 8}" 
                text-anchor="middle" 
                font-size="10" 
                fill="#666"
            >
                W${point.week.split('-W')[1]}
            </text>
        `;
    });

    html += `
                </svg>
            </div>
            <div class="chart-legend" style="text-align: center; font-size: 12px; color: #666; margin-top: 10px;">
                Weekly ${metric} over last 90 days
            </div>
        </div>
    `;

    return html;
}

async renderPersonalRecords(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    container.innerHTML = '<div class="loading">Loading personal records...</div>';

    try {
        const response = await fetch('/api/analytics/personal-records', {
            headers: { 'Authorization': `Bearer ${this.token}` }
        });

        const data = await response.json();

        if (!data.success) {
            container.innerHTML = '<div class="widget empty-state-widget">No personal records available</div>';
            return;
        }

        const { records } = data;

        container.innerHTML = `
            <div class="widget personal-records-widget">
                <div class="widget-header">
                    <h3>🏆 Personal Records</h3>
                </div>
                
                <div class="records-grid">
                    <div class="record-card">
                        <div class="record-icon">🏃</div>
                        <div class="record-value">${records.totalRuns || 0}</div>
                        <div class="record-label">Total Runs</div>
                    </div>
                    
                    <div class="record-card">
                        <div class="record-icon">📏</div>
                        <div class="record-value">${records.longestRun?.distance || '0'} km</div>
                        <div class="record-label">Longest Run</div>
                    </div>
                    
                    <div class="record-card">
                        <div class="record-icon">🌍</div>
                        <div class="record-value">${records.totalDistance || '0'} km</div>
                        <div class="record-label">Total Distance</div>
                    </div>
                    
                    <div class="record-card">
                        <div class="record-icon">⏱️</div>
                        <div class="record-value">${records.totalTime || '0'} hrs</div>
                        <div class="record-label">Total Time</div>
                    </div>
                </div>

                <div class="widget-footer">
                    <small>All-time statistics from Strava</small>
                </div>
            </div>
        `;
    } catch (error) {
        console.error('Render personal records error:', error);
        container.innerHTML = '<div class="widget error-widget">Failed to load personal records</div>';
    }
}

async renderTrainingPlanOverview(containerId, planType = null) { // <--- 1. Add planType param
    const container = document.getElementById(containerId);
    if (!container) return;

    const isGenerating = this.isPlanGenerating();

    container.innerHTML = '<div class="loading">Loading training plan...</div>';

    try {
        // 2. Construct URL with query param if planType is provided
        const url = planType 
            ? `/api/training-plan/current?planType=${planType}`
            : '/api/training-plan/current';

        const response = await fetch(url, {
            headers: { 'Authorization': `Bearer ${this.token}` }
        });

        const data = await response.json();

        if ((!data.success || !data.plan) && isGenerating) {
                 container.innerHTML = `
                    <div class="widget" style="text-align:center; padding: 40px;">
                        <div style="font-size: 40px; margin-bottom: 15px; animation: pulse 2s infinite;">🤖</div>
                        <h3>Building Your Plan...</h3>
                        <p style="color:#666; margin-bottom: 20px;">AI is crafting your personalized schedule. This usually takes 10-20 seconds.</p>
                        <button onclick="window.location.reload()" class="btn-primary" style="background:#6d28d9;">
                           ⟳ Refresh Status
                        </button>
                    </div>`;
                 
                 // Auto-refresh after 10s if they don't click
                 setTimeout(() => {
                     // Clear flag only if we find a plan next time
                     // For now, just reload
                     window.location.reload(); 
                 }, 10000);
                 
                 return;
            }

        if (!data.success || !data.plan) {
            // Determine correct onboarding link based on missing plan type
            const onboardingLink = planType === 'race' ? '/ai-onboarding-race' : '/ai-onboarding-basic';
            
            container.innerHTML = `
                <div class="widget empty-state-widget">
                    <p>📅 No active ${planType || ''} training plan</p>
                    <p style="font-size: 14px; color: #666; margin-top: 8px;">
                        Create a personalized plan to reach your goals
                    </p>
                    <button onclick="window.location.href='${onboardingLink}'" class="btn-primary" style="margin-top: 15px;">
                        Create ${planType ? planType.charAt(0).toUpperCase() + planType.slice(1) : ''} Plan
                    </button>
                </div>
            `;
            this.clearPlanGenerating();
            return;
        }
        this.clearPlanGenerating();

        const { plan } = data;

        container.innerHTML = `
            <div class="widget training-plan-widget">
                
            
                <div class="plan-summary">
                    <div class="plan-info">
                        <span class="plan-week">Week ${plan.currentWeek || 1} of ${plan.totalWeeks || 12}</span>
                        <span class="plan-phase">${plan.phase || 'Base Building'}</span>
                    </div>
                </div>

                <div class="week-workouts-list">
                    ${(plan.thisWeekWorkouts || []).map(w => `
                        <div class="workout-row ${w.completed ? 'completed' : ''}">
                            <div class="workout-day">
                                ${new Date(w.scheduledDate).toLocaleDateString('en-US', { weekday: 'short' })}
                            </div>
                            <div class="workout-detail">
                                <div class="workout-type">${w.type || 'Easy Run'}</div>
                                <div class="workout-desc">${w.distance || '5'} km • ${w.duration || '30'} min</div>
                            </div>
                            <div class="workout-status">
                                ${w.completed ? '✅' : '⏳'}
                            </div>
                        </div>
                    `).join('')}
                </div>

                <div class="widget-footer">
                   
<button onclick="window.toggleCalendar(event)" class="btn-secondary">
  View Full Calendar
</button>

                </div>
            </div>
        `;
    } catch (error) {
        console.error('Render training plan error:', error);
        container.innerHTML = '<div class="widget error-widget">Failed to load training plan</div>';
    }
}

    checkLoginNotifications() {
        const urlParams = new URLSearchParams(window.location.search);
        const loginMethod = urlParams.get('login');
        
        if (loginMethod === 'google') {
            this.showNotification('✅ Successfully logged in with Google! Welcome to Race Coach.', 'success');
        } else if (loginMethod === 'facebook') {
            this.showNotification('✅ Successfully logged in with Facebook! Welcome to Race Coach.', 'success');
        }
        
        if (loginMethod) {
            window.history.replaceState({}, document.title, window.location.pathname);
        }
    }

    showNotification(message, type = 'info') {
        const notification = document.createElement('div');
        notification.className = `notification notification-${type}`;
        
        // Inject styles if missing
        if (!document.getElementById('notification-styles')) {
            const style = document.createElement('style');
            style.id = 'notification-styles';
            style.textContent = `
                .notification { position: fixed; top: 100px; right: 20px; padding: 16px 20px; border-radius: 12px; box-shadow: 0 8px 24px rgba(0,0,0,0.2); z-index: 10000; background: white; border-left: 4px solid #3B82F6; display: flex; align-items: center; gap: 10px; animation: slideIn 0.4s ease-out; }
                .notification-success { border-color: #10B981; }
                .notification-error { border-color: #EF4444; }
                .notification-warning { border-color: #F59E0B; }
                @keyframes slideIn { from { transform: translateX(100%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
                @keyframes slideOut { from { transform: translateX(0); opacity: 1; } to { transform: translateX(100%); opacity: 0; } }
            `;
            document.head.appendChild(style);
        }

        notification.innerHTML = `
            <span>${message}</span>
            <button onclick="this.parentElement.remove()" style="margin-left: 10px; border: none; background: none; cursor: pointer;">&times;</button>
        `;
        document.body.appendChild(notification);
        
        setTimeout(() => {
            notification.style.animation = 'slideOut 0.4s ease-in forwards';
            setTimeout(() => notification.remove(), 400);
        }, 5000);
    }

    async renderRaceCountdown(containerId) {
        const container = document.getElementById(containerId);
        if (!container) return;

        try {
            const response = await fetch('/api/race-goals/plan/current', {
                headers: { 'Authorization': `Bearer ${this.token}` }
            });
            
            // Handle 404 gracefully
            if (response.status === 404) throw new Error("No active race plan");
            
            const data = await response.json();

            if (data.success && data.raceDate) {
                const raceDate = new Date(data.raceDate);
                const today = new Date();
                const diffTime = Math.abs(raceDate - today);
                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)); 

                container.innerHTML = `
                    <div class="bg-indigo-600 text-white p-4 rounded-xl shadow-lg text-center">
                        <div class="text-xs opacity-80 uppercase tracking-wide">Race Day Countdown</div>
                        <div class="text-3xl font-bold my-1">${diffDays} Days</div>
                        <div class="text-sm font-medium">${data.raceName || 'Your Target Race'}</div>
                    </div>
                `;
            } else {
                this.renderRaceEmptyState(container);
            }
        } catch (error) {
            console.warn('Race Countdown unavailable:', error);
            this.renderRaceEmptyState(container);
        }
    }

    renderRaceEmptyState(container) {
        container.innerHTML = `
            <div class="bg-gray-50 p-4 rounded-xl border border-dashed border-gray-300 text-center">
                <p class="text-gray-500 text-sm mb-2">No upcoming race set.</p>
                <button onclick="window.location.href='/ai-onboarding.html'" class="text-indigo-600 font-bold text-xs uppercase tracking-wide">Set Goal &rarr;</button>
            </div>
        `;
    }

    // --- 2. SUBSCRIPTION DETAILS (Moved from HTML) ---
    async loadSubscriptionDetails() {
        if (!this.token) return;
        try {
            const response = await fetch('/api/user/access-status', {
                headers: { 'Authorization': `Bearer ${this.token}` }
            });
            const data = await response.json();
            
            if (data.success && data.user) {
                this.updateSubscriptionUI(data.user);
            }
        } catch (error) {
           console.error('Failed to load subscription:', error);
            const nextBillingEl = document.getElementById('next-billing-date');
            if (nextBillingEl) nextBillingEl.textContent = 'N/A';
        }
    }

       // --- Paste this method inside your RaceDashboardWidgets class ---

    updateSubscriptionUI(user) {
        // DOM refs
        const statusEl        = document.getElementById('sub-status');
        const nextBillingEl   = document.getElementById('next-billing-date');
        const billingCycleEl  = document.getElementById('billing-cycle');
        const amountEl        = document.getElementById('billing-amount');
        const manageBtn       = document.querySelector('.btn-manage');
        const subscriptionCard = document.querySelector('.subscription-card');
        const downgradeBtn = subscriptionCard
            ? subscriptionCard.querySelector('.btn-action') // Assuming this is downgrade button class
            : document.getElementById('downgrade-btn');
        const pauseBtn = subscriptionCard
            ? subscriptionCard.querySelector('.btn-pause')
            : null;

        // Helper to safely convert Firestore Timestamp / ISO string
        const toJsDate = (value) => {
            if (!value) return null;
            if (value.toDate) return value.toDate();                  // Firestore Timestamp
            if (value.seconds) return new Date(value.seconds * 1000); // {seconds, nanoseconds}
            return new Date(value);                                   // ISO string or ms
        };

        const isTrial = user.subscriptionStatus === 'trial';
        const plan    = user.currentPlan || 'free';

        // 🔹 TRIAL STATE (Race trial)
        if (isTrial && plan === 'race') {
            console.log('Race trial detected in dashboard:', user);

            // Status
            if (statusEl) {
                statusEl.textContent = 'Trial';
                statusEl.style.color = '#3b82f6';
            }

            // Show trial end date instead of billing
            const trialEnd = toJsDate(user.trialEndDate);
            if (nextBillingEl) {
                nextBillingEl.textContent = trialEnd
                    ? trialEnd.toLocaleDateString('en-IN', {
                          day: 'numeric',
                          month: 'short',
                          year: 'numeric'
                      })
                    : 'Trial in progress';
            }

            // Billing cycle + amount for trial
            if (billingCycleEl) {
                billingCycleEl.textContent = 'Trial (no billing)';
            }
            if (amountEl) {
                amountEl.textContent = '₹0';
            }

            // Buttons – hide & disable downgrade, turn "Manage" into upgrade CTA
            if (downgradeBtn) {
                downgradeBtn.style.display = 'none';
                downgradeBtn.disabled = true;
                downgradeBtn.removeAttribute('onclick');
            }
            if (pauseBtn) {
                pauseBtn.style.display = 'none';
                pauseBtn.disabled = true;
            }
            if (manageBtn) {
                manageBtn.textContent = 'Upgrade to paid plan';
                manageBtn.href = '/subscription';   // or '/plans' if you prefer
            }

            // Done – do NOT run paid logic below
            return;
        }

        // 🔹 NON‑TRIAL / PAID / FREE – existing behaviour

        // Status
        if (user.subscriptionStatus && statusEl) {
            const status =
                user.subscriptionStatus.charAt(0).toUpperCase() +
                user.subscriptionStatus.slice(1);
            statusEl.textContent = status;
            statusEl.style.color =
                user.subscriptionStatus === 'active'   ? '#10b981' :
                user.subscriptionStatus === 'cancelled'? '#ef4444' :
                user.subscriptionStatus === 'expired'  ? '#ef4444' :
                user.subscriptionStatus === 'paused'   ? '#f59e0b' :
                '#6b7280';
        }

        // Subscription end date → "Next Billing"
        if (user.subscriptionEndDate && nextBillingEl) {
             const endDate = toJsDate(user.subscriptionEndDate);
             if (endDate && !Number.isNaN(endDate.getTime())) {
                nextBillingEl.textContent = endDate.toLocaleDateString('en-IN', {
                  day: 'numeric',
                  month: 'short',
                  year: 'numeric'
                });
                // 🔴 store raw timestamp so front-end can enforce rules
                nextBillingEl.dataset.billingTs = endDate.getTime().toString();
             } else {
                nextBillingEl.textContent = 'N/A';
                delete nextBillingEl.dataset.billingTs;
             }
        } else if (nextBillingEl && !isTrial) {
             nextBillingEl.textContent = 'N/A';
             delete nextBillingEl.dataset.billingTs;
        }

        // Billing cycle
        if (user.billingCycle && billingCycleEl) {
            const cycle =
                user.billingCycle.charAt(0).toUpperCase() +
                user.billingCycle.slice(1);
            billingCycleEl.textContent = cycle;
        }

        // Amount (from last payment)
        if (typeof user.lastPaymentAmount === 'number' && amountEl) {
            amountEl.textContent = `₹${user.lastPaymentAmount}`;
        }

        // 🔹 Pause / Resume button label & visibility
        if (pauseBtn) {
            // Hide for free or non‑coach plans
            if (plan === 'free' || !['basic', 'race'].includes(plan)) {
                pauseBtn.style.display = 'none';
                pauseBtn.disabled = true;
            } else if (user.subscriptionStatus === 'active') {
                // Show "Pause" for active paid plans
                pauseBtn.style.display = 'inline-block';
                pauseBtn.disabled = false;
                pauseBtn.textContent = '⏸️ Pause Subscription';
                pauseBtn.style.background = '#FBBF24';
                pauseBtn.style.borderColor = '#F59E0B';
                pauseBtn.style.color = '#92400E';
            } else if (user.subscriptionStatus === 'paused') {
                // Show "Resume" when paused
                pauseBtn.style.display = 'inline-block';
                pauseBtn.disabled = false;
                pauseBtn.textContent = '▶️ Resume Subscription';
                pauseBtn.style.background = '#10B981';
                pauseBtn.style.borderColor = '#059669';
                pauseBtn.style.color = '#FFFFFF';
            } else {
                // Cancelled / expired / trial etc.
                pauseBtn.style.display = 'none';
                pauseBtn.disabled = true;
            }
        }
    }


    // ADVANCED Weekly Plan for Race
        async renderWeeklyPlanWidget(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const isGenerating = this.isPlanGenerating();
  if (typeof this.currentWeekOffset === 'undefined') this.currentWeekOffset = 0;

  try {
    const response = await fetch(`/api/race/weekly-plan?offset=${this.currentWeekOffset}`, {
      headers: { Authorization: `Bearer ${this.token}` }
    });
    const data = await response.json();

    // Generating state
    if ((!data.success || !data.weeklyPlan) && isGenerating) {
      container.innerHTML = `
        <div class="text-center py-8 bg-gray-50 border-2 border-dashed border-gray-200 rounded-xl">
          <h3 class="text-lg font-bold text-gray-700 animate-pulse">Generating Schedule...</h3>
          <p class="text-sm text-gray-500 mb-4">Please wait while we finalize your weekly workouts.</p>
        </div>`;
      return;
    }

    // Success
    if (data.success && data.weeklyPlan) {
        const rawDays = Array.isArray(data.weeklyPlan.days) ? data.weeklyPlan.days : [];
      
      // Count workouts that are NOT rest days
      const totalScheduled = rawDays.filter(d => 
        d.workout && d.workout.type && d.workout.type.toLowerCase() !== 'rest'
      ).length;

      // Count completed workouts
      const totalCompleted = rawDays.filter(d => 
        d.workout && d.workout.completed
      ).length;

      const pct = totalScheduled > 0 ? Math.round((totalCompleted / totalScheduled) * 100) : 0;
      const barColor = pct >= 80 ? '#10b981' : '#8b5cf6'; // Green if >80%, else Purple

      // Create the HTML for the score bar
      const complianceHtml = `
        <div style="margin-bottom: 16px; background: #fff; padding: 12px 16px; border: 1px solid #e5e7eb; border-radius: 12px; display: flex; flex-direction: column; gap: 6px;">
            <div style="display: flex; justify-content: space-between; align-items: center;">
                <span style="font-size: 13px; font-weight: 600; color: #374151;">Weekly Consistency</span>
                <span style="font-size: 13px; font-weight: 500; color: #6b7280;">${totalCompleted}/${totalScheduled} Runs</span>
            </div>
            <div style="width: 100%; background: #f3f4f6; height: 8px; border-radius: 4px; overflow: hidden;">
                <div style="width: ${pct}%; height: 100%; background: ${barColor}; border-radius: 4px; transition: width 0.5s ease;"></div>
            </div>
        </div>
      `;

        
      // Normalize weeklyPlan.days -> planMap
     let planMap = {};
      if (Array.isArray(data.weeklyPlan.days)) {
        data.weeklyPlan.days.forEach(day => {
          if (day.label) {
             // 1. Store original label
             planMap[day.label] = day;

             // 2. Add robust mapping for abbreviations (Mon, Tue...) and lowercase
             // This ensures 'Sat' from backend matches 'Saturday' in the frontend template
             const shortName = day.label.trim().substring(0, 3).toLowerCase();
             const map = {
                 'mon': 'Monday', 'tue': 'Tuesday', 'wed': 'Wednesday', 
                 'thu': 'Thursday', 'fri': 'Friday', 'sat': 'Saturday', 'sun': 'Sunday'
             };
             if (map[shortName]) {
                 planMap[map[shortName]] = day;
             }
          }
        });
      } else if (data.weeklyPlan && typeof data.weeklyPlan === 'object') {
        planMap = data.weeklyPlan;
      }

      if (Object.keys(planMap).length > 0) {
        this.clearPlanGenerating();

        // IMPORTANT: inject nav context into meta so raceWeeklyTemplate renders it
        const meta = {
          ...data.weeklyPlan,
          containerId, // so Prev/Next can re-render the right widget
          weekOffset: this.currentWeekOffset,
          dateRangeLabel: this.getWeekRangeLabel(this.currentWeekOffset)
        };

        // NO external navHeader anymore
        container.innerHTML = this.raceWeeklyTemplate(planMap, meta);
        return;
      }

      // weeklyPlan exists but empty
      this.clearPlanGenerating();
    }

    // Fallback: plan exists but weekly view failed
    try {
      const planRes = await fetch('/api/race-goals/plan/current', {
        headers: { Authorization: `Bearer ${this.token}` }
      });

      if (planRes.ok) {
        const planData = await planRes.json();
        if (planData.success && planData.plan) {
          this.clearPlanGenerating();
          container.innerHTML = `
            <div class="text-center py-8 bg-gray-50 border-2 border-dashed border-gray-200 rounded-xl">
              <h3 class="text-lg font-bold text-gray-700">Weekly view unavailable</h3>
              <p class="text-sm text-gray-500 mb-4">
                Your race plan exists, but this week's layout couldn't be loaded right now.
              </p>
              <button onclick="window.dashboardWidgets.renderWeeklyPlanWidget('${containerId}')"
                class="bg-indigo-600 text-white px-6 py-2 rounded-lg shadow hover:bg-indigo-700">
                Retry
              </button>
            </div>`;
          return;
        }
      }
    } catch (e) {
      // ignore
    }

    // Empty state (no plan)
    container.innerHTML = `
      <div class="text-center py-8 bg-gray-50 border-2 border-dashed border-gray-200 rounded-xl">
        <h3 class="text-lg font-bold text-gray-700">Ready to Race?</h3>
        <p class="text-sm text-gray-500 mb-4">Set your target race to generate your plan.</p>
        <button onclick="window.location.href='/ai-onboarding.html'"
          class="bg-indigo-600 text-white px-6 py-2 rounded-lg shadow hover:bg-indigo-700">
          Create Race Plan
        </button>
      </div>`;

    this.clearPlanGenerating();
  } catch (error) {
    console.error('Race Plan Error', error);
    container.innerHTML = `<p class="text-red-500 text-center">Failed to load plan.</p>`;
  }
}

// --- Helpers (inside class) ---

getWeekRangeLabel(offset = 0) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const jsDay = today.getDay() || 7; // 1..7
  const diffToMon = 1 - jsDay;

  const start = new Date(today);
  start.setDate(today.getDate() + diffToMon + (offset * 7));
  const end = new Date(start);
  end.setDate(start.getDate() + 6);

  const fmt = (d) => d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return `${fmt(start)} – ${fmt(end)}`;
}

changeWeek(delta, containerId = 'weekly-plan-container') {
  if (typeof this.currentWeekOffset === 'undefined') this.currentWeekOffset = 0;
  this.currentWeekOffset += delta;
  this.renderWeeklyPlanWidget(containerId);
}



raceWeeklyTemplate(planMap, meta = {}) {
  const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

  // --- Header meta (safe defaults) ---
  const weekNumber = meta.weekNumber ?? null;
  const totalWeeks = meta.totalWeeks ?? null;
  const phase = meta.phase ?? null;

  const phaseWeekNumber = meta.phaseWeekNumber ?? null;
  const phaseTotalWeeks = meta.phaseTotalWeeks ?? null;

  // NEW: navigation context
  const containerId = meta.containerId || 'weekly-plan-container';
  const dateRangeLabel = meta.dateRangeLabel || 'Current Week';

  const weekText =
    (weekNumber && totalWeeks) ? `Week ${weekNumber} of ${totalWeeks}` :
    (weekNumber ? `Week ${weekNumber}` : '');

  const phaseText =
    (phase && phaseWeekNumber && phaseTotalWeeks)
      ? `${phase} (Week ${phaseWeekNumber} of ${phaseTotalWeeks})`
      : (phase ? String(phase) : '');

  const headerLine = [weekText, phaseText].filter(Boolean).join(' • ');

  // Explicit Grid Style for Desktop (7 columns)
  const gridStyle = `
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    gap: 12px;
    width: 100%;
    margin-top: 10px;
  `;

  const items = days.map(day => {
    const data = planMap[day] || {};
    const workout = data.workout || {};

    // 1) Determine type
    const title = workout.title ? workout.title.toLowerCase() : 'rest';
    const type = workout.type ? workout.type.toLowerCase() : '';
    const isRest = title.includes('rest');

    // 2) Assign CSS class + strip color
    let typeClass = 'type-easy';
    let stripColor = '#3b82f6';

    if (isRest) {
      typeClass = 'type-rest';
      stripColor = '#9ca3af';
    } else if (title.includes('long') || type === 'long_run') {
      typeClass = 'type-long';
      stripColor = '#8b5cf6';
    } else if (title.includes('interval') || title.includes('tempo') || title.includes('speed')) {
      typeClass = 'type-quality';
      stripColor = '#f97316';
    }

    // 3) Format volume
    let volumeDisplay = '-';
    if (workout.distance) volumeDisplay = `${workout.distance} km`;
    else if (workout.duration) volumeDisplay = `${workout.duration} min`;

    // 4) Click handler
    const clickAction =
  workout.id && !isRest
    ? `onclick="window.openWorkoutModal('${workout.id}')"`
    : "";

    const cursorStyle = (workout.id && !isRest) ? 'cursor: pointer;' : 'cursor: default;';

    // 5) Card styles
    const cardStyle = `
      ${cursorStyle}
      background: #fff;
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      min-height: 110px;
      position: relative;
      box-shadow: 0 1px 2px rgba(0,0,0,0.05);
      transition: transform 0.2s;
    `;

    return `
      <div ${clickAction} class="race-card ${typeClass}" style="${cardStyle}">
        <div class="race-strip" style="position:absolute; left:0; top:0; bottom:0; width:4px; background:${stripColor};"></div>

        <div style="padding:10px 10px 10px 14px; display:flex; flex-direction:column; height:100%;">
          <div class="race-day-label" style="font-size:11px; font-weight:700; text-transform:uppercase; color:#6b7280; margin-bottom:4px;">
            ${day.substring(0, 3)}
          </div>

          <div class="race-title" style="font-size:13px; font-weight:600; color:#111827; line-height:1.3; margin-bottom:auto;">
            ${workout.title || 'Rest'}
          </div>

          <div class="race-stats" style="margin-top:8px;">
            <span class="race-badge"
              style="background:${isRest ? '#f3f4f6' : '#eff6ff'}; color:${isRest ? '#9ca3af' : '#1d4ed8'}; padding:2px 8px; border-radius:12px; font-size:11px; font-weight:600;">
              ${volumeDisplay}
            </span>
          </div>
        </div>
      </div>
    `;
  }).join('');

  const responsiveStyle = `
    <style>
      @media (max-width: 768px) {
        .race-weekly-grid { grid-template-columns: repeat(1, 1fr) !important; }

        .weekly-plan-header {
          flex-direction: column !important;
          align-items: stretch !important;
        }

        .weekly-plan-actions {
          justify-content: space-between !important;
          width: 100% !important;
        }

        .weekly-plan-range {
          text-align: center !important;
          flex: 1 !important;
        }
      }
    </style>
  `;

  // Header contains: title/meta + prev/next/dateRange + calendar button
  const headerHtml = `
    <div class="widget-header weekly-plan-header"
         style="display:flex; justify-content:space-between; align-items:flex-start; gap:12px; margin-bottom:8px;">

      <div style="flex:1; min-width:0;">
        <div style="display:flex; align-items:baseline; gap:10px; flex-wrap:wrap;">
          <h3 style="margin:0; font-size:16px; font-weight:800; color:#111827;">Weekly Plan</h3>
          ${headerLine ? `<div style="font-size:12px; color:#6b7280;">${headerLine}</div>` : ``}
        </div>

        <div class="weekly-plan-actions"
             style="display:flex; align-items:center; gap:10px; margin-top:8px;">
          <button onclick="window.dashboardWidgets.changeWeek(-1, '${containerId}')"
            style="background:none; border:none; color:#6b7280; font-weight:600; cursor:pointer; font-size:14px; padding:0;">
            &larr; Prev
          </button>

          <span class="weekly-plan-range"
            style="font-weight:700; color:#374151; font-size:14px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
            ${dateRangeLabel}
          </span>

          <button onclick="window.dashboardWidgets.changeWeek(1, '${containerId}')"
            style="background:none; border:none; color:#6b7280; font-weight:600; cursor:pointer; font-size:14px; padding:0;">
            Next &rarr;
          </button>
        </div>
      </div>

      <button onclick="window.toggleCalendar(event)" class="btn-secondary" style="white-space:nowrap;">
        View Full Calendar
      </button>
    </div>
  `;

  return `
    ${responsiveStyle}
    <div class="widget">
      ${headerHtml}
      <div class="race-weekly-grid" style="${gridStyle}">${items}</div>
    </div>
  `;
}



// ✅ FIX: Robust Pace Chart Calculator
async renderPerformanceChart(containerId) {
        const container = document.getElementById(containerId);
        if (!container) return;

        if (!document.getElementById('chart-tooltip')) {
            const tooltip = document.createElement('div');
            tooltip.id = 'chart-tooltip';
            tooltip.className = 'chart-tooltip';
            document.body.appendChild(tooltip);
        }

        container.innerHTML = `
            <div class="widget-header">
                <div style="display:flex; align-items:center; justify-content:space-between; width:100%;">
                    <div style="display:flex; align-items:center; gap:8px;">
                        <h3>⚡ Pace Trend</h3>
                        <span style="font-size:11px; background:#f3f4f6; padding:2px 6px; border-radius:4px; color:#6b7280;">Last 30 Runs</span>
                    </div>
                    <div id="pace-hover-display" style="font-size:12px; font-weight:600; color:#8b5cf6; min-height:18px;"></div>
                </div>
            </div>
            <div style="height: 180px; display:flex; align-items:center; justify-content:center;">
                <div class="loading-spinner"></div>
            </div>`;

        try {
            const response = await fetch('/api/analytics/workout-history?days=30', {
                headers: { 'Authorization': `Bearer ${this.token}` }
            });
            const data = await response.json();

            if (!data.success || !data.workouts || data.workouts.length === 0) {
                container.innerHTML = `<div class="widget-header"><h3>⚡ Pace Trend</h3></div><div class="empty-state-widget"><p>No running data available.</p></div>`;
                return;
            }

            // Filter & Process Data
            const runs = data.workouts
                .filter(w => (w.type === 'Run' || w.type === 'run') && w.distance > 0)
                .map(w => {
                    let paceVal = 0;
                    if (w.averagePace) {
                        paceVal = this.parsePace(w.averagePace);
                    } else if (w.movingTime && w.distance) {
                        paceVal = w.movingTime / w.distance;
                    }
                    return {
                        date: new Date(w.startDate || w.scheduledDate),
                        paceVal: paceVal, 
                        paceStr: this.formatPace(paceVal),
                        distance: (w.distance || 0).toFixed(1)
                    };
                })
                .filter(r => r.paceVal > 0 && r.paceVal < 20) // Filter outliers
                .reverse(); // Oldest to newest

            if (runs.length === 0) {
                container.innerHTML = `<div class="widget-header"><h3>⚡ Pace Trend</h3></div><div class="empty-state-widget"><p>No pace data found.</p></div>`;
                return;
            }

            // Scaling
            const minPace = Math.min(...runs.map(r => r.paceVal));
            const maxPace = Math.max(...runs.map(r => r.paceVal));
            const chartHeight = 140;

            const barsHtml = runs.map((run) => {
                // Inverted Logic: Faster (lower pace) = Taller Bar
                // Baseline is maxPace (slowest). 
                // Height is proportional to how much faster this run was than the slowest run.
                let pct = 0;
                if (maxPace !== minPace) {
                    pct = ((maxPace - run.paceVal) / (maxPace - minPace)) * 0.6 + 0.2; // Scale between 20% and 80% height
                } else {
                    pct = 0.5;
                }
                
                const heightPx = Math.floor(pct * chartHeight);
                const opacity = 0.4 + (0.6 * pct); 
                const labelText = `${run.date.toLocaleDateString()}: ${run.paceStr}/km (${run.distance}km)`;

                // ✅ HOVER VALUE: Added detailed title attribute
              return `
                    <div style="display:flex; flex-direction:column; align-items:center; flex:1; min-width:6px; gap:4px; cursor:pointer;" 
                         onmouseenter="document.getElementById('pace-hover-display').innerText = '${labelText}'"
                         onclick="document.getElementById('pace-hover-display').innerText = '${labelText}'"
                         onmouseleave="document.getElementById('pace-hover-display').innerText = 'Last 30 Runs'">
                        <div style="width:70%; background:#8b5cf6; border-radius:4px 4px 0 0; height:${heightPx}px; opacity:${opacity}; transition:all 0.1s;"></div>
                    </div>`;
            }).join('');

            container.innerHTML = `
                <div class="widget-header">
                    <div style="display:flex; align-items:center; justify-content:space-between; width:100%;">
                        <h3>⚡ Pace Trend</h3>
                        <div id="pace-hover-display" style="font-size:11px; font-weight:600; color:#8b5cf6;">Last 30 Runs</div>
                    </div>
                </div>
                <div style="display:flex; justify-content:space-between; align-items:flex-end; padding:0 5px; margin-bottom:5px; font-size:10px; color:#6b7280;">
                    <span>Slow (${this.formatPace(maxPace)})</span>
                    <span>Fast (${this.formatPace(minPace)})</span>
                </div>
                <div style="height: ${chartHeight}px; display: flex; align-items: flex-end; justify-content: space-between; gap: 2px; padding: 0 0 10px 0; border-bottom: 1px solid #e5e7eb;">
                    ${barsHtml}
                </div>
            `;

        } catch (e) {
            console.error("Chart error", e);
            container.innerHTML = `<p style="color:red; padding:20px;">Could not load chart data.</p>`;
        }
    }

// 🛠️ Helper: Parse "5:30" or number to float
parsePace(input) {
    if (typeof input === 'number') return input;
    if (!input) return 0;
    const parts = input.split(':');
    if (parts.length === 2) {
        return parseFloat(parts[0]) + (parseFloat(parts[1]) / 60);
    }
    return parseFloat(input) || 0;
}

// 🛠️ Helper: Number to "5:30" string
formatPace(val) {
    const mins = Math.floor(val);
    const secs = Math.round((val - mins) * 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}


        setupDowngradeListeners() {
        const downgradeBtn = document.getElementById('downgrade-btn');
        
        if (downgradeBtn) {
            downgradeBtn.addEventListener('click', async (e) => {
                e.preventDefault();

                // 1. Confirm Intent (Native confirm or replace with a custom modal)
                const confirmed = confirm(
                    "Are you sure you want to downgrade to the Basic Plan?\n\n" +
                    "• You will lose access to the Race Calendar & Analytics.\n" +
                    "• Your current race plan data will be archived.\n" +
                    "• This change takes effect immediately."
                );

                if (!confirmed) return;

                // 2. Show Loading State
                const originalText = downgradeBtn.innerText;
                downgradeBtn.innerText = "Processing...";
                downgradeBtn.disabled = true;
                downgradeBtn.classList.add('opacity-50', 'cursor-not-allowed');

                try {
                    // 3. Call API
                    const response = await fetch('/api/subscription/downgrade', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${this.token}`
                        },
                        body: JSON.stringify({
                            toPlan: 'basic'
                        })
                    });

                    const data = await response.json();

                    if (data.success) {
                        // 4. Success - Redirect to Basic Dashboard
                        alert("Downgrade successful. Redirecting to Basic Coach...");
                        window.location.href = '/dashboard-basic.html';
                    } else {
                        throw new Error(data.message || 'Downgrade failed');
                    }
                } catch (error) {
                    console.error('Downgrade error:', error);
                    alert(`Error: ${error.message}`);
                    
                    // Reset Button
                    downgradeBtn.innerText = originalText;
                    downgradeBtn.disabled = false;
                    downgradeBtn.classList.remove('opacity-50', 'cursor-not-allowed');
                }
            });
        } else {
            console.warn('Downgrade button (#downgrade-btn) not found in DOM.');
        }
    }

    setupPauseResumeListeners() {
         const pauseBtn = document.querySelector('.btn-pause');
         if(pauseBtn) {
             pauseBtn.addEventListener('click', () => this.handlePauseOrResume());
         }
    }

    async handlePauseOrResume() {
  try {
    const statusEl = document.getElementById('sub-status');
    const statusText = statusEl?.textContent?.trim().toLowerCase();

    // Do nothing for trial/free
    if (statusText === 'trial' || statusText === 'free') {
      alert('Pause is only available for paid subscriptions.');
      return;
    }

    const token = localStorage.getItem('userToken');
    if (!token) {
      window.location.href = '/login';
      return;
    }

    const nextBillingEl = document.getElementById('next-billing-date');
    const rawTs = nextBillingEl?.dataset?.billingTs;

    if (rawTs) {
      const billingAt = new Date(parseInt(rawTs, 10));
      const now = new Date();
      const hoursUntilBilling =
        (billingAt.getTime() - now.getTime()) / (1000 * 60 * 60);

      if (hoursUntilBilling <= 24) {
        // Use your toast if available
        if (typeof showNotification === 'function') {
          showNotification(
            'Your plan renews in less than 24 hours. Pausing is only allowed earlier in the cycle or after renewal.',
            'warning'
          );
        } else {
          alert(
            'Your plan renews in less than 24 hours.\n\n' +
            'Pausing is only allowed earlier in the cycle or after the next renewal.'
          );
        }
        return;
      }
    }

    if (statusText === 'paused') {
      // Resume
      const confirmed = confirm('Resume your subscription now?');
      if (!confirmed) return;

      const res = await fetch('/api/subscription/resume', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        }
      });

      const data = await res.json();
      if (!data.success) throw new Error(data.message || 'Failed to resume');

      alert('Your subscription has been resumed.');
      loadSubscriptionDetails(); // refresh card
      return;
    }

    // Otherwise, status is active → ask for pause duration
    const input = prompt(
      'Pause your subscription for how many days? (max 60)\n\n' +
      'Recommended options:\n' +
      '7 – Short injury / busy week\n' +
      '14 – Moderate break\n' +
      '30 – Longer recovery'
    );
    if (!input) return;

    const days = parseInt(input, 10);
    if (Number.isNaN(days) || days <= 0) {
      alert('Please enter a valid number of days.');
      return;
    }

    const reason = prompt(
      'Optional: Why are you pausing?\n' +
      '(e.g., injury, travel, illness)'
    ) || 'Not specified';

    const res = await fetch('/api/subscription/pause', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ durationDays: days, reason })
    });

    const data = await res.json();
    if (!data.success) throw new Error(data.message || 'Failed to pause');

    alert(`Your subscription is paused until ${new Date(data.pauseEndDate).toLocaleDateString('en-IN')}.`);
    loadSubscriptionDetails();
  } catch (error) {
  console.error('Pause/resume error:', error);
  const msg =
    error?.message ||
    (error?.responseMessage) ||
    'Something went wrong while updating your subscription.';

  // Prefer in-app toast if available
  if (typeof showNotification === 'function') {
    showNotification(msg, 'error');
  } else {
    alert(msg);
  }
  }}

attachWorkoutListeners() {
  // Optional: add event listeners if you move away from inline onclick handlers.
  // Safe no-op for now to prevent "is not a function" crashes.
}

// dashboard-race-widgets.js

// 1. Render the Widget (Gradient Style)
async renderAIInsightWidget(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    try {
        const res = await fetch('/api/workouts/latest-analysis', {
            headers: { 'Authorization': `Bearer ${this.token}` }
        });
        const data = await res.json();

        // State: Analyzing
        if (data.success === false && data.waiting) {
             container.innerHTML = `
                <div style="background:#fff; padding:20px; border-radius:12px; border:1px solid #e5e7eb; text-align:center;">
                    <h3 style="margin:0 0 10px 0; font-size:16px;">Coach is Analyzing... 🧠</h3>
                    <p style="color:#6b7280; font-size:13px;">Your latest run is being processed.</p>
                    <button onclick="window.location.reload()" style="margin-top:10px; padding:6px 12px; background:#eff6ff; color:#1d4ed8; border:none; border-radius:6px; font-size:12px; cursor:pointer;">Refresh</button>
                </div>`;
             return;
        }

        // State: No Data
        if (!data.success || !data.analysis) {
             container.innerHTML = `
                <div style="background:#fff; padding:20px; border-radius:12px; border:1px solid #e5e7eb; text-align:center;">
                    <h3 style="margin:0 0 10px 0; font-size:16px;">Ready to Train? 🏃‍♂️</h3>
                    <p style="color:#6b7280; font-size:13px;">Complete a workout to get AI coaching insights.</p>
                </div>`;
             return;
        }

        // State: Success
        const { analysis, activityName, date } = data;
        const dateObj = new Date(date);
        const isToday = dateObj.toDateString() === new Date().toDateString();
        const dateDisplay = isToday ? 'Today' : dateObj.toLocaleDateString(undefined, {month:'short', day:'numeric'});

        container.innerHTML = `
            <div style="background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%); color: white; padding: 20px; border-radius: 16px; position: relative; overflow: hidden; box-shadow: 0 10px 25px -5px rgba(79, 70, 229, 0.4);">
                <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 15px; position: relative; z-index: 2;">
                    <div>
                        <div style="font-size: 11px; text-transform: uppercase; letter-spacing: 1px; opacity: 0.8; font-weight: 600;">Latest Insight</div>
                        <div style="font-size: 14px; font-weight: 600; margin-top: 2px;">${activityName} <span style="opacity:0.7; font-weight:400;">• ${dateDisplay}</span></div>
                    </div>
                    <div style="background: rgba(255,255,255,0.2); backdrop-filter: blur(4px); padding: 4px 10px; border-radius: 20px; font-weight: 700; font-size: 13px;">
                        ${analysis.matchscore || '?'} / 10
                    </div>
                </div>

                <div style="position: relative; z-index: 2;">
                    <p style="font-size: 15px; line-height: 1.5; margin: 0 0 15px 0; font-weight: 500;">
                        "${analysis.feedback}"
                    </p>
                    ${analysis.tip ? `
                    <div style="background: rgba(255,255,255,0.1); padding: 10px 12px; border-radius: 8px; border-left: 3px solid #fbbf24; font-size: 13px;">
                        <strong style="color: #fbbf24;">💡 Coach Tip:</strong> ${analysis.tip}
                    </div>
                    ` : ''}
                </div>
                
                <button onclick="window.dashboardWidgets.openInsightsModal()" 
                    style="position: relative; z-index: 2; margin-top: 15px; background: rgba(255,255,255,0.2); border: none; color: white; padding: 8px 16px; border-radius: 6px; font-size: 12px; font-weight: 600; cursor: pointer; transition: background 0.2s;">
                    View Past 7 Days
                </button>

                <div style="position: absolute; top: -20px; right: -20px; width: 100px; height: 100px; background: rgba(255,255,255,0.1); border-radius: 50%; z-index: 1;"></div>
                <div style="position: absolute; bottom: -40px; left: -20px; width: 150px; height: 150px; background: rgba(255,255,255,0.05); border-radius: 50%; z-index: 1;"></div>
            </div>
        `;

    } catch (error) {
        console.error('Render Insight Error:', error);
        container.innerHTML = `<p style="color: #6b7280; font-size: 13px;">Coach is offline momentarily.</p>`;
    }
}

// 2. Ensure Modal HTML/CSS Exists
ensureInsightsModal() {
    // If it exists, just return (listeners are already attached)
    if (document.getElementById('insights-modal')) return;

    // 1. Add Styles
    const style = document.createElement('style');
    style.id = 'insights-modal-styles';
    style.textContent = `
        #insights-modal {
            position: fixed; inset: 0; background: rgba(0,0,0,0.6);
            display: none; align-items: center; justify-content: center;
            z-index: 99999; backdrop-filter: blur(2px);
        }
        #insights-modal .modal-card {
            width: min(600px, 90vw);
            max-height: 80vh;
            overflow: auto;
            background: #fff;
            border-radius: 16px;
            box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1);
            animation: fadeIn 0.2s ease-out;
        }
        @keyframes fadeIn { from { opacity: 0; transform: scale(0.95); } to { opacity: 1; transform: scale(1); } }
        /* ... existing styles ... */
        .insight-row { padding: 15px; border: 1px solid #e5e7eb; border-radius: 12px; margin-bottom: 12px; background: #fff; }
        .insight-header { display: flex; justify-content: space-between; margin-bottom: 8px; }
        .insight-date { font-size: 12px; color: #6b7280; font-weight: 600; }
        .insight-score { font-size: 12px; font-weight: 700; color: #4f46e5; background: #e0e7ff; padding: 2px 8px; border-radius: 12px; }
        .insight-text { font-size: 14px; color: #374151; line-height: 1.5; }
    `;
    document.head.appendChild(style);

    // 2. Add HTML
    const modalHtml = `
        <div id="insights-modal">
            <div class="modal-card">
                <div style="display:flex; justify-content: space-between; align-items:center; padding: 20px; border-bottom: 1px solid #e5e7eb; background: #f9fafb;">
                    <div style="font-weight: 700; font-size: 16px; color:#1f2937;">Coach Insights — Recent History</div>
                    <button onclick="window.dashboardWidgets.closeInsightsModal()" style="border: none; background: transparent; cursor: pointer; font-size: 24px; line-height: 1; color:#6b7280;">&times;</button>
                </div>
                <div class="modal-body" style="padding: 20px;">
                    <div id="insights-modal-content" style="text-align:center; color:#6b7280;">Loading...</div>
                </div>
            </div>
        </div>
    `;
    document.body.insertAdjacentHTML('beforeend', modalHtml);

    // 3. Attach Click Outside Listener
    const modal = document.getElementById('insights-modal');
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            this.closeInsightsModal();
        }
    });
}

// 3. Logic to Open Modal AND Fetch Data
async openInsightsModal() {
    this.ensureInsightsModal();
    const modal = document.getElementById('insights-modal');
    const content = document.getElementById('insights-modal-content');
    if (!modal) return;

    modal.style.display = 'flex';
    content.innerHTML = '<div class="loading-spinner"></div><p style="margin-top:10px;">Fetching history...</p>';

    try {
        const res = await fetch('/api/workouts/insights?days=7', {
            headers: { 'Authorization': `Bearer ${this.token}` }
        });
        const data = await res.json();

        if (data.success && data.insights && data.insights.length > 0) {
            content.innerHTML = data.insights.map(i => `
                <div class="insight-row">
                    <div class="insight-header">
                        <span class="insight-date">${new Date(i.date).toLocaleDateString(undefined, {weekday:'short', month:'short', day:'numeric'})} • ${i.activityName}</span>
                        <span class="insight-score">Score: ${i.matchscore || '-'}/10</span>
                    </div>
                    <div class="insight-text">"${i.feedback}"</div>
                </div>
            `).join('');
        } else {
            content.innerHTML = `<p>No insights found for the past 7 days.</p>`;
        }
    } catch (e) {
        content.innerHTML = `<p style="color:red;">Failed to load insights.</p>`;
    }
}

// 4. Close Logic
closeInsightsModal() {
    const modal = document.getElementById('insights-modal');
    if (modal) modal.style.display = 'none';
}

escapeHtml(str = '') {
  return String(str)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

// Reuse this to render the main Coach Insight card for any selected day
renderCoachInsightCard(insight = {}) {
  // Support BOTH:
  // 1) old: { activityName, date, analysis: { matchscore, feedback, tip } }
  // 2) new: { activityName, date, matchscore, feedback, tip, meta }
  const activityName = insight.activityName || insight.activity || 'Workout';
  const date = insight.date;

  const matchscore =
    (typeof insight.matchscore === 'number') ? insight.matchscore :
    (typeof insight.analysis?.matchscore === 'number') ? insight.analysis.matchscore :
    null;

  const feedback =
    insight.feedback ??
    insight.analysis?.feedback ??
    null;

  const tip =
    insight.tip ??
    insight.analysis?.tip ??
    null;

  const dateStr = date
    ? new Date(date).toLocaleDateString('en-US', { weekday:'short', month:'short', day:'numeric' })
    : '';

  // Color logic: only if we have a real numeric score
  let scoreColor = '#10b981';
  if (typeof matchscore === 'number') {
    if (matchscore < 5) scoreColor = '#ef4444';
    else if (matchscore < 8) scoreColor = '#f59e0b';
  }

  const scoreText = (typeof matchscore === 'number') ? `${matchscore}/10` : '—';

  return `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
      <span style="font-size:12px;font-weight:600;color:#6b7280;background:#f3f4f6;padding:4px 8px;border-radius:12px">
        ${this.escapeHtml(activityName)} • ${this.escapeHtml(dateStr)}
      </span>
      <span style="display:flex;align-items:center;gap:6px">
        <span style="font-size:12px;color:#6b7280;font-weight:600">Score</span>
        <span style="font-size:14px;font-weight:800;color:${scoreColor};border:1px solid ${scoreColor};padding:2px 6px;border-radius:6px">
          ${this.escapeHtml(scoreText)}
        </span>
      </span>
    </div>

    <div style="background:#f9fafb;border-radius:8px;padding:12px;margin-bottom:12px;border:1px solid #e5e7eb">
      <p style="margin:0;font-size:14px;color:#374151;line-height:1.5">
        ${this.escapeHtml(feedback || 'No feedback available.')}
      </p>
    </div>

    <div style="display:flex;gap:10px;align-items:flex-start">
      <span style="font-size:16px">💡</span>
      <p style="margin:0;font-size:13px;color:#4b5563;font-style:italic;line-height:1.4">
        <strong>Tip:</strong> ${this.escapeHtml(tip || 'Keep consistent!')}
      </p>
    </div>

    <div style="margin-top:16px;text-align:right">
      <button onclick="window.dashboardWidgets.loadPreviousInsights()" style="background:none;border:none;color:#667eea;cursor:pointer;font-size:12px;font-weight:600;text-decoration:underline">
        View Past 7 Days
      </button>
    </div>
  `;
}


async loadPreviousInsights() {
  this.openInsightsModal();

  const content = document.getElementById('insights-modal-content');
  if (content) content.innerHTML = `<div class="empty">Loading…</div>`;

  try {
    const res = await fetch(`/api/workouts/insights?days=7&gapMinutes=30`, {
      headers: { 'Authorization': `Bearer ${this.token}` }
    });

    const data = await res.json();

    if (!data?.success || !Array.isArray(data.insights) || data.insights.length === 0) {
      if (content) content.innerHTML = `<div class="empty">No insights found for the past 7 days.</div>`;
      return;
    }

    // Cache so we don't inline JSON into onclick
    this._cachedInsights = data.insights;

    const rowsHtml = data.insights.map((it, idx) => {
      const dateStr = it.date
        ? new Date(it.date).toLocaleDateString('en-US', { weekday:'short', month:'short', day:'numeric' })
        : 'Unknown date';

      const scoreVal = (typeof it.matchscore === 'number') ? it.matchscore : null;
      const scoreText = (scoreVal === null) ? '—' : `${scoreVal}/10`;

      return `
        <div class="insight-row" data-idx="${idx}">
          <div class="insight-left">
            <div class="insight-date">${this.escapeHtml(dateStr)}</div>
            <div class="insight-name">${this.escapeHtml(it.activityName || 'Workout')}</div>
          </div>
          <div class="insight-score">${this.escapeHtml(scoreText)}</div>
        </div>
      `;
    }).join('');

    if (content) content.innerHTML = rowsHtml;

    // Attach click handlers after DOM insert
    content.querySelectorAll('.insight-row').forEach(row => {
      row.addEventListener('click', () => {
        const idx = parseInt(row.getAttribute('data-idx'), 10);
        this.selectInsightFromModalIndex(idx);
      });
    });

  } catch (err) {
    console.error('loadPreviousInsights error:', err);
    if (content) content.innerHTML = `<div class="empty">Failed to load past insights. Check console.</div>`;
  }
}


// Called from inline onclick (kept simple, uses JSON payload)
selectInsightFromModalIndex(idx) {
  try {
    const insight = Array.isArray(this._cachedInsights) ? this._cachedInsights[idx] : null;
    if (!insight) return;

    const main = document.getElementById('ai-insight-content');
    if (main) {
      main.style.display = 'block';
      main.innerHTML = this.renderCoachInsightCard(insight);
    }

    this.closeInsightsModal();
  } catch (e) {
    console.error('selectInsightFromModalIndex error:', e);
  }
}

async renderRacePlanningWidget(containerId) {
        const container = document.getElementById(containerId);
        if (!container) return;

        // Fetch current goal to enable the button
        let goalDistance = "42.2"; // Default
        let goalTime = "4:00:00"; // Default
        let raceName = "My Race";
        try {
            const res = await fetch('/api/race-goals/current', { headers: { 'Authorization': `Bearer ${this.token}` }});
            const d = await res.json();
            if(d.success && d.raceGoal) {
                goalDistance = d.raceGoal.distance;
                goalTime = d.raceGoal.targetTime;
                if(d.raceGoal.name) raceName = d.raceGoal.name;
            }
        } catch(e) {}

       container.innerHTML = `
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
                <button onclick="window.dashboardWidgets.openPacingModal('${goalDistance}', '${goalTime}')" 
                    style="padding: 12px; background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 10px; text-align: left; transition: all 0.2s; cursor: pointer;">
                    <div style="font-size: 20px; margin-bottom: 4px;">⏱️</div>
                    <div style="font-weight: 700; font-size:13px; color: #166534;">Race Pacing</div>
                    <div style="font-size: 11px; color: #4ade80;">Strategy Splits</div>
                </button>

                <button onclick="window.dashboardWidgets.openNutritionModal('${goalDistance}')" 
                    style="padding: 12px; background: #fff7ed; border: 1px solid #fed7aa; border-radius: 10px; text-align: left; transition: all 0.2s; cursor: pointer;">
                    <div style="font-size: 20px; margin-bottom: 4px;">🍌</div>
                    <div style="font-weight: 700; font-size:13px; color: #9a3412;">Nutrition</div>
                    <div style="font-size: 11px; color: #fb923c;">Fueling Plan</div>
                </button>
                
                <button onclick="window.dashboardWidgets.openQuestionModal()" 
                    style="padding: 12px; background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 10px; text-align: left; transition: all 0.2s; cursor: pointer; grid-column: span 2;">
                    <div style="display:flex; align-items:center; gap:10px;">
                        <div style="font-size: 20px;">💬</div>
                        <div>
                            <div style="font-weight: 700; font-size:13px; color: #1e40af;">Ask the Coach</div>
                            <div style="font-size: 11px; color: #60a5fa;">Submit your race query</div>
                        </div>
                    </div>
                </button>
            </div>

            <div id="coach-confidence-container" style="margin-top: 15px;"></div>
        `;

        // Render Confidence Meter separately
        this.renderConfidenceMeter('coach-confidence-container');
    }

   openPacingModal(distance, timeStr) {
        const modal = document.getElementById('racePacingModal');
        if(!modal) return;

        // Parse Time
        const parts = timeStr.split(':').map(Number);
        let totalMin = (parts.length === 3) ? parts[0]*60 + parts[1] + parts[2]/60 : parts[0] + parts[1]/60;
        const distKm = parseFloat(distance) || 42.2;
        const avgPaceMinKm = totalMin / distKm;

        // Negative Split Strategy Factors
        // 0-10%: Warmup (+5-10s slower)
        // 10-60%: Cruise (Target Pace)
        // 60-90%: Push (Target -5s)
        // 90-100%: Kick (Target -10s)
        
        let html = '';
        const splits = [];
        let accumulatedTime = 0;

        // Create 5km blocks or similar
        const segments = [5, 10, 15, 20, 21.1, 25, 30, 35, 40, 42.2];
        let prevKm = 0;

        segments.forEach(km => {
            if(km > distKm && Math.abs(km - distKm) > 0.1) return;
            
            const segmentDist = km - prevKm;
            let segmentPace = avgPaceMinKm;

            // Strategy Logic
            if(prevKm < 5) segmentPace = avgPaceMinKm * 1.03; // Start slow (3% slower)
            else if(prevKm >= 30) segmentPace = avgPaceMinKm * 0.97; // Finish fast (3% faster)
            else segmentPace = avgPaceMinKm; // Even split middle

            const segmentTime = segmentDist * segmentPace;
            accumulatedTime += segmentTime;

            const paceM = Math.floor(segmentPace);
            const paceS = Math.round((segmentPace - paceM)*60);
            const paceStr = `${paceM}:${String(paceS).padStart(2,'0')}`;

            const h = Math.floor(accumulatedTime/60);
            const m = Math.floor(accumulatedTime%60);
            const totalStr = `${h}:${String(m).padStart(2,'0')}`;

            html += `
                <tr style="border-bottom:1px solid #eee;">
                    <td style="padding:10px;">${km}km</td>
                    <td style="padding:10px; font-weight:600;">${totalStr}</td>
                    <td style="padding:10px; color:#6b7280;">${paceStr}/km</td>
                    <td style="padding:10px; font-size:11px; color:${prevKm >= 30 ? '#166534' : '#374151'}">
                        ${prevKm < 5 ? 'Warm Up' : (prevKm >= 30 ? 'Push!' : 'Cruise')}
                    </td>
                </tr>
            `;
            prevKm = km;
        });

        document.getElementById('pacingTableBody').innerHTML = html;
        document.getElementById('pacingHeaderGoal').innerText = `Goal: ${timeStr} (Negative Split Strategy)`;
        modal.style.display = 'flex';
    }

    // 5. ✅ NUTRITION GUIDANCE GENERATOR (Logic-based)
    openNutritionModal(distanceStr) {
        const modal = document.getElementById('nutritionModal');
        if(!modal) return;

        const dist = parseFloat(distanceStr) || 21.1;
        // User weight/height should be in local storage or fetchable
        // Fallback to average if missing (70kg)
        let weight = 70; 
        if(this.userProfile && this.userProfile.weight) weight = this.userProfile.weight;

        // Logic
        const carbsLoad = weight * 8; // 8g per kg for loading
        const raceHourCarbs = dist > 21.1 ? "60-90g" : "30-60g";
        const water = (weight * 0.035).toFixed(1); // Liters per day baseline

        const content = `
            <div style="margin-bottom:20px;">
                <h4 style="color:#c2410c; margin-bottom:8px;">1. Carb Loading (3 Days Out)</h4>
                <p style="font-size:14px; color:#4b5563; margin-bottom:4px;">Aim for <strong>${carbsLoad}g of carbohydrates</strong> daily.</p>
                <ul style="font-size:13px; color:#6b7280; padding-left:20px;">
                    <li>Focus on simple carbs: White rice, pasta, potatoes, bread.</li>
                    <li>Reduce fiber intake to avoid GI distress.</li>
                    <li>Hydrate well: ~${water}L water daily + electrolytes.</li>
                </ul>
            </div>

            <div style="margin-bottom:20px;">
                <h4 style="color:#c2410c; margin-bottom:8px;">2. Race Morning</h4>
                <p style="font-size:14px; color:#4b5563; margin-bottom:4px;">Eat 3 hours before start.</p>
                <ul style="font-size:13px; color:#6b7280; padding-left:20px;">
                    <li>Meal: Toast with jam, banana, oatmeal (low fiber).</li>
                    <li>Avoid: High fat, high protein, high fiber.</li>
                    <li>Drink 500ml water 2 hours before. Sip lightly after.</li>
                </ul>
            </div>

            <div>
                <h4 style="color:#c2410c; margin-bottom:8px;">3. During The Race</h4>
                <p style="font-size:14px; color:#4b5563; margin-bottom:4px;">Fuel Target: <strong>${raceHourCarbs} carbs/hour</strong>.</p>
                <ul style="font-size:13px; color:#6b7280; padding-left:20px;">
                    <li>Start fueling early (after 30-45 mins).</li>
                    <li>Take gels with water, not sports drink (to avoid stomach spikes).</li>
                    <li>Don't try anything new on race day!</li>
                </ul>
            </div>
        `;

        document.getElementById('nutritionContent').innerHTML = content;
        modal.style.display = 'flex';
    }

    // 6. ✅ QUESTION MODAL
    openQuestionModal() {
        const modal = document.getElementById('questionModal');
        if(modal) modal.style.display = 'flex';
    }

    async submitRaceQuestion() {
        const input = document.getElementById('raceQuestionInput');
        const btn = document.getElementById('btnSubmitQuestion');
        const status = document.getElementById('questionStatus');
        
        if(!input || !input.value.trim()) return;

        const question = input.value.trim();
        btn.disabled = true;
        btn.innerText = "Sending...";

        try {
            const res = await fetch('/api/support/race-question', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.token}`
                },
                body: JSON.stringify({ question })
            });
            
            const d = await res.json();
            if(d.success) {
                status.innerHTML = `<span style="color:#10b981;">✅ Sent! We'll reply to your email shortly.</span>`;
                input.value = '';
                setTimeout(() => {
                    document.getElementById('questionModal').style.display = 'none';
                    status.innerHTML = '';
                    btn.disabled = false;
                    btn.innerText = "Send Question";
                }, 2000);
            } else {
                throw new Error(d.message);
            }
        } catch(e) {
            status.innerHTML = `<span style="color:#ef4444;">❌ Failed: ${e.message}</span>`;
            btn.disabled = false;
            btn.innerText = "Retry";
        }
    }

    // 7. ✅ CONFIDENCE METER (Based on last 14 days compliance)
    async renderConfidenceMeter(containerId) {
        const container = document.getElementById(containerId);
        if(!container) return;

        try {
            // Check compliance over last 2 weeks
            const res = await fetch('/api/analytics/workout-history?days=14', {
                headers: { 'Authorization': `Bearer ${this.token}` }
            });
            const d = await res.json();
            
            let confidence = 0;
            let label = "Calculating...";
            let color = "#cbd5e1";

            if(d.success && d.stats) {
                const total = d.stats.totalWorkouts || 0;
                // Simple logic: assume 4 runs/week = 8 runs expected in 2 weeks
                // Adjust this baseline based on actual plan if available
                const expected = 8; 
                const compliance = Math.min(100, (total / expected) * 100);

                if(compliance >= 90) {
                    confidence = 95; label = "High Confidence 🚀"; color = "#10b981";
                } else if(compliance >= 70) {
                    confidence = 75; label = "On Track 👍"; color = "#f59e0b";
                } else {
                    confidence = 40; label = "Needs Focus ⚠️"; color = "#ef4444";
                }
            }

            container.innerHTML = `
                <div style="background: linear-gradient(135deg, #1e1b4b 0%, #312e81 100%); padding: 15px; border-radius: 12px; color: white;">
                    <div style="display:flex; justify-content:space-between; margin-bottom:8px;">
                        <span style="font-size:12px; font-weight:600; opacity:0.9;">COACH CONFIDENCE</span>
                        <span style="font-size:12px; font-weight:700; color:${color};">${label}</span>
                    </div>
                    <div style="width:100%; height:8px; background:rgba(255,255,255,0.1); border-radius:4px; overflow:hidden;">
                        <div style="width:${confidence}%; height:100%; background:${color}; border-radius:4px; transition:width 1s ease;"></div>
                    </div>
                    <p style="margin:8px 0 0 0; font-size:11px; opacity:0.7;">Based on your recent training consistency.</p>
                </div>
            `;

        } catch(e) {
            console.error("Confidence meter error", e);
        }
    }

// ✅ FIX: Show "Recent Performance" (Last 30 Days) to differentiate from Personal Records

async renderPerformanceAnalyticsWidget(containerId) {
        const container = document.getElementById(containerId);
        if (!container) return;

        try {
            // ✅ IMPROVEMENT: Fetch 60 days to compare Current Month vs Last Month
            const response = await fetch('/api/analytics/workout-history?days=60', {
                headers: { 'Authorization': `Bearer ${this.token}` }
            });
            const data = await response.json();
            
            if(data.success && data.workouts) {
                // Split data into two 30-day buckets
                const now = new Date();
                const thirtyDaysAgo = new Date(); thirtyDaysAgo.setDate(now.getDate() - 30);
                
                const currentPeriod = data.workouts.filter(w => new Date(w.startDate) >= thirtyDaysAgo);
                const previousPeriod = data.workouts.filter(w => new Date(w.startDate) < thirtyDaysAgo);

                // Calculate Stats
                const calcStats = (workouts) => {
                    const dist = workouts.reduce((sum, w) => sum + (w.distance || 0), 0);
                    const count = workouts.length;
                    return { dist, count };
                };

                const curr = calcStats(currentPeriod);
                const prev = calcStats(previousPeriod);

                // Calculate Deltas
                const getTrend = (current, previous) => {
                    if (previous === 0) return current > 0 ? `<span style="color:#10b981;">+100%</span>` : `<span style="color:#6b7280;">-</span>`;
                    const pct = ((current - previous) / previous) * 100;
                    const color = pct >= 0 ? '#10b981' : '#ef4444'; // Green if up, Red if down
                    const arrow = pct >= 0 ? '⬆️' : '⬇️';
                    return `<span style="color:${color}; font-size:12px; font-weight:500;">${arrow} ${Math.abs(pct).toFixed(0)}%</span>`;
                };

                container.innerHTML = `
                    <div class="widget-header">
                        <h3>📊 Monthly Trends</h3>
                        <span style="font-size:11px; color:#6b7280;">vs Last 30 Days</span>
                    </div>
                    <div style="display: flex; flex-direction: column; gap: 15px;">
                        
                        <div style="display: flex; align-items: center; justify-content: space-between; padding: 12px; background: #f9fafb; border-radius: 8px;">
                            <div>
                                <div style="font-size:12px; color:#6b7280; margin-bottom:2px;">Total Distance</div>
                                <div style="font-size:18px; font-weight:700; color:#1f2937;">${curr.dist.toFixed(1)} <span style="font-size:12px; font-weight:400;">km</span></div>
                            </div>
                            <div style="text-align:right;">
                                <div style="font-size:11px; color:#9ca3af;">Previous: ${prev.dist.toFixed(1)} km</div>
                                <div>${getTrend(curr.dist, prev.dist)}</div>
                            </div>
                        </div>

                        <div style="display: flex; align-items: center; justify-content: space-between; padding: 12px; background: #f9fafb; border-radius: 8px;">
                            <div>
                                <div style="font-size:12px; color:#6b7280; margin-bottom:2px;">Workouts</div>
                                <div style="font-size:18px; font-weight:700; color:#1f2937;">${curr.count}</div>
                            </div>
                            <div style="text-align:right;">
                                <div style="font-size:11px; color:#9ca3af;">Previous: ${prev.count}</div>
                                <div>${getTrend(curr.count, prev.count)}</div>
                            </div>
                        </div>

                        <div style="padding:10px; border-left:3px solid ${curr.dist >= prev.dist ? '#10b981' : '#f59e0b'}; background:#fff; font-size:12px; color:#4b5563; line-height:1.4;">
                            ${curr.dist >= prev.dist 
                                ? "🚀 <strong>Great job!</strong> You're building volume compared to last month." 
                                : "💡 <strong>Recovery?</strong> Your volume is lower than last month."}
                        </div>
                    </div>
                `;
            }
        } catch(e) {
            console.error("Analytics Error", e);
            container.innerHTML = `<p style="color:#999; font-style:italic; padding:20px;">Analytics unavailable.</p>`;
        }
    }

    // Add to dashboard-race-widgets.js

async renderReadinessChart(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    container.innerHTML = `
        <div class="widget-header">
            <h3>🔋 Race Readiness (Taper Monitor)</h3>
            <span style="font-size:11px; color:#6b7280;">Based on Bannister Model</span>
        </div>
        <div style="height: 200px; display:flex; align-items:center; justify-content:center;">
            <div class="loading-spinner"></div>
        </div>`;

    try {
        // Fetch long history (42 days needed for CTL, but 60 is safer)
        const response = await fetch('/api/analytics/workout-history?days=60', {
            headers: { 'Authorization': `Bearer ${this.token}` }
        });
        const data = await response.json();

        if (!data.success || !data.workouts || data.workouts.length < 5) {
            container.innerHTML = `<div class="widget empty-state-widget"><p>Need more history to calculate readiness.</p></div>`;
            return;
        }

        // 1. Calculate Daily TRIMP (Stress Score)
        // Elevate uses Heart Rate Reserve, but we will use a simplified Pace/HR estimate 
        // to be compatible with your current data structure.
        const dailyLoad = new Map();
        
        data.workouts.forEach(w => {
            const dateStr = new Date(w.startDate).toDateString();
            // Estimate Stress (TRIMP): Duration * Intensity Factor
            // Simple proxy: Duration (mins) * (AvgHR / MaxHR estimate) 
            // If no HR, we assume moderate intensity (0.75)
            const hr = w.averageHeartrate || 140; 
            const maxHr = 190; // Default if not in user profile
            const intensity = hr / maxHr;
            const duration = (w.movingTime || w.duration || 0);
            
            // Non-linear stress (running faster is exponentially harder)
            const stress = duration * Math.exp(1.92 * intensity); 
            
            const current = dailyLoad.get(dateStr) || 0;
            dailyLoad.set(dateStr, current + stress);
        });

        // 2. Calculate CTL (Fitness) and ATL (Fatigue) day by day
        // CTL = 42-day rolling avg (exponential), ATL = 7-day rolling avg
        const today = new Date();
        const chartData = [];
        let ctl = 0; // Fitness
        let atl = 0; // Fatigue
        
        // Loop through last 45 days up to today
        for (let i = 45; i >= 0; i--) {
            const d = new Date();
            d.setDate(today.getDate() - i);
            const dateStr = d.toDateString();
            const dayLoad = dailyLoad.get(dateStr) || 0;

            // Decay constants (standard PMC values)
            // CTL decay = e^(-1/42), ATL decay = e^(-1/7)
            ctl = (dayLoad * (1 - Math.exp(-1/42))) + (ctl * Math.exp(-1/42));
            atl = (dayLoad * (1 - Math.exp(-1/7))) + (atl * Math.exp(-1/7));
            
            const tsb = ctl - atl; // Form (Readiness)

            chartData.push({
                date: d.toLocaleDateString(undefined, {month:'short', day:'numeric'}),
                tsb: Math.round(tsb),
                isProjected: i < 0 // Can calculate future if we had planned workouts
            });
        }

        // 3. Render Chart
        const recentData = chartData.slice(-14); // Show last 2 weeks
        const maxTsb = Math.max(...recentData.map(d => d.tsb), 10);
        const minTsb = Math.min(...recentData.map(d => d.tsb), -10);
        
        const barsHtml = recentData.map(d => {
            // TSB > 0 = Fresh/Ready (Green), TSB < 0 = Tired (Red/Orange)
            const color = d.tsb >= 0 ? '#10b981' : '#f59e0b';
            const heightPct = Math.abs(d.tsb) / Math.max(Math.abs(maxTsb), Math.abs(minTsb)) * 50; 
            
            // Position relative to center line
            const style = d.tsb >= 0 
                ? `bottom: 50%; height: ${heightPct}%;` 
                : `top: 50%; height: ${heightPct}%;`;

            return `
                <div style="display:flex; flex-direction:column; align-items:center; flex:1; gap:2px; height:100%; position:relative;" 
                     title="${d.date}: Readiness ${d.tsb} (Fitness ${Math.round(ctl)} - Fatigue ${Math.round(atl)})">
                    <div style="width:6px; background:${color}; opacity:0.8; border-radius:2px; position:absolute; ${style}"></div>
                </div>`;
        }).join('');

        const currentReadiness = recentData[recentData.length-1].tsb;
        let statusText = "";
        if (currentReadiness > 20) statusText = "⚡ Peak Performance (Tapered)";
        else if (currentReadiness > 0) statusText = "✅ Fresh & Ready";
        else if (currentReadiness > -10) statusText = "🏗️ Productive Training";
        else statusText = "⚠️ High Fatigue (Need Rest)";

        container.innerHTML = `
            <div class="widget-header">
                <h3>🔋 Race Readiness</h3>
                <div style="text-align:right;">
                    <div style="font-size:18px; font-weight:700; color:${currentReadiness >= 0 ? '#10b981' : '#f59e0b'};">
                        ${currentReadiness > 0 ? '+' : ''}${currentReadiness}
                    </div>
                    <div style="font-size:10px; color:#6b7280;">Form Score</div>
                </div>
            </div>
            
            <div style="height: 120px; position:relative; border-bottom: 1px solid #e5e7eb; margin: 10px 0;">
                <div style="position:absolute; top:50%; left:0; right:0; border-top:1px dashed #d1d5db; z-index:0;"></div>
                
                <div style="display: flex; justify-content: space-between; gap: 4px; height: 100%; padding:0 5px; z-index:1;">
                    ${barsHtml}
                </div>
            </div>
            
            <div style="display:flex; justify-content:space-between; margin-top:5px; font-size:10px; color:#9ca3af;">
                <span>${recentData[0].date}</span>
                <span>Today</span>
            </div>

            <div style="margin-top:10px; padding:8px; background:${currentReadiness >= 0 ? '#ecfdf5' : '#fffbeb'}; border-radius:6px; font-size:12px; color:#374151; text-align:center;">
                <strong>${statusText}</strong>
            </div>
        `;

    } catch (e) {
        console.error("Readiness Chart Error", e);
        container.innerHTML = `<p style="color:red; padding:20px;">Could not calc readiness.</p>`;
    }
}


}

// ==========================================
// PREFERENCES & SETTINGS MODAL
// ==========================================

// 1. Function to render the Settings Modal for Long Run Day
window.openPreferencesModal = function() {
    // Check if modal exists, if not create it dynamically
    if (!document.getElementById('preferences-modal')) {
        const modalHtml = `
        <div id="preferences-modal" class="modal" style="display:none; align-items:center; justify-content:center;">
            <div class="modal-content" style="max-width: 400px; width:90%;">
                <span class="modal-close" onclick="closePreferencesModal()" style="float:right; cursor:pointer; font-size:24px;">&times;</span>
                <h3 style="margin-top:0;">Training Preferences</h3>
                <div style="margin-top: 20px;">
                    <label style="font-weight: 600; color: #374151; display: block; margin-bottom: 8px;">Long Run Day</label>
                    <p style="font-size: 13px; color: #6b7280; margin-bottom: 12px;">Choose which day you have the most time for your longest run. Your schedule will be automatically adjusted.</p>
                    <select id="long-run-day-select" style="width: 100%; padding: 10px; border-radius: 8px; border: 1px solid #d1d5db; font-size:16px;">
                        <option value="Monday">Monday</option>
                        <option value="Tuesday">Tuesday</option>
                        <option value="Wednesday">Wednesday</option>
                        <option value="Thursday">Thursday</option>
                        <option value="Friday">Friday</option>
                        <option value="Saturday">Saturday</option>
                        <option value="Sunday">Sunday</option>
                    </select>
                </div>
                <button id="btn-save-prefs" onclick="savePreferences()" class="btn-primary" style="width: 100%; margin-top: 24px;">Save Changes</button>
            </div>
        </div>`;
        document.body.insertAdjacentHTML('beforeend', modalHtml);
    }
    
    // Load current preference (default Saturday, or check local storage)
    const currentPref = localStorage.getItem('longRunDay') || 'Saturday';
    document.getElementById('long-run-day-select').value = currentPref;
    
    document.getElementById('preferences-modal').style.display = 'flex';
};

window.closePreferencesModal = function() {
    const modal = document.getElementById('preferences-modal');
    if (modal) modal.style.display = 'none';
};

window.savePreferences = async function() {
    const day = document.getElementById('long-run-day-select').value;
    const token = localStorage.getItem('userToken');
    // Using ID selector is safer if you added IDs to your buttons
    const saveBtn = document.querySelector('#preferences-modal button.btn-primary') || document.querySelector('#preferences-modal button');
    
    // Check if elements exist
    if (!saveBtn || !document.getElementById('preferences-modal')) {
        console.error("Modal elements missing");
        return;
    }

    // UI Loading State
    const originalText = saveBtn.innerText;
    saveBtn.innerText = 'Updating Plan...';
    saveBtn.disabled = true;

    try {
        const response = await fetch('/api/training-plan/update-preferences', {
             method: 'POST',
             headers: { 
                 'Authorization': `Bearer ${token}`, 
                 'Content-Type': 'application/json' 
             },
             body: JSON.stringify({ longRunDay: day })
        });

        const data = await response.json();

        if (data.success) {
            // Update Local Storage
            localStorage.setItem('longRunDay', day);
            
            // Close Modal
            if (typeof closePreferencesModal === 'function') {
                closePreferencesModal();
            } else {
                 document.getElementById('preferences-modal').style.display = 'none';
            }
            
            // Notification
            if (typeof showNotification === 'function') {
                showNotification(`Plan updated! Long runs are now on ${day}s.`, 'success');
            } else {
                alert(`Plan updated! Long runs are now on ${day}s.`);
            }
            
            // --- ENHANCED REFRESH LOGIC ---
            // Instead of just reloading, try to refresh specific widgets for a smoother experience
            let refreshed = false;
            
            if (window.dashboardWidgets) {
                console.log("🔄 Triggering widget refresh...");
                try {
                    // Refresh Weekly Plan (Desktop)
                    if(typeof window.dashboardWidgets.renderWeeklyPlanWidget === 'function') {
                        await window.dashboardWidgets.renderWeeklyPlanWidget('race-weekly-plan-container');
                    }
                    
                    // Refresh This Week/Calendar (Mobile/Dashboard)
                    if(typeof window.dashboardWidgets.renderTrainingCalendar === 'function') {
                        // Clear any internal cache if your calendar uses one
                        window.dashboardWidgets.calendarCache = null; 
                        await window.dashboardWidgets.renderTrainingCalendar('training-calendar-container');
                    }
                    
                    // Refresh Today's Workout (in case the shift affected today)
                    if(typeof window.dashboardWidgets.renderDailyWorkoutWidget === 'function') {
                        await window.dashboardWidgets.renderDailyWorkoutWidget('daily-workout-container');
                    }
                    
                    refreshed = true;
                } catch(e) {
                    console.warn("Widget refresh partial failure", e);
                }
            }

            // Fallback: If we couldn't refresh widgets dynamically, reload page
            if (!refreshed) {
                setTimeout(() => window.location.reload(), 1000); 
            }
            
        } else {
            throw new Error(data.message || 'Update failed');
        }
        
    } catch (error) {
        console.error('Failed to save preferences', error);
        if (typeof showNotification === 'function') {
            showNotification(error.message, 'error');
        } else {
            alert("Error: " + error.message);
        }
        
        // Reset button
        saveBtn.innerText = originalText;
        saveBtn.disabled = false;
    }
};


// ==========================================
// SKIP WORKOUT FUNCTIONALITY
// ==========================================

window.skipWorkout = async function(date, workoutId) {
    if(!confirm("Skip this workout? It will be marked as 'Skipped' and won't count towards your completion stats.")) return;
    
    const token = localStorage.getItem('userToken');
    try {
        // Call API to mark as skipped (using your modify-workout endpoint or a new one)
        // We'll use a simple status update endpoint if you have one, or the modify endpoint
        const response = await fetch(`/api/workouts/${workoutId}/status`, {
            method: 'PATCH', // or POST depending on your API
            headers: { 
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ status: 'skipped', skippedReason: 'User requested skip' })
        });
        
        const data = await response.json();
        
        if (data.success) {
            if (typeof showNotification === 'function') {
                showNotification('Workout skipped.', 'success');
            }
            // Reload just the weekly widget if possible, or page
            window.location.reload();
        } else {
            throw new Error(data.message || 'Failed to skip');
        }
    } catch (e) {
        console.error(e);
        if (typeof showNotification === 'function') {
             showNotification('Error skipping workout', 'error');
        } else {
             alert('Error skipping workout');
        }
    }
};

// ==========================================
// WORKOUT MODAL LOGIC (Global Scope)
// ==========================================

window.openWorkoutModal = async function(workoutId) {
    if (!workoutId || workoutId === 'undefined') return;

    // 1. Create Modal if it doesn't exist
    if (!document.getElementById('workout-detail-modal')) {
        const modalHtml = `
        <div id="workout-detail-modal" class="modal" style="display:none; align-items:center; justify-content:center; position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.5); z-index:10000;">
            <div class="modal-content" style="background:white; padding:25px; border-radius:12px; max-width: 500px; width:90%; position:relative; box-shadow:0 10px 25px rgba(0,0,0,0.2);">
                <span class="modal-close" onclick="closeWorkoutModal()" style="position:absolute; right:20px; top:15px; cursor:pointer; font-size:28px; color:#9ca3af;">&times;</span>
                <div id="workout-modal-body" style="min-height:150px;">
                    <div class="loading-spinner"></div> Loading details...
                </div>
            </div>
        </div>`;
        document.body.insertAdjacentHTML('beforeend', modalHtml);
    }

    // 2. Show Modal & Loading State
    const modal = document.getElementById('workout-detail-modal');
    const body = document.getElementById('workout-modal-body');
    modal.style.display = 'flex';
    body.innerHTML = '<div style="display:flex; justify-content:center; padding:40px;"><div class="loading-spinner"></div></div>';

    if (String(workoutId).startsWith('json-week-')) {
    body.innerHTML = `
      <div style="padding:16px; color:#374151;">
        <p style="margin:0 0 10px 0;"><strong>This workout isn’t saved yet.</strong></p>
        <p style="margin:0; font-size:14px; color:#6b7280;">
          Go to Current Week once (so workouts get written to DB), then refresh and try again.
        </p>
      </div>
    `;
    return;
  }

    try {
        // 3. Fetch Workout Details
        const token = localStorage.getItem('userToken');
        // NOTE: Ensure you have an endpoint GET /api/workouts/:id
        // If not, you might need to pass the full workout object directly to this function instead of ID
        const res = await fetch(`/api/workouts/${workoutId}`, {
             headers: { 'Authorization': `Bearer ${token}` }
        });
        
        const data = await res.json();
        
        if(!data.success) throw new Error("Could not fetch workout");
        const w = data.workout || data.data; // Handle different API response structures

        // 4. Render Content
        // Map types to friendly names
        const typeLabels = {
            'long_run': 'Long Run',
            'easy_run': 'Easy Run',
            'interval': 'Intervals',
            'tempo': 'Tempo Run',
            'recovery_run': 'Recovery'
        };
        const friendlyType = typeLabels[w.type] || w.type;
        
        // Color coding badges
        let badgeColor = '#3b82f6'; // blue
        if(w.type === 'long_run') badgeColor = '#8b5cf6'; // purple
        if(w.type === 'interval') badgeColor = '#f97316'; // orange

        body.innerHTML = `
            <h2 style="margin-top:0; margin-bottom:12px; color:#111827; font-size:20px;">${w.title}</h2>
            
            <div style="display:flex; align-items:center; gap:10px; margin-bottom:20px;">
                <span style="background:${badgeColor}20; color:${badgeColor}; padding:4px 10px; border-radius:20px; font-size:12px; font-weight:700; text-transform:uppercase;">${friendlyType}</span>
                <span style="color:#4b5563; font-weight:600; font-size:14px;">
                    ${w.distance ? w.distance + ' km' : w.duration + ' min'}
                </span>
            </div>
            
            <div style="background:#f9fafb; padding:16px; border-radius:10px; border:1px solid #e5e7eb; margin-bottom:20px;">
                <h4 style="margin:0 0 8px 0; color:#374151; font-size:13px; text-transform:uppercase;">Instructions</h4>
                <p style="margin:0; font-size:15px; line-height:1.6; color:#1f2937;">
                    ${w.description || "No specific instructions for this workout."}
                </p>
            </div>

            ${w.targetPace ? `
            <div style="margin-bottom:24px; padding:12px; border-left:4px solid ${badgeColor}; background:#fff;">
                <strong style="color:#374151;">Target Pace:</strong> 
                <span style="color:#111827; font-family:monospace; font-size:15px;">${w.targetPace}/km</span>
            </div>` : ''}

            ${w.hr_zone ? `
            <div style="margin-bottom:24px; padding:12px; background:#fef2f2; border-left:4px solid #ef4444; border-radius:4px;">
                <div style="display:flex; align-items:center; margin-bottom:4px;">
                    <strong style="color:#991b1b; margin-right:6px;">❤️ Target Zone:</strong> 
                    <span style="color:#b91c1c; font-weight:700;">${w.hr_zone}</span>
                </div>
                ${w.hr_target ? `<div style="color:#7f1d1d; font-size:13px; margin-left:2px;">Target Range: <strong>${w.hr_target}</strong></div>` : ''}
            </div>` : ''}

            <div style="display:flex; gap:12px;">
                <button onclick="skipWorkout(null, '${w.id}')" style="flex:1; padding:12px; border:1px solid #ef4444; color:#ef4444; background:white; border-radius:8px; cursor:pointer; font-weight:600; transition:all 0.2s;">
                    Skip Workout
                </button>
                <button onclick="closeWorkoutModal()" style="flex:1; padding:12px; background:#1f2937; color:white; border:none; border-radius:8px; cursor:pointer; font-weight:600;">
                    Close
                </button>
            </div>
        `;

    } catch (error) {
        console.error("Modal Error", error);
        body.innerHTML = `
            <div style="text-align:center; padding:20px;">
                <p style="color:#ef4444; margin-bottom:15px;">Failed to load workout details.</p>
                <button onclick="closeWorkoutModal()" style="padding:8px 16px; background:#e5e7eb; border:none; border-radius:6px; cursor:pointer;">Close</button>
            </div>
        `;
    }

    
};

window.closeWorkoutModal = function() {
    const modal = document.getElementById('workout-detail-modal');
    if (modal) modal.style.display = 'none';
};




// Auto-init
document.addEventListener('DOMContentLoaded', () => {
  window.dashboardWidgets = new RaceDashboardWidgets();

  window.dashboardWidgets.init();
});

