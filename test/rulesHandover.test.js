'use strict';
// Règles : une livraison à codes de remise ne peut pas être terminée par le livreur lui-même.
const targaryen = require('targaryen');
const assert = require('assert');
const fs = require('fs'); const path = require('path');
const rules = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'database.rules.json'), 'utf8'));
const data = {
  adminUsers: { admin1: true },
  drivers: { d1: { approved: true } },
  deliveryRequests: {
    h1: { clientUid: 'c1', assignedDriverId: 'd1', status: 'assigned', handover: true, price: 1500, paymentMethod: 'cash' },
    old1: { clientUid: 'c1', assignedDriverId: 'd1', status: 'assigned', price: 1500, paymentMethod: 'cash' },
  },
  deliveryCodes: { h1: { pickup: '1234', delivery: '5678', clientUid: 'c1' } },
};
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };
const d = targaryen.database(rules, data); const U = (uid) => ({ uid });

ok(!d.as(U('d1')).write('deliveryRequests/h1/status', 'completed').allowed, 'le livreur ne termine pas une livraison à codes');
ok(!d.as(U('d1')).write('deliveryRequests/h1', { clientUid: 'c1', assignedDriverId: 'd1', status: 'completed', price: 1500, paymentMethod: 'cash' }).allowed, 'ni en réécrivant la demande sans le drapeau');
ok(!d.as(U('d1')).write('deliveryRequests/h1/pickedUpAt', 1700000000000).allowed, 'le livreur ne marque pas « récupéré »');
ok(!d.as(U('d1')).write('deliveryRequests/h1/completedAt', 1700000000000).allowed, 'ni la date de fin');
ok(!d.as(U('c1')).write('deliveryRequests/h1/status', 'completed').allowed, 'le client non plus (la livraison se valide par les codes)');
ok(d.as(U('admin1')).write('deliveryRequests/h1/status', 'completed').allowed, "l'admin / le serveur peuvent");
ok(d.as(U('c1')).write('deliveryRequests/h1/status', 'cancelled').allowed, 'le client peut toujours annuler');
ok(d.as(U('d1')).write('deliveryRequests/old1/status', 'completed').allowed, 'ancienne livraison sans codes : comportement inchangé');
ok(!d.as(U('d1')).read('deliveryCodes/h1').allowed, 'le livreur ne lit pas les codes');
ok(!d.as(U('c1')).read('deliveryCodes/h1').allowed, 'le client les reçoit par le serveur, pas en lecture directe');
ok(!d.as(U('d1')).write('deliveryCodes/h1/pickup', '0000').allowed, 'le livreur ne modifie pas les codes');
ok(d.as(U('admin1')).read('deliveryCodes/h1').allowed, "l'admin peut lire (litiges)");
ok(!d.as(U('c9')).write('deliveryRequests/new1', { clientUid: 'c9', status: 'pending', handover: false, price: 1, paymentMethod: 'cash' }).allowed, 'handover ne peut être que vrai à la création');
ok(d.as(U('c9')).write('deliveryRequests/new2', { clientUid: 'c9', status: 'pending', handover: true, price: 1, paymentMethod: 'cash' }).allowed, 'création avec codes');
console.log('rulesHandover : ' + n + ' vérifications OK');
