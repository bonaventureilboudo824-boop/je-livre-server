'use strict';
const { wrapCallable, getCommissionCore, makePayCommissionFromBalance } = require('../shared');
module.exports = wrapCallable(makePayCommissionFromBalance, getCommissionCore);
