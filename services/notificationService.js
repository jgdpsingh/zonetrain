// services/notificationService.js - Enhanced Version
const nodemailer = require('nodemailer');

class NotificationService {
    constructor(db) {
        this.db = db;
        
        // Initialize email transporter
        this.transporter = nodemailer.createTransport({
            host: process.env.EMAIL_HOST,
            port: parseInt(process.env.EMAIL_PORT),
            secure: true,
            auth: {
                user: process.env.ZOHO_EMAIL,
                pass: process.env.ZOHO_PASSWORD
            }
        });
    }

    // Create in-app notification
    async createNotification(userId, type, title, message, actionUrl = null, metadata = {}) {
        try {
            const notification = {
                userId,
                type,
                title,
                message,
                actionUrl,
                metadata,
                read: false,
                createdAt: new Date()
            };

            const docRef = await this.db.collection('notifications').add(notification);
            console.log(`✅ Notification created: ${title}`);
            
            return { id: docRef.id, ...notification };
        } catch (error) {
            console.error('Create notification error:', error);
            throw error;
        }
    }

    // Send workout reminder (Dashboard + Email)
    async sendWorkoutReminder(userId, workout) {
        try {
            // Get user details
            const userDoc = await this.db.collection('users').doc(userId).get();
            const user = userDoc.data();

             // ✅ Check if workout notifications are enabled
        if (user.notificationPreferences?.workout === false) {
            console.log(`⏭️ Workout notification skipped for ${userId} (disabled)`);
            return { success: true, skipped: true, reason: 'Workout notifications disabled' };
        }

            // Create dashboard notification
            await this.createNotification(
                userId,
                'workout',
                '🏃 Today\'s Training',
                `${workout.name || workout.type} - ${workout.distance}km in Zone ${workout.zone}`,
                `/workout/${workout.id}`,
                { workoutId: workout.id }
            );

            // Send email if user has email
            if (user.email && user.notificationPreferences?.email !== false) {
                await this.sendWorkoutEmail(user.email, user.firstName, workout);
            }

            console.log(`✅ Workout reminder sent to ${userId}`);
            return { success: true };
        } catch (error) {
            console.error('Send workout reminder error:', error);
            throw error;
        }
    }

    // Send workout email
    async sendWorkoutEmail(email, firstName, workout) {
        const mailOptions = {
            from: `"ZoneTrain Coach" <${process.env.ZOHO_EMAIL}>`,
            to: email,
            subject: `🏃 Today's Workout: ${workout.name || workout.type}`,
            html: `
                <!DOCTYPE html>
                <html>
                <head>
                    <style>
                        body { font-family: Arial, sans-serif; margin: 0; padding: 0; background: #f4f4f4; }
                        .container { max-width: 600px; margin: 20px auto; background: white; border-radius: 10px; overflow: hidden; }
                        .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; }
                        .content { padding: 30px; }
                        .workout-card { background: #f9f9f9; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #667eea; }
                        .stat { display: inline-block; margin: 10px 20px 10px 0; }
                        .stat-label { font-size: 12px; color: #666; text-transform: uppercase; }
                        .stat-value { font-size: 24px; font-weight: bold; color: #667eea; }
                        .btn { display: inline-block; padding: 14px 30px; background: #667eea; color: white; text-decoration: none; border-radius: 8px; margin: 20px 0; }
                        .footer { text-align: center; padding: 20px; color: #999; font-size: 12px; }
                    </style>
                </head>
                <body>
                    <div class="container">
                        <div class="header">
                            <h1>🏃‍♂️ Your Workout Today</h1>
                        </div>
                        <div class="content">
                            <h2>Hi ${firstName}!</h2>
                            <p>Your coach has prepared today's workout for you:</p>
                            
                            <div class="workout-card">
                                <h3 style="margin-top: 0;">${workout.name || workout.type}</h3>
                                <p style="color: #666;">${workout.description || 'Complete this workout at your comfort level'}</p>
                                
                                <div style="margin-top: 20px;">
                                    <div class="stat">
                                        <div class="stat-label">Distance</div>
                                        <div class="stat-value">${workout.distance} km</div>
                                    </div>
                                    
                                    <div class="stat">
                                        <div class="stat-label">Zone</div>
                                        <div class="stat-value">Zone ${workout.zone}</div>
                                    </div>
                                    
                                    ${workout.duration ? `
                                    <div class="stat">
                                        <div class="stat-label">Duration</div>
                                        <div class="stat-value">${workout.duration} min</div>
                                    </div>
                                    ` : ''}
                                </div>
                            </div>
                            
                            ${workout.notes ? `
                            <div style="background: #fff3cd; padding: 15px; border-radius: 8px; margin: 20px 0;">
                                <strong>💡 Coach Notes:</strong> ${workout.notes}
                            </div>
                            ` : ''}
                            
                            <center>
                                <a href="${process.env.APP_URL}/dashboard" class="btn">View Workout Details</a>
                            </center>
                        </div>
                        <div class="footer">
                            <p>This is an automated message from ZoneTrain</p>
                            <p><a href="${process.env.APP_URL}/settings" style="color: #667eea;">Manage Notifications</a></p>
                        </div>
                    </div>
                </body>
                </html>
            `
        };

        await this.transporter.sendMail(mailOptions);
        console.log(`✅ Workout email sent to ${email}`);
    }

