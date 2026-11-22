import { ErrorBoundary } from '../src/ui/ErrorBoundary';
import { SettingsScreen } from '../src/ui/SettingsScreen';

export default function Settings() {
  return (
    <ErrorBoundary label="Settings">
      <SettingsScreen />
    </ErrorBoundary>
  );
}
