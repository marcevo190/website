export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/rss') {
      const feedUrl = url.searchParams.get('url');
      if (!feedUrl) return new Response('Missing url param', { status: 400 });

      try {
        const upstream = await fetch(feedUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; TrackMarc/1.0)',
            'Accept': 'application/rss+xml, application/xml, text/xml, */*;q=0.1',
          },
        });
        const body = await upstream.text();
        // Google News sometimes returns an HTML consent page instead of RSS —
        // surface this as 422 so the client's retry logic can attempt again.
        const trimmed = body.trimStart().toLowerCase();
        if (trimmed.startsWith('<!') || trimmed.startsWith('<html')) {
          return new Response('upstream returned HTML instead of RSS', { status: 422 });
        }
        if (!upstream.ok) {
          return new Response(`upstream error ${upstream.status}`, { status: upstream.status });
        }
        return new Response(body, {
          status: 200,
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
