import type { VercelRequest, VercelResponse } from '@vercel/node'

const YF_BASE = 'https://query2.finance.yahoo.com/v8/finance/chart'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS — allow requests from any origin (lock to your domain in production if preferred)
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') {
    return res.status(204).end()
  }

  const { symbol } = req.query

  if (!symbol || typeof symbol !== 'string') {
    return res.status(400).json({ error: 'Missing required query param: symbol' })
  }

  const url = `${YF_BASE}/${encodeURIComponent(symbol)}?interval=1d&range=2d`

  try {
    const upstream = await fetch(url, {
      headers: {
        // Yahoo sometimes returns 401 without a User-Agent
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        'Accept': 'application/json',
      },
    })

    if (!upstream.ok) {
      return res.status(upstream.status).json({
        error: `Yahoo Finance returned ${upstream.status} for symbol: ${symbol}`,
      })
    }

    const data = await upstream.json()

    // Validate the response contains what we need before forwarding
    const price = data?.chart?.result?.[0]?.meta?.regularMarketPrice
    if (price == null) {
      return res.status(404).json({ error: `No price data found for symbol: ${symbol}` })
    }

    // Cache response for 60 seconds on Vercel's edge
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=30')

    return res.status(200).json(data)
  } catch (err: any) {
    return res.status(500).json({ error: 'Failed to fetch from Yahoo Finance', details: err?.message })
  }
}
