const axios = require('axios');
const dns = require('dns');

// ✅ Force IPv4 resolution (fixes ENOTFOUND on Mac)
dns.setDefaultResultOrder('ipv4first');

class WhatsAppService {
    constructor() {
        this.phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID || '760488880490616';
        this.accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
        this.apiVersion = process.env.WHATSAPP_API_VERSION || 'v22.0';
        this.apiUrl = `https://graph.facebook.com/${this.apiVersion}/${this.phoneNumberId}`;
    }

    // Format phone number - Remove + and keep country code
    formatPhoneNumber(phone) {
        return phone.replace(/\D/g, '');
    }

    // Core template sender with parameters
    async sendTemplate(phoneNumber, templateName, languageCode = 'en', components = []) {
        try {
            const formattedPhone = this.formatPhoneNumber(phoneNumber);
            
            console.log(`📤 Sending template "${templateName}" to ${formattedPhone}`);
            
            const payload = {
                messaging_product: 'whatsapp',
                to: formattedPhone,
                type: 'template',
                template: {
                    name: templateName,
                    language: {
                        code: languageCode
                    }
                }
            };

            if (components.length > 0) {
                payload.template.components = components;
            }

            const response = await axios.post(
                `${this.apiUrl}/messages`,
                payload,
                {
                    headers: {
                        'Authorization': `Bearer ${this.accessToken}`,
                        'Content-Type': 'application/json'
                    }
                }
            );

            console.log('✅ Template sent successfully:', response.data);
            return { 
                success: true, 
                messageId: response.data.messages[0].id,
                waId: response.data.contacts[0].wa_id 
            };
        } catch (error) {
            console.error('❌ Template error:', error.response?.data || error.message);
            return { 
                success: false, 
                error: error.response?.data?.error?.message || error.message 
            };
        }
    }

    // ✅ 1. Morning Recovery Check (UTILITY - Approved)
    async sendRecoveryCheck(phoneNumber) {
        return this.sendTemplate(
            phoneNumber,
            'daily_hrv_check',
            'en',
            [] // No parameters
        );
    }

    // ✅ 2. Easy Run Reminder (UTILITY)
    async sendWorkoutReminder(phoneNumber, workoutName, description, zone, minHR, maxHR, objective, detailsLink) {
    return this.sendTemplate(
        phoneNumber,
        'workout_reminder_universal',
        'en',
        [
            {
                type: 'body',
                parameters: [
                    { type: 'text', text: workoutName },      // {{1}} - "Easy Run" / "Tempo Run"
                    { type: 'text', text: description },      // {{2}} - "5km at easy pace"
                    { type: 'text', text: zone },             // {{3}} - "2"
                    { type: 'text', text: minHR },            // {{4}} - "130"
                    { type: 'text', text: maxHR },            // {{5}} - "150"
                    { type: 'text', text: objective },        // {{6}} - "Build aerobic base"
                    { type: 'text', text: detailsLink }       // {{7}} - "https://zonetrain.app/workout/123"
                ]
            }
        ]
    );
}

    // ✅ 3. Interval Workout (UTILITY)
    // ✅ REPLACE - Interval Workout (12 parameters)
async sendIntervalWorkout(
    phoneNumber, 
    workoutName,        // {{1}} - "5x1000m Intervals"
    warmupTime,         // {{2}} - "15"
    intervalCount,      // {{3}} - "5"
    workDuration,       // {{4}} - "4"
    workZone,           // {{5}} - "5"
    recoveryDuration,   // {{6}} - "2"
    cooldownTime,       // {{7}} - "10"
    workMinHR,          // {{8}} - "170"
    workMaxHR,          // {{9}} - "180"
    recoveryMinHR,      // {{10}} - "120"
    recoveryMaxHR,      // {{11}} - "140"
    detailsLink         // {{12}} - "https://zonetrain.app/workout/intervals"
) {
    return this.sendTemplate(
        phoneNumber,
        'interval_workout_zones',
        'en',
        [
            {
                type: 'body',
                parameters: [
                    { type: 'text', text: workoutName },
                    { type: 'text', text: warmupTime },
                    { type: 'text', text: intervalCount },
                    { type: 'text', text: workDuration },
                    { type: 'text', text: workZone },
                    { type: 'text', text: recoveryDuration },
                    { type: 'text', text: cooldownTime },
                    { type: 'text', text: workMinHR },
                    { type: 'text', text: workMaxHR },
                    { type: 'text', text: recoveryMinHR },
                    { type: 'text', text: recoveryMaxHR },
                    { type: 'text', text: detailsLink }
                ]
            }
        ]
    );
}



async sendWeeklyPlanReady(phoneNumber, weekNumber, totalDistance, runCount, keySessions, weeklyFocus, planLink, latestHRV) {
    return this.sendTemplate(
        phoneNumber,
        'weekly_plan_ready',
        'en',
        [
            {
                type: 'body',
                parameters: [
                    { type: 'text', text: weekNumber },       // {{1}} - "12"
                    { type: 'text', text: totalDistance },    // {{2}} - "42"
                    { type: 'text', text: runCount },         // {{3}} - "5"
                    { type: 'text', text: keySessions },      // {{4}} - "1 tempo, 1 long run"
                    { type: 'text', text: weeklyFocus },      // {{5}} - "Build endurance"
                    { type: 'text', text: planLink },         // {{6}} - "https://zonetrain.app/week/12"
                    { type: 'text', text: latestHRV }         // {{7}} - "65"
                ]
            }
        ]
    );
}


