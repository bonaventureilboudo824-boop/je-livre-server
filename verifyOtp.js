'use strict';
const { wrapCallable, getOtpCore, makeVerifyOtp } = require('../shared');
module.exports = wrapCallable(makeVerifyOtp, getOtpCore);
