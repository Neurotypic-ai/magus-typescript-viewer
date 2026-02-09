class BaseClass {
  readonly name = 'base';
}

class ChildClass extends BaseClass {
  readonly role = 'child';
}

const _child = new ChildClass();
void _child;
