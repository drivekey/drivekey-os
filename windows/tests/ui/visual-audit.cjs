'use strict';

// DOM measurements supplement (not replace) screenshot inspection.
async function auditVisuals(page) {
  return page.evaluate(()=>{
    const visible=el=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el);return r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden'&&!el.closest('[hidden]');};
    const parse=value=>{const m=/rgba?\(([^)]+)\)/.exec(value);if(!m)return null;const a=m[1].split(/[, /]+/).filter(Boolean).map(Number);return [a[0],a[1],a[2],a[3]??1];};
    const over=(a,b)=>{const outA=a[3]+b[3]*(1-a[3]);return [0,1,2].map(i=>outA?(a[i]*a[3]+b[i]*b[3]*(1-a[3]))/outA:0).concat(outA);};
    const luminance=c=>{const x=c.slice(0,3).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;});return .2126*x[0]+.7152*x[1]+.0722*x[2];};
    const background=el=>{let color=[0,0,0,0],gradient=false;for(let p=el;p;p=p.parentElement){const s=getComputedStyle(p);gradient ||=s.backgroundImage!=='none';const next=parse(s.backgroundColor);if(next)color=over(color,next);if(color[3]>.999)return {color,gradient};}return {color:over(color,[255,255,255,1]),gradient};};
    const describe=el=>el.id?'#'+el.id:el.tagName.toLowerCase()+(el.className&&typeof el.className==='string'?'.'+el.className.trim().replace(/\s+/g,'.'):'');
    const textMeasurements=[],lowContrast=[],unmeasured=[];
    const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);let node;
    while(node=walker.nextNode()){
      const el=node.parentElement,value=node.textContent.trim();if(!value||!el||!visible(el)||el.closest('[data-fixture-banner]'))continue;
      const s=getComputedStyle(el),fg=parse(s.color),bg=background(el);if(!fg)continue;
      if(bg.gradient&&bg.color[3]<.999){unmeasured.push({element:describe(el),reason:'transparent gradient backing'});continue;}
      // If an opaque ancestor was reached, its own gradient may vary; report as an estimate.
      const blended=over(fg,bg.color),l1=luminance(blended),l2=luminance(bg.color),ratio=(Math.max(l1,l2)+.05)/(Math.min(l1,l2)+.05),fontSize=parseFloat(s.fontSize),weight=parseInt(s.fontWeight)||400,target=fontSize>=24||fontSize>=18.66&&weight>=700?3:4.5;
      const record={element:describe(el),text:value.slice(0,90),ratio:Number(ratio.toFixed(2)),target,gradientEstimate:bg.gradient,fontSize};textMeasurements.push(record);
      if(ratio<target&&!el.closest('[disabled],[aria-disabled="true"]'))lowContrast.push(record);
    }
    const missingImages=[...document.images].filter(visible).filter(im=>im.complete&&im.naturalWidth===0).map(im=>({element:describe(im),src:im.getAttribute('src')}));
    const unnamedControls=[...document.querySelectorAll('button,input:not([type=hidden]),select,textarea,a[href]')].filter(visible).filter(el=>{
      const labels=el.labels?[...el.labels].map(l=>l.textContent).join(' '):'';
      return !(el.getAttribute('aria-label')||el.getAttribute('aria-labelledby')||el.textContent?.trim()||labels.trim()||el.title||el.querySelector('img[alt]')?.alt);
    }).map(describe);
    const overflow=[...document.body.querySelectorAll('*')].filter(visible).map(el=>({el,r:el.getBoundingClientRect()})).filter(({el,r})=>!el.closest('[data-fixture-banner]')&&(r.right>innerWidth+2||r.left< -2)).slice(0,30).map(({el,r})=>({element:describe(el),left:Math.round(r.left),right:Math.round(r.right)}));
    return {viewport:{width:innerWidth,height:innerHeight},horizontalOverflow:document.documentElement.scrollWidth>innerWidth+1,overflow,missingImages,unnamedControls,textMeasurements,lowContrast,belowTextFloor:textMeasurements.filter(x=>x.fontSize<12),unmeasuredContrast:unmeasured,contrastScope:'Computed opaque-background estimates; gradients/translucency require visual sampling. Not a WCAG certification.'};
  });
}
module.exports={auditVisuals};
