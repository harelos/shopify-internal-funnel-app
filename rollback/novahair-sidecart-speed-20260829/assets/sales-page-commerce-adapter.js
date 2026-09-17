(function(global){
  'use strict';
  function rootPath(){return (global.Shopify&&global.Shopify.routes&&global.Shopify.routes.root)||'/';}
  if(!global.novaFunnelEnqueueCartMutation){
    var queueState={tail:Promise.resolve(),pending:Object.create(null)};
    global.novaFunnelEnqueueCartMutation=function(key,job){
      key=String(key||'cart');
      if(queueState.pending[key])return queueState.pending[key];
      var run=queueState.tail.catch(function(){}).then(job);
      queueState.tail=run.catch(function(){});
      queueState.pending[key]=run.finally(function(){delete queueState.pending[key];});
      return queueState.pending[key];
    };
  }
  function SalesPageCommerceAdapter(config){
    this.config=Object.assign({offerId:'sales-page-offer',drawerSection:'cart-drawer',cartIconSection:'cart-icon-bubble'},config||{});
  }
  SalesPageCommerceAdapter.prototype.openDrawer=function(){
    var drawer=document.querySelector('cart-drawer');
    if(!drawer)return false;
    if(typeof drawer.open==='function')drawer.open();else drawer.classList.add('animate','active');
    return true;
  };
  SalesPageCommerceAdapter.prototype.swap=function(sections,openAfter){
    var swapped=typeof global.swapDrawerFromSections==='function'&&global.swapDrawerFromSections(sections);
    if(openAfter)this.openDrawer();
    return swapped;
  };
  SalesPageCommerceAdapter.prototype.addLineItem=async function(lineItem,options){
    options=Object.assign({openDrawer:true},options||{});
    if(!lineItem||!Number(lineItem.id))throw new Error('A valid Shopify variant id is required');
    if(options.openDrawer)this.openDrawer();
    var self=this;
    return global.novaFunnelEnqueueCartMutation('main-offer:'+Number(lineItem.id),async function(){
      var response=await fetch(rootPath()+'cart/add.js',{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify({items:[lineItem],sections:[this.config.drawerSection,this.config.cartIconSection]})});
      var data=await response.json().catch(function(){return null;});
      if(!response.ok||!data||data.status)throw new Error((data&&(data.description||data.message))||'Cart add failed');
      if(!self.swap(data.sections,options.openDrawer)&&typeof global.refreshCartDrawer==='function')await global.refreshCartDrawer(options.openDrawer);
      document.dispatchEvent(new CustomEvent('sales-page-commerce:added',{detail:{offerId:self.config.offerId,variantId:Number(lineItem.id),quantity:Number(lineItem.quantity||1)}}));
      return data;
    }.bind(this));
  };
  SalesPageCommerceAdapter.prototype.changeLine=async function(line,quantity){
    var self=this;
    return global.novaFunnelEnqueueCartMutation('line:'+String(line),async function(){
      var response=await fetch(rootPath()+'cart/change.js',{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify({id:String(line),quantity:Math.max(0,Number(quantity)||0),sections:[this.config.drawerSection,this.config.cartIconSection]})});
      var data=await response.json().catch(function(){return null;});
      if(!response.ok||!data)throw new Error((data&&(data.description||data.message))||'Cart change failed');
      if(!self.swap(data.sections,true)&&typeof global.refreshCartDrawer==='function')await global.refreshCartDrawer(true);
      return data;
    }.bind(this));
  };
  global.SalesPageCommerceAdapter=SalesPageCommerceAdapter;
})(window);
