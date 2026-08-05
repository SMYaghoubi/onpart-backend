const PAYMENT_SOUND_KEYS = Object.freeze({ submitted:'payment_submitted', approved:'payment_approved', rejected:'payment_rejected' });

function orderStatusAfterPaymentRejection() { return 'pending_payment'; }

module.exports = { PAYMENT_SOUND_KEYS, orderStatusAfterPaymentRejection };
