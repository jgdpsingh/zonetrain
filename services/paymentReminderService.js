const cron = require('node-cron');
const WhatsAppService = require('./whatsappService');

class PaymentReminderService {
    constructor(db, subscriptionService) {
        this.db = db;
        this.whatsapp = new WhatsAppService();
        this.subscriptionService = subscriptionService;
    }

    // Start daily scheduler
    start() {
        // Check for payment reminders every day at 10 AM IST
        cron.schedule('0 10 * * *', async () => {
            console.log('🔔 Checking for payment reminders...');
            await this.sendPaymentReminders();
        }, {
            timezone: "Asia/Kolkata"
        });

        console.log('✅ Payment reminder scheduler started (10:00 AM IST)');
    }

    // Send payment reminders
    async sendPaymentReminders() {
        try {
            const usersSnapshot = await this.db.collection('users')
                .where('subscriptionStatus', 'in', ['active', 'basic', 'race'])
                .get();

            console.log(`📋 Checking ${usersSnapshot.size} paid users for reminders...`);
            let sentCount = 0;

            for (const doc of usersSnapshot.docs) {
                const user = { id: doc.id, ...doc.data() };

                // Check if reminder should be sent
                if (this.subscriptionService.shouldSendRenewalReminder(user)) {
                    await this.sendReminderToUser(user);
                    sentCount++;

                    // Mark reminder as sent
                    await this.db.collection('users').doc(user.id).update({
                        renewalReminderSent: true,
                        lastReminderDate: new Date()
                    });

                    // Wait 2 seconds between messages
                    await new Promise(resolve => setTimeout(resolve, 2000));
                }
            }

            console.log(`✅ Payment reminders sent: ${sentCount} users`);
        } catch (error) {
            console.error('❌ Error sending reminders:', error);
        }
    }

    // Send reminder to individual user
    async sendReminderToUser(user) {
        if (!user.phoneNumber) {
            console.log(`⏭️ Skipping ${user.email} - no phone`);
            return;
        }

        const endDate = new Date(user.subscriptionEndDate);
        const today = new Date();
        const daysRemaining = Math.ceil((endDate - today) / (1000 * 60 * 60 * 24));

        // Generate renewal link with user token
        const renewalToken = await this.generateRenewalToken(user.id);
        const renewalLink = `${process.env.BASE_URL}/renew?token=${renewalToken}`;

        // Create message
        const message = this.formatReminderMessage(user, daysRemaining, renewalLink);

        // Send via WhatsApp
        const result = await this.whatsapp.sendMessage(user.phoneNumber, message);

        if (result.success) {
            console.log(`✅ Reminder sent to ${user.email}`);
            
            // Log reminder
            await this.db.collection('payment_reminders').add({
                userId: user.id,
                sentAt: new Date(),
                daysRemaining,
                messageId: result.messageId,
                renewalLink
            });
        } else {
            console.error(`❌ Failed to send to ${user.email}:`, result.error);
        }
    }

    // Format reminder message
    formatReminderMessage(user, daysRemaining, renewalLink) {
        const planName = user.currentPlan === 'basic' ? 'Basic Coach' : 'Race Coach';
        const emoji = daysRemaining === 3 ? '⏰' : daysRemaining === 4 ? '📅' : '⚠️';

        return `
${emoji} *ZoneTrain Renewal Reminder*

Hi ${user.firstName || 'Runner'}! 👋

Your *${planName}* subscription expires in *${daysRemaining} days* (${new Date(user.subscriptionEndDate).toLocaleDateString('en-IN')})

🔗 *Renew now & keep training:*
${renewalLink}

💡 *Choose your billing cycle:*
• Monthly - Continue as-is
• Quarterly - Save ₹${this.subscriptionService.calculateSavings(user.currentPlan, 'quarterly')}
• Annual - Save ₹${this.subscriptionService.calculateSavings(user.currentPlan, 'annual')} (Best Value!)

${user.currentPlan === 'basic' ? '\n🚀 *Want to upgrade?* Race Coach plans are also available on the renewal page!' : ''}

Questions? Reply to this message!

Keep crushing your goals! 💪
- Team ZoneTrain
        `.trim();
    }

    // Generate secure renewal token
    async generateRenewalToken(userId) {
        const crypto = require('crypto');
        const token = crypto.randomBytes(32).toString('hex');
        
        // Store token with expiry (7 days)
        const expiryDate = new Date();
        expiryDate.setDate(expiryDate.getDate() + 7);

        await this.db.collection('renewal_tokens').doc(token).set({
            userId,
            createdAt: new Date(),
            expiresAt: expiryDate,
            used: false
        });

        return token;
    }

    // Validate renewal token
    async validateRenewalToken(token) {
        const tokenDoc = await this.db.collection('renewal_tokens').doc(token).get();
        
        if (!tokenDoc.exists) {
            return { valid: false, error: 'Invalid token' };
        }

        const data = tokenDoc.data();
        
        if (data.used) {
            return { valid: false, error: 'Token already used' };
        }

        if (new Date() > data.expiresAt.toDate()) {
            return { valid: false, error: 'Token expired' };
        }

        return { valid: true, userId: data.userId };
    }
}

module.exports = PaymentReminderService;