    // Send payment reminder
    async sendPaymentReminder(userId, daysUntilExpiry, amount) {
        try {
            const userDoc = await this.db.collection('users').doc(userId).get();
            const user = userDoc.data();

            // ✅ Check if payment notifications are enabled
        if (user.notificationPreferences?.payment === false) {
            console.log(`⏭️ Payment notification skipped for ${userId} (disabled)`);
            return { success: true, skipped: true, reason: 'Payment notifications disabled' };
        }

            // Dashboard notification
            await this.createNotification(
                userId,
                'payment',
                '💳 Payment Reminder',
                `Your subscription expires in ${daysUntilExpiry} days. Amount: ₹${amount}`,
                '/subscription'
            );

            // Email notification
            
if (user.email && user.notificationPreferences?.email !== false) {
    await this.sendPaymentEmail(user.email, user.firstName, daysUntilExpiry, amount);
}


            return { success: true };
        } catch (error) {
            console.error('Send payment reminder error:', error);
            throw error;
        }
    }

    // Send payment reminder email
    async sendPaymentEmail(email, firstName, daysUntilExpiry, amount) {
        const urgency = daysUntilExpiry <= 3 ? 'URGENT: ' : '';
        
        const mailOptions = {
            from: `"ZoneTrain" <${process.env.ZOHO_EMAIL}>`,
            to: email,
            subject: `${urgency}Your Subscription Expires in ${daysUntilExpiry} Days`,
            html: `
                <!DOCTYPE html>
                <html>
                <body style="font-family: Arial, sans-serif; margin: 0; padding: 0; background: #f4f4f4;">
                    <div style="max-width: 600px; margin: 20px auto; background: white; border-radius: 10px; overflow: hidden;">
                        <div style="background: ${daysUntilExpiry <= 3 ? '#EF4444' : '#F59E0B'}; color: white; padding: 30px; text-align: center;">
                            <h1>⏰ Subscription Reminder</h1>
                        </div>
                        <div style="padding: 30px;">
                            <h2>Hi ${firstName},</h2>
                            <p>Your ZoneTrain subscription will expire in <strong>${daysUntilExpiry} days</strong>.</p>
                            
                            <div style="background: #FEF3C7; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #F59E0B;">
                                <p style="margin: 0;"><strong>Renewal Amount: ₹${amount}</strong></p>
                                <p style="margin: 10px 0 0 0; color: #92400E;">Don't lose access to your personalized training plans!</p>
                            </div>
                            
                            <center>
                                <a href="${process.env.APP_URL}/subscription" style="display: inline-block; padding: 14px 30px; background: #667eea; color: white; text-decoration: none; border-radius: 8px; margin: 20px 0;">
                                    Renew Subscription
                                </a>
                            </center>
                        </div>
                    </div>
                </body>
                </html>
            `
        };

        await this.transporter.sendMail(mailOptions);
    }

