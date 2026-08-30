/**
 * The manifest a TON wallet fetches before it will talk to us. It has to be
 * served from the Mini App's own public origin, and the origin differs between
 * development, the tunnel and production — so it is built per request rather
 * than committed as a static file with a baked-in host.
 */
export const dynamic = 'force-dynamic';

export function GET(request: Request): Response {
  const origin = process.env.MINI_APP_URL ?? new URL(request.url).origin;
  return Response.json(
    {
      url: origin,
      name: 'CLE',
      iconUrl: `${origin}/icon-180.png`,
      termsOfUseUrl: `${origin}/`,
      privacyPolicyUrl: `${origin}/`,
    },
    { headers: { 'cache-control': 'public, max-age=300' } },
  );
}
