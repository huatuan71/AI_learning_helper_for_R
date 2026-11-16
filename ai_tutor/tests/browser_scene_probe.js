async (page, baseUrl = 'http://127.0.0.1:8014') => {
  await page.setViewportSize({width:1440,height:1000});
  await page.emulateMedia({reducedMotion:'no-preference'});
  await page.goto(baseUrl+'/#/knowledge');
  await page.reload();
  await page.waitForFunction(()=>document.querySelectorAll('.scene-orb-label').length===43);
  const viewport=page.locator('#map-viewport');
  const canvas=page.locator('.knowledge-canvas');
  const label=page.locator('.scene-orb-label[data-id="K06"]');
  const scene=await viewport.boundingBox();
  const before=await label.boundingBox();
  const labelLayout=await page.evaluate(()=>{
    const nodes=[...document.querySelectorAll('.scene-orb-label')];
    const visible=nodes.filter(node=>!node.hidden&&Number(getComputedStyle(node).opacity)>.01).map(node=>({id:node.dataset.id,rect:node.getBoundingClientRect()}));
    const overlaps=[];
    for(let i=0;i<visible.length;i++)for(let j=i+1;j<visible.length;j++){
      const a=visible[i].rect,b=visible[j].rect;
      if(a.left<b.right-1&&a.right>b.left+1&&a.top<b.bottom-1&&a.bottom>b.top+1)overlaps.push(`${visible[i].id}/${visible[j].id}`);
    }
    return {visible:visible.length,condensed:nodes.filter(node=>node.classList.contains('is-condensed')).length,hidden:nodes.filter(node=>node.classList.contains('is-collision-hidden')).length,overlaps};
  });
  await page.evaluate(()=>{
    window.__pointerSummary={};
    for(const type of ['pointerdown','pointermove','pointerup','lostpointercapture']){
      window.addEventListener(type,event=>{
        const key=`${type}:${String(event.target?.className||event.target?.tagName)}`;
        window.__pointerSummary[key]=(window.__pointerSummary[key]||0)+1;
        window.__pointerSummary.lastButtons=event.buttons;
      },true);
    }
  });
  const start={x:scene.x+scene.width*.5,y:scene.y+scene.height*.18};
  const end={x:scene.x+scene.width*.68,y:scene.y+scene.height*.27};
  await page.mouse.move(start.x,start.y);await page.mouse.down();
  await page.mouse.move(end.x,end.y,{steps:12});
  const during=await label.boundingBox();
  await page.mouse.up();
  const released=await label.boundingBox();
  await page.waitForTimeout(800);
  const settled=await label.boundingBox();
  const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
  const moved=distance(during,before);
  const drift=distance(settled,released);
  return {
    before:{x:before.x,y:before.y},
    during:{x:during.x,y:during.y},
    released:{x:released.x,y:released.y},
    settled:{x:settled.x,y:settled.y},
    moved,
    drift,
    passed:moved>8&&drift<1,
    labelLayout,
    pointerSummary:await page.evaluate(()=>window.__pointerSummary),
    viewportClass:await viewport.getAttribute('class'),
    canvas:await canvas.boundingBox(),
    hit:await page.evaluate(({x,y})=>document.elementFromPoint(x,y)?.className,start),
    hitEnd:await page.evaluate(({x,y})=>document.elementFromPoint(x,y)?.className,end),
  };
}
