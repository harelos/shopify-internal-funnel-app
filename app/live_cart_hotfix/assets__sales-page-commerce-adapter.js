(function(global){
  'use strict';

  function rootPath(){
    return (global.Shopify&&global.Shopify.routes&&global.Shopify.routes.root)||'/';
  }

  function sectionNames(config){
    return [config.drawerSection||'cart-drawer',config.cartIconSection||'cart-icon-bubble'];
  }

  async function readCart(){
    var response=await fetch(rootPath()+'cart.js',{headers:{Accept:'application/json'},cache:'no-store'});
    var data=await response.json().catch(function(){return null;});
    if(!response.ok||!data)throw new Error((data&&(data.description||data.message))||'Cart read failed');
    return data;
  }

  async function mutateCart(endpoint,payload){
    var response=await fetch(rootPath()+endpoint,{
      method:'POST',
      headers:{'Content-Type':'application/json',Accept:'application/json'},
      body:JSON.stringify(payload)
    });
    var data=await response.json().catch(function(){return null;});
    if(!response.ok||!data||data.status)throw new Error((data&&(data.description||data.message))||'Cart mutation failed');
    return data;
  }

  function propertiesOf(item){
    return (item&&item.properties)||{};
  }

  function emitCommerceEvent(name,detail){
    try{
      document.dispatchEvent(new CustomEvent(name,{detail:detail||{}}));
    }catch(_){}
  }

  function emitCommerceFailure(operation,variantId,itemRole,error){
    emitCommerceEvent('sales-page-commerce:failed',{
      operation:operation,
      variantId:Number(variantId)||undefined,
      itemRole:itemRole||undefined,
      errorCode:String(error&&error.code||error&&error.name||'unknown').slice(0,80)
    });
  }

  function mainPresentation(config){
    return config&&config.cartPresentation&&config.cartPresentation.key;
  }

  function isMainOffer(item,config){
    var properties=propertiesOf(item);
    var presentation=mainPresentation(config);
    if(presentation&&properties._CART_PRESENTATION===presentation)return true;
    if(!config||config.offerId!=='novahair-sales-page')return false;
    return Boolean(properties._NOVASALE_CONFIG||(item&&item.handle==='novahair-funnel-internal'));
  }

  function sameMainSelection(item,lineItem,config){
    if(Number(item.variant_id)!==Number(lineItem.id))return false;
    var current=propertiesOf(item);
    var intended=propertiesOf(lineItem);
    if(intended._NOVASALE_CONFIG&&current._NOVASALE_CONFIG!==intended._NOVASALE_CONFIG)return false;
    var presentation=mainPresentation(config);
    if(presentation&&current._CART_PRESENTATION!==presentation)return false;
    return true;
  }

  function sameUniqueLine(item,lineItem,role){
    if(Number(item.variant_id)!==Number(lineItem.id))return false;
    if(!role)return true;
    return propertiesOf(item)._NOVAFUNNEL_ROLE===role;
  }

  function lineItemFromCart(item){
    return {id:Number(item.variant_id),quantity:1,properties:Object.assign({},propertiesOf(item))};
  }

  function mainLines(cart,config){
    return (cart.items||[]).filter(function(item){return isMainOffer(item,config);});
  }

  function hasRequiredProduct(cart,productIds){
    if(!productIds.length)return true;
    return (cart.items||[]).some(function(item){return productIds.indexOf(Number(item.product_id))!==-1;});
  }

  function updatesKeepingOne(lines,keep){
    var updates={};
    lines.forEach(function(item){updates[item.key]=item.key===keep.key?1:0;});
    return updates;
  }

  async function normalizeMainOffer(cart,config,preferredLineItem){
    var lines=mainLines(cart,config);
    if(!lines.length)return {cart:cart,data:null,kept:null};
    var keep=preferredLineItem&&lines.find(function(item){return sameMainSelection(item,preferredLineItem,config);});
    if(!keep)keep=lines[0];
    if(lines.length===1&&Number(keep.quantity)===1)return {cart:cart,data:null,kept:keep};
    var data=await mutateCart('cart/update.js',{
      updates:updatesKeepingOne(lines,keep),
      sections:sectionNames(config)
    });
    var normalized=mainLines(data,config);
    return {cart:data,data:data,kept:normalized[0]||keep};
  }

  async function removeLines(lines,config){
    if(!lines.length)return null;
    var updates={};
    lines.forEach(function(item){updates[item.key]=0;});
    return mutateCart('cart/update.js',{updates:updates,sections:sectionNames(config)});
  }

  function renderResult(data,openAfter){
    var swapped=Boolean(data&&data.sections&&typeof global.swapDrawerFromSections==='function'&&global.swapDrawerFromSections(data.sections));
    if(!swapped&&typeof global.refreshCartDrawer==='function')return global.refreshCartDrawer(Boolean(openAfter));
    if(openAfter){
      var drawer=document.querySelector('cart-drawer');
      if(drawer){
        if(typeof drawer.open==='function')drawer.open();
        else drawer.classList.add('animate','active');
      }
    }
    return Promise.resolve();
  }

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
    if(drawer.classList.contains('active')||drawer.isOpening)return true;
    if(typeof drawer.open==='function')drawer.open();
    else drawer.classList.add('animate','active');
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
    var operation=global.novaFunnelEnqueueCartMutation('main-offer:'+this.config.offerId,async function(){
      var cart=await readCart();
      var existing=mainLines(cart,self.config);
      var exact=existing.find(function(item){return sameMainSelection(item,lineItem,self.config);});
      var data=null;

      if(exact){
        if(existing.length>1||Number(exact.quantity)!==1){
          data=await mutateCart('cart/update.js',{
            updates:updatesKeepingOne(existing,exact),
            sections:sectionNames(self.config)
          });
        }
      }else{
        data=await mutateCart('cart/add.js',{items:[lineItem],sections:sectionNames(self.config)});
        var afterAdd=await readCart();
        var normalized=await normalizeMainOffer(afterAdd,self.config,lineItem);
        if(normalized.data)data=normalized.data;
      }

      if(data)await renderResult(data,options.openDrawer);
      else if(typeof global.refreshCartDrawer==='function')await global.refreshCartDrawer(options.openDrawer);
      else if(options.openDrawer)self.openDrawer();

      emitCommerceEvent('sales-page-commerce:added',{
        offerId:self.config.offerId,
        variantId:Number(lineItem.id),
        quantity:1,
        alreadyPresent:Boolean(exact&&existing.length===1&&Number(exact.quantity)===1)
      });
      return data||cart;
    });
    return operation.catch(function(error){
      emitCommerceFailure('main_offer_add',lineItem.id,'main_offer',error);
      throw error;
    });
  };

  SalesPageCommerceAdapter.prototype.changeLine=async function(line,quantity){
    var self=this;
    return global.novaFunnelEnqueueCartMutation('line:'+String(line),async function(){
      var data=await mutateCart('cart/change.js',{
        id:String(line),
        quantity:Math.max(0,Number(quantity)||0),
        sections:sectionNames(self.config)
      });
      await renderResult(data,true);
      return data;
    });
  };

  global.novaFunnelAddUniqueLine=function(lineItem,options){
    options=Object.assign({
      openDrawer:false,
      role:propertiesOf(lineItem)._NOVAFUNNEL_ROLE||'',
      config:global.NOVAHAIR_SALES_COMMERCE_CONFIG||{},
      requiredProductIds:[]
    },options||{});
    if(!lineItem||!Number(lineItem.id))return Promise.reject(new Error('A valid Shopify variant id is required'));
    var config=Object.assign({drawerSection:'cart-drawer-novafunnel',cartIconSection:'cart-icon-bubble'},options.config||{});
    var role=options.role;
    var requiredProductIds=(options.requiredProductIds||[]).map(Number).filter(function(id){return id>0;});

    var operation=global.novaFunnelEnqueueCartMutation('unique:'+Number(lineItem.id)+':'+role,async function(){
      var cart=await readCart();
      var normalized=await normalizeMainOffer(cart,config,null);
      cart=normalized.cart;
      var expectedMain=mainLines(cart,config)[0]||null;
      var matches=(cart.items||[]).filter(function(item){return sameUniqueLine(item,lineItem,role);});
      var data=normalized.data;

      if(!hasRequiredProduct(cart,requiredProductIds)){
        if(data)await renderResult(data,options.openDrawer);
        else if(typeof global.refreshCartDrawer==='function')await global.refreshCartDrawer(options.openDrawer);
        var missingMainError=new Error('A qualifying main product is required before adding this item');
        missingMainError.code='NOVAFUNNEL_MAIN_REQUIRED';
        throw missingMainError;
      }

      if(matches.length===1&&Number(matches[0].quantity)===1){
        if(data)await renderResult(data,options.openDrawer);
        else if(typeof global.refreshCartDrawer==='function')await global.refreshCartDrawer(options.openDrawer);
        return {cart:cart,alreadyPresent:true};
      }

      if(matches.length)await removeLines(matches,config);
      data=await mutateCart('cart/add.js',{items:[lineItem],sections:sectionNames(config)});

      var verified=await readCart();
      var verifiedMatches=(verified.items||[]).filter(function(item){return sameUniqueLine(item,lineItem,role);});
      if(verifiedMatches.length!==1||Number(verifiedMatches[0].quantity)!==1){
        if(verifiedMatches.length)await removeLines(verifiedMatches,config);
        data=await mutateCart('cart/add.js',{items:[lineItem],sections:sectionNames(config)});
        verified=await readCart();
      }

      if(expectedMain){
        var afterMain=mainLines(verified,config);
        var expectedLine=lineItemFromCart(expectedMain);
        var validMain=afterMain.length===1&&Number(afterMain[0].quantity)===1&&sameMainSelection(afterMain[0],expectedLine,config);
        if(!validMain){
          data=await mutateCart('cart/add.js',{items:[expectedLine],sections:sectionNames(config)});
          var repaired=await readCart();
          var repairedNormalized=await normalizeMainOffer(repaired,config,expectedLine);
          if(repairedNormalized.data)data=repairedNormalized.data;
        }
      }

      await renderResult(data,options.openDrawer);
      return data;
    });
    return operation.then(function(result){
      emitCommerceEvent('sales-page-commerce:unique-added',{
        variantId:Number(lineItem.id),
        itemRole:role||propertiesOf(lineItem)._NOVAFUNNEL_ROLE||'cart_item'
      });
      return result;
    }).catch(function(error){
      emitCommerceFailure('unique_line_add',lineItem.id,role||propertiesOf(lineItem)._NOVAFUNNEL_ROLE,error);
      throw error;
    });
  };

  global.novaFunnelRemoveVariantLines=function(variantId,options){
    options=Object.assign({
      openDrawer:false,
      role:'',
      config:global.NOVAHAIR_SALES_COMMERCE_CONFIG||{}
    },options||{});
    var config=Object.assign({drawerSection:'cart-drawer-novafunnel',cartIconSection:'cart-icon-bubble'},options.config||{});
    return global.novaFunnelEnqueueCartMutation('remove:'+Number(variantId)+':'+options.role,async function(){
      var cart=await readCart();
      var lines=(cart.items||[]).filter(function(item){
        if(Number(item.variant_id)!==Number(variantId))return false;
        return !options.role||propertiesOf(item)._NOVAFUNNEL_ROLE===options.role;
      });
      if(!lines.length){
        if(typeof global.refreshCartDrawer==='function')await global.refreshCartDrawer(options.openDrawer);
        return cart;
      }
      var data=await removeLines(lines,config);
      await renderResult(data,options.openDrawer);
      return data;
    });
  };

  global.novaFunnelRemoveMainOffer=function(options){
    options=Object.assign({
      openDrawer:false,
      config:global.NOVAHAIR_SALES_COMMERCE_CONFIG||{},
      dependentVariantIds:[],
      dependentGroup:''
    },options||{});
    var config=Object.assign({drawerSection:'cart-drawer-novafunnel',cartIconSection:'cart-icon-bubble'},options.config||{});
    var dependentVariantIds=(options.dependentVariantIds||[]).map(Number);
    var dependentGroup=String(options.dependentGroup||'');
    return global.novaFunnelEnqueueCartMutation('remove-main-offer',async function(){
      var cart=await readCart();
      var lines=(cart.items||[]).filter(function(item){
        if(isMainOffer(item,config))return true;
        var properties=propertiesOf(item);
        if(dependentGroup&&properties._NOVAFUNNEL_GROUP===dependentGroup)return true;
        return dependentVariantIds.indexOf(Number(item.variant_id))!==-1;
      });
      if(!lines.length){
        if(typeof global.refreshCartDrawer==='function')await global.refreshCartDrawer(options.openDrawer);
        return cart;
      }
      var data=await removeLines(lines,config);
      await renderResult(data,options.openDrawer);
      return data;
    });
  };

  global.novaFunnelNormalizeMainOffer=function(options){
    options=Object.assign({openDrawer:false,config:global.NOVAHAIR_SALES_COMMERCE_CONFIG||{}},options||{});
    var config=Object.assign({drawerSection:'cart-drawer-novafunnel',cartIconSection:'cart-icon-bubble'},options.config||{});
    return global.novaFunnelEnqueueCartMutation('normalize-main-offer',async function(){
      var cart=await readCart();
      var normalized=await normalizeMainOffer(cart,config,null);
      if(normalized.data)await renderResult(normalized.data,options.openDrawer);
      return normalized.cart;
    });
  };

  // This listener lives in the theme asset, rather than in the cart section HTML.
  // Shopify replaces the section after every cart response, while this binding stays alive.
  var managedBumpState={timer:0,running:false,dirty:false,version:0,desired:Object.create(null)};

  function managedBumpInputs(){
    return Array.prototype.slice.call(document.querySelectorAll('input[data-managed-bump]'));
  }

  function managedBumpSelection(){
    var desired={};
    managedBumpInputs().forEach(function(input){
      var id=Number(input.getAttribute('data-managed-bump'));
      if(!id)return;
      if(!Object.prototype.hasOwnProperty.call(managedBumpState.desired,id)){
        managedBumpState.desired[id]={checked:!!input.checked,title:input.getAttribute('data-display-title')||''};
      }else if(input.getAttribute('data-display-title')){
        managedBumpState.desired[id].title=input.getAttribute('data-display-title');
      }
      desired[id]={checked:!!managedBumpState.desired[id].checked,title:managedBumpState.desired[id].title||''};
    });
    return desired;
  }

  function scheduleManagedBumpSync(){
    managedBumpState.dirty=true;
    clearTimeout(managedBumpState.timer);
    managedBumpState.timer=setTimeout(flushManagedBumpSync,450);
  }

  async function flushManagedBumpSync(){
    if(managedBumpState.running)return;
    managedBumpState.running=true;
    managedBumpState.dirty=false;
    var version=managedBumpState.version;
    var desired=managedBumpSelection();
    try{
      await global.novaFunnelEnqueueCartMutation('managed-bumps',async function(){
        var config=Object.assign({drawerSection:'cart-drawer-novafunnel',cartIconSection:'cart-icon-bubble'},global.NOVAHAIR_SALES_COMMERCE_CONFIG||{});
        var cart=await readCart();
        if(!mainLines(cart,config).length)return cart;
        var updates={},seen=Object.create(null);
        (cart.items||[]).forEach(function(item){
          var properties=propertiesOf(item);
          if(properties._NOVAFUNNEL_ROLE!=='BUMP'||properties._NOVAFUNNEL_GROUP!=='nova')return;
          var id=Number(item.variant_id);
          var keep=!!(desired[id]&&desired[id].checked&&!seen[id]);
          seen[id]=true;
          if(!keep)updates[item.key]=0;
          else if(Number(item.quantity)!==1)updates[item.key]=1;
        });
        var data=null;
        if(Object.keys(updates).length){
          data=await mutateCart('cart/update.js',{updates:updates,sections:sectionNames(config)});
          cart=data;
        }
        var additions=[];
        Object.keys(desired).forEach(function(rawId){
          var id=Number(rawId);
          if(!desired[id].checked||seen[id])return;
          additions.push({id:id,quantity:1,properties:{_NOVAFUNNEL_ROLE:'BUMP',_NOVAFUNNEL_GROUP:'nova',_NOVAFUNNEL_SOURCE:'cart-drawer',_NOVAFUNNEL_TITLE:desired[id].title||''}});
        });
        if(additions.length)data=await mutateCart('cart/add.js',{items:additions,sections:sectionNames(config)});
        if(data)await renderResult(data,true);
        return data||cart;
      });
    }catch(error){
      console.error('NovaFunnel managed bump sync error:',error);
    }finally{
      managedBumpState.running=false;
      if(managedBumpState.version===version)managedBumpState.desired=Object.create(null);
      if(managedBumpState.dirty)scheduleManagedBumpSync();
    }
  }

  document.addEventListener('change',function(event){
    var input=event.target&&event.target.closest&&event.target.closest('input[data-managed-bump]');
    if(!input)return;
    event.stopImmediatePropagation();
    var id=Number(input.getAttribute('data-managed-bump'));
    if(!id)return;
    managedBumpState.desired[id]={checked:!!input.checked,title:input.getAttribute('data-display-title')||''};
    managedBumpState.version+=1;
    scheduleManagedBumpSync();
  },true);

  global.SalesPageCommerceAdapter=SalesPageCommerceAdapter;
})(window);
