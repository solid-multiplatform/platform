/** The scene operations consumed by the shared Solid host. */
export interface HostNode {
  parent: HostNode | null;
  destroy(): void;
}

export interface HostRenderer<Node extends HostNode = HostNode, Shader = unknown, Texture = unknown> {
  readonly root: Node;
  createNode(props: Record<string, unknown>): Node;
  createTextNode(props: Record<string, unknown>): Node;
  createShader(kind: string, props: Record<string, unknown>): Shader;
  createTexture(kind: string, props: Record<string, unknown>): Texture;
  on(event: 'idle', callback: () => void): void;
  readonly stage: {
    loadFont(kind: string, options: object): unknown;
    reprocessUpdates?(callback: () => void): void;
  };
}
