'use strict';
// Notifications du parcours livreur : acceptation + étapes de remise.
const assert = require('assert');
const { createNotifyCore, createHandoverCore } = require('../shared');
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };
function fakeDb(init) {
  const data = JSON.parse(JSON.stringify(init));
  const parts = (p) => p.split('/').filter(Boolean);
  const get = (p) => parts(p).reduce((o, k) => (o == null ? undefined : o[k]), data);
  const set = (p, v) => { const ks = parts(p); let o = data; ks.slice(0, -1).forEach((k) => { if (o[k] == null || typeof o[k] !== 'object') o[k] = {}; o = o[k]; }); o[ks[ks.length - 1]] = v; };
  const snap = (v) => ({ val: () => (v === undefined ? null : JSON.parse(JSON.stringify(v))) });
  const ref = (p = '') => ({
    once: async () => snap(get(p)), set: async (v) => set(p, v), remove: async () => set(p, null),
    update: async (v) => { Object.entries(v).forEach(([k, x]) => set((p ? p + '/' : '') + k, x)); },
    transaction: async (fn) => { const c = get(p); const nv = fn(c === undefined ? null : c); if (nv === undefined) return { committed: false, snapshot: snap(c) }; set(p, nv); return { committed: true, snapshot: snap(nv) }; },
  });
  return { ref, data };
}
const fails = async (p, code, m) => { try { await p; } catch (e) { assert.strictEqual(e.code, code, m); n++; return; } assert.fail(m); };
(async () => {
  const db = fakeDb({
    users: { c1: { fcmToken: 'tc1' } }, shops: { s1: { fcmToken: 'ts1' } },
    deliveryRequests: { req1: { clientUid: 'c1', assignedDriverId: 'd1', assignedDriverName: 'Issa', status: 'assigned', handover: true, recipientCoords: { lat: 1, lng: 1 } } },
    marketplaceOrders: { CMD1: { clientUid: 'c1', shopId: 's1', assignedDriverId: 'd1', status: 'assigned', handover: true, paymentMethod: 'pay_on_delivery', paymentStatus: 'pending' } },
  });
  const sent = [];
  const core = createNotifyCore({ db, messaging: { send: async (m) => { sent.push(m); } }, now: () => 9 });
  await fails(core.notifyAssigned({ callerUid: 'd2', kind: 'delivery', requestId: 'req1' }), 'permission-denied', 'autre livreur');
  await fails(core.notifyAssigned({ callerUid: null, kind: 'delivery', requestId: 'req1' }), 'unauthenticated', 'connexion');
  let r = await core.notifyAssigned({ callerUid: 'd1', kind: 'delivery', requestId: 'req1' });
  ok(r.sent === 1 && sent[0].token === 'tc1', 'le client est prévenu');
  r = await core.notifyAssigned({ callerUid: 'd1', kind: 'delivery', requestId: 'req1' });
  ok(r.already && sent.length === 1, 'une seule fois');
  r = await core.notifyAssigned({ callerUid: 'd1', kind: 'order', requestId: 'CMD1' });
  ok(r.sent === 2 && sent.some((m) => m.token === 'ts1'), 'client + boutique prévenus pour une commande');
  // Étapes de remise
  const notes = [];
  const hc = createHandoverCore({ db, now: () => 5, randomInt: () => 1234, notify: async (m) => { notes.push(m); } });
  await hc.getHandoverCodes({ uid: 'c1', requestId: 'CMD1', kind: 'order' });
  await hc.confirmHandover({ uid: 'd1', requestId: 'CMD1', step: 'pickup', code: '1234', kind: 'order' });
  await hc.confirmHandover({ uid: 'd1', requestId: 'CMD1', step: 'delivery', code: '1234', kind: 'order' });
  ok(notes.length === 2 && notes[0].uid === 'c1' && /en route/.test(notes[0].body) && /Réglez/.test(notes[1].body), 'client prévenu à la récupération puis invité à payer');
  const failing = createHandoverCore({ db, now: () => 5, randomInt: () => 1234, notify: async () => { throw new Error('fcm down'); } });
  await failing.getHandoverCodes({ uid: 'c1', requestId: 'req1', kind: 'request' });
  const rr = await failing.confirmHandover({ uid: 'd1', requestId: 'req1', step: 'pickup', code: '1234', kind: 'request' });
  ok(rr.ok, 'une notification en panne ne bloque pas la validation');
  console.log('notifyFlow : ' + n + ' vérifications OK');
})().catch((e) => { console.error(e); process.exit(1); });
