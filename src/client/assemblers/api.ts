export function getApiBaseUrl(): string {
  const configured = import.meta.env['VITE_API_BASE_URL'] as string | undefined;
  if (configured && configured.length > 0) {
    return configured;
  }

  if (import.meta.env.DEV) {
    return '/api';
  }

  return '';
}
