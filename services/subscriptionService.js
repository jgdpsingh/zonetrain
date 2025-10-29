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
    calculateProRataUpgrade(user, newPlan, billingCycle = 'monthly', promoCode = null) {
        const currentPlan = user.currentPlan;
        const subscriptionStart = new Date(user.subscriptionStartDate);
        const subscriptionEnd = new Date(user.subscriptionEndDate);
        const today = new Date();

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
}

module.exports = SubscriptionService;
