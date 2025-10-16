// CubeAnimator.js
//@input SceneObject cubeRoot
//@input float spacing = 1.0
//@input float turnDuration = 0.25
//@input float holdAfterMove = 0.02
//@input string moveString = "R' U F2 D L' B"
//@input bool runOnTurnOn = true
//@input bool runOnTap = false

var LOG = "[Animator] ";
var moveQueue = [];
var isTurning = false;
var currentTurn = null;

function log(s){ print("[CubeAnimator.js] " + LOG + s); }

// Events
/////////
if (script.runOnTap) {
    var tap = script.createEvent("TapEvent");
    tap.bind(function(){
        log("Tap -> starting sequence");
        queueMoves(script.moveString);
    });
}

var onTurnOn = script.createEvent("TurnOnEvent");
onTurnOn.bind(function(){
    log("TurnOn -> starting sequence");
    if (script.runOnTurnOn) {
        queueMoves(script.moveString);
    }
});

// Helpers
//////////
function getCubies(){
    if (!script.cubeRoot) { log("ERROR: cubeRoot not set"); return []; }
    var list = [];
    var n = script.cubeRoot.getChildrenCount();
    for (var i=0; i<n; i++){
        var child = script.cubeRoot.getChild(i);
        if (!child) { continue; }
        var nm = child.name || "";
        if (nm.indexOf("__Pivot_") === 0) { continue; }
        list.push(child);
    }
    return list;
}

function axisFor(face){
    if (face === "U" || face === "D") return new vec3(0,1,0);
    if (face === "R" || face === "L") return new vec3(1,0,0);
    return new vec3(0,0,1); // F/B
}
function signFor(face){
    if (face === "U" || face === "R" || face === "F") return +1;
    if (face === "D" || face === "L" || face === "B") return -1;
    return +1;
}
function angleFor(face, suffix){
    var cw = 90;
    var baseSign = signFor(face);
    var dir = (suffix === "'") ? -1 : +1;
    var mul = (suffix === "2") ? 2 : 1;
    return -(cw * baseSign * dir * mul);
}

function pickFaceCubies(face){
    var axis = axisFor(face);
    var sgn = signFor(face);
    var cubies = getCubies();
    if (cubies.length === 0){ log("WARN: no cubies found under cubeRoot"); return []; }

    // find extreme plane along axis
    var extreme = -1e9;
    for (var i=0;i<cubies.length;i++){
        var p = cubies[i].getTransform().getLocalPosition();
        var v = axis.x*p.x + axis.y*p.y + axis.z*p.z;
        var val = (sgn>0)? v : -v;
        if (val > extreme) { extreme = val; }
    }
    if (sgn<0) extreme = -extreme;

    var tol = script.spacing * 0.2;
    var layer = [];
    for (var j=0;j<cubies.length;j++){
        var pj = cubies[j].getTransform().getLocalPosition();
        var vj = axis.x*pj.x + axis.y*pj.y + axis.z*pj.z;
        if (Math.abs(vj - extreme) <= tol){
            layer.push(cubies[j]);
        }
    }
    if (layer.length !== 9){
        // fallback: closest 9 to the plane
        layer.sort(function(a,b){
            var pa = a.getTransform().getLocalPosition();
            var va = axis.x*pa.x + axis.y*pa.y + axis.z*pa.z;
            var pb = b.getTransform().getLocalPosition();
            var vb = axis.x*pb.x + axis.y*pb.y + axis.z*pb.z;
            return Math.abs(va - extreme) - Math.abs(vb - extreme);
        });
        layer = layer.slice(0,9);
    }

    log("pickFaceCubies " + face + " -> [" + layer.map(function(o){return o.name;}).join(", ") + "]");
    return layer;
}

function makePivot(face, targets){
    var pivot = global.scene.createSceneObject("__Pivot_" + face);
    pivot.setParent(script.cubeRoot);

    // average local position for pivot center
    var c = new vec3(0,0,0);
    for (var i=0;i<targets.length;i++){
        c = c.add(targets[i].getTransform().getLocalPosition());
    }
    c = c.uniformScale(1.0 / Math.max(1, targets.length));

    var ptr = pivot.getTransform();
    ptr.setLocalPosition(c);
    ptr.setLocalRotation(quat.fromEulerAngles(0,0,0));
    pivot.__baseLocalRot = ptr.getLocalRotation();

    // reparent targets under pivot, preserve world transform
    for (var j=0;j<targets.length;j++){
        var t = targets[j].getTransform();
        var wp = t.getWorldPosition();
        var wr = t.getWorldRotation();
        var ws = t.getWorldScale();
        targets[j].setParent(pivot);
        t.setWorldPosition(wp);
        t.setWorldRotation(wr);
        t.setWorldScale(ws);
    }
    return pivot;
}

