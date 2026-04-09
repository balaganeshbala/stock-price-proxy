import type { VercelRequest, VercelResponse } from '@vercel/node'

/**
 * NPS NAV Proxy
 *
 * Fetches all NPS scheme NAVs from npsnav.in server-side (avoids browser CORS).
 *
 * Endpoint: GET /api/nps-nav
 *
 * Response:
 *   {
 *     lastUpdated: "07-04-2026",   // DD-MM-YYYY from API metadata
 *     navs: { "SM008001": 51.2367, "SM001003": 53.4181, ... }
 *   }
 *
 * Source API: https://npsnav.in/api/latest-min
 *   Returns { data: [["SM008001", 51.2367], ...], metadata: { lastUpdated: "DD-MM-YYYY", ... } }
 */

const UPSTREAM = 'https://npsnav.in/api/latest-min'

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

  try {
    const upstream = await fetch(UPSTREAM, { headers: HEADERS })

    if (!upstream.ok) {
      return res.status(upstream.status).json({
        error: `npsnav.in returned HTTP ${upstream.status}`,
      })
    }

    const json = await upstream.json()

    // data: [["SM008001", 51.2367], ...]
    const tuples: [string, number][] = json.data ?? []
    const lastUpdated: string = json.metadata?.lastUpdated ?? ''

    if (!tuples.length) {
      return res.status(502).json({ error: 'Empty data from npsnav.in' })
    }

    // Build a flat code→nav map for easy lookup on the client
    const navs: Record<string, number> = {}
    for (const [code, nav] of tuples) {
      if (code && typeof nav === 'number') navs[code] = nav
    }

    // Cache for 30 minutes — NAV is updated twice daily by PFRDA
    res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=300')
    return res.status(200).json({ lastUpdated, navs })
  } catch (err: any) {
    return res.status(500).json({
      error: 'Failed to fetch NPS NAV data',
      details: err?.message,
    })
  }
}
