// services/subscriptionService.js
const Razorpay = require('razorpay');
const crypto = require('crypto');
const PDFDocument = require('pdfkit');
const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');

class SubscriptionService {
    constructor(db) {
        this.db = db;
        
        // Initialize Razorpay
        this.razorpay = new Razorpay({
            key_id: process.env.RAZORPAY_KEY_ID,
            key_secret: process.env.RAZORPAY_KEY_SECRET
        });
        
        // Pricing (in ₹)
        this.pricing = {
            basic: {
                monthly: 199,
                quarterly: 537,  // Save ₹60
                annual: 1999     // Save ₹389
            },
            race: {
                monthly: 399,
                quarterly: 1077, // Save ₹120
                annual: 3999     // Save ₹789
            }
        };

        this.promoCodes = {
            'RENEW50': {
                type: 'renewal',
                discount: 50,
                description: '50% off on renewal',
                active: true
            },
            'UPGRADE50': {
                type: 'upgrade',
                discount: 50,
                description: '50% off on upgrade',
                active: true
            },
            'LAUNCH50': {
                type: 'all',
                discount: 50,
                description: '50% launch discount',
                active: true
            }
        };
    }

    // Validate promo code
    validatePromoCode(code, transactionType) {
        if (!code || typeof code !== 'string') {
            return { valid: false, error: 'Invalid promo code' };
        }

        const upperCode = code.trim().toUpperCase();
        const promo = this.promoCodes[upperCode];

        console.log('🔍 Validating promo code:', upperCode, 'for', transactionType);

        if (!promo) {
            return { valid: false, error: 'Invalid promo code' };
        }

        if (!promo.active) {
            return { valid: false, error: 'This promo code has expired' };
        }

        if (promo.type !== transactionType && promo.type !== 'all') {
            return { valid: false, error: `This code is only valid for ${promo.type} transactions` };
        }

        console.log('✅ Promo code valid!');
        return { 
            valid: true, 
            discount: promo.discount,
            description: promo.description
        };
    }

    // Apply promo code discount
    applyPromoCode(amount, promoCode, transactionType = 'any') {
        const validation = this.validatePromoCode(promoCode, transactionType);
        
        if (!validation.valid) {
            return { 
                discountedAmount: amount, 
                discount: 0, 
                error: validation.error 
            };
        }

        const discountAmount = Math.floor((amount * validation.discount) / 100);
        const discountedAmount = amount - discountAmount;

        return {
            originalAmount: amount,
            discountAmount: discountAmount,
            discountedAmount: discountedAmount,
            discountPercent: validation.discount,
            promoCode: promoCode.toUpperCase(),
            description: validation.description
        };
    }

    // Create Razorpay order
    async createOrder(userId, planType, billingCycle, promoCode = null) {
        try {
            console.log('💳 Creating order for user:', userId);
            console.log('Plan:', planType, 'Cycle:', billingCycle);

            // Calculate amount with promo
            let amount = this.pricing[planType][billingCycle];
            let promoApplied = null;

            if (promoCode) {
                const result = this.applyPromoCode(amount, promoCode, 'all');
                if (!result.error) {
                    amount = result.discountedAmount;
                    promoApplied = {
                        code: result.promoCode,
                        discount: result.discountPercent,
                        discountAmount: result.discountAmount
                    };
                    console.log('✅ Promo applied:', result.promoCode, '-', result.discountPercent + '%');
                }
            }

            // Create Razorpay order
            const orderOptions = {
                amount: amount * 100, // Convert to paise
                currency: 'INR',
                receipt: `receipt_${userId}_${Date.now()}`,
                notes: {
                    userId: userId,
                    planType: planType,
                    billingCycle: billingCycle,
                    promoCode: promoCode || 'none'
                }
            };

            const order = await this.razorpay.orders.create(orderOptions);
            console.log('✅ Razorpay order created:', order.id);

            // Save order to database
            await this.db.collection('orders').add({
                orderId: order.id,
                userId: userId,
                planType: planType,
                billingCycle: billingCycle,
                amount: amount,
                originalAmount: this.pricing[planType][billingCycle],
                promoApplied: promoApplied,
                status: 'created',
                createdAt: new Date()
            });

            return {
                orderId: order.id,
                amount: amount,
                currency: 'INR',
                planType: planType,
                billingCycle: billingCycle,
                promoApplied: promoApplied
            };

        } catch (error) {
            console.error('❌ Create order error:', error);
            throw error;
        }
    }

    // Verify payment signature
    verifyPaymentSignature(orderId, paymentId, signature) {
        try {
            const text = orderId + '|' + paymentId;
            const generatedSignature = crypto
                .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
                .update(text)
                .digest('hex');

            return generatedSignature === signature;
        } catch (error) {
            console.error('❌ Signature verification error:', error);
            return false;
        }
    }

