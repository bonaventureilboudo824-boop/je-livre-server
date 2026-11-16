'use strict';
// Au retour de HorusPay, l'app demande au serveur de confirmer le paiement (sans dépendre du webhook).
const assert = require('assert');
const { createPaymentCore } = require('../shared');

function fakeDb(init) {
  const data = JSON.parse(JSON.stringify(init));
  const parts = (p) => p.split('/').filter(Boolean);
  const get = (p) => parts(p).reduce((o, k) => (o == null ? undefined : o[k]), data);
  const set = (p, v) => { const ks = parts(p); if (!ks.length) return; let o = data; ks.slice(0, -1).forEach((k) => { if (o[k] == null || typeof o[k] !== 'object') o[k] = {}; o = o[k]; }); if (v === null || v === undefined) delete o[ks[ks.length - 1]]; else o[ks[ks.length - 1]] = JSON.parse(JSON.stringify(v)); };
  const snap = (v) => ({ val: () => (v === undefined ? null : JSON.parse(JSON.stringify(v))) });
  const ref = (p = '') => ({
    once: async () => snap(get(p)),
    set: async (v) => set(p, v),
    update: async (v) => { Object.entries(v).forEach(([k, x]) => set((p ? p + '/' : '') + k, x)); },
    child: (c) => ref((p ? p + '/' : '') + c),
    transaction: async (fn) => { const c = get(p); const n = fn(c === undefined ? null : c); if (n === undefined) return { committed: false, snapshot: snap(c) }; set(p, n); return { committed: true, snapshot: snap(n) }; },
    orderByChild: (child) => ({ equalTo: (val) => ({ once: async () => { const all = get(p) || {}; const out = {}; Object.keys(all).forEach((k) => { if (all[k] && all[k][child] === val) out[k] = all[k]; }); return snap(out); } }) }),
  });
  return { ref, data };
}
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };
const fails = async (p, code, m) => { try { await p; } catch (e) { assert.strictEqual(e.code, code, m + ' (code ' + e.code + ')'); n++; return; } assert.fail('devait échouer : ' + m); };

(async () => {
  const NOW = 1700000000000;
  const db = fakeDb({
    deliveryRequests: { r1: { status: 'awaiting_payment', paymentStatus: 'unpaid', clientUid: 'c1', type: 'simple' } },
    payments: {
      JLAAAAAA1: { txId: 'JLAAAAAA1', clientUid: 'c1', kind: 'delivery', requestId: 'r1', amount: 1500, currency: 'XOF', status: 'initiated', providerRef: '77', createdAt: NOW - 1000 },
      JLBBBBBB2: { txId: 'JLBBBBBB2', clientUid: 'c2', kind: 'delivery', requestId: 'r9', amount: 1000, currency: 'XOF', status: 'initiated', providerRef: '78', createdAt: NOW - 1000 },
    },
  });
  let providerStatus = 'pending';
  const provider = { name: 'fake', verifyTransaction: async () => ({ status: providerStatus, amount: 1500, currency: 'XOF' }) };
  const core = createPaymentCore({ db, provider, providerName: 'fake', urls: {}, now: () => NOW });

  await fails(core.confirmPayment({ uid: null, txId: 'JLAAAAAA1' }), 'unauthenticated', 'connexion requise');
  await fails(core.confirmPayment({ uid: 'c1', txId: 'JLBBBBBB2' }), 'not-found', 'paiement d\'un autre client');
  await fails(core.confirmPayment({ uid: 'c1', txId: 'zz' }), 'invalid-argument', 'identifiant invalide');

  let r = await core.confirmPayment({ uid: 'c1', txId: 'JLAAAAAA1' });
  ok(r.status === 'initiated', 'pas encore payé chez HorusPay : on attend');
  ok(db.data.deliveryRequests.r1.status === 'awaiting_payment', 'livraison toujours en attente');

  providerStatus = 'paid';
  r = await core.confirmPayment({ uid: 'c1', txId: 'JLAAAAAA1' });
  ok(r.status === 'paid', 'paiement confirmé');
  ok(db.data.deliveryRequests.r1.status === 'pending' && db.data.deliveryRequests.r1.paymentStatus === 'paid', 'livraison marquée payée et visible des livreurs');
  r = await core.confirmPayment({ uid: 'c1', txId: 'JLAAAAAA1' });
  ok(r.status === 'paid', 'rappel sans danger');

  // Rattrapage sans identifiant
  db.data.deliveryRequests.r2 = { status: 'awaiting_payment', paymentStatus: 'unpaid', clientUid: 'c1', type: 'simple' };
  db.data.payments.JLCCCCCC3 = { txId: 'JLCCCCCC3', clientUid: 'c1', kind: 'delivery', requestId: 'r2', amount: 1500, currency: 'XOF', status: 'initiated', providerRef: '79', createdAt: NOW - 5000 };
  const rc = await core.confirmPayment({ uid: 'c1' });
  ok(rc.checked === 1 && rc.settled.length === 1 && rc.settled[0].txId === 'JLCCCCCC3', 'paiement perdu rattrapé');
  ok(db.data.deliveryRequests.r2.paymentStatus === 'paid', 'livraison perdue débloquée');
  ok(db.data.payments.JLBBBBBB2.status === 'initiated', "paiement d'un autre client intact");
  console.log('confirmPayment : ' + n + ' vérifications OK');
})().catch((e) => { console.error(e); process.exit(1); });
