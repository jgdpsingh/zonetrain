const axios = require('axios');

class WhatsAppService {
    constructor() {
        this.phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID || '760488880490616';
        this.accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
        this.apiVersion = process.env.WHATSAPP_API_VERSION || 'v22.0';
        this.apiUrl = `https://graph.facebook.com/${this.apiVersion}/${this.phoneNumberId}`;
    }

    // Format phone number - Remove + and keep country code
    formatPhoneNumber(phone) {
        // Remove all non-digits
        return phone.replace(/\D/g, '');
    }

    // Send template message (Works in development mode)
    async sendTemplateMessage(phoneNumber, templateName = 'hello_world', languageCode = 'en_US') {
        try {
            const formattedPhone = this.formatPhoneNumber(phoneNumber);
            
            console.log(`📤 Sending template "${templateName}" to ${formattedPhone}`);
            
            const response = await axios.post(
                `${this.apiUrl}/messages`,
                {
                    messaging_product: 'whatsapp',
                    to: formattedPhone,
                    type: 'template',
                    template: {
                        name: templateName,
                        language: {
                            code: languageCode
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

            console.log('✅ Template message sent:', response.data);
            return { 
                success: true, 
                messageId: response.data.messages[0].id,
                waId: response.data.contacts[0].wa_id 
            };
        } catch (error) {
            console.error('❌ Template send error:', error.response?.data || error.message);
            return { 
                success: false, 
                error: error.response?.data?.error?.message || error.message 
            };
        }
    }

    // Send text message (Only works after 24-hour template window)
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
            
            // Format buttons (max 3 buttons, max 20 chars each)
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
                            text: bodyText.substring(0, 1024) // Max 1024 chars
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
