import { describe, expect, test } from 'vitest'
import * as Challenge from './Challenge.js'

describe('Challenge multi', () => {
  test('splitChallenges extracts multiple Payment schemes from combined header', () => {
    const header =
      'Basic realm="foo", Payment id="a", realm="api.example.com", method="tempo", intent="charge", request="e30", Payment id="b", realm="api.example.com", method="tempo", intent="session", request="e30"'
    const parts = Challenge.splitChallenges(header)
    expect(parts.length).toBe(2)
    expect(parts[0]!.startsWith('Payment ')).toBe(true)
    expect(parts[1]!.startsWith('Payment ')).toBe(true)
  })

  test('deserializeAll parses multiple Payment challenges', () => {
    const header =
      'Payment id="a", realm="api.example.com", method="tempo", intent="charge", request="e30", Payment id="b", realm="api.example.com", method="tempo", intent="session", request="e30"'
    const challenges = Challenge.deserializeAll(header)
    expect(challenges.length).toBe(2)
    const intents = new Set(challenges.map((c) => c.intent))
    expect(intents.has('charge')).toBe(true)
    expect(intents.has('session')).toBe(true)
  })
})
