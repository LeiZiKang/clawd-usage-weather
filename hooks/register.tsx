import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Snapshot } from '../types'

const snapshot = atom({ plugin: 'usage-weather', key: 'snapshot' } as const, null)
const clockNow = atom({ plugin: 'usage-weather', key: 'now' } as const, 0)
const frame = atom({ plugin: 'usage-weather', key: 'frame' } as const, 0)

// Clawd, as Claude Code's welcome screen draws it, in four rows so it can hop
const CLAWD_ORANGE = '#D97757'
const GROUND = ['         ', ' ▐▛███▜▌ ', '▝▜█████▛▘', '  ▘▘ ▝▝  ']
const AIR = [' ▐▛███▜▌ ', '▝▜█████▛▘', '  ▘▘ ▝▝  ', '         ']
// working: keeps hopping; idle: one hop every few seconds
const pose = (tick: number, isWorking: boolean) =>
  isWorking ? (tick % 2 === 1 ? AIR : GROUND) : tick % 12 === 0 ? AIR : GROUND

// context nearly full: Clawd turns red, trembles in place and sweats
const PANIC_AT = 90
const PANIC_RED = '#ff4d4d'
const SWEAT_BLUE = '#6cc3ff'
// Desktop: Clawd as crisp SVG pixel art, animated with SMIL (no redraws needed)
// 14 × 10 pixel grid: body, side claws, four legs; eyes drawn on top
const CLAWD_PIXELS = [
  // decoded pixel-for-pixel from the welcome screen's  ▐▛███▜▌ / ▝▜█████▛▘ /   ▘▘ ▝▝
  '...XXXXXXXXXXXX...',
  '...XX.XXXXXX.XX...',
  '.XXXXXXXXXXXXXXXX.',
  '...XXXXXXXXXXXX...',
  '....X.X....X.X....',
]

const clawdBody = (color: string) =>
  CLAWD_PIXELS.flatMap((row, y) =>
    [...row].map((c, x) => (c === 'X' ? `<rect x="${x}" y="${y * 1.6}" width="1.02" height="1.63" fill="${color}"/>` : '')),
  ).join('')

const sweatDrop = (x: number, delay: number) =>
  `<path d="M${x} 0 q0.7 1 0 1.5 q-0.7 -0.5 0 -1.5z" fill="${SWEAT_BLUE}" opacity="0">` +
  `<animateTransform attributeName="transform" type="translate" values="0 1;0.4 6" dur="0.9s" begin="${delay}s" repeatCount="indefinite"/>` +
  `<animate attributeName="opacity" values="0;1;0" dur="0.9s" begin="${delay}s" repeatCount="indefinite"/>` +
  `</path>`

const clawdSvg = (mood: 'idle' | 'working' | 'panic') => {
  const color = mood === 'panic' ? PANIC_RED : CLAWD_ORANGE
  const motion =
    mood === 'panic'
      ? `<animateTransform attributeName="transform" type="translate" values="1 3;1.5 3;0.5 3;1 3" dur="0.18s" repeatCount="indefinite"/>`
      : mood === 'working'
        ? `<animateTransform attributeName="transform" type="translate" values="1 3;1 0.5;1 3" keyTimes="0;0.45;1" dur="0.55s" calcMode="spline" keySplines="0.2 0.7 0.4 1;0.6 0 0.8 0.3" repeatCount="indefinite"/>`
        : `<animateTransform attributeName="transform" type="translate" values="1 3;1 3;1 0.8;1 3" keyTimes="0;0.82;0.9;1" dur="3.2s" repeatCount="indefinite"/>`
  const sweat = mood === 'panic' ? `<g>${sweatDrop(19.5, 0)}${sweatDrop(20.8, 0.45)}</g>` : ''
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 22 11.5" shape-rendering="crispEdges" style="background:transparent">` +
    `<g transform="translate(1 3)">${motion}${clawdBody(color)}</g>${sweat}</svg>`
  )
}

const tremble = (tick: number) => GROUND.map(row => (tick % 2 === 0 ? ` ${row}` : `${row} `))
const sweat = (tick: number) => {
  const drops = [' ', ' ', ' ', ' ']
  drops[tick % 3] = '💦'
  return drops
}

const weather = (p: number) =>
  p < 25 ? { text: '☀ Clear', color: '#f5c542' }
  : p < 50 ? { text: '☁ Cloudy', color: '#a8b3c2' }
  : p < 75 ? { text: '☂ Showers', color: '#4fa3ff' }
  : p < 90 ? { text: '☇ Storm', color: '#b37cff' }
  : { text: '↯ Compact soon', color: '#ff5c5c' }

