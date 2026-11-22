import { ErrorBoundary } from '../src/ui/ErrorBoundary';
import { LocalSongsScreen } from '../src/ui/LocalSongsScreen';
import { ON_THIS_DEVICE } from '../src/local/wording';

export default function OnDevice() {
  return (
    <ErrorBoundary label={ON_THIS_DEVICE}>
      <LocalSongsScreen />
    </ErrorBoundary>
  );
}
