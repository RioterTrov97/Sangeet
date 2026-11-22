import { router } from 'expo-router';

import { VideoFullscreen } from '../src/ui/VideoFullscreen';

export default function VideoScreen() {
  return <VideoFullscreen onClose={() => router.back()} />;
}
