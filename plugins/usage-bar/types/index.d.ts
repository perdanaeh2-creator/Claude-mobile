export type Limit = { kind: string; percentUsed: number; resetsAt?: string }

export type Snapshot = {
  limits: Limit[]
  contextPercent?: number
  costUsd?: number
}

export type Tokens = { input: number; output: number; cache: number }

declare module 'claude-code' {
  interface PluginState {
    'usage-bar': { snapshot: Snapshot | null; tokens: Tokens; tick: number }
  }
}
