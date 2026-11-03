import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Sample, Snapshot, Spend } from '../types'

const snapshot = atom({ plugin: 'usage-weather', key: 'snapshot' } as const, null)
const clockNow = atom({ plugin: 'usage-weather', key: 'now' } as const, 0)
const frame = atom({ plugin: 'usage-weather', key: 'frame' } as const, 0)
// per session: /weather off hides the band in this session only
// pirate look is the default; /weather classic switches back
const isClassic = atom({ plugin: 'usage-weather', key: 'isClassic' } as const, false)
const samples = atom({ plugin: 'usage-weather', key: 'samples' } as const, [])
const spend = atom({ plugin: 'usage-weather', key: 'spend' } as const, { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, turns: 0 })
const slices = atom({ plugin: 'usage-weather', key: 'slices' } as const, [])
const PANE = 'usage-weather-top'

// Burn rate: how fast the 5-hour window fills, over the last 30 minutes of readings.
// 20%/h empties the window exactly at reset, so that is "1× pace".
const PACE = 20
const burnRate = (list: Sample[], now: number) => {
  const recent = list.filter(x => now - x.t <= 30 * 60_000)
  if (recent.length < 2) return null
  const a = recent[0]!, b = recent[recent.length - 1]!
  const hours = (b.t - a.t) / 3_600_000
  return hours < 1 / 60 ? null : Math.max(0, (b.pct - a.pct) / hours)
}

// speedometer: a 180° arc green → yellow → red, needle at rate / (2 × pace)
const gaugeSvg = (rate: number | null) => {
  const f = rate === null ? 0 : Math.min(1, rate / (2 * PACE))
  const ang = Math.PI * (1 - f)
  const nx = 12 + 9 * Math.cos(ang), ny = 12 - 9 * Math.sin(ang)
  const arc = (from: number, to: number, c: string) => {
    const p = (t: number) => `${12 + 10 * Math.cos(Math.PI * (1 - t))} ${12 - 10 * Math.sin(Math.PI * (1 - t))}`
    return `<path d="M${p(from)} A10 10 0 0 1 ${p(to)}" stroke="${c}" stroke-width="2.6" fill="none"/>`
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 14" style="background:transparent">` +
    arc(0, 0.5, '#4cd17a') + arc(0.5, 0.75, '#f5c542') + arc(0.75, 1, '#ff5c5c') +
    `<line x1="12" y1="12" x2="${nx}" y2="${ny}" stroke="${rate === null ? '#777' : '#f2efe6'}" stroke-width="1.1" stroke-linecap="round"/>` +
    `<circle cx="12" cy="12" r="1.4" fill="#f2efe6"/></svg>`
  )
}
const fmtRate = (rate: number | null) => (rate === null ? '—' : `${(rate / PACE).toFixed(1)}× pace`)

// which pet: /weather bunny | clawd, remembered across sessions in $.store
const avatar = atom({ plugin: 'usage-weather', key: 'avatar' } as const, 'clawd')
// your own pet: a cut-out PNG on your disk (/weather photo <path>), kept as base64
const petImage = atom({ plugin: 'usage-weather', key: 'petImage' } as const, '')
const isHidden = atom({ plugin: 'usage-weather', key: 'isHidden' } as const, false)

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

// Pirate kit, drawn in the body's own grid (18 × 5 pixels, each 1.6 units tall)
const PIRATE_HAT =
  `<polygon points="4.5,-1.2 5.5,-4 12.5,-4 13.5,-1.2" fill="#3b2a24" stroke="#c9a227" stroke-width="0.25"/>` +
  `<path d="M1 -0.4 Q9 -2.6 17 -0.4 L17 0.2 Q9 -1.6 1 0.2 Z" fill="#3b2a24" stroke="#c9a227" stroke-width="0.25" shape-rendering="geometricPrecision"/>` +
  `<rect x="8.3" y="-3.4" width="1.4" height="1.1" fill="#f2efe6"/>` +
  `<rect x="8.1" y="-2.3" width="0.6" height="0.4" fill="#f2efe6"/><rect x="9.3" y="-2.3" width="0.6" height="0.4" fill="#f2efe6"/>`
const EYE_PATCH =
  `<rect x="3" y="0.9" width="9" height="0.3" fill="#1b1b1f"/>` +
  `<rect x="11.4" y="1.3" width="2.4" height="2.2" rx="0.5" fill="#1b1b1f"/>`
