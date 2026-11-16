'use strict';

// ====================================================================
// Fichier généré automatiquement : regroupe tout le code serveur (déjà
// testé, inchangé) en un seul fichier, pour un dépôt plus simple et plus
// fiable sur GitHub (plus besoin de déposer des dossiers entiers).
// Chaque point d'accès (api/*.js) se contente de faire :
//   const shared = require('../shared');
// ====================================================================

// Chargé ici, au tout premier niveau du fichier (et non à l'intérieur d'une
// fonction imbriquée), pour que Vercel le repère sans ambiguïté à la
// construction et l'inclue bien dans le paquet déployé.
const __firebaseAdminPkg = require('firebase-admin');

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

// Origine(s) autorisées à appeler ce serveur. Réglable sans toucher au code
// via la variable d'environnement ALLOWED_ORIGIN (voir .env.example) —
// "*" par défaut (tout le monde). Peut contenir plusieurs adresses séparées
// par une virgule (ex. le domaine personnalisé ET l'adresse GitHub Pages,
// utile tant que les deux servent l'app) : seule celle qui correspond
// vraiment à la requête en cours est renvoyée, jamais la liste entière.
function allowedOrigin(req) {
  const setting = process.env.ALLOWED_ORIGIN || '*';
  if (setting === '*') return '*';
  const list = setting.split(',').map((s) => s.trim()).filter(Boolean);
  const requestOrigin = req && req.headers && req.headers.origin;
  if (requestOrigin && list.includes(requestOrigin)) return requestOrigin;
  return list[0] || '*'; // repli : la première adresse déclarée, jamais un accès total par défaut
}

