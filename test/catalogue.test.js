'use strict';
// Catalogue dans Supabase côté serveur : lecture des prix, compteurs d'achats, suppression de compte.
const assert = require('assert');
const { createCatalogueCore, createPaymentCore, createAccountCore } = require('../shared');
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };
const fails = async (p, code, m) => { try { await p; } catch (e) { assert.strictEqual(e.code, code, m + ' (code ' + e.code + ')'); n++; return; } assert.fail('devait échouer : ' + m); };
function fakeDb(init) {
  const data = JSON.parse(JSON.stringify(init));
  const parts = (p) => p.split('/').filter(Boolean);
  const get = (p) => parts(p).reduce((o, k) => (o == null ? undefined : o[k]), data);
  const set = (p, v) => { const ks = parts(p); if (!ks.length) return; let o = data; ks.slice(0, -1).forEach((k) => { if (o[k] == null || typeof o[k] !== 'object') o[k] = {}; o = o[k]; }); if (v === null) delete o[ks[ks.length - 1]]; else o[ks[ks.length - 1]] = v; };
  const snap = (v) => ({ val: () => (v === undefined ? null : JSON.parse(JSON.stringify(v))) });
  const ref = (p = '') => ({
    once: async () => snap(get(p)),
    set: async (v) => set(p, v),
    update: async (v) => { Object.entries(v).forEach(([k, x]) => set((p ? p + '/' : '') + k, x)); },
    child: (c) => ref((p ? p + '/' : '') + c),
    transaction: async (fn) => { const c = get(p); const nv = fn(c === undefined ? null : c); if (nv === undefined) return { committed: false, snapshot: snap(c) }; set(p, nv); return { committed: true, snapshot: snap(nv) }; },
    orderByChild: (child) => ({ equalTo: (val) => ({ once: async () => { const all = get(p) || {}; const out = {}; Object.keys(all).forEach((k) => { if (all[k] && all[k][child] === val) out[k] = all[k]; }); return snap(Object.keys(out).length ? out : null); } }) }),
  });
  return { ref, data };
}
// Faux Supabase + faux Firebase Auth
function fakeNet(opts = {}) {
  const calls = []; const state = { down: false, signIns: 0 };
  const products = { p1: { shop_id: 's1', data: { name: 'Robe', price: 5000 }, created_at: 7 } };
  const fetchFn = async (url, init = {}) => {
    calls.push({ url, init });
    const res = (status, body) => ({ ok: status < 300, status, json: async () => body, text: async () => (body === undefined ? '' : JSON.stringify(body)) });
    if (url.includes('identitytoolkit')) { state.signIns++; return opts.noToken ? res(400, { error: 'x' }) : res(200, { idToken: 'TOK' + state.signIns }); }
    if (state.down) return res(503, { message: 'down' });
    if (url.includes('/products?')) { const id = decodeURIComponent(url.split('id=eq.')[1]); return res(200, products[id] ? [{ id, ...products[id] }] : []); }
    if (url.includes('rpc/jl_product_purchase')) return res(200, null);
    if (url.includes('rpc/jl_purge_user')) return res(200, { produits: 2, reels: 1, commentaires: 3 });
    return res(404, {});
  };
  const auth = { createCustomToken: async (uid, claims) => { calls.push({ custom: uid, claims }); return 'CUSTOM'; }, deleteUser: async () => {} };
  return { fetchFn, auth, calls, state };
}

