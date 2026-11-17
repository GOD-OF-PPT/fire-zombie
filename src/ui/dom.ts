/** UI markup comes only from literal templates; interpolated strings never enter the HTML parser. */
export type Content = string | number | boolean | null | undefined | Markup | readonly Content[];

const marker = '__prism_slot_';
const slots = /__prism_slot_(\d+)__/g;
const templates = new WeakMap<TemplateStringsArray, DocumentFragment>();
const tags = new Set(['div', 'span', 'button', 'i', 'b', 'em', 'small', 'h1', 'h2', 'p', 'ul', 'li', 'strong', 'form', 'label', 'input']);
const booleanAttributes = new Set(['disabled', 'hidden']);

function allowedAttribute(name: string): boolean {
  return ['class', 'id', 'title', 'role', 'style', 'disabled', 'hidden', 'type', 'for', 'maxlength', 'autocomplete', 'placeholder'].includes(name) ||
    /^(?:data|aria)-[a-z0-9-]+$/.test(name);
}

function checkStyle(value: string): void {
  for (const declaration of value.split(';').filter(s => s.trim())) {
    const [property, ...parts] = declaration.split(':');
    const name = property!.trim();
    const cssValue = parts.join(':').trim();
    const color = /^(?:color|--(?:cc|mc|pc|sc))$/.test(name) && /^#[a-f\d]{3,8}$/i.test(cssValue);
    const width = name === 'width' && /^-?\d+(?:\.\d+)?%$/.test(cssValue);
    if (!color && !width) throw new TypeError('Unsupported UI style');
  }
}

function template(strings: TemplateStringsArray): DocumentFragment {
  let cached = templates.get(strings);
  if (cached) return cached;
  if (strings.some(part => part.includes(marker))) throw new TypeError('Reserved UI template marker');
  const source = strings.reduce((text, part, index) => text + (index ? `${marker}${index - 1}__` : '') + part, '');
  // Only the application's literal markup is parsed. Values are bound below as text/attributes.
  const parsed = new DOMParser().parseFromString(source, 'text/html');
  for (const element of parsed.querySelectorAll('body *')) {
    if (!tags.has(element.localName)) throw new TypeError('Unsupported UI element');
    for (const attribute of element.attributes) {
      if (!allowedAttribute(attribute.name)) throw new TypeError('Unsupported UI attribute');
    }
  }
  // Reject anything the HTML parser moved out of the body (e.g. executable or metadata tags).
  if (parsed.head.childNodes.length) throw new TypeError('Unsupported UI metadata');
  cached = document.createDocumentFragment();
  cached.append(...Array.from(parsed.body.childNodes));
  templates.set(strings, cached);
  return cached;
}

function attributeText(value: Content): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') throw new TypeError('UI attributes require plain values');
  return String(value);
}

class Markup {
  constructor(private readonly strings: TemplateStringsArray, private readonly values: readonly Content[]) {}

  fragment(): DocumentFragment {
    const fragment = template(this.strings).cloneNode(true) as DocumentFragment;
    for (const element of fragment.querySelectorAll('*')) {
      for (const attribute of Array.from(element.attributes)) {
        if (!attribute.value.includes(marker)) {
          if (attribute.name === 'style') checkStyle(attribute.value);
          continue;
        }
        const value = attribute.value.replace(slots, (_, index: string) => attributeText(this.values[Number(index)]));
        if (attribute.name === 'style') checkStyle(value);
        if (booleanAttributes.has(attribute.name)) {
          const match = attribute.value.match(/^__prism_slot_(\d+)__$/);
          if (!match) throw new TypeError('Boolean attributes require a single value');
          element.toggleAttribute(attribute.name, Boolean(this.values[Number(match[1])]));
        } else {
          element.setAttribute(attribute.name, value);
        }
      }
    }
    const walker = document.createTreeWalker(fragment, NodeFilter.SHOW_TEXT);
    const textNodes: Text[] = [];
    while (walker.nextNode()) textNodes.push(walker.currentNode as Text);
    for (const node of textNodes) {
      if (!node.data.includes(marker)) continue;
      const replacement = document.createDocumentFragment();
      let start = 0;
      for (const match of node.data.matchAll(slots)) {
        replacement.append(document.createTextNode(node.data.slice(start, match.index)));
        appendContent(replacement, this.values[Number(match[1])]);
        start = match.index! + match[0].length;
      }
      replacement.append(document.createTextNode(node.data.slice(start)));
      node.replaceWith(replacement);
    }
    return fragment;
  }
}

function appendContent(parent: DocumentFragment, content: Content): void {
  if (content === null || content === undefined || typeof content === 'boolean') return;
  if (content instanceof Markup) parent.append(content.fragment());
  else if (Array.isArray(content)) for (const child of content) appendContent(parent, child);
  else parent.append(document.createTextNode(String(content)));
}

/** Nested markup uses html`...`; ordinary strings, including HTML-looking strings, stay text. */
export function html(strings: TemplateStringsArray, ...values: Content[]): Markup {
  if (!Object.isFrozen(strings) || !Object.isFrozen(strings.raw)) throw new TypeError('UI markup requires a literal template');
  return new Markup(strings, values);
}

export function render(parent: Element, content: Content): void {
  const fragment = document.createDocumentFragment();
  appendContent(fragment, content);
  parent.replaceChildren(fragment);
}
