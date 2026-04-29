/**
 * brevity.js core — discovers <script type="text/brevity"> tags,
 * compiles them via the standard extract/compile pipeline,
 * and returns descriptors carrying the source ref needed to derive
 * each actor's CAM address.
 *
 * boot()  — returns Array<{ id, src, ActorClass }> in document order
 * start() — compiles, instantiates, and wires up live actors
 */

const documentDI = '< "document": (document) >\n=\n';

export async function boot(document, { extract, compile, compileOptions = {}, implicitDI = false, fetch = globalThis.fetch }) {
  const scripts = document.querySelectorAll('script[type="text/brevity"]');
  const actors = [];

  for (const script of scripts) {
    let source;
    const src = script.getAttribute('src');
    const isExternal = Boolean(src);
    if (isExternal) {
      if (!fetch) throw new Error(`brevity.js: <script src="${src}"> requires fetch, but none is available`);
      const url = new URL(src, document.baseURI || 'http://localhost/');
      const res = await fetch(url.href);
      if (!res.ok) throw new Error(`brevity.js: failed to load ${url.href}: ${res.status}`);
      source = await res.text();
    } else {
      source = script.textContent;
    }
    if (!source || !source.trim()) continue;

    // Inline scripts in <head> get document DI auto-prepended, unless the
    // script already has its own < > constructor header (in which case it
    // must declare <:document> explicitly if it needs it).
    if (implicitDI && !isExternal && script.closest('head') && !source.trim().startsWith('<')) {
      source = documentDI + source;
    }

    const { ast } = extract(source);
    const output = compile(ast, { ...compileOptions, target: 'browser' });

    const dataUrl = `data:text/javascript;charset=utf-8,${encodeURIComponent(output)}`;
    const mod = await import(dataUrl);
    const ActorClass = mod.default;

    const id = script.id || script.getAttribute('id');
    actors.push({ id: id || null, src: src || null, ActorClass });
  }

  return actors;
}

// `document` is the page's singleton actor. The lowercase singleton type
// must be self-contained: callers can import just `<:document>` without
// also pulling in HTML, so the document service can't inherit Node's body
// from domManifest — the validator only registers types from services
// declared as dependencies in the source. Methods here mirror Document's
// full surface (declared in domManifest as `<Node | ...> -> { ... }`) so
// the runtime answers identically whichever entry point a caller uses.
export const documentManifest = `{
  document: <> -> {
    title: () -> (Text)
    first: (:selector Text) -> (Element)
    body: () -> (Element)
    node_name: () -> (Text)
    node_type: () -> (Integer)
    node_value: () -> (Text | null)
    parent_node: () -> (Node | null)
    parent_element: () -> (Element | null)
    child_nodes: () -> (List of Nodes)
    first_child: () -> (Node | null)
    last_child: () -> (Node | null)
    next_sibling: () -> (Node | null)
    previous_sibling: () -> (Node | null)
    owner_document: () -> (Node | null)
    is_connected: () -> (Boolean)
    get_root_node: () -> (Node)
    contains: (Node) -> (Boolean) | (:other Node) -> (Boolean)
    compare_document_position: (Node) -> (Integer) | (:other Node) -> (Integer)
    clone_node: () -> (Node) | (Boolean) -> (Node) | (:deep Boolean) -> (Node)
    is_equal_node: (Node) -> (Boolean) | (:other Node) -> (Boolean)
    is_same_node: (Node) -> (Boolean) | (:other Node) -> (Boolean)
    normalize!: () -> (self)
    query_selector: (Text) -> (Element | null) | (:selector Text) -> (Element | null)
    query_selector_all: (Text) -> (List of Elements) | (:selector Text) -> (List of Elements)
    get_elements_by_tag_name: (Text) -> (List of Elements) | (:name Text) -> (List of Elements)
    get_elements_by_class_name: (Text) -> (List of Elements) | (:names Text) -> (List of Elements)
  }
}`;