(async () => {
  // --- le module lui-même
  let net = fakeNet(); let T = 1000;
  const cat = createCatalogueCore({ auth: net.auth, fetchFn: net.fetchFn, now: () => T, active: true });
  const p = await cat.getProduct('p1');
  ok(p.price === 5000 && p.shopId === 's1' && p.name === 'Robe' && p.createdAt === 7, 'produit relu avec la forme Firebase');
  ok(net.calls.find((c) => c.custom).custom === 'svc-je-livre-server' && net.calls.find((c) => c.custom).claims.role === 'authenticated', 'jeton du compte technique avec role authenticated');
  ok(net.calls.find((c) => c.url && c.url.includes('/products?')).init.headers.Authorization === 'Bearer TOK1', 'appel avec le jeton signé');
  await cat.getProduct('p1'); ok(net.state.signIns === 1, 'jeton réutilisé');
  T += 46 * 60 * 1000; await cat.getProduct('p1'); ok(net.state.signIns === 2, 'jeton renouvelé après 45 min');
  ok((await cat.getProduct('inconnu')) === null, 'produit absent -> null');
  ok((await cat.getProduct('a/../b')) === null && (await cat.getProduct("x'or'1")) === null, 'identifiant douteux refusé sans appel');
  await cat.addPurchase('p1', 2);
  const buy = net.calls.filter((c) => c.url && c.url.includes('jl_product_purchase')).pop();
  ok(JSON.parse(buy.init.body).p_qty === 2 && JSON.parse(buy.init.body).p_key === 'p1', 'achat compté via la fonction Supabase');
  net.state.down = true; await fails(cat.getProduct('p1'), 'unavailable', 'panne Supabase signalée');
  net.state.down = false;
  await fails(createCatalogueCore({ auth: fakeNet({ noToken: true }).auth, fetchFn: fakeNet({ noToken: true }).fetchFn }).getProduct('p1'), 'unavailable', 'connexion refusée');

  // --- paiement : le prix vient de Supabase, jamais d'un Firebase périmé
  const mkDb = () => fakeDb({
    shops: { s1: { approved: true, coords: { lat: 12.37, lng: -1.52 } } },
    marketplaceOrders: { 'CMD-AAA111': { clientUid: 'c1', shopId: 's1', paymentMethod: 'online', status: 'awaiting_payment', items: [{ pid: 'p1', qty: 2 }], clientCoords: { lat: 12.37, lng: -1.52 } } },
    products: { p1: { shopId: 's1', name: 'Robe', price: 1 } }, // ancien prix Firebase (faux)
  });
  const provider = { name: 'fake', createCheckout: async ({ txId, amount }) => ({ paymentUrl: 'https://pay/' + txId, providerRef: 'p_' + txId, amount }), verifyTransaction: async () => ({ status: 'pending' }) };
  let db = mkDb(); net = fakeNet();
  let core = createPaymentCore({ db, provider, providerName: 'fake', urls: { appBaseUrl: 'https://jelivre.shop', webhookUrl: 'x' }, now: () => 1700000000000, random: () => 0.5, catalogue: createCatalogueCore({ auth: net.auth, fetchFn: net.fetchFn, active: true }) });
  let r = await core.createPayment({ uid: 'c1', orderIds: ['CMD-AAA111'] });
  ok(db.data.marketplaceOrders['CMD-AAA111'].subtotal === 10000 && r.amount >= 10000, 'prix 5000 x 2 lu dans Supabase (pas le faux prix Firebase)');
  // même commande, source Firebase (comportement actuel inchangé)
  db = mkDb();
  core = createPaymentCore({ db, provider, providerName: 'fake', urls: { appBaseUrl: 'https://jelivre.shop', webhookUrl: 'x' }, now: () => 1700000000000, random: () => 0.5, catalogue: createCatalogueCore({ auth: net.auth, fetchFn: net.fetchFn, active: false }) });
  await core.createPayment({ uid: 'c1', orderIds: ['CMD-AAA111'] });
  ok(db.data.marketplaceOrders['CMD-AAA111'].subtotal === 2, 'source Firebase : comportement actuel inchangé');
  // panne Supabase : le paiement est refusé
  db = mkDb(); net = fakeNet(); net.state.down = true;
  core = createPaymentCore({ db, provider, providerName: 'fake', urls: { appBaseUrl: 'https://jelivre.shop', webhookUrl: 'x' }, now: () => 1700000000000, random: () => 0.5, catalogue: createCatalogueCore({ auth: net.auth, fetchFn: net.fetchFn, active: true }) });
  await fails(core.createPayment({ uid: 'c1', orderIds: ['CMD-AAA111'] }), 'unavailable', 'panne catalogue -> paiement refusé, jamais de prix périmé');
  ok(!db.data.payments, 'aucun paiement enregistré en cas de panne');

  // --- suppression de compte : Supabase aussi
  net = fakeNet();
  db = fakeDb({ users: { u9: { name: 'x' } } });
  const acc = createAccountCore({ db, auth: net.auth, now: () => 5, catalogue: createCatalogueCore({ auth: net.auth, fetchFn: net.fetchFn, active: true }) });
  const del = await acc.deleteAccount({ uid: 'u9', confirm: 'SUPPRIMER' });
  ok(del.ok && del.removed.produits === 2 && del.removed.reels === 1 && del.removed.commentaires === 3, 'contenus Supabase effacés et comptés');
  ok(net.calls.some((c) => c.url && c.url.includes('jl_purge_user') && JSON.parse(c.init.body).p_uid === 'u9'), 'purge demandée pour ce compte');
  net = fakeNet(); net.state.down = true; db = fakeDb({ users: { u9: { name: 'x' } } });
  const acc2 = createAccountCore({ db, auth: net.auth, now: () => 5, catalogue: createCatalogueCore({ auth: net.auth, fetchFn: net.fetchFn, active: true }) });
  await fails(acc2.deleteAccount({ uid: 'u9', confirm: 'SUPPRIMER' }), 'internal', 'panne Supabase : le compte de connexion n\'est PAS fermé');

  console.log('catalogue.test.js : ' + n + ' vérifications OK');
})().catch((e) => { console.error(e); process.exit(1); });
