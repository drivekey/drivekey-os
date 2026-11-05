'use strict';
// Test-only measurement: capture the actual rendered backing with glyph colors
// temporarily transparent, then restore all inline declarations before returning.
async function measurePixelContrast(page){
  await page.evaluate(()=>document.fonts.ready);
  const bounds=await page.evaluate(()=>{
    const rows=[],walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);
    let text;
    while(text=walker.nextNode()){
      const e=text.parentElement,copy=text.textContent.trim();if(!e||!copy||e.closest('[hidden],[disabled],[aria-disabled=true],[data-fixture-banner]'))continue;
      let hiddenByDisclosure=false;
      for(let ancestor=e.closest('details');ancestor;ancestor=ancestor.parentElement?.closest('details')){
        if(!ancestor.open&&!ancestor.querySelector(':scope > summary')?.contains(e)){
          hiddenByDisclosure=true;break;
        }
      }
      if(hiddenByDisclosure)continue;
      const style=getComputedStyle(e);if(style.display==='none'||style.visibility==='hidden')continue;
      const range=document.createRange();range.selectNodeContents(text);
      const rects=[...range.getClientRects()].filter(r=>r.width>5&&r.height>5&&r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight);
      if(!rects.length)continue;
      let opacity=1;for(let p=e;p;p=p.parentElement)opacity*=Number(getComputedStyle(p).opacity);
      if(opacity<0.01)continue;
      const size=parseFloat(style.fontSize),weight=parseInt(style.fontWeight)||400;
      rows.push({element:e.id?'#'+e.id:e.tagName.toLowerCase(),text:copy.slice(0,90),color:style.color,opacity,target:size>=24||size>=18.66&&weight>=700?3:4.5,rects:rects.map(r=>({x:r.x,y:r.y,width:r.width,height:r.height}))});
    }
    window.__contrastSaved=[...document.body.querySelectorAll('*'),document.body].map(e=>({e,value:e.style.getPropertyValue('color'),priority:e.style.getPropertyPriority('color'),shadow:e.style.getPropertyValue('text-shadow'),shadowPriority:e.style.getPropertyPriority('text-shadow')}));
    for(const {e}of window.__contrastSaved){e.style.setProperty('color','transparent','important');e.style.setProperty('text-shadow','none','important');}
    return rows;
  });
  let png;
  try{await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));png=await page.screenshot({type:'png',fullPage:false});if(process.env.DRIVEKEY_CONTRAST_DEBUG)await require('node:fs/promises').writeFile(process.env.DRIVEKEY_CONTRAST_DEBUG,png);}
  finally{await page.evaluate(()=>{for(const {e,value,priority,shadow,shadowPriority}of window.__contrastSaved||[]){if(value)e.style.setProperty('color',value,priority);else e.style.removeProperty('color');if(shadow)e.style.setProperty('text-shadow',shadow,shadowPriority);else e.style.removeProperty('text-shadow');}delete window.__contrastSaved;});}
  return page.evaluate(async({source,rows})=>{
    const img=new Image();img.src=source;await img.decode();const canvas=document.createElement('canvas');canvas.width=img.width;canvas.height=img.height;const context=canvas.getContext('2d',{willReadFrequently:true});context.drawImage(img,0,0);const pixels=context.getImageData(0,0,img.width,img.height).data,sx=img.width/innerWidth,sy=img.height/innerHeight;
    const luminance=c=>{const q=c.map(v=>(v/=255)<=.04045?v/12.92:((v+.055)/1.055)**2.4);return .2126*q[0]+.7152*q[1]+.0722*q[2];};
    const measured=[];
    for(const row of rows){const c=row.color.match(/[\d.]+/g)?.map(Number);if(!c||c.length<3)continue;const alpha=(c[3]??1)*row.opacity;let worst=Infinity;for(const r of row.rects)for(const fx of [.15,.5,.85])for(const fy of [.2,.5,.8]){const x=Math.min(img.width-1,Math.max(0,Math.floor((r.x+r.width*fx)*sx))),y=Math.min(img.height-1,Math.max(0,Math.floor((r.y+r.height*fy)*sy))),i=(y*img.width+x)*4,bg=[pixels[i],pixels[i+1],pixels[i+2]],fg=bg.map((v,n)=>c[n]*alpha+v*(1-alpha)),a=luminance(fg),b=luminance(bg),ratio=(Math.max(a,b)+.05)/(Math.min(a,b)+.05);worst=Math.min(worst,ratio);}measured.push({element:row.element,text:row.text,ratio:Number(worst.toFixed(2)),target:row.target});}
    return {method:'Actual browser-rendered backing sampled under temporarily transparent text; 9 points per visible text rectangle. Inline color/shadow restored. Visible viewport only; sampled points are not every possible pixel.',samples:measured,lowContrast:measured.filter(r=>r.ratio<r.target)};
  },{source:'data:image/png;base64,'+png.toString('base64'),rows:bounds});
}
module.exports={measurePixelContrast};
