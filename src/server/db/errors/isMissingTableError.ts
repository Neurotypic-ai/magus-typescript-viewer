export function isMissingTableError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  return message.includes('does not exist') || message.includes('table') || message.includes('not found');
}
