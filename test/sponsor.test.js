'use strict';
// Reels sponsorisés : paiement 5000 F, activation 10 jours, plafond de 200.
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
  let NOW = 1700000000000;
  const mk = (extra) => ({ ownerUid: 'u1', status: 'awaiting_payment', videoUrl: 'https://res.cloudinary.com/x/video.mp4', linkUrl: 'https://wa.me/22670000000', ...extra });
  const db = fakeDb({ sponsoredReels: { sp_aaa: mk(), sp_bbb: mk({ ownerUid: 'u2' }) } });
  let status = 'pending'; let amount = 5000;
  const provider = {
    name: 'fake',
    createCheckout: async ({ txId, amount: a }) => ({ paymentUrl: 'https://pay/' + txId, providerRef: 'p_' + txId, a }),
    verifyTransaction: async () => ({ status, amount, currency: 'XOF' }),
  };
  const core = createPaymentCore({ db, provider, providerName: 'fake', urls: { appBaseUrl: 'https://jelivre.shop', webhookUrl: 'x' }, now: () => NOW, random: () => 0.5 });

  await fails(core.createPayment({ uid: 'u1', sponsorId: 'zz' }), 'invalid-argument', 'identifiant invalide');
  await fails(core.createPayment({ uid: 'u1', sponsorId: 'sp_bbb' }), 'permission-denied', "le Reel d'un autre");
  await fails(core.createPayment({ uid: 'u1', sponsorId: 'sp_nope' }), 'not-found', 'inexistant');
  const r = await core.createPayment({ uid: 'u1', sponsorId: 'sp_aaa' });
  ok(r.amount === 5000 && /\/\?payment=return&k=sponsor/.test(JSON.stringify(db.data)) || r.amount === 5000, 'montant fixé par le serveur : 5000 F');
  ok(db.data.payments[r.txId].kind === 'sponsor' && db.data.payments[r.txId].amount === 5000, 'paiement enregistré');
  let c = await core.confirmPayment({ uid: 'u1', txId: r.txId });
  ok(db.data.sponsoredReels.sp_aaa.status === 'awaiting_payment', 'pas payé : pas actif');
  status = 'paid'; amount = 1000;
  c = await core.confirmPayment({ uid: 'u1', txId: r.txId });
  ok(db.data.sponsoredReels.sp_aaa.status === 'awaiting_payment' && c.status === 'amount_mismatch', 'mauvais montant : refusé');
  const r2 = await core.createPayment({ uid: 'u1', sponsorId: 'sp_aaa' }).catch(() => null); NOW += 5000;
  const r3 = await core.createPayment({ uid: 'u1', sponsorId: 'sp_aaa' });
  amount = 5000;
  c = await core.confirmPayment({ uid: 'u1', txId: r3.txId });
  const sp = db.data.sponsoredReels.sp_aaa;
  ok(c.status === 'paid' && sp.status === 'active' && sp.paymentStatus === 'paid', 'payé : actif');
  ok(sp.endsAt - sp.startsAt === 10 * 24 * 3600 * 1000, 'dure 10 jours');
  await fails(core.createPayment({ uid: 'u1', sponsorId: 'sp_aaa' }), 'failed-precondition', 'déjà payé');
  await core.confirmPayment({ uid: 'u1', txId: r3.txId });
  ok(db.data.sponsoredReels.sp_aaa.startsAt === sp.startsAt, 'rappel sans effet');

  // Plafond de 200
  const full = {};
  for (let i = 0; i < 200; i++) full['sp_x' + i] = mk({ ownerUid: 'z' + i, status: 'active', endsAt: NOW + 86400000 });
  Object.assign(db.data.sponsoredReels, full);
  NOW += 5000;
  await fails(core.createPayment({ uid: 'u2', sponsorId: 'sp_bbb' }), 'resource-exhausted', 'complet');
  // Les expirés libèrent leur place
  db.data.sponsoredReels.sp_x0.endsAt = NOW - 1; db.data.sponsoredReels.sp_x1.endsAt = NOW - 1;
  NOW += 5000;
  const r4 = await core.createPayment({ uid: 'u2', sponsorId: 'sp_bbb' });
  ok(!!r4.txId, 'une place expirée libère le plafond');
  console.log('sponsor : ' + n + ' vérifications OK');
})().catch((e) => { console.error(e); process.exit(1); });
