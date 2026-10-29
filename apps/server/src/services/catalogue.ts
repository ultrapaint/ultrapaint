import type { Catalogue } from "@ultrapaint/contracts/catalogue";
import type { ForbiddenPath } from "@ultrapaint/contracts/errors";
import { systemCatalogue } from "@ultrapaint/system-components/catalogue";
import { Context, Effect, Layer } from "effect";

/** The catalogue is the editor's own: it is the same for every project, and known at once. */
const SYSTEM_COMPONENTS: Catalogue = {
  builtAt: 0,
  components: systemCatalogue(),
  coverage: { total: 0, usable: 0 },
};

/**
 * What a design is drawn with, for the Assets panel, the props inspector and the agents: the
 * editor's own system components (ADR 0040). Nothing is read from the repository.
 */
export class CatalogueService extends Context.Service<
  CatalogueService,
  {
    readonly get: (refresh: boolean) => Effect.Effect<Catalogue, ForbiddenPath>;
  }
>()("ultrapaint/server/CatalogueService") {
  static readonly layer = Layer.succeed(
    CatalogueService,
    CatalogueService.of({
      get: () =>
        Effect.succeed({
          ...SYSTEM_COMPONENTS,
          coverage: {
            total: SYSTEM_COMPONENTS.components.length,
            usable: SYSTEM_COMPONENTS.components.length,
          },
        }),
    })
  );
}