    // Send upgrade offer
   async sendUpgradeOffer(userId, promoCode = 'UPGRADE50', discount = 50) {
    try {
        const userDoc = await this.db.collection('users').doc(userId).get();
        const user = userDoc.data();

        // ✅ Check if upgrade notifications are enabled
        if (user.notificationPreferences?.upgrade === false) {
            console.log(`⏭️ Upgrade notification skipped for ${userId} (disabled)`);
            return { success: true, skipped: true, reason: 'Upgrade notifications disabled' };
        }

        await this.createNotification(
            userId,
            'upgrade',
            '🚀 Upgrade to Race Coach',
            `Get ${discount}% off with code ${promoCode}. Limited time offer!`,
            '/plans',
            { promoCode, discount }
        );

        // ✅ Check if email is enabled
        if (user.email && user.notificationPreferences?.email !== false) {
            await this.sendUpgradeEmail(user.email, user.firstName, promoCode, discount);
        }

        return { success: true };
    } catch (error) {
        console.error('Send upgrade offer error:', error);
        throw error;
    }
}

    // Send upgrade email
    async sendUpgradeEmail(email, firstName, promoCode, discount) {
        const mailOptions = {
            from: `"ZoneTrain" <${process.env.ZOHO_EMAIL}>`,
            to: email,
            subject: `🚀 Special Offer: ${discount}% Off Race Coach Plan`,
            html: `
                <!DOCTYPE html>
                <html>
                <body style="font-family: Arial, sans-serif;">
                    <div style="max-width: 600px; margin: 20px auto; background: white; border-radius: 10px; overflow: hidden;">
                        <div style="background: linear-gradient(135deg, #6d28d9 0%, #5b21b6 100%); color: white; padding: 40px; text-align: center;">
                            <h1>🎉 Exclusive Upgrade Offer</h1>
                            <p style="font-size: 24px; margin: 10px 0;">${discount}% OFF</p>
                        </div>
                        <div style="padding: 30px;">
                            <h2>Hi ${firstName}!</h2>
                            <p>Ready to take your training to the next level?</p>
                            
                            <div style="background: #F3F4F6; padding: 20px; border-radius: 8px; margin: 20px 0;">
                                <h3 style="margin-top: 0;">🏆 Upgrade to Race Coach and get:</h3>
                                <ul style="line-height: 2;">
                                    <li>Race-specific training plans</li>
                                    <li>Advanced performance analytics</li>
                                    <li>Pace optimization</li>
                                    <li>Race day strategy</li>
                                    <li>Priority support</li>
                                </ul>
                            </div>
                            
                            <div style="background: #DBEAFE; padding: 15px; border-radius: 8px; text-align: center; margin: 20px 0;">
                                <p style="margin: 0; font-size: 14px; color: #1E40AF;">Use Promo Code:</p>
                                <p style="margin: 10px 0; font-size: 24px; font-weight: bold; color: #1E40AF; letter-spacing: 2px;">${promoCode}</p>
                            </div>
                            
                            <center>
                                <a href="${process.env.APP_URL}/plans?promo=${promoCode}" style="display: inline-block; padding: 14px 30px; background: #6d28d9; color: white; text-decoration: none; border-radius: 8px;">
                                    Upgrade Now
                                </a>
                            </center>
                        </div>
                    </div>
                </body>
                </html>
            `
        };

        await this.transporter.sendMail(mailOptions);
    }

    // Send recovery reminder
    async sendRecoveryReminder(userId) {
    try {
        const userDoc = await this.db.collection('users').doc(userId).get();
        const user = userDoc.data();

        // ✅ Check if recovery notifications are enabled
        if (user.notificationPreferences?.recovery === false) {
            console.log(`⏭️ Recovery notification skipped for ${userId} (disabled)`);
            return { success: true, skipped: true, reason: 'Recovery notifications disabled' };
        }

        await this.createNotification(
            userId,
            'recovery',
            '💪 Recovery Check',
            'Log your HRV and recovery status for today',
            '/recovery'
        );

        // ✅ Check if email is enabled
        if (user.email && user.notificationPreferences?.email !== false) {
            await this.sendRecoveryEmail(user.email, user.firstName);
        }

        return { success: true };
    } catch (error) {
        console.error('Send recovery reminder error:', error);
        throw error;
    }
}

