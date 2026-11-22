/**
 * One run at a time. A request that arrives during a run is not dropped and does not start a second one: all such requests are coalesced
 * into a single follow-up run that starts when the current one ends. `request()` resolves when the run that covers it has finished.
 */
export function serialRunner(run: () => Promise<void>): { request: () => Promise<void>; running: () => boolean } {
  let current: Promise<void> | undefined;
  let followUp: Promise<void> | undefined;

  const start = (): Promise<void> => {
    const p = run()
      .catch(() => {})
      .finally(() => {
        current = undefined;
      });
    current = p;
    return p;
  };

  return {
    running: () => current !== undefined,
    request: () => {
      if (!current) return start();
      followUp ??= current.then(() => {
        followUp = undefined;
        return start();
      });
      return followUp;
    },
  };
}
