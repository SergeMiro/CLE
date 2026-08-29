/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The repository documents itself; Next.js does not need to generate agent rules.
  agentRules: false,
  // The Mini App is a pure client of the CLE API; nothing is rendered from the database here.
  env: {
    NEXT_PUBLIC_API_URL: process.env.API_URL ?? 'http://localhost:4101',
  },
};

export default nextConfig;
