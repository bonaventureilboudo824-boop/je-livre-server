'use strict';
const { wrapRaw, getPaymentCore, makeWebhook } = require('../shared');
module.exports = wrapRaw(makeWebhook, getPaymentCore);
