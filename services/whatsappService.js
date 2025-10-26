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
    async sendEasyRunReminder(phoneNumber, distance, duration, pace, zone) {
        return this.sendTemplate(
            phoneNumber,
            'easy_run_reminder',
            'en',
            [
                {
                    type: 'body',
                    parameters: [
                        { type: 'text', text: distance },
                        { type: 'text', text: duration },
                        { type: 'text', text: pace },
                        { type: 'text', text: zone }
                    ]
                }
            ]
        );
    }

    // ✅ 3. Interval Workout (UTILITY)
    async sendIntervalWorkout(phoneNumber, sets, intervals, recovery, zone) {
        return this.sendTemplate(
            phoneNumber,
            'interval_workout_zones',
            'en',
            [
                {
                    type: 'body',
                    parameters: [
                        { type: 'text', text: sets },
                        { type: 'text', text: intervals },
                        { type: 'text', text: recovery },
                        { type: 'text', text: zone }
                    ]
                }
            ]
        );
    }

    // ✅ 4. Long Run (UTILITY)
    async sendLongRun(phoneNumber, distance, duration, zone) {
        return this.sendTemplate(
            phoneNumber,
            'long_run_reminder',
            'en',
            [
                {
                    type: 'body',
                    parameters: [
                        { type: 'text', text: distance },
                        { type: 'text', text: duration },
                        { type: 'text', text: zone }
                    ]
                }
            ]
        );
    }

    // ✅ 5. Tempo Run (UTILITY)
    async sendTempoRun(phoneNumber, distance, duration, pace, zone) {
        return this.sendTemplate(
            phoneNumber,
            'tempo_run_reminder',
            'en',
            [
                {
                    type: 'body',
                    parameters: [
                        { type: 'text', text: distance },
                        { type: 'text', text: duration },
                        { type: 'text', text: pace },
                        { type: 'text', text: zone }
                    ]
                }
            ]
        );
    }

    // ✅ 6. Threshold Run (UTILITY)
    async sendThresholdRun(phoneNumber, distance, duration, pace, zone) {
        return this.sendTemplate(
            phoneNumber,
            'threshold_run_reminder',
            'en',
            [
                {
                    type: 'body',
                    parameters: [
                        { type: 'text', text: distance },
                        { type: 'text', text: duration },
                        { type: 'text', text: pace },
                        { type: 'text', text: zone }
                    ]
                }
            ]
        );
    }

    // ✅ 7. Fartlek Run (UTILITY)
    async sendFartlekRun(phoneNumber, duration, intervals, zone) {
        return this.sendTemplate(
            phoneNumber,
            'fartlek_run_reminder',
            'en',
            [
                {
                    type: 'body',
                    parameters: [
                        { type: 'text', text: duration },
                        { type: 'text', text: intervals },
                        { type: 'text', text: zone }
                    ]
                }
            ]
        );
    }

    // ✅ 8. Strides Workout (UTILITY)
    async sendStridesWorkout(phoneNumber, reps, distance, recovery) {
        return this.sendTemplate(
            phoneNumber,
            'strides_reminder',
            'en',
            [
                {
                    type: 'body',
                    parameters: [
                        { type: 'text', text: reps },
                        { type: 'text', text: distance },
                        { type: 'text', text: recovery }
                    ]
                }
            ]
        );
    }

    // ✅ 9. Payment Reminder (UTILITY)
    async sendPaymentReminder(phoneNumber, daysLeft, amount) {
        return this.sendTemplate(
            phoneNumber,
            'payment_reminder_3days',
            'en',
            [
                {
                    type: 'body',
                    parameters: [
                        { type: 'text', text: daysLeft },
                        { type: 'text', text: amount }
                    ]
                }
            ]
        );
    }

    // ✅ 10. Payment Success (UTILITY)
    async sendPaymentSuccess(phoneNumber, amount, plan, nextBilling) {
        return this.sendTemplate(
            phoneNumber,
            'payment_success',
            'en',
            [
                {
                    type: 'body',
                    parameters: [
                        { type: 'text', text: amount },
                        { type: 'text', text: plan },
                        { type: 'text', text: nextBilling }
                    ]
                }
            ]
        );
    }

    // ✅ 11. Payment Failed (UTILITY)
    async sendPaymentFailed(phoneNumber, amount, reason) {
        return this.sendTemplate(
            phoneNumber,
            'payment_failed',
            'en',
            [
                {
                    type: 'body',
                    parameters: [
                        { type: 'text', text: amount },
                        { type: 'text', text: reason }
                    ]
                }
            ]
        );
    }

    // ✅ 12. Account Setup Required (UTILITY)
    async sendAccountSetup(phoneNumber, stravaLink, dashboardLink) {
        return this.sendTemplate(
            phoneNumber,
            'account_setup_required',
            'en',
            [
                {
                    type: 'body',
                    parameters: [
                        { type: 'text', text: stravaLink },
                        { type: 'text', text: dashboardLink }
                    ]
                }
            ]
        );
    }

    // ✅ 13. Subscription Expired (Will be MARKETING - use carefully)
    async sendSubscriptionExpired(phoneNumber, expiryDate, renewLink) {
        return this.sendTemplate(
            phoneNumber,
            'subscription_expired',
            'en',
            [
                {
                    type: 'body',
                    parameters: [
                        { type: 'text', text: expiryDate },
                        { type: 'text', text: renewLink }
                    ]
                }
            ]
        );
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
