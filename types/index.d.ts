export type Limit = { kind: string; percentUsed: number; resetsAt?: string }
export type Snapshot = { percent?: number; tokens?: number; window: number; limits: Limit[] }

declare module 'claude-code' {
  interface PluginState {
    'usage-weather': { snapshot: Snapshot | null; now: number; frame: number; isHidden: boolean }
  }
}
