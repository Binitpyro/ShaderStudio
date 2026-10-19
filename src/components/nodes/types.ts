import type { Node, NodeProps } from "@xyflow/react"

export type FlowNodeProps<
  TData extends Record<string, unknown> = Record<string, unknown>,
  TType extends string = string
> = NodeProps<Node<TData, TType>>
