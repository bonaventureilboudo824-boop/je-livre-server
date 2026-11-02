'use strict';
const { wrapCallable, getReferralCore, makeDecideReferralWithdrawal } = require('../shared');
module.exports = wrapCallable(makeDecideReferralWithdrawal, getReferralCore);
