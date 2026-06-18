export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/rss') {
      const feedUrl = url.searchParams.get('url');
      if (!feedUrl) return new Response('Missing url param', { status: 400 });

      try {
        const upstream = await fetch(feedUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; TrackMarc/1.0)' },
          cf: { cacheTtl: 1800, cacheEverything: true },
        });
        const body = await upstream.text();
        return new Response(body, {
          status: upstream.status,
          headers: {
            'Content-Type': 'text/xml; charset=utf-8',
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'public, s-maxage=1800',
          },
        });
      } catch {
        return new Response('upstream fetch failed', { status: 502 });
      }
    }

    return env.ASSETS.fetch(request);
  },
};
