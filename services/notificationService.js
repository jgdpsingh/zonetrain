class NotificationService {
    constructor(db) {
        this.db = db;
    }

    async createNotification(userId, type, title, message, actionUrl = null) {
        await this.db.collection('notifications').add({
            userId,
            type,
            title,
            message,
            actionUrl,
            read: false,
            createdAt: new Date()
        });
    }

    async sendWorkoutReminder(userId, workout) {
        await this.createNotification(
            userId,
            'workout',
            '🏃 Today\'s Training',
            `${workout.name} - ${workout.distance}km in Zone ${workout.zone}`,
            `/workout/${workout.id}`
        );
    }

    async sendPaymentReminder(userId, daysUntilExpiry, amount) {
        await this.createNotification(
            userId,
            'payment',
            '💳 Payment Reminder',
            `Your subscription expires in ${daysUntilExpiry} days. Amount: ₹${amount}`,
            '/billing'
        );
    }

    async sendUpgradeOffer(userId) {
        await this.createNotification(
            userId,
            'upgrade',
            '🚀 Upgrade to Race Coach',
            'Get 50% off with code UPGRADE50. Limited time offer!',
            '/upgrade'
        );
    }

    async sendRecoveryReminder(userId) {
        await this.createNotification(
            userId,
            'recovery',
            '💪 Recovery Check',
            'Log your HRV and recovery status for today',
            '/recovery'
        );
    }

    async sendRaceCompleted(userId, raceName) {
        await this.createNotification(
            userId,
            'race',
            '🏁 Race Complete!',
            `Congratulations on completing ${raceName}! Set your next goal.`,
            '/race/new'
        );
    }
}

module.exports = NotificationService;
