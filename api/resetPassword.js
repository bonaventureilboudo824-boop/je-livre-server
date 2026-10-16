'use strict';
const { wrapCallable, getOtpCore, makeResetPassword } = require('../shared');
module.exports = wrapCallable(makeResetPassword, getOtpCore);
