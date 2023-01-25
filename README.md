# recursive-grammar-literal

Specify a context-free grammar using recursive functions in ordinary javascript.

Instead of writing something like:

~~~
E -> A '+' A   { $0 + $1 }
A -> '(' E ')'
A -> number
~~~

you can write:

~~~{.javascript}
function exp() {
    let left = addExp();
    readToken("+");
    let right = addExp();
    return left + right;
}

function addExp() {
    return oneOf(
        parenExp, 
        inline(() => readToken("number"))
    );
}

function parenExp() {
    readToken("(");
    let result = exp();
    readToken(")");
    return result;
}
~~~

The output is a context-free grammar using an ADT defined using `church-cat`.
This isn't directly useful unless you are working on a parser or structure
editor or something. `ll-parser.js` contains a simple LL parser which uses the
resulting grammar to actually parse something, and `example.js` shows a full
example of building a JSON grammar, parsing it with `ll-parser`, and extracting
the computed javascript value.

Read more at https://jasonhpriestley.com/23-1-25-recursive-grammar-literals
