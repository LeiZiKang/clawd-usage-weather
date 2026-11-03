export type Limit = { kind: string; percentUsed: number; resetsAt?: string }
export type Sample = { t: number; pct: number }
export type Spend = { input: number; output: number; cacheRead: number; cacheWrite: number; turns: number }
export type Slice = { name: string; tokens: number }
export type Snapshot = { percent?: number; tokens?: number; window: number; limits: Limit[] }

declare module 'claude-code' {
  interface PluginState {
    'usage-weather': { snapshot: Snapshot | null; now: number; frame: number; isHidden: boolean; isClassic: boolean; avatar: 'clawd' | 'bunny' | 'photo'; petImage: string; samples: Sample[]; spend: Spend; slices: Slice[] }
  }
}
