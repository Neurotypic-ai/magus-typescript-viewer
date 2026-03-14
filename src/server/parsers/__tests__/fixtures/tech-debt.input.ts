// TODO: refactor this entire file
// FIXME: this crashes on null input
// HACK: temporary workaround for upstream bug

// @ts-ignore
const x: any = null;
const y = x as unknown as string;
const z = x!.toString();

void y;
void z;
