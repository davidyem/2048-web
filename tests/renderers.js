// Experimental adapters only; run compare() on a disposable page. Canvas is a timing prototype, not a full visual replacement.
export async function compare() {
 const {Renderer}=await import('../js/renderer.js'); const {Game}=await import('../js/game.js');
 document.getElementById('tileLayer').replaceChildren();
 const r=new Renderer(),g=new Game({get:()=>0,set(){}}), frame=()=>new Promise(requestAnimationFrame);
 const scenarios=[[[0,2,0,2],[0,0,0,0],[0,0,0,0],[0,0,0,0]],[[2,2,4,4],[4,4,8,8],[8,8,16,16],[16,16,32,32]],[[0,2,0,0],[0,0,4,0],[0,0,0,8],[0,0,0,0]]];
 const summary={};
 for(const mode of ['baseline','sync-waapi','css','raf','canvas']) {
  const intervals=[],elapsed=[],first=[],skews=[];let last=0,run=true;const sample=t=>{if(last)intervals.push(t-last);last=t;if(run)requestAnimationFrame(sample)};requestAnimationFrame(sample);
  for(let n=0;n<24;n++) {
   let id=0;g.tiles=scenarios[n%3].flatMap((row,y)=>row.flatMap((value,x)=>value?[{id:++id,value,row:y,col:x,isNew:false}]:[]));r.renderAll(g.tiles);const res=g.calculateMove('left');await frame();await frame();
   const start=performance.now();requestAnimationFrame(()=>first.push(performance.now()-start));
   if(mode==='baseline') await r.moveTiles(g.tiles,res.motions);
   else if(mode==='sync-waapi') {const as=[],t=document.timeline.currentTime;for(const tile of g.tiles){const to=res.motions.get(tile.id),entry=r.activeTiles.get(tile.id);if(to.row===tile.row&&to.col===tile.col)continue;const a=entry.el.animate([{transform:r.tileTransform(tile.row,tile.col)},{transform:r.tileTransform(to.row,to.col)}],{duration:120,easing:'ease-in-out'});a.startTime=t;r.setTilePosition(entry,to.row,to.col);as.push(a)}await Promise.all(as.map(a=>a.finished));as.forEach(a=>a.cancel())}
   else if(mode==='css'){const ps=[];for(const tile of g.tiles){const to=res.motions.get(tile.id),entry=r.activeTiles.get(tile.id);if(to.row===tile.row&&to.col===tile.col)continue;entry.el.style.transition='transform 120ms ease-in-out';ps.push(new Promise(resolve=>entry.el.addEventListener('transitionend',resolve,{once:true})));r.setTilePosition(entry,to.row,to.col)}await Promise.all(ps);for(const e of r.activeTiles.values())e.el.style.transition=''}
   else {let canvas,ctx,gap,size;if(mode==='canvas'){canvas=document.createElement('canvas');const w=r.boardWrap.clientWidth;canvas.width=w*devicePixelRatio;canvas.height=w*devicePixelRatio;canvas.style.cssText='position:absolute;inset:0;width:100%;height:100%;z-index:3';r.boardWrap.append(canvas);ctx=canvas.getContext('2d');ctx.scale(devicePixelRatio,devicePixelRatio);r.tileLayer.style.visibility='hidden';gap=parseFloat(getComputedStyle(r.grid).columnGap);size=r.cellStep-gap}
    await new Promise(resolve=>{let origin;function tick(t){origin??=t;const p=Math.min(1,(t-origin)/120),e=p*p*(3-2*p);if(ctx)ctx.clearRect(0,0,canvas.width,canvas.height);for(const tile of g.tiles){const to=res.motions.get(tile.id),row=tile.row+(to.row-tile.row)*e,col=tile.col+(to.col-tile.col)*e;if(!ctx)r.setTilePosition(r.activeTiles.get(tile.id),row,col);else{const x=gap+col*r.cellStep,y=gap+row*r.cellStep;ctx.fillStyle='#eee4da';ctx.beginPath();ctx.roundRect(x,y,size,size,10);ctx.fill();ctx.fillStyle='#776e65';ctx.font='900 48px system-ui';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(tile.value,x+size/2,y+size/2)}}if(p<1)requestAnimationFrame(tick);else resolve()}requestAnimationFrame(tick)});if(canvas){canvas.remove();r.tileLayer.style.visibility=''}}
   elapsed.push(performance.now()-start);
   for(const id of res.removedIds)r.removeTileEl(id);g.applyMoveResult(res);r.syncTileValues(g.tiles);const tile=g.makeRandomTile();g.tiles.push(tile);r.tileElement(tile);await frame();
  }
  run=false;const q=(a,p)=>a.sort((a,b)=>a-b)[Math.min(a.length-1,Math.floor(a.length*p))];summary[mode]={samples:intervals.length,p95:q(intervals,.95),p99:q(intervals,.99),late:intervals.filter(t=>t>25).length,elapsedP50:q(elapsed,.5),elapsedP95:q(elapsed,.95),inputToRafP95:q(first,.95)};
 }
 r.clearTiles();r.resizeObserver.disconnect();return summary;
}
