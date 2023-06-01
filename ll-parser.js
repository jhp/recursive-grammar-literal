let { cata, I, K, constructors, getSchema, tagWithSchema } = require("church-cat");

let nodeSchema = ({
    left: [I],
    right: [I],
    seq: [I, I],
    eps: [],
    tok: [K, K],
    placeholder: []
});

let { left: LeftN, right: RightN, seq: SeqN, eps: EpsN, tok: TokN, placeholder: PlaceholderN } = constructors( nodeSchema );

let deepCopy = function(adt) {
    let schema = getSchema(adt);
    let ctors = constructors(schema);
    return f(adt);
    function f(adt) {
        return adt(Object.fromEntries(
            Object.entries(schema).map(
                ([key, argTypes]) => [
                    key, 
                    (...args) => {
                        let children = argTypes.map((t,ii) => t({I: () => f(args[ii]), K: () => args[ii]}));
                        return ctors[ key ](...children);
                    }
                ]
            )
        ));
    }
}

let fixGrammarCata = (cataF, def=() => null, eq=(l,r) => l === r) => {
    let memo = new WeakMap();
    return function(gmr) {
        if(memo.has(gmr)) return memo.get(gmr);
        let f, done = false, N = 500;
        while(!done) {
            if(N-- === 0) throw new Error("Ran out of tries");
            let old = f;
            done = true;
            f = cata({
                alt: function(l,r) { 
                    return up => {
                        let lv = l([old ? old(gmr, this) : def(), up]), rv = r([old ? old(gmr, this) : def(), up]);
                        if(old && this({alt: (l,r) => eq(old(gmr, l), lv) && eq(old(gmr, r), rv)})) {
                            return old(gmr, this);
                        } else {
                            done = false;
                            return cataF(gmr).alt.call(this, lv,rv);
                        }
                    }
                },
                seq: function(l,r) {
                    return up => {
                        let lv = l([old ? old(gmr, this) : def(), up]), rv = r([old ? old(gmr, this) : def(), up]);
                        if(old && this({seq: (l,r) => eq(old(gmr, l), lv) && eq(old(gmr, r), rv)})) {
                            return old(gmr, this);
                        } else {
                            done = false;
                            return cataF(gmr).seq.call(this, lv,rv);
                        }
                    }
                },
                tok: function(t) { return up => old ? old(gmr, this) : cataF(gmr).tok.call(this, t) },
                jump: (n) => up => { let lst = up; while(--n > 0) lst = lst[1]; return lst[0]; },
                eps: function() { return up => old ? old(gmr, this) : cataF(gmr).eps.call(this) }
            }, []);
            f(gmr, gmr);
        }
        memo.set(gmr, (g) => f(gmr, g));
        return memo.get(gmr);
    };
}

let emptyNode = fixGrammarCata(gmr => ({
    tok: () => null,
    eps: () => EpsN(),
    alt: (l,r) => l && LeftN(l) || r && RightN(r),
    seq: (l,r) => l && r && SeqN(l,r)
}), () => null, (l,r) => Boolean(l) === Boolean(r));

let emptyOrPlaceholder = fixGrammarCata(gmr => ({
    tok: (t) => t === '(' || t === ',' || t === ')' ? TokN(t, t) : PlaceholderN(),
    eps: () => EpsN(),
    seq: (l,r) => SeqN(l,r),
    alt: function(l,r) { return this({alt: (l,r) => (emptyNode(gmr)(l) && LeftN(deepCopy(emptyNode(gmr)(l))))
                                                || (emptyNode(gmr)(r) && RightN(deepCopy(emptyNode(gmr)(r)))) 
                                                || PlaceholderN()}); }
}), () => PlaceholderN(), (l,r) => 
    l({left: () => 1, right: () => 2, seq: () => 3, placeholder: () => 4, eps: () => 5, tok: () => 6}) === r({left: () => 1, right: () => 2, seq: () => 3, placeholder: () => 4, eps: () => 5, tok: () => 6}));

