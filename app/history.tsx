import { ErrorBoundary } from '../src/ui/ErrorBoundary';
import { HistoryScreen } from '../src/ui/HistoryScreen';

export default function History() {
  return (
    <ErrorBoundary label="History">
      <HistoryScreen />
    </ErrorBoundary>
  );
}
