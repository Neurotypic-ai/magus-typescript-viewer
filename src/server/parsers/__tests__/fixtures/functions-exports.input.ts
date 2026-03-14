export function greet(name: string): string {
  return `Hello ${name}`;
}

export async function fetchData(url: string, opts?: RequestInit): Promise<Response> {
  return fetch(url, opts);
}

export function identity<T>(value: T): T {
  return value;
}

// Not exported — should NOT be captured by parseFunctions
function internalHelper(): void {}

void internalHelper;
