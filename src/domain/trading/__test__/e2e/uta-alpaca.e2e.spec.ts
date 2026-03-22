/**
 * UTA — Alpaca paper lifecycle e2e.
 *
 * Full Trading-as-Git flow: stage → commit → push → sync → verify
 * against Alpaca paper trading (US equities).
 *
 * Skips when market is closed — Alpaca paper won't fill orders outside trading hours.
 *
 * Run: pnpm test:e2e
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { getTestAccounts, filterByProvider } from './setup.js'
import { UnifiedTradingAccount } from '../../UnifiedTradingAccount.js'
import type { IBroker } from '../../brokers/types.js'
import '../../contract-ext.js'

describe('UTA — Alpaca lifecycle (AAPL)', () => {
  let broker: IBroker | null = null
  let marketOpen = false

  beforeAll(async () => {
    const all = await getTestAccounts()
    const alpaca = filterByProvider(all, 'alpaca')[0]
    if (!alpaca) {
      console.log('e2e: No Alpaca paper account, skipping')
      return
    }
    broker = alpaca.broker
    const clock = await broker.getMarketClock()
    marketOpen = clock.isOpen
    console.log(`UTA Alpaca: market ${marketOpen ? 'OPEN' : 'CLOSED'}`)
  }, 60_000)

  it('buy → sync → verify → close → sync → verify', async () => {
    if (!broker) { console.log('e2e: skipped — no Alpaca paper account'); return }
    if (!marketOpen) { console.log('e2e: skipped — market closed'); return }

    const uta = new UnifiedTradingAccount(broker)

    // Record initial state
    const initialPositions = await broker.getPositions()
    const initialAaplQty = initialPositions.find(p => p.contract.symbol === 'AAPL')?.quantity.toNumber() ?? 0
    console.log(`  initial AAPL qty=${initialAaplQty}`)

    // === Stage + Commit + Push: buy 1 AAPL ===
    const addResult = uta.stagePlaceOrder({
      aliceId: `${uta.id}|AAPL`,
      symbol: 'AAPL',
      side: 'buy',
      type: 'market',
      qty: 1,
    })
    expect(addResult.staged).toBe(true)
    console.log(`  staged: ok`)

    const commitResult = uta.commit('e2e: buy 1 AAPL')
    expect(commitResult.prepared).toBe(true)
    console.log(`  committed: hash=${commitResult.hash}`)

    const pushResult = await uta.push()
    console.log(`  pushed: submitted=${pushResult.submitted.length}, rejected=${pushResult.rejected.length}, status=${pushResult.submitted[0]?.status}`)
    expect(pushResult.submitted).toHaveLength(1)
    expect(pushResult.rejected).toHaveLength(0)

    const buyOrderId = pushResult.submitted[0].orderId
    console.log(`  orderId: ${buyOrderId}`)
    expect(buyOrderId).toBeDefined()

    // === Sync: may or may not have updates depending on whether fill was synchronous ===
    if (pushResult.submitted[0].status === 'submitted') {
      const sync1 = await uta.sync({ delayMs: 2000 })
      console.log(`  sync1: updatedCount=${sync1.updatedCount}`)
      expect(sync1.updatedCount).toBe(1)
      expect(sync1.updates[0].currentStatus).toBe('filled')
    } else {
      console.log(`  sync1: skipped (already ${pushResult.submitted[0].status} at push time)`)
    }

    // === Verify: position exists, no pending ===
    const state1 = await uta.getState()
    const aaplPos = state1.positions.find(p => p.contract.symbol === 'AAPL')
    console.log(`  state: AAPL qty=${aaplPos?.quantity}, pending=${state1.pendingOrders.length}`)
    expect(aaplPos).toBeDefined()
    expect(aaplPos!.quantity.toNumber()).toBe(initialAaplQty + 1)
    expect(state1.pendingOrders).toHaveLength(0)

    // === Stage + Commit + Push: close 1 AAPL ===
    uta.stageClosePosition({ aliceId: `${uta.id}|AAPL`, qty: 1 })
    uta.commit('e2e: close 1 AAPL')
    const closePush = await uta.push()
    console.log(`  close pushed: submitted=${closePush.submitted.length}, status=${closePush.submitted[0]?.status}`)
    expect(closePush.submitted).toHaveLength(1)

    // === Sync: same — depends on fill timing ===
    if (closePush.submitted[0].status === 'submitted') {
      const sync2 = await uta.sync({ delayMs: 2000 })
      console.log(`  sync2: updatedCount=${sync2.updatedCount}`)
      expect(sync2.updatedCount).toBe(1)
      expect(sync2.updates[0].currentStatus).toBe('filled')
    } else {
      console.log(`  sync2: skipped (already ${closePush.submitted[0].status} at push time)`)
    }

    // === Verify: position back to initial ===
    const finalPositions = await broker.getPositions()
    const finalAaplQty = finalPositions.find(p => p.contract.symbol === 'AAPL')?.quantity.toNumber() ?? 0
    console.log(`  final AAPL qty=${finalAaplQty} (initial was ${initialAaplQty})`)
    expect(finalAaplQty).toBe(initialAaplQty)

    // === Log: 2 commits ===
    const history = uta.log()
    console.log(`  log: ${history.length} commits — [${history.map(h => h.message).join(', ')}]`)
    expect(history.length).toBeGreaterThanOrEqual(2)
  }, 60_000)
})
