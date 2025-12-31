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

        // Render Widgets
        this.renderRaceCountdown('race-countdown-widget'); 
        this.renderWeeklyPlanWidget('weekly-plan-container');
        this.renderPerformanceChart('performance-chart-container');
        
        // Subscription & Downgrade Logic
        this.loadSubscriptionDetails();
        this.setupDowngradeListeners();
        this.setupPauseResumeListeners(); // Added this since you had pause logic
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
    const widgets = new RaceDashboardWidgets();
    widgets.init();
});
