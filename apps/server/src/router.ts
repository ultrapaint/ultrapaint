import {
  type RequestInput,
  type RequestName,
  type RequestOutput,
  requests,
  type WireError,
} from "@ultrapaint/contracts/ipc";
import { Schema as S } from "effect";

export class AppError extends Error {
  readonly code: WireError["code"];

  constructor(code: WireError["code"], message: string) {
    super(message);
    this.code = code;
    this.name = "AppError";
  }
}

type Handler<M extends RequestName> = (
  input: RequestInput<M>
) => Promise<RequestOutput<M>> | RequestOutput<M>;

export type DispatchResult =
  | { ok: true; output: unknown }
  | { ok: false; error: WireError };

export class Router {
  private readonly handlers = new Map<string, Handler<RequestName>>();

  on<M extends RequestName>(method: M, handler: Handler<M>): this {
    this.handlers.set(method, handler as unknown as Handler<RequestName>);
    return this;
  }

  async dispatch(method: string, input: unknown): Promise<DispatchResult> {
    const spec = (
      requests as Record<
        string,
        { input: S.Schema<unknown>; output: S.Schema<unknown> }
      >
    )[method];
    const handler = this.handlers.get(method);
    if (!(spec && handler)) {
      return {
        error: { code: "not_found", message: `unknown method ${method}` },
        ok: false,
      };
    }
    const decoded = S.decodeUnknownEither(spec.input)(input);
    if (decoded._tag === "Left") {
      return {
        error: { code: "bad_request", message: decoded.left.message },
        ok: false,
      };
    }
    try {
      const output = await handler(decoded.right as never);
      const encoded = S.encodeUnknownSync(spec.output)(output);
      return { ok: true, output: encoded };
    } catch (error) {
      if (error instanceof AppError) {
        return {
          error: { code: error.code, message: error.message },
          ok: false,
        };
      }
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[ultrapaint] ${method} failed:`, error);
      return { error: { code: "internal", message }, ok: false };
    }
  }
}
