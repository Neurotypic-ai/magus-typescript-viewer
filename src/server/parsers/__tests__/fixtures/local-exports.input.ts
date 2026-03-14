const foo = 1;
function bar() {
  return foo;
}
const baz = 'z';

export { foo, bar as renamedBar, baz as defaultLabel };
