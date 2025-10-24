// ZoneTrain Cookie Consent System
// GDPR/DPDP Compliant - Designed for ZoneTrain Analytics

class ZoneTrainCookies {
    constructor() {
        this.consentKey = 'zt_cookie_consent';
        this.consentVersion = '1.0';
        this.categories = {
            essential: true, // Always true
            analytics: false,
            marketing: false,
            functional: false
        };
        
        console.log('🍪 ZoneTrain Cookie System Initializing...');
        this.init();
    }
    
    init() {
        // Check existing consent
        const existingConsent = this.getConsent();
        
        if (!existingConsent) {
            // Show banner after page loads
            setTimeout(() => this.showBanner(), 1500);
        } else {
            // Apply existing settings
            this.applyConsent(existingConsent);
            console.log('✅ Existing cookie consent applied:', existingConsent.categories);
        }
        
        this.setupEventListeners();
    }
    
    showBanner() {
        console.log('📢 Showing ZoneTrain cookie banner');
        const banner = document.getElementById('ztCookieBanner');
        if (banner) {
            banner.classList.add('show');
        }
    }
    
    hideBanner() {
        const banner = document.getElementById('ztCookieBanner');
        if (banner) {
            banner.classList.remove('show');
        }
    }
    
    showSettings() {
        console.log('⚙️ Opening cookie settings');
        this.loadCurrentSettings();
        const modal = document.getElementById('ztCookieModal');
        if (modal) {
            modal.classList.add('show');
            document.body.style.overflow = 'hidden';
        }
    }
    
    hideSettings() {
        const modal = document.getElementById('ztCookieModal');
        if (modal) {
            modal.classList.remove('show');
            document.body.style.overflow = '';
        }
    }
    
    acceptAll() {
        console.log('✅ User accepted all cookies');
        
        this.categories = {
            essential: true,
            analytics: true,
            marketing: true,
            functional: true
        };
        
        this.saveConsent();
        this.hideBanner();
        this.applyConsent();
        this.showToast('All cookies accepted! ZoneTrain analytics enabled.');
        this.trackConsentAction('accept_all');
    }
    
    declineNonEssential() {
        console.log('❌ User declined non-essential cookies');
        
        this.categories = {
            essential: true,
            analytics: false,
            marketing: false,
            functional: false
        };
        
        this.saveConsent();
        this.hideBanner();
        this.applyConsent();
        this.showToast('Only essential cookies enabled.');
        this.trackConsentAction('decline');
    }
    
    toggleCategory(category) {
        if (category === 'essential') return; // Cannot toggle essential
        
        const toggle = document.getElementById(`zt${category}Toggle`);
        if (toggle && !toggle.classList.contains('disabled')) {
            toggle.classList.toggle('active');
            this.categories[category] = toggle.classList.contains('active');
        }
    }
    
    saveSettings() {
        console.log('💾 Saving ZoneTrain cookie preferences');
        
        // Get current toggle states
        Object.keys(this.categories).forEach(category => {
            if (category === 'essential') {
                this.categories[category] = true;
                return;
            }
            
            const toggle = document.getElementById(`zt${category}Toggle`);
            if (toggle) {
                this.categories[category] = toggle.classList.contains('active');
            }
        });
        
        this.saveConsent();
        this.hideSettings();
        this.hideBanner();
        this.applyConsent();
        this.showToast('Cookie preferences saved!');
        this.trackConsentAction('customize');
    }
    
    loadCurrentSettings() {
        const consent = this.getConsent();
        const currentSettings = consent ? consent.categories : this.categories;
        
        // Update toggle states in modal
        Object.keys(currentSettings).forEach(category => {
            if (category === 'essential') return;
            
            const toggle = document.getElementById(`zt${category}Toggle`);
            if (toggle) {
                if (currentSettings[category]) {
                    toggle.classList.add('active');
                } else {
                    toggle.classList.remove('active');
                }
            }
        });
    }
    
    saveConsent() {
        const consent = {
            version: this.consentVersion,
            timestamp: new Date().toISOString(),
            categories: { ...this.categories },
            userAgent: navigator.userAgent,
            domain: window.location.hostname,
            source: 'zonetrain_banner'
        };
        
        localStorage.setItem(this.consentKey, JSON.stringify(consent));
        
        // Log to backend for compliance
        this.logConsentToBackend(consent);
        
        console.log('📝 ZoneTrain consent saved:', consent.categories);
    }
    
    getConsent() {
        try {
            const consent = localStorage.getItem(this.consentKey);
            return consent ? JSON.parse(consent) : null;
        } catch (error) {
            console.error('Error reading cookie consent:', error);
            return null;
        }
    }
    
    applyConsent(consent = null) {
        const currentConsent = consent || this.getConsent();
        if (!currentConsent) return;
        
        const categories = currentConsent.categories;
        
        console.log('🔧 Applying ZoneTrain cookie settings:', categories);
        
        // Apply analytics cookies
        if (categories.analytics) {
            this.enableAnalytics();
        } else {
            this.disableAnalytics();
        }
        
        // Apply marketing cookies
        if (categories.marketing) {
            this.enableMarketing();
        } else {
            this.disableMarketing();
        }
        
        // Apply functional cookies
        if (categories.functional) {
            this.enableFunctional();
        } else {
            this.disableFunctional();
        }
        
        // Notify other scripts
        window.dispatchEvent(new CustomEvent('ztCookieConsentChange', {
            detail: { categories, source: 'zonetrain' }
        }));
    }
    
