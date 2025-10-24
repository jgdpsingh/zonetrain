// public/js/accessControl.js
class AccessControlManager {
    constructor() {
        this.userAccess = null;
        this.init();
    }

    async init() {
        await this.loadAccessStatus();
        this.setupAccessControls();
        this.checkSubscriptionExpiry();
    }

    async loadAccessStatus() {
        try {
            const token = localStorage.getItem('userToken');
            if (!token) return;

            const response = await fetch('/api/user/access-status', {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });

            if (response.ok) {
                const data = await response.json();
                this.userAccess = data;
                this.updateUI();
            }
        } catch (error) {
            console.error('Failed to load access status:', error);
        }
    }

    setupAccessControls() {
        // Add click handlers for locked features
        document.querySelectorAll('.feature-locked').forEach(element => {
            element.addEventListener('click', (e) => {
                e.preventDefault();
                const feature = element.dataset.feature;
                this.showUpgradeModal(feature);
            });
        });

        document.querySelectorAll('.btn-upgrade-plan').forEach(btn => {
            btn.addEventListener('click', () => this.openUpgradeModal());
        });

        // ✅ NEW: Downgrade button handler
        document.querySelectorAll('.btn-downgrade-plan').forEach(btn => {
            btn.addEventListener('click', () => this.openDowngradeModal());
        });
    
    }

