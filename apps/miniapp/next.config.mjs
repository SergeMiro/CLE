/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The repository documents itself; Next.js does not need to generate agent rules.
  agentRules: false,
  // The Mini App is a pure client of the CLE API; nothing is rendered from the database here.
  env: {
    NEXT_PUBLIC_API_URL: process.env.API_URL ?? 'http://localhost:4101',
  },
  // In development the app is often opened from another machine (a phone, a
  // laptop on the same tailnet, a tunnel), and Next refuses those origins by
  // default. DEV_ORIGINS is a comma-separated list of hosts to allow.
  allowedDevOrigins: (process.env.DEV_ORIGINS ?? '')
    .split(',')
    .map((host) => host.trim())
    .filter(Boolean),
};

export default nextConfig;
