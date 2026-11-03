'use strict';
const { wrapCallable, getReferralCore, makeRegisterReferral } = require('../shared');
module.exports = wrapCallable(makeRegisterReferral, getReferralCore);
