// dashboard-race-widgets.js

class RaceDashboardWidgets {
    constructor() {
        this.token = localStorage.getItem('userToken');
    }

    init() {
        console.log('🏎️ Initializing RACE Dashboard Widgets...');
        this.renderRaceCountdown('race-countdown-widget'); // Exclusive to Race
        this.renderWeeklyPlanWidget('weekly-plan-container');
        this.renderPerformanceChart('performance-chart-container'); // Exclusive to Race
        this.setupDowngradeListeners();
    }

    // ADVANCED Weekly Plan for Race
    async renderWeeklyPlanWidget(containerId) {
        const container = document.getElementById(containerId);
        if (!container) return;

        try {
            const response = await fetch('/api/training/weekly-plan', {
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
            this.attachWeeklyPlanListeners(); // Race plan likely has click-to-expand details
            return;
        }
    } else {
                // EMPTY STATE FOR RACE
                container.innerHTML = `
                    <div class="text-center py-8 bg-gray-50 border-2 border-dashed border-gray-200 rounded-xl">
                        <h3 class="text-lg font-bold text-gray-700">Ready to Race?</h3>
                        <p class="text-sm text-gray-500 mb-4">Set your target race to generate your plan.</p>
                        <button onclick="window.location.href='/onboarding-race.html'" class="bg-indigo-600 text-white px-6 py-2 rounded-lg shadow hover:bg-indigo-700">
                            Create Race Plan
                        </button>
                    </div>`;
            }
        } catch (error) {
            console.error("Race Plan Error", error);
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

}

// Auto-init
document.addEventListener('DOMContentLoaded', () => {
    const widgets = new RaceDashboardWidgets();
    widgets.init();
});
