// services/subscriptionService.js (Backend)
class SubscriptionService {
    constructor(db, razorpayService) {
        this.db = db;
        this.razorpay = razorpayService;
        
        // Pricing (in ₹)
        this.pricing = {
            basic: {
                monthly: 199,
                quarterly: 537,  // Save ₹60 (199*3 = 597)
                annual: 1999     // Save ₹389 (199*12 = 2388)
            },
            race: {
                monthly: 399,
                quarterly: 1077, // Save ₹120 (399*3 = 1197)
                annual: 3999     // Save ₹789 (399*12 = 4788)
            }
        };

        this.promoCodes = {
            'RENEW50': {
                type: 'renewal',
                discount: 50, // 50%
                description: '50% off on renewal',
                active: true
            },
            'UPGRADE50': {
                type: 'upgrade',
                discount: 50, // 50%
                description: '50% off on upgrade',
                active: true
            }
        };
    }

  validatePromoCode(code, transactionType) {
    // ✅ Check if code exists first
    if (!code || typeof code !== 'string') {
        return { valid: false, error: 'Invalid promo code' };
    }

    const upperCode = code.trim().toUpperCase();
    const promo = this.promoCodes[upperCode];

    console.log('🔍 Validating promo code:', upperCode);
    console.log('🔍 Found promo:', promo);
    console.log('🔍 Transaction type:', transactionType);

    if (!promo) {
        return { valid: false, error: 'Invalid promo code' };
    }

    if (!promo.active) {
        return { valid: false, error: 'This promo code has expired' };
    }

    // ✅ Allow 'upgrade' type promo for upgrade transactions
    if (promo.type !== transactionType && promo.type !== 'all') {
        console.log('❌ Promo type mismatch:', promo.type, 'vs', transactionType);
        return { valid: false, error: `This code is only valid for ${promo.type} transactions` };
    }

    console.log('✅ Promo code valid!');
    return { 
        valid: true, 
        discount: promo.discount,
        description: promo.description
    };
}

    // ✅ NEW: Apply promo code discount
    applyPromoCode(amount, promoCode) {
        const validation = this.validatePromoCode(promoCode, 'any');
        
        if (!validation.valid) {
            return { discountedAmount: amount, discount: 0, error: validation.error };
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

    // ✅ UPDATED: Calculate pro-rata upgrade with promo code support
    calculateProRataUpgrade(user, newPlan, billingCycle = 'monthly', promoCode = null) {
    const currentPlan = user.currentPlan;
    const subscriptionStart = new Date(user.subscriptionStartDate);
    const subscriptionEnd = new Date(user.subscriptionEndDate);
    const today = new Date();

    // Days remaining
    const totalDays = Math.ceil((subscriptionEnd - subscriptionStart) / (1000 * 60 * 60 * 24));
    const daysRemaining = Math.ceil((subscriptionEnd - today) / (1000 * 60 * 60 * 24));

    // Calculate unused credit
    const currentPlanPrice = this.pricing[currentPlan][user.billingCycle || 'monthly'];
    const unusedCredit = Math.ceil((currentPlanPrice * daysRemaining) / totalDays);

    // New plan pro-rata charge
    const newPlanMonthlyPrice = this.pricing[newPlan].monthly;
    const proRataCharge = Math.ceil((newPlanMonthlyPrice * daysRemaining) / 30);

    // Calculate base amount
    let amountToPay = Math.max(0, proRataCharge - unusedCredit);
    const originalAmount = amountToPay;
    
    // ✅ Apply promo code if provided
    let promoApplied = null;
    if (promoCode) {
        console.log('💰 Attempting to apply promo code:', promoCode);
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
            console.log('✅ Promo applied! Discount:', discountAmount);
        } else {
            console.log('❌ Promo validation failed:', validation.error);
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
        promoApplied  // ✅ This will be null if not applied, or an object if applied
    };
}



    calculateDowngradeWithCredit(user, newPlan) {
        const currentPlan = user.currentPlan; // 'race'
        const newPlanName = newPlan; // 'basic'
        const subscriptionEnd = new Date(user.subscriptionEndDate);
        const billingCycle = user.billingCycle || 'monthly';

        // Calculate remaining value of current plan
        const currentPlanPrice = this.pricing[currentPlan][billingCycle];
        const newPlanPrice = this.pricing[newPlanName][billingCycle];
        
        // Price difference per billing cycle
        const priceDifference = currentPlanPrice - newPlanPrice;
        
        // Calculate how many extra days the credit covers
        // For monthly: ₹600 - ₹300 = ₹300 credit
        // ₹300 credit / (₹300/30 days) = 30 extra days
        const dailyRateNewPlan = newPlanPrice / 30; // Assuming monthly
        const extraDays = Math.floor(priceDifference / dailyRateNewPlan);
        
        // Calculate new end date with extension
        const extendedEndDate = new Date(subscriptionEnd);
        extendedEndDate.setDate(extendedEndDate.getDate() + extraDays);

        return {
            currentPlan,
            newPlan: newPlanName,
            currentPrice: currentPlanPrice,
            newPrice: newPlanPrice,
            creditAmount: priceDifference,
            extraDaysGranted: extraDays,
            originalEndDate: subscriptionEnd,
            extendedEndDate: extendedEndDate,
            billingCycle,
            message: `You've been credited ${extraDays} days of ${newPlanName} service`,
            savings: priceDifference
        };
    }

    // Check if subscription expired
    isSubscriptionExpired(user) {
        if (!user.subscriptionEndDate) return true;
        return new Date() > new Date(user.subscriptionEndDate);
    }

    // Check if renewal reminder should be sent
    shouldSendRenewalReminder(user) {
        if (!user.subscriptionEndDate) return false;
        
        const endDate = new Date(user.subscriptionEndDate);
        const today = new Date();
        const daysUntilExpiry = Math.ceil((endDate - today) / (1000 * 60 * 60 * 24));
        
        return daysUntilExpiry >= 3 && daysUntilExpiry <= 4 && !user.renewalReminderSent;
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

    // Calculate savings
    calculateSavings(plan, billingCycle) {
        const monthly = this.pricing[plan].monthly;
        const actual = this.pricing[plan][billingCycle];
        const months = billingCycle === 'annual' ? 12 : billingCycle === 'quarterly' ? 3 : 1;
        return (monthly * months) - actual;
    }
}

module.exports = SubscriptionService;
