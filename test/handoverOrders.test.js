'use strict';
// Codes de remise pour les commandes boutique (serveur + règles).
const assert = require('assert');
const fs = require('fs'); const path = require('path');
const targaryen = require('targaryen');
const { createHandoverCore } = require('../shared');
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };
function fakeDb(init) {
  const data = JSON.parse(JSON.stringify(init));
  const parts = (p) => p.split('/').filter(Boolean);
  const get = (p) => parts(p).reduce((o, k) => (o == null ? undefined : o[k]), data);
  const set = (p, v) => { const ks = parts(p); let o = data; ks.slice(0, -1).forEach((k) => { if (o[k] == null || typeof o[k] !== 'object') o[k] = {}; o = o[k]; }); o[ks[ks.length - 1]] = v; };
  const snap = (v) => ({ val: () => (v === undefined ? null : JSON.parse(JSON.stringify(v))) });
  const ref = (p = '') => ({
    once: async () => snap(get(p)),
    update: async (v) => { Object.entries(v).forEach(([k, x]) => set((p ? p + '/' : '') + k, x)); },
    transaction: async (fn) => { const c = get(p); const nv = fn(c === undefined ? null : c); if (nv === undefined) return { committed: false, snapshot: snap(c) }; set(p, nv); return { committed: true, snapshot: snap(nv) }; },
  });
  return { ref, data };
}
const fails = async (p, code, m) => { try { await p; } catch (e) { assert.strictEqual(e.code, code, m + ' (' + e.code + ')'); n++; return; } assert.fail(m); };
(async () => {
  const db = fakeDb({ marketplaceOrders: {
    o1: { shopId: 's1', clientUid: 'c1', assignedDriverId: 'd1', status: 'assigned', handover: true, paymentMethod: 'online', paymentStatus: 'paid' },
    o2: { shopId: 's1', clientUid: 'c1', assignedDriverId: 'd1', status: 'assigned', handover: true, paymentMethod: 'pay_on_delivery', paymentStatus: 'pending' },
  } });
  let seq = 0; const vals = [1111, 2222, 3333, 4444];
  const core = createHandoverCore({ db, now: () => 5, randomInt: () => vals[seq++ % 4] });
  const K = 'order';
  const shop = await core.getHandoverCodes({ uid: 's1', requestId: 'o1', kind: K });
  ok(shop.pickup === '1111' && shop.delivery === undefined && shop.role === 'shop', 'la boutique voit seulement le code de récupération');
  const cli = await core.getHandoverCodes({ uid: 'c1', requestId: 'o1', kind: K });
  ok(cli.delivery === '2222' && cli.pickup === undefined, 'le client voit seulement le code de remise');
  await fails(core.getHandoverCodes({ uid: 'x', requestId: 'o1', kind: K }), 'permission-denied', 'étranger');
  await fails(core.confirmHandover({ uid: 'd1', requestId: 'o1', step: 'delivery', code: '2222', kind: K }), 'failed-precondition', 'remise avant récupération');
  await fails(core.confirmHandover({ uid: 'd2', requestId: 'o1', step: 'pickup', code: '1111', kind: K }), 'permission-denied', 'autre livreur');
  await fails(core.confirmHandover({ uid: 'd1', requestId: 'o1', step: 'pickup', code: '9999', kind: K }), 'permission-denied', 'mauvais code');
  let r = await core.confirmHandover({ uid: 'd1', requestId: 'o1', step: 'pickup', code: '1111', kind: K });
  ok(r.ok && !r.completed && db.data.marketplaceOrders.o1.pickedUpAt === 5 && db.data.marketplaceOrders.o1.status === 'assigned', 'récupération validée');
  r = await core.confirmHandover({ uid: 'd1', requestId: 'o1', step: 'delivery', code: '2222', kind: K });
  ok(r.completed && db.data.marketplaceOrders.o1.status === 'delivered' && db.data.marketplaceOrders.o1.deliveredAt === 5, 'commande payée -> livrée');
  r = await core.confirmHandover({ uid: 'd1', requestId: 'o1', step: 'delivery', code: '2222', kind: K });
  ok(r.already, 'rejouer ne change rien');
  await core.getHandoverCodes({ uid: 'c1', requestId: 'o2', kind: K });
  const c2 = db.data.deliveryCodes.o2;
  await core.confirmHandover({ uid: 'd1', requestId: 'o2', step: 'pickup', code: c2.pickup, kind: K });
  r = await core.confirmHandover({ uid: 'd1', requestId: 'o2', step: 'delivery', code: c2.delivery, kind: K });
  ok(r.completed && db.data.marketplaceOrders.o2.status === 'awaiting_payment', 'paiement à la remise -> attente du paiement');

  // Règles
  const rules = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'database.rules.json'), 'utf8'));
  const d = targaryen.database(rules, { adminUsers: { a1: true }, drivers: { d1: { approved: true } }, marketplaceOrders: {
    h: { shopId: 's1', clientUid: 'c1', assignedDriverId: 'd1', status: 'assigned', handover: true, paymentMethod: 'online', paymentStatus: 'paid', total: 100, deliveryFee: 10, subtotal: 90 },
    dl: { shopId: 's1', clientUid: 'c1', assignedDriverId: 'd1', status: 'delivered', handover: true, paymentMethod: 'online', paymentStatus: 'paid', total: 100, deliveryFee: 10, subtotal: 90 },
    old: { shopId: 's1', clientUid: 'c1', assignedDriverId: 'd1', status: 'assigned', paymentMethod: 'online', paymentStatus: 'paid', total: 100, deliveryFee: 10, subtotal: 90 },
  } });
  const U = (uid) => ({ uid });
  ok(!d.as(U('d1')).write('marketplaceOrders/h/status', 'delivered').allowed, 'livreur ne livre pas seul');
  ok(!d.as(U('d1')).write('marketplaceOrders/h/status', 'awaiting_payment').allowed, 'ni attente de paiement');
  ok(!d.as(U('d1')).write('marketplaceOrders/h/status', 'completed').allowed, 'ni terminée');
  ok(!d.as(U('d1')).write('marketplaceOrders/h/pickedUpAt', 1).allowed, 'ni récupéré');
  ok(!d.as(U('d1')).write('marketplaceOrders/h/deliveredAt', 1).allowed, 'ni date de livraison');
  ok(!d.as(U('c1')).write('marketplaceOrders/h/status', 'completed').allowed, 'client ne termine pas avant livraison');
  ok(d.as(U('c1')).write('marketplaceOrders/dl/status', 'completed').allowed, 'client confirme après livraison');
  ok(d.as(U('a1')).write('marketplaceOrders/h/status', 'delivered').allowed, 'admin/serveur ok');
  ok(d.as(U('d1')).write('marketplaceOrders/old/status', 'delivered').allowed, 'ancienne commande inchangée');
  const base = { shopId: 's1', clientUid: 'c9', status: 'awaiting_payment', paymentMethod: 'online', paymentStatus: 'pending', total: 1, deliveryFee: 0, subtotal: 1 };
  ok(d.as(U('c9')).write('marketplaceOrders/n1', { ...base, handover: true }).allowed, 'création en ligne avec codes');
  ok(!d.as(U('c9')).write('marketplaceOrders/n2', { ...base, handover: false }).allowed, 'handover seulement vrai');
  console.log('handoverOrders : ' + n + ' vérifications OK');
})().catch((e) => { console.error(e); process.exit(1); });
