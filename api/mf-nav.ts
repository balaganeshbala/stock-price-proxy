import type { VercelRequest, VercelResponse } from '@vercel/node'

/**
 * MF NAV Proxy
 *
 * Proxies requests to api.mfapi.in server-side (avoids browser CORS restrictions).
 *
 * Usage:
 *   GET /api/mf-nav?path=118778              → https://api.mfapi.in/mf/118778
 *   GET /api/mf-nav?path=118778/latest       → https://api.mfapi.in/mf/118778/latest
 *   GET /api/mf-nav?path=search&q=hdfc       → https://api.mfapi.in/mf/search?q=hdfc
 */

const MF_BASE = 'https://api.mfapi.in/mf'

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  Accept: 'application/json',
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') {
    return res.status(204).end()
  }

  const { path, ...rest } = req.query

  if (!path || typeof path !== 'string') {
    return res.status(400).json({ error: 'Missing required query param: path' })
  }

  // Forward any extra query params (e.g. ?q= for search)
  const extraParams = Object.entries(rest)
    .filter(([, v]) => typeof v === 'string')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v as string)}`)
    .join('&')

  const upstream = `${MF_BASE}/${path}${extraParams ? '?' + extraParams : ''}`

  try {
    const upstreamRes = await fetch(upstream, { headers: HEADERS })

    if (!upstreamRes.ok) {
      return res.status(upstreamRes.status).json({
        error: `mfapi.in returned ${upstreamRes.status} for path: ${path}`,
      })
    }

    const data = await upstreamRes.json()

    // Cache NAV history / latest for 5 minutes; search results for 1 hour
    const isSearch = path === 'search'
    res.setHeader(
      'Cache-Control',
      isSearch
        ? 's-maxage=3600, stale-while-revalidate=600'
        : 's-maxage=300, stale-while-revalidate=60',
    )

    return res.status(200).json(data)
  } catch (err: any) {
    return res.status(500).json({
      error: 'Failed to fetch from mfapi.in',
      details: err?.message,
    })
  }
}
