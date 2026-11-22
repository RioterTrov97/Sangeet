import { ErrorBoundary } from '../src/ui/ErrorBoundary';
import { LocalSongsScreen } from '../src/ui/LocalSongsScreen';

export default function OnDevice() {
  return (
    <ErrorBoundary label="On this iPhone">
      <LocalSongsScreen />
    </ErrorBoundary>
  );
}
