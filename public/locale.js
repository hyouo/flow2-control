import { english } from './messages.js';

let language = 'zh-CN';
const fields = [];

export const currentLanguage = () => language;
export function tr(source, ...values) {
  const template = Array.isArray(source) ? source.reduce((result, part, i) => result + (i ? '{' + (i - 1) + '}' : '') + part, '') : source;
  const phrase = language === 'en' && Object.hasOwn(english, template) ? english[template] : template;
  return values.length ? phrase.replace(/\{(\d+)\}/g, (_, i) => String(values[i])) : phrase;
}

export function prepareText(doc) {
  for (const option of doc.querySelectorAll('option:not([value])')) option.value = option.textContent.trim();
  const walker = doc.createTreeWalker(doc.documentElement, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const source = node.textContent.trim();
    if (Object.hasOwn(english, source)) fields.push({ node, source, original: node.textContent });
  }
  for (const el of doc.querySelectorAll('[title],[aria-label],[placeholder]')) {
    for (const attr of ['title', 'aria-label', 'placeholder']) {
      const source = el.getAttribute(attr);
      if (source && Object.hasOwn(english, source)) fields.push({ el, attr, source });
    }
  }
}
export function setLanguage(value) {
  language = value === 'en' ? 'en' : 'zh-CN';
  if (typeof document !== 'undefined') document.documentElement.lang = language;
  for (const { node, el, attr, source, original } of fields) {
    if (node?.isConnected) node.textContent = original.replace(source, () => tr(source));
    if (el?.isConnected) el.setAttribute(attr, tr(source));
  }
}