// cutlass in the right claw; it swings while Claude works
const cutlass = (swing: boolean) =>
  `<g shape-rendering="geometricPrecision">` +
  (swing
    ? `<animateTransform attributeName="transform" type="rotate" values="0 17.6 4.4;-35 17.6 4.4;0 17.6 4.4" dur="0.55s" repeatCount="indefinite"/>`
    : '') +
  `<path d="M17.9 3.6 Q20.5 1 21.8 -2.6 Q22.4 -1 20.2 2.3 L18.5 4.1 Z" fill="#d8dde3"/>` +
  `<path d="M18.2 3.7 Q20.6 1.1 21.8 -2.6" stroke="#9aa3ad" stroke-width="0.2" fill="none"/>` +
  `<rect x="16.6" y="3.4" width="3" height="0.6" rx="0.3" fill="#c9a227" transform="rotate(-40 18.1 3.7)"/>` +
  `<rect x="17" y="4" width="0.8" height="1.4" fill="#6b4226"/>` +
  `</g>`

const clawdSvg = (mood: 'idle' | 'working' | 'panic', isPirate: boolean) => {
  const color = mood === 'panic' ? PANIC_RED : CLAWD_ORANGE
  const motion =
    mood === 'panic'
      ? `<animateTransform attributeName="transform" type="translate" values="1 4;1.5 4;0.5 4;1 4" dur="0.18s" repeatCount="indefinite"/>`
      : mood === 'working'
        ? `<animateTransform attributeName="transform" type="translate" values="1 4;1 1.5;1 4" keyTimes="0;0.45;1" dur="0.55s" calcMode="spline" keySplines="0.2 0.7 0.4 1;0.6 0 0.8 0.3" repeatCount="indefinite"/>`
        : `<animateTransform attributeName="transform" type="translate" values="1 4;1 4;1 1.8;1 4" keyTimes="0;0.82;0.9;1" dur="3.2s" repeatCount="indefinite"/>`
  const sweat = mood === 'panic' ? `<g>${sweatDrop(0.2, 0)}${sweatDrop(-0.8, 0.45)}</g>` : ''
  const kit = isPirate ? `${EYE_PATCH}${PIRATE_HAT}${cutlass(mood === 'working')}` : ''
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-2 -3 27 15.5" shape-rendering="crispEdges" style="background:transparent">` +
    `<g transform="translate(1 4)">${motion}${clawdBody(color)}${kit}</g>${sweat}</svg>`
  )
}

// The owner's bunny, from the front: all white, dark ear rims, pink inner ears,
// dark eyeliner around the eyes, pink nose (square pixels)
const BUNNY_PIXELS = [
  'KK.............KK',
  'KWK...........KWK',
  'KPWK.........KWPK',
  '.KPWK.......KWPK.',
  '.KPPWK.....KWPPK.',
  '..KPWK.....KWPK..',
  '..KWWWWWWWWWWWK..',
  '..WWWWWWWWWWWWW..',
  '.WWWWWWWWWWWWWWW.',
  '.WWKKWWWWWWWKKWW.',
  '.WKEEKWWWWWKEEKW.',
  '.WKEGKWWWWWKEGKW.',
  '.WWKKWWWWWWWKKWW.',
  'WWWWWWWWPWWWWWWWW',
  'WWWWWWWPWPWWWWWWW',
  '.WWWWWWWWWWWWWWW.',
  '..WWWWWWWWWWWWW..',
  '...WWW.....WWW...',
]
const bunnySvg = (mood: 'idle' | 'working' | 'panic') => {
  // panic: the white fur flushes red
  const colors: Record<string, string> = {
    W: mood === 'panic' ? '#ffb0a8' : '#f4f1ea', K: '#36363c', P: '#f2a7b3', E: '#0d0d10', G: '#ffffff',
  }
  const body = BUNNY_PIXELS.flatMap((row, y) =>
    [...row].map((c, x) => (colors[c] ? `<rect x="${x}" y="${y}" width="1.02" height="1.02" fill="${colors[c]}"/>` : '')),
  ).join('')
  const motion =
    mood === 'panic'
      ? `<animateTransform attributeName="transform" type="translate" values="1 3;1.5 3;0.5 3;1 3" dur="0.18s" repeatCount="indefinite"/>`
      : mood === 'working'
        ? `<animateTransform attributeName="transform" type="translate" values="1 3;1 0.3;1 3" keyTimes="0;0.45;1" dur="0.55s" calcMode="spline" keySplines="0.2 0.7 0.4 1;0.6 0 0.8 0.3" repeatCount="indefinite"/>`
        : `<animateTransform attributeName="transform" type="translate" values="1 3;1 3;1 0.8;1 3" keyTimes="0;0.82;0.9;1" dur="3.2s" repeatCount="indefinite"/>`
  const sweat = mood === 'panic' ? `<g>${sweatDrop(0.2, 0)}${sweatDrop(-0.8, 0.45)}</g>` : ''
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-1 0 21 22" shape-rendering="crispEdges" style="background:transparent">` +
    `<g transform="translate(1 3)">${motion}${body}</g>${sweat}</svg>`
  )
}

