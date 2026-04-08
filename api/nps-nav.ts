import type { VercelRequest, VercelResponse } from '@vercel/node'

/**
 * NPS NAV Proxy
 *
 * Fetches NPS scheme NAV data from npsnav.in server-side to avoid CORS issues
 * in the browser.
 *
 * Routes:
 *   GET /api/nps-nav            → returns all NPS schemes as JSON array
 *   GET /api/nps-nav?scheme=SM008001 → returns { nav, date } for a single scheme
 */

const NPS_BASE = 'https://npsnav.in/api'

// Ordered list of candidate "all schemes" endpoints to try
const ALL_ENDPOINTS = [
  `${NPS_BASE}/all`,
  `${NPS_BASE}`,
  `${NPS_BASE}/schemes`,
]

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  Accept: 'application/json, text/plain, */*',
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS — allow any origin (lock to your domain in production if preferred)
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') {
    return res.status(204).end()
  }

  const { scheme } = req.query

  // ── Single-scheme lookup ──────────────────────────────────────────────────
  if (scheme && typeof scheme === 'string') {
    try {
      const url = `${NPS_BASE}/${encodeURIComponent(scheme)}`
      const upstream = await fetch(url, { headers: HEADERS })

      if (!upstream.ok) {
        return res.status(upstream.status).json({
          error: `npsnav.in returned ${upstream.status} for scheme ${scheme}`,
        })
      }

      // Individual scheme endpoint returns plain-text NAV
      const text = await upstream.text()
      const nav = parseFloat(text.trim())

      if (isNaN(nav) || nav <= 0) {
        return res.status(404).json({ error: `Invalid NAV response for scheme ${scheme}: "${text}"` })
      }

      res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=300')
      return res.status(200).json({ nav, scheme })
    } catch (err: any) {
      return res.status(500).json({ error: 'Failed to fetch single NPS scheme NAV', details: err?.message })
    }
  }

  // ── All-schemes lookup ────────────────────────────────────────────────────
  let lastError = ''

  for (const url of ALL_ENDPOINTS) {
    try {
      const upstream = await fetch(url, { headers: HEADERS })

      if (!upstream.ok) {
        lastError = `${url} → HTTP ${upstream.status}`
        continue
      }

      const contentType = upstream.headers.get('content-type') || ''

      if (!contentType.includes('application/json') && !contentType.includes('text/json')) {
        // Some endpoints return JSON without the right Content-Type header — try parsing anyway
        const text = await upstream.text()
        try {
          const json = JSON.parse(text)
          const schemes = Array.isArray(json) ? json : json.data || json.schemes || []
          if (schemes.length > 0) {
            res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=300')
            return res.status(200).json(schemes)
          }
          lastError = `${url} → JSON parsed but got empty array`
          continue
        } catch {
          lastError = `${url} → not JSON (content-type: ${contentType})`
          continue
        }
      }

      const json = await upstream.json()
      const schemes = Array.isArray(json) ? json : json.data || json.schemes || []

      if (schemes.length === 0) {
        lastError = `${url} → empty array`
        continue
      }

      // Cache for 30 minutes (NAV is updated twice daily)
      res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=300')
      return res.status(200).json(schemes)
    } catch (err: any) {
      lastError = `${url} → ${err?.message}`
    }
  }

  // All endpoints failed
  return res.status(502).json({
    error: 'Could not fetch NPS NAV data from npsnav.in',
    details: lastError,
    triedEndpoints: ALL_ENDPOINTS,
  })
}
