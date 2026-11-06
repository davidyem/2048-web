// Run in a visible browser at /?trace=1: await (await import('./tests/browser.js')).run()
export async function run() {
  if (document.getElementById('trackpadSetup').classList.contains('show'))
    throw Error('Complete or skip trackpad setup before running tests; tests preserve your calibration.');
  const d = window.__2048Debug, sleep = ms => new Promise(r => setTimeout(r, ms));
  const frame = () => new Promise(requestAnimationFrame), results = [];
  const assert = (name, pass, detail) => { results.push({ name, pass: Boolean(pass), detail }); if (!pass) throw Error(JSON.stringify(results)); };
  const sparse = [[0,2,0,2],[0,0,0,0],[0,0,0,0],[0,0,0,0]];
  const boardEl = document.getElementById('boardWrap');
  const key = key => window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  const pointer = (type, x, y, extra = {}) => boardEl.dispatchEvent(new PointerEvent(type, { pointerId: 1, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y, bubbles: true, cancelable: true, ...extra }));
  const originalRandom = Math.random; let seed = 2048;
  Math.random = () => ((seed = (Math.imul(seed,1664525)+1013904223)>>>0)/2**32);
  try {
    for (const [name, x, y, expected] of [['left',-80,0,'left'],['right',80,0,'right'],['up',0,-80,'up'],['down',0,80,'down']]) {
      d.setBoard(sparse); const n=d.getGestureSerial();pointer('pointerdown',200,200);pointer('pointermove',200+x,200+y);pointer('pointerup',200+x,200+y);pointer('pointerup',200+x,200+y);
      assert('one touch '+name,d.getGestureSerial()===n+1&&document.documentElement.dataset.lastGesture===expected);await sleep(250);
    }
    let n=d.getGestureSerial();pointer('pointerdown',200,200);pointer('pointercancel',100,200);pointer('pointerup',100,200);
    assert('cancel no command',d.getGestureSerial()===n);
    pointer('pointerdown',200,200);pointer('pointerdown',220,200,{pointerId:2,isPrimary:false});pointer('pointerup',100,200);
    assert('multitouch cancels',d.getGestureSerial()===n);
    d.setBoard(sparse);d.move('left');let serial=d.getAnimationState().moveSerial;
    const durations=document.getAnimations().filter(a=>a.effect.target.classList.contains('tile')).map(a=>a.effect.getTiming().duration);
    assert('common duration',new Set(durations).size===1,durations);
    const movements=document.getAnimations().filter(a=>a.effect.target.classList.contains('tile'));
    assert('shared movement timeline',movements.length===2&&new Set(movements.map(a=>a.startTime)).size===1);
    // Live computed-style reads are sequential; WebKit can advance between them.
    // Compare interpolation at a held timestamp, then test live monotonic motion.
    movements.forEach(a=>a.pause());await Promise.all(movements.map(a=>a.ready));
    for(const t of [30,60,90]) {
      movements.forEach(a=>{a.currentTime=t;});
      const x=movements.map(a=>new DOMMatrix(getComputedStyle(a.effect.target).transform).m41);
      assert('equal progress at '+t,Math.abs(x[0]*3-x[1])<.02,x);
    }
    const restartAt=document.timeline.currentTime;
    movements.forEach(a=>{a.currentTime=0;a.play();a.startTime=restartAt;});
    const samples=[];
    while(d.getAnimationState().active){await frame();samples.push([...document.querySelectorAll('.tile')].map(el=>({id:el.dataset.id,x:new DOMMatrix(getComputedStyle(el).transform).m41})));}
    assert('single commit',d.getAnimationState().moveSerial===serial);
    assert('merge and one spawn',d.getBoard().flat().filter(Boolean).length===2&&d.getBoard()[0][0]===4);
    const moving = samples.filter(s => s.length === 2 && s[0].id === samples[0][0].id && s[1].id === samples[0][1].id);
    assert('live monotonic frames', moving.every((s,i) => !i || s.every((tile,j)=>tile.x<=moving[i-1][j].x+.01)), samples);
    d.setBoard([[2,0,0,0],[0,0,0,0],[0,0,0,0],[0,0,0,0]]);serial=d.getAnimationState().moveSerial;d.move('left');await sleep(180);
    assert('unchanged no spawn',d.getAnimationState().moveSerial===serial&&d.getBoard().flat().filter(Boolean).length===1);
    d.setBoard(sparse);d.move('left');serial=d.getAnimationState().moveSerial;await sleep(65);key('ArrowDown');key('ArrowRight');await sleep(350);
    assert('latest only',d.getAnimationState().moveSerial===serial+1&&!d.getAnimationState().pendingDirection);
    d.setBoard(sparse);d.move('left');serial=d.getAnimationState().moveSerial;key('ArrowDown');
    const blocked=performance.now();while(performance.now()-blocked<180){} // delayed completion must not replay stale intent
    await sleep(200);assert('expired command dropped',d.getAnimationState().moveSerial===serial);
    d.setBoard(sparse);d.move('left');key('ArrowDown');document.getElementById('newGame').click();const reset=JSON.stringify(d.getBoard());await sleep(350);
    assert('reset cancels old callbacks',JSON.stringify(d.getBoard())===reset&&d.getBoard().flat().filter(Boolean).length===2&&!d.getAnimationState().active);
    d.setBoard([[1024,1024,0,0],[0,0,0,0],[0,0,0,0],[0,0,0,0]]);key('a');await sleep(250);
    assert('win overlay',document.getElementById('overlay').classList.contains('show')&&!document.getElementById('continueBtn').hidden);
    serial=d.getAnimationState().moveSerial;key('d');assert('win blocks input',d.getAnimationState().moveSerial===serial);
    document.getElementById('continueBtn').click();key('d');await sleep(250);assert('continue resumes',d.getAnimationState().moveSerial===serial+1);
    d.setBoard([[2,4,8,16],[4,8,16,32],[8,16,32,64],[2,2,4,8]]);d.move('left');await sleep(250);
    // Exercise actual game-over with deterministic spawn in the last hole.
    d.setBoard([[2,4,8,16],[4,8,16,32],[8,16,32,64],[2,2,8,16]]);Math.random=()=>.99;d.move('left');await sleep(250);
    assert('game over',document.getElementById('overlayTitle').textContent==='Game over'&&document.getElementById('overlay').classList.contains('show'));
    document.getElementById('newGame').click();d.setBoard(sparse);key('ArrowLeft');await sleep(900);
    const saved=JSON.parse(localStorage.getItem('2048-game-state-v1'));
    assert('persistence',saved.tiles.reduce((a,t)=>a+t.value,0)===d.getBoard().flat().reduce((a,b)=>a+b,0));
    for(let i=0;i<2000;i++){d.setBoard(sparse);d.move(i%2?'right':'left');d.finishAnimation();if(i%100===0)await sleep(0);}
    await sleep(250);const stats=d.getRendererState();assert('bounded pool and animations',stats.retainedTileElements<=16&&stats.activeMovementAnimations===0&&stats.activePulseAnimations===0,stats);
    assert('bounded diagnostics',d.traceLog().length<=512);
    return results;
  } finally { Math.random=originalRandom; }
}