    // Process payment
    async processPayment(userId, paymentData) {
        try {
            const { orderId, paymentId, signature } = paymentData;
            
            console.log('💰 Processing payment for user:', userId);

            // Verify signature
            const isValid = this.verifyPaymentSignature(orderId, paymentId, signature);
            if (!isValid) {
                throw new Error('Invalid payment signature');
            }

            // Get order details
            const orderSnapshot = await this.db.collection('orders')
                .where('orderId', '==', orderId)
                .limit(1)
                .get();

            if (orderSnapshot.empty) {
                throw new Error('Order not found');
            }

            const orderDoc = orderSnapshot.docs[0];
            const orderData = orderDoc.data();

            // Update order status
            await orderDoc.ref.update({
                status: 'paid',
                paymentId: paymentId,
                paidAt: new Date()
            });

            // Calculate subscription dates
            const now = new Date();
            const endDate = this.calculateEndDate(now, orderData.billingCycle);

            // Update user subscription
            await this.db.collection('users').doc(userId).update({
                subscriptionStatus: 'active',
                currentPlan: orderData.planType,
                billingCycle: orderData.billingCycle,
                subscriptionStartDate: now,
                subscriptionEndDate: endDate,
                currentPrice: orderData.amount,
                lastPaymentDate: now,
                updatedAt: now
            });

            // Create subscription record
            const subscriptionRef = await this.db.collection('subscriptions').add({
                userId: userId,
                planType: orderData.planType,
                billingCycle: orderData.billingCycle,
                status: 'active',
                startDate: now,
                endDate: endDate,
                amount: orderData.amount,
                orderId: orderId,
                paymentId: paymentId,
                promoApplied: orderData.promoApplied,
                createdAt: now
            });

            console.log('✅ Payment processed successfully');

            // Generate and email invoice
            await this.generateAndEmailInvoice(userId, {
                subscriptionId: subscriptionRef.id,
                orderId: orderId,
                paymentId: paymentId,
                planType: orderData.planType,
                billingCycle: orderData.billingCycle,
                amount: orderData.amount,
                originalAmount: orderData.originalAmount,
                promoApplied: orderData.promoApplied,
                date: now
            });

            return {
                success: true,
                subscriptionId: subscriptionRef.id,
                endDate: endDate
            };

        } catch (error) {
            console.error('❌ Process payment error:', error);
            throw error;
        }
    }

    // Calculate subscription end date
    calculateEndDate(startDate, billingCycle) {
        const endDate = new Date(startDate);
        
        switch(billingCycle) {
            case 'monthly':
                endDate.setMonth(endDate.getMonth() + 1);
                break;
            case 'quarterly':
                endDate.setMonth(endDate.getMonth() + 3);
                break;
            case 'annual':
                endDate.setFullYear(endDate.getFullYear() + 1);
                break;
        }
        
        return endDate;
    }

    // Calculate pro-rata upgrade
       // Calculate pro-rata upgrade
    calculateProRataUpgrade(user, newPlan, billingCycle = 'monthly', promoCode = null) {
        // FIX: Handle Free plan or invalid dates (Avoids NaN/null)
        if (!user.currentPlan || user.currentPlan === 'free' || !this.pricing[user.currentPlan]) {
            console.log('ℹ️ User on free plan, calculating full upgrade price');
            
            const newPlanPrice = this.pricing[newPlan][billingCycle];
            let amountToPay = newPlanPrice;
            const originalAmount = newPlanPrice;
            
            // Apply promo logic for fresh upgrade
            let promoApplied = null;
            if (promoCode) {
                const validation = this.validatePromoCode(promoCode, 'upgrade');
                if (validation.valid) {
                    const discountAmount = Math.floor((amountToPay * validation.discount) / 100);
                    amountToPay = Math.max(0, amountToPay - discountAmount);
                    
                    promoApplied = {
                        code: promoCode.toUpperCase(),
                        discount: validation.discount,
                        discountAmount: discountAmount,
                        description: validation.description
                    };
                }
            }

            // Calculate next billing date (full cycle from today)
            const nextBillingDate = this.calculateEndDate(new Date(), billingCycle);

            return {
                currentPlan: 'free',
                newPlan,
                billingCycle,
                daysRemaining: 0,
                unusedCredit: 0,
                proRataCharge: originalAmount,
                originalAmount: originalAmount,
                amountToPay: amountToPay,
                nextBillingAmount: this.pricing[newPlan][billingCycle],
                nextBillingDate: nextBillingDate,
                promoApplied
            };
        }

        // --- Existing logic for Paid-to-Paid upgrades ---
        const currentPlan = user.currentPlan;
        const subscriptionStart = new Date(user.subscriptionStartDate);
        const subscriptionEnd = new Date(user.subscriptionEndDate);
        const today = new Date();

        // Safety check for invalid dates
        if (isNaN(subscriptionStart.getTime()) || isNaN(subscriptionEnd.getTime())) {
             return this.calculateProRataUpgrade({ ...user, currentPlan: 'free' }, newPlan, billingCycle, promoCode);
        }

        // Days calculation
        const totalDays = Math.ceil((subscriptionEnd - subscriptionStart) / (1000 * 60 * 60 * 24));
        const daysRemaining = Math.ceil((subscriptionEnd - today) / (1000 * 60 * 60 * 24));

        // Calculate unused credit
        const currentPlanPrice = this.pricing[currentPlan][user.billingCycle || 'monthly'];
        const unusedCredit = Math.ceil((currentPlanPrice * daysRemaining) / totalDays);

        // New plan pro-rata charge
        const newPlanMonthlyPrice = this.pricing[newPlan].monthly;
        const proRataCharge = Math.ceil((newPlanMonthlyPrice * daysRemaining) / 30);

        // Calculate amount to pay
        let amountToPay = Math.max(0, proRataCharge - unusedCredit);
        const originalAmount = amountToPay;
        
        // Apply promo code
        let promoApplied = null;
        if (promoCode && amountToPay > 0) {
            const validation = this.validatePromoCode(promoCode, 'upgrade');
            
            if (validation.valid) {
                const discountAmount = Math.floor((amountToPay * validation.discount) / 100);
                promoApplied = {
                    code: promoCode.toUpperCase(),
                    discount: validation.discount,
                    discountAmount: discountAmount,
                    description: validation.description
                };
                amountToPay = Math.max(0, amountToPay - discountAmount);
                console.log('✅ Upgrade promo applied! Discount:', discountAmount);
            }
        }

        return {
            currentPlan,
            newPlan,
            billingCycle,
            daysRemaining,
            unusedCredit,
            proRataCharge,
            originalAmount,
            amountToPay,
            nextBillingAmount: this.pricing[newPlan][billingCycle],
            nextBillingDate: subscriptionEnd,
            promoApplied
        };
    }