// HTML service manifest.
//
// Element is an abstract parent enumerating every non-event-handler
// attribute that applies to every HTML tag, plus content fields
// (`inner_html`, `children`) so a single typed constructor covers
// construction end-to-end. Per-attribute typing (Boolean / Integer /
// Decimal / Text) lets the validator catch wrong types at compile time.
//
// Aria buckets ARIA state/properties as one cohesive sub-type so
// Element's surface stays manageable. The `:role` field lives on Aria
// (not Element) because it's part of the accessibility surface;
// serialisation maps it to the bare `role=` attribute, not `aria-role=`.
//
// Concrete tags use lowercase names matching the HTML tag exactly
// (`div`, `p`, etc.). They subclass Element with empty own params for
// tags that add no tag-specific attributes; tags that carry their own
// surface (like <a> with href, <input> with type/value/...) declare
// them after the `Element |` divider.
//
// `:children` is a list of wire tokens — text runs as bare strings,
// element references as `#<HTML @tag/N>`, closure subscriptions as
// `#<actor @N>` — and the runtime parses each entry to decide what to
// attach.
//
// `inner_html` is a method, not a constructor attribute — read the
// element's current innerHTML after construction. Setting initial
// content happens via `:children`.
//
// Every attribute slot is marked optional with the `? ` prefix: the
// caller may omit any/all of them, and the runtime supplies a default
// (null for absent attributes). Optionality is an interface concern;
// the implementation owns the default.
//
// A handful of attributes are typed as unions (`Boolean | Text`,
// `Text | List of Texts`, `Integer | Decimal | Text`, ...) where the
// HTML spec genuinely admits multiple value shapes — `hidden` is a
// boolean attribute that also accepts the literal string
// "until-found"; `class` is one space-separated string OR a list of
// class names; `<input :value>` straddles text/number/decimal. The
// validator's union support (parser → splitUnionMembers → isAssignable)
// resolves any concrete arg type against any member.
export const domManifest = `{
  Node: <> -> {
    node_name: () -> (Text)
    node_type: () -> (Integer)
    node_value: () -> (Text | null)
    parent_node: () -> (Node | null)
    parent_element: () -> (Element | null)
    child_nodes: () -> (List of Nodes)
    first_child: () -> (Node | null)
    last_child: () -> (Node | null)
    next_sibling: () -> (Node | null)
    previous_sibling: () -> (Node | null)
    owner_document: () -> (Node | null)
    is_connected: () -> (Boolean)
    get_root_node: () -> (Node)
    contains: (Node) -> (Boolean) | (:other Node) -> (Boolean)
    compare_document_position: (Node) -> (Integer) | (:other Node) -> (Integer)
    clone_node: () -> (Node) | (Boolean) -> (Node) | (:deep Boolean) -> (Node)
    is_equal_node: (Node) -> (Boolean) | (:other Node) -> (Boolean)
    is_same_node: (Node) -> (Boolean) | (:other Node) -> (Boolean)
    normalize!: () -> (self)
  }

  Text: <Node |>

  Comment: <Node |>

  Document: <Node |> -> {
    title: () -> (Text)
    first: (:selector Text) -> (Element)
    body: () -> (Element)
    query_selector: (Text) -> (Element | null) | (:selector Text) -> (Element | null)
    query_selector_all: (Text) -> (List of Elements) | (:selector Text) -> (List of Elements)
    get_elements_by_tag_name: (Text) -> (List of Elements) | (:name Text) -> (List of Elements)
    get_elements_by_class_name: (Text) -> (List of Elements) | (:names Text) -> (List of Elements)
  }

  Element: <
    Node |
    ? :id Text,
    ? :class Text | List of Texts,
    ? :style Text,
    ? :title Text,
    ? :lang Text,
    ? :dir Text,
    ? :translate Text,
    ? :hidden Boolean | Text,
    ? :tabindex Integer,
    ? :accesskey Text,
    ? :draggable Boolean,
    ? :contenteditable Boolean | Text,
    ? :spellcheck Boolean,
    ? :inert Boolean,
    ? :autofocus Boolean,
    ? :autocapitalize Text,
    ? :autocorrect Text,
    ? :inputmode Text,
    ? :enterkeyhint Text,
    ? :is Text,
    ? :nonce Text,
    ? :popover Boolean | Text,
    ? :slot Text,
    ? :part Text,
    ? :exportparts Text,
    ? :itemid Text,
    ? :itemprop Text,
    ? :itemref Text,
    ? :itemscope Boolean,
    ? :itemtype Text,
    ? :writingsuggestions Text,
    ? :virtualkeyboardpolicy Text,
    ? :data Structure,
    ? :aria Aria
  > -> {
    id: () -> (Text | null)
    class: () -> (Text | null)
    style: () -> (Text | null)
    title: () -> (Text | null)
    lang: () -> (Text | null)
    dir: () -> (Text | null)
    translate: () -> (Text | null)
    hidden: () -> (Boolean | null)
    tabindex: () -> (Integer | null)
    accesskey: () -> (Text | null)
    draggable: () -> (Boolean | null)
    contenteditable: () -> (Text | null)
    spellcheck: () -> (Boolean | null)
    inert: () -> (Boolean | null)
    autofocus: () -> (Boolean | null)
    autocapitalize: () -> (Text | null)
    autocorrect: () -> (Text | null)
    inputmode: () -> (Text | null)
    enterkeyhint: () -> (Text | null)
    is: () -> (Text | null)
    nonce: () -> (Text | null)
    popover: () -> (Text | null)
    slot: () -> (Text | null)
    part: () -> (Text | null)
    exportparts: () -> (Text | null)
    itemid: () -> (Text | null)
    itemprop: () -> (Text | null)
    itemref: () -> (Text | null)
    itemscope: () -> (Boolean | null)
    itemtype: () -> (Text | null)
    writingsuggestions: () -> (Text | null)
    virtualkeyboardpolicy: () -> (Text | null)
    aria: () -> (Aria | null)
    class_list: () -> (ClassList)
    dataset: () -> (Dataset)
    outer_html: () -> (Text)
    outer_text: () -> (Text)
    tag_name: () -> (Text)
    local_name: () -> (Text)
    namespace_uri: () -> (Text | null)
    prefix: () -> (Text | null)
    children: () -> (List of Elements)
    first_element_child: () -> (Element | null)
    last_element_child: () -> (Element | null)
    next_element_sibling: () -> (Element | null)
    previous_element_sibling: () -> (Element | null)
    child_element_count: () -> (Integer)
    has_attributes: () -> (Boolean)
    get_attribute_names: () -> (List of Texts)
    get_attribute: (Text) -> (Text | null) | (:name Text) -> (Text | null)
    has_attribute: (Text) -> (Boolean) | (:name Text) -> (Boolean)
    set_attribute!: (Text, Text) -> (self) | (:name Text, :value Text) -> (self)
    remove_attribute!: (Text) -> (self) | (:name Text) -> (self)
    toggle_attribute!: (Text) -> (self) | (Text, Boolean) -> (self) | (:name Text, ? :force Boolean) -> (self)
    query_selector: (Text) -> (Element | null) | (:selector Text) -> (Element | null)
    query_selector_all: (Text) -> (List of Elements) | (:selector Text) -> (List of Elements)
    closest: (Text) -> (Element | null) | (:selector Text) -> (Element | null)
    matches: (Text) -> (Boolean) | (:selector Text) -> (Boolean)
    get_elements_by_tag_name: (Text) -> (List of Elements) | (:name Text) -> (List of Elements)
    get_elements_by_class_name: (Text) -> (List of Elements) | (:names Text) -> (List of Elements)
    client_width: () -> (Integer)
    client_height: () -> (Integer)
    client_top: () -> (Integer)
    client_left: () -> (Integer)
    offset_width: () -> (Integer)
    offset_height: () -> (Integer)
    offset_top: () -> (Integer)
    offset_left: () -> (Integer)
    offset_parent: () -> (Element | null)
    scroll_width: () -> (Integer)
    scroll_height: () -> (Integer)
    scroll_top: () -> (Decimal)
    scroll_left: () -> (Decimal)
    set scroll_top: (Decimal)
    set scroll_left: (Decimal)
    bounding_client_rect: () -> (Structure)
    client_rects: () -> (List of Structures)
    focus!: () -> (self) | (? :prevent_scroll Boolean) -> (self)
    blur!: () -> (self)
    click!: () -> (self)
    scroll!: (Decimal, Decimal) -> (self) | (? :left Decimal, ? :top Decimal, ? :behavior Text) -> (self)
    scroll_to!: (Decimal, Decimal) -> (self) | (? :left Decimal, ? :top Decimal, ? :behavior Text) -> (self)
    scroll_by!: (Decimal, Decimal) -> (self) | (? :left Decimal, ? :top Decimal, ? :behavior Text) -> (self)
    scroll_into_view!: () -> (self) | (Boolean) -> (self) | (? :behavior Text, ? :block Text, ? :inline Text) -> (self)
    before!: (List) -> (self) | (:items List) -> (self)
    after!: (List) -> (self) | (:items List) -> (self)
    replace_with!: (List) -> (self) | (:items List) -> (self)
    remove!: () -> (self)
    insert_adjacent_element!: (:position Text, :element Element) -> (self)
    insert_adjacent_text!: (:position Text, :text Text) -> (self)
    insert_adjacent_html!: (:position Text, :html Text) -> (self)
  }

  Aria: <
    ? :role Text,
    ? :label Text,
    ? :labelledby Text,
    ? :describedby Text,
    ? :description Text,
    ? :details Text,
    ? :hidden Boolean,
    ? :disabled Boolean,
    ? :readonly Boolean,
    ? :required Boolean,
    ? :invalid Text,
    ? :errormessage Text,
    ? :checked Text,
    ? :pressed Text,
    ? :selected Boolean,
    ? :expanded Boolean,
    ? :busy Boolean,
    ? :live Text,
    ? :atomic Boolean,
    ? :relevant Text,
    ? :current Text,
    ? :haspopup Text,
    ? :level Integer,
    ? :modal Boolean,
    ? :multiline Boolean,
    ? :multiselectable Boolean,
    ? :orientation Text,
    ? :placeholder Text,
    ? :sort Text,
    ? :valuemax Decimal,
    ? :valuemin Decimal,
    ? :valuenow Decimal,
    ? :valuetext Text,
    ? :autocomplete Text,
    ? :keyshortcuts Text,
    ? :roledescription Text,
    ? :activedescendant Text,
    ? :controls Text,
    ? :flowto Text,
    ? :owns Text,
    ? :colcount Integer,
    ? :colindex Integer,
    ? :colspan Integer,
    ? :rowcount Integer,
    ? :rowindex Integer,
    ? :rowspan Integer,
    ? :posinset Integer,
    ? :setsize Integer
  > -> {
    role: () -> (Text | null)
    label: () -> (Text | null)
    labelledby: () -> (Text | null)
    describedby: () -> (Text | null)
    description: () -> (Text | null)
    details: () -> (Text | null)
    hidden: () -> (Boolean | null)
    disabled: () -> (Boolean | null)
    readonly: () -> (Boolean | null)
    required: () -> (Boolean | null)
    invalid: () -> (Text | null)
    errormessage: () -> (Text | null)
    checked: () -> (Text | null)
    pressed: () -> (Text | null)
    selected: () -> (Boolean | null)
    expanded: () -> (Boolean | null)
    busy: () -> (Boolean | null)
    live: () -> (Text | null)
    atomic: () -> (Boolean | null)
    relevant: () -> (Text | null)
    current: () -> (Text | null)
    haspopup: () -> (Text | null)
    level: () -> (Integer | null)
    modal: () -> (Boolean | null)
    multiline: () -> (Boolean | null)
    multiselectable: () -> (Boolean | null)
    orientation: () -> (Text | null)
    placeholder: () -> (Text | null)
    sort: () -> (Text | null)
    valuemax: () -> (Decimal | null)
    valuemin: () -> (Decimal | null)
    valuenow: () -> (Decimal | null)
    valuetext: () -> (Text | null)
    autocomplete: () -> (Text | null)
    keyshortcuts: () -> (Text | null)
    roledescription: () -> (Text | null)
    activedescendant: () -> (Text | null)
    controls: () -> (Text | null)
    flowto: () -> (Text | null)
    owns: () -> (Text | null)
    colcount: () -> (Integer | null)
    colindex: () -> (Integer | null)
    colspan: () -> (Integer | null)
    rowcount: () -> (Integer | null)
    rowindex: () -> (Integer | null)
    rowspan: () -> (Integer | null)
    posinset: () -> (Integer | null)
    setsize: () -> (Integer | null)
  }

  ClassList: <> -> {
    length: () -> (Integer)
    value: () -> (Text)
    set value: (Text)
    item: (Integer) -> (Text | null) | (:index Integer) -> (Text | null)
    contains: (Text) -> (Boolean) | (:token Text) -> (Boolean)
    add!: (Text) -> (self) | (List of Texts) -> (self) | (:tokens List of Texts) -> (self)
    remove!: (Text) -> (self) | (List of Texts) -> (self) | (:tokens List of Texts) -> (self)
    toggle!: (Text) -> (Boolean) | (Text, Boolean) -> (Boolean) | (:token Text, ? :force Boolean) -> (Boolean)
    replace!: (Text, Text) -> (Boolean) | (:old_token Text, :new_token Text) -> (Boolean)
  }

  Dataset: <> -> {
    size: () -> (Integer)
    has: (Text) -> (Boolean) | (:key Text) -> (Boolean)
    get: (Text) -> (Text | null) | (:key Text) -> (Text | null)
    put!: (Text, Text) -> (self) | (:key Text, :value Text) -> (self)
    remove!: (Text) -> (self) | (:key Text) -> (self)
    keys: () -> (List of Texts)
    values: () -> (List of Texts)
    entries: () -> (List of Structures)
  }

  TextElement: <Element | ? :children List of Texts> -> {
    inner_html: () -> (Text)
    text_content: () -> (Text)
    inner_text: () -> (Text)
    set inner_html: (Text)
    set text_content: (Text)
    set inner_text: (Text)
    append!: (List of Texts) -> (self) | (:items List of Texts) -> (self)
    prepend!: (List of Texts) -> (self) | (:items List of Texts) -> (self)
    replace_children!: (List of Texts) -> (self) | (:items List of Texts) -> (self)
    insert_adjacent_text!: (:position Text, :text Text) -> (self)
    insert_adjacent_html!: (:position Text, :html Text) -> (self)
  }

  ParentElement: <Element | ? :children List> -> {
    inner_html: () -> (Text)
    text_content: () -> (Text)
    inner_text: () -> (Text)
    set inner_html: (Text)
    set text_content: (Text)
    set inner_text: (Text)
    append_child!: (Element) -> (self) | (:child Element) -> (self)
    insert_before!: (Element, ? Element) -> (self) | (:new_child Element, ? :ref_child Element) -> (self)
    remove_child!: (Element) -> (self) | (:child Element) -> (self)
    replace_child!: (Element, Element) -> (self) | (:new_child Element, :old_child Element) -> (self)
    append!: (List) -> (self) | (:items List) -> (self)
    prepend!: (List) -> (self) | (:items List) -> (self)
    replace_children!: (List) -> (self) | (:items List) -> (self)
    insert_adjacent_element!: (:position Text, :element Element) -> (self)
    insert_adjacent_text!: (:position Text, :text Text) -> (self)
    insert_adjacent_html!: (:position Text, :html Text) -> (self)
  }

  html: <ParentElement |>
  head: <ParentElement |>
  body: <ParentElement |>
  header: <ParentElement |>
  footer: <ParentElement |>
  main: <ParentElement |>
  nav: <ParentElement |>
  section: <ParentElement |>
  article: <ParentElement |>
  aside: <ParentElement |>
  h1: <ParentElement |>
  h2: <ParentElement |>
  h3: <ParentElement |>
  h4: <ParentElement |>
  h5: <ParentElement |>
  h6: <ParentElement |>
  div: <ParentElement |>
  p: <ParentElement |>
  span: <ParentElement |>
  pre: <ParentElement |>
  hr: <Element |>
  br: <Element |>
  blockquote: <ParentElement | ? :cite Text> -> {
    cite: () -> (Text | null)
  }
  a: <ParentElement | ? :href Text, ? :target Text, ? :rel Text, ? :download Boolean | Text, ? :type Text, ? :hreflang Text, ? :ping Text, ? :referrerpolicy Text> -> {
    href: () -> (Text | null)
    target: () -> (Text | null)
    rel: () -> (Text | null)
    download: () -> (Text | null)
    type: () -> (Text | null)
    hreflang: () -> (Text | null)
    ping: () -> (Text | null)
    referrerpolicy: () -> (Text | null)
  }
  em: <ParentElement |>
  strong: <ParentElement |>
  code: <ParentElement |>
  mark: <ParentElement |>
  small: <ParentElement |>
  ul: <ParentElement |>
  ol: <ParentElement | ? :type Text, ? :start Integer, ? :reversed Boolean> -> {
    type: () -> (Text | null)
    start: () -> (Integer | null)
    reversed: () -> (Boolean | null)
  }
  li: <ParentElement | ? :value Integer> -> {
    value: () -> (Integer | null)
  }
  dl: <ParentElement |>
  dt: <ParentElement |>
  dd: <ParentElement |>
  table: <ParentElement |>
  thead: <ParentElement |>
  tbody: <ParentElement |>
  tr: <ParentElement |>
  td: <ParentElement | ? :colspan Integer, ? :rowspan Integer, ? :headers Text> -> {
    colspan: () -> (Integer | null)
    rowspan: () -> (Integer | null)
    headers: () -> (Text | null)
  }
  th: <ParentElement | ? :colspan Integer, ? :rowspan Integer, ? :headers Text, ? :scope Text, ? :abbr Text> -> {
    colspan: () -> (Integer | null)
    rowspan: () -> (Integer | null)
    headers: () -> (Text | null)
    scope: () -> (Text | null)
    abbr: () -> (Text | null)
  }
  caption: <ParentElement |>
  form: <ParentElement | ? :action Text, ? :method Text, ? :target Text, ? :enctype Text, ? :autocomplete Text, ? :novalidate Boolean, ? :name Text> -> {
    action: () -> (Text | null)
    method: () -> (Text | null)
    target: () -> (Text | null)
    enctype: () -> (Text | null)
    autocomplete: () -> (Text | null)
    novalidate: () -> (Boolean | null)
    name: () -> (Text | null)
  }
  input: <Element |
    ? :type Text,
    ? :name Text,
    ? :value Text | Integer | Decimal,
    ? :placeholder Text,
    ? :required Boolean,
    ? :disabled Boolean,
    ? :readonly Boolean,
    ? :min Integer | Decimal | Text,
    ? :max Integer | Decimal | Text,
    ? :step Integer | Decimal | Text,
    ? :minlength Integer,
    ? :maxlength Integer,
    ? :pattern Text,
    ? :accept Text,
    ? :multiple Boolean,
    ? :checked Boolean,
    ? :autocomplete Text,
    ? :list Text,
    ? :src Text,
    ? :alt Text,
    ? :form Text,
    ? :height Integer | Text,
    ? :width Integer | Text,
    ? :size Integer
  > -> {
    type: () -> (Text | null)
    name: () -> (Text | null)
    value: () -> (Text | null)
    placeholder: () -> (Text | null)
    required: () -> (Boolean | null)
    disabled: () -> (Boolean | null)
    readonly: () -> (Boolean | null)
    min: () -> (Text | null)
    max: () -> (Text | null)
    step: () -> (Text | null)
    minlength: () -> (Integer | null)
    maxlength: () -> (Integer | null)
    pattern: () -> (Text | null)
    accept: () -> (Text | null)
    multiple: () -> (Boolean | null)
    checked: () -> (Boolean | null)
    autocomplete: () -> (Text | null)
    list: () -> (Text | null)
    src: () -> (Text | null)
    alt: () -> (Text | null)
    form: () -> (Text | null)
    height: () -> (Text | null)
    width: () -> (Text | null)
    size: () -> (Integer | null)
  }
  button: <ParentElement | ? :type Text, ? :name Text, ? :value Text | Integer, ? :disabled Boolean, ? :form Text, ? :formaction Text, ? :formmethod Text, ? :formnovalidate Boolean, ? :formtarget Text> -> {
    type: () -> (Text | null)
    name: () -> (Text | null)
    value: () -> (Text | null)
    disabled: () -> (Boolean | null)
    form: () -> (Text | null)
    formaction: () -> (Text | null)
    formmethod: () -> (Text | null)
    formnovalidate: () -> (Boolean | null)
    formtarget: () -> (Text | null)
  }
  select: <ParentElement | ? :name Text, ? :multiple Boolean, ? :required Boolean, ? :disabled Boolean, ? :size Integer, ? :autocomplete Text, ? :form Text> -> {
    name: () -> (Text | null)
    multiple: () -> (Boolean | null)
    required: () -> (Boolean | null)
    disabled: () -> (Boolean | null)
    size: () -> (Integer | null)
    autocomplete: () -> (Text | null)
    form: () -> (Text | null)
  }
  option: <ParentElement | ? :value Text | Integer | Decimal, ? :selected Boolean, ? :disabled Boolean, ? :label Text> -> {
    value: () -> (Text | null)
    selected: () -> (Boolean | null)
    disabled: () -> (Boolean | null)
    label: () -> (Text | null)
  }
  textarea: <TextElement | ? :name Text, ? :rows Integer, ? :cols Integer, ? :placeholder Text, ? :required Boolean, ? :disabled Boolean, ? :readonly Boolean, ? :minlength Integer, ? :maxlength Integer, ? :wrap Text, ? :autocomplete Text, ? :form Text> -> {
    name: () -> (Text | null)
    rows: () -> (Integer | null)
    cols: () -> (Integer | null)
    placeholder: () -> (Text | null)
    required: () -> (Boolean | null)
    disabled: () -> (Boolean | null)
    readonly: () -> (Boolean | null)
    minlength: () -> (Integer | null)
    maxlength: () -> (Integer | null)
    wrap: () -> (Text | null)
    autocomplete: () -> (Text | null)
    form: () -> (Text | null)
  }
  label: <ParentElement | ? :for Text, ? :form Text> -> {
    for: () -> (Text | null)
    form: () -> (Text | null)
  }
  img: <Element | ? :src Text, ? :srcset Text, ? :alt Text, ? :width Integer | Text, ? :height Integer | Text, ? :sizes Text, ? :loading Text, ? :decoding Text, ? :fetchpriority Text, ? :crossorigin Text, ? :referrerpolicy Text, ? :usemap Text, ? :ismap Boolean> -> {
    src: () -> (Text | null)
    srcset: () -> (Text | null)
    alt: () -> (Text | null)
    width: () -> (Text | null)
    height: () -> (Text | null)
    sizes: () -> (Text | null)
    loading: () -> (Text | null)
    decoding: () -> (Text | null)
    fetchpriority: () -> (Text | null)
    crossorigin: () -> (Text | null)
    referrerpolicy: () -> (Text | null)
    usemap: () -> (Text | null)
    ismap: () -> (Boolean | null)
  }
  canvas: <ParentElement | ? :width Integer | Text, ? :height Integer | Text> -> {
    width: () -> (Text | null)
    height: () -> (Text | null)
  }
  iframe: <ParentElement | ? :src Text, ? :srcdoc Text, ? :name Text, ? :sandbox Text, ? :allow Text, ? :allowfullscreen Boolean, ? :loading Text, ? :referrerpolicy Text, ? :width Integer | Text, ? :height Integer | Text> -> {
    src: () -> (Text | null)
    srcdoc: () -> (Text | null)
    name: () -> (Text | null)
    sandbox: () -> (Text | null)
    allow: () -> (Text | null)
    allowfullscreen: () -> (Boolean | null)
    loading: () -> (Text | null)
    referrerpolicy: () -> (Text | null)
    width: () -> (Text | null)
    height: () -> (Text | null)
  }
  figure: <ParentElement |>
  figcaption: <ParentElement |>
  details: <ParentElement | ? :open Boolean, ? :name Text> -> {
    open: () -> (Boolean | null)
    name: () -> (Text | null)
  }
  summary: <ParentElement |>
  dialog: <ParentElement | ? :open Boolean> -> {
    open: () -> (Boolean | null)
  }
}`;

