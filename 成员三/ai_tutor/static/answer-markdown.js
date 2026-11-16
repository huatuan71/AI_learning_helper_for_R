import {marked} from './vendor/marked/marked.js';
import DOMPurify from './vendor/dompurify/purify.js';

const LOCAL_CONTENT = /^\/content\/(code|images)\/K\d{2}_[A-Za-z0-9_]+\.(R|txt|svg)$/;

// localContent=true is only for course supplements shipped with the app: it keeps links to
// /content/ files and diagrams from /content/images/. AI answers keep the stricter default.
export function markdownFragment(text, {localContent = false} = {}) {
  const fragment = DOMPurify.sanitize(marked.parse(text, {gfm:true}), {
    RETURN_DOM_FRAGMENT:true,
    ALLOWED_TAGS:['p','br','hr','h1','h2','h3','h4','h5','h6','ul','ol','li','blockquote',
      'pre','code','strong','em','del','a','table','thead','tbody','tr','th','td', ...(localContent ? ['img'] : [])],
    ALLOWED_ATTR:['href','title','start','class','align', ...(localContent ? ['src','alt'] : [])],
    ALLOW_DATA_ATTR:false,
    ALLOW_ARIA_ATTR:false,
  });
  for (const image of fragment.querySelectorAll('img')) {
    const src = image.getAttribute('src') || '';
    if (localContent && LOCAL_CONTENT.test(src) && src.endsWith('.svg')) {
      image.loading = 'lazy'; image.decoding = 'async'; image.className = 'course-figure';
    } else image.replaceWith(document.createTextNode(image.getAttribute('alt') || ''));
  }
  for (const link of fragment.querySelectorAll('a')) {
    const href = link.getAttribute('href') || '';
    if (localContent && LOCAL_CONTENT.test(href)) {
      link.href = href; link.target = '_blank'; link.rel = 'noopener'; link.className = 'course-file';
      continue;
    }
    let url;
    try { url = new URL(href); } catch { url = null; }
    if (url && ['https:','http:'].includes(url.protocol) && !url.username && !url.password) {
      link.href = url.href;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
    } else link.replaceWith(document.createTextNode(link.textContent));
  }
  return fragment;
}
