import { useEffect, useMemo, useRef, useState } from 'react'
import {
  createChart,
  CandlestickSeries,
  HistogramSeries,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
  type CandlestickData,
  type HistogramData,
} from 'lightweight-charts'
import { marketApi, type AssetClass, type HistoricalBar } from '../../api/market'

type Timeframe = '1M' | '3M' | '1Y' | '5Y' | 'All'

const TIMEFRAMES: Timeframe[] = ['1M', '3M', '1Y', '5Y', 'All']

function daysForTimeframe(tf: Timeframe): number | null {
  switch (tf) {
    case '1M': return 30
    case '3M': return 90
    case '1Y': return 365
    case '5Y': return 365 * 5
    case 'All': return null
  }
}

function toUTCTimestamp(dateStr: string): UTCTimestamp {
  // Historical rows use `YYYY-MM-DD`; treat as UTC midnight.
  return Math.floor(new Date(`${dateStr}T00:00:00Z`).getTime() / 1000) as UTCTimestamp
}

interface Props {
  /** null = nothing selected yet; show empty state. */
  selection: { symbol: string; assetClass: AssetClass } | null
}

export function KlinePanel({ selection }: Props) {
  const [tf, setTf] = useState<Timeframe>('1Y')
  const [bars, setBars] = useState<HistoricalBar[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const candleRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const volumeRef = useRef<ISeriesApi<'Histogram'> | null>(null)

  // Fetch bars when selection/timeframe changes.
  useEffect(() => {
    if (!selection) { setBars(null); setError(null); return }
    if (selection.assetClass === 'commodity') {
      setBars(null)
      setError('Commodity K-line support is coming in the next step.')
      return
    }
    setLoading(true)
    setError(null)
    const days = daysForTimeframe(tf)
    const opts: { interval: string; startDate?: string } = { interval: '1d' }
    if (days) {
      const start = new Date()
      start.setDate(start.getDate() - days)
      opts.startDate = start.toISOString().slice(0, 10)
    }
    marketApi.historical(selection.assetClass, selection.symbol, opts)
      .then((res) => {
        if (res.error || !res.results) {
          setError(res.error ?? 'No data returned.')
          setBars(null)
        } else {
          setBars(res.results)
        }
      })
      .catch((e) => { setError(e instanceof Error ? e.message : String(e)); setBars(null) })
      .finally(() => setLoading(false))
  }, [selection, tf])

  // Build chart once container is mounted.
  useEffect(() => {
    if (!containerRef.current) return
    const chart = createChart(containerRef.current, {
      layout: {
        background: { color: 'transparent' },
        textColor: '#c9d1d9',
        panes: { separatorColor: '#30363d', separatorHoverColor: '#58a6ff33' },
      },
      grid: {
        vertLines: { color: '#21262d' },
        horzLines: { color: '#21262d' },
      },
      rightPriceScale: { borderColor: '#30363d' },
      timeScale: { borderColor: '#30363d', timeVisible: false, secondsVisible: false },
      autoSize: true,
    })

    const candle = chart.addSeries(CandlestickSeries, {
      upColor: '#3fb950',
      downColor: '#f85149',
      borderUpColor: '#3fb950',
      borderDownColor: '#f85149',
      wickUpColor: '#3fb950',
      wickDownColor: '#f85149',
    })

    const volume = chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' },
      priceScaleId: '',
    }, 1)
    volume.priceScale().applyOptions({ scaleMargins: { top: 0.1, bottom: 0 } })

    chartRef.current = chart
    candleRef.current = candle
    volumeRef.current = volume

    return () => {
      chart.remove()
      chartRef.current = null
      candleRef.current = null
      volumeRef.current = null
    }
  }, [])

  // Push bars into chart.
  useEffect(() => {
    if (!candleRef.current || !volumeRef.current) return
    if (!bars || bars.length === 0) {
      candleRef.current.setData([])
      volumeRef.current.setData([])
      return
    }

    const candleData: CandlestickData[] = bars.map((b) => ({
      time: toUTCTimestamp(b.date),
      open: b.open,
      high: b.high,
      low: b.low,
      close: b.close,
    }))
    const volumeData: HistogramData[] = bars.map((b) => ({
      time: toUTCTimestamp(b.date),
      value: b.volume ?? 0,
      color: b.close >= b.open ? '#3fb95055' : '#f8514955',
    }))

    candleRef.current.setData(candleData)
    volumeRef.current.setData(volumeData)
    chartRef.current?.timeScale().fitContent()
  }, [bars])

  const title = useMemo(() => {
    if (!selection) return 'Select a symbol'
    return `${selection.symbol} · ${selection.assetClass}`
  }, [selection])

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between py-2 px-1">
        <div className="text-[13px] font-medium text-text">{title}</div>
        <div className="flex border border-border rounded overflow-hidden">
          {TIMEFRAMES.map((t, i) => (
            <button
              key={t}
              onClick={() => setTf(t)}
              className={`px-2.5 py-1 text-[12px] transition-colors cursor-pointer ${
                i > 0 ? 'border-l border-border' : ''
              } ${tf === t ? 'bg-bg-tertiary text-text' : 'text-text-muted hover:text-text'}`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      <div className="relative flex-1 min-h-0 border border-border rounded bg-bg-secondary/30">
        <div ref={containerRef} className="absolute inset-0" />
        {!selection && (
          <div className="absolute inset-0 flex items-center justify-center text-[13px] text-text-muted">
            Pick an asset to see the K-line.
          </div>
        )}
        {selection && loading && (
          <div className="absolute top-2 right-2 text-[11px] text-text-muted">Loading…</div>
        )}
        {selection && error && !loading && (
          <div className="absolute inset-0 flex items-center justify-center text-[13px] text-text-muted px-8 text-center">
            {error}
          </div>
        )}
      </div>
    </div>
  )
}
