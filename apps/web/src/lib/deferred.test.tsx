// @vitest-environment happy-dom
import { act, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { deferred } from "./deferred.ts";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const Greeting = ({ name }: { readonly name: string }) => <p>Hello {name}</p>;

/** A module whose code arrives when `arrive` is called, as a lazy chunk does. */
const slowModule = () => {
  let resolve: (component: typeof Greeting) => void = () => undefined;
  const promise = new Promise<typeof Greeting>((done) => {
    resolve = done;
  });
  return { arrive: () => resolve(Greeting), load: () => promise };
};

const container = document.createElement("div");
document.body.append(container);
const root = createRoot(container);
afterEach(() => act(() => root.render(null)));

const draw = (Component: typeof Greeting) =>
  act(() =>
    root.render(
      <Suspense fallback={<p>Loading</p>}>
        <Component name="Ada" />
      </Suspense>
    )
  );

describe("a component loaded apart", () => {
  it("is drawn at once once preloaded, with no fallback", async () => {
    const module = slowModule();
    const greeting = deferred(module.load);
    const preloading = greeting.preload();
    module.arrive();
    await preloading;
    // Drawn as it is asked for, before any promise could settle: nothing suspended.
    act(() =>
      root.render(
        <Suspense fallback={<p>Loading</p>}>
          <greeting.Component name="Ada" />
        </Suspense>
      )
    );
    expect(container.textContent).toBe("Hello Ada");
  });

  it("shows the fallback until its code arrives when it was not preloaded", async () => {
    const module = slowModule();
    const greeting = deferred(module.load);
    await draw(greeting.Component);
    expect(container.textContent).toBe("Loading");
    await act(async () => {
      module.arrive();
      await module.load();
    });
    expect(container.textContent).toBe("Hello Ada");
  });
});