function setCors(req, res) {
  res.setHeader('Access-Control-Allow-Origin', allowedOrigin(req));
  res.setHeader('Vary', 'Origin'); // pour que les caches ne mélangent pas les réponses entre origines différentes
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
    setCors(req, res);
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
    setCors(req, res);
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
const { createPayoutCore } = __require('payoutCore');
const { createNotifyCore } = __require('notifyCore');
const { createReferralCore } = __require('referralCore');
const { createCommissionCore } = __require('commissionCore');
const { getProvider } = __require('paymentProviders');

function serverBaseUrl() {
  // Vercel fournit automatiquement l'adresse du déploiement courant.
  return process.env.SERVER_BASE_URL
    || (process.env.VERCEL_URL ? 'https://' + process.env.VERCEL_URL : 'http://localhost:3000');
}

// Envoie une notification à un CLIENT (jeton rangé dans users/<uid>/fcmToken).
function makeClientNotify(admin) {
  const nc = createNotifyCore({ db: admin.database(), messaging: admin.messaging() });
  return ({ uid, title, body, data }) => nc.sendToOne({ collection: 'users', uid, title, body, data });
}

// Adresse où le client revient après avoir payé. L'application Android n'autorise
// la navigation que vers jelivre.shop : l'ancienne adresse *.web.app ouvrait le
// navigateur du téléphone au lieu de ramener le client dans Je Livre.
function safeAppBaseUrl(v) {
  const d = 'https://jelivre.shop';
  const u = String(v || '').trim().replace(/\/$/, '');
  if (!u || /web\.app|firebaseapp\.com/i.test(u)) return d;
  return u;
}

function getPaymentCore() {
  const admin = getAdmin();
  const providerName = process.env.PAYMENT_PROVIDER || 'mock';
  const db = admin.database();
  const urls = {
    appBaseUrl: safeAppBaseUrl(process.env.APP_BASE_URL),
    webhookUrl: process.env.WEBHOOK_URL || (serverBaseUrl() + '/api/paymentWebhook'),
  };
  const allowedUids = () => (process.env.MOCK_TEST_UIDS || '').split(',').map((s) => s.trim()).filter(Boolean);
  const provider = getProvider(providerName, { db, urls, allowedUids, token: process.env.HORUSPAY_SECRET_KEY });
  return { core: createPaymentCore({ db, provider, providerName, urls, notify: makeClientNotify(admin) }), provider, providerName };
}

function getPayoutCore() {
  // Les virements sortants passent toujours par le vrai prestataire HorusPay
  // (il n'existe pas de simulation pour l'argent qui sort) — indépendant du
  // réglage PAYMENT_PROVIDER, qui ne concerne que l'encaissement.
  const admin = getAdmin();
  const db = admin.database();
  const createHorusPayProvider = __require('paymentProviderHoruspay');
  const provider = createHorusPayProvider({ token: process.env.HORUSPAY_SECRET_KEY });
  return { core: createPayoutCore({ db, provider }) };
}

function getNotifyCore() {
  const admin = getAdmin();
  const db = admin.database();
  return { core: createNotifyCore({ db, messaging: admin.messaging() }) };
}

function getReferralCore() {
  const admin = getAdmin();
  return { core: createReferralCore({ db: admin.database(), notify: makeClientNotify(admin) }) };
}

function getCommissionCore() {
  const admin = getAdmin();
  return { core: createCommissionCore({ db: admin.database() }) };
}

module.exports = { getPaymentCore, getPayoutCore, getNotifyCore, getReferralCore, getCommissionCore, serverBaseUrl };

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

const admin = __firebaseAdminPkg;

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
__define('tickets', function (module, exports, require) {
'use strict';
// Ticket de litige : PREFIXE-AAMMJJ-6 caractères (sans 0/O/1/I). Ex. PAY-261116-K7M2QX.
const TICKET_RE = /^(LIV|CMD)-[0-9]{6}-[A-HJ-NP-Z2-9]{6}$/;
const TICKET_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function makeTicket(prefix, ts, rnd) {
  const d = new Date(ts);
  const ymd = String(d.getUTCFullYear()).slice(2) + String(d.getUTCMonth() + 1).padStart(2, '0') + String(d.getUTCDate()).padStart(2, '0');
  let c = '';
  for (let i = 0; i < 6; i++) c += TICKET_CHARS[Math.floor(rnd() * TICKET_CHARS.length)];
  return prefix + '-' + ymd + '-' + c;
}

module.exports = { makeTicket, TICKET_RE };
});

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

const { PaymentError, computeOrderAmounts, computeDeliveryRequestAmount } = __require('amounts');
const { createReferralCore } = __require('referralCore');
const { createCommissionCore, TOPUP_MIN, TOPUP_MAX } = __require('commissionCore');

const CURRENCY = 'XOF';
const MIN_AMOUNT = 100;            // FCFA — la plupart des prestataires refusent en dessous
const MAX_ORDERS_PER_PAYMENT = 10;
const THROTTLE_MS = 3000;          // un client ne peut lancer un paiement que toutes les 3 s
const LOCK_MS = 120000;            // un verrou de traitement plus vieux que 2 min est considéré abandonné
const FINAL_STATUSES = ['paid', 'paid_needs_review', 'amount_mismatch'];
const ORDER_ID_RE = /^CMD-[A-Z0-9]{3,24}$/;
const TX_ID_RE = /^JL[A-Z0-9]{6,30}$/;
const DELIVERY_REQUEST_ID_RE = /^dr_[a-z0-9]{3,40}$/;
// Reels sponsorisés : un tarif unique, 10 jours, 200 en même temps au maximum.
const SPONSOR_ID_RE = /^sp_[a-z0-9]{3,40}$/;
const SPONSOR_PRICE = 5000;
const SPONSOR_DAYS = 10;
const SPONSOR_MAX_ACTIVE = 200;
const SPONSOR_HOLD_MS = 30 * 60 * 1000; // une place réservée au moment du paiement est gardée 30 min
const { makeTicket, TICKET_RE } = require('tickets');

function createPaymentCore({ db, provider, providerName, urls, notify = null, now = () => Date.now(), random = Math.random }) {
  const referral = createReferralCore({ db, now, notify });
  const commission = createCommissionCore({ db, now, random });
  const readVal = async (path) => (await db.ref(path).once('value')).val();

  function newTxId() {
    const rand = Math.floor(random() * 36 ** 4).toString(36).toUpperCase().padStart(4, '0');
    return 'JL' + now().toString(36).toUpperCase() + rand;
  }

  // Recharge du solde de commission d'un livreur (garantie).
  async function createCommissionTopup({ uid, amount, thenPay = false }) {
    if (!Number.isInteger(amount) || amount < TOPUP_MIN || amount > TOPUP_MAX) {
      throw new PaymentError('invalid-argument', 'Montant de recharge invalide (entre ' + TOPUP_MIN + ' et ' + TOPUP_MAX + ' F).');
    }
    const driver = await readVal('drivers/' + uid);
    if (!driver) throw new PaymentError('failed-precondition', 'Compte livreur introuvable.');
    if (!driver.approved) throw new PaymentError('failed-precondition', "Votre compte livreur n'est pas encore validé.");
    const throttle = await db.ref('paymentThrottle/' + uid).transaction(
      (cur) => (typeof cur === 'number' && now() - cur < THROTTLE_MS ? undefined : now())
    );
    if (!throttle.committed) throw new PaymentError('resource-exhausted', 'Veuillez patienter quelques secondes avant de réessayer.');

    const txId = newTxId();
    await db.ref('payments/' + txId).set({
      txId, ticket: makeTicket('PAY', now(), random), clientUid: uid, kind: 'commissionTopup', driverId: uid, amount, currency: CURRENCY,
      provider: providerName, status: 'initiated', createdAt: now(),
      ...(thenPay ? { thenPayCommission: true } : {}),
    });
    let checkout;
    try {
      checkout = await provider.createCheckout({
        txId, amount, currency: CURRENCY,
        description: thenPay ? 'Paiement commission Je Livre' : 'Recharge commission Je Livre',
        customer: { uid, phone: driver.phone || '' },
        returnUrl: urls.appBaseUrl + '/?payment=return&k=commission&tx=' + txId,
        notifyUrl: urls.webhookUrl,
      });
    } catch (e) {
      await db.ref('payments/' + txId).update({ status: 'failed_to_create', error: String(e && e.message).slice(0, 1000), failedAt: now() });
      throw new PaymentError('unavailable', 'Le service de paiement est momentanément indisponible. Réessayez dans un instant.');
    }
    if (!checkout || !checkout.paymentUrl) {
      await db.ref('payments/' + txId).update({ status: 'failed_to_create', error: 'no-payment-url', failedAt: now() });
      throw new PaymentError('unavailable', 'Le service de paiement est momentanément indisponible. Réessayez dans un instant.');
    }
    await db.ref('payments/' + txId).update({ providerRef: checkout.providerRef || null });
    return { txId, paymentUrl: checkout.paymentUrl, amount };
  }

  // Places de Reels sponsorisés déjà prises : actifs non expirés + réservations de paiement récentes.
  async function sponsorSlotsTaken(excludeId) {
    const t = now();
    const act = (await db.ref('sponsoredReels').orderByChild('status').equalTo('active').once('value')).val() || {};
    const wait = (await db.ref('sponsoredReels').orderByChild('status').equalTo('awaiting_payment').once('value')).val() || {};
    let n = 0;
    Object.keys(act).forEach((id) => { if (id !== excludeId && act[id] && (act[id].endsAt || 0) > t) n++; });
    Object.keys(wait).forEach((id) => { if (id !== excludeId && wait[id] && (wait[id].paymentTxAt || 0) > t - SPONSOR_HOLD_MS) n++; });
    return n;
  }

  async function createSponsorPayment({ uid, sponsorId }) {
    if (typeof sponsorId !== 'string' || !SPONSOR_ID_RE.test(sponsorId)) throw new PaymentError('invalid-argument', 'Reel sponsorisé invalide.');
    const sp = await readVal('sponsoredReels/' + sponsorId);
    if (!sp) throw new PaymentError('not-found', 'Reel sponsorisé introuvable.');
    if (sp.ownerUid !== uid) throw new PaymentError('permission-denied', "Ce Reel n'est pas le vôtre.");
    if (sp.status !== 'awaiting_payment') throw new PaymentError('failed-precondition', 'Ce Reel est déjà payé ou terminé.');
    if (typeof sp.videoUrl !== 'string' || !/^https:\/\//.test(sp.videoUrl)) throw new PaymentError('failed-precondition', 'Vidéo manquante.');
    const throttle = await db.ref('paymentThrottle/' + uid).transaction(
      (cur) => (typeof cur === 'number' && now() - cur < THROTTLE_MS ? undefined : now())
    );
    if (!throttle.committed) throw new PaymentError('resource-exhausted', 'Veuillez patienter quelques secondes avant de réessayer.');
    if ((await sponsorSlotsTaken(sponsorId)) >= SPONSOR_MAX_ACTIVE) {
      throw new PaymentError('resource-exhausted', 'Toutes les places de Reels sponsorisés sont prises pour le moment (' + SPONSOR_MAX_ACTIVE + ' en même temps). Réessayez dans quelques jours.');
    }
    const txId = newTxId();
    await db.ref().update({
      ['sponsoredReels/' + sponsorId + '/paymentTxId']: txId,
      ['sponsoredReels/' + sponsorId + '/paymentTxAt']: now(),
      ['payments/' + txId]: {
        txId, ticket: makeTicket('PAY', now(), random), clientUid: uid, kind: 'sponsor', sponsorId, amount: SPONSOR_PRICE, currency: CURRENCY,
        provider: providerName, status: 'initiated', createdAt: now(),
      },
    });
    let checkout;
    try {
      checkout = await provider.createCheckout({
        txId, amount: SPONSOR_PRICE, currency: CURRENCY,
        description: ('Reel sponsorise Je Livre ' + SPONSOR_DAYS + ' jours').slice(0, 100),
        customer: { uid, phone: sp.ownerPhone || '' },
        returnUrl: urls.appBaseUrl + '/?payment=return&k=sponsor&tx=' + txId,
        notifyUrl: urls.webhookUrl,
      });
    } catch (e) {
      await db.ref('payments/' + txId).update({ status: 'failed_to_create', error: String(e && e.message).slice(0, 1000), failedAt: now() });
      throw new PaymentError('unavailable', 'Le service de paiement est momentanément indisponible. Réessayez dans un instant.');
    }
    if (!checkout || !checkout.paymentUrl) {
      await db.ref('payments/' + txId).update({ status: 'failed_to_create', error: 'no-payment-url', failedAt: now() });
      throw new PaymentError('unavailable', 'Le service de paiement est momentanément indisponible. Réessayez dans un instant.');
    }
    await db.ref('payments/' + txId).update({ providerRef: checkout.providerRef || null });
    return { txId, paymentUrl: checkout.paymentUrl, amount: SPONSOR_PRICE };
  }

  async function createPayment({ uid, orderIds, deliveryRequestId, commissionTopup, payCommission, sponsorId }) {
    if (!uid) throw new PaymentError('unauthenticated', 'Connexion requise.');
    // Le livreur paie sa commission par Mobile Money : le serveur calcule le montant à payer
    // (jamais le client) ; la commission est soldée automatiquement dès que le paiement est confirmé.
    if (payCommission === true) {
      const pending = Number(await readVal('drivers/' + uid + '/pendingCommission') || 0);
      const balance = Number(await readVal('driverWallets/' + uid + '/commissionBalance') || 0);
      if (!(pending > 0)) throw new PaymentError('failed-precondition', "Vous n'avez aucune commission à payer.");
      const need = pending - balance;
      if (need <= 0) throw new PaymentError('failed-precondition', 'Votre solde de commission couvre déjà cette commission : utilisez « Payer avec mon solde ».');
      return createCommissionTopup({ uid, amount: Math.min(TOPUP_MAX, Math.max(TOPUP_MIN, need)), thenPay: true });
    }
    if (commissionTopup != null) return createCommissionTopup({ uid, amount: commissionTopup });
    if (deliveryRequestId != null) return createDeliveryPayment({ uid, deliveryRequestId });
    if (sponsorId != null) return createSponsorPayment({ uid, sponsorId });
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
      // "online" : payée d'avance au moment de la commande.
      // "pay_on_delivery" : réglée en Mobile Money au moment de la remise,
      // déclenché par le livreur une fois arrivé (voir completeCurrentCourse).
      if (o.paymentMethod !== 'online' && o.paymentMethod !== 'pay_on_delivery') {
        throw new PaymentError('failed-precondition', 'Cette commande ne peut pas être payée en ligne.');
      }
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
      txId, ticket: makeTicket('PAY', now(), random), clientUid: uid, orderIds,
      orderTickets: orders.map((o) => o.order.ticket).filter((t) => typeof t === 'string' && TICKET_RE.test(t)),
      amount, currency: CURRENCY,
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
        returnUrl: urls.appBaseUrl + '/?payment=return&k=marketplace&tx=' + txId,
        notifyUrl: urls.webhookUrl,
      });
    } catch (e) {
      await db.ref('payments/' + txId).update({
        status: 'failed_to_create', error: String(e && e.message).slice(0, 1000), failedAt: now(),
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

  // Même principe que createPayment, pour une demande de livraison simple
  // (point à point) au lieu d'une ou plusieurs commandes boutique.
  async function createDeliveryPayment({ uid, deliveryRequestId }) {
    if (typeof deliveryRequestId !== 'string' || !DELIVERY_REQUEST_ID_RE.test(deliveryRequestId)) {
      throw new PaymentError('invalid-argument', 'Identifiant de demande invalide.');
    }

    const throttle = await db.ref('paymentThrottle/' + uid).transaction(
      (cur) => (typeof cur === 'number' && now() - cur < THROTTLE_MS ? undefined : now())
    );
    if (!throttle.committed) {
      throw new PaymentError('resource-exhausted', 'Veuillez patienter quelques secondes avant de réessayer.');
    }

    const req = await readVal('deliveryRequests/' + deliveryRequestId);
    if (!req) throw new PaymentError('not-found', 'Demande de livraison introuvable.');
    if (req.clientUid !== uid) throw new PaymentError('permission-denied', "Cette demande n'est pas la vôtre.");
    if (req.paymentMethod !== 'online') throw new PaymentError('failed-precondition', 'Cette demande se règle à la livraison.');
    if (req.paymentStatus === 'paid') throw new PaymentError('already-exists', 'Cette demande est déjà payée.');
    if (req.status !== 'awaiting_payment') throw new PaymentError('failed-precondition', "Cette demande n'attend plus de paiement.");

    const { distanceKm, price } = computeDeliveryRequestAmount({ request: req });
    const amount = price;
    if (!Number.isInteger(amount) || amount < MIN_AMOUNT) {
      throw new PaymentError('failed-precondition', 'Montant à payer invalide.');
    }

    const txId = newTxId();
    const updates = {};
    // Montants autoritaires réécrits dans la demande, comme pour les commandes.
    updates['deliveryRequests/' + deliveryRequestId + '/price'] = price;
    updates['deliveryRequests/' + deliveryRequestId + '/distanceKm'] = distanceKm;
    updates['deliveryRequests/' + deliveryRequestId + '/paymentTxId'] = txId;
    updates['payments/' + txId] = {
      txId, ticket: makeTicket('PAY', now(), random), clientUid: uid, kind: 'delivery', requestId: deliveryRequestId,
      deliveryTicket: (typeof req.ticket === 'string' && TICKET_RE.test(req.ticket)) ? req.ticket : null, amount, currency: CURRENCY,
      provider: providerName, status: 'initiated', createdAt: now(),
    };
    await db.ref().update(updates);

    let checkout;
    try {
      checkout = await provider.createCheckout({
        txId, amount, currency: CURRENCY,
        description: ('Livraison Je Livre ' + deliveryRequestId).slice(0, 100),
        customer: { uid, phone: req.senderPhone || '' },
        returnUrl: urls.appBaseUrl + '/?payment=return&k=delivery&tx=' + txId,
        notifyUrl: urls.webhookUrl,
      });
    } catch (e) {
      await db.ref('payments/' + txId).update({
        status: 'failed_to_create', error: String(e && e.message).slice(0, 1000), failedAt: now(),
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
  // Effets normalement posés par le client lui-même (confirmOrderReceipt),
  // reproduits ici car pour une commande payée à la remise, le client ne les
  // posera jamais : le paiement EST la confirmation. Mêmes montants/règles
  // que côté app, pour que la boutique/le parrain/le livreur touchent
  // exactement la même chose quel que soit le mode de paiement.
  async function applyOrderCompletionSideEffects(id, o) {
    // Parrainage : le serveur lit lui-même le parrain dans le profil de la boutique
    // (jamais dans la commande, que le client peut falsifier), une seule fois par commande.
    await referral.creditMarketplaceOrder({ id, order: o });
    const commission = Math.round((o.deliveryFee || 0) * 0.10);
    if (commission > 0) {
      await db.ref('platformStats').transaction((cur) => {
        cur = cur || {};
        return { ...cur, commissionSimple: (cur.commissionSimple || 0) + commission };
      });
    }
    if (o.assignedDriverId && (o.deliveryFee || 0) > 0) {
      // Le livreur n'a rien encaissé (le client a payé la plateforme
      // directement) : on lui crédite les frais de livraison en intégralité.
      await db.ref('drivers/' + o.assignedDriverId).transaction((cur) => {
        cur = cur || {};
        return { ...cur, earningsBalance: (cur.earningsBalance || 0) + o.deliveryFee };
      });
    }
    // Comptage des achats par produit (même signal que côté app, pour le
    // classement des articles) — même mécanisme pour un paiement à la remise.
    for (const it of o.items || []) {
      if (!it.pid) continue;
      const qty = it.qty || 1;
      await db.ref('productStats/' + it.pid).transaction((cur) => {
        cur = cur || {};
        return { ...cur, purchaseCount: (cur.purchaseCount || 0) + qty };
      });
    }
  }

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

      // Recharge du solde de commission d'un livreur : on crédite son solde (une seule fois).
      if (pay.kind === 'commissionTopup') {
        await commission.creditTopup({ txId, driverId: pay.driverId, amount: pay.amount });
        // Paiement « de la commission » : on solde la commission avec l'argent qui vient d'arriver.
        // Si cette seconde étape échoue, l'argent reste sur le solde du livreur (rien n'est perdu).
        let paidCommission = 0;
        if (pay.thenPayCommission) {
          try { const r = await commission.payFromBalance({ uid: pay.driverId }); paidCommission = (r && r.paid) || 0; }
          catch (e) { console.error('[commission] règlement automatique impossible', e && e.message); }
        }
        await payRef.update({ status: 'paid', paidAt: now(), verifiedAmount: Number(verified.amount), paidCommission });
        return { ok: true, paid: true, status: 'paid' };
      }

      // Argent réellement reçu et montant exact : on débloque la commande ou
      // la demande de livraison, selon le type de ce paiement.
      const updates = {};
      const problems = [];
      const payAtDeliveryOrders = []; // commandes marketplace à clôturer avec leurs effets, après l'update principal
      if (pay.kind === 'sponsor') {
        const sp = await readVal('sponsoredReels/' + pay.sponsorId);
        const held = sp && (sp.paymentTxAt || 0) > now() - SPONSOR_HOLD_MS;
        if (sp && sp.status === 'awaiting_payment' && sp.ownerUid === pay.clientUid
            && (held || (await sponsorSlotsTaken(pay.sponsorId)) < SPONSOR_MAX_ACTIVE)) {
          const b = 'sponsoredReels/' + pay.sponsorId + '/';
          updates[b + 'status'] = 'active';
          updates[b + 'paymentStatus'] = 'paid';
          updates[b + 'paymentTxId'] = txId;
          updates[b + 'paidAt'] = now();
          updates[b + 'startsAt'] = now();
          updates[b + 'endsAt'] = now() + SPONSOR_DAYS * 24 * 3600 * 1000;
        } else if (sp && sp.status === 'active' && sp.paymentTxId === txId) {
          // déjà activé par un traitement précédent : rien à refaire
        } else {
          problems.push(pay.sponsorId); // place reprise entre-temps, ou Reel supprimé : à rembourser/traiter à la main
        }
      } else if (pay.kind === 'delivery') {
        const r = await readVal('deliveryRequests/' + pay.requestId);
        if (r && r.status === 'awaiting_payment' && r.paymentStatus !== 'paid' && r.clientUid === pay.clientUid) {
          updates['deliveryRequests/' + pay.requestId + '/status'] = 'pending';
          updates['deliveryRequests/' + pay.requestId + '/paymentStatus'] = 'paid';
          updates['deliveryRequests/' + pay.requestId + '/paidAt'] = now();
        } else {
          // Demande annulée entre-temps, ou déjà payée par une autre tentative.
          problems.push(pay.requestId);
        }
      } else {
        for (const id of pay.orderIds) {
          const o = await readVal('marketplaceOrders/' + id);
          if (o && o.status === 'awaiting_payment' && o.paymentStatus !== 'paid' && o.clientUid === pay.clientUid) {
            // Un livreur déjà assigné à ce stade = paiement déclenché à la
            // remise (le livreur attendait ce paiement pour pouvoir repartir),
            // pas un pré-paiement à la commande. Le paiement EST alors la
            // confirmation de réception : on clôture directement, et on pose
            // ici les effets que le client aurait posés lui-même via
            // confirmOrderReceipt (lui ne les posera jamais, pour ce mode).
            const isPayAtDelivery = !!o.assignedDriverId;
            updates['marketplaceOrders/' + id + '/status'] = isPayAtDelivery ? 'completed' : 'pending_seller';
            updates['marketplaceOrders/' + id + '/paymentStatus'] = 'paid';
            updates['marketplaceOrders/' + id + '/paidAt'] = now();
            updates['marketplaceOrders/' + id + '/paymentTxId'] = txId;
            if (isPayAtDelivery) {
              updates['marketplaceOrders/' + id + '/receivedAt'] = now();
              payAtDeliveryOrders.push({ id, o });
            }
          } else {
            // Commande annulée entre-temps, ou déjà payée par une autre tentative :
            // l'argent est bien arrivé mais ne correspond plus à rien de payable.
            problems.push(id);
          }
        }
      }
      const finalStatus = problems.length ? 'paid_needs_review' : 'paid';
      updates['payments/' + txId + '/status'] = finalStatus;
      updates['payments/' + txId + '/paidAt'] = now();
      updates['payments/' + txId + '/verifiedAmount'] = Number(verified.amount);
      if (problems.length) updates['payments/' + txId + '/problemOrders'] = problems;
      await db.ref().update(updates);
      for (const { id, o } of payAtDeliveryOrders) {
        await applyOrderCompletionSideEffects(id, o);
      }
      return { ok: true, paid: true, needsReview: problems.length > 0, status: finalStatus };
    } finally {
      try { await payRef.child('lock').set(null); } catch (e) { /* ignoré */ }
    }
  }

  // Appelée par l'application au retour de la page de paiement (et à l'ouverture) :
  // ne dépend plus du webhook. Le serveur redemande l'état réel à HorusPay (serveur à serveur)
  // puis débloque la commande / la livraison. Sans danger d'être appelée plusieurs fois.
  const PENDING_STATUSES = ['initiated', 'pending'];
  async function confirmPayment({ uid, txId }) {
    if (!uid) throw new PaymentError('unauthenticated', 'Connexion requise.');
    if (txId !== undefined && txId !== null && txId !== '') {
      if (typeof txId !== 'string' || !TX_ID_RE.test(txId)) throw new PaymentError('invalid-argument', 'Paiement invalide.');
      const pay = await readVal('payments/' + txId);
      if (!pay || pay.clientUid !== uid) throw new PaymentError('not-found', 'Paiement introuvable.');
      const r = await settlePayment(txId);
      const after = await readVal('payments/' + txId);
      return { txId, status: (after && after.status) || pay.status, ok: !!(r && r.ok) };
    }
    // Sans identifiant : on rattrape les paiements récents de ce compte restés en attente.
    const snap = await db.ref('payments').orderByChild('clientUid').equalTo(uid).once('value');
    const all = snap.val() || {};
    const since = now() - 7 * 24 * 3600 * 1000;
    const ids = Object.keys(all)
      .filter((id) => TX_ID_RE.test(id) && all[id] && PENDING_STATUSES.includes(all[id].status) && all[id].providerRef && (all[id].createdAt || 0) > since)
      .sort((a, b) => (all[b].createdAt || 0) - (all[a].createdAt || 0)).slice(0, 10);
    const settled = [];
    for (const id of ids) {
      try {
        await settlePayment(id);
        const after = await readVal('payments/' + id);
        if (after && FINAL_STATUSES.includes(after.status)) settled.push({ txId: id, status: after.status });
      } catch (e) { console.error('[paiement] rattrapage impossible', id, e && e.message); }
    }
    return { checked: ids.length, settled };
  }

  return { createPayment, settlePayment, confirmPayment, constants: { CURRENCY, MIN_AMOUNT, THROTTLE_MS, LOCK_MS } };
}

module.exports = { createPaymentCore, PaymentError, SPONSOR_PRICE, SPONSOR_DAYS, SPONSOR_MAX_ACTIVE };

});

// ---------- lib/commissionCore.js ----------
__define('commissionCore', function (module, exports, require) {
'use strict';

// Solde de commission (garantie) des livreurs.
//
// Le livreur approvisionne ce solde par un vrai paiement en ligne (vérifié par
// le serveur, comme pour les clients). Tant qu'il couvre la commission en
// attente, le livreur peut continuer à accepter des livraisons. Il peut s'en
// servir pour payer sa commission (sur son autorisation). Le solde n'est
// JAMAIS écrit par l'application : seulement ici, avec l'accès administrateur.

const { PaymentError } = __require('amounts');

const TOPUP_MIN = 500;       // F — recharge minimum
const TOPUP_MAX = 200000;    // F — recharge maximum par paiement

function createCommissionCore({ db, now = () => Date.now(), random = Math.random }) {
  const readVal = async (path) => (await db.ref(path).once('value')).val();
  const rid = () => now().toString(36) + Math.floor(random() * 36 ** 4).toString(36).padStart(4, '0');

  async function ledger(uid, id, entry) {
    await db.ref('commissionLedger/' + uid + '/' + id).set({ ...entry, at: now() });
  }

  // Appelée par le serveur de paiement quand une recharge est CONFIRMÉE payée.
  // Une seule fois par paiement, même si la notification du prestataire est rejouée.
  async function creditTopup({ txId, driverId, amount }) {
    if (!txId || !driverId || !Number.isInteger(amount) || amount <= 0) throw new PaymentError('invalid-argument', 'Recharge invalide.');
    const claim = await db.ref('payments/' + txId + '/credited').transaction((cur) => (cur ? undefined : now()));
    if (!claim.committed) return { credited: false, reason: 'already-credited' };
    try {
      await db.ref('driverWallets/' + driverId + '/commissionBalance').transaction((cur) => (cur || 0) + amount);
      await ledger(driverId, 't_' + txId, { type: 'topup', amount, txId });
      await db.ref('platformStats/commissionTopups').transaction((cur) => (cur || 0) + amount);
    } catch (e) {
      await db.ref('payments/' + txId + '/credited').set(null).catch(() => {});
      throw e;
    }
    return { credited: true, amount };
  }

  // Le livreur autorise le prélèvement de sa commission en attente sur son solde.
  async function payFromBalance({ uid, amount }) {
    if (!uid) throw new PaymentError('unauthenticated', 'Connexion requise.');
    const driver = await readVal('drivers/' + uid);
    if (!driver) throw new PaymentError('not-found', 'Compte livreur introuvable.');
    const pending = Number(driver.pendingCommission || 0);
    if (!(pending > 0)) throw new PaymentError('failed-precondition', 'Aucune commission en attente.');
    let want = pending;
    if (amount != null) {
      if (!Number.isInteger(amount) || amount <= 0) throw new PaymentError('invalid-argument', 'Montant invalide.');
      want = Math.min(amount, pending);
    }
    // 1) On prend sur le solde (au plus ce qu'il contient).
    let take = 0;
    const bal = await db.ref('driverWallets/' + uid + '/commissionBalance').transaction((cur) => {
      const b = typeof cur === 'number' ? cur : 0;
      take = Math.min(want, b);
      return take > 0 ? b - take : undefined;
    });
    if (!bal.committed || take <= 0) throw new PaymentError('failed-precondition', 'Solde de commission insuffisant. Rechargez-le.');
    // 2) On réduit la commission en attente (jamais en dessous de zéro).
    let reduced = 0;
    try {
      await db.ref('drivers/' + uid + '/pendingCommission').transaction((cur) => {
        const c = typeof cur === 'number' ? cur : 0;
        reduced = Math.min(take, c);
        return c - reduced;
      });
    } catch (e) {
      await db.ref('driverWallets/' + uid + '/commissionBalance').transaction((cur) => (cur || 0) + take).catch(() => {});
      throw e;
    }
    // La commission a pu être soldée entre-temps (par l'admin) : on rend l'excédent.
    if (reduced < take) await db.ref('driverWallets/' + uid + '/commissionBalance').transaction((cur) => (cur || 0) + (take - reduced));
    if (reduced > 0) {
      await ledger(uid, 'c_' + rid(), { type: 'commission', amount: reduced });
      await db.ref('platformStats/commissionFromBalance').transaction((cur) => (cur || 0) + reduced);
    }
    const left = await readVal('drivers/' + uid + '/pendingCommission');
    const balanceLeft = await readVal('driverWallets/' + uid + '/commissionBalance');
    return { ok: true, paid: reduced, pendingLeft: left || 0, balanceLeft: balanceLeft || 0 };
  }

  return { creditTopup, payFromBalance, constants: { TOPUP_MIN, TOPUP_MAX } };
}

module.exports = { createCommissionCore, TOPUP_MIN, TOPUP_MAX };

});

// ---------- lib/commissionHandlers.js ----------
__define('commissionHandlers', function (module, exports, require) {
'use strict';

const { PaymentError } = __require('amounts');

function makePayCommissionFromBalance({ getCore, HttpsError }) {
  return async (request) => {
    try {
      const { core } = getCore();
      return await core.payFromBalance({ uid: request.auth && request.auth.uid, amount: request.data && request.data.amount });
    } catch (e) {
      if (e instanceof PaymentError) throw new HttpsError(e.code, e.message);
      console.error('[commission] erreur inattendue', e);
      throw new HttpsError('internal', 'Erreur interne. Réessayez dans un instant.');
    }
  };
}

module.exports = { makePayCommissionFromBalance };

});

// ---------- lib/referralCore.js ----------
__define('referralCore', function (module, exports, require) {
'use strict';

// Crédit de parrainage — UNIQUEMENT décidé par le serveur.
//
// Avant : l'application du client ajoutait elle-même 25 F au solde du parrain,
// et les règles Firebase l'autorisaient à tout compte connecté (n'importe qui
// pouvait donc s'ajouter du solde). Maintenant :
//  - le parrain est lu dans le PROFIL de la boutique / du client (jamais dans
//    la commande, que le client peut falsifier) ;
//  - une seule indemnité par commande ou livraison (marqueur posé avant le crédit) ;
//  - la commande / livraison doit être réellement terminée (et payée en ligne
//    quand le paiement en ligne est choisi — statut posé seulement par le serveur) ;
//  - un compte ne peut pas se parrainer lui-même ;
//  - plafond journalier par parrain, contre les fausses commandes en série.

const { PaymentError } = __require('amounts');

const REWARD = 25;                                   // F crédités par commande / livraison terminée
const VALID_MS = 2 * 365 * 24 * 60 * 60 * 1000;      // durée de validité du parrainage (mettre null pour illimité)
const MAX_PER_DAY = 200;                             // crédits maximum par parrain et par jour (UTC)
const CASH_MAX_PER_DAY = 5;                          // livraisons PAYÉES EN ESPÈCES créditées par client et par jour (non vérifiables : on borne)
const MIN_WITHDRAWAL = 100;                          // retrait de parrainage minimum (F)
const W_ID_RE = /^w_[a-z0-9]{3,40}$/;
const PHONE_RE = /^\+?[0-9 ()-]{8,20}$/;
const ID_RE = /^[A-Za-z0-9_-]{3,60}$/;
const KINDS = ['marketplaceOrders', 'deliveryRequests'];

function createReferralCore({ db, notify = null, now = () => Date.now(), random = Math.random, validMs = VALID_MS, reward = REWARD, maxPerDay = MAX_PER_DAY, cashMaxPerDay = CASH_MAX_PER_DAY, minWithdrawal = MIN_WITHDRAWAL }) {
  const readVal = async (path) => (await db.ref(path).once('value')).val();
  // Une notification ne doit JAMAIS empêcher le crédit ou l'inscription : on essaie, on ignore l'échec.
  async function safeNotify(args) {
    if (!notify) return;
    try { await notify(args); } catch (e) { console.warn('[parrainage] notification non envoyée :', e && e.message); }
  }
  const cleanName = (v, max) => String(v || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
  const dayKey = () => new Date(now()).toISOString().slice(0, 10).replace(/-/g, '');

  // Crédite le parrain, une seule fois pour cette commande / livraison.
  async function creditOnce({ kind, id, beneficiaryUid, referrerUid, referredAt, cashCap = false }) {
    if (!referrerUid || typeof referrerUid !== 'string') return { credited: false, reason: 'no-referrer' };
    if (!beneficiaryUid || referrerUid === beneficiaryUid) return { credited: false, reason: 'self-referral' };
    if (validMs && referredAt && now() - referredAt > validMs) return { credited: false, reason: 'expired' };
    const referrer = await readVal('users/' + referrerUid);
    if (!referrer) return { credited: false, reason: 'unknown-referrer' };

    const key = kind + '_' + id;
    // 1) Marqueur "déjà crédité" : si deux appels arrivent ensemble, un seul passe.
    const mark = await db.ref('referralCredits/' + key).transaction((cur) => (cur ? undefined : { referrerUid, beneficiaryUid, amount: reward, at: now() }));
    if (!mark.committed) return { credited: false, reason: 'already-credited' };

    try {
      // 1 bis) Livraison payée en espèces (non vérifiable) : au plus quelques crédits par client et par jour.
      if (cashCap) {
        const cc = await db.ref('referralCashDaily/' + beneficiaryUid + '/' + dayKey()).transaction((cur) => ((cur || 0) >= cashMaxPerDay ? undefined : (cur || 0) + 1));
        if (!cc.committed) { await db.ref('referralCredits/' + key).set(null); return { credited: false, reason: 'cash-limit' }; }
      }
      // 2) Plafond journalier du parrain.
      const cap = await db.ref('referralDaily/' + referrerUid + '/' + dayKey()).transaction((cur) => ((cur || 0) >= maxPerDay ? undefined : (cur || 0) + 1));
      if (!cap.committed) {
        await db.ref('referralCredits/' + key).set(null);
        return { credited: false, reason: 'daily-limit' };
      }
      // 3) Le crédit lui-même, champ par champ (sans réécrire tout le profil).
      await db.ref('users/' + referrerUid + '/referralBalance').transaction((cur) => (cur || 0) + reward);
      await db.ref('users/' + referrerUid + '/referralCount').transaction((cur) => (cur || 0) + 1);
      await db.ref('platformStats/referralPayouts').transaction((cur) => (cur || 0) + reward);
    } catch (e) {
      await db.ref('referralCredits/' + key).set(null).catch(() => {});
      throw e;
    }
    // Le parrain est prévenu (sans jamais bloquer le crédit s'il ne peut pas l'être).
    const entry = await readVal('referrals/' + referrerUid + '/' + beneficiaryUid);
    const who = (entry && entry.name) || 'Votre filleul';
    await safeNotify({
      uid: referrerUid,
      title: '+' + reward + ' F de parrainage',
      body: who + (kind === 'marketplaceOrders' ? ' a reçu une commande' : ' a fait livrer un colis') + ' : ' + reward + ' F ajoutés à votre solde.',
      data: { type: 'referral_credit' },
    });
    return { credited: true, amount: reward };
  }

  // Appelée par le serveur lui-même quand il vient de régler une commande (paymentCore).
  async function creditMarketplaceOrder({ id, order }) {
    if (!order || !order.shopId) return { credited: false, reason: 'no-shop' };
    const shop = await readVal('shops/' + order.shopId);
    return creditOnce({ kind: 'marketplaceOrders', id, beneficiaryUid: order.shopId, referrerUid: shop && shop.referredBy, referredAt: shop && shop.referredAt });
  }

  // Appelée par l'application (point d'accès creditReferral) une fois la commande / livraison terminée.
  async function creditForCompletion({ callerUid, kind, id }) {
    if (!callerUid) throw new PaymentError('unauthenticated', 'Connexion requise.');
    if (!KINDS.includes(kind)) throw new PaymentError('invalid-argument', 'Type invalide.');
    if (typeof id !== 'string' || !ID_RE.test(id)) throw new PaymentError('invalid-argument', 'Identifiant invalide.');
    const rec = await readVal(kind + '/' + id);
    if (!rec) throw new PaymentError('not-found', 'Introuvable.');
    const isAdmin = !!(await readVal('adminUsers/' + callerUid));

    if (kind === 'marketplaceOrders') {
      if (!isAdmin && ![rec.clientUid, rec.shopId, rec.assignedDriverId].includes(callerUid)) throw new PaymentError('permission-denied', "Cette commande n'est pas la vôtre.");
      if (rec.status !== 'completed') throw new PaymentError('failed-precondition', "Cette commande n'est pas terminée.");
      if (rec.paymentStatus !== 'paid') throw new PaymentError('failed-precondition', "Cette commande n'a pas été payée.");
      return creditMarketplaceOrder({ id, order: rec });
    }
    if (!isAdmin && ![rec.clientUid, rec.assignedDriverId].includes(callerUid)) throw new PaymentError('permission-denied', "Cette livraison n'est pas la vôtre.");
    if (rec.status !== 'completed') throw new PaymentError('failed-precondition', "Cette livraison n'est pas terminée.");
    if (rec.paymentMethod === 'online' && rec.paymentStatus !== 'paid') throw new PaymentError('failed-precondition', "Cette livraison n'a pas été payée.");
    const isCash = rec.paymentMethod !== 'online';
    // Espèces : il faut un livreur distinct du client (sinon on pourrait se livrer soi-même).
    if (isCash && (!rec.assignedDriverId || rec.assignedDriverId === rec.clientUid)) return { credited: false, reason: 'invalid-driver' };
    const client = rec.clientUid ? await readVal('users/' + rec.clientUid) : null;
    return creditOnce({ kind, id, beneficiaryUid: rec.clientUid, referrerUid: client && client.referredBy, referredAt: client && client.referredAt, cashCap: isCash });
  }

  // ---------- inscription d'un filleul : liste du parrain + notification ----------
  // Appelée par le filleul juste après son inscription. Le serveur relit LUI-MÊME le parrain
  // dans le profil du filleul (jamais dans ce que l'appelant envoie), une seule fois par filleul.
  const REG_KINDS = { client: 'users', shop: 'shops' };
  async function registerReferral({ uid, kind }) {
    if (!uid) throw new PaymentError('unauthenticated', 'Connexion requise.');
    const coll = REG_KINDS[kind];
    if (!coll) throw new PaymentError('invalid-argument', 'Type invalide.');
    const rec = await readVal(coll + '/' + uid);
    if (!rec) throw new PaymentError('not-found', 'Compte introuvable.');
    const referrerUid = rec.referredBy;
    if (!referrerUid || typeof referrerUid !== 'string') return { registered: false, reason: 'no-referrer' };
    if (referrerUid === uid) return { registered: false, reason: 'self-referral' };
    if (!(await readVal('users/' + referrerUid))) return { registered: false, reason: 'unknown-referrer' };
    // Prénom pour une personne, nom complet pour une boutique.
    const full = cleanName(rec.name || rec.shopName, 60);
    const name = (kind === 'shop' ? full : full.split(' ')[0]).slice(0, 40) || 'Un nouveau membre';
    const mark = await db.ref('referrals/' + referrerUid + '/' + uid).transaction((cur) => (cur ? undefined : { name, kind, at: now() }));
    if (!mark.committed) return { registered: false, reason: 'already-registered' };
    await safeNotify({
      uid: referrerUid,
      title: 'Nouveau filleul !',
      body: name + " vient de s'inscrire avec votre code. Vous gagnerez " + reward + ' F à chaque commande ou livraison qu\'il génère.',
      data: { type: 'referral_signup' },
    });
    return { registered: true, name };
  }

  // ---------- retraits de parrainage ----------
  // Le solde est DÉBITÉ ici, au moment de la demande (avant, il n'était jamais débité :
  // on pouvait redemander le même montant). Un refus par l'admin le REMBOURSE.
  async function requestWithdrawal({ uid, amount, phone }) {
    const { makeTicket } = require('tickets');
    if (!uid) throw new PaymentError('unauthenticated', 'Connexion requise.');
    if (!Number.isInteger(amount) || amount < minWithdrawal) throw new PaymentError('invalid-argument', 'Montant invalide (minimum ' + minWithdrawal + ' F).');
    const ph = String(phone || '').trim();
    if (!PHONE_RE.test(ph)) throw new PaymentError('invalid-argument', 'Numéro Mobile Money invalide.');
    const user = await readVal('users/' + uid);
    if (!user) throw new PaymentError('not-found', 'Compte introuvable.');
    const debit = await db.ref('users/' + uid + '/referralBalance').transaction((cur) => (typeof cur === 'number' && cur >= amount ? cur - amount : undefined));
    if (!debit.committed) throw new PaymentError('failed-precondition', 'Solde de parrainage insuffisant.');
    const id = 'w_' + now().toString(36) + Math.floor(random() * 36 ** 5).toString(36).padStart(5, '0');
    try {
      await db.ref('withdrawalRequests/' + id).set({
        kind: 'referral', ticket: makeTicket('RET', now(), random), debited: true, clientUid: uid, shopName: 'Parrainage — ' + String(user.name || '').slice(0, 60),
        amount, phone: ph, status: 'pending', requestedAt: now(),
      });
    } catch (e) {
      await db.ref('users/' + uid + '/referralBalance').transaction((cur) => (cur || 0) + amount).catch(() => {});
      throw e;
    }
    return { ok: true, withdrawalId: id, amount };
  }

  const isReferralWithdrawal = (w) => w && (w.kind === 'referral' || (!w.kind && typeof w.clientUid === 'string' && String(w.shopName || '').indexOf('Parrainage') === 0));

  async function decideWithdrawal({ adminUid, withdrawalId, decision }) {
    if (!adminUid) throw new PaymentError('unauthenticated', 'Connexion requise.');
    if (!(await readVal('adminUsers/' + adminUid))) throw new PaymentError('permission-denied', 'Réservé aux administrateurs.');
    if (typeof withdrawalId !== 'string' || !W_ID_RE.test(withdrawalId)) throw new PaymentError('invalid-argument', 'Identifiant de demande invalide.');
    if (decision !== 'paid' && decision !== 'rejected') throw new PaymentError('invalid-argument', 'Décision invalide.');
    const wRef = db.ref('withdrawalRequests/' + withdrawalId);
    const w = await readVal('withdrawalRequests/' + withdrawalId);
    if (!w) throw new PaymentError('not-found', 'Demande introuvable.');
    if (!isReferralWithdrawal(w)) throw new PaymentError('failed-precondition', "Cette demande n'est pas un retrait de parrainage.");
    if (w.status !== 'pending') throw new PaymentError('already-exists', 'Cette demande a déjà été traitée.');
    if (!Number.isInteger(w.amount) || w.amount <= 0) throw new PaymentError('failed-precondition', 'Montant de la demande invalide.');
    const balRef = db.ref('users/' + w.clientUid + '/referralBalance');
    let debitedNow = false;
    // Ancienne demande (créée avant ce correctif) : le solde n'avait pas été débité, on le fait au paiement.
    if (decision === 'paid' && !w.debited) {
      const d = await balRef.transaction((cur) => (typeof cur === 'number' && cur >= w.amount ? cur - w.amount : undefined));
      if (!d.committed) throw new PaymentError('failed-precondition', "Le solde de parrainage actuel est inférieur à ce montant : ne versez rien, refusez la demande.");
      debitedNow = true;
    }
    const claim = await wRef.child('status').transaction((cur) => (cur === 'pending' ? decision : undefined));
    if (!claim.committed) {
      if (debitedNow) await balRef.transaction((cur) => (cur || 0) + w.amount);
      throw new PaymentError('already-exists', 'Cette demande vient d\'être traitée.');
    }
    const upd = { processedBy: adminUid, processedAt: now() };
    if (debitedNow) upd.debited = true;
    if (decision === 'rejected' && w.debited) { await balRef.transaction((cur) => (cur || 0) + w.amount); upd.refunded = true; }
    await wRef.update(upd);
    return { ok: true, status: decision, refunded: !!upd.refunded };
  }

  return { creditForCompletion, creditMarketplaceOrder, creditOnce, registerReferral, requestWithdrawal, decideWithdrawal, constants: { REWARD: reward, MAX_PER_DAY: maxPerDay, VALID_MS: validMs, CASH_MAX_PER_DAY: cashMaxPerDay, MIN_WITHDRAWAL: minWithdrawal } };
}

module.exports = { createReferralCore };

});

// ---------- lib/referralHandlers.js ----------
__define('referralHandlers', function (module, exports, require) {
'use strict';

const { PaymentError } = __require('amounts');

function makeCreditReferral({ getCore, HttpsError }) {
  return async (request) => {
    try {
      const { core } = getCore();
      return await core.creditForCompletion({
        callerUid: request.auth && request.auth.uid,
        kind: request.data && request.data.kind,
        id: request.data && request.data.id,
      });
    } catch (e) {
      if (e instanceof PaymentError) throw new HttpsError(e.code, e.message);
      console.error('[parrainage] erreur inattendue', e);
      throw new HttpsError('internal', 'Erreur interne. Réessayez dans un instant.');
    }
  };
}

function makeRequestReferralWithdrawal({ getCore, HttpsError }) {
  return async (request) => {
    try {
      const { core } = getCore();
      return await core.requestWithdrawal({ uid: request.auth && request.auth.uid, amount: request.data && request.data.amount, phone: request.data && request.data.phone });
    } catch (e) {
      if (e instanceof PaymentError) throw new HttpsError(e.code, e.message);
      console.error('[parrainage] erreur inattendue', e);
      throw new HttpsError('internal', 'Erreur interne. Réessayez dans un instant.');
    }
  };
}

function makeDecideReferralWithdrawal({ getCore, HttpsError }) {
  return async (request) => {
    try {
      const { core } = getCore();
      return await core.decideWithdrawal({ adminUid: request.auth && request.auth.uid, withdrawalId: request.data && request.data.withdrawalId, decision: request.data && request.data.decision });
    } catch (e) {
      if (e instanceof PaymentError) throw new HttpsError(e.code, e.message);
      console.error('[parrainage] erreur inattendue', e);
      throw new HttpsError('internal', 'Erreur interne. Réessayez dans un instant.');
    }
  };
}

function makeRegisterReferral({ getCore, HttpsError }) {
  return async (request) => {
    try {
      const { core } = getCore();
      return await core.registerReferral({ uid: request.auth && request.auth.uid, kind: request.data && request.data.kind });
    } catch (e) {
      if (e instanceof PaymentError) throw new HttpsError(e.code, e.message);
      console.error('[parrainage] erreur inattendue', e);
      throw new HttpsError('internal', 'Erreur interne. Réessayez dans un instant.');
    }
  };
}

module.exports = { makeCreditReferral, makeRequestReferralWithdrawal, makeDecideReferralWithdrawal, makeRegisterReferral };

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

// request : deliveryRequests/<id> telle qu'enregistrée par le client
// (paiement en ligne réservé au type "simple" — Express/Groupée se paient
// toujours à la livraison).
function computeDeliveryRequestAmount({ request }) {
  if (!request) throw new PaymentError('not-found', 'Demande de livraison introuvable.');
  if (request.type !== 'simple') {
    throw new PaymentError('failed-precondition', "Le paiement en ligne n'est disponible que pour les livraisons simples.");
  }
  const s = request.senderCoords;
  const r = request.recipientCoords;
  if (!s || !isNum(s.lat) || !isNum(s.lng) || !r || !isNum(r.lat) || !isNum(r.lng)) {
    throw new PaymentError('failed-precondition', 'Position du destinataire manquante : paiement en ligne indisponible pour cette demande.');
  }
  // × 1,3 : même facteur que côté app (window.GeoUtils dans je-livre-prototype.html),
  // pour que le montant facturé ne puisse jamais différer de ce qui a été
  // affiché au client avant qu'il ne confirme.
  const distanceKm = haversineKm(s.lat, s.lng, r.lat, r.lng) * 1.3;
  const price = deliveryFeeForKm(distanceKm);
  return { distanceKm, price };
}

module.exports = { PaymentError, deliveryFeeForKm, haversineKm, computeOrderAmounts, computeDeliveryRequestAmount };

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
        deliveryRequestId: request.data && request.data.deliveryRequestId,
        sponsorId: request.data && request.data.sponsorId,
        commissionTopup: request.data && request.data.commissionTopup,
        payCommission: request.data && request.data.payCommission === true,
      });
    } catch (e) {
      throw toHttpsError(e);
    }
  };
}

function makeConfirmPayment({ getCore, HttpsError }) {
  return async (request) => {
    try {
      const { core } = getCore();
      return await core.confirmPayment({ uid: request.auth && request.auth.uid, txId: request.data && request.data.txId });
    } catch (e) {
      if (e instanceof PaymentError) throw new HttpsError(e.code, e.message);
      console.error('[paiement] confirmPayment inattendu', e);
      throw new HttpsError('internal', 'Erreur interne. Réessayez dans un instant.');
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

module.exports = { makeCreatePayment, makeConfirmPayment, makeWebhook, makeMockPay };

});

// ---------- lib/payoutCore.js ----------
__define('payoutCore', function (module, exports, require) {
'use strict';

// Virements aux livreurs (retrait de leurs gains) — toujours déclenché par un
// administrateur, jamais directement par le livreur lui-même. Le montant et
// le droit de retrait sont systématiquement revérifiés ici, jamais pris tel
// quel depuis ce que le client a envoyé.

const { PaymentError } = __require('amounts');

const MIN_PAYOUT = 100; // minimum HorusPay documenté pour un virement
const WITHDRAW_MIN = 500; // retrait du solde de commission : minimum
const WITHDRAW_DAILY_MAX = 200000; // plafond de retrait par livreur et par jour
const WITHDRAW_THROTTLE_MS = 15000; // anti double-clic
const VALID_MODES = ['moov_bf', 'orange_bf_direct']; // Burkina Faso (voir docs HorusPay > Méthodes de paiement)

function createPayoutCore({ db, provider, now = () => Date.now() }) {
  async function readVal(path) {
    const snap = await db.ref(path).once('value');
    return snap.val();
  }

  async function createDriverPayout({ adminUid, withdrawalId }) {
    if (!adminUid) throw new PaymentError('unauthenticated', 'Connexion requise.');
    const isAdmin = await readVal('adminUsers/' + adminUid);
    if (!isAdmin) throw new PaymentError('permission-denied', 'Réservé aux administrateurs.');

    if (typeof withdrawalId !== 'string' || !/^w_[a-z0-9]{3,40}$/.test(withdrawalId)) {
      throw new PaymentError('invalid-argument', 'Identifiant de demande invalide.');
    }
    const w = await readVal('withdrawalRequests/' + withdrawalId);
    if (!w) throw new PaymentError('not-found', 'Demande de retrait introuvable.');
    if (w.kind !== 'driver') throw new PaymentError('failed-precondition', "Cette demande n'est pas un retrait de livreur.");
    if (w.status !== 'pending') throw new PaymentError('already-exists', 'Cette demande a déjà été traitée.');
    if (!VALID_MODES.includes(w.network)) throw new PaymentError('invalid-argument', 'Réseau Mobile Money invalide.');
    if (!Number.isInteger(w.amount) || w.amount < MIN_PAYOUT) {
      throw new PaymentError('failed-precondition', 'Montant de retrait invalide (minimum ' + MIN_PAYOUT + ' F).');
    }

    const driver = await readVal('drivers/' + w.driverId);
    const available = (driver && driver.earningsBalance) || 0;
    if (w.amount > available) {
      throw new PaymentError('failed-precondition', 'Le montant dépasse le solde disponible du livreur (' + available + ' F).');
    }

    let payout;
    try {
      payout = await provider.createPayout({ amount: w.amount, currency: 'XOF', mode: w.network, phone: w.phone, holderName: w.holderName });
    } catch (e) {
      await db.ref('withdrawalRequests/' + withdrawalId).update({
        lastError: String(e && e.message).slice(0, 1000), lastErrorAt: now(),
      });
      if (/exceeds available balance/i.test(String(e && e.message))) {
        throw new PaymentError('failed-precondition', "Solde HorusPay disponible insuffisant pour ce virement. L'argent encaissé auprès des clients n'est peut-être pas encore libéré : vérifiez « Solde » dans HorusPay, puis réessayez. Aucun argent n'a été envoyé.");
      }
      throw new PaymentError('unavailable', "Le virement n'a pas pu être initié. Réessayez dans un instant.");
    }

    const updates = {};
    updates['withdrawalRequests/' + withdrawalId + '/status'] = 'processing';
    updates['withdrawalRequests/' + withdrawalId + '/payoutId'] = payout.payoutId;
    updates['withdrawalRequests/' + withdrawalId + '/fees'] = payout.fees;
    updates['withdrawalRequests/' + withdrawalId + '/netAmount'] = payout.netAmount;
    updates['withdrawalRequests/' + withdrawalId + '/processedBy'] = adminUid;
    updates['withdrawalRequests/' + withdrawalId + '/processedAt'] = now();
    updates['drivers/' + w.driverId + '/earningsBalance'] = Math.max(0, available - w.amount);
    await db.ref().update(updates);

    return { ok: true, payoutId: payout.payoutId, fees: payout.fees, netAmount: payout.netAmount };
  }

  // ---- Retrait du solde de commission par le livreur lui-même (automatique) ----
  // Garde-fous : seulement l'excédent qui ne sert pas à couvrir la commission en attente,
  // virement UNIQUEMENT sur le numéro enregistré du livreur, plafond par jour,
  // et remboursement automatique si le virement échoue.
  async function runCommissionWithdrawal({ uid, amount, network: networkArg }) {
    if (!uid) throw new PaymentError('unauthenticated', 'Connexion requise.');
    if (!Number.isInteger(amount) || amount < WITHDRAW_MIN || amount > WITHDRAW_DAILY_MAX) {
      throw new PaymentError('invalid-argument', 'Montant invalide (entre ' + WITHDRAW_MIN + ' et ' + WITHDRAW_DAILY_MAX + ' F).');
    }
    const driver = await readVal('drivers/' + uid);
    if (!driver) throw new PaymentError('not-found', 'Compte livreur introuvable.');
    if (!driver.approved) throw new PaymentError('failed-precondition', "Votre compte livreur n'est pas encore validé.");
    // Compte de paiement enregistré par le livreur (réseau + numéro + nom du titulaire) : c'est lui qui décide
    // de la destination du virement, jamais la demande. À défaut (anciennes versions de l'appli), numéro du compte.
    const acct = await readVal('driverPayoutAccounts/' + uid);
    let network = networkArg, phone, holderName = null;
    if (acct && VALID_MODES.includes(acct.network) && /^[0-9]{8}$/.test(String(acct.phone || ''))) {
      network = acct.network; phone = '+226' + acct.phone; holderName = String(acct.holderName || '').slice(0, 60) || null;
    } else {
      phone = String(driver.phone || '').trim();
      if (!/^\+?\d[\d\s]{6,14}$/.test(phone)) {
        throw new PaymentError('failed-precondition', "Enregistrez d'abord votre compte de paiement (réseau, numéro et nom) dans votre espace livreur.");
      }
    }
    if (!VALID_MODES.includes(network)) throw new PaymentError('invalid-argument', 'Réseau Mobile Money invalide.');
    const throttle = await db.ref('withdrawThrottle/' + uid).transaction((cur) => (typeof cur === 'number' && now() - cur < WITHDRAW_THROTTLE_MS ? undefined : now()));
    if (!throttle.committed) throw new PaymentError('resource-exhausted', 'Veuillez patienter quelques secondes avant de réessayer.');

    const pending = Number(driver.pendingCommission || 0);
    const walletRef = (suffix) => db.ref('driverWallets/' + uid + '/' + suffix);
    const refund = (n) => walletRef('commissionBalance').transaction((cur) => (cur || 0) + n);
    const day = new Date(now()).toISOString().slice(0, 10);
    const ledgerSet = (key, entry) => db.ref('commissionLedger/' + uid + '/' + key).set({ ...entry, at: now() });

    // 1) On débite le solde — jamais en dessous de la commission en attente.
    let seen = 0;
    const debit = await walletRef('commissionBalance').transaction((cur) => {
      const b = typeof cur === 'number' ? cur : 0; seen = b;
      return b - amount >= pending ? b - amount : undefined;
    });
    if (!debit.committed) {
      const available = Math.max(0, seen - pending);
      throw new PaymentError('failed-precondition', 'Montant supérieur à votre solde disponible pour un retrait (' + available + ' F) : le reste sert à couvrir votre commission en attente.');
    }
    // 2) Plafond du jour.
    const cap = await walletRef('withdrawnByDay/' + day).transaction((cur) => {
      const c = typeof cur === 'number' ? cur : 0;
      return c + amount <= WITHDRAW_DAILY_MAX ? c + amount : undefined;
    });
    if (!cap.committed) {
      await refund(amount);
      throw new PaymentError('resource-exhausted', 'Plafond de retrait du jour atteint (' + WITHDRAW_DAILY_MAX + ' F par jour).');
    }
    // 3) Enregistrement puis virement.
    const { makeTicket } = require('tickets');
    const id = 'w_' + now().toString(36) + Math.floor(Math.random() * 36 ** 4).toString(36).padStart(4, '0');
    try {
      await db.ref('withdrawalRequests/' + id).set({ kind: 'commissionBalance', ticket: makeTicket('RET', now(), Math.random), driverId: uid, holderName, amount, phone, network, status: 'initiating', debited: true, requestedAt: now() });
    } catch (e) {
      await refund(amount); await walletRef('withdrawnByDay/' + day).transaction((c) => Math.max(0, (c || 0) - amount)).catch(() => {});
      throw new PaymentError('unavailable', "Le retrait n'a pas pu être enregistré. Votre solde n'a pas été débité.");
    }
    let payout;
    try {
      payout = await provider.createPayout({ amount, currency: 'XOF', mode: network, phone, holderName });
    } catch (e) {
      await refund(amount);
      await walletRef('withdrawnByDay/' + day).transaction((c) => Math.max(0, (c || 0) - amount)).catch(() => {});
      await db.ref('withdrawalRequests/' + id).update({ status: 'failed', refunded: true, lastError: String(e && e.message).slice(0, 500), failedAt: now() }).catch(() => {});
      await ledgerSet('wr_' + id, { type: 'withdrawal_refund', amount, withdrawalId: id }).catch(() => {});
      throw new PaymentError('unavailable', "Le virement n'a pas pu être effectué. Votre solde n'a pas été débité. Réessayez dans un instant.");
    }
    await db.ref('withdrawalRequests/' + id).update({ status: 'processing', payoutId: payout.payoutId, fees: payout.fees, netAmount: payout.netAmount, processedAt: now() });
    await ledgerSet('w_' + id, { type: 'withdrawal', amount, withdrawalId: id, netAmount: payout.netAmount });
    await db.ref('platformStats/commissionWithdrawn').transaction((cur) => (cur || 0) + amount);
    const balanceLeft = (await readVal('driverWallets/' + uid + '/commissionBalance')) || 0;
    return { ok: true, withdrawalId: id, amount, fees: payout.fees, netAmount: payout.netAmount, balanceLeft };
  }

  // Clé d'idempotence : l'app envoie la même clé tant que le livreur n'a pas changé d'avis.
  // Un renvoi (réseau coupé, relance) ne crée JAMAIS un deuxième virement : on rend le résultat du premier.
  // Sans clé (anciennes versions de l'app), le comportement reste celui d'avant (délai anti double-clic).
  const KEY_RE = /^[A-Za-z0-9_-]{16,64}$/;
  const KEY_STALE_MS = 120000;
  async function createCommissionWithdrawal({ uid, amount, network, requestKey }) {
    if (requestKey === undefined || requestKey === null || requestKey === '') {
      return runCommissionWithdrawal({ uid, amount, network });
    }
    if (!uid) throw new PaymentError('unauthenticated', 'Connexion requise.');
    if (typeof requestKey !== 'string' || !KEY_RE.test(requestKey)) {
      throw new PaymentError('invalid-argument', 'Clé de demande invalide.');
    }
    const keyRef = db.ref('withdrawKeys/' + uid + '/' + requestKey);
    const claim = await keyRef.transaction((cur) => (cur ? undefined : { state: 'started', amount, network, at: now() }));
    if (!claim.committed) {
      const prev = (await keyRef.once('value')).val() || {};
      if (prev.state === 'done' && prev.result) return { ...prev.result, replayed: true };
      if (prev.state === 'started' && now() - (prev.at || 0) < KEY_STALE_MS) {
        throw new PaymentError('already-exists', 'Cette demande est déjà en cours de traitement. Patientez un instant, ne la renvoyez pas.');
      }
      throw new PaymentError('failed-precondition', "Cette demande a déjà été reçue. Vérifiez votre solde et l'historique avant de réessayer.");
    }
    try {
      const result = await runCommissionWithdrawal({ uid, amount, network });
      await keyRef.set({ state: 'done', amount, network, at: now(), result }).catch(() => {});
      return result;
    } catch (e) {
      // Erreur "propre" (refus avant débit, ou débit remboursé) : on libère la clé pour qu'un vrai nouvel essai soit possible.
      // Erreur inattendue (après virement peut-être) : on garde la clé verrouillée, pas de rejeu automatique.
      if (e instanceof PaymentError) await keyRef.remove().catch(() => {});
      throw e;
    }
  }

  return { createDriverPayout, createCommissionWithdrawal };
}

module.exports = { createPayoutCore, WITHDRAW_MIN, WITHDRAW_DAILY_MAX };

});

// ---------- lib/payoutHandlers.js ----------
__define('payoutHandlers', function (module, exports, require) {
'use strict';

const { PaymentError } = __require('amounts');

function makeCreateDriverPayout({ getCore, HttpsError }) {
  const toHttpsError = (e) => {
    if (e instanceof PaymentError) return new HttpsError(e.code, e.message);
    console.error('[virement] erreur inattendue', e);
    return new HttpsError('internal', 'Erreur interne. Réessayez dans un instant.');
  };
  return async (request) => {
    try {
      const { core } = getCore();
      return await core.createDriverPayout({
        adminUid: request.auth && request.auth.uid,
        withdrawalId: request.data && request.data.withdrawalId,
      });
    } catch (e) {
      throw toHttpsError(e);
    }
  };
}

function makeRequestCommissionWithdrawal({ getCore, HttpsError }) {
  const toHttpsError = (e) => {
    if (e instanceof PaymentError) return new HttpsError(e.code, e.message);
    console.error('[retrait commission] erreur inattendue', e);
    return new HttpsError('internal', 'Erreur interne. Réessayez dans un instant.');
  };
  return async (request) => {
    try {
      const { core } = getCore();
      return await core.createCommissionWithdrawal({
        uid: request.auth && request.auth.uid,
        amount: request.data && request.data.amount,
        network: request.data && request.data.network,
        requestKey: request.data && request.data.requestKey,
      });
    } catch (e) {
      throw toHttpsError(e);
    }
  };
}

module.exports = { makeCreateDriverPayout, makeRequestCommissionWithdrawal };

});

// ---------- lib/notifyCore.js ----------
__define('notifyCore', function (module, exports, require) {
'use strict';

const { PaymentError } = __require('amounts');

// Distance de recherche des livreurs "à proximité" d'une nouvelle demande —
// toute la zone de service tient dans Ouagadougou, donc une valeur généreuse
// mais bornée, plutôt que de prévenir absolument tout le monde à chaque fois.
const NEARBY_RADIUS_KM = 6;

function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371, toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1), dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function createNotifyCore({ db, messaging, now = () => Date.now() }) {
  async function readVal(path) {
    const snap = await db.ref(path).once('value');
    return snap.val();
  }

  // Envoie à UNE personne précise, à partir du jeton qu'elle a enregistré.
  // Un jeton absent n'est jamais une erreur (navigateur sans notifications,
  // personne qui n'a jamais accepté) — juste rien à envoyer.
  async function sendToOne({ collection, uid, title, body, data }) {
    if (!uid) return { sent: false, reason: 'no-uid' };
    const token = await readVal(collection + '/' + uid + '/fcmToken');
    if (!token) return { sent: false, reason: 'no-token' };
    try {
      await messaging.send({
        token,
        notification: { title, body },
        data: Object.fromEntries(Object.entries(data || {}).map(([k, v]) => [k, String(v)])),
      });
      return { sent: true };
    } catch (e) {
      const code = e && e.code;
      if (code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-registration-token') {
        // Jeton périmé (app désinstallée, permission retirée...) : on le
        // retire pour ne plus jamais réessayer dessus inutilement.
        await db.ref(collection + '/' + uid + '/fcmToken').remove();
      }
      return { sent: false, reason: 'send-failed', error: String(e && e.message) };
    }
  }

  // Prévient la boutique d'une nouvelle commande — jamais sur la seule foi de
  // ce que le client prétend : on relit la vraie commande en base, on
  // vérifie qu'elle lui appartient bien, et le message envoyé est toujours le
  // même texte fixé ici (jamais un texte libre fourni par le client).
  async function notifyShopNewOrder({ clientUid, orderId }) {
    if (!clientUid) throw new PaymentError('unauthenticated', 'Connexion requise.');
    if (typeof orderId !== 'string' || !/^CMD-[A-Z0-9]{6,20}$/.test(orderId)) {
      throw new PaymentError('invalid-argument', 'Identifiant de commande invalide.');
    }
    const o = await readVal('marketplaceOrders/' + orderId);
    if (!o) throw new PaymentError('not-found', 'Commande introuvable.');
    if (o.clientUid !== clientUid) throw new PaymentError('permission-denied', "Cette commande n'est pas la vôtre.");
    const result = await sendToOne({
      collection: 'shops', uid: o.shopId,
      title: 'Nouvelle commande',
      body: "Une nouvelle commande vient d'arriver sur votre boutique.",
      data: { type: 'new_order', orderId },
    });
    return { ok: true, ...result };
  }

  // Prévient les livreurs disponibles à proximité d'une nouvelle demande
  // (livraison simple, ou commande boutique prête à être livrée) — jamais
  // tout le monde, et jamais sans vérifier que la demande existe vraiment.
  // Déclenchée soit par le client lui-même (livraison simple, à la création),
  // soit par la boutique concernée (commande marketplace, une fois préparée
  // et confirmée — pas à la création, les livreurs n'ont rien à y faire
  // avant que la boutique ne l'ait acceptée).
  async function notifyNearbyRequest({ callerUid, kind, requestId }) {
    if (!callerUid) throw new PaymentError('unauthenticated', 'Connexion requise.');
    if (kind !== 'delivery' && kind !== 'order') throw new PaymentError('invalid-argument', 'Type de demande invalide.');
    const isDelivery = kind === 'delivery';
    if (typeof requestId !== 'string' || !/^[A-Za-z0-9_-]{3,40}$/.test(requestId)) {
      throw new PaymentError('invalid-argument', 'Identifiant invalide.');
    }
    const collection = isDelivery ? 'deliveryRequests' : 'marketplaceOrders';
    const req = await readVal(collection + '/' + requestId);
    if (!req) throw new PaymentError('not-found', 'Demande introuvable.');
    const isOwner = req.clientUid === callerUid || (!isDelivery && req.shopId === callerUid);
    if (!isOwner) throw new PaymentError('permission-denied', "Cette demande ne vous appartient pas.");
    const coords = isDelivery ? req.senderCoords : req.clientCoords;
    if (!coords || typeof coords.lat !== 'number' || typeof coords.lng !== 'number') {
      return { ok: true, sent: 0, total: 0 };
    }
    const all = (await readVal('drivers')) || {};
    const nearby = Object.entries(all).filter(([, d]) => (
      d && d.online && d.status === 'approved' && typeof d.lat === 'number' && typeof d.lng === 'number'
      && haversineKm(coords.lat, coords.lng, d.lat, d.lng) <= NEARBY_RADIUS_KM
    ));
    const results = await Promise.all(nearby.map(([uid]) => sendToOne({
      collection: 'drivers', uid,
      title: 'Nouvelle livraison à proximité',
      body: isDelivery ? 'Une personne cherche un livreur près de vous.' : 'Une commande boutique est prête à être livrée près de vous.',
      data: { type: 'nearby_request', kind, requestId },
    })));
    return { ok: true, sent: results.filter((r) => r.sent).length, total: results.length };
  }

  // Appelée par le livreur juste après avoir accepté : prévient (une seule fois) celui qui a fait la demande,
  // et la boutique pour une commande, pour qu'ils sachent qu'un livreur arrive. Le serveur relit la vraie demande.
  async function notifyAssigned({ callerUid, kind, requestId }) {
    if (!callerUid) throw new PaymentError('unauthenticated', 'Connexion requise.');
    if (kind !== 'delivery' && kind !== 'order') throw new PaymentError('invalid-argument', 'Type de demande invalide.');
    if (typeof requestId !== 'string' || !/^[A-Za-z0-9_-]{3,60}$/.test(requestId)) throw new PaymentError('invalid-argument', 'Identifiant invalide.');
    const isDelivery = kind === 'delivery';
    const collection = isDelivery ? 'deliveryRequests' : 'marketplaceOrders';
    const req = await readVal(collection + '/' + requestId);
    if (!req) throw new PaymentError('not-found', 'Demande introuvable.');
    if (req.assignedDriverId !== callerUid || req.status !== 'assigned') throw new PaymentError('permission-denied', "Cette demande ne vous est pas assignée.");
    if (req.assignNotifiedAt) return { ok: true, sent: 0, already: true };
    await db.ref(collection + '/' + requestId + '/assignNotifiedAt').set(now());
    const who = req.assignedDriverName ? req.assignedDriverName : 'Un livreur';
    const jobs = [sendToOne({
      collection: 'users', uid: req.clientUid,
      title: 'Un livreur arrive',
      body: who + (isDelivery ? ' a accepté votre livraison. Gardez vos codes pour la remise.' : ' a accepté votre commande. Gardez votre code pour la remise.'),
      data: { type: 'assigned', kind, requestId },
    })];
    if (!isDelivery && req.shopId) {
      jobs.push(sendToOne({ collection: 'shops', uid: req.shopId, title: 'Un livreur vient chercher la commande', body: 'Donnez-lui votre code de récupération (dans Commandes) quand il arrive.', data: { type: 'assigned', kind, requestId } }));
    }
    const res = await Promise.all(jobs);
    return { ok: true, sent: res.filter((r) => r.sent).length };
  }

  return { notifyShopNewOrder, notifyNearbyRequest, notifyAssigned, sendToOne };
}

module.exports = { createNotifyCore, haversineKm };

});

// ---------- lib/notifyHandlers.js ----------
__define('notifyHandlers', function (module, exports, require) {
'use strict';

const { PaymentError } = __require('amounts');

function makeNotifyShopNewOrder({ getCore, HttpsError }) {
  return async (request) => {
    try {
      const { core } = getCore();
      return await core.notifyShopNewOrder({
        clientUid: request.auth && request.auth.uid,
        orderId: request.data && request.data.orderId,
      });
    } catch (e) {
      if (e instanceof PaymentError) throw new HttpsError(e.code, e.message);
      console.error('[notification] erreur inattendue', e);
      throw new HttpsError('internal', 'Erreur interne. Réessayez dans un instant.');
    }
  };
}

function makeNotifyNearbyRequest({ getCore, HttpsError }) {
  return async (request) => {
    try {
      const { core } = getCore();
      return await core.notifyNearbyRequest({
        callerUid: request.auth && request.auth.uid,
        kind: request.data && request.data.kind,
        requestId: request.data && request.data.requestId,
      });
    } catch (e) {
      if (e instanceof PaymentError) throw new HttpsError(e.code, e.message);
      console.error('[notification] erreur inattendue', e);
      throw new HttpsError('internal', 'Erreur interne. Réessayez dans un instant.');
    }
  };
}

function makeNotifyAssigned({ getCore, HttpsError }) {
  return async (request) => {
    try {
      const { core } = getCore();
      return await core.notifyAssigned({
        callerUid: request.auth && request.auth.uid,
        kind: request.data && request.data.kind,
        requestId: request.data && request.data.requestId,
      });
    } catch (e) {
      if (e instanceof PaymentError) throw new HttpsError(e.code, e.message);
      console.error('[notification] erreur inattendue', e);
      throw new HttpsError('internal', 'Erreur interne. Réessayez dans un instant.');
    }
  };
}

module.exports = { makeNotifyShopNewOrder, makeNotifyNearbyRequest, makeNotifyAssigned };

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
    case 'horuspay':
      return __require('paymentProviderHoruspay')(deps);
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

// ---------- providers/horuspay.js ----------
__define('paymentProviderHoruspay', function (module, exports, require) {
'use strict';

// Adaptateur HorusPay (Afrique de l'Ouest) — https://docs.horuspay.africa
//
// Une seule adresse existe réellement : https://api.horuspay.africa — le
// mode test/réel se détermine par le TYPE de clé utilisée (visible sur le
// tableau de bord HorusPay), pas par l'adresse. (Leur documentation mentionne
// par erreur "sandbox-api.horuspay.com", une adresse qui n'appartient même
// pas à HorusPay — confirmé en testant directement.)
//
// Montants : leur documentation parle d'« unités mineures » (× 100), mais un
// vrai test (confirmé visuellement sur la page de paiement HorusPay, qui
// affichait 100 000 F pour une livraison à 1 000 F) a montré que ce n'est PAS
// le cas pour le XOF — le montant s'envoie tel quel, sans conversion.
//
// Vérification de signature des webhooks : volontairement NON implémentée
// ici. Ce n'est pas un relâchement de la sécurité — dans cette architecture,
// paymentCore ne fait JAMAIS confiance au contenu d'un webhook de toute
// façon : il s'en sert uniquement comme signal "va vérifier maintenant",
// puis revérifie indépendamment via verifyTransaction (un appel direct à
// HorusPay). Un faux webhook ne peut donc, au pire, que déclencher une
// vérification inutile — jamais débloquer un paiement non confirmé.

const BASE_URL = 'https://api.horuspay.africa';

const STATUS_MAP = {
  approved: 'paid',
  transferred: 'paid',
  declined: 'failed',
  canceled: 'failed',
  expired: 'failed',
  refunded: 'failed', // remboursé : ne doit plus compter comme payé chez nous
  pending: 'pending',
  create: 'pending', // statut initial réel observé (la documentation HorusPay annonce "pending", la vraie API renvoie "create")
};

function syntheticEmail(phone) {
  const digits = String(phone || '').replace(/\D/g, '') || 'client';
  return digits + '@client.jelivre.africa';
}

module.exports = function createHorusPayProvider({ token }) {
  async function apiCall(path, { method = 'GET', body } = {}) {
    if (!token) throw new Error('HORUSPAY_SECRET_KEY manquant.');
    let res;
    try {
      res = await fetch(BASE_URL + path, {
        method,
        headers: {
          Authorization: 'Bearer ' + token,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (e) {
      throw new Error('HorusPay injoignable : ' + e.message);
    }
    let json;
    try {
      json = await res.json();
    } catch (e) {
      throw new Error('Réponse HorusPay illisible (HTTP ' + res.status + ').');
    }
    if (!res.ok) {
      // Détail complet (code HTTP + corps exact renvoyé par HorusPay) gardé
      // dans le message — il atterrit directement dans payments/<txId>/error,
      // visible depuis Firebase, pour diagnostiquer sans fouiller les journaux.
      const detail = (json && JSON.stringify(json)) || '(réponse vide)';
      throw new Error('HTTP ' + res.status + ' — ' + detail);
    }
    return json;
  }

  return {
    name: 'horuspay',

    async createCheckout({ txId, amount, currency, customer, returnUrl }) {
      const createData = await apiCall('/accounts/transactions', {
        method: 'POST',
        body: {
          amount: Math.round(amount), // XOF : envoyé tel quel, pas de conversion (voir note en tête de fichier)
          currency,
          callback_url: returnUrl,
          // Deux façons redondantes de retrouver NOTRE identifiant de paiement
          // plus tard (dans le webhook) : HorusPay promet explicitement que
          // merchant_reference sert à ça.
          merchant_reference: txId,
          custom_metadata: { txId },
          // HorusPay exige en pratique firstname/lastname/email (malgré leur
          // documentation qui les présente comme facultatifs) — l'app Je
          // Livre ne les demande jamais aux clients, donc on génère ici de
          // quoi satisfaire leur validation, sans jamais prétendre connaître
          // la vraie identité du client.
          customer: {
            country_code: 'BF',
            firstname: 'Client',
            lastname: 'Je Livre',
            email: syntheticEmail(customer && customer.phone),
            phone: customer && customer.phone ? { number: customer.phone, country: 'bf' } : undefined,
          },
        },
      });
      // La vraie réponse enveloppe tout dans "transaction" (contrairement à
      // la documentation HorusPay, qui montre un objet à plat) — on lit à
      // l'intérieur si c'est le cas, sinon on suppose un objet déjà à plat.
      const created = (createData && createData.transaction) || createData;
      if (!created || created.id == null) {
        throw new Error("Réponse HorusPay incomplète à la création (pas d'identifiant) — reçu : " + JSON.stringify(createData));
      }
      // La création seule ne fournit PAS de lien de paiement (malgré ce que
      // dit leur documentation) : un second appel est nécessaire pour
      // réellement l'obtenir.
      const tokenData = await apiCall('/accounts/transactions/' + created.id + '/generate_token', { method: 'POST' });
      const t = (tokenData && tokenData.transaction) || tokenData;
      if (!t || !t.payment_url) {
        throw new Error('Réponse HorusPay incomplète (génération du lien de paiement) — reçu : ' + JSON.stringify(tokenData));
      }
      return { paymentUrl: t.payment_url, providerRef: String(created.id) };
    },

    // Ne fait JAMAIS confiance au contenu du webhook : redemande toujours
    // l'état réel directement à HorusPay, par un appel serveur à serveur.
    async verifyTransaction({ providerRef }) {
      if (!providerRef) return { status: 'pending' };
      const data = await apiCall('/accounts/transactions/' + providerRef);
      const t = (data && data.transaction) || data;
      const status = STATUS_MAP[t.status] || 'pending';
      return {
        status,
        amount: typeof t.amount === 'number' ? t.amount : undefined,
        currency: t.currency,
      };
    },

    // Extrait NOTRE identifiant de paiement du contenu envoyé par HorusPay
    // (le corps est la transaction elle-même, sérialisée en JSON).
    // Observé en pratique : merchant_reference n'apparaît pas du tout dans la
    // transaction renvoyée (malgré la documentation) ; custom_metadata, lui,
    // revient bien, mais avec ses clés renommées en snake_case ("txId" devient
    // "tx_id") — on vérifie donc les deux formes, par prudence.
    parseWebhook(req) {
      const body = req.body || {};
      const meta = body.custom_metadata || {};
      const txId = body.merchant_reference || meta.tx_id || meta.txId;
      return { txId };
    },

    // Virement sortant (argent envoyé vers le Mobile Money d'un livreur).
    // Même schéma en deux appels que pour les collectes (créer, puis
    // déclencher) — et par prudence, on applique la même leçon apprise avec
    // les collectes : AUCUNE conversion ×100, même si leur documentation
    // utilise la même formulation ambiguë (« plus petite unité monétaire »)
    // qui s'est révélée fausse pour le XOF à l'usage. À reconfirmer avec un
    // tout petit retrait réel avant de faire confiance à grande échelle.
    async createPayout({ amount, currency, mode, phone, holderName }) {
      const parts = String(holderName || '').trim().split(/\s+/).filter(Boolean);
      const firstname = parts[0] || 'Livreur';
      const lastname = parts.slice(1).join(' ') || (parts[0] ? '-' : 'Je Livre');
      const createData = await apiCall('/accounts/payouts', {
        method: 'POST',
        body: {
          amount: Math.round(amount),
          currency,
          mode,
          customer: {
            firstname,
            lastname,
            email: syntheticEmail(phone),
            country_code: 'BF',
            phone: { number: phone, country: 'bf', network: mode },
          },
        },
      });
      // Leur documentation enveloppe la réponse dans "data" ici (pas
      // "transaction" comme pour les collectes) — on reste défensif, comme
      // partout ailleurs dans ce fichier, au cas où la réalité diffère encore.
      const created = (createData && createData.data) || createData;
      if (!created || created.id == null) {
        throw new Error('Réponse HorusPay incomplète à la création du virement — reçu : ' + JSON.stringify(createData));
      }
      const execData = await apiCall('/accounts/payouts/' + created.id + '/execute', { method: 'POST' });
      const executed = (execData && execData.data) || execData || {};
      return {
        payoutId: String(created.id),
        status: executed.status || created.status || 'processing',
        fees: typeof created.fees === 'number' ? created.fees : 0,
        netAmount: typeof created.net_amount === 'number' ? created.net_amount : amount,
      };
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
      console.error('[sms] échec réel du prestataire :', e && e.message);
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

// ---------- lib/accountCore.js (suppression de compte) ----------
__define('accountCore', function (module, exports, require) {
'use strict';
// Suppression d'un compte Je Livre (exigence Google Play + droit de suppression).
// Principe : (1) on refuse si la personne a de l'argent ou une obligation en cours,
// (2) on supprime ses données personnelles, (3) on ANONYMISE les enregistrements
// comptables conservés (commandes, livraisons, paiements, retraits), (4) on supprime
// le compte de connexion EN DERNIER (si ça échoue, la personne peut réessayer).

class AccountError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

const ACTIVE_STATUSES = ['pending', 'awaiting_payment', 'assigned', 'pending_delivery'];
const PII_KEYS = ['clientName', 'clientPhone', 'clientAddress', 'clientCoords', 'phone', 'payerPhone', 'momoPhone', 'msisdn',
  'address', 'deliveryAddress', 'senderPhone', 'senderAddress', 'senderCoords', 'recipientPhone', 'recipientAddress',
  'recipientCoords', 'driverName', 'driverPhone', 'shopPhone', 'name', 'fullName', 'email', 'coords', 'description'];
// collection -> champs qui rattachent un enregistrement à une personne
const OWNER_FIELDS = {
  deliveryRequests: ['clientUid', 'assignedDriverId'],
  marketplaceOrders: ['clientUid', 'shopId', 'assignedDriverId', 'driverId'],
  payments: ['clientUid', 'driverId'],
  withdrawalRequests: ['clientUid', 'shopId', 'driverId'],
  commissionPayments: ['driverId'],
  remittances: ['driverId'],
};
const FULL_UNLINK = ['clientUid', 'uid']; // champs qu'on efface complètement
const MARK = 'compte-supprime';
const PROFILE_NODES = ['users', 'shops', 'drivers', 'enterprises'];
const money = (v) => (typeof v === 'number' && isFinite(v) ? v : 0);

function createAccountCore({ db, auth, now }) {
  now = now || (() => Date.now());
  const val = async (path) => (await db.ref(path).once('value')).val();
  const byChild = async (path, field, v) => (await db.ref(path).orderByChild(field).equalTo(v).once('value')).val() || {};

  async function findBlockers(uid, profiles) {
    const reasons = [];
    const fmt = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '\u00A0') + '\u00A0F';
    for (const node of PROFILE_NODES) {
      const p = profiles[node];
      if (!p) continue;
      if (money(p.referralBalance) > 0) reasons.push('Votre solde de parrainage est de ' + fmt(p.referralBalance) + '. Demandez d\'abord un retrait, ou contactez-nous.');
      if (money(p.earningsBalance) > 0) reasons.push('Il vous reste ' + fmt(p.earningsBalance) + ' de gains à retirer.');
      if (money(p.pendingCommission) > 0) reasons.push('Vous avez une commission de ' + fmt(p.pendingCommission) + ' à régler.');
    }
    const wallet = await val('driverWallets/' + uid);
    if (wallet && money(wallet.commissionBalance) > 0) reasons.push('Votre solde de commission est de ' + fmt(wallet.commissionBalance) + '. Contactez-nous pour le récupérer avant de supprimer votre compte.');
    // retraits en attente
    for (const f of ['clientUid', 'shopId', 'driverId']) {
      const w = await byChild('withdrawalRequests', f, uid);
      if (Object.values(w).some((x) => x && x.status === 'pending')) { reasons.push('Une demande de retrait est en attente de traitement.'); break; }
    }
    // livraisons / commandes en cours
    let active = false;
    for (const [coll, fields] of [['deliveryRequests', ['clientUid', 'assignedDriverId']], ['marketplaceOrders', ['clientUid', 'shopId', 'assignedDriverId', 'driverId']]]) {
      for (const f of fields) {
        const r = await byChild(coll, f, uid);
        if (Object.values(r).some((x) => x && ACTIVE_STATUSES.indexOf(x.status) !== -1)) { active = true; break; }
      }
      if (active) break;
    }
    if (active) reasons.push('Vous avez une livraison ou une commande en cours. Attendez qu\'elle soit terminée.');
    // entreprise : flotte
    if (profiles.enterprises) {
      const fleet = await byChild('drivers', 'enterpriseId', uid);
      if (Object.keys(fleet).length > 0) reasons.push('Votre entreprise a encore des livreurs dans sa flotte. Contactez-nous pour les transférer ou les retirer.');
    }
    return reasons;
  }

  async function deleteAccount({ uid, confirm }) {
    if (!uid || typeof uid !== 'string') throw new AccountError('unauthenticated', 'Connectez-vous pour supprimer votre compte.');
    if (confirm !== 'SUPPRIMER') throw new AccountError('invalid-argument', 'Confirmation manquante : écrivez SUPPRIMER.');
    if (await val('adminUsers/' + uid)) throw new AccountError('permission-denied', 'Un compte administrateur ne peut pas être supprimé depuis l\'application.');

    const profiles = {};
    for (const node of PROFILE_NODES) profiles[node] = await val(node + '/' + uid);

    const reasons = await findBlockers(uid, profiles);
    if (reasons.length) throw new AccountError('failed-precondition', 'Suppression impossible pour le moment : ' + reasons.join(' '));

    const upd = {};
    const removed = { profils: 0, produits: 0, reels: 0, commentaires: 0, enregistrements_anonymises: 0 };

    // 1) profils et nœuds rattachés à la personne
    for (const node of PROFILE_NODES) if (profiles[node]) { upd[node + '/' + uid] = null; removed.profils++; }
    for (const node of ['registrations', 'userAffinity', 'reelLikes', 'driverWallets', 'driverPublic', 'blocks', 'termsAcceptances', 'referrals']) upd[node + '/' + uid] = null;

    // 2) codes de parrainage, liste du parrain, ticket du service client
    for (const node of PROFILE_NODES) {
      const p = profiles[node]; if (!p) continue;
      if (typeof p.referralCode === 'string' && p.referralCode) {
        const owner = await val('referralCodes/' + p.referralCode);
        if (owner === uid) upd['referralCodes/' + p.referralCode] = null;
      }
      if (typeof p.referredBy === 'string' && p.referredBy) upd['referrals/' + p.referredBy + '/' + uid] = null;
      if (typeof p.supportTicketId === 'string' && p.supportTicketId) upd['supportTickets/' + p.supportTicketId] = null;
    }

    // 3) contenus publiés : produits, Reels (et leurs commentaires / stats)
    const products = await byChild('products', 'shopId', uid);
    for (const id of Object.keys(products)) { upd['products/' + id] = null; removed.produits++; }
    const reels = await byChild('reels', 'shopId', uid);
    for (const id of Object.keys(reels)) { upd['reels/' + id] = null; upd['reelComments/' + id] = null; upd['reelStats/' + id] = null; removed.reels++; }

    // 4) commentaires écrits par la personne sous les Reels des autres
    const allComments = (await val('reelComments')) || {};
    for (const [reelId, byId] of Object.entries(allComments)) {
      if (reels[reelId]) continue;
      for (const [cid, c] of Object.entries(byId || {})) if (c && c.uid === uid) { upd['reelComments/' + reelId + '/' + cid] = null; removed.commentaires++; }
    }

    // 5) enregistrements conservés (comptabilité) : on efface les données personnelles
    const touched = new Set();
    for (const [coll, fields] of Object.entries(OWNER_FIELDS)) {
      for (const f of fields) {
        const recs = await byChild(coll, f, uid);
        for (const [id, rec] of Object.entries(recs)) {
          if (!rec) continue;
          const key = coll + '/' + id;
          if (!touched.has(key)) { touched.add(key); removed.enregistrements_anonymises++; }
          for (const k of PII_KEYS) if (rec[k] !== undefined && rec[k] !== null) upd[key + '/' + k] = null;
          if (typeof rec.shopName === 'string' && rec.shopName.indexOf('Parrainage') === 0) upd[key + '/shopName'] = 'Parrainage — compte supprimé';
          if (FULL_UNLINK.indexOf(f) !== -1) upd[key + '/' + f] = null;
          else upd[key + '/' + f] = MARK;
          upd[key + '/anonymizedAt'] = now();
        }
      }
    }

    if (Object.keys(upd).length) await db.ref().update(upd);

    // 6) le compte de connexion, en dernier
    try { await auth.deleteUser(uid); }
    catch (e) { if (!(e && e.code === 'auth/user-not-found')) throw new AccountError('internal', 'Vos données sont supprimées mais la fermeture du compte a échoué. Réessayez dans un instant.'); }
    return { ok: true, removed };
  }

  return { deleteAccount, findBlockers };
}

module.exports = { createAccountCore, AccountError, ACTIVE_STATUSES, PII_KEYS };
});

// ---------- lib/accountHandlers.js ----------
__define('accountHandlers', function (module, exports, require) {
'use strict';

const { getAdmin } = require('firebaseAdmin');
const { createAccountCore, AccountError } = require('accountCore');

function getAccountCore() {
  const admin = getAdmin();
  return { core: createAccountCore({ db: admin.database(), auth: admin.auth() }) };
}

function makeDeleteAccount({ getCore, HttpsError }) {
  return async (request) => {
    try {
      const { core } = getCore();
      return await core.deleteAccount({ uid: request.auth && request.auth.uid, confirm: request.data && request.data.confirm });
    } catch (e) {
      if (e instanceof AccountError) throw new HttpsError(e.code, e.message);
      console.error('[suppression de compte] erreur inattendue', e);
      throw new HttpsError('internal', 'Erreur interne. Réessayez dans un instant.');
    }
  };
}

module.exports = { getAccountCore, makeDeleteAccount };
});



// ---------- lib/statsCore.js (chiffres d'ensemble de l'admin) ----------
__define('statsCore', function (module, exports, require) {
'use strict';
// Chiffres d'ensemble pour le tableau de bord admin (réservé au super admin).
// Tout est calculé côté serveur : le navigateur de l'admin n'a pas le droit de lire
// la liste des clients, et les montants ne doivent pas être visibles du service client.

class StatsError extends Error { constructor(code, message) { super(message); this.code = code; } }

const DAY = 86400000;
const num = (v) => (typeof v === 'number' && isFinite(v) ? v : 0);
const sumField = (obj, f) => Object.values(obj || {}).reduce((t, x) => t + (x && typeof x === 'object' ? num(x[f]) : 0), 0);
const count = (obj) => Object.keys(obj || {}).length;

function createStatsCore({ db, auth, now, maxAuthPages }) {
  now = now || (() => Date.now());
  maxAuthPages = maxAuthPages || 50;
  const val = async (p) => (await db.ref(p).once('value')).val();
  let cache = null;

  async function requireSuperAdmin(uid) {
    if (!uid) throw new StatsError('unauthenticated', 'Connexion requise.');
    const a = await val('adminUsers/' + uid);
    const roles = a ? (Array.isArray(a.roles) ? a.roles : (a.role ? [a.role] : [])) : [];
    if (roles.indexOf('super_admin') === -1) throw new StatsError('permission-denied', 'Ces chiffres sont réservés au super admin.');
  }

  async function authStats(t) {
    const out = { accountsTotal: 0, createdLast7d: 0, createdLast30d: 0, activeLast24h: 0, activeLast7d: 0, activeLast30d: 0, truncated: false };
    let token, pages = 0;
    do {
      const page = await auth.listUsers(1000, token);
      for (const u of page.users || []) {
        out.accountsTotal++;
        const m = u.metadata || {};
        const created = Date.parse(m.creationTime || ''), seen = Date.parse(m.lastRefreshTime || m.lastSignInTime || '');
        if (created && t - created <= 7 * DAY) out.createdLast7d++;
        if (created && t - created <= 30 * DAY) out.createdLast30d++;
        if (seen) { const age = t - seen; if (age <= DAY) out.activeLast24h++; if (age <= 7 * DAY) out.activeLast7d++; if (age <= 30 * DAY) out.activeLast30d++; }
      }
      token = page.pageToken; pages++;
    } while (token && pages < maxAuthPages);
    if (token) out.truncated = true;
    return out;
  }

  async function getStats({ uid }) {
    await requireSuperAdmin(uid);
    const t = now();
    if (cache && t - cache.at < 15000) return cache.data;
    const [users, shops, drivers, enterprises, payments, withdrawals, ps, wallets, authS] = await Promise.all([
      val('users'), val('shops'), val('drivers'), val('enterprises'), val('payments'), val('withdrawalRequests'), val('platformStats'), val('driverWallets'), authStats(t),
    ]);
    // ---- personnes
    const people = Object.assign({ clients: count(users), shops: { total: count(shops), approved: Object.values(shops || {}).filter((s) => s && s.approved === true).length },
      drivers: count(drivers), enterprises: { total: count(enterprises), approved: Object.values(enterprises || {}).filter((e) => e && e.approved === true).length } }, authS);
    // ---- argent reçu en ligne (brut : inclut l'argent qui sera reversé à d'autres)
    const byKind = { delivery: 0, marketplaceOrders: 0, commissionTopup: 0, other: 0 };
    let paidTotal = 0, paid30 = 0, paidCount = 0;
    for (const p of Object.values(payments || {})) {
      if (!p || p.status !== 'paid') continue;
      const a = num(p.amount); paidTotal += a; paidCount++;
      if (t - num(p.createdAt) <= 30 * DAY) paid30 += a;
      if (Object.prototype.hasOwnProperty.call(byKind, p.kind)) byKind[p.kind] += a; else byKind.other += a;
    }
    // ---- revenu de la plateforme (compteurs cumulés)
    const s = ps || {};
    const simple = num(s.commissionSimple), flat = num(s.commissionFlat), referralPayouts = num(s.referralPayouts);
    // Les commissions payées avec le solde du livreur (ou par Mobile Money via le solde) sont un REVENU :
    // le compteur « commissionFromBalance » les suit depuis le début.
    const fromWallet = num(s.commissionFromBalance);
    const net = simple + flat + fromWallet - referralPayouts;
    // Argent des livreurs que nous détenons : somme exacte des soldes (et non un calcul approximatif).
    const driverGuarantees = sumField(wallets, 'commissionBalance');
    const receivable = sumField(drivers, 'pendingCommission');
    // ---- argent détenu pour d'autres (ne vous appartient pas)
    const referralBalances = sumField(users, 'referralBalance') + sumField(shops, 'referralBalance') + sumField(drivers, 'referralBalance');
    const pendingWithdrawals = Object.values(withdrawals || {}).filter((w) => w && w.status === 'pending').reduce((x, w) => x + num(w.amount), 0);
    const owed = { driverGuarantees, referralBalances, pendingWithdrawals };
    const data = {
      generatedAt: t, people,
      money: {
        onlinePaid: { total: paidTotal, last30d: paid30, count: paidCount, byKind },
        platform: { commissionSimple: simple, commissionFlat: flat, commissionFromWallet: fromWallet, referralPayouts, net, receivableFromDrivers: receivable },
        owedToOthers: Object.assign({ total: driverGuarantees + referralBalances + pendingWithdrawals }, owed),
      },
    };
    cache = { at: t, data };
    return data;
  }
  return { getStats };
}

module.exports = { createStatsCore, StatsError };
});

// ---------- lib/statsHandlers.js ----------
__define('statsHandlers', function (module, exports, require) {
'use strict';

const { getAdmin } = require('firebaseAdmin');
const { createStatsCore, StatsError } = require('statsCore');

function getStatsCore() {
  const admin = getAdmin();
  return { core: createStatsCore({ db: admin.database(), auth: admin.auth() }) };
}

// Le cache de 15 s vit dans le cœur : on garde donc UNE instance par processus.
let cached = null;
function getStatsCoreCached() { if (!cached) cached = getStatsCore(); return cached; }

function makeAdminStats({ getCore, HttpsError }) {
  return async (request) => {
    try {
      const { core } = getCore();
      return await core.getStats({ uid: request.auth && request.auth.uid });
    } catch (e) {
      if (e instanceof StatsError) throw new HttpsError(e.code, e.message);
      console.error('[statistiques] erreur inattendue', e);
      throw new HttpsError('internal', 'Erreur interne. Réessayez dans un instant.');
    }
  };
}

module.exports = { getStatsCore: getStatsCoreCached, makeAdminStats };
});


// ---------- link/linkHandlers.js : un compte livreur / boutique / entreprise peut aussi commander ----------
__define('linkHandlers', function (module, exports, require) {
'use strict';

const { getAdmin } = require('firebaseAdmin');

class LinkError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

// Un compte professionnel dont le téléphone a déjà été vérifié par SMS (claim phoneVerified) devient
// aussi un compte client, SANS nouveau SMS : même identifiant (uid), les informations du profil
// (nom, téléphone) sont recopiées dans users/<uid>. Le serveur renvoie un jeton de connexion pour
// ce même uid ; il ne crée donc jamais un compte sur un numéro que la personne n'a pas vérifié.
function createLinkCore({ db, auth, now, randomInt }) {
  const clock = now || Date.now;
  const rnd = randomInt || ((n) => Math.floor(Math.random() * n));
  async function val(path) { return (await db.ref(path).once('value')).val(); }

  async function uniqueCode(uid) {
    for (let i = 0; i < 12; i++) {
      let code = '';
      for (let k = 0; k < 6; k++) code += CODE_CHARS[rnd(CODE_CHARS.length)];
      const r = await db.ref('referralCodes/' + code).transaction((cur) => (cur === null || cur === undefined ? uid : undefined));
      if (r && r.committed) return code;
    }
    throw new LinkError('internal', 'Impossible de créer votre compte client pour le moment. Réessayez.');
  }

  async function linkClientAccount({ uid }) {
    if (!uid || typeof uid !== 'string') throw new LinkError('unauthenticated', 'Connexion requise.');
    if (await val('adminUsers/' + uid)) throw new LinkError('permission-denied', 'Un compte administrateur ne peut pas passer commande.');
    const [driver, shop, ent] = await Promise.all([val('drivers/' + uid), val('shops/' + uid), val('enterprises/' + uid)]);
    const kind = driver ? 'driver' : (shop ? 'shop' : (ent ? 'enterprise' : null));
    const prof = driver || shop || ent;
    if (!prof) throw new LinkError('failed-precondition', 'Aucun compte livreur, boutique ou entreprise trouvé pour cet identifiant.');
    let user;
    try { user = await auth.getUser(uid); } catch (e) { throw new LinkError('not-found', 'Compte introuvable.'); }
    if (user.disabled) throw new LinkError('permission-denied', 'Ce compte est désactivé.');
    if (!(user.customClaims && user.customClaims.phoneVerified)) throw new LinkError('failed-precondition', "Votre numéro n'est pas encore vérifié.");
    if (await val('bans/' + uid)) throw new LinkError('permission-denied', 'Ce compte est suspendu.');
    const phone = String(prof.phone || '').slice(0, 30);
    if (!phone) throw new LinkError('failed-precondition', 'Aucun numéro de téléphone sur votre compte.');
    const name = String(prof.name || 'Utilisateur Je Livre').slice(0, 80);

    const existing = await val('users/' + uid);
    let created = false;
    if (!existing) {
      const referralCode = await uniqueCode(uid);
      await db.ref('users/' + uid).set({ name, phone, referralCode, linkedFrom: kind, createdAt: clock() });
      created = true;
    }
    const token = await auth.createCustomToken(uid);
    return { ok: true, token, created, linkedFrom: kind };
  }

  return { linkClientAccount };
}

function getLinkCore() {
  const admin = getAdmin();
  return { core: createLinkCore({ db: admin.database(), auth: admin.auth() }) };
}

function makeLinkClientAccount({ getCore, HttpsError }) {
  return async (request) => {
    try {
      const { core } = getCore();
      return await core.linkClientAccount({ uid: request.auth && request.auth.uid });
    } catch (e) {
      if (e instanceof LinkError) throw new HttpsError(e.code, e.message);
      console.error('[liaison de compte] erreur inattendue', e);
      throw new HttpsError('internal', 'Erreur interne. Réessayez dans un instant.');
    }
  };
}

module.exports = { createLinkCore, LinkError, getLinkCore, makeLinkClientAccount };

});

// ---------- handover.js : codes de remise (récupération / livraison) ----------
__define('handoverHandlers', function (module, exports, require) {
'use strict';

const { getAdmin } = require('firebaseAdmin');

class HandoverError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

const MAX_TRIES = 5;
const ID_RE = /^[-A-Za-z0-9_]{1,60}$/;

// Deux codes à 4 chiffres par livraison, générés et gardés par le serveur (jamais lisibles par le livreur) :
//   - code de récupération : connu de celui qui a fait la demande ; le livreur le reçoit en main propre au moment de prendre le colis ;
//   - code de livraison    : celui qui a fait la demande le transmet au destinataire, qui le donne au livreur à la remise.
// Seul le serveur marque le colis comme récupéré / livré, quand le bon code est saisi par le livreur assigné.
function createHandoverCore({ db, now, randomInt, notify }) {
  const clock = now || Date.now;
  const rnd = randomInt || ((n) => require('crypto').randomInt(n));
  const val = async (p) => (await db.ref(p).once('value')).val();
  const newCode = () => String(rnd(10000)).padStart(4, '0');

  // kind 'order' : commande boutique (code de récupération donné par la boutique, code de remise donné par le client).
  const colOf = (kind) => (kind === 'order' ? 'marketplaceOrders' : 'deliveryRequests');
  async function loadRequest(requestId, kind) {
    if (typeof requestId !== 'string' || !ID_RE.test(requestId)) throw new HandoverError('invalid-argument', 'Livraison invalide.');
    const r = await val(colOf(kind) + '/' + requestId);
    if (!r) throw new HandoverError('not-found', 'Livraison introuvable.');
    if (r.handover !== true) throw new HandoverError('failed-precondition', "Cette livraison n'utilise pas les codes de remise.");
    return r;
  }

  async function ensureCodes(requestId, clientUid) {
    const ref = db.ref('deliveryCodes/' + requestId);
    await ref.transaction((cur) => (cur ? undefined : { pickup: newCode(), delivery: newCode(), pickupTries: 0, deliveryTries: 0, clientUid, createdAt: clock() }));
    return (await ref.once('value')).val();
  }

  // Pour celui qui a fait la demande : ses deux codes.
  async function getHandoverCodes({ uid, requestId, kind }) {
    if (!uid) throw new HandoverError('unauthenticated', 'Connexion requise.');
    const r = await loadRequest(requestId, kind);
    if (kind === 'order') {
      const isShop = r.shopId === uid, isClient = r.clientUid === uid;
      if (!isShop && !isClient) throw new HandoverError('permission-denied', "Cette commande ne vous appartient pas.");
      const oc = await ensureCodes(requestId, r.clientUid);
      const out = { role: isShop ? 'shop' : 'client', pickedUp: !!r.pickedUpAt, completed: ['delivered', 'awaiting_payment', 'completed'].includes(r.status) };
      if (isShop) out.pickup = oc.pickup;
      if (isClient) out.delivery = oc.delivery;
      return out;
    }
    if (r.clientUid !== uid) throw new HandoverError('permission-denied', "Cette livraison ne vous appartient pas.");
    const codes = await ensureCodes(requestId, r.clientUid);
    return { pickup: codes.pickup, delivery: codes.delivery, hasRecipient: !!r.recipientCoords, pickedUp: !!r.pickedUpAt, completed: r.status === 'completed' };
  }

  // Pour le livreur assigné : valide la récupération ('pickup') ou la remise au destinataire ('delivery').
  async function confirmHandover({ uid, requestId, step, code, kind }) {
    if (!uid) throw new HandoverError('unauthenticated', 'Connexion requise.');
    if (step !== 'pickup' && step !== 'delivery') throw new HandoverError('invalid-argument', 'Étape invalide.');
    const entered = String(code == null ? '' : code).trim();
    if (!/^[0-9]{4}$/.test(entered)) throw new HandoverError('invalid-argument', 'Entrez le code à 4 chiffres.');
    const r = await loadRequest(requestId, kind);
    if (r.assignedDriverId !== uid) throw new HandoverError('permission-denied', "Cette livraison ne vous est pas assignée.");
    const isOrder = kind === 'order';
    if (isOrder && ['delivered', 'awaiting_payment', 'completed'].includes(r.status)) return { ok: true, already: true, step, completed: true, status: r.status };
    if (r.status === 'completed') return { ok: true, already: true, step, completed: true };
    if (r.status !== 'assigned') throw new HandoverError('failed-precondition', "Cette livraison n'est plus en cours.");
    const codes = await ensureCodes(requestId, r.clientUid);
    const triesKey = step === 'pickup' ? 'pickupTries' : 'deliveryTries';
    if (step === 'pickup' && r.pickedUpAt) return { ok: true, already: true, step, completed: false };
    if (step === 'delivery' && !r.pickedUpAt) throw new HandoverError('failed-precondition', "Validez d'abord la récupération du colis.");
    if ((codes[triesKey] || 0) >= MAX_TRIES) throw new HandoverError('resource-exhausted', 'Trop de codes erronés. Contactez le service client.');
    if (entered !== String(codes[step])) {
      const tr = await db.ref('deliveryCodes/' + requestId + '/' + triesKey).transaction((c) => (c || 0) + 1);
      const used = (tr && tr.snapshot && tr.snapshot.val()) || 1;
      const left = Math.max(0, MAX_TRIES - used);
      throw new HandoverError('permission-denied', 'Code incorrect. ' + (left > 0 ? 'Il vous reste ' + left + ' essai(s).' : 'Plus aucun essai : contactez le service client.'));
    }
    const t = clock();
    const updates = {};
    const base = colOf(kind) + '/' + requestId + '/';
    let completed = false;
    let newStatus = 'completed';
    if (step === 'pickup') {
      updates[base + 'pickedUpAt'] = t;
      if (!isOrder && !r.recipientCoords) { completed = true; } // pas de destinataire (ex. collecte groupée) : la récupération termine la course
    } else {
      completed = true;
    }
    if (isOrder) {
      // Commande boutique : le serveur la passe en « livrée » (le client confirme la réception ensuite),
      // ou en « attente de paiement » si le client règle à la remise.
      newStatus = (r.paymentMethod === 'pay_on_delivery' && r.paymentStatus !== 'paid') ? 'awaiting_payment' : 'delivered';
      if (completed) { updates[base + 'status'] = newStatus; updates[base + 'deliveredAt'] = t; }
    } else if (completed) { updates[base + 'status'] = 'completed'; updates[base + 'completedAt'] = t; updates[base + 'deliveredAt'] = t; }
    await db.ref().update(updates);
    if (notify) {
      // Best effort : une notification qui échoue ne doit jamais annuler la validation.
      try {
        const who = isOrder ? 'commande' : 'colis';
        let msg = null;
        if (step === 'pickup') msg = { title: 'Récupéré par le livreur', body: 'Votre ' + who + ' est en route.' };
        else if (isOrder && newStatus === 'awaiting_payment') msg = { title: 'Commande remise', body: 'Réglez-la maintenant dans « Mes commandes » pour terminer la livraison.' };
        else if (isOrder) msg = { title: 'Commande remise', body: 'Confirmez la réception dans « Mes commandes ».' };
        else msg = { title: 'Colis livré ✓', body: 'Votre colis a bien été remis au destinataire.' };
        await notify({ collection: 'users', uid: r.clientUid, title: msg.title, body: msg.body, data: { type: 'handover', step, id: requestId } });
      } catch (e) { console.warn('[codes de remise] notification non envoyée', e && e.message); }
    }
    return { ok: true, step, completed, status: completed ? newStatus : undefined };
  }

  return { getHandoverCodes, confirmHandover };
}

function getHandoverCore() {
  const admin = getAdmin();
  const nc = __require('notifyCore').createNotifyCore({ db: admin.database(), messaging: admin.messaging() });
  return { core: createHandoverCore({ db: admin.database(), notify: (m) => nc.sendToOne(m) }) };
}

const wrap = (fn) => ({ getCore, HttpsError }) => async (request) => {
  try {
    const { core } = getCore();
    return await fn(core, { uid: request.auth && request.auth.uid, data: request.data || {} });
  } catch (e) {
    if (e instanceof HandoverError) throw new HttpsError(e.code, e.message);
    console.error('[codes de remise] erreur inattendue', e);
    throw new HttpsError('internal', 'Erreur interne. Réessayez dans un instant.');
  }
};
const makeGetHandoverCodes = wrap((core, { uid, data }) => core.getHandoverCodes({ uid, requestId: data.orderId || data.requestId, kind: data.orderId ? 'order' : 'request' }));
const makeConfirmHandover = wrap((core, { uid, data }) => core.confirmHandover({ uid, requestId: data.orderId || data.requestId, step: data.step, code: data.code, kind: data.orderId ? 'order' : 'request' }));

module.exports = { createHandoverCore, HandoverError, getHandoverCore, makeGetHandoverCodes, makeConfirmHandover };

});


const adapter = __require('adapter');
const paymentGetCore = __require('paymentGetCore');
const paymentHandlers = __require('paymentHandlers');
const payoutHandlers = __require('payoutHandlers');
const notifyHandlers = __require('notifyHandlers');
const referralHandlers = __require('referralHandlers');
const commissionHandlers = __require('commissionHandlers');
const smsGetCore = __require('smsGetCore');
const otpHandlers = __require('otpHandlers');
const accountHandlers = __require('accountHandlers');
const statsHandlers = __require('statsHandlers');
const linkHandlers = __require('linkHandlers');
const handoverHandlers = __require('handoverHandlers');

module.exports = {
  wrapCallable: adapter.wrapCallable,
  wrapRaw: adapter.wrapRaw,
  getPaymentCore: paymentGetCore.getPaymentCore,
  makeCreatePayment: paymentHandlers.makeCreatePayment,
  makeConfirmPayment: paymentHandlers.makeConfirmPayment,
  createPaymentCore: __require("paymentCore").createPaymentCore,
  makeWebhook: paymentHandlers.makeWebhook,
  makeMockPay: paymentHandlers.makeMockPay,
  getPayoutCore: paymentGetCore.getPayoutCore,
  makeCreateDriverPayout: payoutHandlers.makeCreateDriverPayout,
  makeRequestCommissionWithdrawal: payoutHandlers.makeRequestCommissionWithdrawal,
  getNotifyCore: paymentGetCore.getNotifyCore,
  makeNotifyShopNewOrder: notifyHandlers.makeNotifyShopNewOrder,
  makeNotifyNearbyRequest: notifyHandlers.makeNotifyNearbyRequest,
  makeNotifyAssigned: notifyHandlers.makeNotifyAssigned,
  getReferralCore: paymentGetCore.getReferralCore,
  makeCreditReferral: referralHandlers.makeCreditReferral,
  makeRegisterReferral: referralHandlers.makeRegisterReferral,
  getCommissionCore: paymentGetCore.getCommissionCore,
  makePayCommissionFromBalance: commissionHandlers.makePayCommissionFromBalance,
  makeRequestReferralWithdrawal: referralHandlers.makeRequestReferralWithdrawal,
  makeDecideReferralWithdrawal: referralHandlers.makeDecideReferralWithdrawal,
  getOtpCore: smsGetCore.getOtpCore,
  makeRequestOtp: otpHandlers.makeRequestOtp,
  makeVerifyOtp: otpHandlers.makeVerifyOtp,
  makeClaimVerification: otpHandlers.makeClaimVerification,
  makeResetPassword: otpHandlers.makeResetPassword,
  getAccountCore: accountHandlers.getAccountCore,
  makeDeleteAccount: accountHandlers.makeDeleteAccount,
  getStatsCore: statsHandlers.getStatsCore,
  makeAdminStats: statsHandlers.makeAdminStats,
  getLinkCore: linkHandlers.getLinkCore,
  makeLinkClientAccount: linkHandlers.makeLinkClientAccount,
  createLinkCore: linkHandlers.createLinkCore,
  getHandoverCore: handoverHandlers.getHandoverCore,
  makeGetHandoverCodes: handoverHandlers.makeGetHandoverCodes,
  makeConfirmHandover: handoverHandlers.makeConfirmHandover,
  createNotifyCore: __require("notifyCore").createNotifyCore,
  createHandoverCore: handoverHandlers.createHandoverCore,
  makeTicket: __require('tickets').makeTicket, TICKET_RE: __require('tickets').TICKET_RE,
};