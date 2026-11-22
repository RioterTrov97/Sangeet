import StreamProxy from '../../../modules/stream-proxy';
import { log } from '../../util/log';
import { extractorBridge } from './bridge';
import { EXTRACTOR_HTML } from './extractorHtml.generated';

let started = false;

/**
 * Hosts the extractor page in a headless native WKWebView (modules/stream-proxy) and attaches it to the bridge.
 * No React component involved, so it works on a CarPlay-only launch. Idempotent.
 */
export function startExtractorHost(): void {
  if (started) return;
  started = true;
  extractorBridge.attach({ post: (message) => StreamProxy.extractorEval(`window.__rnRequest(${JSON.stringify(message)});true;`) });
  StreamProxy.addListener('onExtractorMessage', ({ data }) => extractorBridge.handleMessage(data));
  StreamProxy.addListener('onExtractorReset', ({ reason }) => {
    log('extractor', reason);
    extractorBridge.reset(reason);
  });
  StreamProxy.extractorLoad(EXTRACTOR_HTML, 'https://www.youtube.com');
  log('extractor', 'native WKWebView host started');
}