    // Calculate downgrade with credit
    calculateDowngradeWithCredit(user, newPlan) {
        const currentPlan = user.currentPlan;
        const subscriptionEnd = new Date(user.subscriptionEndDate);
        const billingCycle = user.billingCycle || 'monthly';

        const currentPlanPrice = this.pricing[currentPlan][billingCycle];
        const newPlanPrice = this.pricing[newPlan][billingCycle];
        
        const priceDifference = currentPlanPrice - newPlanPrice;
        const dailyRateNewPlan = newPlanPrice / 30;
        const extraDays = Math.floor(priceDifference / dailyRateNewPlan);
        
        const extendedEndDate = new Date(subscriptionEnd);
        extendedEndDate.setDate(extendedEndDate.getDate() + extraDays);

        return {
            currentPlan,
            newPlan,
            currentPrice: currentPlanPrice,
            newPrice: newPlanPrice,
            creditAmount: priceDifference,
            extraDaysGranted: extraDays,
            originalEndDate: subscriptionEnd,
            extendedEndDate: extendedEndDate,
            billingCycle,
            message: `You've been credited ${extraDays} days of ${newPlan} service`,
            savings: priceDifference
        };
    }

    // Cancel subscription
    async cancelSubscription(userId, reason = null) {
        try {
            console.log('❌ Cancelling subscription for user:', userId);

            const userDoc = await this.db.collection('users').doc(userId).get();
            if (!userDoc.exists) {
                throw new Error('User not found');
            }

            const userData = userDoc.data();
            const accessUntil = userData.subscriptionEndDate?.toDate() || new Date();

            // Update user
            await this.db.collection('users').doc(userId).update({
                subscriptionStatus: 'cancelled',
                cancelledAt: new Date(),
                cancelReason: reason,
                accessUntil: accessUntil,
                updatedAt: new Date()
            });

            // Update subscription records
            const subscriptionSnapshot = await this.db.collection('subscriptions')
                .where('userId', '==', userId)
                .where('status', '==', 'active')
                .get();

            if (!subscriptionSnapshot.empty) {
                const batch = this.db.batch();
                subscriptionSnapshot.docs.forEach(doc => {
                    batch.update(doc.ref, {
                        status: 'cancelled',
                        cancelledAt: new Date(),
                        cancelReason: reason
                    });
                });
                await batch.commit();
            }

            console.log('✅ Subscription cancelled. Access until:', accessUntil);

            return {
                success: true,
                accessUntil: accessUntil
            };

        } catch (error) {
            console.error('❌ Cancel subscription error:', error);
            throw error;
        }
    }

