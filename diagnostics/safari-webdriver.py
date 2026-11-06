#!/usr/bin/env python3
"""Real Safari Actions coverage; generated wheel input, NOT physical trackpad input.
Start /usr/bin/safaridriver -p 4447 first. Standard library only.
See README.md for the measured Safari Actions delta caveat.
"""
import argparse
import json
import time
import urllib.request

p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--driver', default='http://127.0.0.1:4447')
p.add_argument('--url', default='http://127.0.0.1:8001/?trace=1')
p.add_argument('--session', help='reuse an existing automation session')
p.add_argument('--rounds', type=int, default=3)
p.add_argument('--output', required=True, help='JSON evidence file outside the repository')
a = p.parse_args()


def request(path, data=None, method=None):
    req = urllib.request.Request(a.driver + path,
        data=None if data is None else json.dumps(data).encode(),
        headers={'Content-Type': 'application/json'}, method=method)
    with urllib.request.urlopen(req, timeout=45) as response:
        return json.load(response)['value']


session = a.session or request('/session', {'capabilities': {'alwaysMatch': {'browserName': 'Safari'}}})['sessionId']
base = '/session/' + session


def call(path, data=None, method=None):
    return request(base + path, data, method)


def js(script):
    return call('/execute/sync', {'script': script, 'args': []})


call('/url', {'url': a.url})
call('/window/rect', {'width': 1440, 'height': 1000})
# Release before measurement: Safari can emit an inverse wheel packet here.
call('/actions', method='DELETE')
ready = call('/execute/async', {'script': '''const done=arguments[0];
fetch('./diagnostics/safari.js').then(r=>r.text()).then(s=>eval(s)).then(done,e=>done({error:String(e)}));''', 'args': []})
if isinstance(ready, dict) and ready.get('error'):
    raise RuntimeError(ready)
js('''__2048Debug.setTrackpadFactor(-1);window.__nativeErrors=[];
window.addEventListener('error',e=>__nativeErrors.push(e.message));
window.addEventListener('unhandledrejection',e=>__nativeErrors.push(String(e.reason)));
Math.random=()=>0;''')
meta = js('return {ua:navigator.userAgent,url:location.href,hidden:document.hidden,viewport:[innerWidth,innerHeight]};')
points = js('''const b=document.getElementById('boardWrap').getBoundingClientRect(),
c=e=>{const r=e.getBoundingClientRect();return [Math.round(r.x+r.width/2),Math.round(r.y+r.height/2)]};
return {occupied:[Math.round(b.x+b.width*.375),Math.round(b.y+b.height*.375)],
empty:[Math.round(b.x+b.width*.125),Math.round(b.y+b.height*.125)],
left:[Math.round(b.left-20),Math.round(b.y+b.height/2)],right:[Math.round(b.right+20),Math.round(b.y+b.height/2)],
above:[Math.round(b.x+b.width/2),Math.round(b.top-10)],below:[Math.round(b.x+b.width/2),Math.min(innerHeight-1,Math.round(b.bottom+10))],
score:c(document.getElementById('score')),background:[20,20],button:c(document.getElementById('newGame'))};''')
board = [[0,0,0,0],[0,2,0,0],[0,0,4,0],[0,0,0,0]]
rows = []
ax = ay = 0
areas = ['occupied','empty','left','right','above','below','score','background','button']
try:
    for round_no in range(a.rounds):
        for area in areas:
            x, y = points[area]
            for direction, dx, dy in [('left',60,0),('right',-60,0),('up',0,60),('down',0,-60)]:
                label = f'{round_no}-{area}-{direction}'
                js('__2048Debug.setBoard('+json.dumps(board)+');__safari2048.mark('+json.dumps(label)+''');
window.__nativeBefore={g:__2048Debug.getGestureSerial(),m:__2048Debug.getAnimationState().moveSerial,t:performance.now()};''')
                # First round: fixed cursor within each region. Later: explicit movement.
                if round_no:
                    call('/actions', {'actions':[{'type':'pointer','id':'mouse','parameters':{'pointerType':'mouse'},
                        'actions':[{'type':'pointerMove','x':x,'y':y,'duration':0,'origin':'viewport'}]}]})
                time.sleep([.25,.4,.7][round_no % 3])
                # Safari 27.2 subtracts previous source scrollDelta; verified from
                # delivered packets and WebKit SimulatedInputDispatcher.cpp.
                # No wheel-source pause (it emits the inverse previous delta).
                ax += dx
                ay += dy
                call('/actions', {'actions':[{'type':'wheel','id':'wheel','actions':[
                    {'type':'scroll','x':x,'y':y,'deltaX':ax,'deltaY':ay,'duration':0,'origin':'viewport'}]}]})
                time.sleep(.18)
                result = js('''const r=__safari2048.report().records;
const marker=r.findLast(e=>e.type==='manual-attempt-marker');
const events=r.filter(e=>e.type==='window-handler-exit'&&e.label===marker.label);
const t=__2048Debug.traceLog().filter(t=>t.at>=__nativeBefore.t);
return {events:events.map(e=>({dx:e.dx,dy:e.dy,eventAt:e.eventAt,arrival:e.observedAt,trusted:e.trusted,target:e.target,
  cancelable:e.cancelable,prevented:e.prevented,path:e.path,recognizer:e.state})),
commands:__2048Debug.getGestureSerial()-__nativeBefore.g,moves:__2048Debug.getAnimationState().moveSerial-__nativeBefore.m,
board:__2048Debug.getBoard(),state:__2048Debug.getAnimationState(),trace:t,scroll:[scrollX,scrollY]};''')
                expected4 = {'left':(2,0),'right':(2,3),'up':(0,2),'down':(3,2)}[direction]
                commands = [t for t in result['trace'] if t['type']=='direction']
                events = result['events']
                passed = (len(events)==1 and events[0]['dx']==dx and events[0]['dy']==dy and events[0]['trusted']
                    and result['commands']==result['moves']==1 and len(commands)==1 and commands[0]['direction']==direction
                    and result['board'][expected4[0]][expected4[1]]==4
                    and sum(map(sum,result['board']))==8 and sum(v>0 for row in result['board'] for v in row)==3
                    and not result['state']['active'] and result['state']['pendingDirection'] is None
                    and sum(t['type']=='commit' for t in result['trace'])==1 and result['scroll']==[0,0])
                rows.append({'label':label,'x':x,'y':y,'requested':[dx,dy],'pass':passed,**result})
        print(json.dumps({'round':round_no+1,'cases':len(rows),'passed':sum(r['pass'] for r in rows)}), flush=True)
finally:
    report = {'environment':meta,'method':'Safari WebDriver Actions, cumulative-delta adapter, not hardware',
        'cases':rows,'errors':js('return __nativeErrors;')}
    with open(a.output,'w') as out:
        json.dump(report,out,indent=2)
    # Keep the session open for screenshots. Reload restores Math.random and probes.
    call('/refresh', {})
print(json.dumps({'cases':len(rows),'passed':sum(r['pass'] for r in rows),'errors':report['errors'],'output':a.output}))