// Accessor type maps — mirror of the manifest's body declarations. Each
// accessor name maps to its declared return-type family, used by the
// runtime reader to decide between getAttribute (text), bare presence
// (boolean), or parseInt → BigInt (integer). Must stay in sync with the
// manifest above; the manifest is the source of truth for callers, this
// is the source of truth for the runtime read.
const ELEMENT_ACCESSORS = {
  id: 'text', class: 'text', style: 'text', title: 'text', lang: 'text',
  dir: 'text', translate: 'text',
  hidden: 'boolean', tabindex: 'integer', accesskey: 'text',
  draggable: 'boolean', contenteditable: 'text',
  spellcheck: 'boolean', inert: 'boolean', autofocus: 'boolean',
  autocapitalize: 'text', autocorrect: 'text', inputmode: 'text',
  enterkeyhint: 'text', is: 'text', nonce: 'text', popover: 'text',
  slot: 'text', part: 'text', exportparts: 'text',
  itemid: 'text', itemprop: 'text', itemref: 'text',
  itemscope: 'boolean', itemtype: 'text',
  writingsuggestions: 'text', virtualkeyboardpolicy: 'text',
  aria: 'aria',
  class_list: 'classlist',
  dataset: 'dataset',
};

const TAG_ACCESSORS = {
  blockquote: { cite: 'text' },
  a: { href: 'text', target: 'text', rel: 'text', download: 'text', type: 'text', hreflang: 'text', ping: 'text', referrerpolicy: 'text' },
  ol: { type: 'text', start: 'integer', reversed: 'boolean' },
  li: { value: 'integer' },
  td: { colspan: 'integer', rowspan: 'integer', headers: 'text' },
  th: { colspan: 'integer', rowspan: 'integer', headers: 'text', scope: 'text', abbr: 'text' },
  form: { action: 'text', method: 'text', target: 'text', enctype: 'text', autocomplete: 'text', novalidate: 'boolean', name: 'text' },
  input: {
    type: 'text', name: 'text', value: 'text', placeholder: 'text',
    required: 'boolean', disabled: 'boolean', readonly: 'boolean',
    min: 'text', max: 'text', step: 'text',
    minlength: 'integer', maxlength: 'integer', pattern: 'text', accept: 'text',
    multiple: 'boolean', checked: 'boolean', autocomplete: 'text',
    list: 'text', src: 'text', alt: 'text', form: 'text',
    height: 'text', width: 'text', size: 'integer',
  },
  button: { type: 'text', name: 'text', value: 'text', disabled: 'boolean', form: 'text', formaction: 'text', formmethod: 'text', formnovalidate: 'boolean', formtarget: 'text' },
  select: { name: 'text', multiple: 'boolean', required: 'boolean', disabled: 'boolean', size: 'integer', autocomplete: 'text', form: 'text' },
  option: { value: 'text', selected: 'boolean', disabled: 'boolean', label: 'text' },
  textarea: { name: 'text', rows: 'integer', cols: 'integer', placeholder: 'text', required: 'boolean', disabled: 'boolean', readonly: 'boolean', minlength: 'integer', maxlength: 'integer', wrap: 'text', autocomplete: 'text', form: 'text' },
  label: { for: 'text', form: 'text' },
  img: { src: 'text', srcset: 'text', alt: 'text', width: 'text', height: 'text', sizes: 'text', loading: 'text', decoding: 'text', fetchpriority: 'text', crossorigin: 'text', referrerpolicy: 'text', usemap: 'text', ismap: 'boolean' },
  canvas: { width: 'text', height: 'text' },
  iframe: { src: 'text', srcdoc: 'text', name: 'text', sandbox: 'text', allow: 'text', allowfullscreen: 'boolean', loading: 'text', referrerpolicy: 'text', width: 'text', height: 'text' },
  details: { open: 'boolean', name: 'text' },
  dialog: { open: 'boolean' },
};

// Three-way element classification mirroring the manifest hierarchy:
//   - void   → extends Element directly; no children, no inner_html/text_content
//   - text   → extends TextElement; children must be Texts; inner_html + text_content
//   - parent → extends ParentElement; children are mixed; inner_html + text_content
// Anything not listed in VOID_TAGS or TEXT_TAGS is treated as parent.
const VOID_TAGS = new Set(['br', 'hr', 'img', 'input']);
const TEXT_TAGS = new Set(['textarea']);

function tagClassification(tag) {
  if (VOID_TAGS.has(tag)) return 'void';
  if (TEXT_TAGS.has(tag)) return 'text';
  return 'parent';
}

// Body accessors contributed by TextElement and ParentElement on top of
// Element's own. Both add the same surface today; kept as separate maps
// so future divergence (e.g., text-only-flavored content reads) is local.
const PARENT_ELEMENT_ACCESSORS = {
  inner_html: 'innerhtml',
  text_content: 'textcontent',
  inner_text: 'innertext',
};
const TEXT_ELEMENT_ACCESSORS = {
  inner_html: 'innerhtml',
  text_content: 'textcontent',
  inner_text: 'innertext',
};

// Element-level content + identity accessors. These read from DOM IDL
// properties, not attributes — `outerHTML`, `tagName`, etc. always exist
// on an Element, so no `hasAttribute` gating. Node-level identity readers
// (node_name, node_type, node_value) live on the Node surface and are
// dispatched separately.
const ELEMENT_PROP_ACCESSORS = {
  outer_html: 'outerhtml',
  outer_text: 'outertext',
  tag_name: 'tagname',
  local_name: 'localname',
  namespace_uri: 'namespaceuri',
  prefix: 'prefix',
  has_attributes: 'hasattributes',
  get_attribute_names: 'getattributenames',
};

// Settable element fields. Each entry maps the manifest's snake_case name
// to (a) the DOM IDL property to write, (b) a coercion fn turning the wire
// value into the right JS type, and (c) whether the void classification
// should silently reject the write — content-bearing fields don't apply to
// <br>/<input>/etc. but scroll position does (the IDL property is just a
// no-op there). Read and set surfaces stay independent from
// PARENT/TEXT_ELEMENT_ACCESSORS so each can evolve on its own.
const ELEMENT_SETTERS = {
  inner_html:    { prop: 'innerHTML',   coerce: v => v == null ? '' : String(v), voidReject: true },
  text_content:  { prop: 'textContent', coerce: v => v == null ? '' : String(v), voidReject: true },
  inner_text:    { prop: 'innerText',   coerce: v => v == null ? '' : String(v), voidReject: true },
  scroll_top:    { prop: 'scrollTop',   coerce: v => v == null ? 0 : Number(v), voidReject: false },
  scroll_left:   { prop: 'scrollLeft',  coerce: v => v == null ? 0 : Number(v), voidReject: false },
};

