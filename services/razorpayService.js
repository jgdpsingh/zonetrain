const Razorpay = require('razorpay');
const crypto = require('crypto');

class RazorpayService {
    constructor() {
        this.razorpay = new Razorpay({
            key_id: process.env.RAZORPAY_KEY_ID,
            key_secret: process.env.RAZORPAY_KEY_SECRET
        });
        
        console.log('✅ Razorpay initialized in', 
            process.env.RAZORPAY_KEY_ID.startsWith('rzp_test') ? 'TEST' : 'LIVE', 
            'mode'
        );
    }

    // Create a subscription plan
    async createPlan(planData) {
        try {
            const plan = await this.razorpay.plans.create({
                period: planData.period || 'monthly', // monthly, yearly
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
            console.error('❌ Plan creation failed:', error);
            throw error;
        }
    }

    // Create a subscription
    async createSubscription(subscriptionData) {
        try {
            const subscription = await this.razorpay.subscriptions.create({
                plan_id: subscriptionData.planId,
                customer_notify: 1,
                total_count: subscriptionData.totalCount || 12, // 12 months for yearly
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
            console.error('❌ Subscription creation failed:', error);
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
            console.error('❌ Order creation failed:', error);
            throw error;
        }
    }

    // Verify payment signature
    verifyPaymentSignature(paymentData) {
        const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = paymentData;
        
        const sign = razorpay_order_id + '|' + razorpay_payment_id;
        const expectedSign = crypto
            .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
            .update(sign.toString())
            .digest('hex');
        
        return razorpay_signature === expectedSign;
    }

    // Verify webhook signature
    verifyWebhookSignature(webhookBody, webhookSignature) {
    if (!process.env.RAZORPAY_WEBHOOK_SECRET) {
        console.log('⚠️ Webhook verification skipped (no secret configured)');
        return true; // Allow in development
    }
    
    const expectedSignature = crypto
        .createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET)
        .update(JSON.stringify(webhookBody))
        .digest('hex');
    
    return webhookSignature === expectedSignature;
}

    // Fetch subscription details
    async getSubscription(subscriptionId) {
        try {
            const subscription = await this.razorpay.subscriptions.fetch(subscriptionId);
            return subscription;
        } catch (error) {
            console.error('❌ Failed to fetch subscription:', error);
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
            console.error('❌ Failed to cancel subscription:', error);
            throw error;
        }
    }

    // Fetch payment details
    async getPayment(paymentId) {
        try {
            const payment = await this.razorpay.payments.fetch(paymentId);
            return payment;
        } catch (error) {
            console.error('❌ Failed to fetch payment:', error);
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
            console.error('❌ Refund creation failed:', error);
            throw error;
        }
    }
}

module.exports = new RazorpayService();
