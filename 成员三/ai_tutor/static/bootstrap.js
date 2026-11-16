/* Keep dependency and application startup order explicit for the local demo. */
import * as THREE from './vendor/three/three.module.min.js';

window.THREE = THREE;
const build = '20261115.8';
await import(`./knowledge-map.js?v=${build}`);
await import(`./liquid-scene.js?v=${build}`);
await import(`./r-file.js?v=${build}`);
await import(`./model-settings.js?v=${build}`);
await import(`./app.js?v=${build}`);