let firstSet = fixGrammarCata(gmr => ({
    eps: () => new Set(),
    tok: (t) => new Set([t]),
    seq: function(l,r) { return this({seq: (lo,ro) => emptyNode(gmr)(lo) ? new Set([...l, ...r]) : l}); },
    alt: (l,r) => new Set([...l, ...r])
}), () => new Set(), (l,r) => l.size === r.size);

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

let ll_reverse = ll => { let out = []; for(; ll.length; ll = ll[1]) { out = [ll[0], out]; } return out; };

function tryPlaceholder(inner) {
    let fn;
    let innerFn = inner((input) => fn(input));
    fn = (input) => {
        if(input.length && tokType(input[0]) === '#(') {
            let phCore = [], subInput = input[1];
            while(subInput.length && tokType(subInput[0]) !== '#)') {
                phCore = [subInput[0], phCore];
                subInput = subInput[1];
            }
            try {
                innerFn(ll_reverse(phCore));
                return [PlaceholderN(), subInput[1]];
            } catch(e) {
                if(e.message === `Parse failed: end of input`) {
                    return innerFn(input);
                } else {
                    throw e;
                }
            }
        } else {
            return innerFn(input);
        }
    };
    return fn;
}

let llParserCata = cata(gmr => ({
    eps: () => up => input => [EpsN(), input],
    tok: (t) => up => tryPlaceholder(fn => input => {
        if(input.length && tokType(input[0]) === t) {
            return [input[0], input[1]];
        } else {
            throw new Error(`Parse failed trying to match token ${t} with ${tokType(input[0])}`);
        }
    }),
    jump: (n) => up => { let lst = up; while(--n > 0) lst = lst[1]; return tryPlaceholder(fn => (input) => lst[0](input)); },
    seq: (l,r) => up => tryPlaceholder(fn => {
        let lv = l([(input) => fn(input), up]);
        let rv = r([(input) => fn(input), up]);
        return (input) => {
            let [v1, rem1] = lv(input);
            let [v2, rem2] = rv(rem1);
            return [SeqN(v1, v2), rem2];
        }
    }),
    alt: function(l,r) {
        return up => tryPlaceholder(fn => {
            let lv = l([(input) => fn(input), up]);
            let rv = r([(input) => fn(input), up]);
            let [lset, rset] = this({alt: (l,r) => [firstSet(gmr)(l), firstSet(gmr)(r)]});
            return (input) => { 
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
                    return [deepCopy(emptyNode(gmr)(this)), input];
                } else {
                    throw new Error("Parse failed: end of input");
                }
            }
            return fn;
        })
    }
}), [])

let llParser = (gmr) => {
    return llParserCata(gmr, gmr);
}

function trySelf(gmr, fn) {
    return function(...args) {
        return input => {
            try {
                let [res, extra] = llParser(gmr, this)(input);
                if(extra.length === 0) return res;
            } catch(e) {
                if(!e.message.startsWith("Parse failed")) {
                    throw e;
                }
            }
            return fn.call(this, ...args)(input);
        }
    }
}
let topGrammarForTokens = cata(gmr => ({
    alt: trySelf(gmr, (l,r) => input => l(input) || r(input)),
    seq: trySelf(gmr, (l,r) => input => l(input) || r(input)),
    jump: () => input => null,
    tok: trySelf(() => null),
    eps: () => input => null
}));

function extractValue(gmr, rootAdt, fns, ftok, fplaceholder) {
    function runFns(adt, args) {
        let g = nodeGrammar(gmr, rootAdt, adt);
        if(fns.has(g)) {
            return [fns.get(g)(args)];
        }
        return args;
    }
    return fns.get('top')([cata({
        left: function(l) { return runFns(this, l) },
        right: function(r) { return runFns(this, r) },
        seq: function(l,r) { return runFns(this, [...l, ...r]) },
        tok: function(t, v) { return runFns(this, [ftok(this)]) },
        eps: function() { return runFns(this, []) },
        placeholder: function() { return runFns(this, [fplaceholder(this)]) }
    })(rootAdt, rootAdt)[0]]);
}

module.exports = {deepCopy, llParser, extractValue, LeftN, RightN, SeqN, EpsN, TokN, PlaceholderN, nodeSchema, emptyNode, emptyOrPlaceholder, nodeGrammar, fixGrammarCata, topGrammarForTokens };
