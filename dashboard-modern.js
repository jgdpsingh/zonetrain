// ZoneTrain Modern Dashboard - Integrated Functionality
class ZoneTrainDashboard {
    constructor() {
        this.dashboardData = null;
        this.isLoading = false;
        this.accessControl = null;
        this.init();
    }

    async init() {
        console.log('🚀 ZoneTrain Dashboard initializing...');
        
        // Check authentication
        if (!this.checkAuth()) {
            return;
        }

        // Initialize access control
        this.initAccessControl();
        
        // Load dashboard data
        await this.loadDashboardData();
        
        // Handle URL parameters
        this.handleUrlParameters();
        
        // Initialize member since date
        this.initMemberSince();
        
        console.log('✅ Dashboard ready');
    }

    checkAuth() {
        const token = localStorage.getItem('userToken');
        if (!token) {
            console.log('❌ No authentication token found');
            window.location.href = '/';
            return false;
        }
        return true;
    }

    initAccessControl() {
        // Initialize access control for premium features
        document.querySelectorAll('.feature-card.locked').forEach(card => {
            card.addEventListener('click', (e) => {
                e.preventDefault();
                const feature = card.dataset.feature;
                this.showUpgradeModal(feature);
            });
        });
    }

    async loadDashboardData() {
        if (this.isLoading) return;
        this.isLoading = true;

        try {
            this.showLoadingState();
            
            const token = localStorage.getItem('userToken');
            const response = await fetch('/api/dashboard/data', {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                }
            });

            console.log('📡 Dashboard API response:', response.status);

            if (response.ok) {
                this.dashboardData = await response.json();
                console.log('📊 Dashboard data:', this.dashboardData);
                this.updateUI();
            } else {
                console.error('❌ Dashboard API error:', response.status);
                this.showErrorState();
            }
        } catch (error) {
            console.error('💥 Dashboard load error:', error);
            this.showErrorState();
        } finally {
            this.isLoading = false;
        }
    }

    updateUI() {
        if (!this.dashboardData?.success) {
            console.error('❌ Invalid dashboard data');
            this.showErrorState();
            return;
        }

        const { user, strava, latestAnalysis } = this.dashboardData.data;
        
        // Update user info
        this.updateUserInfo(user);
        
        // Update quick stats
        this.updateQuickStats(strava, latestAnalysis);
        
        // Update zone analysis card
        this.updateZoneAnalysisCard(strava, latestAnalysis);
        
        console.log('✅ UI updated successfully');
    }

    updateUserInfo(user) {
        // Update navigation user info
        const userName = document.getElementById('userName');
        const userStatus = document.getElementById('userStatus');
        const userAvatar = document.getElementById('userAvatar');
        
        if (userName) {
            userName.textContent = `Welcome, ${user.name}!`;
        }
        
        if (userStatus) {
            const status = user.subscriptionStatus?.toUpperCase() || 'FREE';
            userStatus.textContent = `${status} ACCOUNT`;
            userStatus.className = `user-status ${user.subscriptionStatus || 'free'}`;
        }
        
        if (userAvatar) {
            userAvatar.textContent = user.name?.charAt(0)?.toUpperCase() || 'U';
        }

        // Update settings modal
        const settingsStatus = document.getElementById('settingsStatus');
        if (settingsStatus) {
            settingsStatus.textContent = user.subscriptionStatus?.toUpperCase() || 'Free';
        }
    }

    updateQuickStats(strava, latestAnalysis) {
        const stravaStatus = document.getElementById('stravaStatus');
        const lastActivity = document.getElementById('lastActivity');
        const totalAnalyses = document.getElementById('totalAnalyses');

        if (stravaStatus) {
            stravaStatus.textContent = strava.connected ? 'Connected' : 'Disconnected';
            stravaStatus.style.color = strava.connected ? 'var(--zt-success)' : 'var(--zt-danger)';
        }

        if (lastActivity && latestAnalysis) {
            const date = this.parseDate(latestAnalysis.date);
            lastActivity.textContent = date ? this.formatRelativeDate(date) : '--';
        }

        if (totalAnalyses) {
            // You can track this in your backend
            totalAnalyses.textContent = latestAnalysis ? '1+' : '0';
        }
    }

    updateZoneAnalysisCard(strava, latestAnalysis) {
        this.hideAllStates();

        if (!strava.connected) {
            console.log('👤 Showing connect state');
            this.showState('connectState');
        } else if (latestAnalysis) {
            console.log('📊 Showing results state');
            this.showResultsState(latestAnalysis);
        } else {
            console.log('🎯 Showing ready state');
            this.showState('readyState');
        }
    }

    showResultsState(latestAnalysis) {
        this.showState('resultsState');
        
        const analysisDate = document.getElementById('analysisDate');
        const aiInsight = document.getElementById('aiInsight');

        if (analysisDate) {
            const date = this.parseDate(latestAnalysis.date);
            if (date) {
                analysisDate.textContent = `Last analyzed: ${this.formatDate(date)}`;
            } else {
                analysisDate.textContent = 'Last analyzed: Recently';
            }
        }

        if (aiInsight && latestAnalysis.summary) {
            const insightSpan = aiInsight.querySelector('span');
            if (insightSpan) {
                insightSpan.textContent = latestAnalysis.summary;
            }
        }
    }

    // State management
    showLoadingState() {
        this.hideAllStates();
        this.showState('loadingState');
    }

    showErrorState() {
        this.hideAllStates();
        // Create error state if it doesn't exist
        const analysisContent = document.getElementById('analysisContent');
        if (analysisContent && !document.getElementById('errorState')) {
            const errorState = document.createElement('div');
            errorState.id = 'errorState';
            errorState.className = 'content-state';
            errorState.innerHTML = `
                <div class="action-content">
                    <h4>⚠️ Something went wrong</h4>
                    <p>Unable to load your dashboard data. Please try again.</p>
                    <button class="zt-btn secondary" onclick="dashboard.loadDashboardData()">
                        <i class="fas fa-retry"></i> Retry
                    </button>
                </div>
            `;
            analysisContent.appendChild(errorState);
        }
        this.showState('errorState');
    }

    hideAllStates() {
        const states = ['loadingState', 'connectState', 'readyState', 'resultsState', 'errorState'];
        states.forEach(stateId => {
            const element = document.getElementById(stateId);
            if (element) {
                element.style.display = 'none';
            }
        });
    }

    showState(stateId) {
        const element = document.getElementById(stateId);
        if (element) {
            element.style.display = 'flex';
        }
    }

    // Date utilities
    parseDate(dateInput) {
        try {
            if (!dateInput) return null;
            
            if (dateInput.seconds) {
                return new Date(dateInput.seconds * 1000);
            } else if (dateInput._seconds) {
                return new Date(dateInput._seconds * 1000);
            } else if (typeof dateInput === 'string') {
                return new Date(dateInput);
            } else {
                return new Date(dateInput);
            }
        } catch (error) {
            console.error('Date parsing error:', error);
            return null;
        }
    }

    formatDate(date) {
        if (!date || isNaN(date.getTime())) return 'Recently';
        
        return date.toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    }

    formatRelativeDate(date) {
        if (!date || isNaN(date.getTime())) return '--';
        
        const now = new Date();
        const diffTime = Math.abs(now - date);
        const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
        
        if (diffDays === 0) return 'Today';
        if (diffDays === 1) return 'Yesterday';
        if (diffDays < 7) return `${diffDays} days ago`;
        
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }

    // Action handlers
    connectStrava() {
        const token = localStorage.getItem('userToken');
        console.log('🔗 Connecting to Strava...');
        
        if (!token) {
            alert('Please login first');
            window.location.href = '/';
            return;
        }
        
        window.location.href = `/strava-connect?userToken=${encodeURIComponent(token)}`;
    }

    runFirstAnalysis() {
        console.log('🏃 Running zone analysis...');
        const token = localStorage.getItem('userToken');
        
        if (!token) {
            alert('Please login first');
            return;
        }
        
        window.location.href = `/run-analysis?token=${encodeURIComponent(token)}`;
    }

    viewDetailedAnalysis() {
        console.log('📊 Viewing detailed analysis...');
        const token = localStorage.getItem('userToken');
        
        if (!token) {
            alert('Please login first');
            return;
        }
        
        window.location.href = `/run-analysis?token=${encodeURIComponent(token)}`;
    }

    refreshAnalysis() {
        console.log('🔄 Refreshing analysis...');
        this.viewDetailedAnalysis();
    }

    viewPlans() {
        console.log('💰 Opening plans...');
        window.location.href = '/plans.html';
    }

    // Modal handlers
    openSettings() {
        const modal = document.getElementById('settingsModal');
        if (modal) {
            modal.classList.add('active');
        }
    }

    closeSettings() {
        const modal = document.getElementById('settingsModal');
        if (modal) {
            modal.classList.remove('active');
        }
    }

    showUpgradeModal(feature) {
        const modal = document.createElement('div');
        modal.className = 'access-modal';
        modal.innerHTML = `
            <div class="modal-content">
                <div class="modal-header">
                    <h3><i class="fas fa-crown"></i> Upgrade Required</h3>
                    <button class="close-btn" onclick="this.closest('.access-modal').remove()">&times;</button>
                </div>
                <div class="modal-body">
                    <p>This feature requires a Pro subscription to unlock advanced coaching capabilities.</p>
                    ${feature ? `<p><strong>Feature:</strong> ${this.getFeatureName(feature)}</p>` : ''}
                </div>
                <div class="modal-footer">
                    <button class="zt-btn secondary" onclick="this.closest('.access-modal').remove()">Maybe Later</button>
                    <button class="zt-btn upgrade" onclick="window.location.href='/plans.html'">
                        <i class="fas fa-rocket"></i> Upgrade Now
                    </button>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        
        // Auto-remove after 10 seconds
        setTimeout(() => {
            if (document.body.contains(modal)) {
                modal.remove();
            }
        }, 10000);
    }

    getFeatureName(feature) {
        const names = {
            'hrv-coaching': 'HRV-Based Coaching',
            'whatsapp-coaching': 'WhatsApp Daily Reports',
            'advanced-analytics': 'Advanced Performance Analytics',
            'race-planning': 'Race Strategy Planning'
        };
        return names[feature] || 'Premium Feature';
    }

    logout() {
        if (confirm('Are you sure you want to logout?')) {
            localStorage.removeItem('userToken');
            localStorage.removeItem('userId');
            localStorage.removeItem('userEmail');
            window.location.href = '/';
        }
    }

    // URL parameter handling
    handleUrlParameters() {
        const urlParams = new URLSearchParams(window.location.search);
        
        if (urlParams.get('strava') === 'connected') {
            console.log('✅ Strava connection success detected');
            setTimeout(() => {
                this.showSuccessMessage('Strava connected successfully!');
                this.cleanUrl();
                this.loadDashboardData();
            }, 1000);
        }

        if (urlParams.get('error')) {
            const error = urlParams.get('error');
            console.log('❌ Error detected:', error);
            setTimeout(() => {
                this.showErrorMessage('Connection failed. Please try again.');
                this.cleanUrl();
            }, 1000);
        }
    }

    cleanUrl() {
        window.history.replaceState({}, document.title, window.location.pathname);
    }

    showSuccessMessage(message) {
        this.showToast(message, 'success');
    }

    showErrorMessage(message) {
        this.showToast(message, 'error');
    }

    showToast(message, type = 'info') {
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.style.cssText = `
            position: fixed;
            top: 2rem;
            right: 2rem;
            background: var(--zt-bg-secondary);
            color: var(--zt-text-primary);
            padding: 1rem 1.5rem;
            border-radius: var(--zt-radius);
            border: 1px solid var(--zt-border);
            box-shadow: var(--zt-shadow);
            z-index: 3000;
            animation: slideIn 0.3s ease;
        `;
        
        if (type === 'success') {
            toast.style.borderColor = 'var(--zt-success)';
            message = '✅ ' + message;
        } else if (type === 'error') {
            toast.style.borderColor = 'var(--zt-danger)';
            message = '❌ ' + message;
        }
        
        toast.textContent = message;
        document.body.appendChild(toast);
        
        setTimeout(() => {
            toast.style.animation = 'slideOut 0.3s ease';
            setTimeout(() => {
                if (document.body.contains(toast)) {
                    toast.remove();
                }
            }, 300);
        }, 3000);
    }

    initMemberSince() {
        const memberSince = document.getElementById('memberSince');
        if (memberSince) {
            memberSince.textContent = new Date().toLocaleDateString();
        }
    }

    // Debug method
    debug() {
        console.log('=== DASHBOARD DEBUG ===');
        console.log('Dashboard data:', this.dashboardData);
        console.log('User token:', localStorage.getItem('userToken') ? 'Present' : 'Missing');
        console.log('Is loading:', this.isLoading);
        console.log('Auth status:', this.checkAuth());
    }
}

// Add CSS animations
const style = document.createElement('style');
style.textContent = `
    @keyframes slideIn {
        from { transform: translateX(100%); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
    }
    
    @keyframes slideOut {
        from { transform: translateX(0); opacity: 1; }
        to { transform: translateX(100%); opacity: 0; }
    }
`;
document.head.appendChild(style);

// Initialize dashboard when DOM is ready
let dashboard;
document.addEventListener('DOMContentLoaded', function() {
    dashboard = new ZoneTrainDashboard();
});

// Global function handlers for HTML onclick events
function connectStrava() { dashboard?.connectStrava(); }
function runFirstAnalysis() { dashboard?.runFirstAnalysis(); }
function viewDetailedAnalysis() { dashboard?.viewDetailedAnalysis(); }
function refreshAnalysis() { dashboard?.refreshAnalysis(); }
function viewPlans() { dashboard?.viewPlans(); }
function openSettings() { dashboard?.openSettings(); }
function closeSettings() { dashboard?.closeSettings(); }
function logout() { dashboard?.logout(); }

// Debug function (call from console)
function debugDashboard() { dashboard?.debug(); }

console.log('🎯 ZoneTrain Dashboard Scripts Loaded - Use debugDashboard() for diagnostics');
