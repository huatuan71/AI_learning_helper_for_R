/* Register offline support before loading the explicit application module graph. */
import {registerOffline} from './offline.js?v=learning-v1';

void registerOffline();
await import('./app.js?v=notice-timer-v1');
