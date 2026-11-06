export type Limit = { kind: string; percentUsed: number; resetsAt?: string }
export type Sample = { t: number; pct: number }
export type Spend = { input: number; output: number; cacheRead: number; cacheWrite: number; turns: number }
export type Slice = { name: string; tokens: number }
export type Snapshot = { percent?: number; tokens?: number; window: number; limits: Limit[] }
// tokens per local day (YYYY-MM-DD), read from the session transcripts
export type Heat = { today: string; days: Record<string, number> }

declare module 'claude-code' {
  interface PluginState {
    'usage-weather': { snapshot: Snapshot | null; now: number; frame: number; isHidden: boolean; isClassic: boolean; avatar: 'heatmap' | 'clawd' | 'bunny' | 'photo'; petImage: string; heat: Heat | null; samples: Sample[]; spend: Spend; slices: Slice[] }
  }
}
