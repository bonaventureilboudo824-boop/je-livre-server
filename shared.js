'use strict';

// ====================================================================
// Fichier généré automatiquement : regroupe tout le code serveur (déjà
// testé, inchangé) en un seul fichier, pour un dépôt plus simple et plus
// fiable sur GitHub (plus besoin de déposer des dossiers entiers).
// Chaque point d'accès (api/*.js) se contente de faire :
//   const shared = require('../shared');
// ====================================================================

const __modules = {};
const __cache = {};
function __define(key, factory) { __modules[key] = factory; }
function __require(key) {
  if (!(key in __modules)) return require(key); // vrai paquet npm (firebase-admin, crypto...)
  if (key in __cache) return __cache[key];
  const mod = { exports: {} };
  __cache[key] = mod.exports; // évite les boucles infinies si jamais deux modules se citent mutuellement
  __modules[key](mod, mod.exports, __require);
  __cache[key] = mod.exports;
  return mod.exports;
}

// ---------- adapter.js ----------
__define('adapter', function (module, exports, require) {
'use strict';

// Adaptateur générique Vercel <-> les gestionnaires existants (lib/handlers.js,
// sms/lib/handlers.js). Ces gestionnaires ont été écrits dès le départ sans
// dépendre d'un framework précis (ils reçoivent HttpsError en paramètre, et un
// objet { auth, data } générique) — c'est ce qui permet de les réutiliser tels
// quels ici, sans aucune modification.

class ApiError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const STATUS_BY_CODE = {
  'invalid-argument': 400,
  'unauthenticated': 401,
  'permission-denied': 403,
  'not-found': 404,
  'already-exists': 409,
  'failed-precondition': 412,
  'resource-exhausted': 429,
  'unavailable': 503,
  'internal': 500,
};

// Origine(s) autorisées à appeler ce serveur (votre site GitHub Pages).
// Réglable sans toucher au code via la variable d'environnement ALLOWED_ORIGIN
// (voir .env.example) — "*" par défaut (tout le monde), à resserrer une fois
// votre adresse GitHub Pages connue.
function allowedOrigin() {
  return process.env.ALLOWED_ORIGIN || '*';
}

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', allowedOrigin());
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

// Vérifie le jeton d'identité Firebase envoyé en en-tête
// "Authorization: Bearer <jeton>" (présent seulement quand l'app est
// connectée). Jamais obligatoire : les fonctions qui n'en ont pas besoin
// (ex. requestOtp, appelée avant même la création du compte) reçoivent
// simplement auth = null, exactement comme avec les fonctions Firebase.
async function verifyAuth(req) {
  const header = req.headers.authorization || '';
  const match = /^Bearer (.+)$/.exec(header);
  if (!match) return null;
  try {
    const { getAdmin } = __require('firebaseAdmin');
    const decoded = await getAdmin().auth().verifyIdToken(match[1]);
    return { uid: decoded.uid };
  } catch (e) {
    return null; // jeton invalide/expiré : traité comme non connecté, pas une erreur serveur
  }
}

// Pour createPayment, requestOtp, verifyOtp, claimVerification, resetPassword :
// des fonctions "appelables" qui reçoivent des données et renvoient un résultat.
function wrapCallable(makeHandler, getCore) {
  const handler = makeHandler({ getCore, HttpsError: ApiError });
  return async (req, res) => {
    setCors(res);
    if (req.method === 'OPTIONS') { res.status(204).end(); return; }
    if (req.method !== 'POST') { res.status(405).json({ code: 'invalid-argument', message: 'Méthode non autorisée.' }); return; }
    try {
      const auth = await verifyAuth(req);
      const result = await handler({ auth, data: req.body || {} });
      res.status(200).json(result);
    } catch (e) {
      if (e instanceof ApiError) {
        res.status(STATUS_BY_CODE[e.code] || 500).json({ code: e.code, message: e.message });
      } else {
        console.error('[serveur] erreur inattendue', e);
        res.status(500).json({ code: 'internal', message: 'Erreur interne. Réessayez dans un instant.' });
      }
    }
  };
}

// Pour paymentWebhook et mockPay : déjà écrites en (req, res) directement
// (même convention que Vercel), on ajoute juste les en-têtes CORS autour.
function wrapRaw(makeHandler, getCore) {
  const handler = makeHandler({ getCore });
  return async (req, res) => {
    setCors(res);
    if (req.method === 'OPTIONS') { res.status(204).end(); return; }
    await handler(req, res);
  };
}

module.exports = { ApiError, wrapCallable, wrapRaw, setCors, allowedOrigin };

});

// ---------- lib/core.js ----------
__define('paymentGetCore', function (module, exports, require) {
'use strict';

// Même logique que functions/index.js, adaptée aux variables d'environnement
// Vercel à la place des paramètres Firebase (defineString/defineSecret).

const { getAdmin } = __require('firebaseAdmin');
const { createPaymentCore } = __require('paymentCore');
const { getProvider } = __require('paymentProviders');

function serverBaseUrl() {
  // Vercel fournit automatiquement l'adresse du déploiement courant.
  return process.env.SERVER_BASE_URL
    || (process.env.VERCEL_URL ? 'https://' + process.env.VERCEL_URL : 'http://localhost:3000');
}

function getPaymentCore() {
  const admin = getAdmin();
  const providerName = process.env.PAYMENT_PROVIDER || 'mock';
  const db = admin.database();
  const urls = {
    appBaseUrl: (process.env.APP_BASE_URL || 'https://je-livre-509fd.web.app').replace(/\/$/, ''),
    webhookUrl: process.env.WEBHOOK_URL || (serverBaseUrl() + '/api/paymentWebhook'),
  };
  const allowedUids = () => (process.env.MOCK_TEST_UIDS || '').split(',').map((s) => s.trim()).filter(Boolean);
  const provider = getProvider(providerName, { db, urls, allowedUids });
  return { core: createPaymentCore({ db, provider, providerName, urls }), provider, providerName };
}

module.exports = { getPaymentCore, serverBaseUrl };

});

