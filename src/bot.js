    const signedFundingBps = side === candidate.side ? Math.abs(candidate.fundingBps) : -Math.abs(candidate.fundingBps);
    const liveEnabled = process.env.ENABLE_LIVE_TRADING === 'true' && process.env.ALLOW_LIVE_ORDERS === 'true';

    if (!liveEnabled) {
      const simulated = {
        id: id('paper'), symbol, side, entryPrice: executionPrice, quantity: qty.toString(),
        notional: actualNotional.toFixed(8), leverage: safeLeverage,
        expectedFundingBps: signedFundingBps, nextFundingTime: candidate.nextFundingTime,
        openedAt: Date.now(), reason, paper: true, lastMark: executionPrice
      };
      this.position = simulated;
      this._scheduleFundingClose();
      this.lastAction = `PAPER OPEN ${symbol} ${side}`;
      this.lastActionAt = Date.now();
      this._push('position');
      return simulated;
    }

    let prepared = this.prepared.get(symbol);
    if (!prepared || prepared.leverage !== safeLeverage || prepared.marginType !== 'ISOLATED' || !prepared.fee || Date.now() - prepared.fee.at > 60000) {
      await this.prepare(symbol, safeLeverage);
      prepared = this.prepared.get(symbol);
    }
    const liveOpenFee = Number(prepared?.fee?.open || envNum('FALLBACK_TAKER_FEE', 0.0006));
    const liveCloseFee = Number(prepared?.fee?.close || envNum('FALLBACK_TAKER_FEE', 0.0006));
    const liveEdge = netBps({
      fundingRate: candidate.fundingRate,
      openFee: liveOpenFee,
      closeFee: liveCloseFee,
      spread: candidate.spreadBps
    });
    if (reason === 'AUTO' && liveEdge < this.settings.minNetEdgeBps) {
      throw new Error(`Live fee check rejected ${symbol}: net edge ${liveEdge.toFixed(2)} bps is below ${this.settings.minNetEdgeBps.toFixed(2)} bps.`);
    }

    const orderSide = side === 'SHORT' ? 'SELL_OPEN' : 'BUY_OPEN';
    const clientOrderId = id('open');
    const order = await privateApi.placeMarket(symbol, orderSide, decimalString(qty), clientOrderId);

    this.position = {
      id: clientOrderId,
      symbol,
      side,
      orderSide,
      entryPrice: executionPrice,
      quantity: qty.toString(),
      notional: actualNotional.toFixed(8),
      leverage: safeLeverage,
      expectedFundingBps: signedFundingBps,
      nextFundingTime: candidate.nextFundingTime,
      openedAt: Date.now(),
      reason,
      paper: false,
      orderId: order?.orderId || order?.data?.orderId || null,
      lastMark: executionPrice,
      takerOpenFee: liveOpenFee,
      takerCloseFee: liveCloseFee
    };
    this._scheduleFundingClose();
    this.lastAction = `OPEN ${symbol} ${side}`;
    this.lastActionAt = Date.now();
    this._push('position');
    return this.position;
    } finally {
      this.opening = false;
    }
  }

  _scheduleFundingClose() {
    if (this.closeTimer) clearTimeout(this.closeTimer);
    if (!this.position) return;
    const targetServer = Number(this.position.nextFundingTime || 0) + Number(this.settings.closeDelayMs || 1);
    const delay = Math.max(1, targetServer - (Date.now() + this.serverOffsetMs));
    this.closeTimer = setTimeout(() => {
      if (!this.position) return;
      this.close({ reason: 'FUNDING SETTLED' }).catch((error) => {
        this.lastError = error.message;
        this._push('error');
      });
    }, delay);
  }

  async _managePosition() {
    if (!this.position) return;
    const position = this.position;
    const book = this.books.get(position.symbol);
    const mark = position.side === 'SHORT'
      ? Number(book?.a || book?.b || position.entryPrice || 0)
      : Number(book?.b || book?.a || position.entryPrice || 0);
    if (mark > 0) position.lastMark = mark;

    const entry = Number(position.entryPrice || 0);
    if (entry > 0 && mark > 0) {
      const movePct = position.side === 'SHORT'
        ? ((mark - entry) / entry) * 100
        : ((entry - mark) / entry) * 100;
      position.adverseMovePct = movePct;
      if (movePct >= this.settings.maxAdverseMovePct) {
        await this.close({ reason: 'RISK STOP' });
        return;
      }
    }

    const nowServer = Date.now() + this.serverOffsetMs;
    if (nowServer >= Number(position.nextFundingTime || 0) + this.settings.closeDelayMs) {
      await this.close({ reason: 'FUNDING SETTLED' });
    }
  }

  async close({ reason = 'MANUAL' } = {}) {
    if (!this.position) return null;
    if (this.closing || this.opening) throw new Error('Execution is already in progress.');
    this.closing = true;
    const position = this.position;
    try {

    if (position.paper) {
      const mark = Number(position.lastMark || position.entryPrice);
      const entry = Number(position.entryPrice);
      const notional = new Decimal(position.notional);
      const signedMove = position.side === 'SHORT' ? (entry - mark) : (mark - entry);
      const pnl = new Decimal(signedMove).div(entry).mul(notional);
      const fundingPnl = new Decimal(position.expectedFundingBps || 0).div(10000).mul(notional);
      const feeRate = new Decimal(envNum('FALLBACK_TAKER_FEE', 0.0006)).mul(2);
      const feePnl = feeRate.mul(notional);
      const result = {
        ...position,
        closedAt: Date.now(),
        exitPrice: mark,
        reason,
        realizedPnlEstimate: pnl.plus(fundingPnl).minus(feePnl).toFixed(8),
        fundingEstimate: fundingPnl.toFixed(8),
        feeEstimate: feePnl.toFixed(8),
        paper: true
      };
      await this._record(result);
      this.position = null;
      if (this.closeTimer) { clearTimeout(this.closeTimer); this.closeTimer = null; }
      this.cooldownUntil = Date.now() + this.settings.cooldownSec * 1000;
      this.lastAction = `PAPER CLOSE ${result.symbol}`;
      this.lastActionAt = Date.now();
      this._push('position');
      return result;
    }

    const clientOrderId = id('close');
    const result = await privateApi.flashClose(position.symbol, position.side, clientOrderId);
    const closed = {
      ...position,
      closedAt: Date.now(),
      reason,
      closeOrderId: result?.orderId || result?.data?.orderId || null,
      fundingFlow: null,
      paper: false
    };
    this.position = null;
    if (this.closeTimer) { clearTimeout(this.closeTimer); this.closeTimer = null; }
    await this._record(closed);

    // Funding-flow confirmation is deliberately non-blocking so it cannot delay the close path.
    privateApi.balanceFlow({ symbol: position.symbol, flowType: 32, limit: 5 }).then((flows) => {
      const rows = Array.isArray(flows) ? flows : Array.isArray(flows?.data) ? flows.data : [];
      const fundingFlow = rows.find((row) => Number(row.created || 0) >= position.openedAt - 10000) || null;
      if (fundingFlow) {
        const item = this.trades.find((t) => t.closeOrderId === closed.closeOrderId);
        if (item) { item.fundingFlow = fundingFlow; writeHistory(this.trades).catch(() => {}); }
      }
    }).catch(() => {});
    this.cooldownUntil = Date.now() + this.settings.cooldownSec * 1000;
    this.lastAction = `CLOSE ${closed.symbol}`;
    this.lastActionAt = Date.now();
    this._push('position');
    return closed;
    } finally {
      this.closing = false;
    }
  }

  async _record(trade) {
    this.trades.push(trade);
    await writeHistory(this.trades);
  }

  async status() {
    let balance = null;
    if (process.env.ENABLE_LIVE_TRADING === 'true' && process.env.ALLOW_LIVE_ORDERS === 'true') {
      try {
        const result = await privateApi.balance();
        const rows = Array.isArray(result) ? result : Array.isArray(result?.data) ? result.data : [];
        balance = rows.find((r) => r.coin === 'USDT') || null;
      } catch (error) {
        this.lastError = error.message;
      }
    }
    return { ...this.snapshot(), balance };
  }

  setRunning(value) {
    this.running = Boolean(value);
    if (this.running) this.startedAt ||= Date.now();
    if (!this.running) this.auto = false;
    this.lastAction = this.running ? 'Bot started' : 'Bot stopped';
    this.lastActionAt = Date.now();
    this._push('status');
  }

  setAuto(value) {
    this.auto = Boolean(value);
    if (this.auto) {
      this.running = true;
      this.startedAt ||= Date.now();
    }
    this.lastAction = this.auto ? 'Auto mode armed' : 'Auto mode disarmed';
    this.lastActionAt = Date.now();
    this._push('status');
  }
}

export const botDefaults = DEFAULTS;
