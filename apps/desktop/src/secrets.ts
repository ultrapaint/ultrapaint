/**
 * Secrets the app keeps for the user, the key Claude Code signs in with: encrypted by the
 * system's keychain (Electron's `safeStorage`: the Keychain on macOS, the Secret Service or
 * KWallet on Linux) before they are written anywhere. Where there is no keychain to do it, the
 * app keeps none.
 */
import { Context, Effect, Layer, Schema } from "effect";

const SEALED_RE = /^sealed:/;

export class SecretError extends Schema.TaggedError<SecretError>()(
  "SecretError",
  { message: Schema.String }
) {}

export class Secrets extends Context.Service<
  Secrets,
  {
    /** Whether a keychain is there to keep a secret with. */
    readonly available: boolean;
    readonly decrypt: (sealed: string) => Effect.Effect<string, SecretError>;
    /** The secret, encrypted, as base64. */
    readonly encrypt: (plain: string) => Effect.Effect<string, SecretError>;
  }
>()("ultrapaint/desktop/Secrets") {
  /** Reversible and plain, for tests: never where a real key goes. */
  static readonly layerTest = Layer.succeed(
    Secrets,
    Secrets.of({
      available: true,
      decrypt: (sealed) =>
        Effect.succeed(
          Buffer.from(sealed, "base64").toString().replace(SEALED_RE, "")
        ),
      encrypt: (plain) =>
        Effect.succeed(Buffer.from(`sealed:${plain}`).toString("base64")),
    })
  );
}
