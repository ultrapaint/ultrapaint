import type { DesignNode } from "@ultrapaint/contracts/document";
import {
  Component,
  File,
  Image,
  SquareDashed,
  StretchHorizontal,
  StretchVertical,
  Type,
} from "lucide-react";

/**
 * The icon of a node's type, as the layers show it: one glyph per kind,
 * drawn so a row reads as its layout. A row lays its children side by side, a column one under
 * the other, a group stacks them freely.
 */
export const NodeIcon = ({
  className = "size-3",
  node,
}: {
  className?: string;
  node: DesignNode;
}) => {
  switch (node.type) {
    case "page":
      return <File className={className} />;
    case "row":
      return <StretchVertical className={className} />;
    case "column":
      return <StretchHorizontal className={className} />;
    case "group":
      return <SquareDashed className={className} />;
    case "text":
      return <Type className={className} />;
    case "image":
      return <Image className={className} />;
    default:
      return <Component className={className} />;
  }
};
