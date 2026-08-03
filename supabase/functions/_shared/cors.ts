const ALLOWED_ORIGINS = new Set([
  'http://localhost:5173',
  'https://gaiensai.pages.dev',
  'https://gaiensai.com',
  'https://www.gaiensai.com'
]);

export const getCorsHeaders = (req: Request): HeadersInit => {
  const origin = req.headers.get('origin');
  const allowOrigin =
    origin && ALLOWED_ORIGINS.has(origin)
      ? origin
      : 'https://gaiensai.com';

  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Headers':
      'authorization, x-client-info, apikey, content-type, x-admin-session-token, x-organization-admin-session-token',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    Vary: 'Origin',
  };
};