    // Pause subscription for N days (injury, travel, etc.)
async pauseSubscription(userId, durationDays = 14, reason = 'Not specified') {
  try {
    console.log('Pausing subscription for user', userId, 'for', durationDays, 'days');

    if (durationDays <= 0) {
      throw new Error('Pause duration must be at least 1 day.');
    }

    const MAX_DAYS_PER_PAUSE = 60;
    const MAX_PAUSES_PER_CYCLE = 2;   // per billing period
    const MIN_HOURS_BEFORE_RENEWAL = 24; // safety window

    if (durationDays > MAX_DAYS_PER_PAUSE) {
      durationDays = MAX_DAYS_PER_PAUSE;
    }

    const userRef = this.db.collection('users').doc(userId);
    const userDoc = await userRef.get();
    if (!userDoc.exists) throw new Error('User not found');

    const user = userDoc.data();

    if (user.subscriptionStatus !== 'active') {
      throw new Error('Only active subscriptions can be paused.');
    }

    if (!['basic', 'race'].includes(user.currentPlan)) {
      throw new Error('Only Basic Coach and Race Coach plans can be paused.');
    }

    if (!user.subscriptionEndDate) {
      throw new Error('Subscription end date missing; cannot compute pause.');
    }

    const now = new Date();
    const currentEnd = user.subscriptionEndDate.toDate
      ? user.subscriptionEndDate.toDate()
      : new Date(user.subscriptionEndDate);

    // 1) Block pausing too close to renewal (e.g., last 24h)
    const millisUntilEnd = currentEnd.getTime() - now.getTime();
    const hoursUntilEnd = millisUntilEnd / (1000 * 60 * 60);

    if (hoursUntilEnd <= MIN_HOURS_BEFORE_RENEWAL) {
      throw new Error(
        `Your plan renews very soon. Please pause at least ${MIN_HOURS_BEFORE_RENEWAL} hours before the renewal date, or pause after your next billing cycle starts.`
      );
    }

    // 2) Count pauses in current billing period
    //    Optional: store pause history on user doc: pauseHistory: [{ startDate, endDate, reason }]
    const pauseHistory = user.pauseHistory || [];
    const cycleStart = user.subscriptionStartDate?.toDate
      ? user.subscriptionStartDate.toDate()
      : new Date(user.subscriptionStartDate || now);

    const pausesThisCycle = pauseHistory.filter(entry => {
      const start = entry.startDate?.toDate ? entry.startDate.toDate() : new Date(entry.startDate);
      return start >= cycleStart && start <= currentEnd;
    });

    if (pausesThisCycle.length >= MAX_PAUSES_PER_CYCLE) {
      throw new Error(
        `You have already paused your subscription ${MAX_PAUSES_PER_CYCLE} times this billing cycle.`
      );
    }

    // 3) Block "back‑to‑back" pause: user was just auto‑resumed today
    if (user.lastAutoResumeAt) {
      const lastAutoResume = user.lastAutoResumeAt.toDate
        ? user.lastAutoResumeAt.toDate()
        : new Date(user.lastAutoResumeAt);

      const hoursSinceAutoResume =
        (now.getTime() - lastAutoResume.getTime()) / (1000 * 60 * 60);

      if (hoursSinceAutoResume < 24) {
        throw new Error(
          'Your subscription was just resumed. Please wait 24 hours before pausing again.'
        );
      }
    }

    // Compute new end date by adding pause days
    const extendedEnd = new Date(currentEnd.getTime());
    extendedEnd.setDate(extendedEnd.getDate() + durationDays);

    // Compute pause end date (when we auto-resume)
    const pauseEndDate = new Date(now.getTime());
    pauseEndDate.setDate(pauseEndDate.getDate() + durationDays);

    // Append to pause history
    const newHistoryEntry = {
      startDate: now,
      endDate: pauseEndDate,
      durationDays,
      reason,
      createdAt: now
    };

    const updatedHistory = [...pauseHistory, newHistoryEntry];

    await userRef.update({
      subscriptionStatus: 'paused',
      pauseStartDate: now,
      pauseEndDate: pauseEndDate,
      pauseReason: reason,
      previousStatus: user.subscriptionStatus,
      previousPlan: user.currentPlan,
      subscriptionEndDate: extendedEnd,
      pauseHistory: updatedHistory,
      updatedAt: now
    });

    // Mark active subscription record as paused
    const subSnapshot = await this.db.collection('subscriptions')
      .where('userId', '==', userId)
      .where('status', '==', 'active')
      .limit(1)
      .get();

    if (!subSnapshot.empty) {
      const subRef = subSnapshot.docs[0].ref;
      await subRef.update({
        status: 'paused',
        pauseStartDate: now,
        pauseEndDate: pauseEndDate,
        pauseReason: reason,
        updatedAt: now
      });
    }

    // Notification
    const notificationRef = this.db.collection('notifications').doc();
    await notificationRef.set({
      userId,
      type: 'subscriptionpaused',
      title: 'Subscription Paused',
      message: `Your ${user.currentPlan === 'basic' ? 'Basic Coach' : 'Race Coach'} plan is paused until ${pauseEndDate.toDateString()}.`,
      read: false,
      createdAt: now
    });

    console.log('Subscription paused until', pauseEndDate);
    return { success: true, pauseEndDate, extendedEndDate: extendedEnd };
  } catch (error) {
    console.error('Pause subscription error', error);
    throw error;
  }
}


// Resume a paused subscription (manual resume)
async resumeSubscription(userId) {
  try {
    console.log('Resuming subscription for user', userId);

    const userDoc = await this.db.collection('users').doc(userId).get();
    if (!userDoc.exists) throw new Error('User not found');

    const user = userDoc.data();

    if (user.subscriptionStatus !== 'paused') {
      throw new Error('Only paused subscriptions can be resumed.');
    }

    const now = new Date();

    await this.db.collection('users').doc(userId).update({
      subscriptionStatus: 'active',
      pauseStartDate: null,
      pauseEndDate: null,
      pauseReason: null,
      updatedAt: now
    });

    const subSnapshot = await this.db.collection('subscriptions')
      .where('userId', '==', userId)
      .where('status', '==', 'paused')
      .limit(1)
      .get();

    if (!subSnapshot.empty) {
      const subRef = subSnapshot.docs[0].ref;
      await subRef.update({
        status: 'active',
        resumedAt: now,
        updatedAt: now
      });
    }

    const notificationRef = this.db.collection('notifications').doc();
    await notificationRef.set({
      userId,
      type: 'subscriptionresumed',
      title: 'Subscription Resumed',
      message: 'Your subscription has been resumed. Welcome back!',
      read: false,
      createdAt: now
    });

    return { success: true };
  } catch (error) {
    console.error('Resume subscription error', error);
    throw error;
  }
}

// Check for paused subscriptions that should be resumed
async checkPausedSubscriptions() {
  try {
    const now = new Date();
    console.log('Checking for paused subscriptions to resume...');

    const pausedSnapshot = await this.db.collection('users')
      .where('subscriptionStatus', '==', 'paused')
      .where('pauseEndDate', '<=', now)
      .get();

    if (pausedSnapshot.empty) {
      console.log('No paused subscriptions to resume');
      return { resumedCount: 0 };
    }

    const batch = this.db.batch();
    let resumedCount = 0;

    for (const doc of pausedSnapshot.docs) {
      const userId = doc.id;
      const user = doc.data();

      batch.update(doc.ref, {
        subscriptionStatus: 'active',
        pauseStartDate: null,
        pauseEndDate: null,
        pauseReason: null,
        lastAutoResumeAt: now,
        updatedAt: now
      });

      // Update subscription record(s)
      const subSnapshot = await this.db.collection('subscriptions')
        .where('userId', '==', userId)
        .where('status', '==', 'paused')
        .get();

      subSnapshot.docs.forEach(subDoc => {
        batch.update(subDoc.ref, {
          status: 'active',
          resumedAt: now,
          updatedAt: now
        });
      });

      // Notification
      const notificationRef = this.db.collection('notifications').doc();
      batch.set(notificationRef, {
        userId,
        type: 'subscriptionresumed',
        title: 'Subscription Resumed',
        message: 'Your paused subscription has automatically resumed.',
        read: false,
        createdAt: now
      });

      resumedCount++;
      console.log('Auto-resuming subscription for user', userId);
    }

    await batch.commit();
    console.log('Resumed', resumedCount, 'paused subscriptions');
    return { resumedCount };
  } catch (error) {
    console.error('checkPausedSubscriptions error', error);
    throw error;
  }
}


