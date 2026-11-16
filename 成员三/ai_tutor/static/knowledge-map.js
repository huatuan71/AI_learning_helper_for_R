/* Deterministic 2D knowledge navigation. No physics loop, random positions or HTML injection. */
'use strict';
class KnowledgeMap {
  constructor({api, explain, exercise, codeBlock, units, markdown}) {
    Object.assign(this, {api, explain, exercise, codeBlock, units, markdown});
    this.items = []; this.edges = []; this.nodes = new Map(); this.cache = new Map();
    this.selected = null; this.sequence = 0; this.ready = false;
    this.$ = id => document.getElementById(id);
    this.viewport = this.$('map-viewport'); this.world = this.$('map-world');
    this.narrow = matchMedia('(max-width:760px)');
    this.colors = ['#dce9f6','#dfe9e0','#eae1f1','#f2e5d5','#d9e9e9','#f1dfe3','#e5e7f2','#e9e7d6'];
    this.shortNames = ['R与RStudio','包与命名空间','帮助与记录','类型转换','逻辑筛选','缺失值','因子','日期时间','创建向量','向量索引','向量运算','集合匹配','数值汇总','排序','区间分组','字符截取','字符串拼接','正则查找','创建矩阵','矩阵变换','矩阵乘法','特征分解','稀疏矩阵','数组与apply','创建数据框','数据框筛选','排序与合并','缺失处理','长宽表转换','分组汇总','列表索引','列表批处理','配对计算','递归处理','自定义函数','条件分支','安全循环','文件与路径','综合练习','dplyr','tidyr','reshape2','lubridate'];
    this.addUnitChoice('','全部单元');
    units.forEach((unit,i) => {
      const option = this.node('option',unit); option.value = unit; this.$('map-unit').append(option);
      this.addUnitChoice(unit,unit);
      const label = this.node('span',unit); label.style.setProperty('--unit-color',this.colors[i]); this.$('map-legend').append(label);
    });
    this.$('map-search').addEventListener('input', () => this.filter());
    this.$('map-unit').addEventListener('change', () => { this.syncUnitMenu(); this.close(false); this.filter(); });
    this.$('map-unit-toggle').addEventListener('click', event => {
      event.stopPropagation();this.setUnitMenu(this.$('map-unit-menu').hidden,true);
    });
    this.$('map-unit-toggle').addEventListener('keydown', event => {
      if(event.key==='ArrowDown'||event.key==='ArrowUp'){
        event.preventDefault();this.setUnitMenu(true,true,event.key==='ArrowUp');
      }else if(event.key==='Escape'&&!this.$('map-unit-menu').hidden){
        event.preventDefault();this.setUnitMenu(false);this.$('map-unit-toggle').focus();
      }
    });
    this.$('map-unit-menu').addEventListener('keydown', event => this.unitMenuKeydown(event));
    document.addEventListener('click', event => {if(!event.target.closest('#map-unit-picker'))this.setUnitMenu(false);});
    this.syncUnitMenu();
    this.$('map-reset').onclick = () => {
      this.$('map-search').value = ''; this.setUnitValue(''); this.close(false); this.filter(false); this.center();
    };
    this.$('detail-close').onclick = () => this.close();
    this.narrow.addEventListener('change', () => this.accessibility());
    this.$('map-detail').addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); this.close(); }
      if (event.key === 'Tab' && this.narrow.matches) {
        const controls = [...this.$('map-detail').querySelectorAll('button,a,summary')].filter(n => n.checkVisibility() && !n.disabled);
        const first = controls[0], last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    });
    this.viewport.addEventListener('keydown', event => {
      if (event.target !== this.viewport) return;
      const delta = {ArrowLeft:[-100,0],ArrowRight:[100,0],ArrowUp:[0,-100],ArrowDown:[0,100]}[event.key];
      if (delta) { event.preventDefault(); this.viewport.scrollBy({left:delta[0],top:delta[1],behavior:'instant'}); }
    });
    let drag = null;
    this.viewport.addEventListener('pointerdown', event => {
      if (this.viewport.classList.contains('webgl-ready') || event.pointerType !== 'mouse' || event.button !== 0 || event.target.closest('button')) return;
      drag = {x:event.clientX,y:event.clientY,left:this.viewport.scrollLeft,top:this.viewport.scrollTop};
      this.viewport.setPointerCapture(event.pointerId); this.viewport.classList.add('panning');
    });
    this.viewport.addEventListener('pointermove', event => {
      if (!drag) return;
      this.viewport.scrollLeft = drag.left + drag.x - event.clientX;
      this.viewport.scrollTop = drag.top + drag.y - event.clientY;
    });
    const end = () => { drag = null; this.viewport.classList.remove('panning'); };
    this.viewport.addEventListener('pointerup',end); this.viewport.addEventListener('pointercancel',end);
    this.viewport.addEventListener('lostpointercapture',end);
  }
  addUnitChoice(value,label) {
    const item=this.action(label,()=>this.chooseUnit(value),'map-unit-option');
    item.dataset.value=value;item.setAttribute('role','option');item.tabIndex=-1;
    this.$('map-unit-menu').append(item);
  }
  setUnitValue(value) {
    this.$('map-unit').value=value;this.syncUnitMenu();
  }
  chooseUnit(value) {
    this.setUnitValue(value);this.setUnitMenu(false);this.$('map-unit').dispatchEvent(new Event('change',{bubbles:true}));
    this.$('map-unit-toggle').focus();
  }
  syncUnitMenu() {
    const select=this.$('map-unit');
    const label=select.selectedOptions[0]?.textContent||'全部单元';
    this.$('map-unit-label').textContent=label;
    this.$('map-unit-menu').querySelectorAll('[role="option"]').forEach(item=>{
      const selected=item.dataset.value===select.value;
      item.setAttribute('aria-selected',String(selected));item.tabIndex=-1;
    });
  }
  setUnitMenu(open,focus=false,focusLast=false) {
    const menu=this.$('map-unit-menu'),toggle=this.$('map-unit-toggle');
    menu.hidden=!open;toggle.setAttribute('aria-expanded',String(open));
    if(!open){menu.querySelectorAll('[role="option"]').forEach(item=>item.tabIndex=-1);return;}
    if(focus)requestAnimationFrame(()=>{
      const options=[...menu.querySelectorAll('[role="option"]')];
      const target=focusLast?options.at(-1):options.find(item=>item.getAttribute('aria-selected')==='true')||options[0];
      if(target){target.tabIndex=0;target.focus();}
    });
  }
  unitMenuKeydown(event) {
    const menu=this.$('map-unit-menu'),options=[...menu.querySelectorAll('[role="option"]')];
    const current=Math.max(0,options.indexOf(document.activeElement));
    let next=null;
    if(event.key==='ArrowDown')next=Math.min(options.length-1,current+1);
    else if(event.key==='ArrowUp')next=Math.max(0,current-1);
    else if(event.key==='Home')next=0;
    else if(event.key==='End')next=options.length-1;
    else if(event.key==='Escape'){
      event.preventDefault();this.setUnitMenu(false);this.$('map-unit-toggle').focus();return;
    }else if(event.key==='Tab'){this.setUnitMenu(false);return;}
    if(next!==null){event.preventDefault();options.forEach(item=>item.tabIndex=-1);options[next].tabIndex=0;options[next].focus();}
  }
  node(tag,text,cls) { const n=document.createElement(tag); if(text!==undefined)n.textContent=text; if(cls)n.className=cls; return n; }
  action(text,callback,cls) { const n=this.node('button',text,cls);n.type='button';n.onclick=callback;return n; }
  load(items,relations) {
    this.items = [...items].sort((a,b) => a.id.localeCompare(b.id));
    // Merge prerequisite and relation edges, deduplicating undirected visual connections.
    const edges = new Map();
    const add = (a,b) => { if (a===b || !items.some(k=>k.id===a) || !items.some(k=>k.id===b))return; const key=[a,b].sort().join(':');edges.set(key,{from:a,to:b}); };
    relations.forEach(r=>add(r.from,r.to)); items.forEach(k=>k.prerequisites.forEach(id=>add(id,k.id)));
    this.edges=[...edges.values()];
    const orbRoot=this.$('map-orbs'), nav=this.$('map-accessible'); orbRoot.replaceChildren(); nav.replaceChildren();
    const list=this.node('ol'); nav.append(list);
    this.items.forEach((k,i) => {
      const degree=this.edges.filter(e=>e.from===k.id || e.to===k.id).length;
      const size=78+Math.min(10,degree), angle=i*Math.PI*(3-Math.sqrt(5)), radius=64*Math.sqrt(i+.5);
      const x=540+radius*Math.cos(angle), y=500+radius*Math.sin(angle);
      const holder=this.node('div',undefined,'orb-node');
      holder.style.width=size+'px';holder.style.height=size+'px';holder.style.transform=`translate(${x-size/2}px,${y-size/2}px)`;
      const orb=this.action(undefined,()=>this.select(k.id),'knowledge-orb');
      orb.dataset.id=k.id;orb.id='orb-'+k.id;orb.setAttribute('aria-label',k.id+' '+k.title+'，'+k.chapter);orb.setAttribute('aria-expanded','false');orb.setAttribute('aria-controls','map-detail');
      orb.style.setProperty('--unit-color',this.colors[this.units.indexOf(k.chapter)]);
      orb.style.setProperty('--float-delay',(-i*.73)+'s');
      const face=this.node('span',undefined,'orb-face');face.append(this.node('span',k.id,'orb-id'),this.node('span',this.shortNames[i] || k.title,'orb-title'));orb.append(face);
      orb.addEventListener('focus',()=>this.ensureVisible(k.id));holder.append(orb);orbRoot.append(holder);
      this.nodes.set(k.id,{k,x,y,size,holder,orb});
      const li=this.node('li');const link=this.action(k.id+' '+k.title,()=>{this.setUnitValue('');this.filter(false);this.select(k.id);});link.tabIndex=-1;li.append(link);list.append(li);
    });
    const svg=this.$('map-lines');svg.replaceChildren();svg.setAttribute('viewBox','0 0 1080 1000');
    this.edges.forEach(edge=>{
      const a=this.nodes.get(edge.from),b=this.nodes.get(edge.to);const line=document.createElementNS('http://www.w3.org/2000/svg','line');
      Object.entries({x1:a.x,y1:a.y,x2:b.x,y2:b.y}).forEach(([key,value])=>line.setAttribute(key,value));
      line.dataset.from=edge.from;line.dataset.to=edge.to;svg.append(line);edge.line=line;
    });
    this.ready=true;this.filter(false);
    if(!this.$('knowledge-view').hidden)this.center();
  }
  center() { if(!this.ready)return; this.viewport.scrollTo({left:(1080-this.viewport.clientWidth)/2,top:(1000-this.viewport.clientHeight)/2,behavior:'instant'}); }
  ensureVisible(id,center=false) {
    const n=this.nodes.get(id);if(!n)return;
    const v=this.viewport, margin=n.size/2+12;
    const height=this.narrow.matches && !this.$('map-detail').hidden ? Math.max(100,Math.min(v.clientHeight,this.$('map-detail').getBoundingClientRect().top-v.getBoundingClientRect().top-12)) : v.clientHeight;
    if(center || n.x-margin<v.scrollLeft || n.x+margin>v.scrollLeft+v.clientWidth || n.y-margin<v.scrollTop || n.y+margin>v.scrollTop+v.clientHeight) {
      v.scrollTo({left:n.x-v.clientWidth/2,top:n.y-height/2,behavior:'instant'});
    }
  }
  filter(move=true) {
    const unit=this.$('map-unit').value, q=this.$('map-search').value.trim().toLowerCase();
    const matches=[];let visible=0;
    this.nodes.forEach(n=>{
      n.holder.hidden=!!unit && n.k.chapter!==unit;
      const hit=(n.k.id+' '+n.k.title+' '+this.shortNames[Number(n.k.id.slice(1))-1]).toLowerCase().includes(q);
      n.orb.classList.toggle('search-hit',!!q && hit);n.orb.classList.toggle('search-muted',!!q && !hit);
      if(!n.holder.hidden){visible++;if(hit)matches.push(n.k.id);}
    });
    this.highlight();
    this.$('map-message').textContent=!this.ready?'正在读取课程资料…':q?`找到 ${matches.length} 个匹配知识点`:`${visible} 个知识点 · 可拖动画布`;
    if(move && matches.length)this.ensureVisible(matches[0],true);
  }
  highlight() {
    const adjacent=new Set(this.edges.filter(e=>e.from===this.selected || e.to===this.selected).flatMap(e=>[e.from,e.to]));
    this.nodes.forEach((n,id)=>{
      n.orb.classList.toggle('selected',id===this.selected);n.orb.classList.toggle('related',id!==this.selected && adjacent.has(id));
      n.orb.classList.toggle('unrelated',!!this.selected && !adjacent.has(id) && id!==this.selected);
      n.orb.setAttribute('aria-expanded',String(id===this.selected));
    });
    this.edges.forEach(e=>{
      e.line.style.display=this.nodes.get(e.from).holder.hidden || this.nodes.get(e.to).holder.hidden?'none':'';
      e.line.classList.toggle('highlighted',e.from===this.selected || e.to===this.selected);
    });
  }
  accessibility() {
    const open=!this.$('map-detail').hidden, modal=open && this.narrow.matches;
    this.$('map-detail').setAttribute('role',modal?'dialog':'complementary');
    if(modal)this.$('map-detail').setAttribute('aria-modal','true');else this.$('map-detail').removeAttribute('aria-modal');
    for(const id of ['map-stage','map-controls','map-accessible','map-legend'])this.$(id).inert=modal;
    document.querySelector('.app-header').inert=modal;
    document.body.classList.toggle('map-detail-modal',modal);
    if(modal)this.$('detail-close').focus({preventScroll:true});
  }
  close(restore=true) {
    const previous=this.selected;const wasMobile=!this.$('map-detail').hidden && this.narrow.matches;this.sequence++;this.selected=null;
    this.$('map-detail').hidden=true;this.$('map-shell').classList.remove('detail-open');this.highlight();this.accessibility();
    if(wasMobile && this.pageScrollBeforeDetail!==undefined)window.scrollTo({top:this.pageScrollBeforeDetail,behavior:'instant'});
    if(restore && previous && !this.nodes.get(previous).holder.hidden)this.nodes.get(previous).orb.focus({preventScroll:true});
  }
  supplement(root,extra) {
    // Verified teaching supplement from 知识库补充草稿; each part folds so the panel stays scannable.
    if(!extra || !extra.sections?.length || !this.markdown)return;
    const part=this.node('section',undefined,'supplement');
    part.append(this.node('h3','深入学习'));
    const status=extra.verified===false?'代码与预期输出尚待R实测，请以本机运行结果为准':'代码与输出为离线R实测记录';
    part.append(this.node('p','分层例题、图解、易错案例和练习。'+status+(extra.difficulty?' · 难度：'+extra.difficulty:'')+'。','supplement-note'));
    const open=new Set(['学习目标','直观理解']);
    extra.sections.forEach(s=>{
      const fold=this.node('details',undefined,'supplement-part');fold.open=open.has(s.title);
      fold.append(this.node('summary',s.title));
      const body=this.node('div',undefined,'supplement-body');this.markdown(body,s.markdown,extra.verified!==false);fold.append(body);part.append(fold);
    });
    root.append(part);
  }
  async select(id) {
    const n=this.nodes.get(id);if(!n)return;
    if(n.holder.hidden){this.setUnitValue('');this.filter(false);}
    if(this.narrow.matches && this.$('map-detail').hidden)this.pageScrollBeforeDetail=window.scrollY;
    this.selected=id;const seq=++this.sequence;this.highlight();
    this.$('map-detail').hidden=false;this.$('map-shell').classList.add('detail-open');
    this.$('detail-body').replaceChildren(this.node('h2',id+' · '+n.k.title));
    this.$('detail-body').firstElementChild.id='detail-title';this.$('detail-body').append(this.node('p','正在读取课程资料…'));
    this.accessibility();
    if(this.narrow.matches)window.scrollTo({top:window.scrollY+this.viewport.getBoundingClientRect().top-72,behavior:'instant'});
    this.ensureVisible(id,true);this.$('detail-close').focus({preventScroll:true});
    try {
      const k=this.cache.get(id) || await this.api('/api/knowledge/'+encodeURIComponent(id));
      this.cache.set(id,k);if(seq!==this.sequence)return;
      const root=this.$('detail-body');root.replaceChildren();
      root.append(this.node('p',n.k.chapter,'eyebrow'));const title=this.node('h2',k.id+' · '+k.title);title.id='detail-title';root.append(title);
      const fields=k.fields || {};
      const section=(label,text)=>{if(!text)return;const part=this.node('section');part.append(this.node('h3',label),this.node('p',text));root.append(part);};
      section('概念讲解',fields['解释']);section('函数语法',fields['函数语法']);section('参数说明',fields['参数说明']);
      this.codeBlock(root,fields['运行示例'],'示例代码',true);section('易错点',fields['易错提醒']);
      this.supplement(root,k.enrichment);
      const sources=this.node('details');sources.append(this.node('summary','内容来源'));
      (k.sources||[]).forEach(c=>sources.append(this.node('p',c.file+' · '+c.locator)));root.append(sources);
      const related=this.edges.filter(e=>e.from===id || e.to===id).map(e=>e.from===id?e.to:e.from);
      const links=(label,ids)=>{const part=this.node('section');part.append(this.node('h3',label));const row=this.node('div',undefined,'detail-links');
        if(!ids.length)row.append(this.node('p','无'));ids.forEach(key=>{const target=this.nodes.get(key);if(target)row.append(this.action(key+' '+target.k.title,()=>this.select(key)));});part.append(row);root.append(part);};
      links('先修知识',n.k.prerequisites);links('相关知识',[...new Set(related)].filter(key=>!n.k.prerequisites.includes(key)));
      const actions=this.node('div',undefined,'detail-actions');
      const explain=this.action('在AI问答中讲解',()=>{this.close(false);this.explain(id);},'primary');
      const practice=this.action('给我一道练习',()=>{this.close(false);this.exercise(id);});
      explain.dataset.request='true';practice.dataset.request='true';actions.append(explain,practice);root.append(actions);
      root.scrollTop=0;
    } catch(error) {
      if(seq!==this.sequence)return;
      this.$('detail-body').replaceChildren(this.node('h2',id+' · '+n.k.title));this.$('detail-body').firstElementChild.id='detail-title';
      this.$('detail-body').append(this.node('p','知识详情读取失败，请确认本地服务已启动。'),this.action('重试',()=>this.select(id)));
    }
  }
}
window.KnowledgeMap=KnowledgeMap;
