import type { DesignNode } from "@ultrapaint/contracts/document";
import {
  Columns3,
  Component,
  File,
  Group,
  Image,
  Rows3,
  Type,
} from "lucide-react";

/** The icon of a node's type, as the layers and the selection's tag show it. */
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
      return <Columns3 className={className} />;
    case "column":
      return <Rows3 className={className} />;
    case "group":
      return <Group className={className} />;
    case "text":
      return <Type className={className} />;
    case "image":
      return <Image className={className} />;
    default:
      return <Component className={className} />;
  }
};
