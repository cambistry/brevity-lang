// The browser host's service documents (notes/opre-type-encoding-2026-11-21.md):
// `document`, the page's singleton actor, and `HTML`, the element classes.
//
// `document` is self-contained: a caller can `use :document` without also using
// HTML, so its document can't inherit Node's ops from HTML's; it mirrors
// Document's full surface, so the runtime answers identically whichever entry
// point a caller uses.
//
// HTML: Element is an abstract parent with every non-event-handler attribute
// that applies to every HTML tag, plus content fields (`inner_html`, `children`),
// so one typed constructor covers construction end to end. Per-attribute typing
// (Boolean / Integer / Decimal / Text) lets the validator catch wrong types at
// compile time. Aria buckets ARIA state and properties as one sub-type; its `role`
// serialises to the bare `role=` attribute. Concrete tags use lowercase names
// matching the HTML tag (`div`, `p`); a tag with attributes of its own (`<a>`
// with `href`, `<input>` with `type`, `value`, …) takes them after Element's.
//
// `children` is a list of wire tokens: text runs as bare strings, element
// references as `#<HTML:tag:N>`, closure subscriptions as `#<actor:@N>`; the
// runtime parses each entry to decide what to attach. `inner_html` is read after
// construction; initial content comes through `children`.
//
// Every attribute is optional: the caller may omit any of them, and the runtime
// supplies the default (null for an absent attribute). A few are unions where the
// HTML spec admits several shapes: `hidden` is a boolean attribute that also takes
// "until-found"; `class` is one space-separated string or a list of names;
// `<input value>` straddles text, number and decimal.
//
// Each class's instances list their own ops here; `expandInheritance` adds what
// they inherit from their parents.

import { expandInheritance } from '../../service_doc.js';

// Element's attributes. A subclass with params of its own takes only those
// (notes/super-2026-11-19.md), so each such class's `$new` states Element's too.
const ELEMENT_ARGS = {
  id: { '%opt': 'Text' },
  class: { '%opt': { '%or': ['Text', [['Text'], { '%t': 'List' }]] } },
  style: { '%opt': 'Text' },
  title: { '%opt': 'Text' },
  lang: { '%opt': 'Text' },
  dir: { '%opt': 'Text' },
  translate: { '%opt': 'Text' },
  hidden: { '%opt': { '%or': ['Boolean', 'Text'] } },
  tabindex: { '%opt': 'Integer' },
  accesskey: { '%opt': 'Text' },
  draggable: { '%opt': 'Boolean' },
  contenteditable: { '%opt': { '%or': ['Boolean', 'Text'] } },
  spellcheck: { '%opt': 'Boolean' },
  inert: { '%opt': 'Boolean' },
  autofocus: { '%opt': 'Boolean' },
  autocapitalize: { '%opt': 'Text' },
  autocorrect: { '%opt': 'Text' },
  inputmode: { '%opt': 'Text' },
  enterkeyhint: { '%opt': 'Text' },
  is: { '%opt': 'Text' },
  nonce: { '%opt': 'Text' },
  popover: { '%opt': { '%or': ['Boolean', 'Text'] } },
  slot: { '%opt': 'Text' },
  part: { '%opt': 'Text' },
  exportparts: { '%opt': 'Text' },
  itemid: { '%opt': 'Text' },
  itemprop: { '%opt': 'Text' },
  itemref: { '%opt': 'Text' },
  itemscope: { '%opt': 'Boolean' },
  itemtype: { '%opt': 'Text' },
  writingsuggestions: { '%opt': 'Text' },
  virtualkeyboardpolicy: { '%opt': 'Text' },
  data: { '%opt': 'Object' },
  aria: { '%opt': ':Aria:*' },
};

export const documentDocument = {
  ':document': {
    public: { $new: [{ re: [':document:*'], writes: false }] },
    ':*': {
      public: {
        title: [{ re: ['Text'], writes: false }],
        first: [{ args: [{ selector: 'Text' }], re: ['Element'], writes: false }],
        body: [{ re: ['body'], writes: false }],
        eval: [{ args: ['Text'], re: ['Text'], writes: false }],
        node_name: [{ re: ['Text'], writes: false }],
        node_type: [{ re: ['Integer'], writes: false }],
        node_value: [{ re: [{ '%or': ['Text', null] }], writes: false }],
        parent_node: [{ re: [{ '%or': ['Node', null] }], writes: false }],
        parent_element: [{ re: [{ '%or': ['Element', null] }], writes: false }],
        child_nodes: [{ re: [[['Nodes'], { '%t': 'List' }]], writes: false }],
        first_child: [{ re: [{ '%or': ['Node', null] }], writes: false }],
        last_child: [{ re: [{ '%or': ['Node', null] }], writes: false }],
        next_sibling: [{ re: [{ '%or': ['Node', null] }], writes: false }],
        previous_sibling: [{ re: [{ '%or': ['Node', null] }], writes: false }],
        owner_document: [{ re: [{ '%or': ['Node', null] }], writes: false }],
        is_connected: [{ re: ['Boolean'], writes: false }],
        get_root_node: [{ re: ['Node'], writes: false }],
        contains: [
          { args: ['Node'], re: ['Boolean'], writes: false },
          { args: [{ other: 'Node' }], re: ['Boolean'], writes: false },
        ],
        compare_document_position: [
          { args: ['Node'], re: ['Integer'], writes: false },
          { args: [{ other: 'Node' }], re: ['Integer'], writes: false },
        ],
        clone_node: [
          { re: ['Node'], writes: false },
          { args: ['Boolean'], re: ['Node'], writes: false },
          { args: [{ deep: 'Boolean' }], re: ['Node'], writes: false },
        ],
        is_equal_node: [
          { args: ['Node'], re: ['Boolean'], writes: false },
          { args: [{ other: 'Node' }], re: ['Boolean'], writes: false },
        ],
        is_same_node: [
          { args: ['Node'], re: ['Boolean'], writes: false },
          { args: [{ other: 'Node' }], re: ['Boolean'], writes: false },
        ],
        'normalize!': [{ re: [{ '%self': true }], writes: true }],
        query_selector: [
          { args: ['Text'], re: [{ '%or': ['Element', null] }], writes: false },
          { args: [{ selector: 'Text' }], re: [{ '%or': ['Element', null] }], writes: false },
        ],
        query_selector_all: [
          { args: ['Text'], re: [[['Elements'], { '%t': 'List' }]], writes: false },
          { args: [{ selector: 'Text' }], re: [[['Elements'], { '%t': 'List' }]], writes: false },
        ],
        get_elements_by_tag_name: [
          { args: ['Text'], re: [[['Elements'], { '%t': 'List' }]], writes: false },
          { args: [{ name: 'Text' }], re: [[['Elements'], { '%t': 'List' }]], writes: false },
        ],
        get_elements_by_class_name: [
          { args: ['Text'], re: [[['Elements'], { '%t': 'List' }]], writes: false },
          { args: [{ names: 'Text' }], re: [[['Elements'], { '%t': 'List' }]], writes: false },
        ],
      },
    },
  },
};

