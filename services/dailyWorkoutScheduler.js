const cron = require('node-cron');
const WhatsAppService = require('./whatsappService');

class DailyWorkoutScheduler {
    constructor(db, aiService) {
        this.db = db;
        this.whatsapp = new WhatsAppService();
        this.aiService = aiService;
    }

    // Start daily scheduler
    start() {
        // Test WhatsApp connection on startup
        this.whatsapp.testConnection().then(result => {
            if (result.success) {
                console.log('✅ WhatsApp Business API connected');
            } else {
                console.error('❌ WhatsApp connection failed:', result.error);
            }
        });

        // Run every day at 7:00 AM IST
        cron.schedule('0 7 * * *', async () => {
            console.log('🔔 Running daily HRV check at', new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }));
            await this.sendDailyHRVCheck();
        }, {
            timezone: "Asia/Kolkata"
        });

        console.log('✅ Daily workout scheduler started (7:00 AM IST)');
    }

        // Send daily HRV check to all active paid users
    async sendDailyHRVCheck() {
        try {
            // Get all paid active users with phone numbers
            const usersSnapshot = await this.db.collection('users')
                .where('subscriptionStatus', 'in', ['active', 'basic', 'race'])
                .get();

            console.log(`📱 Processing ${usersSnapshot.size} paid users...`);
            let sentCount = 0;
            let failedCount = 0;

            for (const doc of usersSnapshot.docs) {
                const user = { id: doc.id, ...doc.data() };
                
                // Skip if no phone number
                if (!user.phoneNumber) {
                    console.log(`⏭️ Skipping ${user.email} - no phone`);
                    continue;
                }

                try {
                    // Send the approved template (no parameters - fixed text)
                    const result = await this.whatsapp.sendRecoveryCheck(user.phoneNumber);

                    if (result.success) {
                        sentCount++;
                        
                        // Log activity
                        await this.db.collection('hrv_checks').add({
                            userId: user.id,
                            sentAt: new Date(),
                            status: 'sent',
                            type: 'daily_hrv_check',
                            messageId: result.messageId,
                            phone: user.phoneNumber
                        });

                        console.log(`✅ Sent to ${user.email} (${user.phoneNumber})`);
                    } else {
                        failedCount++;
                        console.error(`❌ Failed to send to ${user.email}:`, result.error);
                        
                        // Log failure
                        await this.db.collection('hrv_checks').add({
                            userId: user.id,
                            sentAt: new Date(),
                            status: 'failed',
                            type: 'daily_hrv_check',
                            error: result.error,
                            phone: user.phoneNumber
                        });
                    }
                } catch (error) {
                    failedCount++;
                    console.error(`❌ Error sending to ${user.email}:`, error.message);
                }

                // Rate limiting - 2 seconds between messages (WhatsApp best practice)
                await new Promise(resolve => setTimeout(resolve, 2000));
            }

            console.log(`✅ Daily HRV checks complete: ${sentCount} sent, ${failedCount} failed out of ${usersSnapshot.size} users`);
            
            return {
                success: true,
                sent: sentCount,
                failed: failedCount,
                total: usersSnapshot.size
            };
        } catch (error) {
            console.error('❌ Error in sendDailyHRVCheck:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }


    // Process user HRV response and generate workout
    async processHRVResponse(userId, response) {
        try {
            console.log(`📊 Processing HRV response for user ${userId}`);

            // Get user data
            const userDoc = await this.db.collection('users').doc(userId).get();
            if (!userDoc.exists) {
                throw new Error('User not found');
            }
            const user = { id: userDoc.id, ...userDoc.data() };

            // Get AI profile
            const aiProfileDoc = await this.db.collection('aiprofiles').doc(userId).get();
            const aiProfile = aiProfileDoc.exists ? aiProfileDoc.data() : null;

            // Get recent workouts (last 7 days)
            const sevenDaysAgo = new Date();
            sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

            const workoutsSnapshot = await this.db.collection('workouts')
                .where('userId', '==', userId)
                .where('date', '>=', sevenDaysAgo)
                .orderBy('date', 'desc')
                .limit(10)
                .get();

            const recentWorkouts = workoutsSnapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));

            // Generate AI workout recommendation
            const recommendation = await this.aiService.generateDailyWorkout({
                user: user,
                aiProfile: aiProfile,
                hrvResponse: response,
                recentWorkouts: recentWorkouts
            });

            // Format and send recommendation
            const message = this.formatWorkoutRecommendation(recommendation);
            const result = await this.whatsapp.sendMessage(user.phoneNumber, message);

            if (result.success) {
                // Store recommendation
                await this.db.collection('daily_workouts').add({
                    userId: userId,
                    date: new Date(),
                    hrvData: response,
                    recommendation: recommendation,
                    status: 'sent',
                    messageId: result.messageId
                });

                console.log(`✅ Workout recommendation sent to ${user.email}`);
                return { success: true, recommendation };
            } else {
                throw new Error(result.error);
            }

        } catch (error) {
            console.error('❌ Error processing HRV response:', error);
            return { success: false, error: error.message };
        }
    }

    // Format workout recommendation for WhatsApp
    formatWorkoutRecommendation(recommendation) {
        const emoji = {
            'high': '💪',
            'medium': '👍',
            'low': '😴',
            'rest': '🛌'
        };

        return `
🏃‍♂️ *Your Workout for Today*

${emoji[recommendation.intensity] || '🏃'} *Recovery Status:* ${recommendation.recoveryStatus}

🎯 *Today's Plan:*
${recommendation.workoutPlan}

⏱️ *Duration:* ${recommendation.duration}
💪 *Intensity:* ${recommendation.intensity.toUpperCase()}
❤️ *Target HR Zone:* ${recommendation.targetZone || 'Zone 2-3'}

📝 *Key Points:*
${recommendation.tips.map((tip, i) => `${i + 1}. ${tip}`).join('\n')}

${recommendation.warning ? `⚠️ *Note:* ${recommendation.warning}` : ''}

💬 Reply:
• *DONE* when completed
• *SKIP* if you need rest
• *HELP* for questions

Keep crushing it! 🔥
        `.trim();
    }

    // Manual trigger for testing
    async sendTestMessage(phoneNumber) {
        const result = await this.whatsapp.sendMessage(
            phoneNumber,
            "🏃‍♂️ *ZoneTrain Test Message*\n\nYour daily HRV check is set up! You'll receive a message every morning at 7:00 AM IST.\n\nReply HELP for assistance."
        );
        return result;
    }
}

module.exports = DailyWorkoutScheduler;