    async openUpgradeModal() {
        const token = localStorage.getItem('userToken');
        
        try {
            const response = await fetch('/api/subscription/calculate-upgrade', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    newPlan: 'race',
                    billingCycle: 'monthly'
                })
            });

            const data = await response.json();
            
            if (data.success) {
                // Use the upgrade modal component we created earlier
                if (typeof window.openUpgradeModal === 'function') {
                    window.openUpgradeModal();
                } else {
                    this.showUpgradeModalFallback(data.calculation);
                }
            }
        } catch (error) {
            console.error('Error:', error);
            alert('Failed to load upgrade details');
        }
    }

    // ✅ NEW: Downgrade modal
    async openDowngradeModal() {
        const confirmed = confirm(
            'Are you sure you want to downgrade to Basic Coach?\n\n' +
            '• Change will take effect from your next billing date\n' +
            '• You will lose access to race-specific features\n' +
            '• No refund for current billing period'
        );

        if (!confirmed) return;

        const token = localStorage.getItem('userToken');
        
        try {
            const response = await fetch('/api/subscription/downgrade', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ newPlan: 'basic' })
            });

            const data = await response.json();
            
            if (data.success) {
                alert(`✅ Downgrade scheduled!\n\n${data.message}`);
                location.reload();
            } else {
                alert('Downgrade failed: ' + data.message);
            }
        } catch (error) {
            console.error('Downgrade error:', error);
            alert('Failed to process downgrade');
        }
    }

    checkSubscriptionExpiry() {
        if (!this.userAccess?.user) return;

        const { subscriptionEndDate, subscriptionStatus } = this.userAccess.user;
        
        if (subscriptionEndDate) {
            const endDate = new Date(subscriptionEndDate);
            const today = new Date();
            
            if (today > endDate && subscriptionStatus !== 'free') {
                this.showExpiryNotice();
                this.lockAllPaidFeatures();
            }
        }
    }

    lockAllPaidFeatures() {
        document.querySelectorAll('.feature-available').forEach(element => {
            this.addLockOverlay(element, {
                message: 'Your subscription has expired. Please renew to continue.',
                upgradeRequired: true,
                suggestedPlan: this.userAccess.user.currentPlan
            });
        });
    }

    showExpiryNotice() {
        const banner = document.createElement('div');
        banner.className = 'expiry-banner';
        banner.innerHTML = `
            <div class="expiry-content">
                <span>⚠️ Your subscription has expired!</span>
                <button class="btn-renew" onclick="window.location.href='/renew'">Renew Now</button>
            </div>
        `;
        document.body.insertBefore(banner, document.body.firstChild);
    }


    updateUI() {
        if (!this.userAccess) return;

        const { features, user } = this.userAccess;

        // Update each feature in the UI
        Object.keys(features).forEach(feature => {
            const access = features[feature];
            const elements = document.querySelectorAll(`[data-feature="${feature}"]`);

            elements.forEach(element => {
                if (access.hasAccess) {
                    element.classList.remove('feature-locked');
                    element.classList.add('feature-available');
                    
                    // Show usage information
                    if (access.limit !== 'unlimited' && access.currentUsage !== undefined) {
                        this.updateUsageDisplay(element, access);
                    }
                } else {
                    element.classList.add('feature-locked');
                    element.classList.remove('feature-available');
                    this.addLockOverlay(element, access);
                }
            });
        });

        // Update user status display
        this.updateUserStatusDisplay(user);
        this.showUpgradeDowngradeButtons(user);
    }

    updateUsageDisplay(element, access) {
        const usageElement = element.querySelector('.usage-display');
        if (usageElement && access.limit !== 'unlimited') {
            usageElement.textContent = `${access.currentUsage}/${access.limit} used this ${access.period}`;
            
            if (access.remaining <= 1) {
                usageElement.classList.add('usage-warning');
            }
        }
    }

    addLockOverlay(element, access) {
        // Remove existing overlay
        const existingOverlay = element.querySelector('.lock-overlay');
        if (existingOverlay) existingOverlay.remove();

        // Create lock overlay
        const overlay = document.createElement('div');
        overlay.className = 'lock-overlay';
        overlay.innerHTML = `
            <div class="lock-content">
                <i class="fas fa-lock"></i>
                <span class="lock-message">${access.message}</span>
                ${access.upgradeRequired ? '<button class="btn btn-upgrade">Upgrade Now</button>' : ''}
            </div>
        `;

        element.style.position = 'relative';
        element.appendChild(overlay);

        // Add upgrade button handler
        const upgradeBtn = overlay.querySelector('.btn-upgrade');
        if (upgradeBtn) {
            upgradeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.showUpgradeModal(element.dataset.feature, access);
            });
        }
    }

    showUpgradeModal(feature, access) {
        const modal = document.createElement('div');
        modal.className = 'access-modal';
        modal.innerHTML = `
            <div class="modal-content">
                <div class="modal-header">
                    <h3>Upgrade Required</h3>
                    <button class="close-btn" onclick="this.closest('.access-modal').remove()">&times;</button>
                </div>
                <div class="modal-body">
                    <p>${access?.message || `This feature requires a paid subscription.`}</p>
                    ${access?.suggestedPlan ? `<p>Recommended: <strong>${access.suggestedPlan.toUpperCase()} Plan</strong></p>` : ''}
                </div>
                <div class="modal-footer">
                    <button class="btn btn-secondary" onclick="this.closest('.access-modal').remove()">Cancel</button>
                    <button class="btn btn-primary" onclick="window.location.href='/plans.html'">View Plans</button>
                </div>
            </div>
        `;

        document.body.appendChild(modal);
    }

    updateUserStatusDisplay(user) {
        const statusElements = document.querySelectorAll('.user-status');
        statusElements.forEach(element => {
            element.textContent = user.subscriptionStatus.toUpperCase();
            element.className = `user-status status-${user.subscriptionStatus}`;
        });

        // Update trial countdown if applicable
        if (user.subscriptionStatus === 'trial' && user.trialEndDate) {
            this.updateTrialCountdown(user.trialEndDate);
        }
    }

    updateTrialCountdown(trialEndDate) {
        const trialEnd = new Date(trialEndDate);
        const now = new Date();
        const daysLeft = Math.ceil((trialEnd - now) / (1000 * 60 * 60 * 24));

        const countdownElements = document.querySelectorAll('.trial-countdown');
        countdownElements.forEach(element => {
            if (daysLeft > 0) {
                element.textContent = `${daysLeft} days left in trial`;
                element.className = 'trial-countdown trial-active';
            } else {
                element.textContent = 'Trial expired';
                element.className = 'trial-countdown trial-expired';
            }
        });
    }

    // Method to check access before API calls
    async checkFeatureAccess(feature) {
        if (!this.userAccess) {
            await this.loadAccessStatus();
        }

        const access = this.userAccess?.features?.[feature];
        return access?.hasAccess || false;
    }

    // Method for making protected API calls
    async makeProtectedRequest(url, options = {}) {
        const token = localStorage.getItem('userToken');
        if (!token) {
            throw new Error('Authentication required');
        }

        const defaultOptions = {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
                ...options.headers
            }
        };

        const response = await fetch(url, { ...options, headers: defaultOptions.headers });
        
        if (response.status === 403) {
            const error = await response.json();
            if (error.upgradeRequired) {
                this.showUpgradeModal(null, error);
            }
            throw new Error(error.message);
        }

        return response;
    }

    showUpgradeDowngradeButtons(user) {
        const upgradeBtn = document.querySelector('.btn-upgrade-plan');
        const downgradeBtn = document.querySelector('.btn-downgrade-plan');

        if (user.currentPlan === 'basic' && upgradeBtn) {
            upgradeBtn.style.display = 'inline-block';
        }

        if (user.currentPlan === 'race' && downgradeBtn) {
            downgradeBtn.style.display = 'inline-block';
        }
    }
}

// Initialize access control manager
const accessControl = new AccessControlManager();