    // Send recovery email
    async sendRecoveryEmail(email, firstName) {
        const mailOptions = {
            from: `"ZoneTrain Coach" <${process.env.ZOHO_EMAIL}>`,
            to: email,
            subject: '💪 Time to Log Your Recovery',
            html: `
                <!DOCTYPE html>
                <html>
                <body style="font-family: Arial, sans-serif;">
                    <div style="max-width: 600px; margin: 20px auto; background: white; border-radius: 10px; padding: 30px;">
                        <h2>Hi ${firstName}!</h2>
                        <p>Don't forget to log your recovery metrics for today.</p>
                        
                        <div style="background: #D1FAE5; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #10B981;">
                            <p><strong>Track your:</strong></p>
                            <ul>
                                <li>Heart Rate Variability (HRV)</li>
                                <li>Sleep quality</li>
                                <li>Muscle soreness</li>
                                <li>Overall feeling</li>
                            </ul>
                        </div>
                        
                        <center>
                            <a href="${process.env.APP_URL}/recovery" style="display: inline-block; padding: 14px 30px; background: #10B981; color: white; text-decoration: none; border-radius: 8px;">
                                Log Recovery
                            </a>
                        </center>
                    </div>
                </body>
                </html>
            `
        };

        await this.transporter.sendMail(mailOptions);
    }

    // Send race completed notification
    async sendRaceCompleted(userId, raceName) {
    try {
        const userDoc = await this.db.collection('users').doc(userId).get();
        const user = userDoc.data();

        // ✅ Check if race notifications are enabled
        if (user.notificationPreferences?.race === false) {
            console.log(`⏭️ Race notification skipped for ${userId} (disabled)`);
            return { success: true, skipped: true, reason: 'Race notifications disabled' };
        }

        await this.createNotification(
            userId,
            'race',
            '🏁 Race Complete!',
            `Congratulations on completing ${raceName}! Set your next goal.`,
            '/races/new'
        );

        // ✅ Check if email is enabled
        if (user.email && user.notificationPreferences?.email !== false) {
            await this.sendRaceCompletedEmail(user.email, user.firstName, raceName);
        }

        return { success: true };
    } catch (error) {
        console.error('Send race completed error:', error);
        throw error;
    }
}

    // Send race completed email
    async sendRaceCompletedEmail(email, firstName, raceName) {
        const mailOptions = {
            from: `"ZoneTrain" <${process.env.ZOHO_EMAIL}>`,
            to: email,
            subject: `🏁 Congratulations on completing ${raceName}!`,
            html: `
                <!DOCTYPE html>
                <html>
                <body style="font-family: Arial, sans-serif;">
                    <div style="max-width: 600px; margin: 20px auto; background: white; border-radius: 10px; overflow: hidden;">
                        <div style="background: linear-gradient(135deg, #10B981 0%, #059669 100%); color: white; padding: 40px; text-align: center;">
                            <h1>🏆 Congratulations!</h1>
                            <p style="font-size: 20px; margin: 10px 0;">You completed ${raceName}</p>
                        </div>
                        <div style="padding: 30px;">
                            <h2>Amazing job, ${firstName}!</h2>
                            <p>You've achieved a significant milestone. Every race makes you stronger!</p>
                            
                            <div style="background: #FEF3C7; padding: 20px; border-radius: 8px; margin: 20px 0;">
                                <p><strong>🎯 What's next?</strong></p>
                                <p>Set a new goal and continue your journey. Your next achievement is waiting!</p>
                            </div>
                            
                            <center>
                                <a href="${process.env.APP_URL}/races/new" style="display: inline-block; padding: 14px 30px; background: #667eea; color: white; text-decoration: none; border-radius: 8px;">
                                    Set New Goal
                                </a>
                            </center>
                        </div>
                    </div>
                </body>
                </html>
            `
        };

        await this.transporter.sendMail(mailOptions);
    }

