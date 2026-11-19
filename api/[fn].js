'use strict';
// Un SEUL fichier pour les neuf fonctions : parrainage, solde de commission, suppression de compte et statistiques de l'admin, retrait du solde de commission.
// Raison : l'offre gratuite (Hobby) de Vercel limite le serveur à 12 fonctions par déploiement,
// et chaque fichier du dossier api/ compte pour une fonction. Les adresses restent identiques :
// /api/creditReferral, /api/registerReferral, /api/requestReferralWithdrawal,
// /api/decideReferralWithdrawal, /api/payCommissionFromBalance, /api/deleteAccount, /api/adminStats, /api/requestCommissionWithdrawal, /api/linkClientAccount.
// Les fichiers existants (paiement, SMS, notifications...) gardent la priorité sur ce fichier.
const s = require('../shared');

const routes = {
  creditReferral: s.wrapCallable(s.makeCreditReferral, s.getReferralCore),
  registerReferral: s.wrapCallable(s.makeRegisterReferral, s.getReferralCore),
  requestReferralWithdrawal: s.wrapCallable(s.makeRequestReferralWithdrawal, s.getReferralCore),
  decideReferralWithdrawal: s.wrapCallable(s.makeDecideReferralWithdrawal, s.getReferralCore),
  payCommissionFromBalance: s.wrapCallable(s.makePayCommissionFromBalance, s.getCommissionCore),
  deleteAccount: s.wrapCallable(s.makeDeleteAccount, s.getAccountCore),
  adminStats: s.wrapCallable(s.makeAdminStats, s.getStatsCore),
  requestCommissionWithdrawal: s.wrapCallable(s.makeRequestCommissionWithdrawal, s.getPayoutCore),
  confirmPayment: s.wrapCallable(s.makeConfirmPayment, s.getPaymentCore),
  driverPayout: s.wrapCallable(s.makeCreateDriverPayout, s.getPayoutCore),
  notifyShopNewOrder: s.wrapCallable(s.makeNotifyShopNewOrder, s.getNotifyCore),
  notifyNearbyRequest: s.wrapCallable(s.makeNotifyNearbyRequest, s.getNotifyCore),
  notifyAssigned: s.wrapCallable(s.makeNotifyAssigned, s.getNotifyCore),
  handoverCodes: s.wrapCallable(s.makeGetHandoverCodes, s.getHandoverCore),
  confirmHandover: s.wrapCallable(s.makeConfirmHandover, s.getHandoverCore),
  linkClientAccount: s.wrapCallable(s.makeLinkClientAccount, s.getLinkCore),
  supabaseRole: s.wrapCallable(s.makeSupabaseRole, s.getSupabaseRoleCore),
};

module.exports = (req, res) => {
  const name = req.query && req.query.fn;
  const handler = Object.prototype.hasOwnProperty.call(routes, name) ? routes[name] : null;
  if (!handler) {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: { status: 'NOT_FOUND', message: 'Fonction inconnue.' } }));
    return;
  }
  return handler(req, res);
};
