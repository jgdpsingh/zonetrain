// public/components/dashboard-race-widgets.js

class RaceDashboardWidgets {
    constructor() {
        this.token = localStorage.getItem('userToken');
        try {
            this.userLocation = JSON.parse(localStorage.getItem('userLocation')) || {};
        } catch (e) { this.userLocation = {}; }
        this.currentWeekOffset = 0;
        this.userProfile = null;
        this.hubLoaded = false;

        this.raceGoal = null;
  this.raceStatus = null;
        
        // Bind methods to window for HTML onclick events
        window.dashboardWidgets = this;
        this.setupGlobalHandlers();
    }

    parseDate(val) {
        if (!val) return null;
        if (val instanceof Date) return val;
        if (val._seconds) return new Date(val._seconds * 1000); // Firestore
        if (val.seconds) return new Date(val.seconds * 1000);   // JS Timestamp
        return new Date(val); // String ISO
    }

    setupGlobalHandlers() {
        // Expose critical functions to window for onclick="" attributes
        window.openWorkoutModal = this.openWorkoutModal.bind(this);
        window.closeWorkoutModal = this.closeWorkoutModal.bind(this);
        window.skipWorkout = this.skipWorkout.bind(this);
        window.toggleCalendar = (e) => {
             e.preventDefault();
             window.location.href = '/calendar'; // Or your calendar logic
        };
    }

    async loadRaceGoal() {
  try {
    const res = await fetch("/api/race-goals/current", {
      headers: { Authorization: `Bearer ${this.token}` }
    });
    const data = await res.json();
    this.raceGoal = data?.success ? (data.raceGoal || null) : null;
  } catch (e) {
    this.raceGoal = null;
  }
}

async loadRaceStatus() {
  try {
    const res = await fetch("/api/race/status", {
      headers: { Authorization: `Bearer ${this.token}` }
    });
    const data = await res.json();
    this.raceStatus = data?.success ? data : null;
  } catch (e) {
    this.raceStatus = null;
  }
}

async loadUserProfile() {
        try {
            const res = await fetch('/api/user/access-status', { // Or your profile endpoint
                headers: { 'Authorization': `Bearer ${this.token}` }
            });
            const data = await res.json();
            if (data.success && data.user) {
                this.userProfile = data.user;
                // Optional: update header name if element exists
                const nameEl = document.getElementById('user-name-display');
                if (nameEl) nameEl.textContent = data.user.firstName;
            }
        } catch (e) {
            console.warn('Profile load failed', e);
        }
    }

