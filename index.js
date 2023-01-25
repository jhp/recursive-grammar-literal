let { I, K, constructors } = require("church-cat");

let oneOfImpl, readTokenImpl;
function oneOf(...alts) { return oneOfImpl(...alts); }
function readToken(tok) { return readTokenImpl(tok); }

function withImpls(impls, fn) {
    let temp = {oneOfImpl, readTokenImpl};
    oneOfImpl = impls.oneOf;
    readTokenImpl = impls.readToken;
    let result = fn();
    oneOfImpl = temp.oneOfImpl;
    readTokenImpl = temp.readTokenImpl;
    return result;
}

let grammarSchema = ({
    alt: [I, I],
    seq: [I, I],
    tok: [K],
    eps: [],
    jump: [K]
});

let { alt: AltG, seq: SeqG, tok: TokG, eps: EpsG, jump: JumpG } = constructors( grammarSchema );

function toGrammar(parseFunction, exampleToken=() => "") {
    let associatedFunctions = new Map();
    let sigMap = new Map(), sigNum = 1002;
    function getSig(...args) {
        let n = 1001, m = sigMap;
        for(let a of args) {
            if(!m.has(a)) m.set(a, {n: sigNum++, m: new Map()});
            ({n,m} = m.get(a));
        }
        return n;
    }
    function build(seqs) {
        return (ns) => {
            function buildAlts(seqs, n=0) {
                if(seqs.length === 1) {
                    let seqG = buildSeqs(seqs[0].gs, n);
                    associatedFunctions.set(seqG, seqs[0].f);
                    return seqG;
                }
                let mid = Math.floor(seqs.length / 2);
                return AltG(buildAlts(seqs.slice(0, mid), n+1), buildAlts(seqs.slice(mid), n+1));
            }
            function buildSeqs(seq, n) {
                if(seq.length === 0) return EpsG();
                if(seq.length === 1) return seq[0]([n, ns]);
                let mid = Math.floor(seq.length / 2);
                return SeqG(buildSeqs(seq.slice(0, mid), n+1), buildSeqs(seq.slice(mid), n+1));
            }
            return buildAlts(seqs);
        }
    }
    let examples = new Map(), up = [], loopError = new Error("Grammar has an infinite loop");
    let lastLen = -1;
    while(examples.size !== lastLen) {
        lastLen = examples.size;
        withImpls({
            oneOf: (...alts) => {
                let sig = getSig(...alts);
                let parentUp = up;
                for(let lst = up; lst.length; lst = lst[1]) {
                    if(lst[0] === sig) {
                        if(examples.has(sig)) {
                            return examples.get(sig);
                        } else {
                            throw loopError;
                        }
                    }
                }
                up = [sig, up];
                for(let alt of alts) {
                    try { 
                        let example = alt();
                        examples.set(sig, example);
                    } catch(e) {
                        if(e !== loopError) throw e;
                    }
                }
                up = parentUp;
                if(examples.has(sig)) {
                    return examples.get(sig);
                } else {
                    throw loopError;
                }
            },
            readToken: (tok) => exampleToken(tok)
        }, () => oneOf(parseFunction));
    }
    let seq = [];
    withImpls({
        oneOf: (...alts) => {
            let sig = getSig(...alts);
            let matchingSig = false, matchingN = 0;
            for(let lst = up; lst.length; lst = lst[1], matchingN++) {
                if(lst[0] === sig) {
                    matchingSig = true;
                    break;
                }
            }
            if(matchingSig) {
                seq.push( (ns) => {
                    let N = 0, lst = ns;
                    for(let ii = 0; ii <= matchingN; ii++) {
                        N += lst[0];
                        lst = lst[1];
                    }
                    return JumpG(N) 
                });
                return examples.get(sig);
            } else {
                let parentSeq = seq;
                let parentUp = up;
                up = [sig, up];
                let gs = [];
                for(let alt of alts) {
                    seq = [];
                    alt();
                    gs.push({gs: seq, f: (args) => {
                            let idx = 0;
                            return withImpls({readToken: () => args[idx++], oneOf: () => args[idx++]}, alt);
                        }
                    });
                }
                seq = parentSeq;
                up = parentUp;
                seq.push( build(gs) );
                return examples.get(sig);
            }
        },
        readToken: (tok) => {
            seq.push( () => TokG(tok) );
            return exampleToken(tok);
        }
    }, () => oneOf(parseFunction));
    return {gmr: build([{gs: seq, f: ([res]) => res}])([]), fns: associatedFunctions};
}

let combinator = ((memo) => {
    return (fn) => (...args) => {
        if(!memo.has(fn)) {
            memo.set(fn, new Map());
        }
        let mp = memo.get(fn);
        for(let ii = 0; ii < args.length - 1; ii++) {
            if(!mp.has(args[ii])) mp.set(args[ii], new Map());
            mp = mp.get(args[ii]);
        }
        if(!mp.has(args[args.length-1]))
            mp.set(args[ args.length-1 ], () => fn(...args));
        return mp.get(args[ args.length-1 ]);
    }
})(new Map());

let inline = ((memo) => {
    return (fn, ...args) => {
        let mp = {m: memo};
        for(let arg of [fn.toString(), ...args]) {
            if(!mp.m.has(arg)) {
                mp.m.set(arg, {m: new Map()});
            }
            mp = mp.m.get(arg);
        }
        if(!mp.v) mp.v = fn;
        return mp.v;
    }
})(new Map());

let many = combinator(function(inner) {
    return oneOf(
        inline(() => []), 
        many1(inner));
});

let many1 = combinator(function(inner) {
    return [inner(), ...many(inner)()];
});

let sepBy1 = combinator(function(elem, sep) {
    let e = elem();
    let [es,ss] = oneOf(
        inline(() => { return [[], []]; }),
        inline(() => {
            let s = sep();
            let res = sepBy(elem, sep)();
            let [es, ss] = res;
            return [es, [s, ...ss]];
        }, elem, sep)
    );
    return [[e,...es], ss];
});

let sepBy = combinator(function(elem, sep) {
    return oneOf(
        inline(() => [[], []]),
        sepBy1(elem, sep));
});

let between = combinator(function(left, right, elem) {
    left();
    let res = elem();
    right();
    return res;
});

let lit = combinator(function(tokenType) {
    return readToken(tokenType);
});

let mapOut = (function(memo) {
    return function(fn, inner) {
        if(!memo.has(inner)) {
            memo.set(inner, function() { return fn(inner()); });
        }
        return memo.get(inner);
    }
})(new Map());

module.exports  = { oneOf, readToken, toGrammar, combinator, inline, mapOut, lit, between, sepBy, sepBy1, many, many1 };
