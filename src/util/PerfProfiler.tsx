import { Profiler, type ReactNode } from 'react';

import { log } from './log';

/** Dev-only: logs `[perf] <id> <phase> <ms>` to the app log for each commit of the subtree (React's Profiler is a no-op in release). */
export function PerfProfiler({ id, children }: { id: string; children: ReactNode }) {
  if (!__DEV__) return <>{children}</>;
  return (
    <Profiler id={id} onRender={(_id, phase, actual) => log('perf', `${id} ${phase} ${actual.toFixed(1)}ms`)}>
      {children}
    </Profiler>
  );
}
