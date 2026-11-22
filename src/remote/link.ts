/** Byte-stream abstraction over a TCP connection, so protocol logic runs in jest without sockets. */
export interface Link {
  /** `line` is one complete JSON message including the trailing newline. */
  send(line: string): void;
  close(): void;
}

export type LinkHandlers = {
  onOpen(): void;
  onData(chunk: string): void;
  onClose(error?: string): void;
};

/** Opens a connection to `target` ("host:port" or a discovered service key). Handlers fire asynchronously. */
export type Dialer = (target: string, handlers: LinkHandlers) => Link;