    enableAnalytics() {
        console.log('📊 Enabling ZoneTrain analytics tracking');
        
        // For ZoneTrain: Track analysis completions, user journeys, conversions
        window.ztAnalyticsEnabled = true;
        
        // Initialize your preferred analytics (Google Analytics, Mixpanel, etc.)
        if (typeof gtag !== 'undefined') {
            gtag('consent', 'update', {
                'analytics_storage': 'granted'
            });
        }
        
        // Track key ZoneTrain events
        this.trackEvent('analytics_enabled', {
            source: 'cookie_consent',
            timestamp: new Date().toISOString()
        });
    }
    
    disableAnalytics() {
        console.log('🚫 Disabling analytics tracking');
        
        window.ztAnalyticsEnabled = false;
        
        if (typeof gtag !== 'undefined') {
            gtag('consent', 'update', {
                'analytics_storage': 'denied'
            });
        }
        
        // Clear analytics cookies
        this.deleteCookie('_ga');
        this.deleteCookie('_gid');
        this.deleteCookie('_gat');
    }
    
    enableMarketing() {
        console.log('📢 Enabling marketing cookies for retargeting');
        
        window.ztMarketingEnabled = true;
        
        // For ZoneTrain: Enable retargeting for users who completed analysis but didn't upgrade
        // Facebook Pixel, Google Ads, etc.
        
        this.trackEvent('marketing_enabled', {
            source: 'cookie_consent'
        });
    }
    
    disableMarketing() {
        console.log('🚫 Disabling marketing cookies');
        
        window.ztMarketingEnabled = false;
        
        // Clear marketing cookies
        this.deleteCookie('_fbp');
        this.deleteCookie('_fbc');
    }
    
    enableFunctional() {
        console.log('⚙️ Enabling functional cookies');
        
        window.ztFunctionalEnabled = true;
        
        // For ZoneTrain: Remember user preferences, analysis history, etc.
    }
    
    disableFunctional() {
        console.log('🚫 Disabling functional cookies');
        
        window.ztFunctionalEnabled = false;
    }
    
    deleteCookie(name) {
        const domains = [
            '',
            `.${window.location.hostname}`,
            window.location.hostname
        ];
        
        domains.forEach(domain => {
            document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; domain=${domain}`;
        });
    }
    
    logConsentToBackend(consent) {
        fetch('/api/cookie-consent', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(consent)
        }).then(response => {
            if (response.ok) {
                console.log('✅ Consent logged to ZoneTrain backend');
            }
        }).catch(error => {
            console.warn('⚠️ Failed to log consent:', error.message);
        });
    }
    
    trackConsentAction(action) {
        const consent = this.getConsent();
        if (consent && consent.categories.analytics) {
            console.log('📈 Tracking consent action:', action);
            this.trackEvent('cookie_consent_action', {
                action: action,
                categories: consent.categories
            });
        }
    }
    
    trackEvent(eventName, data = {}) {
        // Only track if analytics consent is given
        if (!this.hasConsent('analytics')) return;
        
        console.log('📊 ZoneTrain tracking:', eventName, data);
        
        // Add your analytics tracking code here
        if (typeof gtag !== 'undefined') {
            gtag('event', eventName, {
                event_category: 'zonetrain_cookies',
                event_label: data.action || 'cookie_system',
                custom_parameters: data
            });
        }
        
        // Send to your backend analytics
        fetch('/api/analytics/track', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                event: eventName,
                data: data,
                timestamp: new Date().toISOString(),
                source: 'zonetrain_cookies'
            })
        }).catch(error => {
            // Silent fail - don't break user experience
            console.warn('Analytics tracking failed:', error);
        });
    }
    
    setupEventListeners() {
        // Close modal when clicking outside
        document.addEventListener('click', (e) => {
            const modal = document.getElementById('ztCookieModal');
            if (modal && e.target === modal) {
                this.hideSettings();
            }
        });
        
        // Handle escape key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.hideSettings();
            }
        });
        
        // Listen for storage changes (multi-tab sync)
        window.addEventListener('storage', (e) => {
            if (e.key === this.consentKey) {
                const newConsent = e.newValue ? JSON.parse(e.newValue) : null;
                if (newConsent) {
                    console.log('🔄 Cookie consent updated from another tab');
                    this.applyConsent(newConsent);
                }
            }
        });
    }
    
    showToast(message) {
        const toast = document.createElement('div');
        toast.className = 'zt-cookie-toast';
        toast.textContent = message;
        document.body.appendChild(toast);
        
        setTimeout(() => {
            toast.style.animation = 'ztSlideOut 0.3s ease';
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }
    
    // Public API methods
    hasConsent(category = null) {
        const consent = this.getConsent();
        if (!consent) return false;
        
        if (category) {
            return consent.categories[category] || false;
        }
        
        return true; // Has some form of consent
    }
    
    updateConsent(categories) {
        Object.assign(this.categories, categories);
        this.saveConsent();
        this.applyConsent();
    }
    
    revokeConsent() {
        console.log('🗑️ Revoking all cookie consent');
        localStorage.removeItem(this.consentKey);
        this.categories = {
            essential: true,
            analytics: false,
            marketing: false,
            functional: false
        };
        this.applyConsent();
        this.showBanner();
        this.showToast('Cookie preferences reset. Please set your preferences again.');
    }
    
    getConsentStatus() {
        const consent = this.getConsent();
        return consent ? consent.categories : null;
    }
}

// Initialize ZoneTrain Cookie System
let ztCookies;
document.addEventListener('DOMContentLoaded', function() {
    ztCookies = new ZoneTrainCookies();
    
    // Make it globally available
    window.ztCookies = ztCookies;
});

console.log('🍪 ZoneTrain Cookie Management System Loaded');
