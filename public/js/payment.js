// public/js/payment.js - ZONETRAIN PAYMENT INTEGRATION
// Comprehensive payment processing for subscriptions

// ==================== UTILITY FUNCTIONS ====================

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
        const token = getCookie('userToken');
        if (!token) {
            alert('Please log in to continue');
            window.location.href = '/login?redirect=plans';
            return;
        }

        showMessage('Creating payment order...', 'info');

        // Create order
        const orderResponse = await fetch('/api/subscription/create-order', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ 
                planType, 
                billingCycle,
                promoCode 
            })
        });

        const orderData = await orderResponse.json();

        if (!orderData.success) {
            showMessage('Error: ' + orderData.message, 'error');
            return;
        }

        console.log('✅ Order created:', orderData.order);

        // Initialize Razorpay
        const options = {
            key: orderData.razorpayKey,
            amount: orderData.order.amount * 100, // Convert to paise
            currency: orderData.order.currency || 'INR',
            name: 'ZoneTrain',
            description: orderData.order.planName || `${planType} Plan - ${billingCycle}`,
            order_id: orderData.order.orderId,
            handler: async function(response) {
                console.log('💰 Payment successful');
                await verifyPayment(response, planType, billingCycle);
            },
            prefill: {
                email: orderData.userEmail || localStorage.getItem('userEmail')
            },
            theme: {
                color: '#667eea'
            },
            modal: {
                ondismiss: function() {
                    showMessage('Payment cancelled', 'info');
                }
            }
        };

        const razorpay = new Razorpay(options);
        razorpay.on('payment.failed', function(response) {
            console.error('Payment failed:', response.error);
            showMessage('Payment failed: ' + response.error.description, 'error');
        });
        razorpay.open();

    } catch (error) {
        console.error('Purchase subscription error:', error);
        showMessage('Failed to initiate payment. Please try again.', 'error');
    }
}

/**
 * Verify subscription payment
 */
async function verifyPayment(response, planType, billingCycle) {
    try {
        const token = getCookie('userToken');

        showMessage('Verifying payment...', 'info');

        const verifyResponse = await fetch('/api/subscription/verify-payment', {
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
            showMessage('✅ Payment successful! Redirecting...', 'success');
            setTimeout(() => {
                window.location.href = result.redirect || '/dashboard?payment=success';
            }, 2000);
        } else {
            showMessage('❌ Payment verification failed: ' + result.message, 'error');
        }

    } catch (error) {
        console.error('Payment verification error:', error);
        showMessage('Payment verification failed. Please contact support.', 'error');
    }
}

// ==================== UPGRADE/DOWNGRADE ====================

/**
 * Upgrade subscription
 */
async function upgradeSubscription(newPlan, newBillingCycle = 'monthly', promoCode = null) {
    try {
        const token = getCookie('userToken');

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
        console.error('Upgrade subscription error:', error);
        showMessage('Failed to upgrade. Please try again.', 'error');
    }
}

/**
 * Downgrade subscription
 */
async function downgradeSubscription(newPlan) {
    try {
        const token = getCookie('userToken');

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
        console.error('Downgrade error:', error);
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
        console.error('Apply promo error:', error);
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
        const token = getCookie('userToken');

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
        console.error('Cancel subscription error:', error);
        showMessage('Failed to cancel subscription', 'error');
    }
}

/**
 * Get subscription details
 */
async function getSubscriptionDetails() {
    try {
        const token = getCookie('userToken');

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
        console.error('Get subscription details error:', error);
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
            key: orderData.order.razorpayKeyId,
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
        console.error('Renewal error:', error);
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
        console.error('Verify renewal error:', error);
        showMessage('Payment verification failed', 'error');
    }
}

// ==================== MAKE GLOBAL ====================

// Export all functions to window for HTML onclick
window.purchaseSubscription = purchaseSubscription;
window.upgradeSubscription = upgradeSubscription;
window.downgradeSubscription = downgradeSubscription;
window.applyPromoCode = applyPromoCode;
window.cancelSubscription = cancelSubscription;
window.getSubscriptionDetails = getSubscriptionDetails;
window.renewSubscription = renewSubscription;

console.log('✅ Payment.js loaded successfully');
