# clawd-usage-weather

A [Claude Code mod](https://claude.dev/blog/getting-started-with-claude-code-mods/) that puts a little Clawd and a usage "weather forecast" above your prompt:

```
 ▐▛███▜▌
▝▜█████▛▘   ☀ Clear Context 5% 50K/1.0M  │  5h ▰▱▱▱▱ 24% 3h17m  │  Weekly ▱▱▱▱▱ 4% 6d21h
  ▘▘ ▝▝
```

- **Clawd** hops: continuously while Claude is working, now and then while idle. When the context window passes 90% he turns red, trembles and sweats 💦.
- **Context weather**: ☀ Clear (<25%) · ☁ Cloudy (<50%) · ☂ Showers (<75%) · ☇ Storm (<90%) · ↯ Compact soon.
- **Plan limits**: 5-hour and weekly usage with a colored meter (green → yellow → orange → red) and a reset countdown that ticks every minute. Shown on Pro/Max subscriptions after the first reply of a session.

Works in the terminal and in the Claude Desktop Code tab. It only reads figures Claude Code already has (`$.session.usage()`); no network calls, no files read or written.

## Install

Requires Claude Code **2.1.287+** (check with `claude --version`, upgrade with `claude update`). The Claude Desktop app ships its own engine.

```bash
git clone https://github.com/LeiZiKang/clawd-usage-weather ~/.claude/mods/usage-weather
```

Then load it in one of these ways:

- **One session:** `claude --plugin-dir ~/.claude/mods/usage-weather`
- **Every session (terminal and Desktop):** add to the `env` block of `~/.claude/settings.json`:
  ```json
  "CLAUDE_CODE_PLUGIN_DIRS": "~/.claude/mods/usage-weather"
  ```
  then start a new session (in Desktop, quit with ⌘Q and reopen; sessions only read this at start).

Check it with `claude plugin validate ~/.claude/mods/usage-weather`.

## How it works

A mod is a plugin whose `hooks/hooks.json` names a TypeScript module exporting `register(on)`. Each hook is `($, e, next)`: `$` is the engine API, `e` the event, `next` passes on to the engine's default behaviour.

```
.claude-plugin/plugin.json   manifest
hooks/hooks.json             { "modules": ["./register.tsx"] }
hooks/register.tsx           the mod
types/index.d.ts             types for the values kept in $.state
```

`hooks/register.tsx` uses four pieces:

1. **Getting the numbers.** On `session.start` it calls `$.session.usage()`, which returns the context window fill and the rate-limit windows (`five_hour`, `seven_day`, each with `percentUsed` and `resetsAt`). After that the engine pushes updates through the `session.measure` event after every turn. Each reading is saved in `$.state` with `update($, snapshot, ...)`.
2. **Drawing the band.** A `ui.render` hook on `{ component: 'AbovePrompt' }` returns a tree of `Box` / `Text` elements from `$.ui.resolve(e)`. Reading state while drawing subscribes the band, so every new reading redraws it automatically.
3. **Timers.** `$.clock.every(60_000, ...)` bumps a `now` value once a minute so the reset countdowns move without a new turn, and `$.clock.every(350, ...)` drives the terminal crab's animation frames.
4. **Clawd.**
   - **Terminal:** text frames built from the welcome-screen block characters. The crab is four rows tall so he has room to hop up one row.
   - **Desktop:** the same characters decoded into an 18×5 pixel grid, drawn as an `Svg` element with `shape-rendering="crispEdges"`. The hop, tremble and falling sweat drops are SMIL `<animate>`s inside the SVG, so the app doesn't redraw the band for them.

     The Desktop app lays text out in a proportional font, which is why the block-character crab breaks there and the SVG is needed. The SVG is a plain image (no `isInteractive`) so its background stays transparent instead of the interactive frame's white.

## Customize

All in `hooks/register.tsx`:

| What | Where |
| --- | --- |
| Weather words / thresholds | `weather()` |
| Meter colors | `level()` |
| Clawd color, panic threshold | `CLAWD_ORANGE`, `PANIC_AT`, `PANIC_RED` |
| Clawd pixel art | `CLAWD_PIXELS` (desktop), `GROUND` / `AIR` (terminal) |
| Hop speed | the `dur` values in `clawdSvg()`, `pose()` |

## Safety

Mods run inside Claude Code with Claude Code's own access. Read the source before installing any mod, this one included. It's about 200 lines.

## License

MIT. Clawd is Anthropic's mascot; this is an unofficial fan project.