const ARIA_ACCESSORS = {
  role: 'text', label: 'text', labelledby: 'text', describedby: 'text',
  description: 'text', details: 'text',
  hidden: 'boolean', disabled: 'boolean', readonly: 'boolean', required: 'boolean',
  invalid: 'text', errormessage: 'text', checked: 'text', pressed: 'text',
  selected: 'boolean', expanded: 'boolean', busy: 'boolean',
  live: 'text', atomic: 'boolean', relevant: 'text', current: 'text',
  haspopup: 'text', level: 'integer', modal: 'boolean',
  multiline: 'boolean', multiselectable: 'boolean', orientation: 'text',
  placeholder: 'text', sort: 'text',
  valuemax: 'decimal', valuemin: 'decimal', valuenow: 'decimal', valuetext: 'text',
  autocomplete: 'text', keyshortcuts: 'text', roledescription: 'text',
  activedescendant: 'text', controls: 'text', flowto: 'text', owns: 'text',
  colcount: 'integer', colindex: 'integer', colspan: 'integer',
  rowcount: 'integer', rowindex: 'integer', rowspan: 'integer',
  posinset: 'integer', setsize: 'integer',
};

// Read one element-level accessor. `hasAttribute` gates "absent" → null;
// otherwise we parse from the raw attribute string per the declared return
// type. Boolean attrs follow HTML's bare-presence convention (presence is
// true regardless of value-string). Integer attrs cross to BigInt — the
// codegen represents Brevity Integer as BigInt, so the receiver gets the
// type it expects without re-coercion.
function readElementAccessor(el, name, type) {
  if (!el.hasAttribute(name)) return null;
  const raw = el.getAttribute(name);
  if (type === 'boolean') return true;
  if (type === 'integer') {
    const n = parseInt(raw, 10);
    return Number.isFinite(n) ? BigInt(n) : null;
  }
  return raw;
}

// Aria reads use the `aria-` prefix (with `role` as the bare exception),
// and aria-* booleans use the "true"/"false" string convention rather than
// HTML's bare-presence form. Decimal accessors return JS Number — the
// receiving actor's BvDecimal.from at the type boundary handles wrapping.
function readAriaAccessor(el, name, type) {
  const attrName = name === 'role' ? 'role' : 'aria-' + name;
  if (!el.hasAttribute(attrName)) return null;
  const raw = el.getAttribute(attrName);
  if (type === 'boolean') return raw === 'true';
  if (type === 'integer') {
    const n = parseInt(raw, 10);
    return Number.isFinite(n) ? BigInt(n) : null;
  }
  if (type === 'decimal') {
    const n = parseFloat(raw);
    return Number.isFinite(n) ? n : null;
  }
  return raw;
}