    // Generate invoice PDF
    async generateInvoice(invoiceData) {
        return new Promise((resolve, reject) => {
            try {
                const doc = new PDFDocument({ margin: 50 });
                const invoiceNumber = `INV-${invoiceData.subscriptionId.substring(0, 8).toUpperCase()}`;
                const fileName = `invoice_${invoiceNumber}.pdf`;
                
                // Create temp directory
                const tempDir = path.join(__dirname, '../temp');
                if (!fs.existsSync(tempDir)) {
                    fs.mkdirSync(tempDir, { recursive: true });
                }
                
                const filePath = path.join(tempDir, fileName);
                const stream = fs.createWriteStream(filePath);
                doc.pipe(stream);

                // Header
                doc.fontSize(24).text('INVOICE', { align: 'center' });
                doc.moveDown();
                doc.fontSize(10)
                   .text(`Invoice Number: ${invoiceNumber}`, { align: 'right' })
                   .text(`Date: ${new Date(invoiceData.date).toLocaleDateString('en-IN')}`, { align: 'right' });
                doc.moveDown(2);

                // Company
                doc.fontSize(16).text('ZoneTrain', { underline: true });
                doc.fontSize(10).text('AI-Powered Running Coach');
                doc.moveDown(2);

                // Customer
                doc.fontSize(12).text('Bill To:', { underline: true });
                doc.fontSize(10).text(invoiceData.customerName || 'Valued Customer');
                doc.text(invoiceData.customerEmail || '');
                doc.moveDown(2);

                // Table header
                const tableTop = doc.y;
                doc.fontSize(10).font('Helvetica-Bold');
                doc.text('Description', 50, tableTop, { width: 300 });
                doc.text('Amount', 400, tableTop, { width: 100, align: 'right' });
                
                doc.moveTo(50, doc.y + 5).lineTo(550, doc.y + 5).stroke();
                doc.moveDown();

                // Plan details
                doc.font('Helvetica');
                const planName = this.getPlanName(invoiceData.planType, invoiceData.billingCycle);
                doc.text(planName, 50, doc.y, { width: 300 });
                doc.text(`₹${invoiceData.originalAmount}`, 400, doc.y - 15, { width: 100, align: 'right' });
                doc.moveDown();

                // Discount
                if (invoiceData.promoApplied) {
                    doc.text(`Discount (${invoiceData.promoApplied.code})`, 50, doc.y, { width: 300 });
                    doc.text(`-₹${invoiceData.promoApplied.discountAmount}`, 400, doc.y - 15, { width: 100, align: 'right' });
                    doc.moveDown();
                }

                // Total
                doc.moveDown();
                doc.moveTo(50, doc.y).lineTo(550, doc.y).stroke();
                doc.moveDown();
                doc.font('Helvetica-Bold').fontSize(12);
                doc.text('Total:', 50, doc.y, { width: 300 });
                doc.text(`₹${invoiceData.amount}`, 400, doc.y - 15, { width: 100, align: 'right' });

                // Payment details
                doc.moveDown(2);
                doc.font('Helvetica').fontSize(10);
                doc.text('Payment Details:');
                doc.text(`Payment ID: ${invoiceData.paymentId}`);
                doc.text(`Order ID: ${invoiceData.orderId}`);

                // Footer
                doc.moveDown(3);
                doc.fontSize(8).text('Thank you for your business!', { align: 'center' });

                doc.end();

                stream.on('finish', () => resolve(filePath));
                stream.on('error', reject);

            } catch (error) {
                reject(error);
            }
        });
    }

