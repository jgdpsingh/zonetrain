// public/js/payment.js - ZONETRAIN PAYMENT INTEGRATION
// Comprehensive payment processing with billing cycles and promo codes

// ==================== INITIALIZE CONFIG ====================

let RAZORPAY_KEY_ID = null;
let currentPromoCode = null;
let promoDiscount = 0;
let selectedBillingCycle = 'monthly';

async function loadPaymentConfig() {
    try {
        const token = getToken();
        if (!token) {
            console.warn('⚠️ No token for config load');
            return;
        }

        const response = await fetch('/api/payment/config', {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });

        const config = await response.json();
        
        if (config.success && config.key) {
            RAZORPAY_KEY_ID = config.key;
            window.RAZORPAY_KEY_ID = RAZORPAY_KEY_ID;
            const mode = config.testMode ? '🧪 TEST MODE' : '🟢 LIVE MODE';
            console.log(`✅ Razorpay key loaded [${mode}]`);
        } else {
            console.error('❌ Failed to load Razorpay config:', config);
        }
    } catch (error) {
        console.error('❌ Config load error:', error);
    }
}

document.addEventListener('DOMContentLoaded', loadPaymentConfig);

// ==================== PRICING DATA ====================

// ==================== PRICING DATA ====================

const basePrices = {
    basic: 199,
    race: 399
};

// Pricing with built-in cycle discounts
// Monthly: no discount
// Quarterly: 10% discount (199*3*0.9 = 537, so ₹179/month effective)
// Annual: 20% discount (199*12*0.8 = 1912.80, so ₹159.40/month effective)
const pricingData = {
    basic: {
        monthly: 199,           // ₹199/month
        quarterly: 537,         // ₹179/month (199*3*0.9) - 10% off
        annual: 1912.80         // ₹159.40/month (199*12*0.8) - 20% off
    },
    race: {
        monthly: 399,           // ₹399/month
        quarterly: 1077,        // ₹359/month (399*3*0.9) - 10% off
        annual: 3830.40         // ₹319.20/month (399*12*0.8) - 20% off
    }
};

const periodText = {
    monthly: '/month',
    quarterly: '/quarter',
    annual: '/year'
};

// Savings calculation (what user saves by choosing longer plan)
const cycleSavings = {
    basic: {
        monthly: 0,
        quarterly: Math.floor(199 * 3 - 537),     // ₹60 saved (10% of ₹597)
        annual: Math.floor(199 * 12 - 1912.80)    // ₹478 saved (20% of ₹2388)
    },
    race: {
        monthly: 0,
        quarterly: Math.floor(399 * 3 - 1077),    // ₹120 saved (10% of ₹1197)
        annual: Math.floor(399 * 12 - 3830.40)    // ₹958 saved (20% of ₹4788)
    }
};

const validPromoCodes = {
    'LAUNCH50': { discount: 50, description: 'Launch Offer' },
    'EARLY50': { discount: 50, description: 'Early Bird Special' },
    'RUNNER50': { discount: 50, description: 'Runner Special' }
};


// ==================== UTILITY FUNCTIONS ====================

function getToken() {
    const token = localStorage.getItem('userToken');
    if (token) {
        console.log('✅ Token found in localStorage');
        return token;
    }

    const cookieToken = getCookie('userToken');
    if (cookieToken) {
        console.log('✅ Token found in cookie');
        return cookieToken;
    }

    console.error('❌ No token found');
    return null;
}

function getCookie(name) {
    const value = `; ${document.cookie}`;
    const parts = value.split(`; ${name}=`);
    if (parts.length === 2) return parts.pop().split(';').shift();
    return null;
}

