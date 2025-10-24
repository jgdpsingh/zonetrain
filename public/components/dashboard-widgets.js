// ZoneTrain Dashboard Widgets
class DashboardWidgets {
    constructor() {
        this.token = localStorage.getItem('userToken');
        this.userLocation = JSON.parse(localStorage.getItem('userLocation') || '{}');
    }

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

            const response = await fetch(`/api/weather?lat=${latitude}&lon=${longitude}`, {
                headers: { 'Authorization': `Bearer ${this.token}` }
            });

            const data = await response.json();
            if (data.success) {
                container.innerHTML = this.weatherTemplate(data.weather, data.mock);
            }
        } catch (error) {
            console.error('Weather widget error:', error);
            container.innerHTML = this.weatherErrorTemplate();
        }
    }

    // Weekly Plan Widget
    async renderWeeklyPlanWidget(containerId) {
        const container = document.getElementById(containerId);
        if (!container) return;

        try {
            const response = await fetch('/api/training/weekly-plan', {
                headers: { 'Authorization': `Bearer ${this.token}` }
            });

            const data = await response.json();
            if (data.success) {
                container.innerHTML = this.weeklyPlanTemplate(data.weeklyPlan);
                this.attachWeeklyPlanListeners();
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
                container.innerHTML = this.todayWorkoutTemplate(data.workout);
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


    weeklyPlanTemplate(plan) {
        const daysHTML = plan.days.map(day => `
            <div class="week-day ${day.isToday ? 'today' : ''} ${day.completed ? 'completed' : ''}" 
                 data-date="${day.date}">
                <div class="day-name">${day.dayName}</div>
                <div class="workout-type">${day.workout.name}</div>
                <div class="workout-duration">${day.workout.duration}min</div>
                ${day.isToday ? '<div class="today-badge">Today</div>' : ''}
            </div>
        `).join('');

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

    todayWorkoutTemplate(workout) {
        const hrvColors = {
            easy: '#ef4444',
            normal: '#10b981',
            push: '#3b82f6'
        };

        const hrvColor = hrvColors[workout.hrvStatus] || '#10b981';

        return `
            <div class="widget today-workout-widget">
                <div class="widget-header">
                    <h3>🏃 Today's Workout</h3>
                    <div class="hrv-indicator" style="background: ${hrvColor}20; color: ${hrvColor}; border: 2px solid ${hrvColor};">
                        HRV: ${workout.hrvValue}
                    </div>
                </div>
                <div class="workout-content">
                    <div class="workout-title">${workout.workout.name}</div>
                    <div class="workout-meta">
                        <span class="duration">⏱️ ${workout.workout.duration} min</span>
                        <span class="intensity">💪 ${workout.workout.intensity}</span>
                        ${workout.workout.distance ? `<span class="distance">📏 ${workout.workout.distance}</span>` : ''}
                    </div>
                    <div class="workout-description">
                        ${workout.workout.description}
                    </div>
                    ${workout.workout.zones.length > 0 ? `
                        <div class="workout-zones">
                            <strong>Target Zones:</strong> ${workout.workout.zones.join(', ')}
                        </div>
                    ` : ''}
                    <div class="hrv-recommendation" style="background: ${hrvColor}15; border-left: 4px solid ${hrvColor};">
                        ${workout.recommendation}
                    </div>
                    ${workout.adjustedFromPlanned ? `
                        <div class="adjustment-notice">
                            ⚠️ Workout adjusted based on your HRV reading
                        </div>
                    ` : ''}
                    <button class="btn-start-workout" onclick="window.dashboardWidgets.startWorkout()">
                        Start Workout
                    </button>
                    <button class="btn-log-hrv" onclick="window.dashboardWidgets.logHRV()">
                        Update HRV
                    </button>
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

    async showWeeklyDetails() {
        const modal = document.getElementById('weekly-modal');
        const content = document.getElementById('weekly-details-content');
        
        try {
            const response = await fetch('/api/training/weekly-plan', {
                headers: { 'Authorization': `Bearer ${this.token}` }
            });

            const data = await response.json();
            if (data.success) {
                content.innerHTML = this.detailedWeeklyTemplate(data.weeklyPlan);
                modal.style.display = 'flex';
            }
        } catch (error) {
            console.error(error);
        }
    }

    detailedWeeklyTemplate(plan) {
        return plan.days.map(day => `
            <div class="detailed-day ${day.isToday ? 'today' : ''}">
                <div class="day-header">
                    <h3>${day.dayName} - ${new Date(day.date).toLocaleDateString()}</h3>
                    ${day.isToday ? '<span class="today-badge">Today</span>' : ''}
                </div>
                <div class="day-workout">
                    <h4>${day.workout.name}</h4>
                    <p><strong>Duration:</strong> ${day.workout.duration} minutes</p>
                    <p><strong>Intensity:</strong> ${day.workout.intensity}</p>
                    ${day.workout.distance ? `<p><strong>Distance:</strong> ${day.workout.distance}</p>` : ''}
                    <p class="description">${day.workout.description}</p>
                    ${day.workout.zones.length > 0 ? `<p><strong>Zones:</strong> ${day.workout.zones.join(', ')}</p>` : ''}
                </div>
            </div>
        `).join('');
    }

    closeModal() {
        document.getElementById('weekly-modal').style.display = 'none';
    }

    startWorkout() {
        alert('Starting workout tracking... (Feature coming soon)');
    }

    logHRV() {
        const hrv = prompt('Enter your HRV reading:');
        if (hrv && !isNaN(hrv)) {
            localStorage.setItem('todayHRV', hrv);
            this.renderTodayWorkoutWidget('today-workout-container');
            alert('HRV updated! Workout adjusted based on your reading.');
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
}

// Initialize on page load
window.dashboardWidgets = new DashboardWidgets();
