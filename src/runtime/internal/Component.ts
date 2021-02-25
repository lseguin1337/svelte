import { add_render_callback, flush, schedule_update, dirty_components } from './scheduler';
import { current_component, set_current_component } from './lifecycle';
import { blank_object, is_empty, is_function, run, run_all, noop } from './utils';
import { append, attribute_to_object, children, detach, element, get_custom_elements_slots } from './dom';
import { transition_in } from './transitions';

interface Fragment {
	key: string|null;
	first: null;
	/* create  */ c: () => void;
	/* claim   */ l: (nodes: any) => void;
	/* hydrate */ h: () => void;
	/* mount   */ m: (target: HTMLElement, anchor: any) => void;
	/* update  */ p: (ctx: any, dirty: any) => void;
	/* measure */ r: () => void;
	/* fix     */ f: () => void;
	/* animate */ a: () => void;
	/* intro   */ i: (local: any) => void;
	/* outro   */ o: (local: any) => void;
	/* destroy */ d: (detaching: 0|1) => void;
}
interface T$$ {
	dirty: number[];
	ctx: null|any;
	bound: any;
	update: () => void;
	callbacks: any;
	after_update: any[];
	props: Record<string, 0 | string>;
	fragment: null|false|Fragment;
	not_equal: any;
	before_update: any[];
	context: Map<any, any>;
	on_mount: any[];
	on_destroy: any[];
	skip_bound: boolean;
	on_disconnect: any[];
}

export function bind(component, name, callback) {
	const index = component.$$.props[name];
	if (index !== undefined) {
		component.$$.bound[index] = callback;
		callback(component.$$.ctx[index]);
	}
}

export function create_component(block) {
	block && block.c();
}

export function claim_component(block, parent_nodes) {
	block && block.l(parent_nodes);
}

export function mount_component(component, target, anchor, customElement) {
	const { fragment, on_mount, on_destroy, after_update } = component.$$;

	fragment && fragment.m(target, anchor);

	if (!customElement) {
		// onMount happens before the initial afterUpdate
		add_render_callback(() => {

			const new_on_destroy = on_mount.map(run).filter(is_function);
			if (on_destroy) {
				on_destroy.push(...new_on_destroy);
			} else {
				// Edge case - component was destroyed immediately,
				// most likely as a result of a binding initialising
				run_all(new_on_destroy);
			}
			component.$$.on_mount = [];
		});
	}

	after_update.forEach(add_render_callback);
}

export function destroy_component(component, detaching) {
	const $$ = component.$$;
	if ($$.fragment !== null) {
		run_all($$.on_destroy);

		$$.fragment && $$.fragment.d(detaching);

		// TODO null out other refs, including component.$$ (but need to
		// preserve final state?)
		$$.on_destroy = $$.fragment = null;
		$$.ctx = [];
	}
}

function make_dirty(component, i) {
	if (component.$$.dirty[0] === -1) {
		dirty_components.push(component);
		schedule_update();
		component.$$.dirty.fill(0);
	}
	component.$$.dirty[(i / 31) | 0] |= (1 << (i % 31));
}

export function install_style_node(root, styleId, styles) {
	if (!root.querySelector(`#${styleId}`)) {
		const style = element('style');
		style.id = styleId;
		style.textContent = styles;
		append(root, style);
	}
}

export function prepare_style(styleId, styles) {
	if (
		is_function(window.CSSStyleSheet)
		&& is_function((CSSStyleSheet.prototype as any).replace)
	) {
		const sheet = new CSSStyleSheet();
		(sheet as any).replace(styles);
		return (cssRoot) => {
			if (!("adoptedStyleSheets" in cssRoot)) {
				install_style_node(cssRoot, styleId, styles);
			} else if (cssRoot.adoptedStyleSheets.indexOf(sheet) === -1) {
				cssRoot.adoptedStyleSheets = cssRoot.adoptedStyleSheets.concat(sheet);
			}
		};
	}
	return (cssRoot) => install_style_node(cssRoot, styleId, styles);
}

export function mount_style(component, options, stylesheet_installer) {
	const root = component.cssRoot = options.cssRoot || current_component?.cssRoot || document.head;
	stylesheet_installer(root);
}

