import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppStateFacade, AppState } from '../../js/core/stores/index';
import { loadLayoutIntoState } from '../../js/io/yaml_import';
import { PreferencesStore, getPersistedAISettings } from '../../js/core/stores/preferences_store.js';

vi.mock('../../js/utils/logger.js', () => ({ Logger: { log: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

describe('AI settings persistence', () => {
    beforeEach(() => localStorage.clear());

    it('restores provider, models and credentials in a fresh app without saving a layout', () => {
        const app = new AppStateFacade();
        app.updateSettings({ ai_provider: 'openai', ai_model_openai: 'gpt-6.1-sol', ai_model_gemini: 'gemini-test', ai_model_filter: 'sol', ai_api_key_openai: 'test-secret', autoSaveEnabled: false });
        const reloaded = new AppStateFacade();
        expect(reloaded.settings).toMatchObject({ ai_provider: 'openai', ai_model_openai: 'gpt-6.1-sol', ai_model_gemini: 'gemini-test', ai_api_key_openai: 'test-secret', ai_model_filter: 'sol' });
        expect(localStorage.getItem('esphome-designer-layout')).toBeNull();
        expect(localStorage.getItem('esphome-designer-ai-settings')).not.toContain('test-secret');
        expect(JSON.stringify(reloaded.getPagesPayload())).not.toContain('test-secret');
    });

    it('keeps local choices when opening a stale layout, and migrates legacy preferences on first load', () => {
        loadLayoutIntoState({ ai_provider: 'openai', ai_model_openai: 'gpt-6.1-sol', pages: [] });
        expect(getPersistedAISettings()).toMatchObject({ ai_provider: 'openai', ai_model_openai: 'gpt-6.1-sol' });
        loadLayoutIntoState({ settings: { ai_provider: 'gemini', ai_model_openai: '' }, pages: [] });
        expect(AppState.settings).toMatchObject({ ai_provider: 'openai', ai_model_openai: 'gpt-6.1-sol' });
        expect(new AppStateFacade().settings.ai_provider).toBe('openai');
    });

    it('accepts deliberate model clearing and only loads known string preferences', () => {
        localStorage.setItem('esphome-designer-ai-settings', JSON.stringify({ ai_provider: 'openai', ai_model_openai: 123, ai_api_key_openai: 'bad', orientation: 'portrait' }));
        const prefs = new PreferencesStore();
        expect(getPersistedAISettings()).toEqual({ ai_provider: 'openai' });
        prefs.update({ ai_model_openai: '' });
        expect(getPersistedAISettings()).toEqual({ ai_provider: 'openai', ai_model_openai: '' });
    });

    it('handles corrupted or unavailable storage without preventing configuration', () => {
        localStorage.setItem('esphome-designer-ai-settings', '{bad');
        expect(getPersistedAISettings()).toEqual({});
        const spy = vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new Error('unavailable'); });
        try {
            const prefs = new PreferencesStore();
            expect(() => prefs.update({ ai_provider: 'openai' })).not.toThrow();
            expect(prefs.state.ai_provider).toBe('openai');
            expect(spy).toHaveBeenCalled();
        } finally { spy.mockRestore(); }
    });
});