    async sendRunZoneAnalysis(
    phoneNumber, 
    workoutName,      // {{1}} - "Easy Run"
    distance,         // {{2}} - "5.2"
    time,             // {{3}} - "32:45"
    zone2Percent,     // {{4}} - "45"
    zone3Percent,     // {{5}} - "35"
    zone4Percent,     // {{6}} - "20"
    targetZone,       // {{7}} - "2"
    timeInTarget,     // {{8}} - "78"
    feedbackMessage,  // {{9}} - "Great pacing! You stayed in your target zone."
    analysisLink      // {{10}} - "https://zonetrain.app/analysis/123"
) {
    return this.sendTemplate(
        phoneNumber,
        'run_zone_analysis',
        'en',
        [
            {
                type: 'body',
                parameters: [
                    { type: 'text', text: workoutName },
                    { type: 'text', text: distance },
                    { type: 'text', text: time },
                    { type: 'text', text: zone2Percent },
                    { type: 'text', text: zone3Percent },
                    { type: 'text', text: zone4Percent },
                    { type: 'text', text: targetZone },
                    { type: 'text', text: timeInTarget },
                    { type: 'text', text: feedbackMessage },
                    { type: 'text', text: analysisLink }
                ]
            }
        ]
    );
}


    // ✅ NEW - 4 parameters matching your template
async sendStravaSyncCompleted(phoneNumber, activityCount, latestActivityName, distance, activitiesLink) {
    return this.sendTemplate(
        phoneNumber,
        'strava_sync_complete',  // ⚠️ Note: Template name is 'strava_sync_complete' not 'strava_sync_completed'
        'en',
        [
            {
                type: 'body',
                parameters: [
                    { type: 'text', text: activityCount },        // {{1}} - "5"
                    { type: 'text', text: latestActivityName },   // {{2}} - "Morning Run"
                    { type: 'text', text: distance },             // {{3}} - "8.5"
                    { type: 'text', text: activitiesLink }        // {{4}} - "https://zonetrain.app/activities"
                ]
            }
        ]
    );
}


    // ✅ REPLACE with this
async sendStravaSyncFailed(phoneNumber, syncTime, errorReason, reconnectLink) {
    return this.sendTemplate(
        phoneNumber,
        'strava_sync_failed',
        'en',
        [
            {
                type: 'body',
                parameters: [
                    { type: 'text', text: syncTime },       // {{1}} - "2:30 PM"
                    { type: 'text', text: errorReason },    // {{2}} - "Token expired"
                    { type: 'text', text: reconnectLink }   // {{3}} - "https://zonetrain.app/strava"
                ]
            }
        ]
    );
}


    async sendRaceDayReminder(phoneNumber, raceName, distance, strategyLink) {
    return this.sendTemplate(
        phoneNumber,
        'race_day_reminder',
        'en',
        [
            {
                type: 'body',
                parameters: [
                    { type: 'text', text: raceName },      // {{1}} - "Mumbai Marathon"
                    { type: 'text', text: distance },      // {{2}} - "42"
                    { type: 'text', text: strategyLink }   // {{3}} - "https://zonetrain.app/race/strategy/123"
                ]
            }
        ]
    );
}


    // Support Ticket (3 parameters)
async sendSupportTicket(phoneNumber, ticketNumber, issueSummary, trackingLink) {
    return this.sendTemplate(
        phoneNumber,
        'support_ticket',
        'en',
        [
            {
                type: 'body',
                parameters: [
                    { type: 'text', text: ticketNumber },    // {{1}} - "ZT-2025-001"
                    { type: 'text', text: issueSummary },    // {{2}} - "Unable to sync Strava"
                    { type: 'text', text: trackingLink }     // {{3}} - "https://zonetrain.app/support/ZT-2025-001"
                ]
            }
        ]
    );
}