    // Get plan display name
    getPlanName(planType, billingCycle) {
        const planNames = {
            basic: 'Basic Coach',
            race: 'Race Coach'
        };
        const cycleNames = {
            monthly: 'Monthly',
            quarterly: 'Quarterly',
            annual: 'Annual'
        };
        return `${planNames[planType]} - ${cycleNames[billingCycle]}`;
    }

    // Generate and email invoice
    async generateAndEmailInvoice(userId, invoiceData) {
        try {
            console.log('📄 Generating invoice for user:', userId);

            const userDoc = await this.db.collection('users').doc(userId).get();
            if (!userDoc.exists) throw new Error('User not found');

            const user = userDoc.data();
            invoiceData.customerName = `${user.firstName} ${user.lastName}`;
            invoiceData.customerEmail = user.email;

            const pdfPath = await this.generateInvoice(invoiceData);
            console.log('✅ Invoice PDF generated');

            await this.sendInvoiceEmail(user.email, user.firstName, pdfPath, invoiceData);
            console.log('✅ Invoice emailed');

            // Cleanup
            fs.unlinkSync(pdfPath);

            return true;

        } catch (error) {
            console.error('❌ Generate and email invoice error:', error);
            throw error;
        }
    }

    // Send invoice email
    async sendInvoiceEmail(email, firstName, pdfPath, invoiceData) {
        try {
            const transporter = nodemailer.createTransport({
                host: process.env.EMAIL_HOST,
                port: parseInt(process.env.EMAIL_PORT),
                secure: true,
                auth: {
                    user: process.env.EMAIL_USER,
                    pass: process.env.EMAIL_PASSWORD
                }
            });

            const planName = this.getPlanName(invoiceData.planType, invoiceData.billingCycle);
            const invoiceNumber = `INV-${invoiceData.subscriptionId.substring(0, 8).toUpperCase()}`;

            await transporter.sendMail({
                from: `"ZoneTrain" <${process.env.EMAIL_USER}>`,
                to: email,
                subject: `Invoice for your ${planName} subscription`,
                html: `
                    <div style="font-family: Arial; max-width: 600px; margin: 0 auto;">
                        <div style="background: linear-gradient(135deg, #6B46C1 0%, #8B5CF6 100%); color: white; padding: 30px; text-align: center;">
                            <h1>🏃 Payment Received!</h1>
                        </div>
                        <div style="padding: 30px; background: #f9f9f9;">
                            <h2>Hi ${firstName}!</h2>
                            <p>Thank you for your payment. Your ${planName} subscription is now active!</p>
                            <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0;">
                                <h3>Invoice Details</h3>
                                <p><strong>Invoice:</strong> ${invoiceNumber}</p>
                                <p><strong>Plan:</strong> ${planName}</p>
                                <p><strong>Amount:</strong> ₹${invoiceData.amount}</p>
                                <p><strong>Payment ID:</strong> ${invoiceData.paymentId}</p>
                            </div>
                            <p>Your invoice is attached to this email.</p>
                        </div>
                    </div>
                `,
                attachments: [{
                    filename: `Invoice_${invoiceNumber}.pdf`,
                    path: pdfPath
                }]
            });

        } catch (error) {
            console.error('❌ Send invoice email error:', error);
            throw error;
        }
    }

    // Additional helper methods
    isSubscriptionExpired(user) {
        if (!user.subscriptionEndDate) return true;
        return new Date() > new Date(user.subscriptionEndDate);
    }

    shouldSendRenewalReminder(user) {
        if (!user.subscriptionEndDate) return false;
        const daysUntil = this.getDaysUntilExpiry(user.subscriptionEndDate);
        return daysUntil >= 3 && daysUntil <= 4 && !user.renewalReminderSent;
    }

    getDaysUntilExpiry(endDate) {
        const end = new Date(endDate);
        const today = new Date();
        return Math.ceil((end - today) / (1000 * 60 * 60 * 24));
    }

    getRenewalOptions(user) {
        const currentPlan = user.currentPlan;
        return {
            monthly: {
                price: this.pricing[currentPlan].monthly,
                savings: 0,
                recommended: false
            },
            quarterly: {
                price: this.pricing[currentPlan].quarterly,
                savings: this.calculateSavings(currentPlan, 'quarterly'),
                recommended: false
            },
            annual: {
                price: this.pricing[currentPlan].annual,
                savings: this.calculateSavings(currentPlan, 'annual'),
                recommended: true
            }
        };
    }

    calculateSavings(plan, billingCycle) {
        const monthly = this.pricing[plan].monthly;
        const actual = this.pricing[plan][billingCycle];
        const months = billingCycle === 'annual' ? 12 : billingCycle === 'quarterly' ? 3 : 1;
        return (monthly * months) - actual;
    }

