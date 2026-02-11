const TEST_FILE_PATTERNS = [
  /(^|\/)__tests__(\/|$)/i,
  /\.(test|spec)\.[cm]?[jt]sx?$/i,
  /\.(e2e|integration)\.[cm]?[jt]sx?$/i,
  /(^|\/)(e2e|integration)(\/|$)/i,
  /(^|\/)(test|tests|spec|specs)(\/|$)/i,
];

export function isTestFilePath(path: string | undefined): boolean {
  if (!path) {
    return false;
  }

  const normalizedPath = path.replace(/\\/g, '/');
  return TEST_FILE_PATTERNS.some((pattern) => pattern.test(normalizedPath));
}

export { TEST_FILE_PATTERNS };
