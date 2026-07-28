/* Legal / Privacy static pages: tokens + doc styles + the cookie consent layer.
   No scroll hijack, no WebGL. */
import './styles/base.css';
import './styles/static.css';
import { initCookieBanner, bindCookieSettings } from './cookie';

bindCookieSettings();
initCookieBanner();
