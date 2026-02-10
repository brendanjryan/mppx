import { charge as charge_ } from './Charge.js'
import { stream as stream_ } from './Stream.js'

export type { ChannelState, ChannelStorage, SessionState } from '../stream/Storage.js'
export { charge } from './Charge.js'
export { settle, stream } from './Stream.js'

export function tempo<const defaults extends tempo.Defaults>(
  parameters: tempo.Parameters<defaults>,
) {
  return [tempo.charge(parameters), tempo.stream(parameters)] as const
}

export namespace tempo {
  export type Defaults = charge_.Defaults & stream_.Defaults

  export type Parameters<defaults extends Defaults = {}> = charge_.Parameters<defaults> &
    stream_.Parameters<defaults>

  export const charge = charge_
  export const stream = stream_
}
