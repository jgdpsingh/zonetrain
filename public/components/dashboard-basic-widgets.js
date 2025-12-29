// dashboard-basic-widgets.js

class BasicDashboardWidgets {
    constructor() {
        this.token = localStorage.getItem('userToken');
        this.userLocation = JSON.parse(localStorage.getItem('userLocation') || '{}');
    }

    init() {
        console.log('🚀 Initializing BASIC Dashboard Widgets...');
        this.renderWeatherWidget('weather-widget');
        this.renderTodayWorkoutWidget('today-workout-container');
        this.renderWeeklyPlanWidget('weekly-plan-container');
        this.setupUpgradeListeners(); // Special listener for Basic users
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

    // SIMPLIFIED Weekly Plan for Basic
   // In dashboard-basic-widgets.js

async renderWeeklyPlanWidget(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    try {
        const response = await fetch('/api/training/weekly-plan', {
            headers: { 'Authorization': `Bearer ${this.token}` }
        });
        const data = await response.json();

        // Check if we have a valid plan and data to show
        if (data.success && data.weeklyPlan) {
            
            // --- ROBUST CONVERSION LOGIC START ---
            let planMap = {};

            // 1. New Format: Array of days { days: [{label: 'Monday'...}] }
            if (data.weeklyPlan.days && Array.isArray(data.weeklyPlan.days)) {
                data.weeklyPlan.days.forEach(day => {
                    // Use 'label' (e.g. "Monday") as the key
                    if (day.label) {
                        planMap[day.label] = day;
                    }
                });
            } 
            // 2. Old Format: Object keys { "Monday": {...} }
            else if (Object.keys(data.weeklyPlan).length > 0) {
                planMap = data.weeklyPlan;
            }
            // --- ROBUST CONVERSION LOGIC END ---

            // Only render if we actually successfully mapped some days
            if (Object.keys(planMap).length > 0) {
                container.innerHTML = this.basicWeeklyTemplate(planMap);
                return; // Stop here, successful render
            }
        }

        // If we reach here, it means success=false OR no days were found
        // RENDER EMPTY STATE
        container.innerHTML = `
            <div class="text-center py-8">
                <p class="text-gray-500 mb-4">No active plan found.</p>
                <button onclick="window.location.href='/onboarding-basic.html'" class="bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700 transition">
                    Create Basic Plan
                </button>
            </div>`;

    } catch (error) {
        console.error("Basic Plan Error", error);
        container.innerHTML = `<div class="text-red-500 text-sm p-4">Failed to load plan.</div>`;
    }
}

// Simple Template: Just Day, Title, Duration
basicWeeklyTemplate(planMap) {
    const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    
    const items = days.map(day => {
        const data = planMap[day] || {};
        const workout = data.workout || {};
        
        // Visual tweak: if it's Rest, maybe show it differently?
        const isRest = !workout.title || workout.title.toLowerCase().includes('rest');
        const bgColor = isRest ? 'bg-gray-50' : 'bg-white';
        const borderColor = isRest ? 'border-gray-100' : 'border-blue-100';

        return `
            <div class="${bgColor} p-2 rounded border ${borderColor} text-center flex flex-col justify-center h-20">
                <div class="text-[10px] font-bold text-gray-400 uppercase mb-1">${day.substring(0, 3)}</div>
                <div class="font-medium text-gray-800 text-xs leading-tight line-clamp-2">${workout.title || 'Rest'}</div>
                <div class="text-[10px] text-gray-500 mt-1">${workout.duration ? workout.duration + 'm' : '-'}</div>
            </div>
        `;
    }).join('');

    return `<div class="grid grid-cols-7 gap-2">${items}</div>`;
}


    setupUpgradeListeners() {
        const btn = document.getElementById('upgrade-btn');
        if (btn) {
            btn.addEventListener('click', () => {
                // Trigger your existing upgrade modal logic
                openUpgradeModal('race'); 
            });
        }
    }
    
     // Today's Workout Widget
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
}

// Auto-init
document.addEventListener('DOMContentLoaded', () => {
    const widgets = new BasicDashboardWidgets();
    widgets.init();
});
