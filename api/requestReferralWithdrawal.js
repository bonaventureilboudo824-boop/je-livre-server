'use strict';
const { wrapCallable, getReferralCore, makeRequestReferralWithdrawal } = require('../shared');
module.exports = wrapCallable(makeRequestReferralWithdrawal, getReferralCore);