    // ✅ 9. Payment Reminder (UTILITY)
    async sendPaymentReminder(phoneNumber, daysLeft, amount) {
        return this.sendTemplate(phoneNumber, 'payment_reminder_3days', 'en', [
            {
                type: 'body',
                parameters: [
                    { type: 'text', text: daysLeft },
                    { type: 'text', text: amount }
                ]
            }
        ]);
    }

    // ✅ 10. Payment Success (UTILITY)
    async sendPaymentSuccess(phoneNumber, amount, plan, nextBilling) {
        return this.sendTemplate(phoneNumber, 'payment_success', 'en', [
            {
                type: 'body',
                parameters: [
                    { type: 'text', text: amount },
                    { type: 'text', text: plan },
                    { type: 'text', text: nextBilling }
                ]
            }
        ]);
    }

    // ✅ 11. Payment Failed (UTILITY)
    async sendPaymentFailed(phoneNumber, amount, reason) {
        return this.sendTemplate(phoneNumber, 'payment_failed', 'en', [
            {
                type: 'body',
                parameters: [
                    { type: 'text', text: amount },
                    { type: 'text', text: reason }
                ]
            }
        ]);
    }


    // ✅ 13. Subscription Expired (Will be MARKETING - use carefully)
    async sendSubscriptionExpired(phoneNumber, expiryDate, renewLink) {
        return this.sendTemplate(phoneNumber, 'subscription_expired', 'en', [
            {
                type: 'body',
                parameters: [
                    { type: 'text', text: expiryDate },
                    { type: 'text', text: renewLink }
                ]
            }
        ]);
    }

    // ✅ Generic Hello World (for testing)
    async sendHelloWorld(phoneNumber) {
        return this.sendTemplate(phoneNumber, 'hello_world', 'en_US');
    }

    // Send text message (Only works within 24-hour window)
    async sendMessage(phoneNumber, message) {
        try {
            const formattedPhone = this.formatPhoneNumber(phoneNumber);
            
            const response = await axios.post(
                `${this.apiUrl}/messages`,
                {
                    messaging_product: 'whatsapp',
                    to: formattedPhone,
                    type: 'text',
                    text: {
                        body: message
                    }
                },
                {
                    headers: {
                        'Authorization': `Bearer ${this.accessToken}`,
                        'Content-Type': 'application/json'
                    }
                }
            );

            console.log('✅ Text message sent to:', phoneNumber);
            return { success: true, messageId: response.data.messages[0].id };
        } catch (error) {
            console.error('❌ Text message error:', error.response?.data || error.message);
            return { 
                success: false, 
                error: error.response?.data?.error?.message || error.message 
            };
        }
    }

    // Send interactive button message
    async sendButtonMessage(phoneNumber, bodyText, buttons) {
        try {
            const formattedPhone = this.formatPhoneNumber(phoneNumber);
            
            const formattedButtons = buttons.slice(0, 3).map((btn, index) => ({
                type: 'reply',
                reply: {
                    id: btn.id || `btn_${index}`,
                    title: btn.text.substring(0, 20)
                }
            }));

            const response = await axios.post(
                `${this.apiUrl}/messages`,
                {
                    messaging_product: 'whatsapp',
                    to: formattedPhone,
                    type: 'interactive',
                    interactive: {
                        type: 'button',
                        body: {
                            text: bodyText.substring(0, 1024)
                        },
                        action: {
                            buttons: formattedButtons
                        }
                    }
                },
                {
                    headers: {
                        'Authorization': `Bearer ${this.accessToken}`,
                        'Content-Type': 'application/json'
                    }
                }
            );

            console.log('✅ Button message sent');
            return { success: true, messageId: response.data.messages[0].id };
        } catch (error) {
            console.error('❌ Button message error:', error.response?.data || error.message);
            return { success: false, error: error.response?.data?.error?.message || error.message };
        }
    }

    // Test connection
    async testConnection() {
        try {
            const response = await axios.get(
                `https://graph.facebook.com/${this.apiVersion}/${this.phoneNumberId}`,
                {
                    headers: {
                        'Authorization': `Bearer ${this.accessToken}`
                    }
                }
            );
            
            console.log('✅ WhatsApp connection successful');
            return { success: true, data: response.data };
        } catch (error) {
            console.error('❌ Connection failed:', error.response?.data || error.message);
            return { success: false, error: error.response?.data || error.message };
        }
    }
}

module.exports = WhatsAppService;