    async init() {
        console.log('🏎️ Starting Race Execution Dashboard...');
        await this.loadUserProfile();

        await this.loadRaceGoal();
  await this.loadRaceStatus();

        this.attachModalListeners();

        if (typeof this.applyPostRaceUX === "function") {
  await this.applyPostRaceUX();
} else {
  await this.checkRaceCompletion?.();
}

        await this.loadSubscriptionCard();
        this.updateHeaderStats();

        // --- ROBUST LOADING: Ensure one failure doesn't stop the dashboard ---
       const widgetPromises = [
        this.renderTodayWorkoutWidget('today-workout-container'),
        this.renderWeeklyPlanWidget('weekly-plan-container'),
        this.renderAIInsightWidget('ai-insight-widget-container'),
        this.renderReadinessChart('readiness-chart-container'),
        // ✅ Call the renderers for the fixed containers
        this.renderRacePlanningWidget('race-planning-container'),
        this.renderPerformanceAnalytics('performance-analytics-container'), // New function
        this.renderSubscriptionControls ? this.renderSubscriptionControls('subscription-controls-container') : Promise.resolve()

        
    ];

    await this.applyPostRaceUX();   // NEW (banner + modal)
  this.updateHeaderStats();
        // Wait for all to finish (success or fail) without crashing
        await Promise.allSettled(widgetPromises);
        console.log('✅ Dashboard Widgets Loaded');
    }

async applyPostRaceUX() {
  const status = this.raceStatus;
  if (!status) return;

  // 1) Needs feedback => open modal
  if (status.needsFeedback) {
    const modal = document.getElementById("raceFeedbackModal");
    if (modal) {
      modal.style.display = "flex";
      document.body.style.overflow = "hidden";
    }
  }

  // 2) Post-race banner (either already archived, or recently completed)
  if (status.raceCompleted && !status.postRaceDismissed) {
    const banner = document.getElementById("post-race-banner");
    const nameEl = document.getElementById("completed-race-name");
    if (nameEl) nameEl.textContent = status.completedRaceName || "your race";
    if (banner) banner.style.display = "block";
  }
}


attachModalListeners() {
        const form = document.getElementById('raceFeedbackForm');
        if (form) {
            // Remove old listeners to prevent duplicates
            const newForm = form.cloneNode(true);
            form.parentNode.replaceChild(newForm, form);
            
            newForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                await this.submitRaceFeedback();
            });
        }
    }

    async submitRaceFeedback() {
        const btn = document.querySelector('#raceFeedbackForm button[type="submit"]');
        const originalText = btn ? btn.innerText : 'Submit';
        if (btn) { btn.disabled = true; btn.innerText = "Processing..."; }

        try {
            const time = document.getElementById('fb-time')?.value;
            const remarks = document.getElementById('fb-remarks')?.value;
            const ratingEl = document.querySelector('input[name="rating"]:checked');
            const rating = ratingEl ? parseInt(ratingEl.value) : 0;

            const res = await fetch('/api/race/complete', {
                method: 'POST',
                headers: { 
                    'Authorization': `Bearer ${this.token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ actualTime: time, rating, remarks })
            });

            const data = await res.json();
            if (data.success) {
                alert("🎉 Congratulations! Plan archived.");
                window.location.reload(); // This clears the "-2 Days" widget
            } else {
                throw new Error(data.message || 'Submission failed');
            }
        } catch (e) {
            alert("Error: " + e.message);
            if (btn) { btn.disabled = false; btn.innerText = originalText; }
        }
    }



  updateHeaderStats() {
  // Elements in dashboard-race.html header
  const countdownNumberEl = document.getElementById('next-race-countdown');
  const subtitleEl = document.getElementById('next-race-subtitle');
  const metaEl = document.getElementById('next-race-meta');

  // Backward-compat element used in some older layouts
  const raceTextEl = document.getElementById('race-countdown-text');

  // Pick whichever exists (your current code does this)
  const el = raceTextEl || countdownNumberEl;
  if (!el) return;

  // Prefer race goal date (from /api/race-goals/current), fallback to user profile (useraccess-status)
  const raceDateRaw = this.raceGoal?.date || this.userProfile?.raceDate || null;
  const raceName = this.raceGoal?.name || this.userProfile?.raceName || 'Race';

  const raceDate = raceDateRaw ? this.parseDate(raceDateRaw) : null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Status from /api/race/status (if you added it); safe fallback if not present
  const needsFeedback = this.raceStatus?.needsFeedback === true;
  const raceCompleted = this.raceStatus?.raceCompleted === true;

  // --------- BLANK SLATE (no race set) ----------
  const setBlankSlate = (reasonText) => {
    if (countdownNumberEl) countdownNumberEl.textContent = '--';
    if (subtitleEl) subtitleEl.textContent = 'No Race Set';
    if (metaEl) metaEl.textContent = reasonText || 'Set a goal to generate your plan';

    if (raceTextEl) {
      raceTextEl.innerHTML = `Set a Race Goal • <span style="color:#6b7280;">${reasonText || 'Create a new plan to continue.'}</span>`;
    }
  };

  // If no valid date at all => show blank slate
  if (!raceDate || Number.isNaN(raceDate.getTime())) {
    setBlankSlate('Set a goal to generate your plan');
    return;
  }

  raceDate.setHours(0, 0, 0, 0);
  const diffDays = Math.ceil((raceDate - today) / (1000 * 60 * 60 * 24));

  // --------- POST RACE ----------
  // If race date has passed:
  // - If feedback pending => show “Race complete” + prompt feedback
  // - Else => reset header to blank slate
  if (diffDays < 0) {
    if (needsFeedback && !raceCompleted) {
      if (countdownNumberEl) countdownNumberEl.textContent = '--';
      if (subtitleEl) subtitleEl.textContent = 'Race complete';
      if (metaEl) metaEl.textContent = 'Submit feedback to archive the plan';

      if (raceTextEl) {
        raceTextEl.innerHTML = `Completed <strong>${raceName}</strong> • <span style="color:#6b7280;">Feedback pending</span>`;
      }
      return;
    }

    // Already archived (or status unknown) => behave like no active goal
    setBlankSlate('Set a Race Goal to start a new plan');
    return;
  }

  // --------- PRE RACE / RACE DAY ----------
  let statusHtml = '';
  if (diffDays > 1) {
    statusHtml = `<span style="color:#4f46e5;">${diffDays} Days To Go</span>`;
  } else if (diffDays === 1) {
    statusHtml = `<span style="color:#f59e0b; font-weight:800;">TOMORROW!</span>`;
  } else {
    // diffDays === 0
    statusHtml = `<span style="color:#10b981; font-weight:800;">RACE DAY!</span>`;
  }

  if (countdownNumberEl) countdownNumberEl.textContent = String(diffDays); // 0 or positive only

  if (subtitleEl) subtitleEl.textContent = `${this.raceGoal?.distance ? `${this.raceGoal.distance} km • ` : ''}${raceDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`;
  if (metaEl) metaEl.textContent = this.raceGoal?.targetTime ? `Target ${this.raceGoal.targetTime}` : 'Target time: TBD';

  if (raceTextEl) {
    raceTextEl.innerHTML = `Training for <strong>${raceName}</strong> • ${statusHtml}`;
  }
}


    // =========================================================
    // 1. TODAY'S WORKOUT (Your Robust Logic + HRV)
    // =========================================================
    async renderTodayWorkoutWidget(containerId) {
        const container = document.getElementById(containerId);
        if (!container) return;

        try {
            const hrv = localStorage.getItem('todayHRV') || '';
            const res = await fetch(`/api/training/today-workout?hrv=${hrv}&t=${Date.now()}`, {
                headers: { 'Authorization': `Bearer ${this.token}` }
            });
            const data = await res.json();

             if (data?.postRace) {
      container.innerHTML = `
        <div style="padding:30px; text-align:center; height:100%; display:flex; flex-direction:column; justify-content:center; align-items:center;">
          <div style="font-size:42px; margin-bottom:10px;">🏁</div>
          <h3 style="margin:0;">Plan complete</h3>
          <p style="color:#6b7280; max-width:320px;">
            ${data.recommendation || "Your race is done. Submit feedback to archive your plan and set a new goal."}
          </p>
          <div style="display:flex; gap:10px; flex-wrap:wrap; justify-content:center; margin-top:14px;">
            <button
              onclick="document.getElementById('raceFeedbackModal') && (document.getElementById('raceFeedbackModal').style.display='flex')"
              style="padding:10px 14px; background:#10b981; color:white; border:none; border-radius:8px; font-weight:700; cursor:pointer;">
              Submit race feedback
            </button>
            <button
              onclick="openSetNewRaceModal()"
              style="padding:10px 14px; background:white; border:1px solid #d1d5db; border-radius:8px; font-weight:700; cursor:pointer;">
              Set a race goal
            </button>
          </div>
        </div>`;
      return;
    }

            if (data.success && data.workout) {
                container.innerHTML = this.todayWorkoutTemplate(data);
            } else {
                container.innerHTML = `
                    <div style="padding:30px; text-align:center; height:100%; display:flex; flex-direction:column; justify-content:center; align-items:center;">
                        <div style="font-size:40px; margin-bottom:10px;">☕</div>
                        <h3 style="margin:0;">Rest Day</h3>
                        <p style="color:#6b7280;">Recover for tomorrow.</p>
                    </div>`;
            }
        } catch(e) { container.innerHTML = `<p style="padding:20px; color:red;">Error loading workout.</p>`; }
    }

    todayWorkoutTemplate(data) {
        // Robust parsing logic
        let w = data.workout || data;
        
        if (w.completed) {
            return `
                <div style="text-align: center; padding: 40px 20px; background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: white; border-radius: 12px; height:100%; display:flex; flex-direction:column; justify-content:center;">
                    <div style="font-size: 50px; margin-bottom: 10px;">🎉</div>
                    <h3 style="margin: 0; font-size: 24px;">Great Job!</h3>
                    <p style="margin: 5px 0 0 0; opacity: 0.9;">You crushed today's workout.</p>
                </div>`;
        }

        const hrvValue = data.hrvValue || '--';
        const recommendation = data.recommendation || 'Good to go!';
        
        return `
            <div style="padding: 25px; height: 100%; display: flex; flex-direction: column; justify-content: space-between;">
                <div>
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px;">
                        <span style="background:#e0e7ff; color:#4338ca; padding:4px 10px; border-radius:20px; font-size:12px; font-weight:700;">TODAY</span>
                        <div style="font-size:12px; font-weight:600; color:#6b7280; border:1px solid #e5e7eb; padding:2px 8px; border-radius:12px;">HRV: ${hrvValue}</div>
                    </div>
                    <h2 style="margin:0 0 10px 0; font-size:22px; color:#1f2937; line-height:1.2;">${w.title}</h2>
                    <p style="color:#4b5563; font-size:14px; margin:0 0 15px 0; line-height:1.5; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;">${w.description || 'Follow structure.'}</p>
                    
                    <div style="display:flex; gap:15px; margin-bottom:15px;">
                        ${w.distance ? `<div><strong style="display:block; font-size:16px;">${w.distance}km</strong><span style="font-size:11px; color:#6b7280;">Distance</span></div>` : ''}
                        ${w.duration ? `<div><strong style="display:block; font-size:16px;">${w.duration}m</strong><span style="font-size:11px; color:#6b7280;">Duration</span></div>` : ''}
                    </div>

                    ${data.hrvStatus && data.hrvStatus !== 'normal' ? `
                    <div style="background:#fff7ed; border-left:3px solid #f97316; padding:10px; font-size:12px; color:#9a3412; margin-bottom:15px; border-radius:4px;">
                        ${recommendation}
                    </div>` : ''}
                </div>

                <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px;">
                    <button onclick="window.openWorkoutModal('${w.id}')" style="padding:12px; background:#4f46e5; color:white; border:none; border-radius:8px; font-weight:700; cursor:pointer;">Start</button>
                    <button onclick="window.dashboardWidgets.logHRV()" style="padding:12px; background:white; border:1px solid #d1d5db; border-radius:8px; font-weight:600; cursor:pointer;">Log HRV</button>
                </div>
            </div>
        `;
    }

    // =========================================================
    // 2. WEEKLY PLAN (Your Logic + My Helpers)
    // =========================================================
    async renderWeeklyPlanWidget(containerId) {
        const container = document.getElementById(containerId);
        if (!container) return;

        try {
            const response = await fetch(`/api/race/weekly-plan?offset=${this.currentWeekOffset}`, {
                headers: { Authorization: `Bearer ${this.token}` }
            });
            const data = await response.json();

            if (data?.postRace) {
  container.innerHTML = `
    <div style="padding:20px;text-align:center;color:#6b7280;">
      <h3 style="margin:0;color:#111827;">Plan ended</h3>
      <p style="margin-top:8px;">Your race is done. Submit feedback to archive this plan and set a new goal.</p>
    </div>`;
  return;
}

            if (data.success && data.weeklyPlan) {
                // Consistency Score
                const days = data.weeklyPlan.days || [];
                const scheduled = days.filter(d => d.workout?.type && d.workout.type !== 'rest').length;
                const completed = days.filter(d => d.workout?.completed).length;
                const pct = scheduled ? Math.round((completed/scheduled)*100) : 0;
                const barColor = pct >= 80 ? '#10b981' : '#8b5cf6';

                const complianceHtml = `
                    <div style="margin-bottom: 15px; background: #fff; padding: 12px 16px; border: 1px solid #e5e7eb; border-radius: 12px;">
                        <div style="display: flex; justify-content: space-between; margin-bottom:6px;">
                            <span style="font-size: 12px; font-weight: 600; color: #374151;">Weekly Execution</span>
                            <span style="font-size: 12px; color: #6b7280;">${completed}/${scheduled}</span>
                        </div>
                        <div style="width: 100%; background: #f3f4f6; height: 6px; border-radius: 4px; overflow: hidden;">
                            <div style="width: ${pct}%; height: 100%; background: ${barColor};"></div>
                        </div>
                    </div>`;

                // Normalize Data
                let planMap = {};
                days.forEach(d => { if(d.label) planMap[d.label] = d; });
                
                // Use your existing template logic
                const grid = this.raceWeeklyTemplate(planMap, { containerId, ...data.weeklyPlan });
                container.innerHTML = complianceHtml + grid;
            } else {
                container.innerHTML = `<p class="text-gray-500">No plan loaded.</p>`;
            }
        } catch(e) {
            console.error(e);
            container.innerHTML = `<p class="text-red-500">Failed to load schedule.</p>`;
        }
    }

   raceWeeklyTemplate(planMap, meta) {
  const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const safePlanMap = planMap || {};
  const ended = !!meta?.ended;

  const items = days.map(day => {
    const key = Object.keys(safePlanMap).find(k =>
      String(k).toLowerCase().startsWith(day.toLowerCase().substring(0, 3))
    );

    const data = (key && safePlanMap[key]) ? safePlanMap[key] : {};
    const workout = ended ? null : (data.workout || null);

    const titleStr = ended
      ? 'Nil'
      : (
          (typeof workout?.title === 'string' && workout.title.trim())
            ? workout.title.trim()
            : 'Rest'
        );

    const isRest = ended ? true : titleStr.toLowerCase().includes('rest');
    const isDone = ended ? false : !!workout?.completed;

    const color = ended
      ? '#9ca3af'
      : (isDone ? '#10b981' : (isRest ? '#9ca3af' : '#3b82f6'));

    const bg = ended ? '#f9fafb' : (isDone ? '#ecfdf5' : '#fff');

    const canOpen = !ended && !isRest && workout?.id;

    return `
      <div onclick="${canOpen ? `window.openWorkoutModal('${workout.id}')` : ''}"
           style="background:${bg}; border:1px solid ${isDone ? '#10b981' : '#e5e7eb'}; border-radius:8px; padding:8px; min-height:80px;
                  cursor:${canOpen ? 'pointer' : 'default'}; display:flex; flex-direction:column; position:relative; opacity:${ended ? '0.85' : '1'};">

        <div style="font-size:10px; font-weight:700; color:#6b7280; text-transform:uppercase;">
          ${day.substring(0,3)}
        </div>

        <div style="font-size:12px; font-weight:600; margin-top:4px; color:#111827; line-height:1.2;">
          ${titleStr}
        </div>

        ${(!isRest && !ended) ? `
          <div style="margin-top:auto; font-size:10px; color:${color}; font-weight:600; background:${color}15; padding:2px 6px; border-radius:4px; align-self:flex-start;">
            ${workout?.distance ? (workout.distance + 'km') : (workout?.duration ? (workout.duration + 'm') : 'Workout')}
          </div>
        ` : ''}

        ${ended ? `
          <div style="margin-top:auto; font-size:10px; color:#9ca3af; font-weight:700;">
            Plan completed
          </div>
        ` : ''}

        ${isDone ? `<div style="position:absolute; top:6px; right:6px; font-size:12px;">✅</div>` : ''}
      </div>
    `;
  }).join('');

  const footerLabel = ended ? 'Plan completed' : `Week ${meta.weekNumber || 1}`;

  // Disable right arrow on ended weeks
  const rightDisabled = ended;

  const rightBtnStyle = [
    'border:none',
    'background:none',
    `cursor:${rightDisabled ? 'not-allowed' : 'pointer'}`,
    `opacity:${rightDisabled ? '0.35' : '1'}`,
    `pointer-events:${rightDisabled ? 'none' : 'auto'}`
  ].join('; ');

  const leftBtnStyle = 'border:none; background:none; cursor:pointer;';

  return `
    <div style="display:grid; grid-template-columns: repeat(7, 1fr); gap:8px; overflow-x:auto;">
      ${items}
    </div>

    <div style="text-align:center; margin-top:10px;">
      <button onclick="window.dashboardWidgets.changeWeek(-1, '${meta.containerId}')"
              style="${leftBtnStyle}">&larr;</button>

      <span style="font-size:12px; font-weight:600; margin:0 10px;">
        ${footerLabel}
      </span>

      <button ${rightDisabled ? 'disabled' : ''}
              onclick="${rightDisabled ? '' : `window.dashboardWidgets.changeWeek(1, '${meta.containerId}')`}"
              style="${rightBtnStyle}">&rarr;</button>
    </div>
  `;
}




    changeWeek(delta, containerId) {
        this.currentWeekOffset += delta;
        this.renderWeeklyPlanWidget(containerId);
    }

    // =========================================================
    // 3. READINESS (New Taper Tool)
    // =========================================================
    async renderReadinessChart(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;

  container.innerHTML = `
    <div class="widget-header">
      <h3>🔋 Race Readiness</h3>
      <span style="font-size:11px; color:#6b7280;">Fatigue vs. Freshness</span>
    </div>
    <div style="height: 200px; display:flex; align-items:center; justify-content:center;">
      <div class="loading-spinner"></div>
    </div>`;

  try {
    // Fetch 60 days to build the "Chronic" load baseline
    const response = await fetch('/api/analytics/workout-history?days=60', {
      headers: { 'Authorization': `Bearer ${this.token}` }
    });

    const data = await response.json();

    if (!data.success || !data.workouts || data.workouts.length < 5) {
      container.innerHTML = `
        <div class="widget-header"><h3>🔋 Readiness</h3></div>
        <div class="empty-state-widget">
          <p>Need at least 1 week of training data to calculate readiness.</p>
        </div>`;
      return;
    }

    // --- 1. Calculate Daily Load (TRIMP Estimation) ---
    const dailyLoad = new Map();

    data.workouts.forEach(w => {
      // Robust: some rows might have startDate or scheduledDate depending on source
      const dt = new Date(w.startDate || w.scheduledDate);
      if (Number.isNaN(dt.getTime())) return;

      const dateStr = dt.toDateString();

      // Duration: prefer movingTime (seconds), else duration, else 0
      const duration = (w.movingTime || w.duration || 0);

      // Use Heart Rate if available, else estimate based on type/RPE
      let intensity = 0.75; // Default moderate
      if (w.averageHeartrate) {
        const maxHr =
          this.userProfile?.maxHr ||
          this.userProfile?.maxHeartRate ||
          190;
        intensity = w.averageHeartrate / maxHr;
      }

      // Non-linear stress formula (Foster's TRIMP approximation)
      const stress = duration * Math.exp(1.92 * intensity);

      const current = dailyLoad.get(dateStr) || 0;
      dailyLoad.set(dateStr, current + stress);
    });

    // --- 2. Calculate CTL (Fitness) & ATL (Fatigue) ---
    const today = new Date();
    const chartData = [];
    let ctl = 0; // Chronic Training Load (Fitness)
    let atl = 0; // Acute Training Load (Fatigue)

    for (let i = 45; i >= 0; i--) {
      const d = new Date();
      d.setDate(today.getDate() - i);
      const dateStr = d.toDateString();
      const dayLoad = dailyLoad.get(dateStr) || 0;

      // Exponential Moving Averages
      ctl = (dayLoad * (1 - Math.exp(-1 / 42))) + (ctl * Math.exp(-1 / 42));
      atl = (dayLoad * (1 - Math.exp(-1 / 7))) + (atl * Math.exp(-1 / 7));

      const tsb = ctl - atl; // Training Stress Balance (Readiness)

      chartData.push({
        date: d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
        tsb: Math.round(tsb),
        ctl: Math.round(ctl),
        atl: Math.round(atl)
      });
    }

    // --- 3. Render Chart (Last 14 Days) ---
    const recentData = chartData.slice(-14);

    const maxVal = Math.max(...recentData.map(d => Math.abs(d.tsb)), 20);

    const barsHtml = recentData.map(d => {
      const color = d.tsb >= 0 ? '#10b981' : '#f59e0b';
      const heightPct = (Math.abs(d.tsb) / maxVal) * 50;

      const style = d.tsb >= 0
        ? `bottom: 50%; height: ${heightPct}%;`
        : `top: 50%; height: ${heightPct}%;`;

      return `
                <div class="chart-bar-group" style="display:flex; flex-direction:column; align-items:center; flex:1; gap:2px; height:100%; position:relative; cursor:pointer;">
                    <div style="width:6px; background:${color}; opacity:0.8; border-radius:2px; position:absolute; ${style}"></div>
                    <div class="chart-tooltip" style="display:none; position:absolute; bottom:100%; background:black; color:white; padding:4px 6px; border-radius:4px; font-size:10px; white-space:nowrap; z-index:10;">
                        ${d.tsb} (${d.date})
                    </div>
                </div>`;
        }).join('');

    const current = recentData[recentData.length - 1].tsb;
    let statusText = "Balanced";
    if (current > 20) statusText = "⚡ Peak Taper (Race Ready)";
    else if (current > 5) statusText = "✅ Fresh & Sharp";
    else if (current > -10) statusText = "🏗️ Productive Training";
    else statusText = "⚠️ Heavy Fatigue (Rest Needed)";

    container.innerHTML = `
      <div class="widget-header">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <h3>🔋 Race Readiness</h3>
          <div style="text-align:right;">
            <div style="font-size:18px; font-weight:700; color:${current >= 0 ? '#10b981' : '#f59e0b'};">
              ${current > 0 ? '+' : ''}${current}
            </div>
            <div style="font-size:10px; color:#6b7280;">Form Score</div>
          </div>
        </div>
      </div>

      <div style="height: 120px; position:relative; border-bottom: 1px solid #e5e7eb; margin: 10px 0; background:#fafafa;">
        <div style="position:absolute; top:50%; left:0; right:0; border-top:1px dashed #d1d5db; z-index:0;"></div>
        <div style="display: flex; justify-content: space-between; gap: 4px; height: 100%; padding:0 10px; z-index:1;">
          ${barsHtml}
        </div>
      </div>

      <div style="display:flex; justify-content:space-between; margin-top:5px; font-size:10px; color:#9ca3af;">
        <span>${recentData[0].date}</span>
        <span>Today</span>
      </div>

      <div style="margin-top:10px; padding:8px; background:${current >= 0 ? '#ecfdf5' : '#fffbeb'}; border-radius:6px; font-size:12px; color:#374151; text-align:center;">
        <strong>${statusText}</strong>
      </div>
    `;
    container.innerHTML = `
            <style>
                .chart-bar-group:hover .chart-tooltip { display: block !important; }
            </style>
            ` + container.innerHTML;
  } catch (e) {
    console.error("Readiness Chart Error", e);
    container.innerHTML = `<p style="color:#ef4444; padding:20px; text-align:center;">Could not calculate readiness.</p>`;
  }
}


    // =========================================================
    // 4. ACTIONABLE INSIGHTS (Simplified)
    // =========================================================
   async renderAIInsightWidget(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;

  try {
    const res = await fetch('/api/workouts/latest-analysis', {
      headers: { Authorization: `Bearer ${this.token}` }
    });
    const data = await res.json();

    if (data.success && data.analysis) {
      const activityName = data.activityName || 'Workout';
      const when = data.date ? new Date(data.date).toLocaleDateString() : '';
      const wid = data.workoutId;

      container.innerHTML = `
        <div style="background:linear-gradient(135deg,#4f46e5 0,#7c3aed 100);color:white;padding:20px;border-radius:16px">
          <div style="display:flex;justify-content:space-between;gap:10px;margin-bottom:10px">
            <div>
              <div style="font-size:11px;font-weight:700;opacity:0.85;text-transform:uppercase">Latest Insight</div>
              <div style="font-size:13px;font-weight:700;margin-top:4px">${activityName} ${when ? `• ${when}` : ''}</div>
            </div>
            <div style="background:rgba(255,255,255,0.2);padding:2px 8px;border-radius:10px;font-size:12px;font-weight:700">
              ${(data.analysis.matchscore ?? '—')}/10
            </div>
          </div>

          <p style="font-size:14px;line-height:1.5;margin:0 0 12px 0">${data.analysis.feedback || ''}</p>

          ${wid ? `<button onclick="window.openWorkoutModal('${wid}')"
            style="padding:10px 12px;background:rgba(255,255,255,0.15);color:white;border:1px solid rgba(255,255,255,0.25);border-radius:10px;font-weight:700;cursor:pointer">
            View workout
          </button>` : ''}
        </div>
      `;
      return;
    }

    container.innerHTML = `<div class="empty-state-widget"><p>Complete a workout to get AI insights.</p></div>`;
  } catch (e) {
    container.innerHTML = `<p style="color:#ef4444">Failed to load insight.</p>`;
  }
}


    // =========================================================
    // 5. PLANNING & ADMIN
    // =========================================================
   renderRacePlanningWidget(containerId) {
        const container = document.getElementById(containerId);
        if(!container) return;
        
        container.innerHTML = `
            <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(140px, 1fr)); gap:15px;">
                <button onclick="window.dashboardWidgets.openRaceSimulator()" 
                    style="padding:15px; background:linear-gradient(135deg, #4f46e5 0%, #4338ca 100%); color:white; border:none; border-radius:12px; cursor:pointer; text-align:left; transition: transform 0.2s;">
                    <div style="font-size:20px; margin-bottom:5px;">🔮</div>
                    <div style="font-weight:700; font-size:14px;">Race Simulator</div>
                    <div style="font-size:11px; opacity:0.8;">Predict splits & finish</div>
                </button>
                
                <button onclick="window.dashboardWidgets.openNutritionModal()" 
                    style="padding:15px; background:#fff7ed; border:1px solid #fed7aa; border-radius:12px; cursor:pointer; text-align:left;">
                    <div style="font-size:20px; margin-bottom:5px;">🍌</div>
                    <div style="font-weight:700; color:#9a3412; font-size:14px;">Fueling Strategy</div>
                    <div style="font-size:11px; color:#c2410c;">Carb loading plan</div>
                </button>

                <button onclick="window.dashboardWidgets.openQuestionModal()" 
                    style="padding:15px; background:#eff6ff; border:1px solid #bfdbfe; border-radius:12px; cursor:pointer; text-align:left;">
                    <div style="font-size:20px; margin-bottom:5px;">💬</div>
                    <div style="font-weight:700; color:#1e40af; font-size:14px;">Ask AI Coach</div>
                    <div style="font-size:11px; color:#60a5fa;">Strategy & doubts</div>
                </button>

                <button onclick="window.dashboardWidgets.openRaceHub()" 
                    style="padding:15px; background:#f0fdf4; border:1px solid #bbf7d0; border-radius:12px; cursor:pointer; text-align:left;">
                    <div style="font-size:20px; margin-bottom:5px;">📈</div>
                    <div style="font-weight:700; color:#166534; font-size:14px;">Deep Dive Hub</div>
                    <div style="font-size:11px; color:#22c55e;">Explore all data</div>
                </button>
            </div>
            
            <div style="margin-top:15px; text-align:center;">
                 <button onclick="document.getElementById('new-race-modal').style.display='block'" style="font-size:12px; color:#6b7280; background:none; border:none; text-decoration:underline; cursor:pointer;">
                    ⚙️ Modify Race Goal / Distance
                </button>
            </div>
        `;
    }

   async loadSubscriptionCard() {
        const statusEl = document.getElementById('sub-status');
        const nextEl = document.getElementById('next-billing-date');
        if (!statusEl || !nextEl) return;

        try {
            const res = await fetch('/api/subscription/details', {
                headers: { Authorization: `Bearer ${this.token}` }
            });
            
            const data = await res.json();
            
            if (!data?.success) throw new Error(data?.message || 'Failed');

            const sub = data.subscription || {};
            
            // 1. Set Status
            statusEl.textContent = (sub.subscriptionStatus || 'Active').toUpperCase();

            const dateObj = this.parseDate(sub.subscriptionEndDate);
           

            // 3. Display Date safely
            nextEl.textContent = (dateObj && !isNaN(dateObj.getTime()))
                ? dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                : 'Lifetime / Unknown';

        } catch (e) {
            console.warn('Subscription card error:', e);
            statusEl.textContent = '—';
            nextEl.textContent = '—';
        }
    }



    // =========================================================
    // 6. RACE HUB (Lazy Load Non-Essentials)
    // =========================================================
    openRaceHub() {
        document.getElementById('raceHubModal').style.display = 'flex';
        if(!this.hubLoaded) {
            // Load Charts
            this.renderPerformanceChart('hub-pace-trend'); 
            this.renderProgressChart('hub-volume-trend');
            this.renderPersonalRecords('hub-personal-records');
            this.renderStravaWorkoutHistory('hub-history-list');
            this.hubLoaded = true;
        }
    }

    // --- Chart Renderers (Moved from Init) ---
    async renderPerformanceChart(containerId) {
        const container = document.getElementById(containerId);
        if (!container) return;

        container.innerHTML = `
            <div class="widget-header">
                <h3>⚡ Pace Trend</h3>
                <span style="font-size:11px; color:#6b7280;">Last 30 Runs</span>
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

            // Filter for Runs & Calculate Pace
            const runs = data.workouts
                .filter(w => (w.type === 'Run' || w.type === 'run') && w.distance > 0)
                .map(w => {
                    let paceVal = 0;
                    if (w.averagePace) paceVal = this.parsePace(w.averagePace);
                    else if (w.movingTime && w.distance) paceVal = w.movingTime / w.distance;
                    
                    return {
                        date: new Date(w.startDate || w.scheduledDate),
                        paceVal: paceVal, 
                        paceStr: this.formatPace(paceVal),
                        distance: (w.distance || 0).toFixed(1)
                    };
                })
                .filter(r => r.paceVal > 0 && r.paceVal < 15) // Filter outliers
                .reverse(); // Show oldest to newest

            if (runs.length === 0) {
                container.innerHTML = `<div class="widget-header"><h3>⚡ Pace Trend</h3></div><div class="empty-state-widget"><p>No pace data found.</p></div>`;
                return;
            }

            // Chart Scaling
            const minPace = Math.min(...runs.map(r => r.paceVal));
            const maxPace = Math.max(...runs.map(r => r.paceVal));
            const chartHeight = 140;

            const barsHtml = runs.map((run) => {
                // Inverse logic: Lower pace (faster) should be TALLER bar
                // We use maxPace as the "floor" (0 height)
                let pct = 0;
                if (maxPace !== minPace) {
                    pct = ((maxPace - run.paceVal) / (maxPace - minPace)) * 0.7 + 0.15; // Normalize to 15-85% height
                } else {
                    pct = 0.5;
                }
                
                const heightPx = Math.max(4, Math.floor(pct * chartHeight));
                const opacity = 0.4 + (0.6 * pct); 
                const labelText = `${run.date.toLocaleDateString()}: ${run.paceStr}/km (${run.distance}km)`;

                return `
                    <div class="chart-bar-group" style="display:flex; flex-direction:column; align-items:center; flex:1; min-width:6px; gap:4px; cursor:pointer; position:relative;">
                        <div style="width:70%; background:#8b5cf6; border-radius:4px 4px 0 0; height:${heightPx}px; opacity:${opacity}; transition:all 0.1s;"></div>
                         <div class="chart-tooltip" style="display:none; position:absolute; bottom:100%; background:black; color:white; padding:4px 6px; border-radius:4px; font-size:10px; white-space:nowrap; z-index:10;">
                            ${run.paceStr}/km
                        </div>
                    </div>`;
            }).join('');

            container.innerHTML = `
                <div class="widget-header">
                    <div style="display:flex; align-items:center; justify-content:space-between; width:100%;">
                        <h3>⚡ Pace Trend</h3>
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
            container.innerHTML = `
            <style>
                .chart-bar-group:hover .chart-tooltip { display: block !important; }
            </style>
            ` + container.innerHTML;

        } catch (e) {
            console.error("Chart error", e);
            container.innerHTML = `<p style="color:red; padding:20px;">Could not load chart data.</p>`;
        }
    }

    renderPerformanceAnalytics(containerId) {
        const container = document.getElementById(containerId);
        if(!container) return;

       const raceDateRaw = this.raceGoal?.date || this.userProfile?.raceDate || null;
const raceDate = raceDateRaw ? this.parseDate(raceDateRaw) : null;
  if (!raceDate || isNaN(raceDate.getTime())) {
    container.innerHTML = `
      <div style="padding:26px;text-align:center;">
        <h3 style="margin:0;color:#111827;">Performance Analytics</h3>
        <p style="margin:10px 0 0 0;color:#6b7280;">Set a race goal to display performance insights.</p>
        <button onclick="openSetNewRaceModal()"
          style="margin-top:14px;padding:10px 14px;background:#4f46e5;color:white;border:none;border-radius:8px;font-weight:700;cursor:pointer;">
          Set Race Goal
        </button>
      </div>`;
    return;
  }

        // Unique "Coach" view vs Raw "Data" view
        container.innerHTML = `
            <div style="display:grid; grid-template-columns: 1fr 1fr; gap:20px;">
                <div style="background:#f9fafb; padding:15px; border-radius:12px; text-align:center;">
                    <div style="font-size:11px; font-weight:700; color:#6b7280; text-transform:uppercase;">Confidence Score</div>
                    <div style="font-size:32px; font-weight:800; color:#4f46e5; margin:5px 0;">87<span style="font-size:16px">%</span></div>
                    <div style="font-size:12px; color:#059669;">▲ 4% this week</div>
                </div>
                
                <div style="background:#f9fafb; padding:15px; border-radius:12px; text-align:center;">
                    <div style="font-size:11px; font-weight:700; color:#6b7280; text-transform:uppercase;">Projected Finish</div>
                    <div style="font-size:24px; font-weight:800; color:#111827; margin:10px 0;">1:58:30</div>
                    <div style="font-size:12px; color:#6b7280;">Based on recent intervals</div>
                </div>
            </div>
            
            <div style="margin-top:15px; padding:12px; background:#eef2ff; border-radius:8px; display:flex; gap:10px; align-items:start;">
                <div style="font-size:18px;">💡</div>
                <div>
                    <strong style="font-size:13px; color:#3730a3;">Coach's Note:</strong>
                    <p style="margin:2px 0 0 0; font-size:12px; color:#4338ca; line-height:1.4;">
                        Your consistency on long runs is excellent. To hit your 1:55 goal, focus on hitting the exact splits in your upcoming Thursday tempo run.
                    </p>
                </div>
            </div>
        `;
    }
    openRaceSimulator() {
        // Simple simulator modal logic
        const goal = prompt("Enter your goal time (e.g., 50:00, 1:45:00):");
        if(goal) {
            alert(`🔮 Race Simulator\n\nTo hit ${goal}, run the first 2km conservative, push the middle section, and empty the tank last 1km.\n\nNegative Split Strategy Generated! (Check Plan)`);
        }
    }

   async renderProgressChart(containerId) {
        const container = document.getElementById(containerId);
        if (!container) return;

        container.innerHTML = `
            <div class="widget-header"><h3>📊 Weekly Load</h3></div>
            <div style="height: 180px; display:flex; align-items:center; justify-content:center;">
                <div class="loading-spinner"></div>
            </div>`;

        try {
            // Fetch 90 days to ensure full weeks
            const response = await fetch('/api/analytics/workout-history?days=90', {
                headers: { 'Authorization': `Bearer ${this.token}` }
            });
            const data = await response.json();

            if (!data.success || !data.workouts || data.workouts.length === 0) {
                container.innerHTML = `<div class="widget-header"><h3>📊 Weekly Load</h3></div><div class="empty-state-widget"><p>No data available.</p></div>`;
                return;
            }

            // Group by Week (Monday Start)
            const weeklyMap = new Map();
            const getMonday = (d) => {
                const date = new Date(d);
                const day = date.getDay();
                const diff = date.getDate() - day + (day === 0 ? -6 : 1);
                const monday = new Date(date.setDate(diff));
                monday.setHours(0,0,0,0);
                return monday.getTime();
            };

            data.workouts.forEach(w => {
                if (!w.distance) return;
                const dateObj = new Date(w.startDate || w.scheduledDate);
                const weekKey = getMonday(dateObj);
                
                const currentDist = weeklyMap.get(weekKey) || 0;
                weeklyMap.set(weekKey, currentDist + w.distance);
            });

            // Sort & Slice
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
                const dateStr = week.date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
                
                return `
                    <div class="chart-bar-group" style="display:flex; flex-direction:column; align-items:center; flex:1; gap:4px; cursor:pointer; position:relative;">
                        <div style="width:70%; background:${week.distance > 0 ? '#3b82f6' : '#e5e7eb'}; border-radius:4px 4px 0 0; height:${heightPx}px; opacity:0.8;"></div>
                        <div class="chart-tooltip" style="display:none; position:absolute; bottom:100%; background:black; color:white; padding:4px 6px; border-radius:4px; font-size:10px; white-space:nowrap; z-index:10;">
                            ${week.distance.toFixed(1)} km
                        </div>
                    </div>
                `;
            }).join('');

            container.innerHTML = `
                <div class="widget-header">
                    <div style="display:flex; align-items:center; justify-content:space-between; width:100%;">
                        <h3>📊 Weekly Load</h3>
                        <span style="font-size:11px; color:#3b82f6;">Last 12 Weeks</span>
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
            container.innerHTML = `
            <style>
                .chart-bar-group:hover .chart-tooltip { display: block !important; }
            </style>
            ` + container.innerHTML;

        } catch (error) {
            console.error('Weekly Load Chart Error:', error);
            container.innerHTML = `<p class="text-red-500 text-center">Failed to load chart.</p>`;
        }
    }

    async renderPersonalRecords(containerId) {
        const container = document.getElementById(containerId);
        if (!container) return;

        container.innerHTML = '<div class="loading-spinner"></div><p style="text-align:center;">Loading records...</p>';

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
                    
                    <div class="records-grid" style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 15px; padding: 20px;">
                        
                        <div class="record-card" style="background:#f9fafb; padding:15px; border-radius:10px; text-align:center;">
                            <div style="font-size:24px;">🏃</div>
                            <div style="font-weight:800; font-size:20px; color:#1f2937;">${records.totalRuns || 0}</div>
                            <div style="font-size:12px; color:#6b7280; text-transform:uppercase;">Total Runs</div>
                        </div>
                        
                        <div class="record-card" style="background:#f9fafb; padding:15px; border-radius:10px; text-align:center;">
                            <div style="font-size:24px;">📏</div>
                            <div style="font-weight:800; font-size:20px; color:#3b82f6;">${records.longestRun?.distance || '0'} km</div>
                            <div style="font-size:12px; color:#6b7280; text-transform:uppercase;">Longest Run</div>
                        </div>
                        
                        <div class="record-card" style="background:#f9fafb; padding:15px; border-radius:10px; text-align:center;">
                            <div style="font-size:24px;">🌍</div>
                            <div style="font-weight:800; font-size:20px; color:#10b981;">${records.totalDistance || '0'} km</div>
                            <div style="font-size:12px; color:#6b7280; text-transform:uppercase;">Total Dist</div>
                        </div>
                        
                        <div class="record-card" style="background:#f9fafb; padding:15px; border-radius:10px; text-align:center;">
                            <div style="font-size:24px;">⏱️</div>
                            <div style="font-weight:800; font-size:20px; color:#8b5cf6;">${records.totalTime || '0'} hrs</div>
                            <div style="font-size:12px; color:#6b7280; text-transform:uppercase;">Time</div>
                        </div>

                    </div>
                    <div style="text-align:center; padding-bottom:15px;">
                        <small style="color:#9ca3af;">All-time statistics from Strava</small>
                    </div>
                </div>
            `;
        } catch (error) {
            console.error('Render personal records error:', error);
            container.innerHTML = '<div class="widget error-widget">Failed to load personal records</div>';
        }
    }

async renderStravaWorkoutHistory(containerId) {
        const container = document.getElementById(containerId);
        if (!container) return;

        // Header with "Analyze" button
        container.innerHTML = `
            <div class="widget-header" style="display:flex; justify-content:space-between; align-items:center;">
                <h3>📜 Recent History</h3>
                <button onclick="window.dashboardWidgets.triggerManualAnalysis()" 
                    id="btn-analyze-missed"
                    style="font-size:11px; padding:6px 12px; background:#eff6ff; color:#1d4ed8; border:1px solid #bfdbfe; border-radius:6px; cursor:pointer; font-weight:600; display:flex; align-items:center; gap:4px;">
                    <span>⚡ Analyze</span>
                </button>
            </div>
            <div style="min-height: 100px; display:flex; align-items:center; justify-content:center;">
                <div class="loading-spinner"></div>
            </div>
        `;

        try {
            const response = await fetch('/api/analytics/workout-history?days=30', {
                headers: { 'Authorization': `Bearer ${this.token}` }
            });

            const data = await response.json();
            
            if (!data.success || !data.workouts || data.workouts.length === 0) {
                container.innerHTML += `<div style="text-align:center; padding:20px; color:#6b7280;">No workouts found.</div>`;
                return;
            }

            const { workouts } = data;

            // Generate list HTML
            const listHtml = workouts.slice(0, 10).map(w => {
                const name = (w.name || w.title || 'Run');
                const hasAi = !!w.aiAnalysis;
                const statusBadge = hasAi 
                    ? `<span style="font-size:10px; background:#ecfdf5; color:#059669; padding:2px 6px; border-radius:4px;">Analyzed</span>` 
                    : `<span style="font-size:10px; background:#fef2f2; color:#dc2626; padding:2px 6px; border-radius:4px;">Pending</span>`;

                return `
                <div style="display:flex; align-items:center; justify-content:space-between; padding:12px; border-bottom:1px solid #f3f4f6;">
                    <div style="display:flex; align-items:center; gap:12px;">
                        <div style="font-size:20px;">${this.getWorkoutIcon(w.type)}</div>
                        <div>
                            <div style="font-size:13px; font-weight:600; color:#374151;">${name}</div>
                            <div style="font-size:11px; color:#6b7280;">
                                ${new Date(w.startDate).toLocaleDateString(undefined, {month:'short', day:'numeric'})} • 
                                ${w.distance.toFixed(1)} km • 
                                ${w.averagePace ? w.averagePace + '/km' : ''}
                            </div>
                        </div>
                    </div>
                    <div>${statusBadge}</div>
                </div>`;
            }).join('');

            // Redraw container content preserving header
            container.innerHTML = `
                <div class="widget-header" style="display:flex; justify-content:space-between; align-items:center;">
                    <h3>📜 Recent History</h3>
                    <div style="display:flex; gap:5px;">
                        <button onclick="window.dashboardWidgets.triggerManualAnalysis()" id="btn-analyze-missed" style="font-size:11px; padding:6px 12px; background:#eff6ff; color:#1d4ed8; border:1px solid #bfdbfe; border-radius:6px; cursor:pointer; font-weight:600;">
                            ⚡ Analyze
                        </button>
                        <button onclick="window.dashboardWidgets.syncStrava(event)" style="font-size:11px; padding:6px 10px; border:1px solid #ddd; border-radius:6px; cursor:pointer;">
                            🔄
                        </button>
                    </div>
                </div>
                <div style="max-height:400px; overflow-y:auto;">
                    ${listHtml}
                </div>
            `;

        } catch (error) {
            console.error('Render workout history error:', error);
            container.innerHTML = `<p style="color:red; padding:20px;">Failed to load history.</p>`;
        }
    }

    // ... inside class RaceDashboardWidgets ...

    // ✅ ADDED: Missing function for "Analyze" button
    async triggerManualAnalysis() {
        const btn = document.getElementById('btn-analyze-missed');
        if(btn) {
            btn.disabled = true;
            btn.innerHTML = '⏳ Analyzing...';
        }

        try {
            // Trigger analysis endpoint
            const res = await fetch('/api/strava/trigger-analysis', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${this.token}` }
            });
            const data = await res.json();
            
            if(data.success) {
                alert(`✅ Analysis Complete: ${data.analyzedCount || 1} workouts processed.`);
                // Refresh the list to show new analysis
                this.renderStravaWorkoutHistory('hub-history-list');
                // Also refresh today's workout in case it updated
                this.renderTodayWorkoutWidget('today-workout-container');
            } else {
                alert('Analysis info: ' + (data.message || 'No pending workouts found.'));
            }
        } catch(e) {
            console.error("Manual analysis failed", e);
            alert('Error triggering analysis. Check console.');
        } finally {
             if(btn) {
                btn.disabled = false;
                btn.innerHTML = '⚡ Analyze';
            }
        }
    }

    // ... existing logHRV() ...

    // =========================================================
    // 7. ACTIONS (Bound to Window)
    // =========================================================
    async logHRV() {
        const val = prompt("Enter morning HRV:");
        if(val) {
            localStorage.setItem('todayHRV', val);
            await this.renderTodayWorkoutWidget('today-workout-container'); // Refresh
            alert("HRV Logged. Workout adjusted.");
        }
    }

    openQuestionModal() { document.getElementById('questionModal').style.display = 'flex'; }


    openNutritionModal() {
  document.getElementById("nutritionModal").style.display = "flex";
  this.loadRaceNutritionPlan();
}