// green → yellow → orange → red as a figure fills
const level = (v: number) => (v < 50 ? '#4cd17a' : v < 75 ? '#f5c542' : v < 90 ? '#ff9f43' : '#ff5c5c')

const meter = (v: number) => {
  const filled = Math.max(0, Math.min(5, Math.round(v / 20)))
  return '▰'.repeat(filled) + '▱'.repeat(5 - filled)
}

const LABELS: Record<string, string> = { five_hour: '5h', seven_day: 'Weekly' }

const fmtTokens = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : `${Math.round(n / 1000)}K`)

const countdown = (resetsAt: string | undefined, now: number) => {
  if (!resetsAt) return ''
  const ms = Date.parse(resetsAt) - now
  if (!(ms > 0)) return ''
  const m = Math.ceil(ms / 60000)
  const d = Math.floor(m / 1440)
  const h = Math.floor((m % 1440) / 60)
  return d > 0 ? ` ${d}d${h}h` : ` ${h}h${m % 60}m`
}

function toSnapshot(u: { context: { percent?: number; tokens?: number; window: number }; rateLimits: Snapshot['limits'] }): Snapshot {
  return {
    percent: u.context.percent,
    tokens: u.context.tokens,
    window: u.context.window,
    limits: u.rateLimits.map(r => ({ kind: r.kind, percentUsed: r.percentUsed, resetsAt: r.resetsAt })),
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    const s = toSnapshot(await $.session.usage())
    await update($, snapshot, () => s)
    const t = await $.clock.now()
    await update($, clockNow, () => t)
    // redraw the countdowns once a minute
    $.clock.every(60_000, () => {
      void $.clock.now().then(n => update($, clockNow, () => n))
    })
    $.clock.every(350, () => {
      void update($, frame, f => f + 1)
    })
    return result
  })

  on('session.measure', async ($, e, next) => {
    const s = toSnapshot(e)
    await update($, snapshot, () => s)
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const s = await read($, snapshot)
    if (e.props.hasSurvey || s === null) return next(e)

    const ui = $.ui.resolve(e)
    const { Box, Text } = ui
    const now = Math.max(await read($, clockNow), await $.clock.now())
    const p = s.percent ?? 0
    const w = weather(p)
    const isPanicking = p >= PANIC_AT
    const Svg = e.surface === 'terminal' ? undefined : (ui as { Svg?: (props: { source: string; alt: string; width?: number; height?: number; isInteractive?: boolean }) => unknown }).Svg
    // only the terminal's text crab reads the frame tick, so the SVG is not redrawn every 350ms
    const tick = Svg ? 0 : await read($, frame)
    const crab = isPanicking ? tremble(tick) : pose(tick, e.props.isWorking)
    const drops = isPanicking ? sweat(tick) : null
    const mood = isPanicking ? 'panic' : e.props.isWorking ? 'working' : 'idle'

    return (
      <Box flexDirection="row" alignItems="center">
        {Svg ? (
          <Svg source={clawdSvg(mood)} alt="Clawd" width={66} height={35} />
        ) : (
          <Box flexDirection="column">
            {crab.map((row, i) => (
              <Text key={i} color={isPanicking ? PANIC_RED : CLAWD_ORANGE}>{row}</Text>
            ))}
          </Box>
        )}
        {!Svg && drops && (
          <Box flexDirection="column">
            {drops.map((d, i) => (
              <Text key={i} color={SWEAT_BLUE}>{d}</Text>
            ))}
          </Box>
        )}
        <Text>  </Text>
        <Box>
        <Text color={w.color} bold>{w.text}</Text>
        <Text dimColor> Context </Text>
        {s.tokens === undefined ? (
          <Text dimColor>—</Text>
        ) : (
          <Text>
            <Text color={level(p)} bold>{p}%</Text>
            <Text dimColor> {fmtTokens(s.tokens)}/{fmtTokens(s.window)}</Text>
          </Text>
        )}
        {s.limits.map(l => (
          <Text key={l.kind}>
            <Text dimColor>{'  │  '}{LABELS[l.kind] ?? l.kind} </Text>
            <Text color={level(l.percentUsed)}>{meter(l.percentUsed)} </Text>
            <Text color={level(l.percentUsed)} bold>{l.percentUsed}%</Text>
            <Text dimColor>{countdown(l.resetsAt, now)}</Text>
          </Text>
        ))}
        </Box>
      </Box>
    )
  })
}
