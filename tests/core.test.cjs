const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const C=require('../src/core.js'),manifest=require('../src/manifest.json');
const clone=()=>JSON.parse(JSON.stringify(manifest));
test('SHA256 agrees with Node for empty, Unicode, long, and 1000 generated inputs',()=>{
 for(const value of ['', 'abc', 'שלום 😊','a'.repeat(2048),...Array.from({length:1000},(_,i)=>'id-'+i+'-שיער')])assert.equal(C.sha256(value),crypto.createHash('sha256').update(value).digest('hex'));
});
test('20,000 buckets match original backend formula; allocation is balanced',()=>{
 let a=0,b=0;
 for(let i=0;i<20000;i++){
  const id='lab-visitor-'+i;
  const expected=parseInt(crypto.createHash('sha256').update(`${id}:${manifest.experimentId}:${manifest.allocationVersion}`).digest('hex').slice(0,12),16)%10000;
  assert.equal(C.bucket(id,manifest.experimentId,manifest.allocationVersion),expected);if(expected<5000)a++;else b++;
 }
 assert.ok(Math.abs(a/20000-.5)<.015);console.log('ALLOCATION',JSON.stringify({a,b,sample:20000}));
});
test('sticky assignment replays exactly',()=>{const one=C.select(manifest,'lab-sticky-person',null);assert.deepEqual(C.select(manifest,'lab-sticky-person',one.assignment),one);});
test('variant array order never changes selection',()=>{for(let i=0;i<30;i++){const m=clone();m.variants.reverse();assert.equal(C.select(m,'lab-order-'+i,null).variant.key,C.select(manifest,'lab-order-'+i,null).variant.key);}});
test('weights must sum to 10000, never silently absorb missing traffic',()=>{const m=clone();m.variants[0].weightBasisPoints=4999;assert.throws(()=>C.validate(m),/10000/);});
test('negative and non-integer weights rejected',()=>{for(const n of [-1,0.5]){const m=clone();m.variants[0].weightBasisPoints=n;assert.throws(()=>C.validate(m));}});
test('duplicate variant IDs rejected',()=>{const m=clone();m.variants[1].id=m.variants[0].id;assert.throws(()=>C.validate(m),/Duplicate/);});
test('unexpected image destinations rejected',()=>{const m=clone();m.variants[1].items[0].src='https://example.com/track';assert.throws(()=>C.validate(m),/allowlist/);});
test('content edits under same allocation version cannot silently enter existing cohort',()=>{const one=C.select(manifest,'lab-content-person',null),m=clone();m.variants[1].items[0].alt='Changed';assert.throws(()=>C.select(m,'lab-content-person',one.assignment),/conflict/);});
test('stored visitor/assignment conflicts rejected',()=>{const one=C.select(manifest,'lab-person-one',null);assert.throws(()=>C.select(manifest,'lab-person-two',one.assignment),/conflict/);});
test('pause preserves original assignment but serves explicit non-experimental control',()=>{const one=C.select(manifest,'lab-paused-person',null),m=clone();m.status='PAUSED';const d=C.select(m,'lab-paused-person',one.assignment);assert.equal(d.enrolled,false);assert.equal(d.variant.key,'control');assert.deepEqual(d.assignment,one.assignment);});
test('promotion is non-experimental delivery, not a rerandomized winner sample',()=>{const m=clone();m.status='PROMOTED';const d=C.select(m,'lab-promotion-person',null);assert.equal(d.variant.key,'variant-b');assert.equal(d.enrolled,false);});
test('forced QA is not measurement-eligible',()=>{assert.equal(C.select(manifest,'lab-forced-person',null,'variant-b').enrolled,false);});
test('storage getter failures are caught before method calls',()=>{const fake={get localStorage(){throw Error('blocked');},document:{get cookie(){throw Error('blocked');},set cookie(_){throw Error('blocked');}},location:{protocol:'https:'}};const s=C.storage(fake);assert.equal(s.get('x'),null);assert.equal(s.set('x','v'),false);assert.equal(s.readCookie('x'),null);assert.equal(s.cookie('x','v'),false);});