export async function start(document, { extract, compile, compileOptions = {}, fetch = globalThis.fetch }) {
  const browserOptions = {
    ...compileOptions,
    remotes: [
      ...(compileOptions.remotes || []),
      { path: 'document', service: documentManifest },
      { path: 'HTML', service: domManifest },
    ],
  };
  const classes = await boot(document, { extract, compile, compileOptions: browserOptions, implicitDI: true, fetch });
  const addresses = new Map();
  const elements = new Map();
  // Reverse lookup: DOM Node → its registered actor address (global form,
  // e.g. `HTML @div/3`). Populated whenever we mint an actor for a Node.
  // Traversal accessors consult this before minting on-the-fly so the same
  // DOM Node always surfaces the same wire token (identity preservation).
  const nodeToAddr = new Map();

  // ── HTML service — element constructors ───────────────────────────────────
  // Per-tag counters: each tag (div, p, span, …) numbers independently from 1,
  // so the address `HTML @div/1` and `HTML @p/1` refer to distinct elements.
  // Text and Comment nodes also use this map under keys `text` / `comment`.
  const tagCounters = new Map();
  // Per-element subscription bookkeeping (built inside registerElementActor)
  // is also indexed by addr so identity-preserving re-lookups can recover it.
  const elemSubsByAddr = new Map();

  let subCounter = 0;

  // Sub-reps (Aria, ClassList, Dataset) are addressable views backed by the
  // same DOM Element. Each call to `el.aria()` / `.class_list()` / `.dataset()`
  // should return the SAME wire token across calls so two callers querying
  // the same element get the same actor — matches the identity-preservation
  // story for tree traversal. `kind` namespaces the per-element map so a
  // single Element can carry distinct sub-reps without collision.
  const subRepCounters = { aria: 0, classlist: 0, dataset: 0 };
  const subRepsByElement = new Map(); // Element → { kind → addr }

  function getOrMintSubRep(kind, el, attachHandler) {
    let perEl = subRepsByElement.get(el);
    if (perEl) {
      const existing = perEl.get(kind);
      if (existing) return existing;
    } else {
      perEl = new Map();
      subRepsByElement.set(el, perEl);
    }
    const idx = ++subRepCounters[kind];
    const addr = `HTML @${kind}/${idx}`;
    const localAddr = `@${kind}/${idx}`;
    elements.set(addr, el);
    elements.set(localAddr, el);
    perEl.set(kind, addr);
    addresses.set(addr, attachHandler(addr));
    return addr;
  }

  // Aria sub-rep: every accessor reads aria-* attributes off `el` live;
  // no storage of its own. Wire address `HTML @aria/N` (global) +
  // `@aria/N` (local) routes through standard dispatch.
  function registerAriaSubRep(el) {
    return getOrMintSubRep('aria', el, addr => msg => {
      const { id, op, from } = msg;
      const opName = typeof op === 'string' ? op : (Array.isArray(op) ? op[op.length - 1] : null);
      try {
        if (typeof opName !== 'string' || !opName.startsWith('@')) return;
        const accessorName = opName.slice(1);
        const type = ARIA_ACCESSORS[accessorName];
        if (!type) return;
        const value = readAriaAccessor(el, accessorName, type);
        Promise.resolve().then(() => route({ id, re: value, from: addr, to: from }));
      } catch {
        if (typeof opName === 'string' && opName.length > 0) {
          Promise.resolve().then(() => route({ id, ex: { [opName]: 'error' }, from: addr, to: from }));
        }
      }
    });
  }

  // ClassList sub-rep — wraps `el.classList` (DOMTokenList). Every method
  // delegates straight through; dedup is handled by getOrMintSubRep so two
  // calls of `el.class_list()` return the same wire token.
  function registerClassListSubRep(el) {
    return getOrMintSubRep('classlist', el, addr => msg => {
      const { id, op, from } = msg;
      const opName = typeof op === 'string' ? op : (Array.isArray(op) ? op[op.length - 1] : null);
      try {
        // `set value: (Text)` — wire shape `{op: [[v], '#set'], to: '@value'}`.
        if (opName === '#set') {
          const sel = typeof msg.to === 'string' ? msg.to : '';
          const fieldName = sel.startsWith('@') ? sel.slice(1) : null;
          if (fieldName !== 'value') return;
          const payload = Array.isArray(op) && Array.isArray(op[0]) ? op[0] : null;
          const value = payload && payload.length > 0 ? payload[0] : null;
          el.classList.value = value == null ? '' : String(value);
          Promise.resolve().then(() => route({ id, re: {}, 'bv-a': 'self', from: addr, to: from }));
          return;
        }
        if (typeof opName !== 'string' || !opName.startsWith('@')) return;
        const accessorName = opName.slice(1);
        const payload = Array.isArray(op) ? op[0] : null;
        switch (accessorName) {
          case 'length': {
            Promise.resolve().then(() => route({ id, re: BigInt(el.classList.length), from: addr, to: from }));
            return;
          }
          case 'value': {
            Promise.resolve().then(() => route({ id, re: el.classList.value, from: addr, to: from }));
            return;
          }
          case 'item': {
            const idx = extractSingle(payload, 'index');
            const i = typeof idx === 'bigint' ? Number(idx) : Number(idx);
            Promise.resolve().then(() => route({ id, re: el.classList.item(i), from: addr, to: from }));
            return;
          }
          case 'contains': {
            const token = extractSingle(payload, 'token');
            const result = typeof token === 'string' ? el.classList.contains(token) : false;
            Promise.resolve().then(() => route({ id, re: result, from: addr, to: from }));
            return;
          }
          case 'add!': {
            const tokens = tokensFromPayload(payload);
            el.classList.add(...tokens);
            Promise.resolve().then(() => route({ id, re: {}, 'bv-a': 'self', from: addr, to: from }));
            return;
          }
          case 'remove!': {
            const tokens = tokensFromPayload(payload);
            el.classList.remove(...tokens);
            Promise.resolve().then(() => route({ id, re: {}, 'bv-a': 'self', from: addr, to: from }));
            return;
          }
          case 'toggle!': {
            // Returns the new presence state (Boolean), not self — useful
            // information that the spec deliberately surfaces.
            let token = null, force;
            if (Array.isArray(payload)) { token = payload[0]; if (payload.length > 1) force = payload[1]; }
            else if (payload && typeof payload === 'object') { token = payload.token; if ('force' in payload) force = payload.force; }
            if (typeof token !== 'string') return;
            const result = typeof force === 'boolean' ? el.classList.toggle(token, force) : el.classList.toggle(token);
            Promise.resolve().then(() => route({ id, re: result, from: addr, to: from }));
            return;
          }
          case 'replace!': {
            // Returns whether the swap happened; if `old` isn't present,
            // returns false (and no insertion occurs, per spec).
            let oldTok = null, newTok = null;
            if (Array.isArray(payload)) { oldTok = payload[0]; newTok = payload[1]; }
            else if (payload && typeof payload === 'object') { oldTok = payload.old_token; newTok = payload.new_token; }
            if (typeof oldTok !== 'string' || typeof newTok !== 'string') return;
            const result = el.classList.replace(oldTok, newTok);
            Promise.resolve().then(() => route({ id, re: result, from: addr, to: from }));
            return;
          }
        }
      } catch {
        if (typeof opName === 'string' && opName.length > 0) {
          Promise.resolve().then(() => route({ id, ex: { [opName]: 'error' }, from: addr, to: from }));
        }
      }
    });
  }

  // Dataset sub-rep — wraps `el.dataset` (DOMStringMap). The DOM proxy
  // already handles camelCase ↔ kebab-case translation (e.g.,
  // `dataset.fooBar` ↔ `data-foo-bar`), so callers pass camelCase keys
  // and the runtime forwards them verbatim.
  function registerDatasetSubRep(el) {
    return getOrMintSubRep('dataset', el, addr => msg => {
      const { id, op, from } = msg;
      const opName = typeof op === 'string' ? op : (Array.isArray(op) ? op[op.length - 1] : null);
      try {
        if (typeof opName !== 'string' || !opName.startsWith('@')) return;
        const accessorName = opName.slice(1);
        const payload = Array.isArray(op) ? op[0] : null;
        switch (accessorName) {
          case 'size': {
            Promise.resolve().then(() => route({ id, re: BigInt(Object.keys(el.dataset).length), from: addr, to: from }));
            return;
          }
          case 'has': {
            const key = extractSingle(payload, 'key');
            const result = typeof key === 'string' ? key in el.dataset : false;
            Promise.resolve().then(() => route({ id, re: result, from: addr, to: from }));
            return;
          }
          case 'get': {
            const key = extractSingle(payload, 'key');
            // DOMStringMap returns undefined for missing keys; normalize to null.
            const v = typeof key === 'string' ? el.dataset[key] : undefined;
            Promise.resolve().then(() => route({ id, re: v == null ? null : v, from: addr, to: from }));
            return;
          }
          case 'put!': {
            // Named `put!` (rather than `set!`) avoids collision with the
            // `set` keyword used by the field-set wire form on element
            // accessors. JS dataset has no native verb here — `put!`
            // mirrors map-like APIs and reads naturally at call sites.
            let key = null, value = null;
            if (Array.isArray(payload)) { key = payload[0]; value = payload[1]; }
            else if (payload && typeof payload === 'object') { key = payload.key; value = payload.value; }
            if (typeof key !== 'string' || typeof value !== 'string') return;
            el.dataset[key] = value;
            Promise.resolve().then(() => route({ id, re: {}, 'bv-a': 'self', from: addr, to: from }));
            return;
          }
          case 'remove!': {
            const key = extractSingle(payload, 'key');
            if (typeof key === 'string') delete el.dataset[key];
            Promise.resolve().then(() => route({ id, re: {}, 'bv-a': 'self', from: addr, to: from }));
            return;
          }
          case 'keys': {
            Promise.resolve().then(() => route({ id, re: Object.keys(el.dataset), from: addr, to: from }));
            return;
          }
          case 'values': {
            Promise.resolve().then(() => route({ id, re: Object.values(el.dataset), from: addr, to: from }));
            return;
          }
          case 'entries': {
            const out = Object.entries(el.dataset).map(([k, v]) => ({ key: k, value: v }));
            Promise.resolve().then(() => route({ id, re: out, from: addr, to: from }));
            return;
          }
        }
      } catch {
        if (typeof opName === 'string' && opName.length > 0) {
          Promise.resolve().then(() => route({ id, ex: { [opName]: 'error' }, from: addr, to: from }));
        }
      }
    });
  }

  // Pull tokens from a payload that may carry a single string positional,
  // a single List positional, or a named `:tokens` list. Filters to
  // strings so a malformed entry can't crash classList.add.
  function tokensFromPayload(payload) {
    if (Array.isArray(payload)) {
      const v = payload[0];
      if (typeof v === 'string') return [v];
      if (Array.isArray(v)) return v.filter(s => typeof s === 'string');
    }
    if (payload && typeof payload === 'object' && Array.isArray(payload.tokens)) {
      return payload.tokens.filter(s => typeof s === 'string');
    }
    return [];
  }

  // Mint a fresh HTML element address (per-tag counter) and register its
  // actor handler. Elements are registered in the shared `elements` map
  // under BOTH their global form (`HTML @tag/N`) and local form (`@tag/N`).
  // External lookups (e.g., document.body.append! receiving a `#<HTML @p/1>`
  // reference from another subsystem) use the global form; HTML-internal
  // lookups after strip-on-hop (where the `HTML` alias has been stripped
  // from embedded payload tokens) use the local form. The two keys are
  // disjoint — HTML element local selectors are `@tag/N` (tag + slash +
  // number), while closure selectors are `@N` (numeric) — so they can
  // coexist in a single map.
  function registerElementActor(tag, el) {
    const existing = nodeToAddr.get(el);
    if (existing) return { addr: existing, elemSubs: elemSubsByAddr.get(existing) || new Map() };
    const idx = (tagCounters.get(tag) || 0) + 1;
    tagCounters.set(tag, idx);
    const addr = `HTML @${tag}/${idx}`;
    const localAddr = `@${tag}/${idx}`;
    const elemSubs = new Map();
    elemSubsByAddr.set(addr, elemSubs);
    elements.set(addr, el);
    elements.set(localAddr, el);
    nodeToAddr.set(el, addr);
    addresses.set(addr, elemMsg => {
      const { id: eid, op: eop, from: efrom, re: eRe } = elemMsg;
      const eopName = typeof eop === 'string' ? eop : (Array.isArray(eop) ? eop[eop.length - 1] : null);
      try {
        if (eRe !== undefined && elemSubs.has(eid)) {
          const target = elemSubs.get(eid);
          const val = Array.isArray(eRe) ? eRe[0] : eRe;
          if (target instanceof Node) {
            target.nodeValue = val == null ? '' : String(val);
          } else {
            applyDomAttribute(el, target.attrName, val);
          }
          return;
        }
        const cls = tagClassification(tag);
        // Bare `set` op carries the field selector in `to`. Wire form is
        // `{op: [[v], '#set'], to: '#<<addr> @<field>>'}`; route() unwraps
        // to `to: '@<field>'` before handing the message to us. Maps to a
        // DOM IDL property write per ELEMENT_SETTERS, then replies `self`.
        if (eopName === '#set') {
          const sel = typeof elemMsg.to === 'string' ? elemMsg.to : '';
          const fieldName = sel.startsWith('@') ? sel.slice(1) : null;
          const setter = fieldName && ELEMENT_SETTERS[fieldName];
          if (!setter) return;
          if (setter.voidReject && cls === 'void') return;
          const payload = Array.isArray(eop) && Array.isArray(eop[0]) ? eop[0] : null;
          const value = payload && payload.length > 0 ? payload[0] : null;
          el[setter.prop] = setter.coerce(value);
          Promise.resolve().then(() => route({
            id: eid, re: {}, 'bv-a': 'self', from: addr, to: efrom,
          }));
          return;
        }
        if (typeof eopName !== 'string' || !eopName.startsWith('@')) return;
        // Mutators end with `!`. They mutate the DOM and reply with `self`,
        // so the caller can chain. Dispatched before the accessor pyramid
        // so that mutator names don't collide with accessor names sharing
        // the same op surface.
        if (eopName.endsWith('!')) {
          const payload = Array.isArray(eop) ? eop[0] : null;
          if (handleElementMutator(tag, cls, el, eopName, payload)) {
            Promise.resolve().then(() => route({
              id: eid, re: {}, 'bv-a': 'self', from: addr, to: efrom,
            }));
          }
          return;
        }
        const accessorName = eopName.slice(1);
        // Generic-attribute readers carry a payload (the attribute name).
        // They live on the Element layer and apply to every classification.
        if (accessorName === 'get_attribute' || accessorName === 'has_attribute') {
          const payload = Array.isArray(eop) ? eop[0] : null;
          const name = extractSingle(payload, 'name');
          if (typeof name !== 'string') return;
          const value = accessorName === 'get_attribute'
            ? (el.hasAttribute(name) ? el.getAttribute(name) : null)
            : el.hasAttribute(name);
          Promise.resolve().then(() => route({ id: eid, re: value, from: addr, to: efrom }));
          return;
        }
        // Selector-based queries (querySelector / closest / matches /
        // getElementsBy*). Lives between attribute readers and traversal so
        // its payload-bearing branches can't be shadowed by zero-arg names.
        const queryValue = readQueryAccessor(el, accessorName, eop);
        if (queryValue !== undefined) {
          Promise.resolve().then(() => route({ id: eid, re: queryValue, from: addr, to: efrom }));
          return;
        }
        // Tree traversal: Node-level (parent_node/child_nodes/etc.) plus
        // Element-narrowed (children/first_element_child/etc.). Each
        // returns `undefined` when the name isn't part of its surface,
        // letting the next layer try.
        const traversalValue = readElementTraversal(el, accessorName);
        if (traversalValue !== undefined) {
          Promise.resolve().then(() => route({ id: eid, re: traversalValue, from: addr, to: efrom }));
          return;
        }
        const geometryValue = readElementGeometry(el, accessorName);
        if (geometryValue !== undefined) {
          Promise.resolve().then(() => route({ id: eid, re: geometryValue, from: addr, to: efrom }));
          return;
        }
        const nodeValue = readNodeAccessor(el, accessorName, eop);
        if (nodeValue !== undefined) {
          Promise.resolve().then(() => route({ id: eid, re: nodeValue, from: addr, to: efrom }));
          return;
        }
        // Lookup pyramid mirrors the manifest's inheritance: tag's own body
        // wins, then the tag's classification (TextElement/ParentElement
        // body), then Element's body. Void tags get only the Element layer.
        const tagOwn = TAG_ACCESSORS[tag] || {};
        const classOwn = cls === 'parent' ? PARENT_ELEMENT_ACCESSORS
                       : cls === 'text'   ? TEXT_ELEMENT_ACCESSORS
                       : {};
        const type = tagOwn[accessorName]
          || classOwn[accessorName]
          || ELEMENT_PROP_ACCESSORS[accessorName]
          || ELEMENT_ACCESSORS[accessorName];
        if (!type) return;
        let value;
        if (type === 'aria') {
          value = hasAnyAriaAttribute(el) ? '#<' + registerAriaSubRep(el) + '>' : null;
        } else if (type === 'classlist') {
          // Always present on every Element — never null.
          value = '#<' + registerClassListSubRep(el) + '>';
        } else if (type === 'dataset') {
          // Always present on every Element — never null.
          value = '#<' + registerDatasetSubRep(el) + '>';
        } else if (type === 'innerhtml')      value = el.innerHTML;
        else if  (type === 'textcontent')     value = el.textContent;
        else if  (type === 'innertext')       value = el.innerText;
        else if  (type === 'outerhtml')       value = el.outerHTML;
        else if  (type === 'outertext')       value = el.outerText;
        else if  (type === 'tagname')         value = el.tagName;
        else if  (type === 'localname')       value = el.localName;
        else if  (type === 'namespaceuri')    value = el.namespaceURI;
        else if  (type === 'prefix')          value = el.prefix;
        else if  (type === 'hasattributes')   value = el.hasAttributes();
        else if  (type === 'getattributenames') value = el.getAttributeNames();
        else value = readElementAccessor(el, accessorName, type);
        Promise.resolve().then(() => route({ id: eid, re: value, from: addr, to: efrom }));
      } catch {
        // Any DOM-thrown error (e.g. invalid CSS selector for query_selector,
        // failed appendChild on a circular tree, etc.) becomes an `ex`-shaped
        // reply per the JS-class convention. Key is the @-prefixed op name.
        if (typeof eopName === 'string' && eopName.length > 0) {
          Promise.resolve().then(() => route({ id: eid, ex: { [eopName]: 'error' }, from: addr, to: efrom }));
        }
      }
    });
    return { addr, elemSubs };
  }

  // The `aria()` accessor returns null when the element has no aria
  // surface at all; otherwise it mints (or returns) an Aria sub-rep. We
  // probe presence by scanning the attribute list for any aria-* entry
  // (or the bare `role` attribute) — same set the constructor maps from
  // the Aria bucket on the way in.
  function hasAnyAriaAttribute(el) {
    for (const attr of el.attributes) {
      if (attr.name === 'role' || attr.name.startsWith('aria-')) return true;
    }
    return false;
  }

  // Convert a DOM Node into its wire token (`#<...>`), preferring an
  // existing registered address. On-demand minting handles Nodes that
  // entered the tree without going through brevity (e.g., parsed by
  // innerHTML, pre-existing <body> content). Returns null for absent
  // input or unsupported node types.
  function addrForNode(node) {
    if (!node) return null;
    if (node === document) return 'document';
    const existing = nodeToAddr.get(node);
    if (existing) return existing;
    if (node.nodeType === 1) {
      const { addr } = registerElementActor(node.localName, node);
      return addr;
    }
    if (node.nodeType === 3) return registerTextNodeActor(node);
    if (node.nodeType === 8) return registerCommentNodeActor(node);
    // Document (9), DocumentFragment (11), ShadowRoot, others — no actor.
    return null;
  }

  function tokenForNode(node) {
    const addr = addrForNode(node);
    return addr == null ? null : '#<' + addr + '>';
  }

  // Register a non-Element node (text/comment). They share the Node-level
  // dispatch surface — no Element body, no attribute reads, no mutators.
  function registerNonElementNodeActor(kind, node) {
    const existing = nodeToAddr.get(node);
    if (existing) return existing;
    const idx = (tagCounters.get(kind) || 0) + 1;
    tagCounters.set(kind, idx);
    const addr = `HTML @${kind}/${idx}`;
    const localAddr = `@${kind}/${idx}`;
    elements.set(addr, node);
    elements.set(localAddr, node);
    nodeToAddr.set(node, addr);
    addresses.set(addr, msg => {
      const { id, op, from } = msg;
      const opName = typeof op === 'string' ? op : (Array.isArray(op) ? op[op.length - 1] : null);
      try {
        // Bare `set` directed at the node itself (no field selector in `to`)
        // writes through to nodeValue. Wire form: `{op: [[v], '#set'], to:
        // '#<<addr>>'}` — route() unwraps the hash-angle and delivers with
        // `to: undefined`. Distinct from the element field-set form, which
        // carries `to: '@<field>'`. Text and Comment have nodeValue as
        // their natural settable surface; Element/Document don't accept
        // bare set (semantically ambiguous for elements, no nodeValue
        // meaning for the document).
        if (opName === '#set') {
          const sel = typeof msg.to === 'string' ? msg.to : '';
          if (sel) return; // field-targeted set — none declared on these kinds
          const payload = Array.isArray(op) && Array.isArray(op[0]) ? op[0] : null;
          const value = payload && payload.length > 0 ? payload[0] : null;
          node.nodeValue = value == null ? '' : String(value);
          Promise.resolve().then(() => route({ id, re: {}, 'bv-a': 'self', from: addr, to: from }));
          return;
        }
        if (typeof opName !== 'string' || !opName.startsWith('@')) return;
        // Node-level mutators (currently just `normalize!`). On non-element
        // nodes the call is a spec no-op (no children to merge) but still
        // replies self so chaining works uniformly across node kinds.
        if (opName === '@normalize!') {
          node.normalize();
          Promise.resolve().then(() => route({ id, re: {}, 'bv-a': 'self', from: addr, to: from }));
          return;
        }
        const accessorName = opName.slice(1);
        const result = readNodeAccessor(node, accessorName, op);
        if (result === undefined) return;
        Promise.resolve().then(() => route({ id, re: result, from: addr, to: from }));
      } catch {
        if (typeof opName === 'string' && opName.length > 0) {
          Promise.resolve().then(() => route({ id, ex: { [opName]: 'error' }, from: addr, to: from }));
        }
      }
    });
    return addr;
  }
  function registerTextNodeActor(node)    { return registerNonElementNodeActor('text', node); }
  function registerCommentNodeActor(node) { return registerNonElementNodeActor('comment', node); }

  // Shared Node-level accessors. Returns the reply value, or `undefined`
  // when the accessor isn't recognised on the Node surface (caller stays
  // silent, mirroring missing-accessor behaviour elsewhere). `op` is the
  // raw op so contains/compare_document_position can read their payload.
  function readNodeAccessor(node, accessorName, op) {
    switch (accessorName) {
      case 'node_name':       return node.nodeName;
      case 'node_type':       return BigInt(node.nodeType);
      case 'node_value':      return node.nodeValue;
      case 'is_connected':    return node.isConnected;
      case 'parent_node':     return tokenForNode(node.parentNode);
      case 'parent_element':  return tokenForNode(node.parentElement);
      case 'first_child':     return tokenForNode(node.firstChild);
      case 'last_child':      return tokenForNode(node.lastChild);
      case 'next_sibling':    return tokenForNode(node.nextSibling);
      case 'previous_sibling':return tokenForNode(node.previousSibling);
      case 'owner_document':  return tokenForNode(node.ownerDocument);
      case 'get_root_node':   return tokenForNode(node.getRootNode());
      case 'child_nodes': {
        const out = [];
        for (const c of node.childNodes) { const t = tokenForNode(c); if (t) out.push(t); }
        return out;
      }
      case 'contains': {
        const payload = Array.isArray(op) ? op[0] : null;
        const other = extractSingle(payload, 'other');
        return other instanceof Node ? node.contains(other) : false;
      }
      case 'compare_document_position': {
        const payload = Array.isArray(op) ? op[0] : null;
        const other = extractSingle(payload, 'other');
        return other instanceof Node ? BigInt(node.compareDocumentPosition(other)) : null;
      }
      case 'clone_node': {
        // The clone is a fresh DOM Node; addrForNode mints a new actor for
        // it on first lookup, so two consecutive clone_node() calls return
        // distinct addresses (not identity-preserving by design — clones
        // are different nodes).
        const payload = Array.isArray(op) ? op[0] : null;
        const deep = extractSingle(payload, 'deep');
        return tokenForNode(node.cloneNode(typeof deep === 'boolean' ? deep : false));
      }
      case 'is_equal_node': {
        const payload = Array.isArray(op) ? op[0] : null;
        const other = extractSingle(payload, 'other');
        return other instanceof Node ? node.isEqualNode(other) : false;
      }
      case 'is_same_node': {
        const payload = Array.isArray(op) ? op[0] : null;
        const other = extractSingle(payload, 'other');
        return other instanceof Node ? node.isSameNode(other) : false;
      }
      default: return undefined;
    }
  }

  // Geometry/scroll readers — Element-only. Integer-typed dimensions cross
  // as BigInt (codegen represents Brevity Integer as BigInt); Decimal
  // scroll positions cross as Number (BvDecimal.from at the type boundary
  // wraps them on the Brevity side). DOMRect serialises as a flat
  // Structure with all 8 fields the spec exposes.
  function rectToStruct(r) {
    return {
      x: r.x, y: r.y,
      width: r.width, height: r.height,
      top: r.top, right: r.right, bottom: r.bottom, left: r.left,
    };
  }
  function readElementGeometry(el, accessorName) {
    switch (accessorName) {
      case 'client_width':   return BigInt(el.clientWidth);
      case 'client_height':  return BigInt(el.clientHeight);
      case 'client_top':     return BigInt(el.clientTop);
      case 'client_left':    return BigInt(el.clientLeft);
      case 'offset_width':   return BigInt(el.offsetWidth);
      case 'offset_height':  return BigInt(el.offsetHeight);
      case 'offset_top':     return BigInt(el.offsetTop);
      case 'offset_left':    return BigInt(el.offsetLeft);
      case 'offset_parent':  return tokenForNode(el.offsetParent);
      case 'scroll_width':   return BigInt(el.scrollWidth);
      case 'scroll_height':  return BigInt(el.scrollHeight);
      case 'scroll_top':     return el.scrollTop;
      case 'scroll_left':    return el.scrollLeft;
      case 'bounding_client_rect': return rectToStruct(el.getBoundingClientRect());
      case 'client_rects': {
        const out = [];
        for (const r of el.getClientRects()) out.push(rectToStruct(r));
        return out;
      }
      default: return undefined;
    }
  }

  // Element-narrowed traversal — only valid on Elements, not Text/Comment.
  function readElementTraversal(el, accessorName) {
    switch (accessorName) {
      case 'children': {
        const out = [];
        for (const c of el.children) { const t = tokenForNode(c); if (t) out.push(t); }
        return out;
      }
      case 'first_element_child':    return tokenForNode(el.firstElementChild);
      case 'last_element_child':     return tokenForNode(el.lastElementChild);
      case 'next_element_sibling':   return tokenForNode(el.nextElementSibling);
      case 'previous_element_sibling': return tokenForNode(el.previousElementSibling);
      case 'child_element_count':    return BigInt(el.childElementCount);
      default: return undefined;
    }
  }

  // Selector-based queries. Apply to Element (all six) and Document
  // (querySelector/querySelectorAll/getElementsBy*). Results route through
  // tokenForNode → addrForNode so an Element already known under a CAM
  // address surfaces with that same token (identity preservation), and
  // never-seen Elements get an actor minted on demand. Lists are
  // snapshots (the spec's HTMLCollection live-update is not exposed —
  // CAM is message-passing). Invalid selectors throw SyntaxError; the
  // caller's try/catch converts that to an ex-shaped reply.
  function readQueryAccessor(node, accessorName, op) {
    const payload = Array.isArray(op) ? op[0] : null;
    switch (accessorName) {
      case 'query_selector': {
        const selector = extractSingle(payload, 'selector');
        if (typeof selector !== 'string') return null;
        return tokenForNode(node.querySelector(selector));
      }
      case 'query_selector_all': {
        const selector = extractSingle(payload, 'selector');
        if (typeof selector !== 'string') return [];
        const out = [];
        for (const m of node.querySelectorAll(selector)) {
          const t = tokenForNode(m);
          if (t) out.push(t);
        }
        return out;
      }
      case 'closest': {
        const selector = extractSingle(payload, 'selector');
        if (typeof selector !== 'string') return null;
        return tokenForNode(node.closest(selector));
      }
      case 'matches': {
        const selector = extractSingle(payload, 'selector');
        if (typeof selector !== 'string') return false;
        return node.matches(selector);
      }
      case 'get_elements_by_tag_name': {
        const name = extractSingle(payload, 'name');
        if (typeof name !== 'string') return [];
        const out = [];
        for (const m of node.getElementsByTagName(name)) {
          const t = tokenForNode(m);
          if (t) out.push(t);
        }
        return out;
      }
      case 'get_elements_by_class_name': {
        const names = extractSingle(payload, 'names');
        if (typeof names !== 'string') return [];
        const out = [];
        for (const m of node.getElementsByClassName(names)) {
          const t = tokenForNode(m);
          if (t) out.push(t);
        }
        return out;
      }
      default: return undefined;
    }
  }

  // Wire token → live DOM Node, or pass the value through if it's not an
  // address token. Used to translate `:children`-style payload entries
  // into Nodes that DOM mutator methods accept.
  function resolveWireItem(item) {
    if (typeof item === 'string' && item.startsWith('#<') && item.endsWith('>')) {
      const inner = item.slice(2, -1);
      return elements.get(inner) || null;
    }
    return item;
  }

  // Items list comes either positional (payload is `[[...]]` from a single
  // List positional arg) or named (`{items: [...]}`). Return the resolved
  // array of Nodes-or-strings ready to spread into a DOM method.
  function extractItems(payload) {
    if (Array.isArray(payload) && Array.isArray(payload[0])) return payload[0].map(resolveWireItem).filter(v => v !== null);
    if (payload && typeof payload === 'object' && Array.isArray(payload.items)) return payload.items.map(resolveWireItem).filter(v => v !== null);
    return [];
  }

  // Single-arg helpers: positional (`[val]`) or named keyed by `key`.
  function extractSingle(payload, key) {
    if (Array.isArray(payload)) return resolveWireItem(payload[0]);
    if (payload && typeof payload === 'object' && key in payload) return resolveWireItem(payload[key]);
    return null;
  }
  // Two-arg positional/named helper. Returns [first, second] resolved.
  function extractPair(payload, keys) {
    if (Array.isArray(payload)) {
      return [resolveWireItem(payload[0]), payload[1] != null ? resolveWireItem(payload[1]) : null];
    }
    if (payload && typeof payload === 'object') {
      return [
        keys[0] in payload ? resolveWireItem(payload[keys[0]]) : null,
        keys[1] in payload ? resolveWireItem(payload[keys[1]]) : null,
      ];
    }
    return [null, null];
  }

  const SIBLING_POSITIONS = new Set(['beforebegin', 'afterend']);
  const ALL_POSITIONS = new Set(['beforebegin', 'afterbegin', 'beforeend', 'afterend']);
  function positionAllowed(cls, position) {
    if (typeof position !== 'string') return false;
    return cls === 'void' ? SIBLING_POSITIONS.has(position) : ALL_POSITIONS.has(position);
  }

  // Build a ScrollToOptions object from either positional `[left, top]`
  // or named `{left, top, behavior}` payload. Numeric values are coerced
  // through Number; missing fields are simply omitted (browser defaults
  // to current scroll position for the missing axis).
  function scrollOptionsFromPayload(payload) {
    if (Array.isArray(payload)) {
      const opts = {};
      if (payload.length > 0 && payload[0] != null) opts.left = Number(payload[0]) || 0;
      if (payload.length > 1 && payload[1] != null) opts.top  = Number(payload[1]) || 0;
      return opts;
    }
    if (payload && typeof payload === 'object') {
      const opts = {};
      if ('left' in payload && payload.left != null)         opts.left = Number(payload.left) || 0;
      if ('top' in payload && payload.top != null)           opts.top  = Number(payload.top)  || 0;
      if (typeof payload.behavior === 'string')              opts.behavior = payload.behavior;
      return opts;
    }
    return {};
  }

  // Tree-mutator dispatch. Returns true when an op was recognized AND
  // executed (caller routes a `self` reply); false when the op name
  // doesn't match anything for this tag's classification (caller stays
  // silent — same shape as missing-accessor today).
  function handleElementMutator(tag, cls, el, opName, payload) {
    // Generic-attribute writers — Element layer, every classification.
    if (opName === '@set_attribute!') {
      let name = null, value = null;
      if (Array.isArray(payload)) { name = payload[0]; value = payload[1]; }
      else if (payload && typeof payload === 'object') { name = payload.name; value = payload.value; }
      if (typeof name !== 'string' || typeof value !== 'string') return false;
      el.setAttribute(name, value);
      return true;
    }
    if (opName === '@remove_attribute!') {
      const name = extractSingle(payload, 'name');
      if (typeof name !== 'string') return false;
      el.removeAttribute(name);
      return true;
    }
    if (opName === '@toggle_attribute!') {
      let name = null, force;
      if (Array.isArray(payload)) { name = payload[0]; if (payload.length > 1) force = payload[1]; }
      else if (payload && typeof payload === 'object') { name = payload.name; if ('force' in payload) force = payload.force; }
      if (typeof name !== 'string') return false;
      if (typeof force === 'boolean') el.toggleAttribute(name, force);
      else el.toggleAttribute(name);
      return true;
    }
    // Element-level methods — every classification, including void.
    if (opName === '@before!')        { el.before(...extractItems(payload));        return true; }
    if (opName === '@after!')         { el.after(...extractItems(payload));         return true; }
    if (opName === '@replace_with!')  { el.replaceWith(...extractItems(payload));   return true; }
    if (opName === '@remove!')        { el.remove();                                return true; }
    if (opName === '@normalize!')     { el.normalize();                             return true; }
    if (opName === '@blur!')          { el.blur();                                  return true; }
    if (opName === '@click!')         { el.click();                                 return true; }
    if (opName === '@focus!') {
      // Optional named arg `prevent_scroll` translates to FocusOptions
      // `{preventScroll: true}` (camelCase boundary). No-arg form passes
      // undefined so the browser uses its defaults.
      const opts = (payload && typeof payload === 'object' && !Array.isArray(payload) && 'prevent_scroll' in payload)
        ? { preventScroll: !!payload.prevent_scroll }
        : undefined;
      el.focus(opts);
      return true;
    }
    if (opName === '@scroll!' || opName === '@scroll_to!' || opName === '@scroll_by!') {
      // Two payload shapes: positional `[left, top]` or named
      // `{left, top, behavior}`. ScrollToOptions takes camelCase fields
      // with the same names (left/top), so only `behavior` passes through
      // verbatim. Empty named form becomes `{}` which scrolls to (0, 0).
      const opts = scrollOptionsFromPayload(payload);
      const fn = opName === '@scroll!' ? 'scroll'
              : opName === '@scroll_to!' ? 'scrollTo'
              : 'scrollBy';
      el[fn](opts);
      return true;
    }
    if (opName === '@scroll_into_view!') {
      // Three forms: no args (default-aligned), positional Boolean
      // (alignToTop legacy form), or named `{behavior, block, inline}`.
      if (payload == null) { el.scrollIntoView(); return true; }
      if (Array.isArray(payload)) {
        const arg = payload[0];
        if (typeof arg === 'boolean') el.scrollIntoView(arg);
        else el.scrollIntoView();
        return true;
      }
      if (typeof payload === 'object') {
        const opts = {};
        if (typeof payload.behavior === 'string') opts.behavior = payload.behavior;
        if (typeof payload.block === 'string')    opts.block    = payload.block;
        if (typeof payload.inline === 'string')   opts.inline   = payload.inline;
        el.scrollIntoView(Object.keys(opts).length ? opts : undefined);
        return true;
      }
      el.scrollIntoView();
      return true;
    }
    if (opName === '@insert_adjacent_element!') {
      const position = payload && typeof payload === 'object' ? payload.position : null;
      const target = payload && typeof payload === 'object' ? resolveWireItem(payload.element) : null;
      if (!positionAllowed(cls, position) || !(target instanceof Node)) return false;
      el.insertAdjacentElement(position, target);
      return true;
    }
    if (opName === '@insert_adjacent_text!') {
      const position = payload && typeof payload === 'object' ? payload.position : null;
      const text = payload && typeof payload === 'object' ? payload.text : null;
      if (!positionAllowed(cls, position) || typeof text !== 'string') return false;
      el.insertAdjacentText(position, text);
      return true;
    }
    if (opName === '@insert_adjacent_html!') {
      const position = payload && typeof payload === 'object' ? payload.position : null;
      const html = payload && typeof payload === 'object' ? payload.html : null;
      if (!positionAllowed(cls, position) || typeof html !== 'string') return false;
      el.insertAdjacentHTML(position, html);
      return true;
    }

    // Children-affecting methods — only on Parent and Text classes.
    // Text-class is restricted: nodes resolve to `null` (not text strings)
    // so `el.append(node)` would inject elements; we filter to strings.
    if (cls === 'parent' || cls === 'text') {
      if (opName === '@append!' || opName === '@prepend!' || opName === '@replace_children!') {
        let items = extractItems(payload);
        if (cls === 'text') items = items.filter(v => typeof v === 'string');
        const m = opName === '@append!' ? 'append'
                : opName === '@prepend!' ? 'prepend'
                : 'replaceChildren';
        el[m](...items);
        return true;
      }
    }

    // Single-element node operations — Parent only.
    if (cls === 'parent') {
      if (opName === '@append_child!') {
        const child = extractSingle(payload, 'child');
        if (child instanceof Node) el.appendChild(child);
        return true;
      }
      if (opName === '@remove_child!') {
        const child = extractSingle(payload, 'child');
        if (child instanceof Node && child.parentNode === el) el.removeChild(child);
        return true;
      }
      if (opName === '@insert_before!') {
        const [newChild, refChild] = extractPair(payload, ['new_child', 'ref_child']);
        if (newChild instanceof Node) el.insertBefore(newChild, refChild instanceof Node ? refChild : null);
        return true;
      }
      if (opName === '@replace_child!') {
        const [newChild, oldChild] = extractPair(payload, ['new_child', 'old_child']);
        if (newChild instanceof Node && oldChild instanceof Node && oldChild.parentNode === el) {
          el.replaceChild(newChild, oldChild);
        }
        return true;
      }
    }

    return false;
  }

  // Apply one HTML attribute to an element, mapping JS values to attribute
  // string conventions:
  //   - null / false / undefined → omit (boolean-attr false; absent slot)
  //   - true                    → present with empty value
  //   - Array                   → space-joined string (List of Texts → class="a b")
  //   - other                   → String(value)
  function applyDomAttribute(el, name, value) {
    if (value == null || value === false) return;
    if (value === true) { el.setAttribute(name, ''); return; }
    if (Array.isArray(value)) { el.setAttribute(name, value.map(v => String(v)).join(' ')); return; }
    el.setAttribute(name, String(value));
  }

  // Walk the `new` payload and stamp HTML attributes on the element:
  //   - top-level keys (excluding `children`, `aria`, `data`) → bare attrs;
  //     closure-address values (`#<…>`) become reactive subscriptions instead
  //   - `aria` sub-object  → `aria-{key}` for each, except `role` → bare `role`
  //   - `data` sub-object  → `data-{key}` for each
  const ATTR_BUCKETS = new Set(['children', 'aria', 'data']);
  function applyDomAttributes(el, payload, addr, elemSubs) {
    if (!payload || typeof payload !== 'object') return;
    for (const [k, v] of Object.entries(payload)) {
      if (ATTR_BUCKETS.has(k)) continue;
      if (addr && typeof v === 'string' && v.startsWith('#<') && v.endsWith('>')) {
        if (k.startsWith('on')) {
          const eventName = k.slice(2);
          const selector = v.slice(2, -1).split(' ').pop();
          el.addEventListener(eventName, () => {
            route({ id: `_evt_${++subCounter}`, op: selector, to: v, from: addr });
          });
        } else {
          const subId = `_sub_${++subCounter}`;
          elemSubs.set(subId, { attrName: k });
          Promise.resolve().then(() => route({ id: subId, op: '@subscribe', to: v, from: addr }));
        }
      } else {
        applyDomAttribute(el, k, v);
      }
    }
    if (payload.aria && typeof payload.aria === 'object') {
      for (const [k, v] of Object.entries(payload.aria)) {
        applyDomAttribute(el, k === 'role' ? 'role' : 'aria-' + k, v);
      }
    }
    if (payload.data && typeof payload.data === 'object') {
      for (const [k, v] of Object.entries(payload.data)) {
        applyDomAttribute(el, 'data-' + k, v);
      }
    }
  }

  // Children is an ordered array of bare strings (text runs), closure
  // addresses `#<actor @N>` (subscribe + text node), or already-live
  // element addresses `#<HTML @tag/N>` (appendChild). Matches XML
  // Infoset's [children] property. Caller pre-dispatches nested element
  // `new`s and passes their returned addresses here; by the time the
  // parent's dispatch lands, all child element actors are already
  // registered.
  function constructElementFromPayload(tag, payload) {
    const el = document.createElement(tag);
    const { addr, elemSubs } = registerElementActor(tag, el);
    applyDomAttributes(el, payload, addr, elemSubs);
    for (const child of (payload && payload.children) || []) {
      if (typeof child !== 'string') continue;
      if (child.startsWith('#<') && child.endsWith('>')) {
        const inner = child.slice(2, -1);
        const existingEl = elements.get(inner);
        if (existingEl) {
          el.appendChild(existingEl);
          continue;
        }
        const textNode = document.createTextNode('');
        el.appendChild(textNode);
        const subId = `_sub_${++subCounter}`;
        elemSubs.set(subId, textNode);
        Promise.resolve().then(() => route({
          id: subId, op: '@subscribe', to: child, from: addr,
        }));
        continue;
      }
      el.appendChild(document.createTextNode(child));
    }
    return { addr, el };
  }

  function handleDomNew(tag, msg) {
    const { id, op, from } = msg;
    const payload = Array.isArray(op) ? op[0] : {};
    const { addr } = constructElementFromPayload(tag, payload);
    Promise.resolve().then(() => route({
      id, re: '#<' + addr + '>', 'bv-a': '#<HTML @' + tag + '>', from: 'HTML', to: from,
    }));
  }

  // Extract the destination's alias from a `to` field. Handles both the
  // bare-global form (`ALIAS sel`) and the delimited-global form
  // (`#<ALIAS sel>`). Returns null for local forms (`@sel`, `#sel`,
  // `#<@sel>`, `#<#sel>`) — they name no outer alias to strip.
  function destAliasOf(to) {
    if (typeof to !== 'string') return null;
    let candidate = to;
    if (to.startsWith('#<') && to.endsWith('>')) candidate = to.slice(2, -1);
    const sp = candidate.indexOf(' ');
    const alias = sp === -1 ? candidate : candidate.slice(0, sp);
    if (!alias || alias.startsWith('@') || alias.startsWith('#')) return null;
    return alias;
  }

  function escapeForRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // Strip the destination's alias from embedded `#<ALIAS sel>` tokens in
  // payload strings — the inbound mirror of `rewriteAddressStrings`'s
  // outbound prepend. After strip, HTML's receive handler sees its own
  // elements in local form (`#<@p/1>`), which the dual-keyed `elements`
  // map resolves without needing knowledge of its own alias.
  function stripMatchingAlias(v, alias) {
    if (typeof v === 'string') {
      const pattern = new RegExp(escapeForRegExp('#<' + alias + ' '), 'g');
      return v.replace(pattern, '#<');
    }
    if (Array.isArray(v)) return v.map(el => stripMatchingAlias(el, alias));
    if (v && typeof v === 'object') {
      const out = {};
      for (const k of Object.keys(v)) out[k] = stripMatchingAlias(v[k], alias);
      return out;
    }
    return v;
  }

  function route(originalMsg) {
    const destAlias = destAliasOf(originalMsg.to);
    let msg = originalMsg;
    if (destAlias) {
      // Strip matching alias from embedded `#<ALIAS sel>` tokens in payload
      // fields only. Leaves `to` and `from` untouched — those identify the
      // dispatch endpoints, not payload content. `to` is decoded below by
      // the alias-aware dispatch paths; `from` names the sender's global
      // address, which replies need in unstripped form to route back.
      msg = { ...originalMsg };
      for (const k of Object.keys(originalMsg)) {
        if (k === 'to' || k === 'from') continue;
        msg[k] = stripMatchingAlias(originalMsg[k], destAlias);
      }
    }
    const to = msg.to;

    // `HTML @tag` form resolves to the tag's element constructor.
    let domTag = null;
    if (typeof to === 'string' && !addresses.has(to)) {
      const sepMatch = /^HTML\s+@(\w+)$/.exec(to);
      if (sepMatch) domTag = sepMatch[1];
    }
    if (domTag) {
      const { op } = msg;
      const opName = typeof op === 'string' ? op : op[op.length - 1];
      if (opName === '#new') {
        handleDomNew(domTag, msg);
        return;
      }
    }
    // Direct address match takes precedence (legacy + registered actors).
    if (to && addresses.has(to)) {
      addresses.get(to)(msg);
      return;
    }
    // `#<alias selector>` form (hash-angle delimited): the full address is
    // one chunk; interior is split into alias + selector. Deliver to alias
    // with the selector as the new `to` for the receiver's dispatcher.
    //
    // Multi-segment instance addresses (`#<HTML @div/1 @field>`) need the
    // longest registered prefix, since the alias is the *instance address*
    // (`HTML @div/1`), not just the first token. Try prefixes from longest
    // to shortest before falling back to the first-token alias.
    if (typeof to === 'string' && to.startsWith('#<') && to.endsWith('>')) {
      const inner = to.slice(2, -1);
      if (addresses.has(inner)) {
        addresses.get(inner)({ ...msg, to: undefined });
        return;
      }
      let cut = inner.lastIndexOf(' ');
      while (cut > 0) {
        const prefix = inner.slice(0, cut);
        if (addresses.has(prefix)) {
          addresses.get(prefix)({ ...msg, to: inner.slice(cut + 1) });
          return;
        }
        cut = inner.lastIndexOf(' ', cut - 1);
      }
      const sp = inner.indexOf(' ');
      const alias = sp === -1 ? inner : inner.slice(0, sp);
      const selector = sp === -1 ? undefined : inner.slice(sp + 1);
      if (addresses.has(alias)) {
        const forwarded = selector ? { ...msg, to: selector } : { ...msg, to: undefined };
        addresses.get(alias)(forwarded);
      }
    }
  }

  function registerElement(selector, el) {
    const addr = `document ${selector}`;
    if (!addresses.has(addr)) {
      elements.set(addr, el);
      // Register the element under nodeToAddr so any traversal that lands
      // on this DOM Node (e.g. `div.parent_node()` walking up to <body>)
      // returns this same legacy address — preserving identity across
      // both `document.body()` and traversal entrypoints.
      if (!nodeToAddr.has(el)) nodeToAddr.set(el, addr);
      addresses.set(addr, msg => {
        const { id, op, from } = msg;
        const opName = typeof op === 'string' ? op : (Array.isArray(op) ? op[op.length - 1] : null);
        try {
          if (opName === '@append!') {
            const payload = Array.isArray(op) ? op[0] : {};
            const val = typeof payload === 'string' ? payload : (Array.isArray(payload) ? payload[0] : '');
            if (typeof val === 'string' && val.startsWith('#<') && val.endsWith('>')) {
              const childAddr = val.slice(2, -1);
              const childEl = elements.get(childAddr);
              if (childEl) el.appendChild(childEl);
            } else {
              el.insertAdjacentHTML('beforeend', val);
            }
            Promise.resolve().then(() => route({ id, re: '#<' + addr + '>', 'bv-a': '#<Element>', from: 'document', to: from }));
            return;
          }
          if (opName === '@inner_html') {
            Promise.resolve().then(() => route({ id, re: el.innerHTML, from: addr, to: from }));
            return;
          }
          // Fall through to query, traversal, and Node accessors so this
          // legacy alias supports the same surface as a fresh element actor.
          if (typeof opName === 'string' && opName.startsWith('@')) {
            const accessorName = opName.slice(1);
            const queryVal = readQueryAccessor(el, accessorName, op);
            if (queryVal !== undefined) {
              Promise.resolve().then(() => route({ id, re: queryVal, from: addr, to: from }));
              return;
            }
            const traversal = readElementTraversal(el, accessorName);
            if (traversal !== undefined) {
              Promise.resolve().then(() => route({ id, re: traversal, from: addr, to: from }));
              return;
            }
            const nodeVal = readNodeAccessor(el, accessorName, op);
            if (nodeVal !== undefined) {
              Promise.resolve().then(() => route({ id, re: nodeVal, from: addr, to: from }));
              return;
            }
          }
        } catch {
          if (typeof opName === 'string' && opName.length > 0) {
            Promise.resolve().then(() => route({ id, ex: { [opName]: 'error' }, from: addr, to: from }));
          }
        }
      });
    }
    return addr;
  }

  // Register document as an addressable actor. The lowercase singleton is
  // typed against HTML.Document (which extends Node), so its surface is:
  //   - existing: @title, @first, @body
  //   - inherited from Node: parent_node, child_nodes, contains, etc.
  //   - declared on Document: query_selector(_all), get_elements_by_*
  // Errors (invalid selectors most commonly) become an `ex`-shaped reply.
  addresses.set('document', msg => {
    const { id, op, from } = msg;
    const opName = typeof op === 'string' ? op : (Array.isArray(op) ? op[op.length - 1] : null);
    try {
      if (opName === '@title') {
        Promise.resolve().then(() => route({ id, re: document.title, from: 'document', to: from }));
        return;
      }
      if (opName === '@first') {
        const payload = Array.isArray(op) ? op[0] : {};
        const selector = payload.selector;
        const el = document.querySelector(selector);
        if (el) {
          const addr = registerElement(selector, el);
          Promise.resolve().then(() => route({ id, re: '#<' + addr + '>', 'bv-a': '#<Element>', from: 'document', to: from }));
        }
        return;
      }
      if (opName === '@body') {
        const el = document.body;
        if (el) {
          const addr = registerElement('body', el);
          Promise.resolve().then(() => route({ id, re: '#<' + addr + '>', 'bv-a': '#<Element>', from: 'document', to: from }));
        }
        return;
      }
      if (opName === '@normalize!') {
        document.normalize();
        Promise.resolve().then(() => route({ id, re: {}, 'bv-a': 'self', from: 'document', to: from }));
        return;
      }
      if (typeof opName !== 'string' || !opName.startsWith('@')) return;
      const accessorName = opName.slice(1);
      // Selector queries on the document scope to descendants of <html>.
      const queryValue = readQueryAccessor(document, accessorName, op);
      if (queryValue !== undefined) {
        Promise.resolve().then(() => route({ id, re: queryValue, from: 'document', to: from }));
        return;
      }
      // Node-level surface (parent_node, child_nodes, contains, ...).
      const nodeValue = readNodeAccessor(document, accessorName, op);
      if (nodeValue !== undefined) {
        Promise.resolve().then(() => route({ id, re: nodeValue, from: 'document', to: from }));
        return;
      }
    } catch {
      if (typeof opName === 'string' && opName.length > 0) {
        Promise.resolve().then(() => route({ id, ex: { [opName]: 'error' }, from: 'document', to: from }));
      }
    }
  });

  // Parent-layer address translation for runtime-loaded actors. Payload
  // `#<@N>`/`#<#N>` addresses get the sender's address prepended; `from`
  // is filled in if missing, prepended if local-form. Structural walk
  // (not JSON round-trip) so BigInt and other non-JSON primitives survive.
  function rewriteAddressStrings(v, selfAddr) {
    if (typeof v === 'string') {
      return v.replace(/#<([@#][^>]*)>/g, (_, content) => `#<${selfAddr} ${content}>`);
    }
    if (Array.isArray(v)) return v.map(el => rewriteAddressStrings(el, selfAddr));
    if (v && typeof v === 'object') {
      const out = {};
      for (const k of Object.keys(v)) out[k] = rewriteAddressStrings(v[k], selfAddr);
      return out;
    }
    return v;
  }
  function translateOutbound(msg, selfAddr) {
    const out = rewriteAddressStrings(msg, selfAddr);
    if (out.from == null || out.from === '') {
      out.from = selfAddr;
    } else if (typeof out.from === 'string' && /^[@#]/.test(out.from)) {
      out.from = selfAddr + ' ' + out.from;
    }
    return out;
  }

  let anonCounter = 0;
  for (const { id, src, ActorClass } of classes) {
    // Every actor needs a routable address — even anonymous inline scripts.
    // Without one, replies to the actor's own init-time messages have
    // nowhere to land, and the await on (e.g.) document.body() never resolves.
    //
    // Address scheme (globals must start with a word char; leading delimiters
    // like `#`/`@` are reserved for internal/local addresses):
    //   - external src=path → path with leading `/` stripped (e.g. `app.bv`)
    //   - inline with id    → `script#id` (CSS-selector-shaped, single token)
    //   - anonymous inline  → `script#__bv_anon_N`
    let addr;
    if (src) {
      addr = src.replace(/^\/+/, '');
    } else if (id) {
      addr = `script#${id}`;
    } else {
      addr = `script#__bv_anon_${++anonCounter}`;
    }
    const binding = {
      post(msg) { route(translateOutbound(msg, addr)); },
      created(inst) {
        // Register address as soon as the instance exists (before #init),
        // so deferred replies during init can reach the actor.
        addresses.set(addr, msg => inst.receive(msg));
      },
    };
    await ActorClass.create(binding);
  }

  return {
    send: route,
    register(id, handler) {
      addresses.set(id, handler);
    },
  };
}
