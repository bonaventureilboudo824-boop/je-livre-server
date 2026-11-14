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
  db.data.drivers = { u1: { approved: true, phone: '+22670000000', pendingCommission: 0 } };
  db.data.driverWallets = { u1: { commissionBalance: 5000 } };
  let payouts = 0, fail = false;
  const provider = { createPayout: async () => { if (fail) throw new Error('boom'); payouts++; return { payoutId: 'p' + payouts, fees: 0, netAmount: 1000 }; } };
  let t = 1000000; const now = () => (t += 20000); // chaque appel avance de 20 s : le délai anti double-clic ne joue pas
  const core = createPayoutCore({ db, provider, now });
  const K = 'abcdef1234567890ABCD';
  const args = { uid: 'u1', amount: 1000, network: 'orange_bf_direct', requestKey: K };

  const r1 = await core.createCommissionWithdrawal(args);
  assert.strictEqual(r1.ok, true); assert.strictEqual(payouts, 1);
  const r2 = await core.createCommissionWithdrawal(args);           // renvoi, même clé
  assert.strictEqual(r2.replayed, true); assert.strictEqual(r2.withdrawalId, r1.withdrawalId);
  assert.strictEqual(payouts, 1, 'un seul virement');
  assert.strictEqual(db.data.driverWallets.u1.commissionBalance, 4000, 'un seul débit');

  const r3 = await core.createCommissionWithdrawal({ ...args, requestKey: 'zzzzzzzzzzzzzzzzzzzz' }); // autre clé = nouveau retrait voulu
  assert.strictEqual(r3.ok, true); assert.strictEqual(payouts, 2);

  await assert.rejects(core.createCommissionWithdrawal({ ...args, requestKey: 'court' }), (e) => e.code === 'invalid-argument');

  // échec du virement : remboursé, clé libérée, le même retrait peut être retenté avec la même clé
  fail = true; const K2 = 'failkey123456789012';
  await assert.rejects(core.createCommissionWithdrawal({ ...args, requestKey: K2 }), (e) => e.code === 'unavailable');
  assert.strictEqual(db.data.driverWallets.u1.commissionBalance, 3000, 'remboursé');
  assert.strictEqual(db.data.withdrawKeys.u1[K2], undefined, 'clé libérée');
  fail = false;
  const r4 = await core.createCommissionWithdrawal({ ...args, requestKey: K2 });
  assert.strictEqual(r4.ok, true); assert.strictEqual(payouts, 3);

  // demande restée "en cours" : refus clair, aucun virement
  db.data.withdrawKeys.u1.stuck123456789012345 = { state: 'started', at: t };
  await assert.rejects(core.createCommissionWithdrawal({ ...args, requestKey: 'stuck123456789012345' }), (e) => e.code === 'already-exists');
  assert.strictEqual(payouts, 3);

  // sans clé (anciennes versions de l'app) : comportement d'avant
  const r5 = await core.createCommissionWithdrawal({ uid: 'u1', amount: 500, network: 'orange_bf_direct' });
  assert.strictEqual(r5.ok, true); assert.strictEqual(payouts, 4);
  console.log('withdrawKey : 9/9 OK');
})().catch((e) => { console.error('ECHEC', e); process.exit(1); });
