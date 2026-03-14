export function orchestrate(value: string) {
  helper(value);
  thisLike.process(value);
  Service.build(value);
  const instance = new Widget(value);
  instance.run();
  return value;
}

function helper(_value: string) {}

const thisLike = {
  process(_value: string) {},
};

const Service = {
  build(_value: string) {},
};

class Widget {
  constructor(_value: string) {}
  run() {}
}