function snapAllToGrid(){
    var cubies = getCubies();
    var s = script.spacing;
    for (var i=0;i<cubies.length;i++){
        var tr = cubies[i].getTransform();
        var p = tr.getLocalPosition();
        p = new vec3(
            Math.round(p.x/s)*s,
            Math.round(p.y/s)*s,
            Math.round(p.z/s)*s
        );
        tr.setLocalPosition(p);

        // snap rotation to nearest 90 degree
        var e = tr.getLocalRotation().toEulerAngles();
        function snap90(rad){
            var deg = rad*180/Math.PI;
            var k = Math.round(deg/90)*90;
            return k*Math.PI/180;
        }
        tr.setLocalRotation(quat.fromEulerAngles(snap90(e.x), snap90(e.y), snap90(e.z)));
    }
}

function bakeAndDestroyPivot(pivot){
    // move all children back to cubeRoot preserving world xform
    var count = pivot.getChildrenCount();
    var kids = [];
    for (var i=0;i<count;i++){ kids.push(pivot.getChild(i)); }

    for (var k=0;k<kids.length;k++){
        var tr = kids[k].getTransform();
        var wp = tr.getWorldPosition();
        var wr = tr.getWorldRotation();
        var ws = tr.getWorldScale();
        kids[k].setParent(script.cubeRoot);
        tr.setWorldPosition(wp);
        tr.setWorldRotation(wr);
        tr.setWorldScale(ws);
    }
    pivot.destroy();
    snapAllToGrid();
}

// Queue / parsing
//////////////////
function tokToString(t){ return t.face + (t.suffix||""); }

function tokenize(s){
    s = (s||"").replace(/\s+/g," ").trim();
    if (!s) return [];
    var raw = s.split(" ");
    var out = [];
    for (var i=0;i<raw.length;i++){
        var m = raw[i].match(/^([URFDLB])(2|')?$/);
        if (!m){
            log("WARN skipping token: " + raw[i]);
            continue;
        }
        out.push({face:m[1], suffix:m[2]||""});
    }
    return out;
}

function queueMoves(str){
    var tokens = tokenize(str);
    for (var i=0;i<tokens.length;i++){ moveQueue.push(tokens[i]); }
    log("queued: " + tokens.map(tokToString).join(" "));
    tryPump();
}

function tryPump(){
    if (!isTurning && moveQueue.length>0){
        startNextMove();
    }
}

// Turn lifecycle
/////////////////
function startNextMove(){
    if (moveQueue.length === 0) { return; }

    var mv = moveQueue.shift();
    var face = mv.face;
    var suffix = mv.suffix;

    // re-pick membership fresh from current positions
    var targets = pickFaceCubies(face);
    if (targets.length !== 9){
        log("ERROR: expected 9 cubies for face " + face + ", got " + targets.length);
        return;
    }

    var axis = axisFor(face);
    var deg = angleFor(face, suffix);
    var pivot = makePivot(face, targets);

    currentTurn = {
        face: face,
        suffix: suffix,
        pivot: pivot,
        axis: axis,
        targetAngle: deg,
        startTime: getTime()
    };
    isTurning = true;
    log("start " + tokToString(mv) + " angle=" + deg);
}

var update = script.createEvent("UpdateEvent");
update.bind(function(){
    if (!isTurning) { return; }

    var tNorm = (getTime() - currentTurn.startTime) / script.turnDuration;
    if (tNorm > 1) tNorm = 1;

    var q = quat.angleAxis((currentTurn.targetAngle*Math.PI/180) * tNorm, currentTurn.axis);
    var tr = currentTurn.pivot.getTransform();
    tr.setLocalRotation( currentTurn.pivot.__baseLocalRot.multiply(q) );

    if (tNorm >= 1){
        // finalize exact angle
        var qFinal = quat.angleAxis(currentTurn.targetAngle*Math.PI/180, currentTurn.axis);
        tr.setLocalRotation( currentTurn.pivot.__baseLocalRot.multiply(qFinal) );

        var finished = currentTurn;
        isTurning = false;
        currentTurn = null;

        delayed(script.holdAfterMove, function(){
            bakeAndDestroyPivot(finished.pivot);
            log("done " + finished.face + (finished.suffix||""));
            tryPump();
        });
    }
});

function delayed(sec, fn){
    var ev = script.createEvent("DelayedCallbackEvent");
    ev.reset(sec);
    ev.bind(function(){ try { fn(); } catch(e){ log("Delayed error: " + e); } ev.enabled = false; });
}
