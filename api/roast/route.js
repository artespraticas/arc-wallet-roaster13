import { NextResponse } from 'next/server'

const ARC_RPC = 'https://rpc.testnet.arc.network'
const USDC    = '0x3600000000000000000000000000000000000000'

// ── helpers ──────────────────────────────────────────────────────
function delay(ms) {
  return new Promise(r => setTimeout(r, ms))
}

async function rpc(method, params) {
  const res = await fetch(ARC_RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    // next: { revalidate: 0 }  — always fresh
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
    const res = await fetch(url)
    if (!res.ok) return []
    const j = await res.json()
    if (!Array.isArray(j.result)) return []
    return j.result.slice(0, 5).map(t => ({
      hash:      t.hash,
      timeStamp: t.timeStamp,
      isError:   t.isError,
    }))
  } catch { return [] }
}

function buildPrompt(addr, txCount, usdc) {
  const lines = []
  if (txCount === 0)        lines.push('Zero transactions ever. A digital coma patient.')
  else if (txCount <= 3)   lines.push(`${txCount} tx(s) total. Snail energy.`)
  else if (txCount <= 20)  lines.push(`${txCount} transactions. Tourist behavior.`)
  else if (txCount > 5000) lines.push(`${txCount.toLocaleString()} transactions. This wallet IS the chain.`)
  else if (txCount > 1000) lines.push(`${txCount.toLocaleString()} txs on FAKE money. Needs intervention.`)
  else if (txCount > 200)  lines.push(`${txCount} txs where every token is free. Unhinged.`)

  if (usdc === 0 && txCount > 0) lines.push(`${txCount} txs, $0 left. Speedran bankruptcy on fake money.`)
  else if (usdc === 0)           lines.push('$0 USDC on a testnet where USDC is FREE. Legendary laziness.')
  else if (usdc < 1)             lines.push(`$${usdc.toFixed(4)} — quantum foam, not a balance.`)
  else if (usdc > 100000)        lines.push(`$${usdc.toLocaleString()} fake USDC hoarded like it's real.`)

  return `You are a savage crypto roast comedian. Roast this Arc Testnet wallet.

REAL ON-CHAIN DATA:
- Address: ${addr}
- Transactions sent: ${txCount.toLocaleString()}
- USDC balance: $${usdc.toFixed(2)}
- Network: Arc Testnet (Chain 5042002) — ALL TOKENS ARE FAKE AND FREE

ROAST ANGLES:
${lines.map((l, i) => `${i + 1}. ${l}`).join('\n')}

Write exactly 3 brutal paragraphs. Rules:
- Use exact numbers: ${txCount.toLocaleString()} txs, $${usdc.toFixed(2)} USDC
- Use web3 slang: ser, fren, ngmi, wagmi, degen, wen moon, probably nothing
- Mock the TESTNET angle hard — fake money, zero stakes, still failing
- End the last paragraph with: VERDICT: [one brutal all-caps line]
- Plain text only, zero markdown, zero asterisks`
}

// ── handler ──────────────────────────────────────────────────────
export async function POST(req) {
  // Read address from body
  let address
  try {
    const body = await req.json()
    address = (body.address || '').trim()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!/^0x[0-9a-fA-F]{40}$/i.test(address)) {
    return NextResponse.json({ error: 'Invalid address format' }, { status: 400 })
  }

  // Read API key from environment variable (set in Vercel dashboard)
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return NextResponse.json(
      { error: 'ANTHROPIC_API_KEY environment variable not set. Please add it in Vercel → Settings → Environment Variables.' },
      { status: 500 }
    )
  }

  // Fetch chain data server-side (no CORS here — this is Node.js)
  let txCount, usdc, recentTxs
  try {
    txCount = await getTxCount(address)
  } catch (e) {
    return NextResponse.json({ error: 'Cannot reach Arc RPC: ' + e.message }, { status: 502 })
  }

  usdc      = await getUsdcBalance(address)
  recentTxs = await getRecentTxs(address)

  // Call Claude
  const prompt = buildPrompt(address, txCount, usdc)
  const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type':    'application/json',
      'anthropic-version': '2023-06-01',
      'x-api-key':       apiKey,       // ← key from env var, never exposed to browser
    },
    body: JSON.stringify({
      model:      'claude-sonnet-4-5-20250929',
      max_tokens: 1024,
      messages:   [{ role: 'user', content: prompt }],
    }),
  })

  if (!claudeRes.ok) {
    const t = await claudeRes.text()
    return NextResponse.json({ error: 'Claude error ' + claudeRes.status + ': ' + t.slice(0, 200) }, { status: 502 })
  }

  const cd    = await claudeRes.json()
  const roast = cd.content?.[0]?.text
  if (!roast) return NextResponse.json({ error: 'Empty response from Claude' }, { status: 502 })

  return NextResponse.json({ address, txCount, usdcBalance: usdc, recentTxs, roast })
}
