import { DownloadsScreen } from '../src/ui/DownloadsScreen';
import { ErrorBoundary } from '../src/ui/ErrorBoundary';

export default function Downloads() {
  return (
    <ErrorBoundary label="Downloads">
      <DownloadsScreen />
    </ErrorBoundary>
  );
}
