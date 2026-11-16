'use strict';
// Chaque fonction appelée par l'application / la page admin doit avoir une route (sinon : « Failed to fetch »).
const assert = require('assert');
const handler = require('../api/[fn].js');
const NAMES = ['creditReferral', 'registerReferral', 'requestReferralWithdrawal', 'decideReferralWithdrawal', 'payCommissionFromBalance', 'deleteAccount', 'adminStats',
  'requestCommissionWithdrawal', 'linkClientAccount', 'confirmPayment', 'driverPayout', 'notifyShopNewOrder', 'notifyNearbyRequest', 'handoverCodes', 'confirmHandover'];
let n = 0;
for (const name of NAMES) {
  let status = null; const headers = {};
  const res = { statusCode: 200, setHeader: (k, v) => { headers[k] = v; }, status(c) { status = c; return this; }, json() { return this; }, end() { if (status === null) status = this.statusCode; } };
  Promise.resolve(handler({ query: { fn: name }, method: 'OPTIONS', headers: {} }, res)).then(() => {
    assert.strictEqual(status, 204, name + ' : route absente (statut ' + status + ')');
    assert.ok(headers['Access-Control-Allow-Origin'], name + ' : en-têtes CORS absents'); n++;
    if (n === NAMES.length) console.log('routes : ' + n + ' fonctions routées OK');
  }).catch((e) => { console.error(e.message); process.exit(1); });
}
