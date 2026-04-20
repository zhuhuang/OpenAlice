/**
 * Aggregate Symbol Search
 *
 * Cross-asset-class heuristic search that respects Alice's per-asset-class
 * provider config. Used both by the AI tool (marketSearchForResearch) and the
 * HTTP route (/api/market/search) — both surfaces must return the same thing.
 *
 * equity    — SymbolIndex (SEC/TMX local cache, regex, zero-latency)
 * commodity — CommodityCatalog (canonical catalog, ~25 items)
 * crypto    — cryptoClient.search on yfinance (online fuzzy)
 * currency  — currencyClient.search on yfinance (online fuzzy, XXXUSD filter)
 */
import type { SymbolIndex } from './equity/symbol-index.js'
import type { CommodityCatalog } from './commodity/commodity-catalog.js'
import type { CryptoClientLike, CurrencyClientLike } from './client/types.js'

export type AssetClass = 'equity' | 'crypto' | 'currency' | 'commodity'

export interface MarketSearchDeps {
  symbolIndex: SymbolIndex
  cryptoClient: CryptoClientLike
  currencyClient: CurrencyClientLike
  commodityCatalog: CommodityCatalog
}

export interface MarketSearchResult {
  /** Equity / crypto / currency have a symbol; commodity uses `id` instead (canonical). */
  symbol?: string
  id?: string
  name?: string | null
  assetClass: AssetClass
  [key: string]: unknown
}

export async function aggregateSymbolSearch(
  deps: MarketSearchDeps,
  query: string,
  limit = 20,
): Promise<MarketSearchResult[]> {
  const q = query.trim()
  if (!q) return []

  const equityResults = deps.symbolIndex
    .search(q, limit)
    .map((r) => ({ ...r, assetClass: 'equity' as const }))

  const commodityResults = deps.commodityCatalog
    .search(q, limit)
    .map((r) => ({ ...r, assetClass: 'commodity' as const }))

  const [cryptoSettled, currencySettled] = await Promise.allSettled([
    deps.cryptoClient.search({ query: q, provider: 'yfinance' }),
    deps.currencyClient.search({ query: q, provider: 'yfinance' }),
  ])

  const cryptoResults = (cryptoSettled.status === 'fulfilled' ? cryptoSettled.value : []).map(
    (r) => ({ ...r, assetClass: 'crypto' as const }),
  )

  const currencyResults = (currencySettled.status === 'fulfilled' ? currencySettled.value : [])
    .filter((r) => {
      const sym = (r as Record<string, unknown>).symbol as string | undefined
      return sym?.endsWith('USD')
    })
    .map((r) => ({ ...r, assetClass: 'currency' as const }))

  return [...equityResults, ...cryptoResults, ...currencyResults, ...commodityResults]
}
