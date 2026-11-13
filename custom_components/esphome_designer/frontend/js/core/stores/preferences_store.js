import { emit, EVENTS } from '../events.js';
import { Logger } from '../../utils/logger.js';
import { DEFAULT_PREFERENCES } from '../constants';

const AI_SETTINGS_STORAGE_KEY = 'esphome-designer-ai-settings';
const AI_SETTING_KEYS = Object.keys(DEFAULT_PREFERENCES).filter(key =>
    key === 'ai_provider' || key.startsWith('ai_model_'));

/** Read only known, non-secret AI preferences from browser storage. */
export function getPersistedAISettings() {
    try {
        const saved = JSON.parse(globalThis.localStorage?.getItem(AI_SETTINGS_STORAGE_KEY) || '{}');
        return Object.fromEntries(AI_SETTING_KEYS
            .filter(key => typeof saved?.[key] === 'string')
            .map(key => [key, saved[key]]));
    } catch {
        return {};
    }
}

/**
 * @typedef {Object} PreferencesState
 * @property {boolean} snapEnabled
 * @property {boolean} showGrid
 * @property {boolean} [showDebugGrid]
 * @property {boolean} [showRulers]
 * @property {boolean} [autoSaveEnabled]
 * @property {number} gridOpacity
 * @property {boolean} editor_light_mode
 * @property {string} [orientation]
 * @property {string} [renderingMode]
 */

export class PreferencesStore {
    constructor() {
        /** @type {PreferencesState} */
        this.state = /** @type {PreferencesState} */ ({ ...DEFAULT_PREFERENCES, ...getPersistedAISettings() });
    }

    /** @returns {boolean} */
    get snapEnabled() { return this.state.snapEnabled; }
    /** @returns {boolean} */
    get showGrid() { return this.state.showGrid; }
    /** @returns {boolean} */
    get showDebugGrid() { return !!this.state.showDebugGrid; }
    /** @returns {boolean} */
    get showRulers() { return !!this.state.showRulers; }
    /** @returns {boolean} */
    get autoSaveEnabled() { return this.state.autoSaveEnabled !== false; }
    /** @returns {number} */
    get gridOpacity() { return this.state.gridOpacity; }
    /** @returns {boolean} */
    get editor_light_mode() { return this.state.editor_light_mode; }

    /** @param {Partial<PreferencesState>} updates */
    update(updates) {
        this.state = { ...this.state, ...updates };
        const aiUpdates = Object.fromEntries(Object.entries(updates)
            .filter(([key, value]) => AI_SETTING_KEYS.includes(key) && typeof value === 'string'));
        if (Object.keys(aiUpdates).length) {
            try {
                globalThis.localStorage?.setItem(AI_SETTINGS_STORAGE_KEY,
                    JSON.stringify({ ...getPersistedAISettings(), ...aiUpdates }));
            } catch (error) {
                Logger.warn('[PreferencesStore] Failed to save AI settings:', error);
            }
        }
        emit(EVENTS.SETTINGS_CHANGED, this.state);
        Logger.log("[PreferencesStore] Settings updated");
    }

    /** @param {boolean} enabled */
    setSnapEnabled(enabled) {
        this.state.snapEnabled = enabled;
        emit(EVENTS.SETTINGS_CHANGED, { snapEnabled: enabled });
    }

    /** @param {boolean} enabled */
    setShowGrid(enabled) {
        this.state.showGrid = enabled;
        emit(EVENTS.SETTINGS_CHANGED, { showGrid: enabled });
    }

    /** @param {boolean} enabled */
    setShowDebugGrid(enabled) {
        this.state.showDebugGrid = enabled;
        emit(EVENTS.SETTINGS_CHANGED, { showDebugGrid: enabled });
    }

    /** @param {boolean} enabled */
    setShowRulers(enabled) {
        this.state.showRulers = enabled;
        emit(EVENTS.SETTINGS_CHANGED, { showRulers: enabled });
    }

    /** @param {boolean} enabled */
    setAutoSaveEnabled(enabled) {
        this.state.autoSaveEnabled = enabled;
        emit(EVENTS.SETTINGS_CHANGED, { autoSaveEnabled: enabled });
    }
}