export function init(component, options, instance, create_fragment, not_equal, props, dirty = [-1]) {
	const parent_component = current_component;
	set_current_component(component);

	const $$: T$$ = component.$$ = {
		fragment: null,
		ctx: null,

		// state
		props,
		update: noop,
		not_equal,
		bound: blank_object(),

		// lifecycle
		on_mount: [],
		on_destroy: [],
		on_disconnect: [],
		before_update: [],
		after_update: [],
		context: new Map(parent_component ? parent_component.$$.context : []),

		// everything else
		callbacks: blank_object(),
		dirty,
		skip_bound: false
	};

	let ready = false;

	$$.ctx = instance
		? instance(component, options.props || {}, (i, ret, ...rest) => {
			const value = rest.length ? rest[0] : ret;
			if ($$.ctx && not_equal($$.ctx[i], $$.ctx[i] = value)) {
				if (!$$.skip_bound && $$.bound[i]) $$.bound[i](value);
				if (ready) make_dirty(component, i);
			}
			return ret;
		})
		: [];

	$$.update();
	ready = true;
	run_all($$.before_update);

	// `false` as a special case of no DOM component
	$$.fragment = create_fragment ? create_fragment($$.ctx) : false;

	if (options.target) {
		if (options.hydrate) {
			const nodes = children(options.target);
			// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
			$$.fragment && $$.fragment!.l(nodes);
			nodes.forEach(detach);
		} else {
			// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
			$$.fragment && $$.fragment!.c();
		}

		if (options.intro) transition_in(component.$$.fragment);
		mount_component(component, options.target, options.anchor, options.customElement);
		flush();
	}

	set_current_component(parent_component);
}

export let SvelteElement;
if (typeof HTMLElement === 'function') {
	SvelteElement = class extends HTMLElement {
		keepSvelteComponentAlive = false;

		private timeout: number;
		$$?: T$$;

		component?: SvelteComponent;
		props: any = {};

		constructor(
			uses_slots: boolean,
			private Component: typeof SvelteComponent,
		) {
			super();
			this.props = {
				...attribute_to_object(this.attributes),
				...(uses_slots ? { $$slots: get_custom_elements_slots(this) } : {}),
			};
			Object.defineProperty(this, '$$', { get: () => this.component?.$$ });
			this.attachShadow({ mode: 'open' });
		}

		$setup(): SvelteComponent {
			return new (this.Component as any)({
				target: this.shadowRoot,
				cssRoot: this.shadowRoot,
				props: this.props
			});
		}

		connectedCallback() {
			if (!this.component)
				this.component = this.$setup();
			else
				clearTimeout(this.timeout);
			const { on_mount } = this.$$;
			this.$$.on_disconnect = on_mount.map(run).filter(is_function);

			// @ts-ignore todo: improve typings
			for (const key in this.$$.slotted) {
				// @ts-ignore todo: improve typings
				this.appendChild(this.$$.slotted[key]);
			}
		}

		attributeChangedCallback(attr, _oldValue, newValue) {
			this[attr] = newValue;
		}

		disconnectedCallback() {
			run_all(this.$$.on_disconnect);
			if (!this.keepSvelteComponentAlive) {
				// destroy the context if the component is not imediatelly re-attach to the dom
				this.timeout = setTimeout(() => this.$destroy());
			}
		}

		addEventListener(type, callback) {
			this.component.$on(type, callback);
		}

		removeEventListener(type, callback) {
			const callbacks = (this.$$.callbacks[type] || (this.$$.callbacks[type] = []));
			const index = callbacks.indexOf(callback);
			if (index !== -1) callbacks.splice(index, 1);
		}

		$destroy() {
			this.component.$destroy();
			this.component = null;
			clearTimeout(this.timeout);
		}

		$set($$props) {
			this.props = { ...this.props, ...$$props };
			this.component?.$set($$props);
		}
	};
}

/**
 * Base class for Svelte components. Used when dev=false.
 */
export class SvelteComponent {
	$$: T$$;
	$$set?: ($$props: any) => void;

	$destroy() {
		destroy_component(this, 1);
		this.$destroy = noop;
	}

	$on(type, callback) {
		const callbacks = (this.$$.callbacks[type] || (this.$$.callbacks[type] = []));
		callbacks.push(callback);

		return () => {
			const index = callbacks.indexOf(callback);
			if (index !== -1) callbacks.splice(index, 1);
		};
	}

	$set($$props) {
		if (this.$$set && !is_empty($$props)) {
			this.$$.skip_bound = true;
			this.$$set($$props);
			this.$$.skip_bound = false;
		}
	}
}
