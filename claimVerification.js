'use strict';
const { wrapCallable, getOtpCore, makeClaimVerification } = require('../shared');
module.exports = wrapCallable(makeClaimVerification, getOtpCore);
