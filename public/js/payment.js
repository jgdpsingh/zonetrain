// public/js/payment.js - ZONETRAIN PAYMENT INTEGRATION
// Comprehensive payment processing for subscriptions

// ==================== INITIALIZE CONFIG ====================

let RAZORPAY_KEY_ID = null;

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

// Load config when DOM is ready
document.addEventListener('DOMContentLoaded', loadPaymentConfig);

// ==================== UTILITY FUNCTIONS ====================

function getToken() {
    // Try localStorage first (most common)
    const token = localStorage.getItem('userToken');
    if (token) {
        console.log('✅ Token found in localStorage');
        return token;
    }

    // Try cookies as fallback
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

// ==================== SUBSCRIPTION PURCHASE ====================

/**
 * Main function: Purchase subscription
 * Called from dashboard buttons like: purchaseSubscription('basic', 'monthly')
 */
async function purchaseSubscription(planType, billingCycle = 'monthly', promoCode = null) {
    try {
        const token = getToken();
        
        if (!token) {
            console.log('❌ No token, redirecting to login');
            alert('Please log in to continue');
            window.location.href = '/login?redirect=plans';
            return;
        }

        showMessage('Creating payment order...', 'info');

        // Determine amount based on plan type
        const planPrices = {
            'basic': 299,
            'basic_coach': 299,
            'race': 599,
            'race_coach': 599
        };

        const amount = planPrices[planType] || 299;

        console.log('🛒 Initiating purchase:', { planType, amount, billingCycle });

        // Call your app.js endpoint
        const orderResponse = await fetch('/api/payment/create-order', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ 
                planType, 
                amount
            })
        });

        // Check if response is valid
        if (!orderResponse.ok) {
            const errorText = await orderResponse.text();
            console.error('❌ Server error:', orderResponse.status, errorText);
            showMessage(`Server error: ${orderResponse.status}`, 'error');
            return;
        }

        const orderData = await orderResponse.json();

        if (!orderData.success) {
            showMessage('Error: ' + (orderData.message || 'Failed to create order'), 'error');
            console.error('❌ Order creation failed:', orderData);
            return;
        }

        console.log('✅ Order created:', orderData);

        // Check if Razorpay SDK is loaded
        if (typeof Razorpay === 'undefined') {
            showMessage('Razorpay SDK not loaded. Please refresh page.', 'error');
            console.error('❌ Razorpay SDK not available');
            return;
        }

        // Check if we have the key
        if (!RAZORPAY_KEY_ID) {
            showMessage('Razorpay key not configured. Please refresh page.', 'error');
            console.error('❌ Razorpay key not available');
            return;
        }

        console.log('💳 Opening Razorpay with key:', RAZORPAY_KEY_ID.substring(0, 15) + '...');

        // Initialize Razorpay with response format
        const options = {
            key: RAZORPAY_KEY_ID,  // ✅ FIXED: Use loaded variable
            amount: orderData.order.amount * 100, // Convert to paise
            currency: orderData.order.currency || 'INR',
            name: 'ZoneTrain',
            description: `${planType} Plan`,
            order_id: orderData.order.id,
            handler: async function(response) {
                console.log('💰 Payment successful, verifying...');
                await verifyPayment(response, planType);
            },
            prefill: {
                email: localStorage.getItem('userEmail') || ''
            },
            theme: {
                color: '#667eea'
            },
            modal: {
                ondismiss: function() {
                    console.log('⚠️ Payment popup closed by user');
                    showMessage('Payment cancelled', 'info');
                }
            }
        };

        const razorpay = new Razorpay(options);
        razorpay.on('payment.failed', function(response) {
            console.error('❌ Payment failed:', response.error);
            showMessage('Payment failed: ' + response.error.description, 'error');
        });
        razorpay.open();

    } catch (error) {
        console.error('❌ Purchase error:', error);
        showMessage('Failed to initiate payment: ' + error.message, 'error');
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

        console.log('🔍 Verifying payment:', {
            orderId: response.razorpay_order_id,
            paymentId: response.razorpay_payment_id
        });

        // Call your app.js verify endpoint
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
                // Redirect based on plan
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

/**
 * Upgrade subscription
 */
async function upgradeSubscription(newPlan, newBillingCycle = 'monthly', promoCode = null) {
    try {
        const token = getToken();

        // Calculate upgrade cost first
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

        // Show confirmation
        const confirmMessage = `
Upgrade to ${newPlan.toUpperCase()} (${newBillingCycle})

${calculation.promoApplied ? `Original: ₹${calculation.originalAmount}\nDiscount: -₹${calculation.promoApplied.discountAmount}\n` : ''}Amount to pay: ₹${calculation.amountToPay}

Proceed with payment?`;

        if (!confirm(confirmMessage)) {
            return;
        }

        // Proceed with upgrade
        await purchaseSubscription(newPlan, newBillingCycle, promoCode);

    } catch (error) {
        console.error('❌ Upgrade error:', error);
        showMessage('Failed to upgrade. Please try again.', 'error');
    }
}

/**
 * Downgrade subscription
 */
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
            setTimeout(() => {
                window.location.reload();
            }, 2000);
        } else {
            showMessage('❌ ' + result.message, 'error');
        }

    } catch (error) {
        console.error('❌ Downgrade error:', error);
        showMessage('Failed to downgrade. Please try again.', 'error');
    }
}

