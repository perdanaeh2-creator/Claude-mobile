import { atom, read, update } from 'claude-code'
import type { Register, SessionUsage } from 'claude-code'

import type { Limit, Snapshot, Tokens } from '../types'

const snapshot = atom({ plugin: 'usage-bar', key: 'snapshot' } as const, null)
const tokens = atom({ plugin: 'usage-bar', key: 'tokens' } as const, {
  input: 0,
  output: 0,
  cache: 0,
})
// Bumped every 30s so the reset countdowns redraw while the session is idle.
const tick = atom({ plugin: 'usage-bar', key: 'tick' } as const, 0)

const BAR_CELLS = 8
const LABELS: Record<string, string> = { five_hour: '5h', seven_day: '7d', spend_limit: 'spend' }

const toSnapshot = (u: Pick<SessionUsage, 'context' | 'rateLimits' | 'cost'>): Snapshot => ({
  limits: u.rateLimits.map(r => ({ kind: r.kind, percentUsed: r.percentUsed, resetsAt: r.resetsAt })),
  contextPercent: u.context.percent,
  costUsd: u.cost?.usd,
})

export const formatCount = (n: number): string =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`

type Units = { day: string; hour: string; minute: string }
const EN: Units = { day: 'd', hour: 'h', minute: 'm' }
// hari, jam, menit
const ID: Units = { day: 'h', hour: 'j', minute: 'm' }

export const formatUntil = (resetsAt: string | undefined, now: number, u: Units = EN): string | undefined => {
  const at = resetsAt === undefined ? NaN : Date.parse(resetsAt)
  if (Number.isNaN(at)) return undefined
  const minutes = Math.max(0, Math.round((at - now) / 60_000))
  const days = Math.floor(minutes / 1440)
  const hours = Math.floor((minutes % 1440) / 60)
  if (days > 0) return `${days}${u.day} ${hours}${u.hour}`
  if (hours > 0) return `${hours}${u.hour} ${minutes % 60}${u.minute}`
  return `${minutes}${u.minute}`
}

export const bar = (percent: number): string => {
  const filled = Math.min(BAR_CELLS, Math.max(0, Math.round((percent / 100) * BAR_CELLS)))
  return '━'.repeat(filled) + '─'.repeat(BAR_CELLS - filled)
}

const severity = (percent: number) => (percent >= 80 ? 'error' : percent >= 50 ? 'warning' : 'success')

const SUMMARY_LABELS: Record<string, string> = {
  five_hour: 'Limit 5 jam',
  seven_day: 'Limit 7 hari',
  spend_limit: 'Limit biaya',
}
const LABEL_WIDTH = 13

const row = (label: string, value: string) => `${label.padEnd(LABEL_WIDTH)} ${value}`

export const summary = (snap: Snapshot | null, t: Tokens, now: number): string => {
  const rows = (snap?.limits ?? []).map(l => {
    const until = formatUntil(l.resetsAt, now, ID)
    const percent = `${Math.round(l.percentUsed)}%`.padStart(4)
    return row(SUMMARY_LABELS[l.kind] ?? l.kind, `${bar(l.percentUsed)} ${percent}${until === undefined ? '' : `  reset ${until}`}`)
  })
  if (snap?.contextPercent !== undefined) rows.push(row('Konteks', `${snap.contextPercent}%`))
  if (t.input + t.output + t.cache > 0) {
    rows.push(row('Token', `↑ ${formatCount(t.input)}  ↓ ${formatCount(t.output)}  cache ${formatCount(t.cache)}`))
  }
  if (snap?.costUsd !== undefined) rows.push(row('Biaya', `$${snap.costUsd.toFixed(2)}`))
  return rows.length === 0 ? 'Belum ada data pemakaian.' : ['Pemakaian', ...rows].join('\n')
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const usage = await $.session.usage()
    await update($, snapshot, () => toSnapshot(usage))
    $.clock.every(30_000, () => update($, tick, (n: number) => n + 1))
    await $.command.register({ name: 'usage-bar', description: 'Show rate limits, tokens, context and cost' })
    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    await update($, snapshot, () => toSnapshot(e))
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const usage = e.usage
    if (usage) {
      await update($, tokens, (t: Tokens) => ({
        input: t.input + usage.input_tokens + usage.cache_creation_input_tokens,
        output: t.output + usage.output_tokens,
        cache: t.cache + usage.cache_read_input_tokens,
      }))
    }
    return next(e)
  })

  on('command.run', { command: 'usage-bar' }, async $ => ({
    text: summary(await read($, snapshot), await read($, tokens), await $.clock.now()),
  }))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const snap = await read($, snapshot)
    const t = await read($, tokens)
    await read($, tick)

    const hasTokens = t.input + t.output + t.cache > 0
    if (e.props.hasSurvey || (snap === null && !hasTokens)) {
      return next(e)
    }

    const { Box, Text } = $.ui.resolve(e)
    const now = await $.clock.now()

    const limitChip = (l: Limit) => {
      const until = formatUntil(l.resetsAt, now)
      return (
        <Box key={`limit-${l.kind}`} gap={1}>
          <Text dimColor>{LABELS[l.kind] ?? l.kind}</Text>
          <Text color={severity(l.percentUsed)}>{bar(l.percentUsed)}</Text>
          <Text bold>{`${Math.round(l.percentUsed)}%`}</Text>
          {until === undefined ? null : <Text dimColor>{`⟲ ${until}`}</Text>}
        </Box>
      )
    }

    return (
      <Box flexDirection="row" flexWrap="wrap" columnGap={3}>
        {(snap?.limits ?? []).map(limitChip)}
        {snap?.contextPercent === undefined ? null : (
          <Box key="context" gap={1}>
            <Text dimColor>ctx</Text>
            <Text color={severity(snap.contextPercent)} bold>{`${snap.contextPercent}%`}</Text>
          </Box>
        )}
        {hasTokens ? (
          <Box key="tokens" gap={2}>
            <Text>{`↑ ${formatCount(t.input)}`}</Text>
            <Text>{`↓ ${formatCount(t.output)}`}</Text>
            <Text dimColor>{`cache ${formatCount(t.cache)}`}</Text>
          </Box>
        ) : null}
        {snap?.costUsd === undefined ? null : (
          <Text key="cost" color="warning">{`$${snap.costUsd.toFixed(2)}`}</Text>
        )}
      </Box>
    )
  })
}