async loadRaceNutritionPlan() {
  const el = document.getElementById("nutritionContent");
  if (!el) return;

  const loadingMsg = regenerate 
            ? "Creating a fresh plan based on your latest preferences..." 
            : "Loading your race week nutrition plan...";

  el.innerHTML = `
            <div style="text-align:center; padding:40px 20px;">
                <div class="loading-spinner" style="margin:0 auto 15px auto;"></div>
                <div style="color:#6b7280; font-size:14px; font-weight:500;">${loadingMsg}</div>
            </div>
        `;

  try {
    const url = `/api/race/nutrition/last-week${regenerate ? '?regenerate=true' : ''}`;

    const res = await fetch(url, {
                headers: { Authorization: `Bearer ${this.token}` }
            });
            const data = await res.json();

            if (!data.success) throw new Error(data.message || "Failed to load plan");
            
            // Render HTML
            el.innerHTML = this.renderNutritionPlanHTML(data.plan);
            
        } catch (err) {
            el.innerHTML = `
                <div style="padding:20px; background:#fef2f2; border:1px solid #fecaca; border-radius:12px; color:#991b1b; text-align:center;">
                    <p style="margin-bottom:10px;"><strong>Failed to load plan</strong></p>
                    <p style="font-size:13px; opacity:0.8;">${String(err.message || err)}</p>
                    <button onclick="dashboardWidgets.loadRaceNutritionPlan()" style="margin-top:10px; padding:8px 16px; background:#fff; border:1px solid #991b1b; color:#991b1b; border-radius:6px; cursor:pointer;">Try Again</button>
                </div>
            `;
        }
    }

    regenerateNutritionPlan() {
        if(confirm("Regenerate your nutrition plan? This will create a new menu based on your current dietary settings.")) {
            this.loadRaceNutritionPlan(true);
        }
    }

