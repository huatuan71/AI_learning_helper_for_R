import {marked} from './vendor/marked/marked.js';
import DOMPurify from './vendor/dompurify/purify.js';

export function markdownFragment(text) {
  const fragment = DOMPurify.sanitize(marked.parse(text, {gfm:true}), {
    RETURN_DOM_FRAGMENT:true,
    ALLOWED_TAGS:['p','br','hr','h1','h2','h3','h4','h5','h6','ul','ol','li','blockquote',
      'pre','code','strong','em','del','a','table','thead','tbody','tr','th','td'],
    ALLOWED_ATTR:['href','title','start','class','align'],
    ALLOW_DATA_ATTR:false,
    ALLOW_ARIA_ATTR:false,
  });
  for (const link of fragment.querySelectorAll('a')) {
    let url;
    try { url = new URL(link.getAttribute('href')); } catch { url = null; }
    if (url && ['https:','http:'].includes(url.protocol) && !url.username && !url.password) {
      link.href = url.href;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
    } else link.replaceWith(document.createTextNode(link.textContent));
  }
  return fragment;
}