// ---------- lib/firebaseAdmin.js ----------
__define('firebaseAdmin', function (module, exports, require) {
'use strict';

// En vraies fonctions Firebase, l'identification auprès de Firebase est
// automatique. Ici (Vercel, en dehors de Google Cloud), il faut une clé de
// compte de service — un fichier JSON téléchargé une fois depuis la console
// Firebase (⚙️ Paramètres du projet > Comptes de service > Générer une
// nouvelle clé privée), collé tel quel dans la variable d'environnement
// FIREBASE_SERVICE_ACCOUNT (jamais dans un fichier du dépôt).

const admin = require('firebase-admin');

let appInstance = null;

function getAdmin() {
  if (appInstance) return admin;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT manquant (voir .env.example).');
  let serviceAccount;
  try {
    serviceAccount = JSON.parse(raw);
  } catch (e) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT invalide : doit être le contenu JSON complet de la clé, tel quel.');
  }
  appInstance = admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: process.env.FIREBASE_DATABASE_URL || 'https://je-livre-509fd-default-rtdb.europe-west1.firebasedatabase.app',
  });
  return admin;
}

module.exports = { getAdmin };

});

// ---------- lib/paymentCore.js ----------
__define('paymentCore', function (module, exports, require) {
'use strict';

// Cœur du paiement en ligne de Je Livre. Aucune dépendance à Firebase ici :
// la base de données et le prestataire de paiement sont injectés, ce qui
// permet de tester toute la logique sans rien déployer (voir test/).
//
// Vie d'un paiement :
//   1. createPayment  : le client demande à payer une ou plusieurs commandes
//                       (statut "awaiting_payment"). Le serveur recalcule le
//                       montant, enregistre un paiement "initiated", demande au
//                       prestataire une page de paiement et renvoie son adresse.
//   2. (le client paie chez le prestataire)
//   3. settlePayment  : le prestataire prévient le serveur (webhook). Le serveur
//                       NE CROIT PAS le message : il redemande au prestataire
//                       l'état réel de la transaction, contrôle le montant, puis
//                       — une seule fois — passe les commandes en "pending_seller"
//                       / paymentStatus "paid". Seul le serveur peut faire ça.

const { PaymentError, computeOrderAmounts } = __require('amounts');

const CURRENCY = 'XOF';
const MIN_AMOUNT = 100;            // FCFA — la plupart des prestataires refusent en dessous
const MAX_ORDERS_PER_PAYMENT = 10;
const THROTTLE_MS = 3000;          // un client ne peut lancer un paiement que toutes les 3 s
const LOCK_MS = 120000;            // un verrou de traitement plus vieux que 2 min est considéré abandonné
const FINAL_STATUSES = ['paid', 'paid_needs_review', 'amount_mismatch'];
const ORDER_ID_RE = /^CMD-[A-Z0-9]{3,24}$/;
const TX_ID_RE = /^JL[A-Z0-9]{6,30}$/;

function createPaymentCore({ db, provider, providerName, urls, now = () => Date.now(), random = Math.random }) {
  const readVal = async (path) => (await db.ref(path).once('value')).val();

  function newTxId() {
    const rand = Math.floor(random() * 36 ** 4).toString(36).toUpperCase().padStart(4, '0');
    return 'JL' + now().toString(36).toUpperCase() + rand;
  }

  async function createPayment({ uid, orderIds }) {
    if (!uid) throw new PaymentError('unauthenticated', 'Connexion requise.');
    if (!Array.isArray(orderIds) || orderIds.length < 1 || orderIds.length > MAX_ORDERS_PER_PAYMENT
        || new Set(orderIds).size !== orderIds.length
        || !orderIds.every((id) => typeof id === 'string' && ORDER_ID_RE.test(id))) {
      throw new PaymentError('invalid-argument', 'Liste de commandes invalide.');
    }

    // Anti-rafale : évite qu'un client (ou un script) ne déclenche des dizaines
    // de sessions de paiement chez le prestataire.
    const throttle = await db.ref('paymentThrottle/' + uid).transaction(
      (cur) => (typeof cur === 'number' && now() - cur < THROTTLE_MS ? undefined : now())
    );
    if (!throttle.committed) {
      throw new PaymentError('resource-exhausted', 'Veuillez patienter quelques secondes avant de réessayer.');
    }

    // 1) Les commandes doivent exister, appartenir à ce client, se payer en ligne
    //    et attendre réellement leur paiement.
    const orders = [];
    for (const id of orderIds) {
      const o = await readVal('marketplaceOrders/' + id);
      if (!o) throw new PaymentError('not-found', 'Commande introuvable : ' + id);
      if (o.clientUid !== uid) throw new PaymentError('permission-denied', "Cette commande n'est pas la vôtre.");
      if (o.paymentMethod !== 'online') throw new PaymentError('failed-precondition', 'Cette commande se règle à la livraison.');
      if (o.paymentStatus === 'paid') throw new PaymentError('already-exists', 'Cette commande est déjà payée.');
      if (o.status !== 'awaiting_payment') throw new PaymentError('failed-precondition', "Cette commande n'attend plus de paiement.");
      orders.push({ id, order: o });
    }

    // 2) Montant recalculé par le serveur à partir des prix réels en base.
    const shopCache = {};
    const productCache = {};
    let amount = 0;
    const updates = {};
    const txId = newTxId();

    for (const { id, order } of orders) {
      if (!(order.shopId in shopCache)) shopCache[order.shopId] = await readVal('shops/' + order.shopId);
      const productsById = {};
      for (const it of Array.isArray(order.items) ? order.items : []) {
        const pid = it && it.pid;
        if (pid && !(pid in productCache)) productCache[pid] = await readVal('products/' + pid);
        if (pid) productsById[pid] = productCache[pid];
      }
      const a = computeOrderAmounts({ order, shop: shopCache[order.shopId], productsById });
      amount += a.total;
      // On réécrit les montants autoritaires dans la commande : tout ce qui
      // en dépend ensuite (solde vendeur, statistiques...) repose sur eux.
      updates['marketplaceOrders/' + id + '/items'] = a.items;
      updates['marketplaceOrders/' + id + '/subtotal'] = a.subtotal;
      updates['marketplaceOrders/' + id + '/deliveryFee'] = a.deliveryFee;
      updates['marketplaceOrders/' + id + '/distanceKm'] = a.distanceKm;
      updates['marketplaceOrders/' + id + '/total'] = a.total;
      updates['marketplaceOrders/' + id + '/paymentTxId'] = txId;
    }
    if (!Number.isInteger(amount) || amount < MIN_AMOUNT) {
      throw new PaymentError('failed-precondition', 'Montant à payer invalide.');
    }

    // 3) On enregistre le paiement AVANT d'appeler le prestataire : si sa
    //    confirmation arrive très vite, elle doit trouver le paiement en base.
    updates['payments/' + txId] = {
      txId, clientUid: uid, orderIds, amount, currency: CURRENCY,
      provider: providerName, status: 'initiated', createdAt: now(),
    };
    await db.ref().update(updates);

    // 4) Page de paiement chez le prestataire.
    let checkout;
    try {
      checkout = await provider.createCheckout({
        txId, amount, currency: CURRENCY,
        description: ('Commande Je Livre ' + orderIds.join(', ')).slice(0, 100),
        customer: { uid, phone: orders[0].order.clientPhone || '' },
        returnUrl: urls.appBaseUrl + '/?payment=return&tx=' + txId,
        notifyUrl: urls.webhookUrl,
      });
    } catch (e) {
      await db.ref('payments/' + txId).update({
        status: 'failed_to_create', error: String(e && e.message).slice(0, 200), failedAt: now(),
      });
      throw new PaymentError('unavailable', 'Le service de paiement est momentanément indisponible. Réessayez dans un instant.');
    }
    if (!checkout || !checkout.paymentUrl) {
      await db.ref('payments/' + txId).update({ status: 'failed_to_create', error: 'no-payment-url', failedAt: now() });
      throw new PaymentError('unavailable', 'Le service de paiement est momentanément indisponible. Réessayez dans un instant.');
    }
    await db.ref('payments/' + txId).update({ providerRef: checkout.providerRef || null });
    return { txId, paymentUrl: checkout.paymentUrl, amount };
  }

  // Appelée quand le prestataire signale un changement (webhook), et par le
  // retour du client : elle est sans danger d'être appelée plusieurs fois.
  async function settlePayment(txId) {
    if (typeof txId !== 'string' || !TX_ID_RE.test(txId)) return { ok: false, reason: 'invalid-tx' };
    const payRef = db.ref('payments/' + txId);
    let pay = (await payRef.once('value')).val();
    if (!pay) return { ok: false, reason: 'unknown-tx' };
    if (FINAL_STATUSES.includes(pay.status)) return { ok: true, already: true, status: pay.status };

    // Un seul traitement à la fois par paiement (le prestataire renvoie souvent
    // sa notification plusieurs fois, parfois en même temps).
    const lock = await payRef.child('lock').transaction(
      (cur) => (typeof cur === 'number' && now() - cur < LOCK_MS ? undefined : now())
    );
    if (!lock.committed) return { ok: true, inProgress: true };

    try {
      pay = (await payRef.once('value')).val();
      if (FINAL_STATUSES.includes(pay.status)) return { ok: true, already: true, status: pay.status };

      // On ne croit jamais le contenu du webhook : on redemande l'état réel.
      const verified = await provider.verifyTransaction({ txId, providerRef: pay.providerRef });
      if (!verified || verified.status === 'pending') return { ok: true, pending: true };
      if (verified.status === 'failed') {
        await payRef.update({ status: 'failed', failedAt: now() });
        return { ok: true, failed: true };
      }
      if (verified.status !== 'paid') return { ok: true, pending: true }; // statut inconnu : prudence

      if (Number(verified.amount) !== pay.amount || (verified.currency && verified.currency !== pay.currency)) {
        await payRef.update({
          status: 'amount_mismatch', verifiedAmount: verified.amount == null ? null : Number(verified.amount),
          verifiedCurrency: verified.currency || null, flaggedAt: now(),
        });
        return { ok: false, reason: 'amount-mismatch' };
      }

      // Argent réellement reçu et montant exact : on débloque les commandes.
      const updates = {};
      const problems = [];
      for (const id of pay.orderIds) {
        const o = await readVal('marketplaceOrders/' + id);
        if (o && o.status === 'awaiting_payment' && o.paymentStatus !== 'paid' && o.clientUid === pay.clientUid) {
          updates['marketplaceOrders/' + id + '/status'] = 'pending_seller';
          updates['marketplaceOrders/' + id + '/paymentStatus'] = 'paid';
          updates['marketplaceOrders/' + id + '/paidAt'] = now();
          updates['marketplaceOrders/' + id + '/paymentTxId'] = txId;
        } else {
          // Commande annulée entre-temps, ou déjà payée par une autre tentative :
          // l'argent est bien arrivé mais ne correspond plus à rien de payable.
          problems.push(id);
        }
      }
      const finalStatus = problems.length ? 'paid_needs_review' : 'paid';
      updates['payments/' + txId + '/status'] = finalStatus;
      updates['payments/' + txId + '/paidAt'] = now();
      updates['payments/' + txId + '/verifiedAmount'] = Number(verified.amount);
      if (problems.length) updates['payments/' + txId + '/problemOrders'] = problems;
      await db.ref().update(updates);
      return { ok: true, paid: true, needsReview: problems.length > 0, status: finalStatus };
    } finally {
      try { await payRef.child('lock').set(null); } catch (e) { /* ignoré */ }
    }
  }

  return { createPayment, settlePayment, constants: { CURRENCY, MIN_AMOUNT, THROTTLE_MS, LOCK_MS } };
}

module.exports = { createPaymentCore, PaymentError };

});

