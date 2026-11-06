// Synthetic routing check only. Does not exercise WebKit native wheel hit testing.
export async function coverage() {
  const d = window.__2048Debug, results = [];
  // Respect the real calibration; a diagnostic must not change physical direction.
  const factor = d.getTrackpadFactor() ?? 1;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const center = el => { const r=el.getBoundingClientRect(); return [r.x+r.width/2,r.y+r.height/2]; };
  for (const label of ['occupied','empty','score','button','left','right','above','below','background']) {
    await sleep(260);
    d.setBoard([[0,2,0,2],[0,0,0,0],[0,0,0,0],[0,0,0,0]]);
    const b=document.getElementById('boardWrap').getBoundingClientRect();
    const points={occupied:center(document.querySelector('.tile')),empty:center(document.querySelector('.cell')),
      score:center(document.getElementById('score')),button:center(document.getElementById('newGame')),
      left:[Math.max(1,b.left-20),b.y+b.height/2],right:[Math.min(innerWidth-1,b.right+20),b.y+b.height/2],
      above:[b.x+b.width/2,Math.max(1,b.top-10)],below:[b.x+b.width/2,Math.min(innerHeight-1,b.bottom+10)],background:[2,2]};
    const [x,y]=points[label],target=document.elementFromPoint(x,y);
    const n=d.getGestureSerial(),m=d.getAnimationState().moveSerial,scroll=[scrollX,scrollY];
    const before=d.getBoard();
    let delivered=false;
    const observe=event=>{if(event===e)delivered=true;};
    window.__safari2048?.mark(label);
    const e=new WheelEvent('wheel',{bubbles:true,composed:true,cancelable:true,deltaX:-25*factor,clientX:x,clientY:y});
    window.addEventListener('wheel',observe,{capture:true,passive:true});
    target.dispatchEvent(e);
    window.removeEventListener('wheel',observe,true);
    // Continuous tail including rogue magnitude and opposite direction must stay locked.
    for(const dx of [-10,-2,-30,25]) { await sleep(30);target.dispatchEvent(new WheelEvent('wheel',{bubbles:true,composed:true,cancelable:true,deltaX:dx*factor,clientX:x,clientY:y})); }
    await sleep(160);
    const after=d.getBoard();
    const row={label,x,y,delivered,trusted:e.isTrusted,before,after,boardChanged:JSON.stringify(before)!==JSON.stringify(after),target:target.tagName+'.'+target.className,commands:d.getGestureSerial()-n,moves:d.getAnimationState().moveSerial-m,
      prevented:e.defaultPrevented,scrolled:scrollX!==scroll[0]||scrollY!==scroll[1]};results.push(row);
    if(!row.delivered||!row.boardChanged||row.commands!==1||row.moves!==1||!row.prevented||row.scrolled)throw Error(JSON.stringify(row));
  }
  return results;
}
