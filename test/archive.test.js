'use strict';
const assert = require('assert');
const { createArchiveCore } = require('../shared');
function fakeDb(data){ return { ref: p => ({ get: async()=>({ exists:()=>{const v=p.split('/').reduce((o,k)=>o&&o[k],data);return v!=null}, val:()=>p.split('/').reduce((o,k)=>o&&o[k],data) }) }) }; }
(async()=>{
  const up=[]; const cat={ upsert: async(t,r,c)=>up.push({t,r,c}) };
  const core=createArchiveCore({ db:fakeDb({adminUsers:{A:{roles:['super_admin']}},users:{u1:{a:1},u2:{a:2}}}), catalogue:cat });
  await assert.rejects(()=>core.run('X'),/administrateurs/);
  await assert.rejects(()=>core.run(null),/Connexion/);
  const r=await core.run('A');
  assert.strictEqual(r.counts.users,2); assert.strictEqual(r.counts.drivers,0);
  assert.ok(up.find(x=>x.r[0].node==='users'&&x.c==='node,key'));
  console.log('archive.test.js OK');
})().catch(e=>{console.error(e);process.exit(1)});