export const domDocument = expandInheritance({
  types: {
    ':Event': [
      {
        prevent: { '%fn': [{ writes: true }] },
        stop: { '%fn': [{ writes: true }] },
        stop_immediate: { '%fn': [{ writes: true }] },
        kind: { '%opt': 'Text' },
        phase: { '%opt': 'Integer' },
        bubbles: { '%opt': 'Boolean' },
        cancelable: { '%opt': 'Boolean' },
        composed: { '%opt': 'Boolean' },
        default_prevented: { '%opt': 'Boolean' },
        is_trusted: { '%opt': 'Boolean' },
        time_stamp: { '%opt': 'Float' },
        target: { '%opt': ':Element:*' },
        current_target: { '%opt': ':Element:*' },
        related_target: { '%opt': ':Element:*' },
        key: { '%opt': 'Text' },
        code: { '%opt': 'Text' },
        repeat: { '%opt': 'Boolean' },
        location: { '%opt': 'Integer' },
        is_composing: { '%opt': 'Boolean' },
        alt_key: { '%opt': 'Boolean' },
        ctrl_key: { '%opt': 'Boolean' },
        shift_key: { '%opt': 'Boolean' },
        meta_key: { '%opt': 'Boolean' },
        button: { '%opt': 'Integer' },
        buttons: { '%opt': 'Integer' },
        client_x: { '%opt': 'Float' },
        client_y: { '%opt': 'Float' },
        screen_x: { '%opt': 'Float' },
        screen_y: { '%opt': 'Float' },
        page_x: { '%opt': 'Float' },
        page_y: { '%opt': 'Float' },
        offset_x: { '%opt': 'Float' },
        offset_y: { '%opt': 'Float' },
      },
    ],
  },
  ':Node': {
    public: { $new: [{ re: [':Node:*'], writes: false }] },
    ':*': {
      public: {
        node_name: [{ re: ['Text'], writes: false }],
        node_type: [{ re: ['Integer'], writes: false }],
        node_value: [{ re: [{ '%or': ['Text', null] }], writes: false }],
        parent_node: [{ re: [{ '%or': [':Node:*', null] }], writes: false }],
        parent_element: [{ re: [{ '%or': [':Element:*', null] }], writes: false }],
        child_nodes: [{ re: [[['Nodes'], { '%t': 'List' }]], writes: false }],
        first_child: [{ re: [{ '%or': [':Node:*', null] }], writes: false }],
        last_child: [{ re: [{ '%or': [':Node:*', null] }], writes: false }],
        next_sibling: [{ re: [{ '%or': [':Node:*', null] }], writes: false }],
        previous_sibling: [{ re: [{ '%or': [':Node:*', null] }], writes: false }],
        owner_document: [{ re: [{ '%or': [':Node:*', null] }], writes: false }],
        is_connected: [{ re: ['Boolean'], writes: false }],
        get_root_node: [{ re: [':Node:*'], writes: false }],
        contains: [
          { args: [':Node:*'], re: ['Boolean'], writes: false },
          { args: [{ other: ':Node:*' }], re: ['Boolean'], writes: false },
        ],
        compare_document_position: [
          { args: [':Node:*'], re: ['Integer'], writes: false },
          { args: [{ other: ':Node:*' }], re: ['Integer'], writes: false },
        ],
        clone_node: [
          { re: [':Node:*'], writes: false },
          { args: ['Boolean'], re: [':Node:*'], writes: false },
          { args: [{ deep: 'Boolean' }], re: [':Node:*'], writes: false },
        ],
        is_equal_node: [
          { args: [':Node:*'], re: ['Boolean'], writes: false },
          { args: [{ other: ':Node:*' }], re: ['Boolean'], writes: false },
        ],
        is_same_node: [
          { args: [':Node:*'], re: ['Boolean'], writes: false },
          { args: [{ other: ':Node:*' }], re: ['Boolean'], writes: false },
        ],
        'normalize!': [{ re: [{ '%self': true }], writes: true }],
      },
    },
  },
  ':Text': { extends: [':Node'], public: { $new: [{ re: ['Text'], writes: false }] }, ':*': {} },
  ':Comment': { extends: [':Node'], public: { $new: [{ re: [':Comment:*'], writes: false }] }, ':*': {} },
  ':Document': {
    extends: [':Node'],
    public: { $new: [{ re: [':Document:*'], writes: false }] },
    ':*': {
      public: {
        title: [{ re: ['Text'], writes: false }],
        first: [{ args: [{ selector: 'Text' }], re: [':Element:*'], writes: false }],
        body: [{ re: [':body:*'], writes: false }],
        eval: [{ args: ['Text'], re: ['Text'], writes: false }],
        query_selector: [
          { args: ['Text'], re: [{ '%or': [':Element:*', null] }], writes: false },
          { args: [{ selector: 'Text' }], re: [{ '%or': [':Element:*', null] }], writes: false },
        ],
        query_selector_all: [
          { args: ['Text'], re: [[['Elements'], { '%t': 'List' }]], writes: false },
          { args: [{ selector: 'Text' }], re: [[['Elements'], { '%t': 'List' }]], writes: false },
        ],
        get_elements_by_tag_name: [
          { args: ['Text'], re: [[['Elements'], { '%t': 'List' }]], writes: false },
          { args: [{ name: 'Text' }], re: [[['Elements'], { '%t': 'List' }]], writes: false },
        ],
        get_elements_by_class_name: [
          { args: ['Text'], re: [[['Elements'], { '%t': 'List' }]], writes: false },
          { args: [{ names: 'Text' }], re: [[['Elements'], { '%t': 'List' }]], writes: false },
        ],
      },
    },
  },
  ':Element': {
    extends: [':Node'],
    public: { $new: [{ args: [{ ...ELEMENT_ARGS }], re: [':Element:*'], writes: false }] },
    ':*': {
      ':scroll_top': { public: { $set: [{ args: ['Decimal'], writes: true }] } },
      ':scroll_left': { public: { $set: [{ args: ['Decimal'], writes: true }] } },
      public: {
        id: [{ re: [{ '%or': ['Text', null] }], writes: false }],
        class: [{ re: [{ '%or': ['Text', null] }], writes: false }],
        style: [{ re: [{ '%or': ['Text', null] }], writes: false }],
        title: [{ re: [{ '%or': ['Text', null] }], writes: false }],
        lang: [{ re: [{ '%or': ['Text', null] }], writes: false }],
        dir: [{ re: [{ '%or': ['Text', null] }], writes: false }],
        translate: [{ re: [{ '%or': ['Text', null] }], writes: false }],
        hidden: [{ re: [{ '%or': ['Boolean', null] }], writes: false }],
        tabindex: [{ re: [{ '%or': ['Integer', null] }], writes: false }],
        accesskey: [{ re: [{ '%or': ['Text', null] }], writes: false }],
        draggable: [{ re: [{ '%or': ['Boolean', null] }], writes: false }],
        contenteditable: [{ re: [{ '%or': ['Text', null] }], writes: false }],
        spellcheck: [{ re: [{ '%or': ['Boolean', null] }], writes: false }],
        inert: [{ re: [{ '%or': ['Boolean', null] }], writes: false }],
        autofocus: [{ re: [{ '%or': ['Boolean', null] }], writes: false }],
        autocapitalize: [{ re: [{ '%or': ['Text', null] }], writes: false }],
        autocorrect: [{ re: [{ '%or': ['Text', null] }], writes: false }],
        inputmode: [{ re: [{ '%or': ['Text', null] }], writes: false }],
        enterkeyhint: [{ re: [{ '%or': ['Text', null] }], writes: false }],
        is: [{ re: [{ '%or': ['Text', null] }], writes: false }],
        nonce: [{ re: [{ '%or': ['Text', null] }], writes: false }],
        popover: [{ re: [{ '%or': ['Text', null] }], writes: false }],
        slot: [{ re: [{ '%or': ['Text', null] }], writes: false }],
        part: [{ re: [{ '%or': ['Text', null] }], writes: false }],
        exportparts: [{ re: [{ '%or': ['Text', null] }], writes: false }],
        itemid: [{ re: [{ '%or': ['Text', null] }], writes: false }],
        itemprop: [{ re: [{ '%or': ['Text', null] }], writes: false }],
        itemref: [{ re: [{ '%or': ['Text', null] }], writes: false }],
        itemscope: [{ re: [{ '%or': ['Boolean', null] }], writes: false }],
        itemtype: [{ re: [{ '%or': ['Text', null] }], writes: false }],
        writingsuggestions: [{ re: [{ '%or': ['Text', null] }], writes: false }],
        virtualkeyboardpolicy: [{ re: [{ '%or': ['Text', null] }], writes: false }],
        aria: [{ re: [{ '%or': [':Aria:*', null] }], writes: false }],
        class_list: [{ re: [':ClassList:*'], writes: false }],
        dataset: [{ re: [':Dataset:*'], writes: false }],
        outer_html: [{ re: ['Text'], writes: false }],
        outer_text: [{ re: ['Text'], writes: false }],
        tag_name: [{ re: ['Text'], writes: false }],
        local_name: [{ re: ['Text'], writes: false }],
        namespace_uri: [{ re: [{ '%or': ['Text', null] }], writes: false }],
        prefix: [{ re: [{ '%or': ['Text', null] }], writes: false }],
        children: [{ re: [[['Elements'], { '%t': 'List' }]], writes: false }],
        first_element_child: [{ re: [{ '%or': [':Element:*', null] }], writes: false }],
        last_element_child: [{ re: [{ '%or': [':Element:*', null] }], writes: false }],
        next_element_sibling: [{ re: [{ '%or': [':Element:*', null] }], writes: false }],
        previous_element_sibling: [{ re: [{ '%or': [':Element:*', null] }], writes: false }],
        child_element_count: [{ re: ['Integer'], writes: false }],
        has_attributes: [{ re: ['Boolean'], writes: false }],
        get_attribute_names: [{ re: [[['Text'], { '%t': 'List' }]], writes: false }],
        get_attribute: [
          { args: ['Text'], re: [{ '%or': ['Text', null] }], writes: false },
          { args: [{ name: 'Text' }], re: [{ '%or': ['Text', null] }], writes: false },
        ],
        has_attribute: [
          { args: ['Text'], re: ['Boolean'], writes: false },
          { args: [{ name: 'Text' }], re: ['Boolean'], writes: false },
        ],
        'set_attribute!': [
          { args: ['Text', 'Text'], re: [{ '%self': true }], writes: true },
          { args: [{ name: 'Text', value: 'Text' }], re: [{ '%self': true }], writes: true },
        ],
        'remove_attribute!': [
          { args: ['Text'], re: [{ '%self': true }], writes: true },
          { args: [{ name: 'Text' }], re: [{ '%self': true }], writes: true },
        ],
        'toggle_attribute!': [
          { args: ['Text'], re: [{ '%self': true }], writes: true },
          { args: ['Text', 'Boolean'], re: [{ '%self': true }], writes: true },
          {
            args: [{ name: 'Text', force: { '%opt': 'Boolean' } }],
            re: [{ '%self': true }],
            writes: true,
          },
        ],
        query_selector: [
          { args: ['Text'], re: [{ '%or': [':Element:*', null] }], writes: false },
          { args: [{ selector: 'Text' }], re: [{ '%or': [':Element:*', null] }], writes: false },
        ],
        query_selector_all: [
          { args: ['Text'], re: [[['Elements'], { '%t': 'List' }]], writes: false },
          { args: [{ selector: 'Text' }], re: [[['Elements'], { '%t': 'List' }]], writes: false },
        ],
        closest: [
          { args: ['Text'], re: [{ '%or': [':Element:*', null] }], writes: false },
          { args: [{ selector: 'Text' }], re: [{ '%or': [':Element:*', null] }], writes: false },
        ],
        matches: [
          { args: ['Text'], re: ['Boolean'], writes: false },
          { args: [{ selector: 'Text' }], re: ['Boolean'], writes: false },
        ],
        get_elements_by_tag_name: [
          { args: ['Text'], re: [[['Elements'], { '%t': 'List' }]], writes: false },
          { args: [{ name: 'Text' }], re: [[['Elements'], { '%t': 'List' }]], writes: false },
        ],
        get_elements_by_class_name: [
          { args: ['Text'], re: [[['Elements'], { '%t': 'List' }]], writes: false },
          { args: [{ names: 'Text' }], re: [[['Elements'], { '%t': 'List' }]], writes: false },
        ],
        client_width: [{ re: ['Integer'], writes: false }],
        client_height: [{ re: ['Integer'], writes: false }],
        client_top: [{ re: ['Integer'], writes: false }],
        client_left: [{ re: ['Integer'], writes: false }],
        offset_width: [{ re: ['Integer'], writes: false }],
        offset_height: [{ re: ['Integer'], writes: false }],
        offset_top: [{ re: ['Integer'], writes: false }],
        offset_left: [{ re: ['Integer'], writes: false }],
        offset_parent: [{ re: [{ '%or': [':Element:*', null] }], writes: false }],
        scroll_width: [{ re: ['Integer'], writes: false }],
        scroll_height: [{ re: ['Integer'], writes: false }],
        scroll_top: [{ re: ['Decimal'], writes: false }],
        scroll_left: [{ re: ['Decimal'], writes: false }],
        bounding_client_rect: [{ re: ['Object'], writes: false }],
        client_rects: [{ re: [[['Objects'], { '%t': 'List' }]], writes: false }],
        'focus!': [
          { re: [{ '%self': true }], writes: true },
          {
            args: [{ prevent_scroll: { '%opt': 'Boolean' } }],
            re: [{ '%self': true }],
            writes: true,
          },
        ],
        'blur!': [{ re: [{ '%self': true }], writes: true }],
        'click!': [{ re: [{ '%self': true }], writes: true }],
        'scroll!': [
          { args: ['Decimal', 'Decimal'], re: [{ '%self': true }], writes: true },
          {
            args: [
              {
                left: { '%opt': 'Decimal' },
                top: { '%opt': 'Decimal' },
                behavior: { '%opt': 'Text' },
              },
            ],
            re: [{ '%self': true }],
            writes: true,
          },
        ],
        'scroll_to!': [
          { args: ['Decimal', 'Decimal'], re: [{ '%self': true }], writes: true },
          {
            args: [
              {
                left: { '%opt': 'Decimal' },
                top: { '%opt': 'Decimal' },
                behavior: { '%opt': 'Text' },
              },
            ],
            re: [{ '%self': true }],
            writes: true,
          },
        ],
        'scroll_by!': [
          { args: ['Decimal', 'Decimal'], re: [{ '%self': true }], writes: true },
          {
            args: [
              {
                left: { '%opt': 'Decimal' },
                top: { '%opt': 'Decimal' },
                behavior: { '%opt': 'Text' },
              },
            ],
            re: [{ '%self': true }],
            writes: true,
          },
        ],
        'scroll_into_view!': [
          { re: [{ '%self': true }], writes: true },
          { args: ['Boolean'], re: [{ '%self': true }], writes: true },
          {
            args: [
              {
                behavior: { '%opt': 'Text' },
                block: { '%opt': 'Text' },
                inline: { '%opt': 'Text' },
              },
            ],
            re: [{ '%self': true }],
            writes: true,
          },
        ],
        'before!': [
          { args: [[['Anything'], { '%t': 'List' }]], re: [{ '%self': true }], writes: true },
          {
            args: [{ items: [['Anything'], { '%t': 'List' }] }],
            re: [{ '%self': true }],
            writes: true,
          },
        ],
        'after!': [
          { args: [[['Anything'], { '%t': 'List' }]], re: [{ '%self': true }], writes: true },
          {
            args: [{ items: [['Anything'], { '%t': 'List' }] }],
            re: [{ '%self': true }],
            writes: true,
          },
        ],
        'replace_with!': [
          { args: [[['Anything'], { '%t': 'List' }]], re: [{ '%self': true }], writes: true },
          {
            args: [{ items: [['Anything'], { '%t': 'List' }] }],
            re: [{ '%self': true }],
            writes: true,
          },
        ],
        'remove!': [{ re: [{ '%self': true }], writes: true }],
        'insert_adjacent_element!': [
          {
            args: [{ position: 'Text', element: ':Element:*' }],
            re: [{ '%self': true }],
            writes: true,
          },
        ],
        'insert_adjacent_text!': [{ args: [{ position: 'Text', text: 'Text' }], re: [{ '%self': true }], writes: true }],
        'insert_adjacent_html!': [{ args: [{ position: 'Text', html: 'Text' }], re: [{ '%self': true }], writes: true }],
      },
    },
  },
  ':Aria': {
    public: {
      $new: [
        {
          args: [
            {
              role: { '%opt': 'Text' },
              label: { '%opt': 'Text' },
              labelledby: { '%opt': 'Text' },
              describedby: { '%opt': 'Text' },
              description: { '%opt': 'Text' },
              details: { '%opt': 'Text' },
              hidden: { '%opt': 'Boolean' },
              disabled: { '%opt': 'Boolean' },
              readonly: { '%opt': 'Boolean' },
              required: { '%opt': 'Boolean' },
              invalid: { '%opt': 'Text' },
              errormessage: { '%opt': 'Text' },
              checked: { '%opt': 'Text' },
              pressed: { '%opt': 'Text' },
              selected: { '%opt': 'Boolean' },
              expanded: { '%opt': 'Boolean' },
              busy: { '%opt': 'Boolean' },
              live: { '%opt': 'Text' },
              atomic: { '%opt': 'Boolean' },
              relevant: { '%opt': 'Text' },
              current: { '%opt': 'Text' },
              haspopup: { '%opt': 'Text' },
              level: { '%opt': 'Integer' },
              modal: { '%opt': 'Boolean' },
              multiline: { '%opt': 'Boolean' },
              multiselectable: { '%opt': 'Boolean' },
              orientation: { '%opt': 'Text' },
              placeholder: { '%opt': 'Text' },
              sort: { '%opt': 'Text' },
              valuemax: { '%opt': 'Decimal' },
              valuemin: { '%opt': 'Decimal' },
              valuenow: { '%opt': 'Decimal' },
              valuetext: { '%opt': 'Text' },
              autocomplete: { '%opt': 'Text' },
              keyshortcuts: { '%opt': 'Text' },
              roledescription: { '%opt': 'Text' },
              activedescendant: { '%opt': 'Text' },
              controls: { '%opt': 'Text' },
              flowto: { '%opt': 'Text' },
              owns: { '%opt': 'Text' },
              colcount: { '%opt': 'Integer' },
              colindex: { '%opt': 'Integer' },
              colspan: { '%opt': 'Integer' },
              rowcount: { '%opt': 'Integer' },
              rowindex: { '%opt': 'Integer' },
              rowspan: { '%opt': 'Integer' },
              posinset: { '%opt': 'Integer' },
              setsize: { '%opt': 'Integer' },
            },
          ],
          re: [':Aria:*'],
          writes: false,
        },
      ],
    },
    ':*': {
      public: {
        role: [{ re: [{ '%or': ['Text', null] }], writes: false }],
        label: [{ re: [{ '%or': ['Text', null] }], writes: false }],
        labelledby: [{ re: [{ '%or': ['Text', null] }], writes: false }],
        describedby: [{ re: [{ '%or': ['Text', null] }], writes: false }],
        description: [{ re: [{ '%or': ['Text', null] }], writes: false }],
        details: [{ re: [{ '%or': ['Text', null] }], writes: false }],
        hidden: [{ re: [{ '%or': ['Boolean', null] }], writes: false }],
        disabled: [{ re: [{ '%or': ['Boolean', null] }], writes: false }],
        readonly: [{ re: [{ '%or': ['Boolean', null] }], writes: false }],
        required: [{ re: [{ '%or': ['Boolean', null] }], writes: false }],
        invalid: [{ re: [{ '%or': ['Text', null] }], writes: false }],
        errormessage: [{ re: [{ '%or': ['Text', null] }], writes: false }],
        checked: [{ re: [{ '%or': ['Text', null] }], writes: false }],
        pressed: [{ re: [{ '%or': ['Text', null] }], writes: false }],
        selected: [{ re: [{ '%or': ['Boolean', null] }], writes: false }],
        expanded: [{ re: [{ '%or': ['Boolean', null] }], writes: false }],
        busy: [{ re: [{ '%or': ['Boolean', null] }], writes: false }],
        live: [{ re: [{ '%or': ['Text', null] }], writes: false }],
        atomic: [{ re: [{ '%or': ['Boolean', null] }], writes: false }],
        relevant: [{ re: [{ '%or': ['Text', null] }], writes: false }],
        current: [{ re: [{ '%or': ['Text', null] }], writes: false }],
        haspopup: [{ re: [{ '%or': ['Text', null] }], writes: false }],
        level: [{ re: [{ '%or': ['Integer', null] }], writes: false }],
        modal: [{ re: [{ '%or': ['Boolean', null] }], writes: false }],
        multiline: [{ re: [{ '%or': ['Boolean', null] }], writes: false }],
        multiselectable: [{ re: [{ '%or': ['Boolean', null] }], writes: false }],
        orientation: [{ re: [{ '%or': ['Text', null] }], writes: false }],
        placeholder: [{ re: [{ '%or': ['Text', null] }], writes: false }],
        sort: [{ re: [{ '%or': ['Text', null] }], writes: false }],
        valuemax: [{ re: [{ '%or': ['Decimal', null] }], writes: false }],
        valuemin: [{ re: [{ '%or': ['Decimal', null] }], writes: false }],
        valuenow: [{ re: [{ '%or': ['Decimal', null] }], writes: false }],
        valuetext: [{ re: [{ '%or': ['Text', null] }], writes: false }],
        autocomplete: [{ re: [{ '%or': ['Text', null] }], writes: false }],
        keyshortcuts: [{ re: [{ '%or': ['Text', null] }], writes: false }],
        roledescription: [{ re: [{ '%or': ['Text', null] }], writes: false }],
        activedescendant: [{ re: [{ '%or': ['Text', null] }], writes: false }],
        controls: [{ re: [{ '%or': ['Text', null] }], writes: false }],
        flowto: [{ re: [{ '%or': ['Text', null] }], writes: false }],
        owns: [{ re: [{ '%or': ['Text', null] }], writes: false }],
        colcount: [{ re: [{ '%or': ['Integer', null] }], writes: false }],
        colindex: [{ re: [{ '%or': ['Integer', null] }], writes: false }],
        colspan: [{ re: [{ '%or': ['Integer', null] }], writes: false }],
        rowcount: [{ re: [{ '%or': ['Integer', null] }], writes: false }],
        rowindex: [{ re: [{ '%or': ['Integer', null] }], writes: false }],
        rowspan: [{ re: [{ '%or': ['Integer', null] }], writes: false }],
        posinset: [{ re: [{ '%or': ['Integer', null] }], writes: false }],
        setsize: [{ re: [{ '%or': ['Integer', null] }], writes: false }],
      },
    },
  },
  ':ClassList': {
    public: { $new: [{ re: [':ClassList:*'], writes: false }] },
    ':*': {
      ':value': { public: { $set: [{ args: ['Text'], writes: true }] } },
      public: {
        length: [{ re: ['Integer'], writes: false }],
        value: [{ re: ['Text'], writes: false }],
        item: [
          { args: ['Integer'], re: [{ '%or': ['Text', null] }], writes: false },
          { args: [{ index: 'Integer' }], re: [{ '%or': ['Text', null] }], writes: false },
        ],
        contains: [
          { args: ['Text'], re: ['Boolean'], writes: false },
          { args: [{ token: 'Text' }], re: ['Boolean'], writes: false },
        ],
        'add!': [
          { args: ['Text'], re: [{ '%self': true }], writes: true },
          { args: [[['Text'], { '%t': 'List' }]], re: [{ '%self': true }], writes: true },
          {
            args: [{ tokens: [['Text'], { '%t': 'List' }] }],
            re: [{ '%self': true }],
            writes: true,
          },
        ],
        'remove!': [
          { args: ['Text'], re: [{ '%self': true }], writes: true },
          { args: [[['Text'], { '%t': 'List' }]], re: [{ '%self': true }], writes: true },
          {
            args: [{ tokens: [['Text'], { '%t': 'List' }] }],
            re: [{ '%self': true }],
            writes: true,
          },
        ],
        'toggle!': [
          { args: ['Text'], re: ['Boolean'], writes: true },
          { args: ['Text', 'Boolean'], re: ['Boolean'], writes: true },
          {
            args: [{ token: 'Text', force: { '%opt': 'Boolean' } }],
            re: ['Boolean'],
            writes: true,
          },
        ],
        'replace!': [
          { args: ['Text', 'Text'], re: ['Boolean'], writes: true },
          { args: [{ old_token: 'Text', new_token: 'Text' }], re: ['Boolean'], writes: true },
        ],
      },
    },
  },
  ':Dataset': {
    public: { $new: [{ re: [':Dataset:*'], writes: false }] },
    ':*': {
      public: {
        size: [{ re: ['Integer'], writes: false }],
        has: [
          { args: ['Text'], re: ['Boolean'], writes: false },
          { args: [{ key: 'Text' }], re: ['Boolean'], writes: false },
        ],
        get: [
          { args: ['Text'], re: [{ '%or': ['Text', null] }], writes: false },
          { args: [{ key: 'Text' }], re: [{ '%or': ['Text', null] }], writes: false },
        ],
        'put!': [
          { args: ['Text', 'Text'], re: [{ '%self': true }], writes: true },
          { args: [{ key: 'Text', value: 'Text' }], re: [{ '%self': true }], writes: true },
        ],
        'remove!': [
          { args: ['Text'], re: [{ '%self': true }], writes: true },
          { args: [{ key: 'Text' }], re: [{ '%self': true }], writes: true },
        ],
        keys: [{ re: [[['Text'], { '%t': 'List' }]], writes: false }],
        values: [{ re: [[['Text'], { '%t': 'List' }]], writes: false }],
        entries: [{ re: [[['Objects'], { '%t': 'List' }]], writes: false }],
      },
    },
  },
  ':TextElement': {
    extends: [':Element'],
    public: {
      $new: [
        {
          args: [{ ...ELEMENT_ARGS, children: { '%opt': [['Text'], { '%t': 'List' }] } }],
          re: [':TextElement:*'],
          writes: false,
        },
      ],
    },
    ':*': {
      ':inner_html': { public: { $set: [{ args: ['Text'], writes: true }] } },
      ':text_content': { public: { $set: [{ args: ['Text'], writes: true }] } },
      ':inner_text': { public: { $set: [{ args: ['Text'], writes: true }] } },
      public: {
        inner_html: [{ re: ['Text'], writes: false }],
        text_content: [{ re: ['Text'], writes: false }],
        inner_text: [{ re: ['Text'], writes: false }],
        'append!': [
          { args: ['Text'], re: [{ '%self': true }], writes: true },
          { args: [[['Text'], { '%t': 'List' }]], re: [{ '%self': true }], writes: true },
          {
            args: [{ items: [['Text'], { '%t': 'List' }] }],
            re: [{ '%self': true }],
            writes: true,
          },
        ],
        'prepend!': [
          { args: ['Text'], re: [{ '%self': true }], writes: true },
          { args: [[['Text'], { '%t': 'List' }]], re: [{ '%self': true }], writes: true },
          {
            args: [{ items: [['Text'], { '%t': 'List' }] }],
            re: [{ '%self': true }],
            writes: true,
          },
        ],
        'replace_children!': [
          { args: ['Text'], re: [{ '%self': true }], writes: true },
          { args: [[['Text'], { '%t': 'List' }]], re: [{ '%self': true }], writes: true },
          {
            args: [{ items: [['Text'], { '%t': 'List' }] }],
            re: [{ '%self': true }],
            writes: true,
          },
        ],
        'insert_adjacent_text!': [{ args: [{ position: 'Text', text: 'Text' }], re: [{ '%self': true }], writes: true }],
        'insert_adjacent_html!': [{ args: [{ position: 'Text', html: 'Text' }], re: [{ '%self': true }], writes: true }],
      },
    },
  },
  ':ParentElement': {
    extends: [':Element'],
    public: {
      $new: [
        {
          args: [{ ...ELEMENT_ARGS, children: { '%opt': [['Anything'], { '%t': 'List' }] } }],
          re: [':ParentElement:*'],
          writes: false,
        },
      ],
    },
    ':*': {
      ':inner_html': { public: { $set: [{ args: ['Text'], writes: true }] } },
      ':text_content': { public: { $set: [{ args: ['Text'], writes: true }] } },
      ':inner_text': { public: { $set: [{ args: ['Text'], writes: true }] } },
      public: {
        inner_html: [{ re: ['Text'], writes: false }],
        text_content: [{ re: ['Text'], writes: false }],
        inner_text: [{ re: ['Text'], writes: false }],
        'append_child!': [
          { args: [':Element:*'], re: [{ '%self': true }], writes: true },
          { args: [{ child: ':Element:*' }], re: [{ '%self': true }], writes: true },
        ],
        'insert_before!': [
          { args: [':Element:*', { '%opt': ':Element:*' }], re: [{ '%self': true }], writes: true },
          {
            args: [{ new_child: ':Element:*', ref_child: { '%opt': ':Element:*' } }],
            re: [{ '%self': true }],
            writes: true,
          },
        ],
        'remove_child!': [
          { args: [':Element:*'], re: [{ '%self': true }], writes: true },
          { args: [{ child: ':Element:*' }], re: [{ '%self': true }], writes: true },
        ],
        'replace_child!': [
          { args: [':Element:*', ':Element:*'], re: [{ '%self': true }], writes: true },
          {
            args: [{ new_child: ':Element:*', old_child: ':Element:*' }],
            re: [{ '%self': true }],
            writes: true,
          },
        ],
        'append!': [
          { args: [':Element:*'], re: [{ '%self': true }], writes: true },
          { args: ['Text'], re: [{ '%self': true }], writes: true },
          { args: [[['Anything'], { '%t': 'List' }]], re: [{ '%self': true }], writes: true },
          {
            args: [{ items: [['Anything'], { '%t': 'List' }] }],
            re: [{ '%self': true }],
            writes: true,
          },
        ],
        'prepend!': [
          { args: [':Element:*'], re: [{ '%self': true }], writes: true },
          { args: ['Text'], re: [{ '%self': true }], writes: true },
          { args: [[['Anything'], { '%t': 'List' }]], re: [{ '%self': true }], writes: true },
          {
            args: [{ items: [['Anything'], { '%t': 'List' }] }],
            re: [{ '%self': true }],
            writes: true,
          },
        ],
        'replace_children!': [
          { args: [':Element:*'], re: [{ '%self': true }], writes: true },
          { args: ['Text'], re: [{ '%self': true }], writes: true },
          { args: [[['Anything'], { '%t': 'List' }]], re: [{ '%self': true }], writes: true },
          {
            args: [{ items: [['Anything'], { '%t': 'List' }] }],
            re: [{ '%self': true }],
            writes: true,
          },
        ],
        'insert_adjacent_element!': [
          {
            args: [{ position: 'Text', element: ':Element:*' }],
            re: [{ '%self': true }],
            writes: true,
          },
        ],
        'insert_adjacent_text!': [{ args: [{ position: 'Text', text: 'Text' }], re: [{ '%self': true }], writes: true }],
        'insert_adjacent_html!': [{ args: [{ position: 'Text', html: 'Text' }], re: [{ '%self': true }], writes: true }],
      },
    },
  },
  ':html': {
    extends: [':ParentElement'],
    public: {
      $new: [
        {
          args: [{ ...ELEMENT_ARGS, children: { '%opt': [['Anything'], { '%t': 'List' }] } }],
          re: [':html:*'],
          writes: false,
        },
      ],
    },
    ':*': {},
  },
  ':head': {
    extends: [':ParentElement'],
    public: {
      $new: [
        {
          args: [{ ...ELEMENT_ARGS, children: { '%opt': [['Anything'], { '%t': 'List' }] } }],
          re: [':head:*'],
          writes: false,
        },
      ],
    },
    ':*': {},
  },
  ':style': {
    extends: [':TextElement'],
    public: {
      $new: [
        {
          args: [
            {
              ...ELEMENT_ARGS,
              children: { '%opt': [['Text'], { '%t': 'List' }] },
              media: { '%opt': 'Text' },
            },
          ],
          re: [':style:*'],
          writes: false,
        },
      ],
    },
    ':*': { public: { media: [{ re: [{ '%or': ['Text', null] }], writes: false }] } },
  },
  ':body': {
    extends: [':ParentElement'],
    public: {
      $new: [
        {
          args: [{ ...ELEMENT_ARGS, children: { '%opt': [['Anything'], { '%t': 'List' }] } }],
          re: [':body:*'],
          writes: false,
        },
      ],
    },
    ':*': {},
  },
  ':header': {
    extends: [':ParentElement'],
    public: {
      $new: [
        {
          args: [{ ...ELEMENT_ARGS, children: { '%opt': [['Anything'], { '%t': 'List' }] } }],
          re: [':header:*'],
          writes: false,
        },
      ],
    },
    ':*': {},
  },
  ':footer': {
    extends: [':ParentElement'],
    public: {
      $new: [
        {
          args: [{ ...ELEMENT_ARGS, children: { '%opt': [['Anything'], { '%t': 'List' }] } }],
          re: [':footer:*'],
          writes: false,
        },
      ],
    },
    ':*': {},
  },
  ':main': {
    extends: [':ParentElement'],
    public: {
      $new: [
        {
          args: [{ ...ELEMENT_ARGS, children: { '%opt': [['Anything'], { '%t': 'List' }] } }],
          re: [':main:*'],
          writes: false,
        },
      ],
    },
    ':*': {},
  },
  ':nav': {
    extends: [':ParentElement'],
    public: {
      $new: [
        {
          args: [{ ...ELEMENT_ARGS, children: { '%opt': [['Anything'], { '%t': 'List' }] } }],
          re: [':nav:*'],
          writes: false,
        },
      ],
    },
    ':*': {},
  },
  ':section': {
    extends: [':ParentElement'],
    public: {
      $new: [
        {
          args: [{ ...ELEMENT_ARGS, children: { '%opt': [['Anything'], { '%t': 'List' }] } }],
          re: [':section:*'],
          writes: false,
        },
      ],
    },
    ':*': {},
  },
  ':article': {
    extends: [':ParentElement'],
    public: {
      $new: [
        {
          args: [{ ...ELEMENT_ARGS, children: { '%opt': [['Anything'], { '%t': 'List' }] } }],
          re: [':article:*'],
          writes: false,
        },
      ],
    },
    ':*': {},
  },
  ':aside': {
    extends: [':ParentElement'],
    public: {
      $new: [
        {
          args: [{ ...ELEMENT_ARGS, children: { '%opt': [['Anything'], { '%t': 'List' }] } }],
          re: [':aside:*'],
          writes: false,
        },
      ],
    },
    ':*': {},
  },
  ':h1': {
    extends: [':ParentElement'],
    public: {
      $new: [
        {
          args: [{ ...ELEMENT_ARGS, children: { '%opt': [['Anything'], { '%t': 'List' }] } }],
          re: [':h1:*'],
          writes: false,
        },
      ],
    },
    ':*': {},
  },
  ':h2': {
    extends: [':ParentElement'],
    public: {
      $new: [
        {
          args: [{ ...ELEMENT_ARGS, children: { '%opt': [['Anything'], { '%t': 'List' }] } }],
          re: [':h2:*'],
          writes: false,
        },
      ],
    },
    ':*': {},
  },
  ':h3': {
    extends: [':ParentElement'],
    public: {
      $new: [
        {
          args: [{ ...ELEMENT_ARGS, children: { '%opt': [['Anything'], { '%t': 'List' }] } }],
          re: [':h3:*'],
          writes: false,
        },
      ],
    },
    ':*': {},
  },
  ':h4': {
    extends: [':ParentElement'],
    public: {
      $new: [
        {
          args: [{ ...ELEMENT_ARGS, children: { '%opt': [['Anything'], { '%t': 'List' }] } }],
          re: [':h4:*'],
          writes: false,
        },
      ],
    },
    ':*': {},
  },
  ':h5': {
    extends: [':ParentElement'],
    public: {
      $new: [
        {
          args: [{ ...ELEMENT_ARGS, children: { '%opt': [['Anything'], { '%t': 'List' }] } }],
          re: [':h5:*'],
          writes: false,
        },
      ],
    },
    ':*': {},
  },
  ':h6': {
    extends: [':ParentElement'],
    public: {
      $new: [
        {
          args: [{ ...ELEMENT_ARGS, children: { '%opt': [['Anything'], { '%t': 'List' }] } }],
          re: [':h6:*'],
          writes: false,
        },
      ],
    },
    ':*': {},
  },
  ':div': {
    extends: [':ParentElement'],
    public: {
      $new: [
        {
          args: [{ ...ELEMENT_ARGS, children: { '%opt': [['Anything'], { '%t': 'List' }] } }],
          re: [':div:*'],
          writes: false,
        },
      ],
    },
    ':*': {},
  },
  ':p': {
    extends: [':ParentElement'],
    public: {
      $new: [
        {
          args: [{ ...ELEMENT_ARGS, children: { '%opt': [['Anything'], { '%t': 'List' }] } }],
          re: [':p:*'],
          writes: false,
        },
      ],
    },
    ':*': {},
  },
  ':span': {
    extends: [':ParentElement'],
    public: {
      $new: [
        {
          args: [{ ...ELEMENT_ARGS, children: { '%opt': [['Anything'], { '%t': 'List' }] } }],
          re: [':span:*'],
          writes: false,
        },
      ],
    },
    ':*': {},
  },
  ':pre': {
    extends: [':ParentElement'],
    public: {
      $new: [
        {
          args: [{ ...ELEMENT_ARGS, children: { '%opt': [['Anything'], { '%t': 'List' }] } }],
          re: [':pre:*'],
          writes: false,
        },
      ],
    },
    ':*': {},
  },
  ':hr': {
    extends: [':Element'],
    public: { $new: [{ args: [{ ...ELEMENT_ARGS }], re: [':hr:*'], writes: false }] },
    ':*': {},
  },
  ':br': {
    extends: [':Element'],
    public: { $new: [{ args: [{ ...ELEMENT_ARGS }], re: [':br:*'], writes: false }] },
    ':*': {},
  },
  ':blockquote': {
    extends: [':ParentElement'],
    public: {
      $new: [
        {
          args: [
            {
              ...ELEMENT_ARGS,
              children: { '%opt': [['Anything'], { '%t': 'List' }] },
              cite: { '%opt': 'Text' },
            },
          ],
          re: [':blockquote:*'],
          writes: false,
        },
      ],
    },
    ':*': { public: { cite: [{ re: [{ '%or': ['Text', null] }], writes: false }] } },
  },
  ':a': {
    extends: [':ParentElement'],
    public: {
      $new: [
        {
          args: [
            {
              ...ELEMENT_ARGS,
              children: { '%opt': [['Anything'], { '%t': 'List' }] },
              href: { '%opt': 'Text' },
              target: { '%opt': 'Text' },
              rel: { '%opt': 'Text' },
              download: { '%opt': { '%or': ['Boolean', 'Text'] } },
              type: { '%opt': 'Text' },
              hreflang: { '%opt': 'Text' },
              ping: { '%opt': 'Text' },
              referrerpolicy: { '%opt': 'Text' },
            },
          ],
          re: [':a:*'],
          writes: false,
        },
      ],
    },
    ':*': {
      public: {
        href: [{ re: [{ '%or': ['Text', null] }], writes: false }],
        target: [{ re: [{ '%or': ['Text', null] }], writes: false }],
        rel: [{ re: [{ '%or': ['Text', null] }], writes: false }],
        download: [{ re: [{ '%or': ['Text', null] }], writes: false }],
        type: [{ re: [{ '%or': ['Text', null] }], writes: false }],
        hreflang: [{ re: [{ '%or': ['Text', null] }], writes: false }],
        ping: [{ re: [{ '%or': ['Text', null] }], writes: false }],
        referrerpolicy: [{ re: [{ '%or': ['Text', null] }], writes: false }],
      },
    },
  },
  ':em': {
    extends: [':ParentElement'],
    public: {
      $new: [
        {
          args: [{ ...ELEMENT_ARGS, children: { '%opt': [['Anything'], { '%t': 'List' }] } }],
          re: [':em:*'],
          writes: false,
        },
      ],
    },
    ':*': {},
  },
  ':strong': {
    extends: [':ParentElement'],
    public: {
      $new: [
        {
          args: [{ ...ELEMENT_ARGS, children: { '%opt': [['Anything'], { '%t': 'List' }] } }],
          re: [':strong:*'],
          writes: false,
        },
      ],
    },
    ':*': {},
  },
  ':code': {
    extends: [':ParentElement'],
    public: {
      $new: [
        {
          args: [{ ...ELEMENT_ARGS, children: { '%opt': [['Anything'], { '%t': 'List' }] } }],
          re: [':code:*'],
          writes: false,
        },
      ],
    },
    ':*': {},
  },
  ':mark': {
    extends: [':ParentElement'],
    public: {
      $new: [
        {
          args: [{ ...ELEMENT_ARGS, children: { '%opt': [['Anything'], { '%t': 'List' }] } }],
          re: [':mark:*'],
          writes: false,
        },
      ],
    },
    ':*': {},
  },
  ':small': {
    extends: [':ParentElement'],
    public: {
      $new: [
        {
          args: [{ ...ELEMENT_ARGS, children: { '%opt': [['Anything'], { '%t': 'List' }] } }],
          re: [':small:*'],
          writes: false,
        },
      ],
    },
    ':*': {},
  },
  ':ul': {
    extends: [':ParentElement'],
    public: {
      $new: [
        {
          args: [{ ...ELEMENT_ARGS, children: { '%opt': [['Anything'], { '%t': 'List' }] } }],
          re: [':ul:*'],
          writes: false,
        },
      ],
    },
    ':*': {},
  },
  ':ol': {
    extends: [':ParentElement'],
    public: {
      $new: [
        {
          args: [
            {
              ...ELEMENT_ARGS,
              children: { '%opt': [['Anything'], { '%t': 'List' }] },
              type: { '%opt': 'Text' },
              start: { '%opt': 'Integer' },
              reversed: { '%opt': 'Boolean' },
            },
          ],
          re: [':ol:*'],
          writes: false,
        },
      ],
    },
    ':*': {
      public: {
        type: [{ re: [{ '%or': ['Text', null] }], writes: false }],
        start: [{ re: [{ '%or': ['Integer', null] }], writes: false }],
        reversed: [{ re: [{ '%or': ['Boolean', null] }], writes: false }],
      },
    },
  },
  ':li': {
    extends: [':ParentElement'],
    public: {
      $new: [
        {
          args: [
            {
              ...ELEMENT_ARGS,
              children: { '%opt': [['Anything'], { '%t': 'List' }] },
              value: { '%opt': 'Integer' },
            },
          ],
          re: [':li:*'],
          writes: false,
        },
      ],
    },
    ':*': { public: { value: [{ re: [{ '%or': ['Integer', null] }], writes: false }] } },
  },
  ':dl': {
    extends: [':ParentElement'],
    public: {
      $new: [
        {
          args: [{ ...ELEMENT_ARGS, children: { '%opt': [['Anything'], { '%t': 'List' }] } }],
          re: [':dl:*'],
          writes: false,
        },
      ],
    },
    ':*': {},
  },
  ':dt': {
    extends: [':ParentElement'],
    public: {
      $new: [
        {
          args: [{ ...ELEMENT_ARGS, children: { '%opt': [['Anything'], { '%t': 'List' }] } }],
          re: [':dt:*'],
          writes: false,
        },
      ],
    },
    ':*': {},
  },
  ':dd': {
    extends: [':ParentElement'],
    public: {
      $new: [
        {
          args: [{ ...ELEMENT_ARGS, children: { '%opt': [['Anything'], { '%t': 'List' }] } }],
          re: [':dd:*'],
          writes: false,
        },
      ],
    },
    ':*': {},
  },
  ':table': {
    extends: [':ParentElement'],
    public: {
      $new: [
        {
          args: [{ ...ELEMENT_ARGS, children: { '%opt': [['Anything'], { '%t': 'List' }] } }],
          re: [':table:*'],
          writes: false,
        },
      ],
    },
    ':*': {},
  },
  ':thead': {
    extends: [':ParentElement'],
    public: {
      $new: [
        {
          args: [{ ...ELEMENT_ARGS, children: { '%opt': [['Anything'], { '%t': 'List' }] } }],
          re: [':thead:*'],
          writes: false,
        },
      ],
    },
    ':*': {},
  },
  ':tbody': {
    extends: [':ParentElement'],
    public: {
      $new: [
        {
          args: [{ ...ELEMENT_ARGS, children: { '%opt': [['Anything'], { '%t': 'List' }] } }],
          re: [':tbody:*'],
          writes: false,
        },
      ],
    },
    ':*': {},
  },
  ':tr': {
    extends: [':ParentElement'],
    public: {
      $new: [
        {
          args: [{ ...ELEMENT_ARGS, children: { '%opt': [['Anything'], { '%t': 'List' }] } }],
          re: [':tr:*'],
          writes: false,
        },
      ],
    },
    ':*': {},
  },
  ':td': {
    extends: [':ParentElement'],
    public: {
      $new: [
        {
          args: [
            {
              ...ELEMENT_ARGS,
              children: { '%opt': [['Anything'], { '%t': 'List' }] },
              colspan: { '%opt': 'Integer' },
              rowspan: { '%opt': 'Integer' },
              headers: { '%opt': 'Text' },
            },
          ],
          re: [':td:*'],
          writes: false,
        },
      ],
    },
    ':*': {
      public: {
        colspan: [{ re: [{ '%or': ['Integer', null] }], writes: false }],
        rowspan: [{ re: [{ '%or': ['Integer', null] }], writes: false }],
        headers: [{ re: [{ '%or': ['Text', null] }], writes: false }],
      },
    },
  },
  ':th': {
    extends: [':ParentElement'],
    public: {
      $new: [
        {
          args: [
            {
              ...ELEMENT_ARGS,
              children: { '%opt': [['Anything'], { '%t': 'List' }] },
              colspan: { '%opt': 'Integer' },
              rowspan: { '%opt': 'Integer' },
              headers: { '%opt': 'Text' },
              scope: { '%opt': 'Text' },
              abbr: { '%opt': 'Text' },
            },
          ],
          re: [':th:*'],
          writes: false,
        },
      ],
    },
    ':*': {
      public: {
        colspan: [{ re: [{ '%or': ['Integer', null] }], writes: false }],
        rowspan: [{ re: [{ '%or': ['Integer', null] }], writes: false }],
        headers: [{ re: [{ '%or': ['Text', null] }], writes: false }],
        scope: [{ re: [{ '%or': ['Text', null] }], writes: false }],
        abbr: [{ re: [{ '%or': ['Text', null] }], writes: false }],
      },
    },
  },
  ':caption': {
    extends: [':ParentElement'],
    public: {
      $new: [
        {
          args: [{ ...ELEMENT_ARGS, children: { '%opt': [['Anything'], { '%t': 'List' }] } }],
          re: [':caption:*'],
          writes: false,
        },
      ],
    },
    ':*': {},
  },
  ':form': {
    extends: [':ParentElement'],
    public: {
      $new: [
        {
          args: [
            {
              ...ELEMENT_ARGS,
              children: { '%opt': [['Anything'], { '%t': 'List' }] },
              action: { '%opt': 'Text' },
              method: { '%opt': 'Text' },
              target: { '%opt': 'Text' },
              enctype: { '%opt': 'Text' },
              autocomplete: { '%opt': 'Text' },
              novalidate: { '%opt': 'Boolean' },
              name: { '%opt': 'Text' },
            },
          ],
          re: [':form:*'],
          writes: false,
        },
      ],
    },
    ':*': {
      public: {
        action: [{ re: [{ '%or': ['Text', null] }], writes: false }],
        method: [{ re: [{ '%or': ['Text', null] }], writes: false }],
        target: [{ re: [{ '%or': ['Text', null] }], writes: false }],
        enctype: [{ re: [{ '%or': ['Text', null] }], writes: false }],
        autocomplete: [{ re: [{ '%or': ['Text', null] }], writes: false }],
        novalidate: [{ re: [{ '%or': ['Boolean', null] }], writes: false }],
        name: [{ re: [{ '%or': ['Text', null] }], writes: false }],
      },
    },
  },
  ':input': {
    extends: [':Element'],
    public: {
      $new: [
        {
          args: [
            {
              ...ELEMENT_ARGS,
              type: { '%opt': 'Text' },
              name: { '%opt': 'Text' },
              value: { '%opt': { '%or': ['Text', 'Integer', 'Decimal'] } },
              placeholder: { '%opt': 'Text' },
              required: { '%opt': 'Boolean' },
              disabled: { '%opt': 'Boolean' },
              readonly: { '%opt': 'Boolean' },
              min: { '%opt': { '%or': ['Integer', 'Decimal', 'Text'] } },
              max: { '%opt': { '%or': ['Integer', 'Decimal', 'Text'] } },
              step: { '%opt': { '%or': ['Integer', 'Decimal', 'Text'] } },
              minlength: { '%opt': 'Integer' },
              maxlength: { '%opt': 'Integer' },
              pattern: { '%opt': 'Text' },
              accept: { '%opt': 'Text' },
              multiple: { '%opt': 'Boolean' },
              checked: { '%opt': 'Boolean' },
              autocomplete: { '%opt': 'Text' },
              list: { '%opt': 'Text' },
              src: { '%opt': 'Text' },
              alt: { '%opt': 'Text' },
              form: { '%opt': 'Text' },
              height: { '%opt': { '%or': ['Integer', 'Text'] } },
              width: { '%opt': { '%or': ['Integer', 'Text'] } },
              size: { '%opt': 'Integer' },
            },
          ],
          re: [':input:*'],
          writes: false,
        },
      ],
    },
    ':*': {
      public: {
        type: [{ re: [{ '%or': ['Text', null] }], writes: false }],
        name: [{ re: [{ '%or': ['Text', null] }], writes: false }],
        value: [{ re: [{ '%or': ['Text', null] }], writes: false }],
        placeholder: [{ re: [{ '%or': ['Text', null] }], writes: false }],
        required: [{ re: [{ '%or': ['Boolean', null] }], writes: false }],
        disabled: [{ re: [{ '%or': ['Boolean', null] }], writes: false }],
        readonly: [{ re: [{ '%or': ['Boolean', null] }], writes: false }],
        min: [{ re: [{ '%or': ['Text', null] }], writes: false }],
        max: [{ re: [{ '%or': ['Text', null] }], writes: false }],
        step: [{ re: [{ '%or': ['Text', null] }], writes: false }],
        minlength: [{ re: [{ '%or': ['Integer', null] }], writes: false }],
        maxlength: [{ re: [{ '%or': ['Integer', null] }], writes: false }],
        pattern: [{ re: [{ '%or': ['Text', null] }], writes: false }],
        accept: [{ re: [{ '%or': ['Text', null] }], writes: false }],
        multiple: [{ re: [{ '%or': ['Boolean', null] }], writes: false }],
        checked: [{ re: [{ '%or': ['Boolean', null] }], writes: false }],
        autocomplete: [{ re: [{ '%or': ['Text', null] }], writes: false }],
        list: [{ re: [{ '%or': ['Text', null] }], writes: false }],
        src: [{ re: [{ '%or': ['Text', null] }], writes: false }],
        alt: [{ re: [{ '%or': ['Text', null] }], writes: false }],
        form: [{ re: [{ '%or': ['Text', null] }], writes: false }],
        height: [{ re: [{ '%or': ['Text', null] }], writes: false }],
        width: [{ re: [{ '%or': ['Text', null] }], writes: false }],
        size: [{ re: [{ '%or': ['Integer', null] }], writes: false }],
      },
    },
  },
  ':button': {
    extends: [':ParentElement'],
    public: {
      $new: [
        {
          args: [
            {
              ...ELEMENT_ARGS,
              children: { '%opt': [['Anything'], { '%t': 'List' }] },
              type: { '%opt': 'Text' },
              name: { '%opt': 'Text' },
              value: { '%opt': { '%or': ['Text', 'Integer'] } },
              disabled: { '%opt': 'Boolean' },
              form: { '%opt': 'Text' },
              formaction: { '%opt': 'Text' },
              formmethod: { '%opt': 'Text' },
              formnovalidate: { '%opt': 'Boolean' },
              formtarget: { '%opt': 'Text' },
            },
          ],
          re: [':button:*'],
          writes: false,
        },
      ],
    },
    ':*': {
      public: {
        type: [{ re: [{ '%or': ['Text', null] }], writes: false }],
        name: [{ re: [{ '%or': ['Text', null] }], writes: false }],
        value: [{ re: [{ '%or': ['Text', null] }], writes: false }],
        disabled: [{ re: [{ '%or': ['Boolean', null] }], writes: false }],
        form: [{ re: [{ '%or': ['Text', null] }], writes: false }],
        formaction: [{ re: [{ '%or': ['Text', null] }], writes: false }],
        formmethod: [{ re: [{ '%or': ['Text', null] }], writes: false }],
        formnovalidate: [{ re: [{ '%or': ['Boolean', null] }], writes: false }],
        formtarget: [{ re: [{ '%or': ['Text', null] }], writes: false }],
      },
    },
  },
  ':select': {
    extends: [':ParentElement'],
    public: {
      $new: [
        {
          args: [
            {
              ...ELEMENT_ARGS,
              children: { '%opt': [['Anything'], { '%t': 'List' }] },
              name: { '%opt': 'Text' },
              multiple: { '%opt': 'Boolean' },
              required: { '%opt': 'Boolean' },
              disabled: { '%opt': 'Boolean' },
              size: { '%opt': 'Integer' },
              autocomplete: { '%opt': 'Text' },
              form: { '%opt': 'Text' },
            },
          ],
          re: [':select:*'],
          writes: false,
        },
      ],
    },
    ':*': {
      public: {
        name: [{ re: [{ '%or': ['Text', null] }], writes: false }],
        multiple: [{ re: [{ '%or': ['Boolean', null] }], writes: false }],
        required: [{ re: [{ '%or': ['Boolean', null] }], writes: false }],
        disabled: [{ re: [{ '%or': ['Boolean', null] }], writes: false }],
        size: [{ re: [{ '%or': ['Integer', null] }], writes: false }],
        autocomplete: [{ re: [{ '%or': ['Text', null] }], writes: false }],
        form: [{ re: [{ '%or': ['Text', null] }], writes: false }],
      },
    },
  },
  ':option': {
    extends: [':ParentElement'],
    public: {
      $new: [
        {
          args: [
            {
              ...ELEMENT_ARGS,
              children: { '%opt': [['Anything'], { '%t': 'List' }] },
              value: { '%opt': { '%or': ['Text', 'Integer', 'Decimal'] } },
              selected: { '%opt': 'Boolean' },
              disabled: { '%opt': 'Boolean' },
              label: { '%opt': 'Text' },
            },
          ],
          re: [':option:*'],
          writes: false,
        },
      ],
    },
    ':*': {
      public: {
        value: [{ re: [{ '%or': ['Text', null] }], writes: false }],
        selected: [{ re: [{ '%or': ['Boolean', null] }], writes: false }],
        disabled: [{ re: [{ '%or': ['Boolean', null] }], writes: false }],
        label: [{ re: [{ '%or': ['Text', null] }], writes: false }],
      },
    },
  },
  ':textarea': {
    extends: [':TextElement'],
    public: {
      $new: [
        {
          args: [
            {
              ...ELEMENT_ARGS,
              children: { '%opt': [['Text'], { '%t': 'List' }] },
              name: { '%opt': 'Text' },
              rows: { '%opt': 'Integer' },
              cols: { '%opt': 'Integer' },
              placeholder: { '%opt': 'Text' },
              required: { '%opt': 'Boolean' },
              disabled: { '%opt': 'Boolean' },
              readonly: { '%opt': 'Boolean' },
              minlength: { '%opt': 'Integer' },
              maxlength: { '%opt': 'Integer' },
              wrap: { '%opt': 'Text' },
              autocomplete: { '%opt': 'Text' },
              form: { '%opt': 'Text' },
            },
          ],
          re: [':textarea:*'],
          writes: false,
        },
      ],
    },
    ':*': {
      public: {
        name: [{ re: [{ '%or': ['Text', null] }], writes: false }],
        rows: [{ re: [{ '%or': ['Integer', null] }], writes: false }],
        cols: [{ re: [{ '%or': ['Integer', null] }], writes: false }],
        placeholder: [{ re: [{ '%or': ['Text', null] }], writes: false }],
        required: [{ re: [{ '%or': ['Boolean', null] }], writes: false }],
        disabled: [{ re: [{ '%or': ['Boolean', null] }], writes: false }],
        readonly: [{ re: [{ '%or': ['Boolean', null] }], writes: false }],
        minlength: [{ re: [{ '%or': ['Integer', null] }], writes: false }],
        maxlength: [{ re: [{ '%or': ['Integer', null] }], writes: false }],
        wrap: [{ re: [{ '%or': ['Text', null] }], writes: false }],
        autocomplete: [{ re: [{ '%or': ['Text', null] }], writes: false }],
        form: [{ re: [{ '%or': ['Text', null] }], writes: false }],
      },
    },
  },
  ':label': {
    extends: [':ParentElement'],
    public: {
      $new: [
        {
          args: [
            {
              ...ELEMENT_ARGS,
              children: { '%opt': [['Anything'], { '%t': 'List' }] },
              for: { '%opt': 'Text' },
              form: { '%opt': 'Text' },
            },
          ],
          re: [':label:*'],
          writes: false,
        },
      ],
    },
    ':*': {
      public: {
        for: [{ re: [{ '%or': ['Text', null] }], writes: false }],
        form: [{ re: [{ '%or': ['Text', null] }], writes: false }],
      },
    },
  },
  ':img': {
    extends: [':Element'],
    public: {
      $new: [
        {
          args: [
            {
              ...ELEMENT_ARGS,
              src: { '%opt': 'Text' },
              srcset: { '%opt': 'Text' },
              alt: { '%opt': 'Text' },
              width: { '%opt': { '%or': ['Integer', 'Text'] } },
              height: { '%opt': { '%or': ['Integer', 'Text'] } },
              sizes: { '%opt': 'Text' },
              loading: { '%opt': 'Text' },
              decoding: { '%opt': 'Text' },
              fetchpriority: { '%opt': 'Text' },
              crossorigin: { '%opt': 'Text' },
              referrerpolicy: { '%opt': 'Text' },
              usemap: { '%opt': 'Text' },
              ismap: { '%opt': 'Boolean' },
            },
          ],
          re: [':img:*'],
          writes: false,
        },
      ],
    },
    ':*': {
      public: {
        src: [{ re: [{ '%or': ['Text', null] }], writes: false }],
        srcset: [{ re: [{ '%or': ['Text', null] }], writes: false }],
        alt: [{ re: [{ '%or': ['Text', null] }], writes: false }],
        width: [{ re: [{ '%or': ['Text', null] }], writes: false }],
        height: [{ re: [{ '%or': ['Text', null] }], writes: false }],
        sizes: [{ re: [{ '%or': ['Text', null] }], writes: false }],
        loading: [{ re: [{ '%or': ['Text', null] }], writes: false }],
        decoding: [{ re: [{ '%or': ['Text', null] }], writes: false }],
        fetchpriority: [{ re: [{ '%or': ['Text', null] }], writes: false }],
        crossorigin: [{ re: [{ '%or': ['Text', null] }], writes: false }],
        referrerpolicy: [{ re: [{ '%or': ['Text', null] }], writes: false }],
        usemap: [{ re: [{ '%or': ['Text', null] }], writes: false }],
        ismap: [{ re: [{ '%or': ['Boolean', null] }], writes: false }],
      },
    },
  },
  ':canvas': {
    extends: [':ParentElement'],
    public: {
      $new: [
        {
          args: [
            {
              ...ELEMENT_ARGS,
              children: { '%opt': [['Anything'], { '%t': 'List' }] },
              width: { '%opt': { '%or': ['Integer', 'Text'] } },
              height: { '%opt': { '%or': ['Integer', 'Text'] } },
            },
          ],
          re: [':canvas:*'],
          writes: false,
        },
      ],
    },
    ':*': {
      public: {
        width: [{ re: [{ '%or': ['Text', null] }], writes: false }],
        height: [{ re: [{ '%or': ['Text', null] }], writes: false }],
      },
    },
  },
  ':iframe': {
    extends: [':ParentElement'],
    public: {
      $new: [
        {
          args: [
            {
              ...ELEMENT_ARGS,
              children: { '%opt': [['Anything'], { '%t': 'List' }] },
              src: { '%opt': 'Text' },
              srcdoc: { '%opt': 'Text' },
              name: { '%opt': 'Text' },
              sandbox: { '%opt': 'Text' },
              allow: { '%opt': 'Text' },
              allowfullscreen: { '%opt': 'Boolean' },
              loading: { '%opt': 'Text' },
              referrerpolicy: { '%opt': 'Text' },
              width: { '%opt': { '%or': ['Integer', 'Text'] } },
              height: { '%opt': { '%or': ['Integer', 'Text'] } },
            },
          ],
          re: [':iframe:*'],
          writes: false,
        },
      ],
    },
    ':*': {
      public: {
        src: [{ re: [{ '%or': ['Text', null] }], writes: false }],
        srcdoc: [{ re: [{ '%or': ['Text', null] }], writes: false }],
        name: [{ re: [{ '%or': ['Text', null] }], writes: false }],
        sandbox: [{ re: [{ '%or': ['Text', null] }], writes: false }],
        allow: [{ re: [{ '%or': ['Text', null] }], writes: false }],
        allowfullscreen: [{ re: [{ '%or': ['Boolean', null] }], writes: false }],
        loading: [{ re: [{ '%or': ['Text', null] }], writes: false }],
        referrerpolicy: [{ re: [{ '%or': ['Text', null] }], writes: false }],
        width: [{ re: [{ '%or': ['Text', null] }], writes: false }],
        height: [{ re: [{ '%or': ['Text', null] }], writes: false }],
      },
    },
  },
  ':figure': {
    extends: [':ParentElement'],
    public: {
      $new: [
        {
          args: [{ ...ELEMENT_ARGS, children: { '%opt': [['Anything'], { '%t': 'List' }] } }],
          re: [':figure:*'],
          writes: false,
        },
      ],
    },
    ':*': {},
  },
  ':figcaption': {
    extends: [':ParentElement'],
    public: {
      $new: [
        {
          args: [{ ...ELEMENT_ARGS, children: { '%opt': [['Anything'], { '%t': 'List' }] } }],
          re: [':figcaption:*'],
          writes: false,
        },
      ],
    },
    ':*': {},
  },
  ':details': {
    extends: [':ParentElement'],
    public: {
      $new: [
        {
          args: [
            {
              ...ELEMENT_ARGS,
              children: { '%opt': [['Anything'], { '%t': 'List' }] },
              open: { '%opt': 'Boolean' },
              name: { '%opt': 'Text' },
            },
          ],
          re: [':details:*'],
          writes: false,
        },
      ],
    },
    ':*': {
      public: {
        open: [{ re: [{ '%or': ['Boolean', null] }], writes: false }],
        name: [{ re: [{ '%or': ['Text', null] }], writes: false }],
      },
    },
  },
  ':summary': {
    extends: [':ParentElement'],
    public: {
      $new: [
        {
          args: [{ ...ELEMENT_ARGS, children: { '%opt': [['Anything'], { '%t': 'List' }] } }],
          re: [':summary:*'],
          writes: false,
        },
      ],
    },
    ':*': {},
  },
  ':dialog': {
    extends: [':ParentElement'],
    public: {
      $new: [
        {
          args: [
            {
              ...ELEMENT_ARGS,
              children: { '%opt': [['Anything'], { '%t': 'List' }] },
              open: { '%opt': 'Boolean' },
            },
          ],
          re: [':dialog:*'],
          writes: false,
        },
      ],
    },
    ':*': { public: { open: [{ re: [{ '%or': ['Boolean', null] }], writes: false }] } },
  },
});