// ---------- lib/amounts.js ----------
__define('amounts', function (module, exports, require) {
'use strict';

// Recalcul AUTORITAIRE du montant d'une commande, côté serveur.
//
// Le montant écrit dans la commande par le téléphone du client n'est jamais
// digne de confiance (il peut être modifié avant l'envoi). Pour un paiement
// réel, le serveur repart donc de ce qu'il sait être vrai : les prix des
// produits enregistrés en base par les vendeurs, les coordonnées de la
// boutique, et le barème de livraison de Je Livre.

class PaymentError extends Error {
  // code : l'un des codes d'erreur des fonctions Firebase
  // ('invalid-argument', 'not-found', 'permission-denied', 'failed-precondition',
  //  'already-exists', 'resource-exhausted', 'unavailable', 'internal')
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

// Même barème que calculatePrice() dans l'application.
function deliveryFeeForKm(km) {
  if (km <= 10) return 1000;
  return 1000 + Math.ceil((km - 10) / 5) * 500;
}

function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

// order       : la commande telle qu'enregistrée par le client
// shop        : shops/<shopId> lu en base
// productsById: { [productId]: produit lu en base (products/<id>) }
function computeOrderAmounts({ order, shop, productsById }) {
  if (!shop || shop.approved !== true) {
    throw new PaymentError('failed-precondition', "Cette boutique n'accepte pas de paiement en ligne pour le moment.");
  }
  if (!Array.isArray(order.items) || order.items.length === 0) {
    throw new PaymentError('invalid-argument', 'Commande sans article.');
  }

  let subtotal = 0;
  const items = order.items.map((it) => {
    const pid = it && it.pid;
    if (!pid) {
      throw new PaymentError('failed-precondition', 'Commande trop ancienne pour un paiement en ligne : recommandez-la.');
    }
    const product = productsById[pid];
    if (!product || product.shopId !== order.shopId) {
      throw new PaymentError('failed-precondition', "Un produit de la commande n'est plus disponible.");
    }
    const qty = it.qty;
    if (!Number.isInteger(qty) || qty < 1 || qty > 99) {
      throw new PaymentError('invalid-argument', 'Quantité invalide.');
    }
    if (!isNum(product.price) || product.price < 0) {
      throw new PaymentError('failed-precondition', 'Prix du produit invalide.');
    }
    const price = Math.round(product.price);
    subtotal += price * qty;
    return { pid, name: String(product.name || it.name || 'Produit'), qty, price };
  });

  // Distance : entre la boutique (position enregistrée par le vendeur) et le
  // point de livraison demandé. Sans position de boutique, même repli que
  // l'application : 3 km.
  const c = order.clientCoords;
  const s = shop.coords;
  const distanceKm = (s && isNum(s.lat) && isNum(s.lng) && c && isNum(c.lat) && isNum(c.lng))
    ? haversineKm(s.lat, s.lng, c.lat, c.lng)
    : 3;
  const deliveryFee = deliveryFeeForKm(distanceKm);

  return { items, subtotal, distanceKm, deliveryFee, total: subtotal + deliveryFee };
}

module.exports = { PaymentError, deliveryFeeForKm, haversineKm, computeOrderAmounts };

});

// ---------- lib/handlers.js ----------
__define('paymentHandlers', function (module, exports, require) {
'use strict';

// Couche "requête / réponse" des fonctions, séparée de index.js pour pouvoir être testée
// sans déployer. index.js ne fait que les brancher sur Firebase.

const { PaymentError } = __require('amounts');

function makeCreatePayment({ getCore, HttpsError }) {
  const toHttpsError = (e) => {
    if (e instanceof PaymentError) return new HttpsError(e.code, e.message);
    console.error('[paiement] erreur inattendue', e);
    return new HttpsError('internal', 'Erreur interne. Réessayez dans un instant.');
  };
  return async (request) => {
    try {
      const { core } = getCore();
      return await core.createPayment({
        uid: request.auth && request.auth.uid,
        orderIds: request.data && request.data.orderIds,
      });
    } catch (e) {
      throw toHttpsError(e);
    }
  };
}

// Le prestataire appelle cette adresse quand un paiement change d'état.
// 200 pour tout cas traité (même "inconnu", pour éviter des renvois inutiles) ;
// 500 seulement pour une erreur temporaire de notre côté : le prestataire réessaiera.
function makeWebhook({ getCore }) {
  return async (req, res) => {
    try {
      const { core, provider } = getCore();
      const parsed = provider.parseWebhook(req);
      if (!parsed || !parsed.txId) { res.status(400).json({ ok: false, reason: 'no-tx' }); return; }
      res.status(200).json(await core.settlePayment(parsed.txId));
    } catch (e) {
      console.error('[paiement] webhook en erreur', e);
      res.status(500).json({ ok: false });
    }
  };
}

// Simulation : la page mock-pay.html "paie" ou "échoue". Refusé dès qu'un vrai
// prestataire est configuré, et réservé aux comptes de test (voir providers/mock.js).
function makeMockPay({ getCore }) {
  return async (req, res) => {
    try {
      const { core, provider, providerName } = getCore();
      if (providerName !== 'mock') { res.status(403).json({ ok: false, error: 'disabled' }); return; }
      const txId = String((req.query && req.query.tx) || (req.body && req.body.tx) || '');
      const result = String((req.query && req.query.result) || (req.body && req.body.result) || '') === 'paid' ? 'paid' : 'failed';
      if (!(await provider.simulate(txId, result))) { res.status(404).json({ ok: false, error: 'unknown-tx' }); return; }
      res.status(200).json(await core.settlePayment(txId));
    } catch (e) {
      console.error('[paiement] mockPay en erreur', e);
      res.status(500).json({ ok: false });
    }
  };
}

module.exports = { makeCreatePayment, makeWebhook, makeMockPay };

});

// ---------- providers/index.js ----------
__define('paymentProviders', function (module, exports, require) {
'use strict';

// Choix du prestataire selon le paramètre PAYMENT_PROVIDER.
// Pour en ajouter un : copier _template.js, le remplir, puis ajouter un "case".

function getProvider(name, deps) {
  switch (name) {
    case 'mock':
      return __require('paymentProviderMock')(deps);
    // case 'cinetpay': return require('./cinetpay')(deps);
    // case 'paydunya': return require('./paydunya')(deps);
    default:
      throw new Error('Prestataire de paiement inconnu : ' + name);
  }
}

module.exports = { getProvider };

});

// ---------- providers/mock.js ----------
__define('paymentProviderMock', function (module, exports, require) {
'use strict';

// Prestataire de SIMULATION : aucun argent, aucun appel externe.
// Il sert à tester tout le parcours (commande → page de paiement → retour →
// commande débloquée) avant d'avoir un compte chez un vrai prestataire.
// Il n'est actif que si PAYMENT_PROVIDER vaut "mock" (voir index.js).
//
// GARDE-FOU : la simulation permet de "payer" sans argent. Elle est donc réservée à
// une liste de comptes de test (paramètre MOCK_TEST_UIDS, vide par défaut) : si vous
// activez le paiement en ligne dans l'application en oubliant de brancher un vrai
// prestataire, les clients ordinaires n'obtiendront pas de page de paiement gratuite.

module.exports = function createMockProvider({ db, urls, allowedUids = () => [] }) {
  const isAllowed = (uid) => !!uid && allowedUids().includes(uid);
  return {
    name: 'mock',

    async createCheckout({ txId, amount, returnUrl, customer }) {
      if (!isAllowed(customer && customer.uid)) throw new Error('mock-not-allowed');
      await db.ref('mockProviderTx/' + txId).set({ amount, currency: 'XOF', status: 'pending', uid: customer.uid });
      const paymentUrl = urls.appBaseUrl + '/mock-pay.html?tx=' + encodeURIComponent(txId)
        + '&amount=' + amount + '&return=' + encodeURIComponent(returnUrl);
      return { paymentUrl, providerRef: 'mock_' + txId };
    },

    // Contrat : renvoie { status: 'paid' | 'failed' | 'pending', amount, currency }.
    async verifyTransaction({ txId }) {
      const s = (await db.ref('mockProviderTx/' + txId).once('value')).val();
      if (!s) return { status: 'failed' };
      return { status: s.status, amount: s.amount, currency: s.currency };
    },

    // Contrat : extrait l'identifiant de transaction de la requête reçue.
    // (Le contenu n'est JAMAIS cru : verifyTransaction redemande l'état réel.)
    parseWebhook(req) {
      return { txId: (req.body && req.body.txId) || (req.query && req.query.txId) };
    },

    // Propre à la simulation : la page mock-pay.html "paie" ou "échoue".
    async simulate(txId, result) {
      const ref = db.ref('mockProviderTx/' + txId);
      const rec = (await ref.once('value')).val();
      if (!rec || !isAllowed(rec.uid)) return false;
      await ref.child('status').set(result === 'paid' ? 'paid' : 'failed');
      return true;
    },
  };
};

});

// ---------- sms/core.js ----------
__define('smsGetCore', function (module, exports, require) {
'use strict';

const crypto = require('crypto');
const { getAdmin } = __require('firebaseAdmin');
const { createOtpCore } = __require('otpCore');
const { getSmsProvider } = __require('smsProviders');

// Même numéro, compte différent selon le rôle (une personne peut être
// cliente ET livreur) : doit correspondre EXACTEMENT au mappage utilisé côté
// application (roleEmail dans je-livre-prototype.html).
const ROLE_EMAIL_SUFFIX = { client: '', driver: '+driver', vendor: '+boutique', enterprise: '+entreprise' };
function syntheticEmail(phoneKey, role) {
  return phoneKey + (ROLE_EMAIL_SUFFIX[role] || '') + '@jelivre.internal';
}

function getOtpCore() {
  const admin = getAdmin();
  const providerName = process.env.SMS_PROVIDER || 'mock';
  const db = admin.database();
  const provider = getSmsProvider(providerName, {
    db,
    token: process.env.BBG_SMS_TOKEN,
    senderId: process.env.SMS_SENDER_ID || 'JELIVRE',
  });
  const core = createOtpCore({
    db, provider,
    hash: (code) => crypto.createHash('sha256').update(code).digest('hex'),
    resolveUid: async (phoneKey, role) => {
      try { return (await admin.auth().getUserByEmail(syntheticEmail(phoneKey, role))).uid; }
      catch (e) { return null; }
    },
    isVerified: async (uid) => {
      const u = await admin.auth().getUser(uid);
      return !!(u.customClaims && u.customClaims.phoneVerified);
    },
    setVerifiedClaim: async (uid) => { await admin.auth().setCustomUserClaims(uid, { phoneVerified: true }); },
    setPassword: async (uid, newPassword) => { await admin.auth().updateUser(uid, { password: newPassword }); },
  });
  return { core };
}

module.exports = { getOtpCore };

});

// ---------- sms/lib/otpCore.js ----------
__define('otpCore', function (module, exports, require) {
'use strict';

// Cœur de la vérification par code SMS (OTP), pour les quatre comptes de
// Je Livre (client, livreur, boutique, entreprise). Aucune dépendance à
// Firebase ni à un prestataire SMS précis ici : tout est injecté, pour
// pouvoir tester toute la logique sans rien déployer (voir test/).
//
// Le code est rattaché au NUMÉRO DE TÉLÉPHONE, pas à un compte déjà
// connecté : à l'inscription, le compte Firebase n'existe pas encore au
// moment de vérifier le téléphone (on ne veut pas créer un compte avant
// d'être sûr que le numéro est le bon) ; et pour "mot de passe oublié", la
// personne n'est justement plus connectée. Le parcours complet tient donc
// en quatre étapes :
//   1. requestOtp   : génère un code, le garde (son empreinte, jamais le
//                     code en clair) avec une expiration, et demande au
//                     prestataire SMS de l'envoyer.
//   2. verifyOtp    : compare le code reçu à l'empreinte. S'il correspond,
//                     le téléphone est marqué "vérifié" pour un temps
//                     court (15 min) — assez pour finir l'inscription ou le
//                     changement de mot de passe, pas plus.
//   3a. claimVerification (inscription) : une fois le compte Firebase créé
//                     (juste après, donc authentifié), récupère cette
//                     preuve et pose l'attribut phoneVerified sur CE
//                     compte — la seule façon de l'obtenir.
//   3b. resetPassword (mot de passe oublié) : récupère la même preuve et
//                     change directement le mot de passe du compte
//                     correspondant à ce téléphone, sans jamais exiger
//                     d'être déjà connecté.
//
// Chaque rôle (client / livreur / boutique / entreprise) a son propre
// compte Firebase même pour un même numéro de téléphone (une personne peut
// très bien être cliente ET livreur) : resolveUid et l'email synthétique
// sont donc toujours paramétrés par (phoneKey, role).

const { OtpError } = __require('otpErrors');

const CODE_TTL_MS = 5 * 60 * 1000;         // un code reçu doit être utilisé dans les 5 minutes
const VERIFIED_TTL_MS = 15 * 60 * 1000;    // une fois vérifié, le téléphone reste "prouvé" 15 min
const THROTTLE_MS = 45 * 1000;             // un nouveau code ne peut être redemandé que toutes les 45 s
const MAX_ATTEMPTS = 5;                    // au-delà, il faut redemander un code plutôt que continuer à deviner
const CODE_RE = /^\d{6}$/;
const PURPOSES = ['signup', 'reset'];
const ROLES = ['client', 'driver', 'vendor', 'enterprise'];

function phoneKeyOf(phone) {
  return typeof phone === 'string' ? phone.replace(/\D/g, '') : '';
}

function createOtpCore({ db, provider, hash, now = () => Date.now(), random = Math.random, resolveUid, isVerified, setVerifiedClaim, setPassword }) {
  const readVal = async (path) => (await db.ref(path).once('value')).val();

  function newCode() {
    return String(Math.floor(random() * 1000000)).padStart(6, '0');
  }

  function assertPhoneAndRole(phone, role) {
    const phoneKey = phoneKeyOf(phone);
    if (phoneKey.length < 8) throw new OtpError('invalid-argument', 'Numéro de téléphone invalide.');
    if (!ROLES.includes(role)) throw new OtpError('invalid-argument', 'Demande invalide.');
    return phoneKey;
  }

  async function requestOtp({ phone, role, purpose }) {
    if (!PURPOSES.includes(purpose)) throw new OtpError('invalid-argument', 'Demande invalide.');
    const phoneKey = assertPhoneAndRole(phone, role);

    const existingUid = await resolveUid(phoneKey, role);
    // "signup" sert aussi à renvoyer un code à un compte déjà créé mais dont le
    // téléphone n'a encore jamais été confirmé (ex. inscription interrompue, ou
    // compte livreur créé par une entreprise, jamais connecté jusque-là) — il
    // n'y a alors rien à protéger : seul un compte DÉJÀ vérifié doit être
    // redirigé vers la connexion plutôt que de renvoyer un code.
    if (purpose === 'signup' && existingUid && await isVerified(existingUid)) {
      throw new OtpError('already-exists', 'Un compte existe déjà avec ce numéro. Connectez-vous plutôt.');
    }
    if (purpose === 'reset' && !existingUid) {
      // On ne révèle pas qu'aucun compte n'existe pour ce numéro (et on
      // économise un SMS inutile) : on répond comme si de rien n'était.
      return { sent: true };
    }

    const existing = await readVal('otps/' + phoneKey);
    if (existing && typeof existing.lastSentAt === 'number' && now() - existing.lastSentAt < THROTTLE_MS) {
      throw new OtpError('resource-exhausted', 'Veuillez patienter quelques secondes avant de redemander un code.');
    }

    const code = newCode();
    const record = { codeHash: hash(code), attempts: 0, lastSentAt: now(), expiresAt: now() + CODE_TTL_MS };
    // Enregistré AVANT l'envoi : si l'envoi échoue juste après, on ne veut
    // jamais laisser un enregistrement contre lequel personne ne pourra
    // jamais vérifier (voir le nettoyage dans le catch ci-dessous).
    await db.ref('otps/' + phoneKey).set(record);
    try {
      await provider.sendSms({ phone, phoneKey, text: 'Je Livre : votre code de vérification est ' + code + '. Il expire dans 5 minutes.' });
    } catch (e) {
      await db.ref('otps/' + phoneKey).remove();
      throw new OtpError('unavailable', "L'envoi du SMS a échoué. Réessayez dans un instant.");
    }
    return { sent: true };
  }

  async function verifyOtp({ phone, code }) {
    const phoneKey = phoneKeyOf(phone);
    if (phoneKey.length < 8) throw new OtpError('invalid-argument', 'Numéro de téléphone invalide.');
    if (typeof code !== 'string' || !CODE_RE.test(code)) {
      throw new OtpError('invalid-argument', 'Entrez le code à 6 chiffres reçu par SMS.');
    }
    const record = await readVal('otps/' + phoneKey);
    if (!record || record.verified) throw new OtpError('failed-precondition', "Aucun code n'a été demandé. Redemandez-en un.");
    if (now() > record.expiresAt) throw new OtpError('failed-precondition', 'Ce code a expiré. Redemandez-en un.');
    if (record.attempts >= MAX_ATTEMPTS) {
      throw new OtpError('resource-exhausted', 'Trop de tentatives. Redemandez un nouveau code.');
    }
    if (hash(code) !== record.codeHash) {
      const attempts = record.attempts + 1;
      await db.ref('otps/' + phoneKey + '/attempts').set(attempts);
      const remaining = MAX_ATTEMPTS - attempts;
      throw new OtpError('invalid-argument', remaining > 0
        ? ('Code incorrect. ' + remaining + (remaining > 1 ? ' tentatives restantes.' : ' tentative restante.'))
        : 'Code incorrect. Redemandez un nouveau code.');
    }
    // Le code est consommé, remplacé par une preuve de vérification de
    // courte durée (le temps de finir l'inscription ou le changement de
    // mot de passe) — jamais réutilisable comme code lui-même.
    await db.ref('otps/' + phoneKey).set({ verified: true, verifiedAt: now(), expiresAt: now() + VERIFIED_TTL_MS });
    return { ok: true };
  }

  async function checkVerifiedProof(phoneKey) {
    const record = await readVal('otps/' + phoneKey);
    if (!record || !record.verified || now() > record.expiresAt) {
      throw new OtpError('failed-precondition', 'Vérifiez votre numéro avant de continuer.');
    }
  }

  // Appelée juste après la création du compte Firebase (donc authentifiée) :
  // récupère la preuve de vérification et pose l'attribut sur CE compte.
  async function claimVerification({ uid, phone, role }) {
    if (!uid) throw new OtpError('unauthenticated', 'Connexion requise.');
    const phoneKey = assertPhoneAndRole(phone, role);
    await checkVerifiedProof(phoneKey);
    await setVerifiedClaim(uid);
    await db.ref('otps/' + phoneKey).remove();
    return { ok: true };
  }

  // "Mot de passe oublié" : change le mot de passe sans jamais exiger
  // d'être déjà connecté — seule la preuve de vérification y autorise.
  async function resetPassword({ phone, role, newPassword }) {
    const phoneKey = assertPhoneAndRole(phone, role);
    if (typeof newPassword !== 'string' || newPassword.length < 6) {
      throw new OtpError('invalid-argument', 'Le mot de passe doit contenir au moins 6 caractères.');
    }
    await checkVerifiedProof(phoneKey);
    const uid = await resolveUid(phoneKey, role);
    if (!uid) throw new OtpError('not-found', 'Aucun compte associé à ce numéro.');
    await setPassword(uid, newPassword);
    await db.ref('otps/' + phoneKey).remove();
    return { ok: true };
  }

  return { requestOtp, verifyOtp, claimVerification, resetPassword };
}

module.exports = { createOtpCore, phoneKeyOf, ROLES };

});

// ---------- sms/lib/errors.js ----------
__define('otpErrors', function (module, exports, require) {
'use strict';

// Même forme que PaymentError (functions/lib/amounts.js) : code est l'un des
// codes d'erreur des fonctions Firebase, pour être converti directement en
// HttpsError côté handlers.
class OtpError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

module.exports = { OtpError };

});

// ---------- sms/lib/handlers.js ----------
__define('otpHandlers', function (module, exports, require) {
'use strict';

const { OtpError } = __require('otpErrors');

function toHttpsError(e, HttpsError) {
  if (e instanceof OtpError) return new HttpsError(e.code, e.message);
  console.error('[otp] erreur inattendue', e);
  return new HttpsError('internal', 'Erreur interne. Réessayez dans un instant.');
}

// requestOtp et verifyOtp n'exigent PAS d'être connecté : à l'inscription,
// le compte n'existe pas encore ; pour "mot de passe oublié", la personne
// n'est justement plus connectée.
function makeRequestOtp({ getCore, HttpsError }) {
  return async (request) => {
    try {
      const { core } = getCore();
      const d = request.data || {};
      return await core.requestOtp({ phone: d.phone, role: d.role, purpose: d.purpose });
    } catch (e) {
      throw toHttpsError(e, HttpsError);
    }
  };
}

function makeVerifyOtp({ getCore, HttpsError }) {
  return async (request) => {
    try {
      const { core } = getCore();
      const d = request.data || {};
      return await core.verifyOtp({ phone: d.phone, code: d.code });
    } catch (e) {
      throw toHttpsError(e, HttpsError);
    }
  };
}

// Doit être connecté : appelée juste après la création du compte.
function makeClaimVerification({ getCore, HttpsError }) {
  return async (request) => {
    try {
      const { core } = getCore();
      const d = request.data || {};
      return await core.claimVerification({ uid: request.auth && request.auth.uid, phone: d.phone, role: d.role });
    } catch (e) {
      throw toHttpsError(e, HttpsError);
    }
  };
}

// Volontairement PAS connecté (c'est tout le but de "mot de passe oublié").
function makeResetPassword({ getCore, HttpsError }) {
  return async (request) => {
    try {
      const { core } = getCore();
      const d = request.data || {};
      return await core.resetPassword({ phone: d.phone, role: d.role, newPassword: d.newPassword });
    } catch (e) {
      throw toHttpsError(e, HttpsError);
    }
  };
}

module.exports = { makeRequestOtp, makeVerifyOtp, makeClaimVerification, makeResetPassword };

});

// ---------- sms/providers/index.js ----------
__define('smsProviders', function (module, exports, require) {
'use strict';

function getSmsProvider(name, deps) {
  switch (name) {
    case 'mock':
      return __require('smsProviderMock')(deps);
    case 'bbg':
      return __require('smsProviderBbg')(deps);
    default:
      throw new Error('Prestataire SMS inconnu : ' + name);
  }
}

module.exports = { getSmsProvider };

});

// ---------- sms/providers/mock.js ----------
__define('smsProviderMock', function (module, exports, require) {
'use strict';

// Prestataire de SIMULATION : aucun SMS réel, aucun appel externe. Actif
// seulement si SMS_PROVIDER vaut "mock" (voir index.js) — un réglage de
// déploiement, jamais atteignable par un client. Le texte envoyé est
// journalisé dans mockSmsLog/<phoneKey> (accès admin uniquement — en test,
// on le lit directement via le SDK Admin ou le faux Firebase du test).
module.exports = function createMockSmsProvider({ db }) {
  return {
    name: 'mock',
    async sendSms({ phone, phoneKey, text }) {
      await db.ref('mockSmsLog/' + phoneKey).push({ phone, text, at: Date.now() });
    },
  };
};

});

// ---------- sms/providers/bbg.js ----------
__define('smsProviderBbg', function (module, exports, require) {
'use strict';

// Adaptateur BBG SMS (Burkina Faso) — https://bbgsms.betterbegoing.com/developpeur
//
// Le jeton (token) et le nom d'expéditeur (sender_id, 11 caractères maximum,
// doit être pré-activé sur le tableau de bord BBG SMS) sont injectés, jamais
// codés en dur ici. Le jeton se configure avec :
//   firebase functions:secrets:set BBG_SMS_TOKEN

const SEND_URL = 'https://bbgsmsapp.betterbegoing.com/api/http/sms/send';

module.exports = function createBbgProvider({ token, senderId }) {
  return {
    name: 'bbg',

    async sendSms({ phone, text }) {
      if (!token) throw new Error('BBG_SMS_TOKEN manquant.');
      // BBG attend un numéro sans "+" ni espaces (ex. 22668904655).
      const recipient = String(phone || '').replace(/\D/g, '');

      let res;
      try {
        res = await fetch(SEND_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
          body: JSON.stringify({
            api_token: token,
            recipient,
            sender_id: senderId || 'JELIVRE',
            type: 'plain',
            message: text,
          }),
        });
      } catch (e) {
        throw new Error('BBG SMS injoignable : ' + e.message);
      }

      let body;
      try {
        body = await res.json();
      } catch (e) {
        throw new Error('Réponse BBG SMS illisible (HTTP ' + res.status + ').');
      }

      // BBG répond { status: "success", data: ... } ou { status: "error", message: ... }.
      // Le code HTTP seul ne suffit pas à confirmer l'envoi : on exige "success".
      if (!res.ok || body.status !== 'success') {
        throw new Error((body && body.message) || ('Échec de l\'envoi SMS (HTTP ' + res.status + ').'));
      }
    },
  };
};

});

// ---------- Ce dont les points d'accès (api/*.js) ont besoin ----------
const adapter = __require('adapter');
const paymentGetCore = __require('paymentGetCore');
const paymentHandlers = __require('paymentHandlers');
const smsGetCore = __require('smsGetCore');
const otpHandlers = __require('otpHandlers');

module.exports = {
  wrapCallable: adapter.wrapCallable,
  wrapRaw: adapter.wrapRaw,
  getPaymentCore: paymentGetCore.getPaymentCore,
  makeCreatePayment: paymentHandlers.makeCreatePayment,
  makeWebhook: paymentHandlers.makeWebhook,
  makeMockPay: paymentHandlers.makeMockPay,
  getOtpCore: smsGetCore.getOtpCore,
  makeRequestOtp: otpHandlers.makeRequestOtp,
  makeVerifyOtp: otpHandlers.makeVerifyOtp,
  makeClaimVerification: otpHandlers.makeClaimVerification,
  makeResetPassword: otpHandlers.makeResetPassword,
};