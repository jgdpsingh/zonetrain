// dashboard-race-widgets.js

class RaceDashboardWidgets {
    constructor() {
        this.token = localStorage.getItem('userToken');
        this.userLocation = JSON.parse(localStorage.getItem('userLocation') || '{}');
    }

    init() {
        console.log('🏎️ Initializing RACE Dashboard Widgets...');
        
        // Check for Login Notifications (moved from HTML)
        this.checkLoginNotifications();

        this.renderWeatherWidget('weather-widget-container');
  this.renderTodayWorkoutWidget('today-workout-container');
  this.renderStravaWorkoutHistory('workout-history-container');
  this.renderProgressChart('progress-chart-container', 'distance');
  this.renderPersonalRecords('personal-records-container');
  this.renderTrainingPlanOverview('training-plan-container', 'race');

        // Render Widgets
        this.renderRaceCountdown('race-countdown-widget'); 
        this.renderWeeklyPlanWidget('weekly-plan-container');
        this.renderPerformanceChart('performance-chart-container');
        
        // Subscription & Downgrade Logic
        this.loadSubscriptionDetails();
        this.setupDowngradeListeners();
        this.setupPauseResumeListeners(); // Added this since you had pause logic
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

        try {
            const response = await fetch('/api/race/weekly-plan', {
                headers: { 'Authorization': `Bearer ${this.token}` }
            });
            const data = await response.json();

            if (data.success && data.weeklyPlan) {
                console.log('✅ Plan found. Rendering RACE weekly schedule.');

                // --- CONVERSION LOGIC START ---
                let planMap = {};
                if (data.weeklyPlan.days && Array.isArray(data.weeklyPlan.days)) {
                    data.weeklyPlan.days.forEach(day => {
                        if (day.label) planMap[day.label] = day;
                    });
                } else if (Object.keys(data.weeklyPlan).length > 0) {
                    planMap = data.weeklyPlan;
                }
                // --- CONVERSION LOGIC END ---

                if (Object.keys(planMap).length > 0) {
                    // ✅ USE RACE TEMPLATE HERE
                    container.innerHTML = this.raceWeeklyTemplate(planMap);
                    
                    // REMOVED: this.attachWeeklyPlanListeners(); 
                    // (Unless you define it, calling it will crash the app)
                    
                    return;
                }
            } 
            
            // EMPTY STATE FOR RACE (Fall-through if no plan data)
            container.innerHTML = `
                <div class="text-center py-8 bg-gray-50 border-2 border-dashed border-gray-200 rounded-xl">
                    <h3 class="text-lg font-bold text-gray-700">Ready to Race?</h3>
                    <p class="text-sm text-gray-500 mb-4">Set your target race to generate your plan.</p>
                    <button onclick="window.location.href='/ai-onboarding.html'" class="bg-indigo-600 text-white px-6 py-2 rounded-lg shadow hover:bg-indigo-700">
                        Create Race Plan
                    </button>
                </div>`;

        } catch (error) {
            console.error("Race Plan Error", error);
            // Optional: Render error state
            container.innerHTML = `<p class="text-red-500 text-center">Failed to load plan.</p>`;
        }
    }

    // Advanced Template: Includes specific workout types (Intervals, Tempo) and intensity
    // Add this inside your RaceDashboardWidgets class in dashboard-race-widgets.js

raceWeeklyTemplate(planMap) {
    const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    
    const items = days.map(day => {
        const data = planMap[day] || {};
        const workout = data.workout || {};
        
        // --- 1. Determine Workout Type & Intensity ---
        const title = workout.title ? workout.title.toLowerCase() : 'rest';
        const type = workout.type ? workout.type.toLowerCase() : '';
        const isRest = title.includes('rest');
        
        // --- 2. Color Coding Logic ---
        let cardStyle = '';
        let typeLabel = '';
        let badgeColor = '';

        if (isRest) {
            // GREY for Rest
            cardStyle = 'bg-gray-50 border-gray-200 opacity-75';
            typeLabel = 'Rest';
            badgeColor = 'bg-gray-200 text-gray-500';
        } else if (title.includes('long') || type === 'long_run') {
            // PURPLE for Long Runs (Key workout)
            cardStyle = 'bg-purple-50 border-purple-200 shadow-sm';
            typeLabel = 'Long Run';
            badgeColor = 'bg-purple-100 text-purple-700';
        } else if (title.includes('interval') || title.includes('tempo') || title.includes('speed')) {
            // RED/ORANGE for Quality/Speed Sessions
            cardStyle = 'bg-orange-50 border-orange-200 shadow-sm';
            typeLabel = 'Quality';
            badgeColor = 'bg-orange-100 text-orange-700';
        } else {
            // BLUE/GREEN for Easy/Recovery Runs
            cardStyle = 'bg-white border-blue-100 shadow-sm';
            typeLabel = 'Easy';
            badgeColor = 'bg-blue-100 text-blue-600';
        }

        // --- 3. Format Duration/Distance ---
        // Race plans often care about distance (km) as much as duration
        let volumeDisplay = '-';
        if (workout.distance) {
            volumeDisplay = `${workout.distance} km`;
        } else if (workout.duration) {
            volumeDisplay = `${workout.duration} min`;
        }

        // --- 4. Render Card ---
        // Note: Added cursor-pointer and onclick to hint at interactivity
        return `
            <div 
                onclick="window.openWorkoutDetails('${day}', '${workout.id || ''}')" 
                class="${cardStyle} p-2 rounded-lg border text-center flex flex-col justify-between h-24 cursor-pointer hover:shadow-md transition-shadow duration-200 group relative overflow-hidden"
            >
                <!-- Intensity Strip (Left Border visual) -->
                <div class="absolute left-0 top-0 bottom-0 w-1 ${badgeColor.split(' ')[0]}"></div>

                <!-- Day Label -->
                <div class="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">${day.substring(0, 3)}</div>
                
                <!-- Workout Title -->
                <div class="font-semibold text-gray-800 text-xs leading-tight line-clamp-2 px-1">
                    ${workout.title || 'Rest'}
                </div>
                
                <!-- Volume / Stats -->
                <div class="mt-2 flex justify-center items-center gap-1">
                    <span class="text-[10px] font-medium px-2 py-0.5 rounded-full ${badgeColor}">
                        ${volumeDisplay}
                    </span>
                </div>
            </div>
        `;
    }).join('');

    // Attach the global handler if not already present (prevents 'function not defined' error)
    if (!window.openWorkoutDetails) {
        window.openWorkoutDetails = (day, id) => {
            // You can replace this with your actual modal open logic later
            console.log(`Open details for ${day}, ID: ${id}`);
            // e.g., document.getElementById('workout-modal').classList.remove('hidden');
        };
    }

    return `<div class="grid grid-cols-7 gap-2">${items}</div>`;
}

renderPerformanceChart(containerId) {
        const container = document.getElementById(containerId);
        if (container) {
            container.innerHTML = `<div class="h-32 flex items-center justify-center text-gray-400 text-sm bg-gray-50 rounded-lg border border-dashed">Performance Chart Loading...</div>`;
        }
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
  }}}

// Auto-init
document.addEventListener('DOMContentLoaded', () => {
  window.dashboardWidgets = new RaceDashboardWidgets();
  window.dashboardWidgets.init();
});

