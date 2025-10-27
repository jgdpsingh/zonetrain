// Enhanced Calendar Dropdown Manager
(function() {
    let calendarData = {
        currentMonth: new Date(),
        workouts: [],
        userProfile: null,
        raceDate: null,
        isOpen: false
    };

    window.toggleCalendar = function(e) {
        if (e) {
            e.preventDefault();
            e.stopPropagation();
        }
        
        const panel = document.getElementById('calendar-panel');
        const dropdown = document.getElementById('profile-dropdown');
        const notificationPanel = document.getElementById('notification-panel');
        
        if (!panel) return;
        
        calendarData.isOpen = !calendarData.isOpen;
        
        if (calendarData.isOpen) {
            panel.style.display = 'block';
            if (dropdown) dropdown.style.display = 'none';
            if (notificationPanel) notificationPanel.style.display = 'none';
            loadCalendarData();
        } else {
            panel.style.display = 'none';
        }
    };

    async function loadCalendarData() {
    const token = localStorage.getItem('userToken');
    if (!token) return;

    try {
        // Load workouts (required)
        const workoutsRes = await fetch('/api/workouts/calendar', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        if (workoutsRes.ok) {
            const data = await workoutsRes.json();
            calendarData.workouts = data.workouts || [];
        }

        // Load profile (optional - for race date)
        try {
            const profileRes = await fetch('/api/user/profile', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            
            if (profileRes.ok) {
                const profileData = await profileRes.json();
                
                // Extract race date from the response
                if (profileData.raceDate) {
                    calendarData.raceDate = new Date(profileData.raceDate);
                }
                
                calendarData.userProfile = {
                    name: profileData.name,
                    email: profileData.email,
                    planType: profileData.planType,
                    raceName: profileData.raceName,
                    raceDistance: profileData.raceDistance
                };
            }
        } catch (profileError) {
            console.log('Profile not available:', profileError);
            // Continue without race date - not critical
        }
        
        renderCalendar();
    } catch (error) {
        console.error('Calendar load error:', error);
        renderCalendar(); // Show empty calendar
    }
}


    function renderCalendar() {
        const container = document.getElementById('calendar-content');
        if (!container) return;

        const year = calendarData.currentMonth.getFullYear();
        const month = calendarData.currentMonth.getMonth();
        const firstDay = new Date(year, month, 1);
        const lastDay = new Date(year, month + 1, 0);
        const firstDayOfWeek = firstDay.getDay();
        const lastDate = lastDay.getDate();

        // Calculate race countdown
        let raceCountdown = '';
        if (calendarData.raceDate) {
            const today = new Date();
            const daysUntilRace = Math.ceil((calendarData.raceDate - today) / (1000 * 60 * 60 * 24));
            if (daysUntilRace > 0) {
                raceCountdown = `
                    <div class="race-countdown">
                        🏁 Race Day in <strong>${daysUntilRace}</strong> days
                    </div>
                `;
            }
        }

        // Calculate weekly stats
        const weekStats = calculateWeeklyStats();

        let html = `
            <div style="padding: 16px;" onclick="event.stopPropagation()">
                ${raceCountdown}
                
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                    <button class="cal-nav" onclick="window.changeMonth(-1, event); return false;">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="15 18 9 12 15 6"></polyline>
                        </svg>
                    </button>
                    <div class="cal-month-title">${firstDay.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</div>
                    <button class="cal-nav" onclick="window.changeMonth(1, event); return false;">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="9 18 15 12 9 6"></polyline>
                        </svg>
                    </button>
                </div>

                ${weekStats}

                <div class="cal-legend">
                    <span class="leg-item"><span class="leg-dot completed"></span> Done</span>
                    <span class="leg-item"><span class="leg-dot today"></span> Today</span>
                    <span class="leg-item"><span class="leg-dot upcoming"></span> Planned</span>
                </div>

                <div class="cal-grid">
                    <div class="cal-day-name">S</div>
                    <div class="cal-day-name">M</div>
                    <div class="cal-day-name">T</div>
                    <div class="cal-day-name">W</div>
                    <div class="cal-day-name">T</div>
                    <div class="cal-day-name">F</div>
                    <div class="cal-day-name">S</div>
        `;

        // Previous month days
        const prevLastDate = new Date(year, month, 0).getDate();
        for (let i = firstDayOfWeek - 1; i >= 0; i--) {
            html += `<div class="cal-day other">${prevLastDate - i}</div>`;
        }

        // Current month days
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        for (let day = 1; day <= lastDate; day++) {
            const date = new Date(year, month, day);
            const dateStr = date.toISOString().split('T')[0];
            const workout = calendarData.workouts.find(w => w.date && w.date.split('T')[0] === dateStr);

            let classes = ['cal-day'];
            let emoji = '';
            let isRaceDay = false;

            // Check if race day
            if (calendarData.raceDate && 
                date.toDateString() === calendarData.raceDate.toDateString()) {
                isRaceDay = true;
                classes.push('race-day');
                emoji = '🏁';
            } else if (date.toDateString() === today.toDateString()) {
                classes.push('today');
            } else if (workout) {
                if (workout.status === 'completed') {
                    classes.push('completed');
                    emoji = '✓';
                } else if (date > today) {
                    classes.push('upcoming');
                    emoji = '•';
                }
            }

            const clickHandler = workout ? `onclick="window.showWorkoutModal('${dateStr}', event)"` : '';

            html += `
                <div class="${classes.join(' ')}" ${clickHandler} title="${workout ? workout.type : (isRaceDay ? 'Race Day!' : '')}">
                    <span class="cal-day-num">${day}</span>
                    ${emoji ? `<span class="cal-emoji">${emoji}</span>` : ''}
                </div>
            `;
        }

        // Next month days
        const totalCells = firstDayOfWeek + lastDate;
        const remainingCells = 42 - totalCells;
        for (let day = 1; day <= remainingCells; day++) {
            html += `<div class="cal-day other">${day}</div>`;
        }

        html += `</div></div>`;
        container.innerHTML = html;
    }

    function calculateWeeklyStats() {
        const today = new Date();
        const startOfWeek = new Date(today);
        startOfWeek.setDate(today.getDate() - today.getDay());
        startOfWeek.setHours(0, 0, 0, 0);
        
        const endOfWeek = new Date(startOfWeek);
        endOfWeek.setDate(startOfWeek.getDate() + 6);
        endOfWeek.setHours(23, 59, 59, 999);

        const weekWorkouts = calendarData.workouts.filter(w => {
            const workoutDate = new Date(w.date);
            return workoutDate >= startOfWeek && workoutDate <= endOfWeek;
        });

        const completed = weekWorkouts.filter(w => w.status === 'completed').length;
        const total = weekWorkouts.length;
        const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;

        return `
            <div class="week-summary">
                <div class="week-title">This Week</div>
                <div class="week-stats">
                    <span>${completed}/${total} completed</span>
                    <div class="week-progress">
                        <div class="week-progress-bar" style="width: ${percentage}%"></div>
                    </div>
                    <span class="week-percentage">${percentage}%</span>
                </div>
            </div>
        `;
    }

    window.showWorkoutModal = function(dateStr, event) {
        if (event) {
            event.stopPropagation();
            event.preventDefault();
        }

        const workout = calendarData.workouts.find(w => w.date && w.date.split('T')[0] === dateStr);
        if (!workout) return;

        const modal = document.createElement('div');
        modal.className = 'workout-modal-overlay';
        modal.onclick = (e) => {
            if (e.target === modal) closeWorkoutModal();
        };

        const statusBadge = workout.status === 'completed' 
            ? '<span class="status-badge completed">✓ Completed</span>'
            : '<span class="status-badge pending">Pending</span>';

        const completionButton = workout.status !== 'completed'
            ? `<button class="btn-complete" onclick="window.markWorkoutComplete('${workout.id}', event)">Mark as Complete</button>`
            : '';

        modal.innerHTML = `
            <div class="workout-modal" onclick="event.stopPropagation()">
                <div class="modal-header">
                    <h3>${workout.type.toUpperCase()} RUN</h3>
                    <button class="modal-close" onclick="window.closeWorkoutModal()">×</button>
                </div>
                <div class="modal-body">
                    ${statusBadge}
                    <div class="workout-date">${new Date(workout.date).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</div>
                    
                    <div class="workout-details">
                        ${workout.description ? `<p class="workout-desc">${workout.description}</p>` : ''}
                        
                        <div class="workout-stats">
                            ${workout.distance ? `<div class="stat"><span class="stat-label">Distance:</span> <span class="stat-value">${workout.distance}</span></div>` : ''}
                            ${workout.duration ? `<div class="stat"><span class="stat-label">Duration:</span> <span class="stat-value">${workout.duration}</span></div>` : ''}
                            ${workout.pace ? `<div class="stat"><span class="stat-label">Pace:</span> <span class="stat-value">${workout.pace}</span></div>` : ''}
                            ${workout.zone ? `<div class="stat"><span class="stat-label">HR Zone:</span> <span class="stat-value">${workout.zone}</span></div>` : ''}
                        </div>
                    </div>
                </div>
                <div class="modal-footer">
                    ${completionButton}
                    <button class="btn-cancel" onclick="window.closeWorkoutModal()">Close</button>
                </div>
            </div>
        `;

        document.body.appendChild(modal);
        setTimeout(() => modal.classList.add('active'), 10);
    };

    window.closeWorkoutModal = function() {
        const modal = document.querySelector('.workout-modal-overlay');
        if (modal) {
            modal.classList.remove('active');
            setTimeout(() => modal.remove(), 200);
        }
    };

    window.markWorkoutComplete = async function(workoutId, event) {
        if (event) event.stopPropagation();

        const token = localStorage.getItem('userToken');
        if (!token) return;

        try {
            const response = await fetch(`/api/workouts/${workoutId}/complete`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                }
            });

            if (response.ok) {
                // Update local data
                const workout = calendarData.workouts.find(w => w.id === workoutId);
                if (workout) workout.status = 'completed';
                
                // Refresh calendar
                renderCalendar();
                closeWorkoutModal();
                
                // Show success message
                showToast('✓ Workout marked as complete!');
            }
        } catch (error) {
            console.error('Error marking workout complete:', error);
            showToast('❌ Failed to update workout');
        }
    };

    function showToast(message) {
        const toast = document.createElement('div');
        toast.className = 'toast-notification';
        toast.textContent = message;
        document.body.appendChild(toast);
        
        setTimeout(() => toast.classList.add('show'), 10);
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }

    window.changeMonth = function(delta, event) {
        if (event) {
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
        }
        
        calendarData.currentMonth.setMonth(calendarData.currentMonth.getMonth() + delta);
        renderCalendar();
        
        const panel = document.getElementById('calendar-panel');
        if (panel) {
            panel.style.display = 'block';
            calendarData.isOpen = true;
        }
        
        return false;
    };

    document.addEventListener('click', function(e) {
        if (!calendarData.isOpen) return;
        
        const panel = document.getElementById('calendar-panel');
        const btn = document.getElementById('calendar-btn');

        if (!panel || !btn) return;

        const isClickInsidePanel = panel.contains(e.target);
        const isClickOnButton = btn.contains(e.target);

        if (!isClickInsidePanel && !isClickOnButton) {
            panel.style.display = 'none';
            calendarData.isOpen = false;
        }
    }, true);
})();