// ==================== PROMO CODE ====================

/**
 * Apply promo code
 */
async function applyPromoCode(promoCode, planType, billingCycle) {
    try {
        showMessage('Validating promo code...', 'info');

        const response = await fetch('/api/subscription/validate-promo', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                promoCode: promoCode,
                plan: planType,
                billingCycle: billingCycle
            })
        });

        const result = await response.json();

        if (result.success) {
            showMessage(`✅ ${result.description}! Save ₹${result.discountAmount}`, 'success');
            updatePriceDisplay(result.originalAmount, result.discountedAmount, result.discountPercent);
            return result;
        } else {
            showMessage('❌ ' + result.message, 'error');
            return null;
        }

    } catch (error) {
        console.error('❌ Promo error:', error);
        showMessage('Failed to apply promo code', 'error');
        return null;
    }
}

/**
 * Update price display with discount
 */
function updatePriceDisplay(originalAmount, discountedAmount, discountPercent) {
    const priceElement = document.getElementById('plan-price');
    if (priceElement) {
        priceElement.innerHTML = `
            <span style="text-decoration: line-through; color: #999;">₹${originalAmount}</span>
            <span style="font-size: 1.5em; color: #10B981; font-weight: bold;">₹${discountedAmount}</span>
            <span style="color: #10B981; font-size: 0.9em;">(${discountPercent}% off)</span>
        `;
    }
}

// ==================== SUBSCRIPTION MANAGEMENT ====================

/**
 * Cancel subscription
 */
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
            setTimeout(() => {
                window.location.reload();
            }, 2000);
        } else {
            showMessage('❌ ' + result.message, 'error');
        }

    } catch (error) {
        console.error('❌ Cancel error:', error);
        showMessage('Failed to cancel subscription', 'error');
    }
}

/**
 * Get subscription details
 */
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

/**
 * Renew subscription (usually from email link)
 */
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

        // Initialize Razorpay
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

/**
 * Verify renewal payment
 */
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

// Make functions available globally for onclick handlers
window.purchaseSubscription = purchaseSubscription;
window.upgradeSubscription = upgradeSubscription;
window.downgradeSubscription = downgradeSubscription;
window.applyPromoCode = applyPromoCode;
window.cancelSubscription = cancelSubscription;
window.getSubscriptionDetails = getSubscriptionDetails;
window.renewSubscription = renewSubscription;
window.loadPaymentConfig = loadPaymentConfig;

console.log('✅ Payment.js loaded and ready');
