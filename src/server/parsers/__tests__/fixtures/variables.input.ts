export const MAX_RETRY = 3;

export const API_URL: string = 'https://api.example.com';

export let mutableCounter: number = 0;

export const handlers: Record<string, () => void> = {};

// Destructured — should NOT appear (only Identifier patterns are captured)
export const { a, b } = { a: 1, b: 2 };

// Not exported — should NOT be captured
const internalSecret = 'secret';

void internalSecret;
