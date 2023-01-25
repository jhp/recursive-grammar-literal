let { cata, I, K, constructors } = require("church-cat");

let nodeSchema = ({
    left: [I],
    right: [I],
    seq: [I, I],
    eps: [],
    tok: [K]
});

let { left: LeftN, right: RightN, seq: SeqN, eps: EpsN, tok: TokN } = constructors( nodeSchema );

let emptyNode = function(gmr) {
    let f = () => null, done = false;
    while(!done) {
        let old = f;
        done = true;
        f = cata(gmr, {
            alt: function(l,r) { 
                return up => {
                    let lv = l([old(this), up]), rv = r([old(this), up]);
                    let res = (lv && LeftN(lv)) || (rv && RightN(rv)) ;
                    done = done && Boolean(res) === Boolean(old(this));
                    return res;
                }
            },
            seq: function(l,r) {
                return up => {
                    let lv = l([old(this), up]), rv = r([old(this), up]);
                    let res = lv && rv && SeqN(lv, rv);
                    done = done && Boolean(res) === Boolean(old(this));
                    return res;
                }
            },
            tok: (t) => up => null,
            jump: (n) => up => { let lst = up; while(--n > 0) lst = lst[1]; return lst[0]; },
            eps: () => up => EpsN()
        }, []);
        f(gmr);
    }
    return f;
};

let firstSet = function(gmr, emptyNodeG) {
    let f = () => new Set(), done = false;
    while(!done) {
        let old = f;
        done = true;
        f = cata(gmr, {
            alt: function(l,r) {
                return up => {
                    let res = new Set([...l([old(this), up]), ...r([old(this), up])]);
                    done = done && old(this).size === res.size;
                    return res;
                }
            },
            seq: function(l,r) {
                return up => {
                    let lv = l([old(this), up]);
                    let rv = r([old(this), up]);
                    let res = this({seq: (lo,ro) => emptyNodeG(lo) ? new Set([...lv, ...rv]) : lv});
                    done = done && old(this).size === res.size;
                    return res;
                }
            },
            tok: (t) => up => new Set([t]),
            jump: n => up => { let lst = up; while(--n > 0) lst = lst[1]; return lst[0]; },
            eps: () => up => new Set()
        }, []);
        f(gmr);
    }
    return f;
};

let resolveJumps = (gs) => gs[0]({
    jump: (n) => { let lst = gs; while(n-- > 0) lst = lst[1]; return lst; },
    alt: () => gs,
    seq: () => gs,
    tok: () => gs,
    eps: () => gs
});

let nodeGrammar = (gmr, node) => {
    return cata(node, {
        left: (l) => up => (l(resolveJumps([up[0]({alt: (l,r) => l}), up])), up[0]),
        right: (r) => up => (r(resolveJumps([up[0]({alt: (l,r) => r}), up])), up[0]),
        seq: (l,r) => up => (l(resolveJumps([up[0]({seq: (l,r) => l}), up])), r(resolveJumps([up[0]({seq: (l,r) => r}), up])), up[0]),
        eps: () => up => up[0],
        tok: () => up => up[0]
    }, [gmr]);
}

let llParser = gmr => {
    let emptyNodeG = emptyNode(gmr);
    let firstSetG = firstSet(gmr, emptyNodeG);
    return cata(gmr, {
        eps: () => up => input => [EpsN(), input],
        tok: (t) => up => input => {
            if(input.length && input[0].type === t) {
                return [TokN(input[0]), input[1]];
            } else {
                throw new Error(`Parse failed trying to match token ${t} with ${input[0].type}`);
            }
        },
        jump: (n) => up => { let lst = up; while(--n > 0) lst = lst[1]; return (input) => lst[0](input); },
        seq: (l,r) => up => {
            let fn;
            let lv = l([(input) => fn(input), up]);
            let rv = r([(input) => fn(input), up]);
            fn = (input) => {
                let [v1, rem1] = lv(input);
                let [v2, rem2] = rv(rem1);
                return [SeqN(v1, v2), rem2];
            }
            return fn;
        },
        alt: function(l,r) {
            return up => {
                let fn;
                let lv = l([(input) => fn(input), up]);
                let rv = r([(input) => fn(input), up]);
                let [lset, rset] = this({alt: (l,r) => [firstSetG(l), firstSetG(r)]});
                fn = (input) => { 
                    if(input.length) {
                        if(lset.has(input[0].type)) {
                            let [v,rem] = lv(input);
                            return [LeftN(v), rem];
                        } else if(rset.has(input[0].type)) {
                            let [v,rem] = rv(input);
                            return [RightN(v), rem];
                        } 
                    }
                    if(emptyNodeG(this)) {
                        return [emptyNodeG(this), input];
                    } else {
                        throw new Error("Parse failed: end of input");
                    }
                }
                return fn;
            }
        }
    }, [])(gmr);
};

function extractValue(gmr, adt, fns) {
    let nodeGrammarF = nodeGrammar(gmr, adt);
    function runFns(adt, args) {
        let g = nodeGrammarF(adt);
        if(fns.has(g)) return [fns.get(g)(args)];
        return args;
    }
    return cata(adt, {
        left: function(l) { return runFns(this, l) },
        right: function(r) { return runFns(this, r) },
        seq: function(l,r) { return runFns(this, [...l, ...r]) },
        tok: function(t) { return runFns(this, [t.value]) },
        eps: function() { return runFns(this, []) }
    })(adt)[0];
}

module.exports = {llParser, extractValue};
