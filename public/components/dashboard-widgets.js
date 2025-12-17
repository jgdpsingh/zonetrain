// ZoneTrain Dashboard Widgets
class DashboardWidgets {
    constructor() {
        this.token = localStorage.getItem('userToken');
        this.userLocation = JSON.parse(localStorage.getItem('userLocation') || '{}');
    }

    init() {
        console.log('Initializing Dashboard Widgets...');
        // Call your render methods here
        this.renderWeatherWidget('weather-widget');
        this.renderTodayWorkoutWidget('today-workout-container');
        this.renderWeeklyPlanWidget('weekly-plan-container');
        // Any other startup logic
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

    // Weekly Plan Widget
  // In dashboard-widgets.js

// In dashboard-widgets.js

async renderWeeklyPlanWidget(containerId, planKnownToExist = false) {
    const container = document.getElementById(containerId);
    if (!container) return;

    try {
        const response = await fetch('/api/training/weekly-plan', {
            headers: { 'Authorization': `Bearer ${this.token}` }
        });

        const data = await response.json();
        console.log('Weekly Plan API Response:', JSON.stringify(data));

        // Case 1: Plan and weekly workouts both exist
        if (data.success && data.weeklyPlan) {
            console.log('✅ Plan and workouts found. Rendering weekly schedule.');

            // --- FIX START: Convert Array to Map ---
            let planMap = {};

            // Check if it's the new format: { days: [ ... ] }
            if (data.weeklyPlan.days && Array.isArray(data.weeklyPlan.days)) {
                data.weeklyPlan.days.forEach(day => {
                    // Use 'label' (e.g. "Monday") as the key
                    if (day.label) {
                        planMap[day.label] = day;
                    }
                });
            } 
            // Check if it's the old format: { "Monday": ... }
            else if (Object.keys(data.weeklyPlan).length > 0) {
                planMap = data.weeklyPlan;
            }
            // --- FIX END ---

            // Only render if we actually have days to show
            if (Object.keys(planMap).length > 0) {
                container.innerHTML = this.weeklyPlanTemplate(planMap);
                this.attachWeeklyPlanListeners();
                return; // Exit here, we are done
            }
        }
        
        // Case 2: A plan exists, but it has no workouts for this week yet.
        if ((data.success && data.plan) || planKnownToExist) {
            console.log('✅ Plan exists, but no workouts are scheduled for this week yet.');
            container.innerHTML = `
                <div class="card" style="height: 100%; min-height: 250px; display: flex; align-items: center; justify-content: center;">
                    <div class="widget-empty-state" style="text-align: center; padding: 30px;">
                        <div style="font-size: 40px; margin-bottom: 15px;">🎉</div>
                        <h3 style="margin: 0 0 8px 0; color: #1f2937; font-size: 18px;">Your Plan is Ready!</h3>
                        <p style="margin: 0; font-size: 14px; color: #6b7280;">
                            Workouts for your first week are being generated and will appear here shortly.
                        </p>
                    </div>
                </div>
            `;
        } 
        // Case 3: No plan exists at all.
        else {
            console.log('No active plan found from API - showing original setup button.'); 
            container.innerHTML = `
                <div class="card" style="height: 100%; min-height: 250px; display: flex; align-items: center; justify-content: center;">
                    <div class="widget-empty-state" style="text-align: center; padding: 30px; color: #6b7280;">
                        <div style="font-size: 40px; margin-bottom: 15px;">📅</div>
                        <h3 style="margin: 0 0 8px 0; color: #1f2937; font-size: 18px;">No Active Plan</h3>
                        <p style="margin: 0 0 20px 0; font-size: 14px; color: #6b7280;">
                            You haven't set up a training schedule yet.
                        </p>
                        <button onclick="window.location.href='/ai-onboarding-basic.html'" style="
                            padding: 10px 24px;
                            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                            color: white; border: none; border-radius: 8px; font-weight: 600;
                            font-size: 14px; cursor: pointer; box-shadow: 0 4px 6px rgba(0,0,0,0.1);
                            transition: transform 0.2s ease;
                        " onmouseover="this.style.transform='translateY(-2px)'" 
                           onmouseout="this.style.transform='translateY(0)'">
                            Create Your Plan
                        </button>
                    </div>
                </div>
            `;
        }
    } catch (error) {
        console.error('Weekly plan error:', error);
        container.innerHTML = this.errorTemplate('Failed to load weekly plan');
    }
}


    // Today's Workout Widget
    async renderTodayWorkoutWidget(containerId) {
        const container = document.getElementById(containerId);
        if (!container) return;

        try {
            const hrv = localStorage.getItem('todayHRV') || '';
            const response = await fetch(`/api/training/today-workout?hrv=${hrv}`, {
                headers: { 'Authorization': `Bearer ${this.token}` }
            });

            const data = await response.json();
            if (data.success) {
                container.innerHTML = this.todayWorkoutTemplate(data);
                this.attachWorkoutListeners();
            }
        } catch (error) {
            console.error('Today workout error:', error);
            container.innerHTML = this.errorTemplate('Failed to load workout');
        }
    }

    // Templates
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


   weeklyPlanTemplate(planMap) {
    // 1. Define standard week order
    const daysOfWeek = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    
    // 2. Generate HTML by iterating through daysOfWeek
    const daysHTML = daysOfWeek.map(dayName => {
        // Safe access: Get the day object if it exists
        const day = planMap[dayName]; 
        
        // Handle missing days (e.g. if map is partial)
        if (!day) {
            return `
                <div class="week-day empty">
                    <div class="day-name">${dayName.substring(0, 3)}</div>
                    <div class="workout-type">-</div>
                </div>
            `;
        }
        
        // Safe variable access
        const isToday = day.isToday || false;
        const isCompleted = day.completed || false;
        const workoutName = (day.workout && (day.workout.title || day.workout.name)) || 'Rest';
        const duration = (day.workout && day.workout.duration) ? `${day.workout.duration}m` : '-';
        
        return `
            <div class="week-day ${isToday ? 'today' : ''} ${isCompleted ? 'completed' : ''}" 
                 data-date="${day.date || ''}">
                <div class="day-name">${dayName.substring(0, 3)}</div>
                <div class="workout-type">${workoutName}</div>
                <div class="workout-duration">${duration}</div>
                ${isToday ? '<div class="today-badge">Today</div>' : ''}
            </div>
        `;
    }).join('');

    return `
        <div class="widget weekly-plan-widget">
            <div class="widget-header">
                <h3>📅 This Week's Plan</h3>
                <button class="btn-view-details" onclick="window.dashboardWidgets.showWeeklyDetails()">
                    View Details →
                </button>
            </div>
            <div class="weekly-grid">
                ${daysHTML}
            </div>
        </div>

        <!-- Modal for detailed weekly view -->
        <div id="weekly-modal" class="modal" style="display: none;">
            <div class="modal-content">
                <span class="modal-close" onclick="window.dashboardWidgets.closeModal()">&times;</span>
                <h2>📅 Detailed Weekly Plan</h2>
                <p class="modal-subtitle">HRV-adaptive schedule • Adjusts daily based on recovery</p>
                <div id="weekly-details-content"></div>
            </div>
        </div>
    `;
}

closeModal() {
        const modal = document.getElementById('weekly-modal');
        if (modal) modal.style.display = 'none';
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

    // 3. DEFINE HRV COLORS
    const hrvColors = {
        low: '#ef4444',     // Red
        normal: '#10b981',  // Green
        high: '#3b82f6',    // Blue
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
    const recommendation = data.recommendation || 'Good to go!';

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

                    <button class="btn-complete" onclick="window.dashboardWidgets.markComplete('${workoutDetails.id}')" 
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
        const res = await fetch('/api/workouts/complete', {
            method: 'POST',
            headers: { 
                'Authorization': `Bearer ${this.token}`,
                'Content-Type': 'application/json' 
            },
            body: JSON.stringify({ workoutId })
        });
        
        if (res.ok) {
            // Re-render to show updated status
            this.renderTodayWorkoutWidget('today-workout-container');
            this.renderWeeklyPlanWidget('weekly-plan-container');
            alert('Great job! Workout marked as complete.');
        }
    } catch (e) {
        alert('Failed to update workout.');
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

    async showWeeklyDetails() {
    const modal = document.getElementById('weekly-modal');
    const content = document.getElementById('weekly-details-content');
    
    try {
        const response = await fetch('/api/training/weekly-plan', {
            headers: { 'Authorization': `Bearer ${this.token}` }
        });

        const data = await response.json();
        if (data.success) {
            // 1. ROBUST MAP CONVERSION (Use same logic as Widget)
            let planMap = {};
            if (data.weeklyPlan.days && Array.isArray(data.weeklyPlan.days)) {
                data.weeklyPlan.days.forEach(d => { if(d.label) planMap[d.label] = d; });
            } else {
                planMap = data.weeklyPlan;
            }

            // 2. Render using the MAP
            content.innerHTML = this.detailedWeeklyTemplate(planMap);
            modal.style.display = 'flex';
        }
    } catch (error) {
        console.error(error);
        content.innerHTML = '<p class="error">Failed to load details.</p>';
    }
}

detailedWeeklyTemplate(planMap) {
    const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

    const itemsHTML = days.map(dayName => {
        const day = planMap[dayName];
        if (!day) return ''; // Skip empty days

        // Safe Accessors
        const workout = day.workout || {};
        const title = workout.title || workout.name || 'Rest';
        const dateStr = day.date ? new Date(day.date).toLocaleDateString() : '';
        
        return `
            <div class="detailed-day ${day.isToday ? 'today' : ''}" style="margin-bottom: 20px; padding-bottom: 20px; border-bottom: 1px solid #eee;">
                <div class="day-header" style="margin-bottom: 10px;">
                    <h3 style="margin: 0; font-size: 16px;">${dayName} <span style="font-weight: normal; color: #666; font-size: 14px;">${dateStr}</span></h3>
                    ${day.isToday ? '<span class="today-badge" style="background: #e0f2fe; color: #0284c7; padding: 2px 8px; border-radius: 12px; font-size: 12px; font-weight: bold;">Today</span>' : ''}
                </div>
                <div class="day-workout" style="background: #f9fafb; padding: 15px; border-radius: 8px;">
                    <h4 style="margin: 0 0 8px 0; color: #111;">${title}</h4>
                    
                    <div style="font-size: 14px; color: #444; margin-bottom: 8px;">
                        <strong>Duration:</strong> ${workout.duration || 0} min 
                        <span style="margin: 0 8px; color: #ddd;">|</span>
                        <strong>Intensity:</strong> ${workout.intensity || '-'}
                    </div>

                    ${workout.distance ? `<p style="margin: 0 0 8px 0; font-size: 14px;"><strong>Distance:</strong> ${workout.distance}</p>` : ''}
                    
                    <p class="description" style="margin: 0; font-size: 14px; color: #666; line-height: 1.5;">
                        ${workout.description || 'No description provided.'}
                    </p>
                    
                    ${workout.zones && workout.zones.length > 0 ? `
                        <div style="margin-top: 10px; font-size: 13px; color: #0284c7;">
                            <strong>Zones:</strong> ${workout.zones.join(', ')}
                        </div>
                    ` : ''}
                </div>
            </div>
        `;
    }).join('');

    // ADD MOBILE CLOSE BUTTON AT THE BOTTOM
    return itemsHTML + `
        <button onclick="window.dashboardWidgets.closeModal()" 
                style="display: block; width: 100%; margin-top: 20px; padding: 12px; background: #f3f4f6; border: none; border-radius: 8px; font-weight: bold; color: #374151; cursor: pointer;">
            Close
        </button>
    `;
}


  // In dashboard-widgets.js class DashboardWidgets { ...

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


    attachWeeklyPlanListeners() {
        // Add any click handlers for week days
    }

    attachWorkoutListeners() {
        // Add any workout-specific handlers
    }

    errorTemplate(message) {
        return `
            <div class="widget error-widget">
                <p style="color: #ef4444;">❌ ${message}</p>
            </div>
        `;
    }

    // Add to your existing DashboardWidgets class

// ==================== STRAVA ANALYTICS WIDGETS ====================

// Workout History Widget (from Strava)
async renderStravaWorkoutHistory(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    container.innerHTML = '<div class="loading">Loading workout history...</div>';

    try {
        const response = await fetch('/api/analytics/workout-history?days=30', {
            headers: { 'Authorization': `Bearer ${this.token}` }
        });

        const data = await response.json();

        if (!data.success || data.workouts.length === 0) {
            container.innerHTML = `
                <div class="widget empty-state-widget">
                    <p>🏃‍♂️ No workouts found</p>
                    <p style="font-size: 14px; color: #666; margin-top: 8px;">
                        ${data.source === 'strava' ? 'Connect Strava to see your workout history' : 'Sync your Strava activities'}
                    </p>
                    <button onclick="window.location.href='/auth/strava'" class="btn-primary" style="margin-top: 15px;">
                        Connect Strava
                    </button>
                </div>
            `;
            return;
        }

        const { workouts, stats } = data;

        container.innerHTML = `
            <div class="widget workout-history-widget">
                <div class="widget-header">
                    <h3>📊 Workout History (Last 30 Days)</h3>
                    <button onclick="window.dashboardWidgets.syncStrava()" class="btn-sync" title="Sync Strava">
                        🔄
                    </button>
                </div>
                
                <div class="stats-summary">
                    <div class="stat-card">
                        <div class="stat-value">${stats.totalWorkouts}</div>
                        <div class="stat-label">Workouts</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-value">${stats.totalDistance.toFixed(1)}</div>
                        <div class="stat-label">km</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-value">${Math.round(stats.totalDuration)}</div>
                        <div class="stat-label">minutes</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-value">${stats.averagePace || 'N/A'}</div>
                        <div class="stat-label">min/km</div>
                    </div>
                </div>

                <div class="trend-indicator trend-${stats.progressTrend}">
                    ${stats.progressTrend === 'improving' ? '📈 Improving trend' : 
                      stats.progressTrend === 'declining' ? '📉 Volume decreasing' : 
                      '➡️ Maintaining consistency'}
                </div>

                <div class="workout-list">
                    ${workouts.slice(0, 5).map(w => `
                        <div class="workout-item">
                            <div class="workout-icon">${this.getWorkoutIcon(w.type)}</div>
                            <div class="workout-info">
                                <div class="workout-name">${w.name || w.type}</div>
                                <div class="workout-meta">
                                    ${new Date(w.startDate).toLocaleDateString()} • 
                                    ${w.distance.toFixed(2)} km • 
                                    ${Math.round(w.movingTime)} min
                                </div>
                            </div>
                            ${w.averageHeartrate ? `
                                <div class="workout-hr">
                                    <span title="Average Heart Rate">❤️ ${Math.round(w.averageHeartrate)}</span>
                                </div>
                            ` : ''}
                        </div>
                    `).join('')}
                </div>

                <div class="widget-footer">
                    <small>Data from Strava • Last synced: ${data.lastSync ? new Date(data.lastSync).toLocaleTimeString() : 'Just now'}</small>
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

// Progress Chart Widget
async renderProgressChart(containerId, metric = 'distance') {
    const container = document.getElementById(containerId);
    if (!container) return;

    container.innerHTML = '<div class="loading">Loading progress chart...</div>';

    try {
        const response = await fetch(`/api/analytics/progress-chart?metric=${metric}&days=90`, {
            headers: { 'Authorization': `Bearer ${this.token}` }
        });

        const data = await response.json();

        if (!data.success || data.data.length === 0) {
            container.innerHTML = `
                <div class="widget empty-state-widget">
                    <p>📈 No data available for chart</p>
                    <p style="font-size: 14px; color: #666; margin-top: 8px;">
                        Complete more workouts to see your progress
                    </p>
                </div>
            `;
            return;
        }

        container.innerHTML = this.renderSimpleBarChart(data.data, metric);
    } catch (error) {
        console.error('Render chart error:', error);
        container.innerHTML = '<div class="widget error-widget">Failed to load chart</div>';
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

// Personal Records Widget
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

// Training Plan Overview Widget
async renderTrainingPlanOverview(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    container.innerHTML = '<div class="loading">Loading training plan...</div>';

    try {
        const response = await fetch('/api/training-plan/current', {
            headers: { 'Authorization': `Bearer ${this.token}` }
        });

        const data = await response.json();

        if (!data.success || !data.plan) {
            container.innerHTML = `
                <div class="widget empty-state-widget">
                    <p>📅 No active training plan</p>
                    <p style="font-size: 14px; color: #666; margin-top: 8px;">
                        Create a personalized plan to reach your goals
                    </p>
                    <button onclick="window.location.href='/ai-onboarding'" class="btn-primary" style="margin-top: 15px;">
                        Create Training Plan
                    </button>
                </div>
            `;
            return;
        }

        const { plan } = data;

        container.innerHTML = `
            <div class="widget training-plan-widget">
                <div class="widget-header">
                    <h3>📅 This Week's Training</h3>
                </div>
                
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
                    <button onclick="window.location.href='/calendar'" class="btn-secondary">
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

// Sync Strava activities
async syncStrava() {
    try {
        const button = event.target;
        button.innerHTML = '⏳';
        button.disabled = true;

        const response = await fetch('/api/strava/sync', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${this.token}` }
        });

        const data = await response.json();

        if (data.success) {
            alert(`✅ Synced ${data.count} activities from Strava!`);
            // Refresh the workout history widget
            this.renderStravaWorkoutHistory('workout-history-container');
        } else {
            alert('❌ Failed to sync Strava: ' + data.message);
        }

        button.innerHTML = '🔄';
        button.disabled = false;
    } catch (error) {
        console.error('Sync error:', error);
        alert('❌ Failed to sync Strava');
        event.target.innerHTML = '🔄';
        event.target.disabled = false;
    }
}

}


// Initialize on page load
// At the very bottom of the file
document.addEventListener('DOMContentLoaded', () => {
    window.dashboardWidgets = new DashboardWidgets();
    window.dashboardWidgets.init();
});

