import crypto from 'node:crypto';
import Decimal from 'decimal.js';

const BASE_URL = process.env.TOOBIT_BASE_URL || 'https://api.toobit.com';
const API_KEY = process.env.TOOBIT_API_KEY || '';
const SECRET_KEY = process.env.TOOBIT_SECRET_KEY || '';

function buildQuery(pairs) {
  return pairs
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join('&');
}

function sign(queryString) {
  return crypto.createHmac('sha256', SECRET_KEY).update(queryString).digest('hex');
}

async function request(method, path, pairs = [], { signed = false } = {}) {
  const ordered = [...pairs];
  if (signed) {
    if (!API_KEY || !SECRET_KEY) throw new Error('Toobit API credentials are not configured on the server.');
    ordered.push(['timestamp', Date.now()]);
    ordered.push(['recvWindow', 5000]);
  }

  const query = buildQuery(ordered);
  const finalQuery = signed ? `${query}&signature=${sign(query)}` : query;
  const url = `${BASE_URL}${path}${finalQuery ? `?${finalQuery}` : ''}`;
  const headers = { Accept: 'application/json' };
  if (signed) headers['X-BB-APIKEY'] = API_KEY;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(url, { method, headers, signal: controller.signal });
    const text = await response.text();
    let json;
    try { json = text ? JSON.parse(text) : null; } catch { throw new Error(`Toobit returned non-JSON (${response.status}).`); }
    if (!response.ok) {
      const e = new Error(`Toobit HTTP ${response.status}: ${json?.msg || json?.message || 'Request failed'}`);
      e.code = json?.code; throw e;
    }
    if (json?.code !== undefined && Number(json.code) !== 200) {
      const e = new Error(`Toobit ${json.code}: ${json.msg || 'Request failed'}`);
      e.code = json.code; throw e;
    }
    return json;
  } finally { clearTimeout(timeout); }
}

export const publicApi = {
  serverTime: () => request('GET', '/api/v1/time'),
  exchangeInfo: () => request('GET', '/api/v1/exchangeInfo'),
  fundingRate: (symbol = '') => request('GET', '/api/v1/futures/fundingRate', symbol ? [['symbol', symbol]] : []),
  fundingHistory: (symbol, limit = 20) => request('GET', '/api/v1/futures/historyFundingRate', [['symbol', symbol], ['limit', limit]]),
  openInterest: (symbol) => request('GET', '/quote/v1/openInterest', [['symbol', symbol]]),
  longShortRatio: (symbol, period = '5m', limit = 1) => request('GET', '/quote/v1/globalLongShortAccountRatio', [['symbol', symbol], ['period', period], ['limit', limit]]),
  bookTicker: (symbol = '') => request('GET', '/quote/v1/ticker/bookTicker', symbol ? [['symbol', symbol]] : []),
  ticker24h: (symbol = '') => request('GET', '/quote/v1/contract/ticker/24hr', symbol ? [['symbol', symbol]] : [])
};

export const privateApi = {
  balance: (category = 'USDT') => request('GET', '/api/v1/futures/balance', [['category', category]], { signed: true }),
  positions: (symbol = '') => request('GET', '/api/v1/futures/positions', symbol ? [['symbol', symbol]] : [], { signed: true }),
  commissionRate: (symbol) => request('GET', '/api/v1/futures/commissionRate', [['symbol', symbol]], { signed: true }),
  setLeverage: (symbol, leverage, category = 'USDT') => request('POST', '/api/v1/futures/leverage', [['symbol', symbol], ['leverage', leverage], ['category', category]], { signed: true }),
  setMarginType: (symbol, marginType, category = 'USDT') => request('POST', '/api/v1/futures/marginType', [['symbol', symbol], ['marginType', marginType], ['category', category]], { signed: true }),
  placeMarket: (symbol, side, quantity, clientOrderId, category = 'USDT') => request('POST', '/api/v1/futures/order', [
    ['symbol', symbol], ['side', side], ['type', 'LIMIT'], ['quantity', quantity], ['priceType', 'MARKET'], ['newClientOrderId', clientOrderId], ['category', category]
  ], { signed: true }),
  flashClose: (symbol, side, clientOrderId, category = 'USDT') => request('POST', '/api/v1/futures/flashClose', [
    ['symbol', symbol], ['side', side], ['clientOrderId', clientOrderId], ['category', category]
  ], { signed: true }),
  balanceFlow: ({ symbol = '', flowType = 32, limit = 20, category = 'USDT' } = {}) => request('GET', '/api/v1/futures/balanceFlow', [
    ...(symbol ? [['symbol', symbol]] : []), ['flowType', flowType], ['limit', limit], ['category', category]
  ], { signed: true })
};

export function normalizeContract(contract) {
  const filter = (type) => (contract?.filters || []).find((f) => f.filterType === type) || {};
  const lot = filter('LOT_SIZE');
  const minNotional = filter('MIN_NOTIONAL');
  return {
    symbol: contract.symbol,
    status: contract.status,
    quoteAsset: contract.quoteAsset,
    marginToken: contract.marginToken,
    contractMultiplier: new Decimal(contract.contractMultiplier || 1),
    minQty: new Decimal(lot.minQty || 0),
    maxQty: new Decimal(lot.maxQty || '1000000000'),
    stepSize: new Decimal(lot.stepSize || '0.00000001'),
    minNotional: new Decimal(minNotional.minNotional || 0),
    maxLeverage: (contract.riskLimits || []).reduce((m, r) => Math.max(m, Number(r.maxLeverage || 0)), 0)
  };
}

export function quantityForNotional(contract, targetNotional, price) {
  const px = new Decimal(price);
  if (!px.isFinite() || px.lte(0)) throw new Error('Invalid market price.');
  const desired = new Decimal(targetNotional);
  const step = contract.stepSize.gt(0) ? contract.stepSize : new Decimal('0.00000001');
  let qty = desired.div(px.mul(contract.contractMultiplier)).div(step).ceil().mul(step);
  if (qty.lt(contract.minQty)) qty = contract.minQty;
  if (qty.mul(px).mul(contract.contractMultiplier).lt(contract.minNotional)) {
    qty = contract.minNotional.div(px.mul(contract.contractMultiplier)).div(step).ceil().mul(step);
  }
  if (qty.gt(contract.maxQty)) throw new Error('Calculated quantity exceeds the symbol maximum.');
  return qty;
}

export function decimalString(value, maxDp = 12) {
  return new Decimal(value).toDecimalPlaces(maxDp).toFixed();
}
