const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
const apiOrigin = new URL(apiUrl).origin;
const websocketOrigin = apiOrigin.replace(/^http/, 'ws');
const isProduction = process.env.NODE_ENV === 'production';
const distDir = process.env.NEXT_DIST_DIR?.trim() || undefined;

const securityHeaders = [
  {
    key: 'Content-Security-Policy',
    value: [
      "base-uri 'self'",
      `connect-src 'self' ${apiOrigin} ${websocketOrigin}`,
      "default-src 'self'",
      "font-src 'self' data:",
      "frame-ancestors 'none'",
      "img-src 'self' data:",
      "object-src 'none'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
    ].join('; '),
  },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
];

if (isProduction) {
  securityHeaders.push({
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload',
  });
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  distDir,
  async headers() {
    return [
      {
        source: '/:path*',
        headers: securityHeaders,
      },
    ];
  },
  output: 'standalone',
};

export default nextConfig;
