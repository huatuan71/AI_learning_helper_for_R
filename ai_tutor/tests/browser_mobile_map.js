async (page, baseUrl = 'http://127.0.0.1:8014') => {
  const checks=[],errors=[];
  const check=(ok,name)=>{if(!ok)throw Error(name);checks.push(name);};
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(baseUrl+'/#/knowledge');
  await page.waitForFunction(()=>document.querySelectorAll('.scene-orb-label').length===43);
  await page.waitForFunction(()=>document.body.dataset.view==='knowledge'&&document.querySelector('#main-content').getAnimations().length===0);
  await page.locator('#map-reset').click(); await page.waitForTimeout(800);
  check(await page.evaluate(()=>matchMedia('(pointer:coarse)').matches),'real coarse pointer context');
  const client=await page.context().newCDPSession(page);
  const touch=async(type,points)=>client.send('Input.dispatchTouchEvent',{type,touchPoints:points});
  const targetId=await page.locator('.scene-orb-label').evaluateAll(labels=>labels
    .map(label=>({id:label.dataset.id,box:label.getBoundingClientRect(),opacity:Number(getComputedStyle(label).opacity)}))
    .filter(item=>item.opacity>.5&&item.box.left>=8&&item.box.right<=innerWidth-8&&item.box.top>=100&&item.box.bottom<=innerHeight-8)
    .sort((a,b)=>Math.hypot(a.box.x+a.box.width/2-innerWidth/2,a.box.y+a.box.height/2-innerHeight/2)
      -Math.hypot(b.box.x+b.box.width/2-innerWidth/2,b.box.y+b.box.height/2-innerHeight/2))[0]?.id);
  check(!!targetId,'visible touch target found');
  const label=page.locator(`.scene-orb-label[data-id="${targetId}"]`);

  const before=await label.boundingBox();
  const start={x:before.x+before.width/2,y:before.y+before.height/2};
  const end={x:start.x+82,y:start.y+36};
  await touch('touchStart',[{...start,id:1}]);
  check(await page.locator('#map-detail').isHidden(),'touch down does not open detail');
  for(let i=1;i<=8;i++)await touch('touchMove',[{x:start.x+(end.x-start.x)*i/8,y:start.y+(end.y-start.y)*i/8,id:1}]);
  const during=await label.boundingBox();
  await touch('touchEnd',[]);
  const released=await label.boundingBox();
  await page.waitForTimeout(350);
  const settled=await label.boundingBox();
  check(Math.hypot(during.x-before.x,during.y-before.y)>6,'drag starting on label rotates view');
  check(await page.locator('#map-detail').isHidden(),'drag release does not open detail');
  check(Math.hypot(settled.x-released.x,settled.y-released.y)<1,'touch release fixes current view');

  await page.locator('#map-reset').click(); await page.waitForTimeout(800);
  const tapId=await page.locator('.scene-orb-label').evaluateAll(labels => labels.find(label => {const b=label.getBoundingClientRect();const hit=document.elementFromPoint(b.x+b.width/2,b.y+b.height/2);return b.top>200 && b.bottom<innerHeight-8 && hit?.closest('.scene-orb-label')===label;})?.dataset.id);
  check(!!tapId,'unobscured touch target after reset');
  const tapBox=await page.locator(`.scene-orb-label[data-id="${tapId}"]`).boundingBox();
  const tap={x:tapBox.x+tapBox.width/2,y:tapBox.y+tapBox.height/2};
  await touch('touchStart',[{...tap,id:2}]);
  await touch('touchMove',[{x:tap.x+4,y:tap.y+2,id:2}]);
  check(await page.locator('#map-detail').isHidden(),'small movement waits for release');
  await touch('touchEnd',[]);
  await page.waitForFunction(id=>!document.querySelector('#map-detail').hidden&&document.querySelector('#detail-title')?.textContent.startsWith(id),tapId);
  check(true,'small movement opens selected detail on release');
  check(await page.locator('#map-detail').getAttribute('role')==='dialog'
    && await page.locator('#map-detail').getAttribute('aria-modal')===null,'mobile detail is non-modal dialog');
  check(!await page.locator('.app-header').evaluate(node=>node.inert),'header remains interactive with detail open');
  await page.locator('#nav-toggle').click();
  check(await page.locator('#main-nav').isVisible(),'mobile navigation opens with detail visible');
  await page.locator('#main-nav a[href="#/chat"]').click();
  await page.waitForFunction(()=>location.hash==='#/chat'&&!document.querySelector('#layout').hidden);
  check(await page.locator('#map-detail').isHidden(),'navigation closes detail and changes view');
  check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'390 width has no horizontal overflow');
  check(errors.length===0,'no page errors');
  return {checks,count:checks.length};
}
