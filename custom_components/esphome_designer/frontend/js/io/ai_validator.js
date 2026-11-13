import { registry } from '../core/plugin_registry.js';

export class AIValidator {
    /**
     * Validates an AI-generated widget against the plugin registry.
     * @param {any} widget 
     * @returns {{valid: boolean, errors: string[], sanitized: any}}
     */
    static validateWidget(widget) {
        const errors = [];
        if (!widget || typeof widget !== 'object') {
            return { valid: false, errors: ['Widget must be an object'], sanitized: null };
        }

        if (!widget.type) {
            return { valid: false, errors: ['Widget missing "type" field'], sanitized: null };
        }

        const plugin = widget.type === 'group' ? { defaults: {} } : registry.get(widget.type);
        if (!plugin) {
            return { valid: false, errors: [`Unknown widget type: "${widget.type}"`], sanitized: null };
        }

        // Plugins own an extensible nested props object. Core metadata stays at
        // the top level; accept legacy flat plugin properties at this boundary.
        const coreKeys = new Set([
            'id', 'type', 'x', 'y', 'width', 'height', 'z_index', 'title',
            'entity_id', 'entity_id_2', 'locked', 'hidden', 'parentId',
            'condition_entity', 'condition_operator', 'condition_state',
            'condition_value', 'condition_min', 'condition_max', 'condition_invert'
        ]);
        const pluginKeys = new Set([
            ...Object.keys(plugin.defaults || {}),
            ...(plugin.schema || []).flatMap(section => (section.fields || []).map(field => field.key))
        ]);
        const sanitized = { props: {} };
        if (widget.props !== undefined && (!widget.props || typeof widget.props !== 'object' || Array.isArray(widget.props))) {
            errors.push('Widget "props" must be an object');
        }
        for (const [key, value] of Object.entries(widget)) {
            if (coreKeys.has(key)) sanitized[key] = value;
            else if (key === 'props') continue;
            else if (pluginKeys.has(key)) sanitized.props[key] = value;
            else errors.push(`Hallucinated property "${key}" in widget type "${widget.type}"`);
        }
        // Canonical properties take precedence over legacy flat aliases.
        if (widget.props && typeof widget.props === 'object' && !Array.isArray(widget.props)) {
            sanitized.props = { ...sanitized.props, ...widget.props };
        }
        if (typeof widget.id !== 'string' || !widget.id.trim()) {
            errors.push('Widget must have a non-empty string "id"');
        }
        for (const req of ['x', 'y', 'width', 'height']) {
            if (widget[req] === undefined || widget[req] === null) {
                errors.push(`Missing required property "${req}" in widget "${widget.id || 'unknown'}"`);
            } else if (!Number.isFinite(widget[req]) || ((req === 'width' || req === 'height') && widget[req] <= 0)) {
                errors.push(`Invalid geometry "${req}" in widget "${widget.id}"`);
            }
        }

        return {
            valid: errors.length === 0,
            errors,
            sanitized
        };
    }

    /**
     * Validates an entire AI response payload.
     * @param {any} payload 
     * @returns {{valid: boolean, errors: string[], sanitized: any[]}}
     */
    static validateResponse(payload) {
        const errors = [];
        const sanitized = [];

        let widgets = [];
        if (Array.isArray(payload)) {
            widgets = payload;
        } else if (payload && typeof payload === 'object' && Array.isArray(payload.widgets)) {
            widgets = payload.widgets;
        } else {
            return { valid: false, errors: ['AI response must be an array of widgets or an object with a "widgets" array'], sanitized: [] };
        }

        const ids = new Set();
        for (const w of widgets) {
            if (w?.id && ids.has(w.id)) errors.push(`Duplicate widget id: "${w.id}"`);
            ids.add(w?.id);
            const result = this.validateWidget(w);
            if (!result.valid) {
                errors.push(...result.errors);
            }
            if (result.sanitized) {
                sanitized.push(result.sanitized);
            }
        }

        return {
            valid: errors.length === 0,
            errors,
            sanitized
        };
    }

    /**
     * Applies AI changes to a cloned state and returns the diff.
     * Does NOT modify the real state.
     * @param {any[]} currentWidgets - The current widget list
     * @param {any[]} aiPayload - The AI-generated widget list (already validated/sanitized)
     * @returns {{ cloned: any[], added: any[], modified: any[], removed: string[] }}
     */
    static sandbox(currentWidgets, aiPayload) {
        // Deep clone to prevent mutation
        /** @type {any[]} */
        const cloned = JSON.parse(JSON.stringify(currentWidgets));
        const currentIds = new Set(cloned.map((w) => w.id));
        const aiIds = new Set(aiPayload.map((w) => w.id));

        const added = aiPayload.filter((w) => !currentIds.has(w.id));
        const removed = cloned.filter((w) => !aiIds.has(w.id)).map((w) => w.id);
        const modified = aiPayload.filter((w) => {
            if (!currentIds.has(w.id)) return false;
            const original = cloned.find((o) => o.id === w.id);
            return JSON.stringify(original) !== JSON.stringify(w);
        });

        return { cloned, added, modified, removed };
    }
}
