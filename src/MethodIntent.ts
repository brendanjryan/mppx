import { z } from 'zod/mini'
import type * as Intent from './Intent.js'

/**
 * A payment method-specific intent.
 */
export type MethodIntent<
  intent extends Intent.Intent = Intent.Intent,
  options extends fromIntent.Options<intent> = fromIntent.Options<intent>,
> = {
  method: options['method']
  name: intent['name']
  schema: {
    credential: {
      payload: options['schema']['credential']['payload']
    }
    request: MergedRequestSchema<intent, options>
  }
}

/**
 * Creates a method-specific intent.
 *
 * @example
 * ```ts
 * import { z } from 'zod/mini'
 * import { MethodIntent } from 'mpay'
 *
 * const tempoCharge = MethodIntent.from({
 *   method: 'tempo',
 *   name: 'charge',
 *   schema: {
 *     credential: {
 *       payload: z.object({
 *         signature: z.string(),
 *         type: z.literal('transaction'),
 *       }),
 *     },
 *     request: z.object({
 *       amount: z.string(),
 *       currency: z.string(),
 *       recipient: z.string(),
 *     }),
 *   },
 * })
 * ```
 */
export function from<const intent extends MethodIntent>(intent: intent): intent {
  return intent
}

/**
 * Creates a method-specific intent from a base intent.
 *
 * @example
 * ```ts
 * import { z } from 'zod/mini'
 * import { Intent, MethodIntent } from 'mpay'
 *
 * const tempoCharge = MethodIntent.fromIntent(Intent.charge, {
 *   method: 'tempo',
 *   schema: {
 *     credential: {
 *       payload: z.object({
 *         signature: z.string(),
 *         type: z.literal('transaction'),
 *       }),
 *     },
 *     request: {
 *       methodDetails: z.object({
 *         chainId: z.number(),
 *       }),
 *       requires: ['recipient'],
 *     },
 *   },
 * })
 * ```
 */
export function fromIntent<
  const intent extends Intent.Intent,
  const options extends fromIntent.Options<intent>,
>(intent: intent, options: options): MethodIntent<intent, options> {
  const { name } = intent
  const { method, schema } = options

  const requestShape = intent.schema.request.shape as Record<string, z.ZodMiniType>

  const methodDetails = schema.request?.methodDetails
  const requires = schema.request?.requires ?? []

  const requestInputShape: Record<string, z.ZodMiniType> = {}
  for (const [key, field] of Object.entries(requestShape)) {
    if (requires.includes(key as never) && '_zod' in field) {
      const def = (field._zod as { def?: { innerType?: z.ZodMiniType } }).def
      requestInputShape[key] = def?.innerType ?? field
    } else requestInputShape[key] = field
  }

  const methodDetailsKeys: string[] = []
  if (methodDetails)
    for (const [key, field] of Object.entries(
      methodDetails.shape as Record<string, z.ZodMiniType>,
    )) {
      requestInputShape[key] = field
      methodDetailsKeys.push(key)
    }

  const request = z.pipe(
    z.object(requestInputShape),
    z.transform((input: Record<string, unknown>) => {
      if (methodDetailsKeys.length === 0) return input

      const result: Record<string, unknown> = {}
      const details: Record<string, unknown> = {}

      for (const [key, value] of Object.entries(input)) {
        if (methodDetailsKeys.includes(key)) {
          if (value !== undefined) details[key] = value
        } else result[key] = value
      }

      if (Object.keys(details).length > 0) result.methodDetails = details
      return result
    }),
  )

  return {
    method,
    name,
    schema: {
      credential: { payload: schema.credential.payload },
      request,
    },
  } as unknown as MethodIntent<intent, options>
}

export namespace fromIntent {
  export type Options<intent extends Intent.Intent> = {
    method: string
    schema: {
      credential: { payload: z.ZodMiniType }
      request?:
        | {
            methodDetails?: z.ZodMiniObject | undefined
            requires?: ReadonlyArray<keyof z.input<intent['schema']['request']>> | undefined
          }
        | undefined
    }
  }
}

/** @internal */
type RequiresKeys<
  intent extends Intent.Intent,
  options extends fromIntent.Options<intent>,
> = options['schema']['request'] extends { requires: ReadonlyArray<infer K> } ? K : never

/** @internal */
type UnwrapOptional<T> = T extends z.ZodMiniOptional<infer U> ? U : T

/** @internal */
type MethodDetailsShape<
  intent extends Intent.Intent,
  options extends fromIntent.Options<intent>,
> = options['schema']['request'] extends { methodDetails: infer M extends z.ZodMiniObject }
  ? M['shape']
  : Record<never, never>

/** @internal */
type InputRequestShape<intent extends Intent.Intent, options extends fromIntent.Options<intent>> = {
  [K in keyof intent['schema']['request']['shape']]: K extends RequiresKeys<intent, options>
    ? UnwrapOptional<intent['schema']['request']['shape'][K]>
    : intent['schema']['request']['shape'][K]
} & MethodDetailsShape<intent, options>

/** @internal */
type MethodDetailsOutput<
  intent extends Intent.Intent,
  options extends fromIntent.Options<intent>,
> = options['schema']['request'] extends { methodDetails: infer M extends z.ZodMiniObject }
  ? { methodDetails?: z.output<M> }
  : Record<never, never>

/** @internal */
type OutputRequestType<intent extends Intent.Intent, options extends fromIntent.Options<intent>> = {
  [K in keyof intent['schema']['request']['shape']]: K extends RequiresKeys<intent, options>
    ? z.output<UnwrapOptional<intent['schema']['request']['shape'][K]>>
    : z.output<intent['schema']['request']['shape'][K]>
} & MethodDetailsOutput<intent, options>

/** @internal */
type MergedRequestSchema<
  intent extends Intent.Intent,
  options extends fromIntent.Options<intent>,
> = z.ZodMiniType<
  OutputRequestType<intent, options>,
  z.input<z.ZodMiniObject<InputRequestShape<intent, options>>>
>
