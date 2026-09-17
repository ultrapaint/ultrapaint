import {
  DirectionProvider as DirectionProviderPrimitive,
  useDirection as useDirectionPrimitive,
} from "@base-ui/react/direction-provider";
import type { ComponentProps } from "react";

function DirectionProvider(
  props: ComponentProps<typeof DirectionProviderPrimitive>
) {
  return <DirectionProviderPrimitive {...props} />;
}

function useDirection() {
  return useDirectionPrimitive();
}

export { DirectionProvider, useDirection };
