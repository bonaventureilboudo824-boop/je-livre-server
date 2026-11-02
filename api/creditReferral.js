'use strict';
const { wrapCallable, getReferralCore, makeCreditReferral } = require('../shared');
module.exports = wrapCallable(makeCreditReferral, getReferralCore);
