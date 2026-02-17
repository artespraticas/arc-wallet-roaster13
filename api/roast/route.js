import { NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ARC_RPC = 'https://rpc.testnet.arc.network'
const USDC    = '0x3600000000000000000000000000000000000000'

async function rpc(method, params) {
  const res = await fetch(ARC_RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    cache: 'no-store',
  })
  if (!res.ok) throw new Error(`RPC HTTP ${res.status}`)
  const j = await res.json()
  if (j.error) throw new Error('RPC: ' + j.error.message)
  return j.result
}

async function getTxCount(addr) {
  const hex = await rpc('eth_getTransactionCount', [addr, 'latest'])
  return parseInt(hex, 16) || 0
}

async function getUsdcBalance(addr) {
  try {
    const data = '0x70a08231' + addr.replace('0x', '').toLowerCase().padStart(64, '0')
    const hex  = await rpc('eth_call', [{ to: USDC, data }, 'latest'])
    if (!hex || hex === '0x') return 0
    return parseInt(hex, 16) / 1e6
  } catch { return 0 }
}

async function getRecentTxs(addr) {
  try {
    const url = `https://testnet.arcscan.app/api?module=account&action=txlist&address=${addr}&sort=desc&page=1&offset=5`
    const res = await fetch(url, { cache: 'no-store' })
    if (!res.ok) return []
    const j = await res.json()
    if (!Array.isArray(j.result)) return []
    return j.result.slice(0, 5).map(t => ({
      hash: t.hash, timeStamp: t.timeStamp, isError: t.isError,
    }))
  } catch { return [] }
}

function buildPrompt(addr, txCount, usdc) {
  const lines = []
  if (txCount === 0)        lines.push('Zero transactions ever. Born and immediately gave up.')
  else if (txCount <= 3)   lines.push(`Only ${txCount} tx(s). Snail energy.`)
  else if (txCount <= 20)  lines.push(`${txCount} transactions. Tourist behavior.`)
  else if (txCount > 5000) lines.push(`${txCount.toLocaleString()} transactions. This wallet IS the chain.`)
  else if (txCount > 1000) lines.push(`${txCount.toLocaleString()} txs on fake money. Unhinged.`)
  else if (txCount > 200)  lines.push(`${txCount} txs where every token is free. Dedicated to nothing.`)

  if (usdc === 0 && txCount > 0) lines.push(`${txCount} txs, $0 USDC left. Speedran bankruptcy on fake money.`)
  else if (usdc === 0)           lines.push('$0 USDC on a testnet where USDC is FREE from faucet.')
  else if (usdc < 1)             lines.push(`$${usdc.toFixed(4)} USDC — that is not a balance, that is dust.`)
  else if (usdc > 100000)        lines.push(`$${usdc.toLocaleString()} fake USDC hoarded like real money.`)

  return `You are a savage crypto roast comedian. Roast this Arc Testnet wallet brutally and hilariously.

LIVE ON-CHAIN DATA:
- Address: ${addr}
- Transactions sent: ${txCount.toLocaleString()}
- USDC balance: $${usdc.toFixed(2)}
- Network: Arc Testnet by Circle (Chain 5042002) — ALL TOKENS ARE FAKE AND FREE

ROAST MATERIAL:
${lines.map((l, i) => `${i + 1}. ${l}`).join('\n')}

Write exactly 3 paragraphs of brutal roast. Rules:
- Reference exact numbers: ${txCount.toLocaleString()} txs, $${usdc.toFixed(2)} USDC
- Use web3 slang: ser, fren, ngmi, wagmi, degen, wen moon, probably nothing, have fun staying poor
- Destroy the TESTNET angle: fake money, zero stakes, still somehow failing
- End with: VERDICT: [one brutal all-caps line]
- Plain text only — no asterisks, no markdown`
}

export async function POST(req) {
  let address
  try {
    const body = await req.json()
    address = (body.address || '').trim()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!/^0x[0-9a-fA-F]{40}$/i.test(address)) {
    return NextResponse.json({ error: 'Invalid address — must be 0x + 40 hex chars' }, { status: 400 })
  }

  // Read at request time (not build time) with force-dynamic above
  const key = process.env['ANTHROPIC_API_KEY']

  if (!key || key.trim() === '') {
    return NextResponse.json({
      error: 'Missing API key — go to Vercel → Settings → Environment Variables and add ANTHROPIC_API_KEY'
    }, { status: 500 })
  }

  // Arc RPC — runs server-side, no CORS
  let txCount
  try {
    txCount = await getTxCount(address)
  } catch (e) {
    return NextResponse.json({ error: 'Arc RPC failed: ' + e.message }, { status: 502 })
  }

  const usdc      = await getUsdcBalance(address)
  const recentTxs = await getRecentTxs(address)
  const prompt    = buildPrompt(address, txCount, usdc)

  // Call Anthropic
  let claudeRes
  try {
    claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type':      'application/json',
        'anthropic-version': '2023-06-01',
        'x-api-key':         key.trim(),
      },
      body: JSON.stringify({
        model:      'claude-opus-4-5-20251101',
        max_tokens: 1024,
        messages:   [{ role: 'user', content: prompt }],
      }),
      cache: 'no-store',
    })
  } catch (e) {
    return NextResponse.json({ error: 'Network error calling Claude: ' + e.message }, { status: 502 })
  }

  if (!claudeRes.ok) {
    const t = await claudeRes.text()
    return NextResponse.json({ error: `Claude ${claudeRes.status}: ${t.slice(0, 300)}` }, { status: 502 })
  }

  const cd    = await claudeRes.json()
  const roast = cd.content?.[0]?.text
  if (!roast) return NextResponse.json({ error: 'Empty roast from Claude' }, { status: 502 })

  return NextResponse.json({ address, txCount, usdcBalance: usdc, recentTxs, roast })
}
