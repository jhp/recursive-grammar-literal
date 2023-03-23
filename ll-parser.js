let { cata, I, K, constructors } = require("church-cat");

let nodeSchema = ({
    left: [I],
    right: [I],
    seq: [I, I],
    eps: [],
    tok: [K, K],
    placeholder: []
});

let { left: LeftN, right: RightN, seq: SeqN, eps: EpsN, tok: TokN, placeholder: PlaceholderN } = constructors( nodeSchema );

let fixGrammarCata = cataF => {
    let memo = new WeakMap();
    return function(gmr) {
        if(memo.has(gmr)) return memo.get(gmr);
        let f, done = false;
        while(!done) {
            let old = f;
            done = true;
            f = cata({
                alt: function(l,r) { 
                    return up => {
                        let lv = l([old ? old(this) : null, up]), rv = r([old ? old(this) : null, up]);
                        if(old && this({alt: (l,r) => old(l) === lv && old(r) === rv})) {
                            return old(this);
                        } else {
                            done = false;
                            return cataF(gmr).alt.call(this, lv,rv);
                        }
                    }
                },
                seq: function(l,r) {
                    return up => {
                        let lv = l([old ? old(this) : null, up]), rv = r([old ? old(this) : null, up]);
                        if(old && this({seq: (l,r) => old(l) === lv && old(r) === rv})) {
                            return old(this);
                        } else {
                            done = false;
                            return cataF(gmr).seq.call(this, lv,rv);
                        }
                    }
                },
                tok: function(t) { return up => old ? old(this) : cataF(gmr).tok.call(this, t) },
                jump: (n) => up => { let lst = up; while(--n > 0) lst = lst[1]; return lst[0]; },
                eps: function() { return up => old ? old(this) : cataF(gmr).eps.call(this) }
            }, []);
            f(gmr, gmr);
        }
        memo.set(gmr, f);
        return (g) => f(gmr, g);
    };
}
    

let emptyNode = fixGrammarCata(gmr => {
    tok: () => null,
    eps: () => EpsN(),
    alt: (l,r) => l && LeftN(l) || r && RightN(r),
    seq: (l,r) => l && r && SeqN(l,r)
});

let emptyOrPlaceholder = fixGrammarCata(gmr => {
    tok: () => PlaceholderN(),
    eps: () => EpsN(),
    seq: (l,r) => SeqN(l,r),
    alt: function(l,r) { return this({alt: (l,r) => emptyNode(gmr)(l) || emptyNode(gmr)(r) || PlaceholderN()}); }
});

let firstSet = fixGrammarCata(gmr => {
    eps: () => new Set(),
    tok: (t) => new Set([t]),
    seq: function(l,r) { return this({seq: (lo,ro) => emptyNode(gmr)(lo) ? new Set([...l, ...r]) : l}); },
    alt: (l,r) => new Set([...l, ...r])
});

let resolveJumps = (gs) => gs[0]({
    jump: (n) => { let lst = gs; while(n-- > 0) lst = lst[1]; return lst; },
    alt: () => gs,
    seq: () => gs,
    tok: () => gs,
    eps: () => gs
});

let nodeGrammar = (function(memo) {
    return (gmr, nodeParent, node) => {
        if(!memo.has(gmr)) {
            memo.set(gmr, cata({
                left: (l) => up => (l(resolveJumps([up[0]({alt: (l,r) => l}), up])), up[0]),
                right: (r) => up => (r(resolveJumps([up[0]({alt: (l,r) => r}), up])), up[0]),
                seq: (l,r) => up => (l(resolveJumps([up[0]({seq: (l,r) => l}), up])), r(resolveJumps([up[0]({seq: (l,r) => r}), up])), up[0]),
                eps: () => up => up[0],
                tok: () => up => up[0],
                placeholder: () => up => up[0]
            }, [gmr]));
        }
        return memo.get(gmr)(nodeParent, node);
    }
})(new Map());

function tokType(n) { return n({tok: (t) => t}) }

let llParser = (gmr) => {
    return cata({
        eps: () => up => input => [EpsN(), input],
        tok: (t) => up => input => {
            if(input.length && tokType(input[0]) === t) {
                return [input[0], input[1]];
            } else {
                throw new Error(`Parse failed trying to match token ${t} with ${tokType(input[0])}`);
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
                let [lset, rset] = this({alt: (l,r) => [firstSet(gmr)(l), firstSet(gmr)(r)]});
                fn = (input) => { 
                    if(input.length) {
                        if(lset.has(tokType(input[0]))) {
                            let [v,rem] = lv(input);
                            return [LeftN(v), rem];
                        } else if(rset.has(tokType(input[0]))) {
                            let [v,rem] = rv(input);
                            return [RightN(v), rem];
                        } 
                    }
                    if(emptyNode(gmr)(this)) {
                        return [emptyNode(gmr)(this), input];
                    } else {
                        throw new Error("Parse failed: end of input");
                    }
                }
                return fn;
            }
        }
    }, [])(gmr);
};

function extractValue(gmr, adt, fns, ftoken, fplaceholder) {
    nodeGrammar(gmr, adt);
    function runFns(adt, args) {
        let g = nodeGrammar(gmr, adt);
        if(fns.has(g)) return [fns.get(g)(args)];
        return args;
    }
    return cata({
        left: function(l) { return runFns(this, l) },
        right: function(r) { return runFns(this, r) },
        seq: function(l,r) { return runFns(this, [...l, ...r]) },
        tok: function(t, v) { return runFns(this, [this]) },
        eps: function() { return runFns(this, []) },
        placeholder: function() { return fplaceholder() }
    })(adt, adt)[0];
}

module.exports = {llParser, extractValue, LeftN, RightN, SeqN, EpsN, TokN, PlaceholderN, nodeSchema, emptyNode, emptyOrPlaceholder, nodeGrammar };
