import { ErrorBoundary } from '../src/ui/ErrorBoundary';
import { DiagnosticsScreen } from '../src/ui/DiagnosticsScreen';

export default function Diagnostics() {
  return (
    <ErrorBoundary label="Diagnostics">
      <DiagnosticsScreen />
    </ErrorBoundary>
  );
}
