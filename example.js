let { oneOf, readToken, lit, combinator, inline, many, many1, sepBy, sepBy1, toGrammar } = require("./index");

let { cata, getSchema } = require("church-cat");
let { llParser, extractValue } = require("./ll-parser");

function json() {
    return oneOf(lit("number"), lit("string"), object, array);
}

function object() {
    readToken("{");
    let [entries] = sepBy(
        inline(() => { 
            let key = readToken("string"); 
            readToken(":"); 
            let val = json(); 
            return [key, val] 
        }), 
        lit(","))();
    readToken("}");
    return Object.fromEntries(entries);
}

function array() {
    readToken("[");
    let [entries] = sepBy(json, lit(","))();
    readToken("]");
    return entries;
}

function tokenize(str) {
    let tokens = [];
    let gen = tokenizer((tok) => tokens.push(tok));
    gen.next();
    for(let chr of str.split('')) {
        gen.next(chr);
    }
    return tokens;
}

function* tokenizer(out) {
    let chr = yield;
    while(true) {
        if("{}[],:".indexOf(chr) > -1) {
            out({type: chr, value: chr});
            chr = yield;
        } else if(chr === '"') {
            let str = [];
            while(true) {
                let next = yield;
                if(next === '"') {
                    out({type: 'string', value: str.join("")});
                    break;
                }
                if(next === '\\') {
                    next = yield;
                }
                str.push(next);
            }
            chr = yield;
        } else if("0123456789".indexOf(chr) > -1) {
            let ns = [chr];
            while(true) {
                let next = yield;
                if("0123456789".indexOf(next) > -1) {
                    ns.push(next);
                } else {
                    chr = next;
                    out({type: 'number', value: parseInt(ns.join(''))});   
                    break;
                }
            }
        } else if(" \t\n".indexOf(chr) > -1) {
            chr = yield;
        }
    }
}

function logADT(adt, showADT = (adt) => ``, showK = (x) => `${x}`) {
    let schema = getSchema(adt);
    cata(Object.fromEntries(
        Object.entries(schema).map(([name,kinds]) => ([name, function(...args) {
            let self = this;
            return [`${name} - ${showADT(this)}`,
                    ...args.map((arg,ii) => schema[name][ii]({
                        K: () => [showK(arg)],
                        I: () => arg
                    })).flat(1).map(line => `++${line}`)];
        }]))))(adt, adt).map(line => console.log(line));
}

let testInput = JSON.stringify([ "foo", {"bar": "baz"}, 123 ]);
let testTokens = tokenize(testInput).reduceRight((xs,x) => [x,xs], []);
let {gmr: jsonGmr, fns: jsonFns} = toGrammar(json);
let parser = llParser(jsonGmr);
let [parsed, remained] = parser( testTokens );
let res = extractValue(jsonGmr, parsed, jsonFns);
console.log(JSON.stringify(res));
