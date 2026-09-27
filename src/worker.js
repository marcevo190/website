import { handlePrivateViewer } from './private-viewer.js';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith('/private')) {
      return handlePrivateViewer(request, url, env);
    }

    if (url.pathname === '/api/visits') {
      if (request.method === 'POST') {
        const current = parseInt((await env.VISITS.get('count')) ?? '0', 10);
        const next = current + 1;
        await env.VISITS.put('count', String(next));
        return new Response(JSON.stringify({ count: next }), {
          headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
        });
      }
      const count = parseInt((await env.VISITS.get('count')) ?? '0', 10);
      return new Response(JSON.stringify({ count }), {
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      });
    }

    if (url.pathname === '/api/instagram-stats') {
      // Fed by a Make.com scenario polling Instagram's Insights API on a
      // schedule (see CLAUDE.md — we don't call Meta's Graph API directly
      // from here, Make.com owns that auth). Shared-secret auth via
      // IG_STATS_TOKEN (a Worker secret, not in wrangler.json since this
      // repo is public) rather than the VISITS endpoint's no-auth model —
      // that one only ever increments a counter, this one accepts arbitrary
      // JSON, so an unauthenticated POST could fill the KV history with junk.
      const authHeader = request.headers.get('Authorization') || '';
      const token = authHeader.replace(/^Bearer\s+/i, '');
      if (!env.IG_STATS_TOKEN || token !== env.IG_STATS_TOKEN) {
        return new Response('Unauthorized', { status: 401 });
      }

      const HISTORY_KEY = 'ig-stats-history';
      const MAX_ENTRIES = 400; // ~13 months of daily snapshots

      if (request.method === 'POST') {
        let body;
        try {
          body = await request.json();
        } catch {
          return new Response('Invalid JSON body', { status: 400 });
        }
        const raw = await env.VISITS.get(HISTORY_KEY);
        const history = raw ? JSON.parse(raw) : [];
        history.push({ recordedAt: new Date().toISOString(), ...body });
        while (history.length > MAX_ENTRIES) history.shift();
        await env.VISITS.put(HISTORY_KEY, JSON.stringify(history));
        return new Response(JSON.stringify({ ok: true, entries: history.length }), {
          headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
        });
      }

      const raw = await env.VISITS.get(HISTORY_KEY);
      const history = raw ? JSON.parse(raw) : [];
      if (url.searchParams.get('latest') === '1') {
        return new Response(JSON.stringify(history[history.length - 1] ?? null), {
          headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
        });
      }
      return new Response(JSON.stringify(history), {
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      });
    }

    if (url.pathname === '/api/rss') {
      const feedUrl = url.searchParams.get('url');
      if (!feedUrl) return new Response('Missing url param', { status: 400 });

      // SSRF guard: this proxy is publicly reachable, so only ever fetch from
      // the news sources the site actually uses (see the /motorsport feeds).
      // A bare fetch(-)-url lets anyone probe for internal resources.
      const rssAllowHosts = ['news.google.com'];
      let feed;
      try {
        feed = new URL(feedUrl);
      } catch {
        return new Response('Invalid url param', { status: 400 });
      }
      if (feed.protocol !== 'https:' || !rssAllowHosts.includes(feed.hostname)) {
        return new Response('Unsupported feed host', { status: 403 });
      }

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
