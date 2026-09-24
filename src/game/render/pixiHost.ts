import { Application } from 'pixi.js';

let appPromise: Promise<Application> | null = null;
let owner: symbol | null = null;

/**
 * One Pixi Application (one WebGL context) for the whole page lifetime.
 *
 * Matches come and go, but the renderer, its canvas and the GPU copies of the
 * shared atlases stay. Creating a context per match would leak contexts on
 * repeated navigation (browsers cap them) and re-upload every texture.
 * A match "acquires" the app, which moves the canvas into its host element,
 * and "releases" it on teardown, which stops the ticker and detaches the canvas.
 */
function getApp(): Promise<Application> {
  appPromise ??= (async () => {
    const app = new Application();
    await app.init({
      antialias: true,
      autoDensity: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      backgroundColor: 0x0b1a2a,
      preference: 'webgl',
      autoStart: false,
      sharedTicker: false,
      width: 16,
      height: 16,
    });
    app.canvas.setAttribute('aria-hidden', 'true');
    app.canvas.dataset.testid = 'game-canvas';
    app.canvas.style.display = 'block';
    return app;
  })().catch((error: unknown) => {
    appPromise = null;
    throw error;
  });
  return appPromise;
}

export interface PixiLease {
  app: Application;
  release(): void;
}

export async function acquirePixi(host: HTMLElement): Promise<PixiLease> {
  const app = await getApp();
  const token = Symbol('pixi-lease');
  owner = token;
  host.appendChild(app.canvas);

  const resize = () => {
    const w = Math.max(1, host.clientWidth);
    const h = Math.max(1, host.clientHeight);
    const resolution = Math.min(window.devicePixelRatio || 1, 2);
    if (app.renderer.resolution !== resolution) app.renderer.resolution = resolution;
    app.renderer.resize(w, h);
  };
  const observer = new ResizeObserver(resize);
  observer.observe(host);
  window.addEventListener('resize', resize);
  resize();

  let released = false;
  return {
    app,
    release() {
      if (released) return;
      released = true;
      observer.disconnect();
      window.removeEventListener('resize', resize);
      // A newer lease (e.g. Strict Mode remount) may already own the canvas.
      if (owner === token) {
        owner = null;
        app.stop();
        app.stage.removeChildren();
        app.canvas.remove();
      }
    },
  };
}
