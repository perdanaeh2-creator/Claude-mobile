import { expect, mock, test } from 'claude-code/testing'

import { bar, formatCount, formatUntil, summary } from './register'

const NOW = Date.parse('2026-10-03T09:00:00Z')

const BAND = {
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 120,
    scroll: { offset: 0, bodyRows: 9 },
    view: {},
  },
} as const

test('formats counts, countdowns and bars', () => {
  expect(formatCount(950)).toBe('950')
  expect(formatCount(15_600)).toBe('15.6k')
  expect(formatCount(954_200)).toBe('954.2k')
  expect(formatCount(1_250_000)).toBe('1.3M')
  expect(formatUntil('2026-10-03T11:40:00Z', NOW)).toBe('2h 40m')
  expect(formatUntil('2026-10-04T16:00:00Z', NOW)).toBe('1d 7h')
  expect(formatUntil(undefined, NOW)).toBeUndefined()
  expect(bar(0)).toBe('────────')
  expect(bar(50)).toBe('━━━━────')
  expect(bar(130)).toBe('━━━━━━━━')
  expect(summary(null, { input: 0, output: 0, cache: 0 }, NOW)).toBe('No usage figures yet.')
  expect(
    summary(
      { limits: [{ kind: 'five_hour', percentUsed: 20, resetsAt: '2026-10-03T11:40:00Z' }], contextPercent: 34, costUsd: 4.32 },
      { input: 15_600, output: 3_000, cache: 954_200 },
      NOW,
    ),
  ).toBe('5h ━━────── 20% ⟲ 2h 40m\nctx 34%\n↑ 15.6k  ↓ 3.0k  cache 954.2k\n$4.32')
})

test('the band shows limits, tokens, context and cost on every surface', async ($, on) => {
  mock.clock(on, { now: NOW })
  on('session.measure', ($, e) => ({ changed: e.changed }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box key="engine-band" />
  })

  await $.session.measure({
    context: { window: 200_000, tokens: 68_000, percent: 34 },
    rateLimits: [
      { kind: 'five_hour', percentUsed: 20, resetsAt: '2026-10-03T11:40:00Z' },
      { kind: 'seven_day', percentUsed: 58, resetsAt: '2026-10-04T16:00:00Z' },
    ],
    cost: { usd: 4.32 },
    changed: ['context', 'rateLimits', 'cost'],
  })
  await $.turn.complete({
    answer: 'ok',
    durationMs: 1000,
    isAborted: false,
    turnId: 't1',
    reason: 'answer',
    usage: {
      model: 'claude-opus-5-5',
      input_tokens: 12_600,
      cache_creation_input_tokens: 3_000,
      output_tokens: 3_000,
      cache_read_input_tokens: 954_200,
    },
  })

  for (const surface of ['terminal', 'desktop', 'mobile'] as const) {
    const ui = await $.ui.mount({ plugin: 'usage-bar', surface, ...BAND })
    for (const text of ['5h', '20%', '⟲ 2h 40m', '7d', '58%', '⟲ 1d 7h', 'ctx', '34%', '↑ 15.6k', '↓ 3.0k', 'cache 954.2k', '$4.32']) {
      expect(await ui.find({ type: 'Text', text })).toBeDefined()
    }
    await ui.unmount()
  }
})

test('the band stays out of the way of a survey and before any figures', async ($, on) => {
  mock.clock(on, { now: NOW })
  on('session.measure', ($, e) => ({ changed: e.changed }))
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box key="engine-band" />
  })

  const empty = await $.ui.mount({ plugin: 'usage-bar', surface: 'terminal', ...BAND })
  expect(await empty.find({ key: 'engine-band' })).toBeDefined()
  await empty.unmount()

  await $.session.measure({
    context: { window: 200_000, percent: 10 },
    rateLimits: [],
    cost: { usd: 0.5 },
    changed: ['context', 'cost'],
  })
  const survey = await $.ui.mount({
    plugin: 'usage-bar',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { ...BAND.props, hasSurvey: true },
  })
  expect(await survey.find({ key: 'engine-band' })).toBeDefined()
  expect(await survey.find({ type: 'Text', text: '$0.50' })).toBeUndefined()
  await survey.unmount()
})