// the pet photo hops like Clawd; in a panic it flushes red and sweats
const photoSvg = (mood: 'idle' | 'working' | 'panic', base64: string) => {
  const motion =
    mood === 'panic'
      ? `<animateTransform attributeName="transform" type="translate" values="4 10;6 10;2 10;4 10" dur="0.18s" repeatCount="indefinite"/>`
      : mood === 'working'
        ? `<animateTransform attributeName="transform" type="translate" values="4 10;4 1;4 10" keyTimes="0;0.45;1" dur="0.55s" calcMode="spline" keySplines="0.2 0.7 0.4 1;0.6 0 0.8 0.3" repeatCount="indefinite"/>`
        : `<animateTransform attributeName="transform" type="translate" values="4 10;4 10;4 2;4 10" keyTimes="0;0.82;0.9;1" dur="3.2s" repeatCount="indefinite"/>`
  const flush = mood === 'panic'
    ? `<filter id="flush"><feColorMatrix type="matrix" values="1 0 0 0 0  0 0.6 0 0 0  0 0 0.6 0 0  0 0 0 1 0"/></filter>`
    : ''
  const sweat = mood === 'panic' ? `<g transform="scale(5)">${sweatDrop(1, 0)}${sweatDrop(0.2, 0.45)}</g>` : ''
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 114 132" style="background:transparent">${flush}` +
    `<g transform="translate(4 10)">${motion}<image href="data:image/png;base64,${base64}" width="106" height="120"${mood === 'panic' ? ' filter="url(#flush)"' : ''}/></g>${sweat}</svg>`
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
    const saved = await $.store.get('avatar')
    if (saved === 'bunny' || saved === 'clawd' || saved === 'photo') await update($, avatar, () => saved)
    const petPath = await $.store.get('petPath')
    if (typeof petPath === 'string') {
      try {
        const { base64 } = (await $.fs.read(petPath, { as: 'bytes' })) as { base64: string }
        await update($, petImage, () => base64)
      } catch {
        // the file moved: fall back to Clawd until /weather photo is run again
      }
    }
    await $.command.register({
      name: 'weather',
      description: 'Usage weather band in this session: /weather on | off | top | photo <png> | bunny | clawd | pirate | classic',
    })
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

  on('command.run', { command: 'weather' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg.startsWith('photo')) {
      const path = e.args.trim().slice('photo'.length).trim()
      if (path) {
        try {
          const { base64 } = (await $.fs.read(path, { as: 'bytes' })) as { base64: string }
          await update($, petImage, () => base64)
          await $.store.set('petPath', path)
        } catch {
          return { text: `Could not read ${path}. Give the absolute path of a PNG with a transparent background.` }
        }
      } else if (!(await read($, petImage))) {
        return { text: 'Usage: /weather photo /absolute/path/to/pet.png (a small PNG cut-out, about 120px tall)' }
      }
      await update($, avatar, () => 'photo')
      await $.store.set('avatar', 'photo')
      return { text: '🐾 Your pet is here (every session from now on).' }
    }
    if (arg === 'bunny' || arg === 'clawd') {
      await update($, avatar, () => arg)
      await $.store.set('avatar', arg)
      return { text: arg === 'bunny' ? '🐰 The bunny is here (every session from now on).' : 'Clawd is back (every session from now on).' }
    }
    if (arg === 'top') {
      const u = await $.session.usage({ breakdown: 'summary' })
      const cats = (u.context.breakdown?.categories ?? [])
        .filter(c => c.tokens > 0 && c.name !== 'Free space' && c.name !== 'Autocompact buffer')
        .map(c => ({ name: c.name, tokens: c.tokens }))
        .sort((a, b) => b.tokens - a.tokens)
      await update($, slices, () => cats)
      await $.ui.open({ id: PANE, title: 'Token usage' })
      return { text: 'Opened the token usage pane.' }
    }
    if (arg === 'pirate' || arg === 'classic') {
      await update($, isClassic, () => arg === 'classic')
      return { text: arg === 'pirate' ? 'Arr! Clawd is a pirate now. 🏴‍☠️' : 'Clawd is back to classic.' }
    }
    const hide = arg === 'off' ? true : arg === 'on' ? false : !(await read($, isHidden))
    await update($, isHidden, () => hide)
    return { text: hide ? 'Usage weather hidden in this session. /weather on brings it back.' : 'Usage weather shown.' }
  })

  on('turn.complete', async ($, e, next) => {
    const u = e.usage
    if (u) {
      await update($, spend, x => ({
        input: x.input + u.input_tokens,
        output: x.output + u.output_tokens,
        cacheRead: x.cacheRead + (u.cache_read_input_tokens ?? 0),
        cacheWrite: x.cacheWrite + (u.cache_creation_input_tokens ?? 0),
        turns: x.turns + 1,
      }))
    }
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const list = await read($, slices)
    const sp = await read($, spend)
    const rate = burnRate(await read($, samples), await $.clock.now())
    const width = Math.max(10, Math.min(30, (e.props.bodyColumns ?? 60) - 30))
    const bars = (rows: { name: string; tokens: number }[], color: string) => {
      const top = Math.max(1, ...rows.map(r => r.tokens))
      return rows.map(r => (
        <Text key={r.name}>
          <Text>{r.name.padEnd(22).slice(0, 22)} </Text>
          <Text color={color}>{'█'.repeat(Math.max(1, Math.round((r.tokens / top) * width)))}</Text>
          <Text dimColor> {fmtTokens(r.tokens)}</Text>
        </Text>
      ))
    }
    const spent = [
      { name: 'Cache read', tokens: sp.cacheRead },
      { name: 'Cache write', tokens: sp.cacheWrite },
      { name: 'Output', tokens: sp.output },
      { name: 'Input (uncached)', tokens: sp.input },
    ].sort((a, b) => b.tokens - a.tokens)
    return (
      <Box flexDirection="column">
        <Text bold>Burn rate: {fmtRate(rate)}</Text>
        <Text dimColor>1× = 5h window lasts exactly until reset</Text>
        <Text> </Text>
        <Text bold>What fills the context now</Text>
        {list.length === 0 ? <Text dimColor>Measuring…</Text> : bars(list.slice(0, 8), CLAWD_ORANGE)}
        <Text> </Text>
        <Text bold>Tokens spent this session ({sp.turns} turns)</Text>
        {bars(spent, '#4fa3ff')}
      </Box>
    )
  })

  on('session.measure', async ($, e, next) => {
    const s = toSnapshot(e)
    await update($, snapshot, () => s)
    const five = e.rateLimits.find(r => r.kind === 'five_hour')
    if (five) {
      const t = await $.clock.now()
      // a reset drops the percentage: start the history over
      await update($, samples, list => {
        const kept = list.filter(x => t - x.t <= 60 * 60_000)
        const last = kept[kept.length - 1]
        return [...(last && five.percentUsed < last.pct ? [] : kept), { t, pct: five.percentUsed }]
      })
    }
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const s = await read($, snapshot)
    if (e.props.hasSurvey || s === null || (await read($, isHidden))) return next(e)

    const ui = $.ui.resolve(e)
    const { Box, Text } = ui
    const now = Math.max(await read($, clockNow), await $.clock.now())
    const p = s.percent ?? 0
    const w = weather(p)
    const isPanicking = p >= PANIC_AT
    const rate = burnRate(await read($, samples), now)
    const Svg = e.surface === 'terminal' ? undefined : ('Svg' in ui ? ui.Svg : undefined)
    // only the terminal's text crab reads the frame tick, so the SVG is not redrawn every 350ms
    const tick = Svg ? 0 : await read($, frame)
    const crab = isPanicking ? tremble(tick) : pose(tick, e.props.isWorking)
    const drops = isPanicking ? sweat(tick) : null
    const mood = isPanicking ? 'panic' : e.props.isWorking ? 'working' : 'idle'

    return (
      <Box flexDirection="row" alignItems="center">
        {Svg ? (
          (await read($, avatar)) === 'photo' && (await read($, petImage)) ? (
          <Svg source={photoSvg(mood, await read($, petImage))} alt="Pet" width={40} height={46} />
        ) : (await read($, avatar)) === 'bunny' ? (
          <Svg source={bunnySvg(mood)} alt="Bunny" width={44} height={46} />
        ) : (
          <Svg source={clawdSvg(mood, !(await read($, isClassic)))} alt="Clawd" width={80} height={46} />
        )
        ) : (
          <Box flexDirection="column">
            {crab.map((row, i) => (
              <Text key={String(i)} color={isPanicking ? PANIC_RED : CLAWD_ORANGE}>{row}</Text>
            ))}
          </Box>
        )}
        {!Svg && drops && (
          <Box flexDirection="column">
            {drops.map((d, i) => (
              <Text key={String(i)} color={SWEAT_BLUE}>{d}</Text>
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
        <Text dimColor>{'  │  '}</Text>
        {Svg ? <Svg source={gaugeSvg(rate)} alt={`Burn rate ${fmtRate(rate)}`} width={34} height={20} /> : <Text dimColor>⏱ </Text>}
        <Text color={rate === null ? undefined : level((rate / (2 * PACE)) * 100)}> {fmtRate(rate)}</Text>
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