    // Get user notifications
    async getUserNotifications(userId, limit = 20) {
        try {
            const snapshot = await this.db.collection('notifications')
                .where('userId', '==', userId)
                .orderBy('createdAt', 'desc')
                .limit(limit)
                .get();

            return snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));
        } catch (error) {
            console.error('Get notifications error:', error);
            throw error;
        }
    }

    // Get unread count
    async getUnreadCount(userId) {
        try {
            const snapshot = await this.db.collection('notifications')
                .where('userId', '==', userId)
                .where('read', '==', false)
                .get();

            return snapshot.size;
        } catch (error) {
            console.error('Get unread count error:', error);
            return 0;
        }
    }

    // Mark as read
    async markAsRead(notificationId) {
        try {
            await this.db.collection('notifications').doc(notificationId).update({
                read: true,
                readAt: new Date()
            });

            return { success: true };
        } catch (error) {
            console.error('Mark as read error:', error);
            throw error;
        }
    }

    // Mark all as read
    async markAllAsRead(userId) {
        try {
            const snapshot = await this.db.collection('notifications')
                .where('userId', '==', userId)
                .where('read', '==', false)
                .get();

            const batch = this.db.batch();
            snapshot.docs.forEach(doc => {
                batch.update(doc.ref, {
                    read: true,
                    readAt: new Date()
                });
            });

            await batch.commit();

            return { success: true, count: snapshot.size };
        } catch (error) {
            console.error('Mark all as read error:', error);
            throw error;
        }
    }

    // Delete notification
    async deleteNotification(notificationId) {
        try {
            await this.db.collection('notifications').doc(notificationId).delete();
            return { success: true };
        } catch (error) {
            console.error('Delete notification error:', error);
            throw error;
        }
    }


/**
 * Convert timestamp to human-readable time
 */
getTimeAgo(date) {
    const now = new Date();
    const diffMs = now - date;
    const diffSecs = Math.floor(diffMs / 1000);
    const diffMins = Math.floor(diffSecs / 60);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);
    
    if (diffSecs < 60) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    
    return date.toLocaleDateString();  // ← This line was missing
}

// Send cancellation email
async sendCancellationEmail(email, firstName, data) {
    const mailOptions = {
        from: `"ZoneTrain" <${process.env.ZOHO_EMAIL}>`,
        to: email,
        subject: '😢 Your ZoneTrain Subscription Has Been Cancelled',
        html: `
            <!DOCTYPE html>
            <html>
            <body style="font-family: Arial, sans-serif;">
                <div style="max-width: 600px; margin: 20px auto; background: white; border-radius: 10px; padding: 30px;">
                    <h2>Hi ${firstName},</h2>
                    
                    <p>We're sad to see you go! Your <strong>${data.plan}</strong> subscription has been cancelled.</p>
                    
                    <div style="background: #FEF3C7; padding: 20px; border-radius: 8px; margin: 20px 0;">
                        <p><strong>Cancellation Details:</strong></p>
                        <p>Plan: ${data.plan}</p>
                        <p>Access Until: ${new Date(data.accessUntil).toLocaleDateString()}</p>
                        ${data.reason ? `<p>Reason: ${data.reason}</p>` : ''}
                    </div>
                    
                    <p>You'll have access to all ${data.plan} features until ${new Date(data.accessUntil).toLocaleDateString()}, after which your account will revert to Free.</p>
                    
                    <p style="color: #666;">
                        If you change your mind, you can always upgrade again anytime from your dashboard.
                    </p>
                    
                    <center>
                        <a href="${process.env.APP_URL}/plans" style="display: inline-block; padding: 14px 30px; background: #667eea; color: white; text-decoration: none; border-radius: 8px; margin: 20px 0;">
                            View Plans
                        </a>
                    </center>
                    
                    <p style="color: #999; font-size: 12px; text-align: center;">
                        Thank you for being part of the ZoneTrain community!
                    </p>
                </div>
            </body>
            </html>
        `
    };

    await this.transporter.sendMail(mailOptions);
}



}


module.exports = NotificationService;
