import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';

// Exercise the actual migration and workspace functions without browser-only rendering.
// Browser interaction and layout are checked separately through the Sites preview.
const source = ['app.js','enhancements.js','hooniworks.js'].map(f=>readFileSync(new URL('../dist/'+f,import.meta.url),'utf8'));
function boot(seed={}) {
  const values=new Map(Object.entries(seed)),nodes=new Map();let fail=false;
  const node=selector=>{if(!nodes.has(selector))nodes.set(selector,{value:'',innerHTML:'',textContent:'',children:[],style:{},classList:{add(){},remove(){}},focus(){}});return nodes.get(selector);};
  const ctx=vm.createContext({console,structuredClone,crypto:webcrypto,URL,Blob,TextEncoder,Uint8Array,DataView,setTimeout:()=>0,clearTimeout(){},setInterval:()=>0,clearInterval(){},location:{hash:''},navigator:{},window:{addEventListener(){},scrollTo(){}},document:{querySelector:node,addEventListener(){},body:{style:{}},activeElement:null},localStorage:{getItem:k=>values.get(k)||null,setItem:(k,v)=>{if(fail)throw Error('quota');values.set(k,v);}}});
  for(let i=0;i<source.length;i++)vm.runInContext(i===2?source[i].replace('render();restoreAssets();\nif(storageWarning)toast(storageWarning);',''):source[i],ctx);
  vm.runInContext('render=()=>{};fillCanvases=()=>{};restoreAssets=()=>{};',ctx);
  return {run:s=>vm.runInContext(s,ctx),node,values,fail:v=>fail=v};
}
const first=boot();
assert.equal(first.run('works.workspaces.length'),1);
assert.equal(first.run('data.id'),'brand-120pie');
assert.equal(first.run('allAssets().length'),4);
const legacy=first.run('JSON.stringify({...data,brand:{...data.brand,name:"120 custom"},uploads:[{id:"old-photo",name:"Original",img:"legacy-preview",original:true,role:"product"}],templates:[{id:"saved-layout",custom:true}],posts:[{campaignId:"sample-1",channel:"instagram",status:"prepared"}]})');
const migrated=boot({'120studio-design-v1':legacy});
assert.equal(migrated.run('data.brand.name'),'120 custom');
assert.equal(migrated.run('allAssets().some(a=>a.id==="old-photo")'),true);
assert.equal(migrated.run('data.templates[0].id'),'saved-layout');
assert.equal(migrated.run('data.posts.length'),1);
assert.equal(migrated.values.get('120studio-design-v1'),legacy,'legacy backup must remain unchanged');
function add(b,name='Service B'){
  for(const [selector,value] of Object.entries({'#workspace-name':name,'#workspace-category':'멤버십·구독','#workspace-color':'#7661dc','#workspace-audience':'Service customers','#workspace-description':'A service workspace'}))b.node(selector).value=value;
  b.run('createProduct()');
}
add(migrated);
const id=migrated.run('data.id');
assert.notEqual(id,'brand-120pie');
assert.equal(migrated.run('data.campaigns.length+data.templates.length+data.uploads.length+data.posts.length'),0);
assert.equal(migrated.run('allAssets().length'),0);
assert.equal(migrated.run('prod().placeholder'),true);
assert.equal(migrated.run('Object.values(data.brand.links).every(v=>v==="")'),true);
assert.equal(migrated.run('allTemplates().some(t=>/120|커피|파이|카페|샵인샵/.test(t.name+t.subtitle))'),false);
migrated.run('wizardDraft={name:"New service",audience:"consumer",topic:"Service features",channels:["instagram","blog"]}');
migrated.node('#new-product').value='primary';migrated.node('#new-design-mode').value='creative';
migrated.run('createCampaign()');
assert.equal(migrated.run('campaign().workspaceId'),id);
assert.equal(migrated.run('campaign().designMode'),'creative');
assert.equal(migrated.run('/120|파이|카페/.test(JSON.stringify(campaign()))'),false);
migrated.run('data.brand.links.instagram="https://www.instagram.com/service_b/";data.templates.push({id:"service-layout",custom:true});data.uploads.push({id:"new-photo",name:"Service photo",img:"service-img",role:"product"});data.posts.push({campaignId:campaign().id,channel:"blog",status:"prepared"});data.budget=75000;persist()');
migrated.run('switchWorkspace("brand-120pie")');
assert.equal(migrated.run('data.campaigns.length'),3);
assert.equal(migrated.run('data.brand.links.instagram'),'https://www.instagram.com/120piecoffee/');
assert.equal(migrated.run('allAssets().some(a=>a.id==="new-photo")'),false);
assert.equal(migrated.run('allTemplates().some(t=>t.id==="service-layout")'),false);
assert.equal(migrated.run('data.posts.length'),1);
assert.equal(migrated.run('data.budget'),75000,'global settings survive switching');
migrated.run(`switchWorkspace(${JSON.stringify(id)})`);
assert.equal(migrated.run('data.campaigns.length'),1);
assert.equal(migrated.run('allAssets().some(a=>a.id==="old-photo")'),false);
const reloaded=boot(Object.fromEntries(migrated.values));
assert.equal(reloaded.run('data.id'),id);
assert.equal(reloaded.run('data.campaigns.length'),1);
assert.equal(reloaded.run('data.brand.links.instagram'),'https://www.instagram.com/service_b/');
assert.equal(reloaded.run('allAssets().length'),1);
reloaded.fail(true);add(reloaded,'Failed create');
assert.equal(reloaded.run('works.workspaces.length'),2,'quota failure must not leave a new workspace');
reloaded.fail(false);reloaded.run('resetCurrentWorkspace()');
assert.equal(reloaded.run('data.campaigns.length+data.templates.length+data.uploads.length+data.posts.length'),0);
assert.equal(reloaded.run('data.brand.links.instagram'),'https://www.instagram.com/service_b/');
reloaded.run('switchWorkspace("brand-120pie")');
assert.equal(reloaded.run('data.campaigns.length'),3,'reset must not affect another workspace');
const bad=boot({'hooniworks-workspaces-v1':'invalid preserved value'});
assert.equal(bad.values.get('hooniworks-workspaces-v1'),'invalid preserved value');
assert.equal(bad.run('persist()'),false,'invalid stored content must not be overwritten');
console.log('PASS: migration, original references, workspace isolation, generic creation, shared settings, reload, reset isolation, quota rollback and corrupt-data protection.');