function showMessage(message, type = 'info') {
    let messageDiv = document.getElementById('payment-message');
    if (!messageDiv) {
        messageDiv = document.createElement('div');
        messageDiv.id = 'payment-message';
        document.body.appendChild(messageDiv);
    }

    messageDiv.textContent = message;
    messageDiv.className = `payment-message ${type}`;
    messageDiv.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        padding: 15px 20px;
        border-radius: 8px;
        z-index: 10000;
        font-weight: 500;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        animation: slideIn 0.3s ease;
    `;

    if (type === 'success') {
        messageDiv.style.background = '#10B981';
        messageDiv.style.color = 'white';
    } else if (type === 'error') {
        messageDiv.style.background = '#EF4444';
        messageDiv.style.color = 'white';
    } else {
        messageDiv.style.background = '#3B82F6';
        messageDiv.style.color = 'white';
    }

    setTimeout(() => {
        messageDiv.style.display = 'none';
    }, 5000);
}

// ==================== BILLING CYCLE FUNCTIONS ====================

function scrollToPlans() {
    const plansSection = document.getElementById('plans-section');
    if (plansSection) {
        plansSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    return false;
}

function setBillingCycle(cycle) {
    selectedBillingCycle = cycle;
    console.log('💳 Billing cycle selected:', cycle);
    
    // Update button states
    document.querySelectorAll('.cycle-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    
    // Find the clicked button and add active class
    const buttons = document.querySelectorAll('.cycle-btn');
    buttons.forEach(btn => {
        if (btn.textContent.includes(cycle.charAt(0).toUpperCase() + cycle.slice(1))) {
            btn.classList.add('active');
        }
    });
    
    console.log('🔄 Calling updatePlanPrices...');
    updatePlanPrices();
}

// ==================== PROMO CODE FUNCTIONS ====================

function validatePromoCode() {
    const input = document.getElementById('promoCodeInput');
    const code = input.value.toUpperCase().trim();
    
    if (code && validPromoCodes[code]) {
        input.style.borderColor = '#10b981';
    } else if (code) {
        input.style.borderColor = '#ef4444';
    } else {
        input.style.borderColor = 'white';
    }
}

function applyPromo() {
    const input = document.getElementById('promoCodeInput');
    const messageDiv = document.getElementById('promo-message');
    const code = input.value.toUpperCase().trim();
    
    if (!code) {
        messageDiv.textContent = '⚠️ Please enter a promo code';
        messageDiv.className = 'promo-message error';
        return;
    }
    
    const promo = validPromoCodes[code];
    
    if (promo) {
        currentPromoCode = code;
        promoDiscount = promo.discount;
        
        messageDiv.textContent = `✅ ${promo.description} - 50% OFF applied!`;
        messageDiv.className = 'promo-message success';
        
        console.log('🎉 Promo applied:', code, '- Discount:', promoDiscount);
        updatePlanPrices(); // IMPORTANT: Call this to update display
        localStorage.setItem('appliedPromo', code);
        
    } else {
        messageDiv.textContent = '❌ Invalid code. Try LAUNCH50';
        messageDiv.className = 'promo-message error';
        currentPromoCode = null;
        promoDiscount = 0;
        console.log('❌ Invalid promo code');
        updatePlanPrices(); // IMPORTANT: Call this to reset display
    }
}


function updatePlanPrices() {
    console.log('🔄 updatePlanPrices called - Cycle:', selectedBillingCycle, 'Promo:', promoDiscount);
    
    // Get prices for selected cycle (already includes cycle discount)
    const basicCyclePrice = pricingData.basic[selectedBillingCycle];
    const raceCyclePrice = pricingData.race[selectedBillingCycle];
    
    console.log('💰 Prices:', { basicCyclePrice, raceCyclePrice });
    
    // Get period text
    const period = periodText[selectedBillingCycle];
    
    // CALCULATE FINAL PRICES
    let basicFinal, raceFinal;
    
    if (promoDiscount > 0) {
        // WITH PROMO - Apply 50% discount
        basicFinal = Math.floor(basicCyclePrice * 0.5); // 50% of cycle price
        raceFinal = Math.floor(raceCyclePrice * 0.5);
        console.log('✅ With Promo:', { basicFinal, raceFinal });
    } else {
        // NO PROMO - Use full cycle price
        basicFinal = Math.floor(basicCyclePrice);
        raceFinal = Math.floor(raceCyclePrice);
        console.log('📌 No Promo:', { basicFinal, raceFinal });
    }
    
    // UPDATE BASIC COACH
    const basicAmountEl = document.getElementById('basic-amount');
    const basicPeriodEl = document.getElementById('basic-period');
    const basicOriginalEl = document.getElementById('basic-original');
    const basicDiscountEl = document.getElementById('basic-discount');
    
    if (basicAmountEl) {
        basicAmountEl.textContent = `₹${basicFinal}`;
        console.log('✏️ Updated basic-amount to:', basicFinal);
    }
    
    if (basicPeriodEl) {
        basicPeriodEl.textContent = period;
        console.log('✏️ Updated basic-period to:', period);
    }
    
    if (promoDiscount > 0) {
        if (basicOriginalEl) basicOriginalEl.style.display = 'inline';
        if (basicOriginalEl) basicOriginalEl.textContent = `₹${Math.floor(basicCyclePrice)}`;
        if (basicDiscountEl) basicDiscountEl.style.display = 'inline-block';
    } else {
        if (basicOriginalEl) basicOriginalEl.style.display = 'none';
        if (basicDiscountEl) basicDiscountEl.style.display = 'none';
    }
    
    // UPDATE RACE COACH
    const raceAmountEl = document.getElementById('race-amount');
    const racePeriodEl = document.getElementById('race-period');
    const raceOriginalEl = document.getElementById('race-original');
    const raceDiscountEl = document.getElementById('race-discount');
    
    if (raceAmountEl) {
        raceAmountEl.textContent = `₹${raceFinal}`;
        console.log('✏️ Updated race-amount to:', raceFinal);
    }
    
    if (racePeriodEl) {
        racePeriodEl.textContent = period;
        console.log('✏️ Updated race-period to:', period);
    }
    
    if (promoDiscount > 0) {
        if (raceOriginalEl) raceOriginalEl.style.display = 'inline';
        if (raceOriginalEl) raceOriginalEl.textContent = `₹${Math.floor(raceCyclePrice)}`;
        if (raceDiscountEl) raceDiscountEl.style.display = 'inline-block';
    } else {
        if (raceOriginalEl) raceOriginalEl.style.display = 'none';
        if (raceDiscountEl) raceDiscountEl.style.display = 'none';
    }
    
    updateSavingsText();
}



function updateSavingsText() {
    const basicSavingsEl = document.getElementById('basic-savings');
    const raceSavingsEl = document.getElementById('race-savings');
    
    if (!basicSavingsEl || !raceSavingsEl) {
        console.warn('⚠️ Savings elements not found');
        return;
    }
    
    if (selectedBillingCycle === 'monthly') {
        basicSavingsEl.textContent = 'No extra fees';
        raceSavingsEl.textContent = 'No extra fees';
    } else if (selectedBillingCycle === 'quarterly') {
        basicSavingsEl.textContent = `Save ₹${cycleSavings.basic.quarterly} (10% off)`;
        raceSavingsEl.textContent = `Save ₹${cycleSavings.race.quarterly} (10% off)`;
    } else if (selectedBillingCycle === 'annual') {
        basicSavingsEl.textContent = `Save ₹${cycleSavings.basic.annual} (20% off)`;
        raceSavingsEl.textContent = `Save ₹${cycleSavings.race.annual} (20% off)`;
    }
}


function initiateUpgrade(planType) {
    const promo = currentPromoCode || localStorage.getItem('appliedPromo');
    
    // Get price for selected cycle (includes cycle discount)
    const cyclePrice = pricingData[planType][selectedBillingCycle];
    
    // Apply promo discount if any
    const finalAmount = promo ? Math.floor(cyclePrice * (1 - promoDiscount / 100)) : Math.floor(cyclePrice);
    
    console.log('🛒 Upgrade:', { 
        planType, 
        billingCycle: selectedBillingCycle, 
        cyclePrice,
        promoDiscount,
        promo, 
        finalAmount 
    });
    
    purchaseSubscriptionWithPromo(planType, selectedBillingCycle, finalAmount, promo);
}


// ==================== SUBSCRIPTION PURCHASE ====================

async function purchaseSubscriptionWithPromo(planType, billingCycle = 'monthly', amount = null, promoCode = null) {
    try {
        const token = getToken();
        
        if (!token) {
            alert('Please log in to continue');
            window.location.href = '/login';
            return;
        }

        showMessage('Creating payment order...', 'info');

        const basePriceData = pricingData[planType] || { monthly: 199 };
        const orderAmount = amount || Math.floor(basePriceData[billingCycle]);

        const orderResponse = await fetch('/api/payment/create-order', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ 
                planType, 
                billingCycle,
                amount: orderAmount,
                promoCode: promoCode
            })
        });

        if (!orderResponse.ok) {
            const errorText = await orderResponse.text();
            console.error('Server error:', orderResponse.status);
            showMessage(`Server error: ${orderResponse.status}`, 'error');
            return;
        }

        const orderData = await orderResponse.json();

        if (!orderData.success) {
            showMessage('Error: ' + (orderData.message || 'Failed to create order'), 'error');
            return;
        }

        if (typeof Razorpay === 'undefined') {
            showMessage('Razorpay SDK not loaded. Please refresh.', 'error');
            return;
        }

        if (!RAZORPAY_KEY_ID) {
            showMessage('Razorpay key not configured.', 'error');
            return;
        }

        const options = {
            key: RAZORPAY_KEY_ID,
            amount: orderData.order.amount * 100,
            currency: orderData.order.currency || 'INR',
            name: 'ZoneTrain',
            description: `${planType} Plan (${billingCycle}) ${promoCode ? '(Promo: ' + promoCode + ')' : ''}`,
            order_id: orderData.order.id,
            handler: async function(response) {
                await verifyPayment(response, planType);
            },
            prefill: {
                email: localStorage.getItem('userEmail') || ''
            },
            theme: { color: '#667eea' },
            modal: {
                ondismiss: function() {
                    showMessage('Payment cancelled', 'info');
                }
            }
        };

        const razorpay = new Razorpay(options);
        razorpay.open();

    } catch (error) {
        console.error('Purchase error:', error);
        showMessage('Failed to initiate payment', 'error');
    }
}

async function verifyPayment(response, planType) {
    try {
        const token = getToken();
        
        if (!token) {
            showMessage('Session expired. Redirecting...', 'error');
            setTimeout(() => window.location.href = '/login', 2000);
            return;
        }

        showMessage('Verifying payment...', 'info');

        const verifyResponse = await fetch('/api/payment/verify', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                razorpay_order_id: response.razorpay_order_id,
                razorpay_payment_id: response.razorpay_payment_id,
                razorpay_signature: response.razorpay_signature,
                planType: planType
            })
        });

        const result = await verifyResponse.json();

        if (result.success) {
            console.log('✅ Payment verified successfully');
            showMessage('✅ Payment successful!', 'success');
            setTimeout(() => {
                if (planType.includes('race')) {
                    window.location.href = '/dashboard-race?payment=success';
                } else {
                    window.location.href = '/dashboard-basic?payment=success';
                }
            }, 2000);
        } else {
            console.error('❌ Verification failed:', result);
            showMessage('❌ Verification failed: ' + result.message, 'error');
        }

    } catch (error) {
        console.error('❌ Verification error:', error);
        showMessage('Verification failed: ' + error.message, 'error');
    }
}

// ==================== UPGRADE/DOWNGRADE ====================

async function upgradeSubscription(newPlan, newBillingCycle = 'monthly', promoCode = null) {
    try {
        const token = getToken();

        showMessage('Calculating upgrade cost...', 'info');

        const calcResponse = await fetch('/api/subscription/calculate-upgrade', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                newPlan: newPlan,
                billingCycle: newBillingCycle,
                promoCode: promoCode
            })
        });

        const calcData = await calcResponse.json();

        if (!calcData.success) {
            showMessage('Error: ' + calcData.message, 'error');
            return;
        }

        const calculation = calcData.calculation;

        const confirmMessage = `Upgrade to ${newPlan.toUpperCase()} (${newBillingCycle})\n\n${calculation.promoApplied ? `Original: ₹${calculation.originalAmount}\nDiscount: -₹${calculation.promoApplied.discountAmount}\n` : ''}Amount to pay: ₹${calculation.amountToPay}\n\nProceed with payment?`;

        if (!confirm(confirmMessage)) {
            return;
        }

        await purchaseSubscriptionWithPromo(newPlan, newBillingCycle, calculation.amountToPay, promoCode);

    } catch (error) {
        console.error('❌ Upgrade error:', error);
        showMessage('Failed to upgrade. Please try again.', 'error');
    }
}

async function downgradeSubscription(newPlan) {
    try {
        const token = getToken();

        if (!confirm(`Are you sure you want to downgrade to ${newPlan}?\n\nThis will take effect at the end of your current billing period.`)) {
            return;
        }

        showMessage('Processing downgrade...', 'info');

        const response = await fetch('/api/subscription/downgrade', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ newPlan: newPlan })
        });

        const result = await response.json();

        if (result.success) {
            showMessage('✅ ' + result.message, 'success');
            setTimeout(() => window.location.reload(), 2000);
        } else {
            showMessage('❌ ' + result.message, 'error');
        }

    } catch (error) {
        console.error('❌ Downgrade error:', error);
        showMessage('Failed to downgrade. Please try again.', 'error');
    }
}

// ==================== SUBSCRIPTION MANAGEMENT ====================

async function cancelSubscription(reason = null) {
    try {
        const token = getToken();

        if (!confirm('Are you sure you want to cancel your subscription?\n\nYou will have access until the end of your billing period.')) {
            return;
        }

        showMessage('Cancelling subscription...', 'info');

        const response = await fetch('/api/subscription/cancel', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ reason: reason })
        });

        const result = await response.json();

        if (result.success) {
            showMessage('✅ ' + result.message, 'success');
            setTimeout(() => window.location.reload(), 2000);
        } else {
            showMessage('❌ ' + result.message, 'error');
        }

    } catch (error) {
        console.error('❌ Cancel error:', error);
        showMessage('Failed to cancel subscription', 'error');
    }
}

async function getSubscriptionDetails() {
    try {
        const token = getToken();

        const response = await fetch('/api/subscription/details', {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });

        const result = await response.json();

        if (result.success) {
            return result.subscription;
        } else {
            console.error('Failed to get subscription details');
            return null;
        }

    } catch (error) {
        console.error('❌ Get details error:', error);
        return null;
    }
}

// ==================== RENEWAL ====================

async function renewSubscription(token, plan, billingCycle) {
    try {
        showMessage('Creating renewal order...', 'info');

        const response = await fetch('/api/subscription/create-renewal-order', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                token: token,
                plan: plan,
                billingCycle: billingCycle
            })
        });

        const orderData = await response.json();

        if (!orderData.success) {
            showMessage('Error: ' + orderData.message, 'error');
            return;
        }

        const options = {
            key: RAZORPAY_KEY_ID,
            amount: orderData.order.amount * 100,
            currency: orderData.order.currency,
            name: 'ZoneTrain',
            description: `Renewal - ${plan} Plan`,
            order_id: orderData.order.orderId,
            handler: async function(response) {
                await verifyRenewalPayment(response, token);
            },
            prefill: {
                email: orderData.order.email
            },
            theme: {
                color: '#667eea'
            }
        };

        const razorpay = new Razorpay(options);
        razorpay.open();

    } catch (error) {
        console.error('❌ Renewal error:', error);
        showMessage('Failed to process renewal', 'error');
    }
}

async function verifyRenewalPayment(response, token) {
    try {
        showMessage('Verifying payment...', 'info');

        const verifyResponse = await fetch('/api/subscription/verify-renewal', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                token: token,
                paymentId: response.razorpay_payment_id,
                orderId: response.razorpay_order_id,
                signature: response.razorpay_signature
            })
        });

        const result = await verifyResponse.json();

        if (result.success) {
            showMessage('✅ Renewal successful!', 'success');
            setTimeout(() => {
                window.location.href = '/dashboard?renewal=success';
            }, 2000);
        } else {
            showMessage('❌ Payment verification failed', 'error');
        }

    } catch (error) {
        console.error('❌ Renewal verify error:', error);
        showMessage('Payment verification failed', 'error');
    }
}

// ==================== EXPORT TO GLOBAL ====================

// Initialize on page load
document.addEventListener('DOMContentLoaded', function() {
    updateSavingsText();
    updatePlanPrices();
    
    const savedPromo = localStorage.getItem('appliedPromo');
    if (savedPromo && validPromoCodes[savedPromo]) {
        document.getElementById('promoCodeInput').value = savedPromo;
        promoDiscount = validPromoCodes[savedPromo].discount;
        updatePlanPrices();
        const msg = document.getElementById('promo-message');
        msg.textContent = `✅ ${validPromoCodes[savedPromo].description} - 50% OFF applied!`;
        msg.className = 'promo-message success';
    }
});

window.purchaseSubscriptionWithPromo = purchaseSubscriptionWithPromo;
window.upgradeSubscription = upgradeSubscription;
window.downgradeSubscription = downgradeSubscription;
window.cancelSubscription = cancelSubscription;
window.getSubscriptionDetails = getSubscriptionDetails;
window.renewSubscription = renewSubscription;
window.scrollToPlans = scrollToPlans;
window.setBillingCycle = setBillingCycle;
window.applyPromo = applyPromo;
window.validatePromoCode = validatePromoCode;
window.initiateUpgrade = initiateUpgrade;

console.log('✅ Payment.js loaded and ready');
