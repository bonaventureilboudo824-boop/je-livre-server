'use strict';
const { wrapRaw, getPaymentCore, makeMockPay } = require('../shared');
module.exports = wrapRaw(makeMockPay, getPaymentCore);