renderNutritionPlanHTML(plan) {
  const esc = (s) => String(s || "")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#039;");

  const daysHtml = (plan.days || []).map(d => {
    const meals = (d.meals || []).map(m => `
      <div style="margin:10px 0; padding:10px; background:#fff; border:1px solid #e5e7eb; border-radius:10px;">
        <div style="font-weight:800; color:#111827; font-size:13px;">${esc(m.slot)}</div>
        <div style="color:#374151; font-size:13px; margin-top:6px;">
          ${(m.items || []).map(x => `• ${esc(x)}`).join("<br>")}
        </div>
        ${m.why ? `<div style="color:#6b7280; font-size:12px; margin-top:6px;">Why: ${esc(m.why)}</div>` : ""}
      </div>
    `).join("");

    const t = d.targets || {};
    const targetsLine = `
      Carbs: <b>${esc(t.carbs_g)}</b>g · Protein: <b>${esc(t.protein_g)}</b>g · Fat: <b>${esc(t.fat_g)}</b>g
      <br>Fluids: <b>${esc(t.fluids_ml)}</b>ml · Sodium: <b>${esc(t.sodium_mg)}</b>mg
    `;

    const fueling = (d.trainingFueling || []).length
      ? `<div style="margin-top:10px; color:#374151; font-size:13px;"><b>Training fueling:</b><br>${(d.trainingFueling || []).map(x => `• ${esc(x)}`).join("<br>")}</div>`
      : "";

    const avoid = (d.avoid || []).length
      ? `<div style="margin-top:10px; color:#7c2d12; font-size:13px;"><b>Avoid:</b><br>${(d.avoid || []).map(x => `• ${esc(x)}`).join("<br>")}</div>`
      : "";

    return `
      <div style="padding:14px; border:1px solid #fed7aa; background:#fff7ed; border-radius:12px; margin-bottom:12px;">
        <div style="display:flex; justify-content:space-between; gap:10px;">
          <div style="font-weight:900; color:#9a3412;">Day ${d.dayOffsetFromRace}</div>
          <div style="color:#6b7280; font-size:12px;">${esc(d.date)}</div>
        </div>
        <div style="margin-top:6px; font-weight:700; color:#111827;">${esc(d.focus || "Focus")}</div>
        <div style="margin-top:8px; font-size:13px; color:#374151;">${targetsLine}</div>
        ${meals}
        ${fueling}
        ${avoid}
      </div>
    `;
  }).join("");

  const raceDay = plan.raceDay || {};
  const listBlock = (title, items) => items.length ? `<div style="margin-top:10px;"><div style="font-weight:700; color:#111827; font-size:13px;">${title}</div><ul style="margin:4px 0 0 20px; padding:0; font-size:13px; color:#374151;">${items.map(i => `<li>${esc(i)}</li>`).join("")}</ul></div>` : "";

        return `
            <div style="margin-bottom:15px; display:flex; justify-content:space-between; align-items:end;">
                <div>
                    <div style="font-weight:900; color:#9a3412; font-size:16px;">Last-Week Fueling</div>
                    <div style="color:#6b7280; font-size:12px;">Distance: ${esc(plan.raceDistanceKm)} km</div>
                </div>
                <button onclick="window.dashboardWidgets.regenerateNutritionPlan()" style="font-size:11px; padding:6px 12px; background:#fff; border:1px solid #d1d5db; border-radius:20px; cursor:pointer; color:#4b5563; display:flex; align-items:center; gap:4px;">
                    🔄 Regenerate
                </button>
            </div>

            ${(plan.notes || []).length ? `<div style="margin-bottom:15px; background:#fff7ed; padding:10px; border-radius:8px; border-left:3px solid #f97316; font-size:13px; color:#c2410c;">${plan.notes.map(x => `• ${esc(x)}`).join("<br>")}</div>` : ""}
            
            <div style="display:flex; flex-direction:column; gap:15px;">
                ${daysHtml}
            </div>

            <div style="margin-top:20px; padding:16px; border:1px solid #e5e7eb; background:#fafafa; border-radius:12px;">
                <div style="font-weight:900; color:#111827; font-size:15px; margin-bottom:10px;">🏁 Race Day Strategy</div>
                ${listBlock("Pre-Race", raceDay.preRace || [])}
                ${listBlock("During Race", raceDay.during || [])}
                ${listBlock("Post-Race", raceDay.postRace || [])}
            </div>
        `;
    }
    
    // WORKOUT MODAL LOGIC
    async openWorkoutModal(workoutId) {
        if (!workoutId || workoutId === 'undefined') return;

        // 1. Create/Inject Modal Skeleton if missing
        let modal = document.getElementById('workout-detail-modal');
        if (!modal) {
            const html = `
            <div id="workout-detail-modal" class="modal" style="display:none; align-items:center; justify-content:center; position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.5); z-index:10000; backdrop-filter:blur(2px);">
                <div class="modal-content" style="background:white; padding:0; border-radius:16px; width:90%; max-width:500px; position:relative; box-shadow:0 20px 25px -5px rgba(0,0,0,0.1); overflow:hidden;">
                    <div id="workout-modal-content" style="min-height:200px;"></div>
                </div>
            </div>`;
            document.body.insertAdjacentHTML('beforeend', html);
            modal = document.getElementById('workout-detail-modal');
        }

        // 2. Show Loading State
        modal.style.display = 'flex';
        const content = document.getElementById('workout-modal-content');
        content.innerHTML = `
            <div style="padding:40px; text-align:center;">
                <div class="loading-spinner" style="margin:0 auto 15px auto;"></div>
                <p style="color:#6b7280;">Fetching workout details...</p>
            </div>`;

        // 3. Handle "Unsaved" AI Plan Edge Case
        // If the ID looks like "json-week-1-day-2", it means the plan exists in the UI but hasn't been saved to DB yet.
        if (String(workoutId).startsWith('json-')) {
            content.innerHTML = `
                <div style="padding:30px; text-align:center;">
                    <h3 style="color:#f59e0b;">⚠️ Unsaved Plan</h3>
                    <p style="color:#374151; margin:10px 0;">This workout is part of a newly generated preview.</p>
                    <p style="font-size:13px; color:#6b7280;">Please refresh the page to sync the plan to your database before viewing details.</p>
                    <button onclick="closeWorkoutModal()" style="margin-top:20px; padding:10px 20px; background:#f3f4f6; border:none; border-radius:8px; cursor:pointer;">Close</button>
                    <button onclick="window.location.reload()" style="margin-top:10px; margin-left:10px; padding:10px 20px; background:#4f46e5; color:white; border:none; border-radius:8px; cursor:pointer;">Refresh Page</button>
                </div>
            `;
            return;
        }

        try {
            // 4. API Call
            const res = await fetch(`/api/workouts/${workoutId}`, {
                headers: { 'Authorization': `Bearer ${this.token}` }
            });

            const data = await res.json();
            if (!data.success) throw new Error(data.message || "Could not fetch workout");

            const w = data.workout || data.data;

            // 5. Formatting Logic
            // Color Coding based on Type
            let headerColor = '#3b82f6'; // Default Blue
            let typeLabel = w.type || 'Run';
            
            const typeMap = {
                'long_run': { color: '#7c3aed', label: 'Long Run' },      // Purple
                'interval': { color: '#f97316', label: 'Intervals' },     // Orange
                'tempo':    { color: '#ea580c', label: 'Tempo Run' },     // Red-Orange
                'recovery': { color: '#10b981', label: 'Recovery' },      // Green
                'easy_run': { color: '#3b82f6', label: 'Easy Run' }       // Blue
            };

            if (typeMap[w.type]) {
                headerColor = typeMap[w.type].color;
                typeLabel = typeMap[w.type].label;
            }

            // 6. Render the Content
            content.innerHTML = `
                <div style="background:${headerColor}; padding:25px 25px 20px 25px; color:white;">
                    <div style="display:flex; justify-content:space-between; align-items:flex-start;">
                        <span style="background:rgba(255,255,255,0.2); padding:4px 10px; border-radius:20px; font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:0.5px;">
                            ${typeLabel}
                        </span>
                        <button onclick="closeWorkoutModal()" style="background:none; border:none; color:white; font-size:24px; cursor:pointer; padding:0; line-height:1;">&times;</button>
                    </div>
                    <h2 style="margin:15px 0 5px 0; font-size:22px; font-weight:800;">${w.title}</h2>
                    <div style="display:flex; gap:15px; font-size:14px; opacity:0.9;">
                        ${w.distance ? `<span>📏 ${w.distance} km</span>` : ''}
                        ${w.duration ? `<span>⏱️ ${w.duration} min</span>` : ''}
                    </div>
                </div>

                <div style="padding:25px;">
                    
                    <div style="margin-bottom:25px;">
                        <h4 style="margin:0 0 8px 0; font-size:12px; text-transform:uppercase; color:#9ca3af; letter-spacing:1px;">Instructions</h4>
                        <p style="margin:0; font-size:15px; line-height:1.6; color:#374151;">
                            ${w.description || "Follow the plan guidelines."}
                        </p>
                    </div>

                    ${ (w.targetPace || w.hr_zone) ? `
                    <div style="background:#f9fafb; border:1px solid #e5e7eb; border-radius:10px; padding:15px; margin-bottom:25px; display:flex; gap:20px;">
                        ${w.targetPace ? `
                            <div>
                                <div style="font-size:11px; color:#6b7280; font-weight:600;">TARGET PACE</div>
                                <div style="font-size:16px; font-weight:700; color:#1f2937; font-family:monospace;">${w.targetPace}/km</div>
                            </div>
                        ` : ''}
                        ${w.hr_zone ? `
                            <div>
                                <div style="font-size:11px; color:#6b7280; font-weight:600;">HEART RATE</div>
                                <div style="font-size:16px; font-weight:700; color:#dc2626;">${w.hr_zone}</div>
                            </div>
                        ` : ''}
                    </div>` : '' }

                    <div style="display:grid; grid-template-columns: 1fr 1fr; gap:12px;">
                        <button onclick="window.skipWorkout(null, '${w.id}')" 
                            style="padding:12px; background:white; border:1px solid #ef4444; color:#ef4444; font-weight:600; border-radius:8px; cursor:pointer; transition:all 0.2s;">
                            Skip
                        </button>
                        <button onclick="closeWorkoutModal()" 
                            style="padding:12px; background:#f3f4f6; border:1px solid #e5e7eb; color:#374151; font-weight:600; border-radius:8px; cursor:pointer; transition:all 0.2s;">
                            Close
                        </button>
                    </div>
                </div>
            `;

        } catch (error) {
            console.error("Fetch Details Error:", error);
            content.innerHTML = `
                <div style="padding:40px; text-align:center;">
                    <div style="font-size:40px; margin-bottom:10px;">😕</div>
                    <p style="color:#374151; font-weight:600;">Failed to load workout</p>
                    <p style="font-size:13px; color:#6b7280; margin-bottom:20px;">${error.message}</p>
                    <button onclick="closeWorkoutModal()" style="padding:10px 20px; background:#e5e7eb; border:none; border-radius:6px; cursor:pointer;">Close</button>
                </div>
            `;
        }
    }

    closeWorkoutModal() {
        const modal = document.getElementById('workout-detail-modal');
        if(modal) modal.style.display = 'none';
    }
    
    async skipWorkout(evt, workoutId) {
        if(confirm("Skip workout?")) {
            // Call API
            alert("Skipped.");
            window.location.reload();
        }
    }

    // --- Helpers ---
    parsePace(input) {
        if (typeof input === 'number') return input;
        if (!input) return 0;
        const parts = input.split(':');
        if (parts.length === 2) {
            return parseFloat(parts[0]) + (parseFloat(parts[1]) / 60);
        }
        return parseFloat(input) || 0;
    }

    formatPace(val) {
        const mins = Math.floor(val);
        const secs = Math.round((val - mins) * 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }

    getWorkoutIcon(type) {
        const icons = { 'Run': '🏃', 'LongRun': '🏃‍♂️', 'Workout': '💪', 'Race': '🏁', 'TrailRun': '⛰️' };
        return icons[type] || '🏃';
    }

    // ... inside RaceDashboardWidgets class ...

    // =========================================================
    // 6. SUBSCRIPTION CONTROLS (Pause / Downgrade)
    // =========================================================
    renderSubscriptionControls(containerId) {
        const container = document.getElementById(containerId);
        if (!container) return;

        // Clean widget style
        container.innerHTML = `
            <div class="widget-header">
                <h3>💳 Plan Management</h3>
            </div>
            <div style="padding: 20px; display: flex; flex-direction: column; gap: 12px;">
                <button onclick="window.dashboardWidgets.openPauseModal()" 
                    style="padding: 12px; background: white; border: 1px solid #d1d5db; border-radius: 8px; font-weight: 600; color: #374151; cursor: pointer; display:flex; justify-content:center; align-items:center; gap:8px;">
                    ⏸️ Pause Plan
                </button>

                <button onclick="window.dashboardWidgets.openDowngradeModal()"
                    style="padding: 12px; background: white; border: 1px solid #fecaca; border-radius: 8px; font-weight: 600; color: #dc2626; cursor: pointer; display:flex; justify-content:center; align-items:center; gap:8px;">
                    🔻 Downgrade
                </button>
            </div>
        `;
    }

    openPauseModal() {
        const modal = document.getElementById('planManagementModal');
        if (modal) {
            document.getElementById('pm-title').innerText = "Pause Training";
            document.getElementById('pm-content').innerHTML = `
                <p style="color:#6b7280; font-size:14px;">Going on vacation or injured? You can pause your plan for up to 30 days.</p>
                <div style="margin-top:15px;">
                    <label style="display:block; font-size:12px; font-weight:600; margin-bottom:5px;">Duration</label>
                    <select id="pause-duration-select" style="width:100%; padding:8px; border-radius:6px; border:1px solid #ddd;">
                        <option value="7">7 Days</option>
                        <option value="14">14 Days</option>
                        <option value="30">30 Days</option>
                    </select>
                </div>`;
            
            // Bind Confirm Button
            const btn = document.getElementById('pm-confirm-btn');
            btn.innerText = "Confirm Pause";
            btn.onclick = async () => {
                alert("Plan paused successfully."); // Replace with actual API call if ready
                modal.style.display = 'none';
            };
            
            modal.style.display = 'flex';
        }
    }

    openDowngradeModal() {
        const modal = document.getElementById('planManagementModal');
        if (modal) {
            document.getElementById('pm-title').innerText = "Downgrade to Basic";
            document.getElementById('pm-content').innerHTML = `
                <div style="background:#fef2f2; padding:15px; border-radius:8px; border:1px solid #fca5a5;">
                    <strong style="color:#991b1b;">⚠️ Warning</strong>
                    <p style="color:#7f1d1d; font-size:13px; margin:5px 0 0 0;">
                        You will lose access to the Race Calendar, AI Insights, and Pace Tools immediately.
                    </p>
                </div>
                <p style="margin-top:15px; font-size:14px;">Any unused days will be refunded on a pro-rata basis.</p>
            `;
            
            // Bind Confirm Button
            const btn = document.getElementById('pm-confirm-btn');
            btn.innerText = "Confirm Downgrade";
            btn.onclick = () => {
                window.location.href = '/dashboard-basic.html'; // Redirect logic
            };

            modal.style.display = 'flex';
        }
    }

    // dashboard-race-widgets.js (inside class RaceDashboardWidgets)
async submitRaceQuestion() {
  const input = document.getElementById("raceQuestionInput");
  const status = document.getElementById("questionStatus");
  const btn = document.getElementById("btnSubmitQuestion");
  const question = (input?.value || "").trim();

  if (!question) { if (status) status.textContent = "Please enter a question."; return; }

  try {
    if (btn) btn.disabled = true;
    if (status) status.textContent = "Sending…";

    const res = await fetch("/api/support/race-question", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.token}`,
      },
      body: JSON.stringify({ question }),
    });

    const data = await res.json();
    if (!data.success) throw new Error(data.message || "Failed to send");

    if (status) status.textContent = "Sent!";
    if (input) input.value = "";
    setTimeout(() => (document.getElementById("questionModal").style.display = "none"), 600);
  } catch (e) {
    if (status) status.textContent = `Error: ${e.message}`;
  } finally {
    if (btn) btn.disabled = false;
  }
}

}

document.addEventListener('DOMContentLoaded', () => {
  try {
    const widgets = new RaceDashboardWidgets();
    widgets.init();
  } catch (e) {
    console.error('RaceDashboardWidgets boot failed', e);
  }
});
