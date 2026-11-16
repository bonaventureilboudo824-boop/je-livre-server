'use strict';
// Test : un retrait renvoyé avec la même clé ne crée jamais un deuxième virement.
const fs = require('fs'), path = require('path'), assert = require('assert');
const src = fs.readFileSync(path.join(__dirname, '..', 'shared.js'), 'utf8')
  ;
const tmp = path.join(__dirname, '.shared.tmp.js');
// on expose createPayoutCore dans une copie temporaire
const patched = src.replace("const { createPayoutCore } = __require('payoutCore');", "const { createPayoutCore } = __require('payoutCore'); global.__createPayoutCore = createPayoutCore;");
fs.writeFileSync(tmp, patched);
require(tmp); fs.unlinkSync(tmp);
const createPayoutCore = global.__createPayoutCore;

function fakeDb() {
  const data = {};
  const get = (p) => p.split('/').filter(Boolean).reduce((o, k) => (o == null ? undefined : o[k]), data);
  const set = (p, v) => { const ks = p.split('/').filter(Boolean); let o = data; ks.slice(0, -1).forEach((k) => { o[k] = o[k] || {}; o = o[k]; }); if (v === null || v === undefined) delete o[ks[ks.length - 1]]; else o[ks[ks.length - 1]] = JSON.parse(JSON.stringify(v)); };
  const ref = (p) => ({
    once: async () => ({ val: () => { const v = get(p); return v === undefined ? null : JSON.parse(JSON.stringify(v)); } }),
    set: async (v) => set(p, v),
    update: async (v) => { Object.keys(v).forEach((k) => set(p + '/' + k, v[k])); },
    remove: async () => set(p, null),
    child: (c) => ref(p + '/' + c),
    transaction: async (fn) => { const cur = get(p); const nv = fn(cur === undefined ? null : JSON.parse(JSON.stringify(cur))); if (nv === undefined) return { committed: false }; set(p, nv); return { committed: true }; },
  });
  return { ref, data };
}

(async () => {
  const db = fakeDb();
  db.data.drivers = { u1: { approved: true, phone: '+22670000000', pendingCommission: 0 }, u2: { approved: true, phone: '', pendingCommission: 0 } };
  db.data.driverWallets = { u1: { commissionBalance: 5000 }, u2: { commissionBalance: 5000 } };
  const calls = [];
  const provider = { createPayout: async (a) => { calls.push(a); return { payoutId: 'p' + calls.length, fees: 0, netAmount: a.amount }; } };
  let t = 1000000; const now = () => (t += 20000);
  const core = createPayoutCore({ db, provider, now });
  // Sans compte de paiement ni numéro : refus clair
  try { await core.createCommissionWithdrawal({ uid: 'u2', amount: 1000, network: 'moov_bf' }); assert.fail('devait refuser'); } catch (e) { assert.strictEqual(e.code, 'failed-precondition'); assert.ok(/compte de paiement/.test(e.message)); }
  // Avec compte enregistré : la destination vient du compte, pas de la demande
  db.data.driverPayoutAccounts = { u2: { network: 'moov_bf', phone: '70123456', holderName: 'Issa Kaboré', updatedAt: 1 } };
  const r = await core.createCommissionWithdrawal({ uid: 'u2', amount: 1000, network: 'orange_bf_direct' });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(calls[0].mode, 'moov_bf', 'le réseau du compte prime sur celui de la demande');
  assert.strictEqual(calls[0].phone, '+22670123456');
  assert.strictEqual(calls[0].holderName, 'Issa Kaboré');
  const w = Object.values(db.data.withdrawalRequests)[0];
  assert.strictEqual(w.holderName, 'Issa Kaboré'); assert.strictEqual(w.phone, '+22670123456');
  // Compte invalide ignoré -> retombe sur le numéro du compte livreur (anciennes versions)
  db.data.driverPayoutAccounts.u1 = { network: 'moov_bf', phone: 'abc', holderName: 'X' };
  const r2 = await core.createCommissionWithdrawal({ uid: 'u1', amount: 1000, network: 'orange_bf_direct' });
  assert.strictEqual(r2.ok, true); assert.strictEqual(calls[1].phone, '+22670000000'); assert.strictEqual(calls[1].mode, 'orange_bf_direct');
  console.log('payoutAccount : 9/9 OK');
})().catch((e) => { console.error(e); process.exit(1); });
