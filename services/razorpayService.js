const Razorpay = require('razorpay');
const crypto = require('crypto');

class RazorpayService {
    constructor() {
        this.razorpay = new Razorpay({
            key_id: process.env.RAZORPAY_KEY_ID,
            key_secret: process.env.RAZORPAY_KEY_SECRET
        });
        
        const mode = process.env.RAZORPAY_KEY_ID?.startsWith('rzp_test') ? 'TEST' : 'LIVE';
        console.log('✅ Razorpay initialized in', mode, 'mode');
        
        // ✅ Validate webhook secret exists
        if (process.env.NODE_ENV === 'production' && !process.env.RAZORPAY_WEBHOOK_SECRET) {
            console.error('⚠️ WARNING: RAZORPAY_WEBHOOK_SECRET not set - webhooks will be rejected!');
        }
    }

    // Create a subscription plan
    async createPlan(planData) {
        try {
            const plan = await this.razorpay.plans.create({
                period: planData.period || 'monthly',
                interval: planData.interval || 1,
                item: {
                    name: planData.name,
                    description: planData.description,
                    amount: planData.amount * 100, // Convert to paise
                    currency: 'INR'
                },
                notes: planData.notes || {}
            });
            
            console.log('✅ Plan created:', plan.id);
            return plan;
        } catch (error) {
            console.error('❌ Plan creation failed:', error.message);
            throw error;
        }
    }

    // Create a subscription
    async createSubscription(subscriptionData) {
        try {
            const subscription = await this.razorpay.subscriptions.create({
                plan_id: subscriptionData.planId,
                customer_notify: 1,
                total_count: subscriptionData.totalCount || 12,
                quantity: 1,
                notes: {
                    userId: subscriptionData.userId,
                    userEmail: subscriptionData.userEmail,
                    planType: subscriptionData.planType
                },
                notify_info: {
                    notify_phone: subscriptionData.phone || undefined,
                    notify_email: subscriptionData.email
                }
            });
            
            console.log('✅ Subscription created:', subscription.id);
            return subscription;
        } catch (error) {
            console.error('❌ Subscription creation failed:', error.message);
            throw error;
        }
    }

    // Create a one-time payment order
    async createOrder(orderData) {
        try {
            const order = await this.razorpay.orders.create({
                amount: orderData.amount * 100, // Convert to paise
                currency: 'INR',
                receipt: `order_${Date.now()}`,
                notes: {
                    userId: orderData.userId,
                    userEmail: orderData.userEmail,
                    planType: orderData.planType
                }
            });
            
            console.log('✅ Order created:', order.id);
            return order;
        } catch (error) {
            console.error('❌ Order creation failed:', error.message);
            throw error;
        }
    }

    // ✅ Verify payment signature (frontend payment completion)
    verifyPaymentSignature(paymentData) {
        const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = paymentData;
        
        const sign = razorpay_order_id + '|' + razorpay_payment_id;
        const expectedSign = crypto
            .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
            .update(sign.toString())
            .digest('hex');
        
        return razorpay_signature === expectedSign;
    }

    // ✅ UPDATED: Verify webhook signature (backend webhook)
    verifyWebhookSignature(rawBody, webhookSignature) {
        if (!process.env.RAZORPAY_WEBHOOK_SECRET) {
            console.warn('⚠️ Webhook verification skipped (no RAZORPAY_WEBHOOK_SECRET configured)');
            
            // ✅ PRODUCTION: Never skip verification
            if (process.env.NODE_ENV === 'production') {
                console.error('❌ CRITICAL: Webhook secret must be configured in production');
                return false;
            }
            
            return true; // Allow in development only
        }
        
        if (!webhookSignature) {
            console.error('❌ Webhook signature header missing');
            return false;
        }
        
        // ✅ CORRECT: Use raw body Buffer (not stringified JSON)
        const expectedSignature = crypto
            .createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET)
            .update(rawBody) // rawBody must be a Buffer
            .digest('hex');
        
        const isValid = webhookSignature === expectedSignature;
        
        if (!isValid) {
            console.error('❌ Webhook signature mismatch');
            console.error('   Expected (first 20):', expectedSignature.substring(0, 20));
            console.error('   Received (first 20):', webhookSignature.substring(0, 20));
        } else {
            console.log('✅ Webhook signature verified');
        }
        
        return isValid;
    }

    // Fetch subscription details
    async getSubscription(subscriptionId) {
        try {
            const subscription = await this.razorpay.subscriptions.fetch(subscriptionId);
            return subscription;
        } catch (error) {
            console.error('❌ Failed to fetch subscription:', error.message);
            throw error;
        }
    }

    // Cancel subscription
    async cancelSubscription(subscriptionId) {
        try {
            const subscription = await this.razorpay.subscriptions.cancel(subscriptionId);
            console.log('✅ Subscription cancelled:', subscriptionId);
            return subscription;
        } catch (error) {
            console.error('❌ Failed to cancel subscription:', error.message);
            throw error;
        }
    }

    // Fetch payment details
    async getPayment(paymentId) {
        try {
            const payment = await this.razorpay.payments.fetch(paymentId);
            return payment;
        } catch (error) {
            console.error('❌ Failed to fetch payment:', error.message);
            throw error;
        }
    }

    // Create refund
    async createRefund(paymentId, amount) {
        try {
            const refund = await this.razorpay.payments.refund(paymentId, {
                amount: amount * 100 // Convert to paise
            });
            console.log('✅ Refund created:', refund.id);
            return refund;
        } catch (error) {
            console.error('❌ Refund creation failed:', error.message);
            throw error;
        }
    }
}

module.exports = new RazorpayService();
