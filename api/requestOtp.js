'use strict';
const { wrapCallable, getOtpCore, makeRequestOtp } = require('../shared');
module.exports = wrapCallable(makeRequestOtp, getOtpCore);
