'use strict';
const { wrapCallable, getPaymentCore, makeCreatePayment } = require('../shared');
module.exports = wrapCallable(makeCreatePayment, getPaymentCore);
