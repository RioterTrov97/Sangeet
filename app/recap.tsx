import { ErrorBoundary } from '../src/ui/ErrorBoundary';
import { RecapScreen } from '../src/ui/RecapScreen';

export default function Recap() {
  return (
    <ErrorBoundary label="Recap">
      <RecapScreen />
    </ErrorBoundary>
  );
}