    // ==================== TRIAL MANAGEMENT METHODS ====================

/**
 * Check for expired trials and update users
 * Runs periodically to expire trials that have passed their end date
 */
async checkExpiredTrials() {
    try {
        const now = new Date();
        
        console.log('🔍 Checking for expired trials...');
        
        // Find users with expired trials
        const expiredTrialsSnapshot = await this.db.collection('users')
            .where('subscriptionStatus', '==', 'trial')
            .where('trialEndDate', '<', now)
            .get();
        
        if (expiredTrialsSnapshot.empty) {
            console.log('✅ No expired trials found');
            return { expiredCount: 0 };
        }
        
        console.log(`⚠️ Found ${expiredTrialsSnapshot.size} expired trials`);
        
        const batch = this.db.batch();
        let updatedCount = 0;
        
        for (const doc of expiredTrialsSnapshot.docs) {
            const userId = doc.id;
            const user = doc.data();
            
            // Update user to expired status
            batch.update(doc.ref, {
                subscriptionStatus: 'expired',
                currentPlan: 'free',
                trialExpiredAt: now,
                updatedAt: now
            });
            
            // Create notification
            const notificationRef = this.db.collection('notifications').doc();
            batch.set(notificationRef, {
                userId,
                type: 'trial_expired',
                title: '⏰ Trial Expired',
                message: `Your ${user.currentPlan === 'basic' ? 'Basic Coach' : 'Race Coach'} trial has ended. Subscribe to continue enjoying premium features!`,
                actionText: 'Subscribe Now',
                actionUrl: '/plans',
                read: false,
                createdAt: now
            });
            
            // Log transaction
            const transactionRef = this.db.collection('transactions').doc();
            batch.set(transactionRef, {
                userId,
                type: 'trial_expired',
                plan: user.currentPlan,
                trialStartDate: user.trialStartDate,
                trialEndDate: user.trialEndDate,
                status: 'expired',
                createdAt: now
            });
            
            updatedCount++;
            
            console.log(`📌 Expiring trial for user: ${userId} (${user.currentPlan})`);
        }
        
        // Commit all updates in batch
        await batch.commit();
        
        console.log(`✅ Expired ${updatedCount} trials successfully`);
        
        return { expiredCount: updatedCount };
        
    } catch (error) {
        console.error('❌ Check expired trials error:', error);
        throw error;
    }
}

/**
 * Send trial expiry reminders 3 days before expiry
 */
async sendTrialExpiryReminders() {
    try {
        const now = new Date();
        const threeDaysFromNow = new Date(now.getTime() + (3 * 24 * 60 * 60 * 1000));
        
        console.log('📧 Checking for trials expiring soon...');
        
        // Find trials expiring in next 3 days
        const expiringTrialsSnapshot = await this.db.collection('users')
            .where('subscriptionStatus', '==', 'trial')
            .where('trialEndDate', '>', now)
            .where('trialEndDate', '<', threeDaysFromNow)
            .get();
        
        if (expiringTrialsSnapshot.empty) {
            console.log('✅ No trials expiring soon');
            return { remindersSent: 0 };
        }
        
        console.log(`⏰ Found ${expiringTrialsSnapshot.size} trials expiring soon`);
        
        const batch = this.db.batch();
        let remindersSent = 0;
        
        for (const doc of expiringTrialsSnapshot.docs) {
            const userId = doc.id;
            const user = doc.data();
            
            // Check if reminder already sent (within last 7 days)
            const existingReminder = await this.db.collection('notifications')
                .where('userId', '==', userId)
                .where('type', '==', 'trial_expiring_soon')
                .where('createdAt', '>', new Date(now.getTime() - (7 * 24 * 60 * 60 * 1000)))
                .limit(1)
                .get();
            
            if (!existingReminder.empty) {
                console.log(`⏭️ Reminder already sent for user: ${userId}`);
                continue;
            }
            
            const daysRemaining = Math.ceil((user.trialEndDate.toDate() - now) / (1000 * 60 * 60 * 24));
            const planName = user.currentPlan === 'basic' ? 'Basic Coach' : 'Race Coach';
            
            // Create reminder notification
            const notificationRef = this.db.collection('notifications').doc();
            batch.set(notificationRef, {
                userId,
                type: 'trial_expiring_soon',
                title: `⏰ Trial Ending in ${daysRemaining} Day${daysRemaining > 1 ? 's' : ''}`,
                message: `Your ${planName} trial ends soon! Subscribe now to keep your training momentum going.`,
                actionText: 'Subscribe Now',
                actionUrl: '/plans',
                read: false,
                createdAt: now
            });
            
            remindersSent++;
            console.log(`📧 Queued reminder for user: ${userId} (${daysRemaining} days left)`);
        }
        
        await batch.commit();
        
        console.log(`✅ Sent ${remindersSent} trial expiry reminders`);
        
        return { remindersSent };
        
    } catch (error) {
        console.error('❌ Send trial reminders error:', error);
        throw error;
    }
}

/**
 * Check for expired paid subscriptions
 */
async checkExpiredSubscriptions() {
    try {
        const now = new Date();
        
        console.log('🔍 Checking for expired subscriptions...');
        
        // Find active subscriptions that have expired
        const expiredSubsSnapshot = await this.db.collection('users')
            .where('subscriptionStatus', '==', 'active')
            .where('subscriptionEndDate', '<', now)
            .get();
        
        if (expiredSubsSnapshot.empty) {
            console.log('✅ No expired subscriptions found');
            return { expiredCount: 0 };
        }
        
        console.log(`⚠️ Found ${expiredSubsSnapshot.size} expired subscriptions`);
        
        const batch = this.db.batch();
        let updatedCount = 0;
        
        for (const doc of expiredSubsSnapshot.docs) {
            const userId = doc.id;
            const user = doc.data();
            
            // Update user to expired status
            batch.update(doc.ref, {
                subscriptionStatus: 'expired',
                currentPlan: 'free',
                previousPlan: user.currentPlan,
                expiredAt: now,
                updatedAt: now
            });
            
            // Create notification
            const notificationRef = this.db.collection('notifications').doc();
            batch.set(notificationRef, {
                userId,
                type: 'subscription_expired',
                title: '⚠️ Subscription Expired',
                message: `Your ${user.currentPlan === 'basic' ? 'Basic Coach' : 'Race Coach'} subscription has expired. Renew now to continue!`,
                actionText: 'Renew Now',
                actionUrl: '/renew',
                read: false,
                createdAt: now
            });
            
            // Update subscription record
            const subSnapshot = await this.db.collection('subscriptions')
                .where('userId', '==', userId)
                .where('status', '==', 'active')
                .get();
            
            subSnapshot.docs.forEach(subDoc => {
                batch.update(subDoc.ref, {
                    status: 'expired',
                    expiredAt: now
                });
            });
            
            updatedCount++;
            console.log(`📌 Expired subscription for user: ${userId} (${user.currentPlan})`);
        }
        
        await batch.commit();
        
        console.log(`✅ Expired ${updatedCount} subscriptions successfully`);
        
        return { expiredCount: updatedCount };
        
    } catch (error) {
        console.error('❌ Check expired subscriptions error:', error);
        throw error;
    }
}

/**
 * Send subscription renewal reminders 7 days before expiry
 */
async sendRenewalReminders() {
    try {
        const now = new Date();
        const sevenDaysFromNow = new Date(now.getTime() + (7 * 24 * 60 * 60 * 1000));
        
        console.log('📧 Checking for subscriptions expiring soon...');
        
        // Find subscriptions expiring in next 7 days
        const expiringSubsSnapshot = await this.db.collection('users')
            .where('subscriptionStatus', '==', 'active')
            .where('subscriptionEndDate', '>', now)
            .where('subscriptionEndDate', '<', sevenDaysFromNow)
            .get();
        
        if (expiringSubsSnapshot.empty) {
            console.log('✅ No subscriptions expiring soon');
            return { remindersSent: 0 };
        }
        
        console.log(`⏰ Found ${expiringSubsSnapshot.size} subscriptions expiring soon`);
        
        const batch = this.db.batch();
        let remindersSent = 0;
        
        for (const doc of expiringSubsSnapshot.docs) {
            const userId = doc.id;
            const user = doc.data();
            
            // Check if reminder already sent
            const existingReminder = await this.db.collection('notifications')
                .where('userId', '==', userId)
                .where('type', '==', 'subscription_expiring_soon')
                .where('createdAt', '>', new Date(now.getTime() - (10 * 24 * 60 * 60 * 1000)))
                .limit(1)
                .get();
            
            if (!existingReminder.empty) {
                console.log(`⏭️ Renewal reminder already sent for user: ${userId}`);
                continue;
            }
            
            const daysRemaining = Math.ceil((user.subscriptionEndDate.toDate() - now) / (1000 * 60 * 60 * 24));
            const planName = user.currentPlan === 'basic' ? 'Basic Coach' : 'Race Coach';
            
            // Create renewal reminder
            const notificationRef = this.db.collection('notifications').doc();
            batch.set(notificationRef, {
                userId,
                type: 'subscription_expiring_soon',
                title: `⏰ Subscription Renewing in ${daysRemaining} Day${daysRemaining > 1 ? 's' : ''}`,
                message: `Your ${planName} subscription expires soon. Renew now with our 50% renewal discount!`,
                actionText: 'Renew with 50% Off',
                actionUrl: '/renew?code=RENEW50',
                read: false,
                createdAt: now
            });
            
            remindersSent++;
            console.log(`📧 Queued renewal reminder for user: ${userId} (${daysRemaining} days left)`);
        }
        
        await batch.commit();
        
        console.log(`✅ Sent ${remindersSent} renewal reminders`);
        
        return { remindersSent };
        
    } catch (error) {
        console.error('❌ Send renewal reminders error:', error);
        throw error;
    }
}

/**
 * Initialize all scheduled tasks (call this once when service starts)
 */
initializeScheduledTasks() {
  console.log('Initializing subscription management tasks...');

  const SIX_HOURS = 6 * 60 * 60 * 1000;
  const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;

  // Existing jobs
  setInterval(this.checkExpiredTrials.bind(this), SIX_HOURS);
  setInterval(this.sendTrialExpiryReminders.bind(this), TWENTY_FOUR_HOURS);
  setInterval(this.checkExpiredSubscriptions.bind(this), SIX_HOURS);
  setInterval(this.sendRenewalReminders.bind(this), TWENTY_FOUR_HOURS);

  // NEW: resume paused subscriptions
  setInterval(this.checkPausedSubscriptions.bind(this), SIX_HOURS);

  // Run all once on startup
  this.checkExpiredTrials();
  this.sendTrialExpiryReminders();
  this.checkExpiredSubscriptions();
  this.sendRenewalReminders();
  this.checkPausedSubscriptions();

  console.log('All subscription tasks scheduled');
}

}

module.exports = SubscriptionService;
