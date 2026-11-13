import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import yaml from "js-yaml";
import { AppState } from "../../js/core/state";
import { registry } from "../../js/core/plugin_registry.js";
import textPlugin from "../../features/text/plugin.js";
import multilinePlugin from "../../features/odp_multiline/plugin.js";
import { AIValidator } from "../../js/io/ai_validator.js";
import { AIService, aiService } from "../../js/io/ai_service.js";
import { LLMPrompt } from "../../js/ui/llm_prompt.js";
import { EditorSettings } from "../../js/ui/editor_settings.js";
import { OpenDisplayAdapter } from "../../js/io/adapters/opendisplay_adapter.js";
import { WidgetFactory } from "../../js/core/widget_factory";
import { loadLayoutIntoState } from "../../js/io/yaml_import";
import { PreferencesStore } from "../../js/core/stores/preferences_store.js";

const widget = (id = "w1") => ({
  id,
  type: "text",
  x: 0,
  y: 0,
  width: 200,
  height: 50,
  props: { text: "Original" },
});
describe("AI editing and settings regressions", () => {
  beforeEach(() => {
    localStorage.clear();
    registry.register(textPlugin);
    registry.register(multilinePlugin);
    AppState.reset();
    AppState.setPages([
      { id: "A", name: "A", widgets: [widget()] },
      { id: "B", name: "B", widgets: [widget("b")] },
    ]);
    AppState.setCurrentPageIndex(0);
    AppState.updateSettings({
      ai_provider: "openai",
      ai_api_key_openai: "test-only",
      ai_model_openai: "test-model",
      ai_model_filter: "",
    });
    AppState.replaceHistoryBaseline();
    document.body.innerHTML =
      '<div id="aiPromptModal"></div><button id="aiPromptClose"></button><button id="aiPromptSubmit"></button><button id="aiPromptApply"></button><textarea id="aiPromptInput">Change title</textarea><div id="aiPromptStatus"></div><div id="aiPreviewDiff"></div><pre id="aiDiffContent"></pre><select id="aiModelSelect"></select>';
  });
  afterEach(async () => {
    // Undo/redo releases its restoration guard on the next browser tick.
    await new Promise(resolve => setTimeout(resolve, 0));
    vi.restoreAllMocks();
  });
  it("normalizes legacy flat AI text for the real renderer", () => {
    const flat = { ...widget(), text: "Requested title", font_size: 36 };
    delete flat.props;
    const result = AIValidator.validateWidget(flat);
    expect(result.valid).toBe(true);
    const el = document.createElement("div");
    textPlugin.render(el, result.sanitized, { getColorStyle: (x) => x });
    expect(el.textContent).toBe("Requested title");
  });
  it("preserves nested widget properties", () => {
    const result = AIValidator.validateWidget(widget());
    expect(result.sanitized.props).toEqual({ text: "Original" });
  });
  it('applies a real service response through validation, rendering and undo', async () => {
    const generated = {...widget(), entity_id: 'sensor.temperature', props: {text: 'Kitchen', font_size: 28}};
    vi.spyOn(aiService, 'callOpenAI').mockResolvedValue(JSON.stringify({widgets: [generated]}));
    const prompt = new LLMPrompt();
    await prompt.handleSubmit();
    prompt.handleApply();
    const el = document.createElement('div');
    textPlugin.render(el, AppState.getCurrentPage().widgets[0], {getColorStyle: x => x});
    expect(el.textContent).toBe('Kitchen');
    expect(AppState.getCurrentPage().widgets[0].entity_id).toBe('sensor.temperature');
    AppState.undo();
    expect(AppState.getCurrentPage().widgets).toEqual([widget()]);
  });
  it('keeps preferences usable when browser storage cannot be read', () => {
    vi.spyOn(localStorage, 'getItem').mockImplementation(() => { throw new Error('Storage blocked'); });
    expect(() => new PreferencesStore()).not.toThrow();
  });
  it('keeps autosave disabled in memory when browser storage cannot be written', () => {
    const prefs = new PreferencesStore();
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new Error('Storage full'); });
    expect(() => prefs.setAutoSaveEnabled(false)).not.toThrow();
    expect(prefs.autoSaveEnabled).toBe(false);
  });
  it.each([null, [], {type: 'text', id: '', x: 0, y: 0, width: 10, height: 10}])(
    'rejects malformed or unidentified widgets', input => {
      expect(AIValidator.validateWidget(input).valid).toBe(false);
    }
  );
  it('preserves bindings, visibility and extension properties on canonical widgets', () => {
    const original = {...widget(), entity_id: 'sensor.temperature', locked: true,
      hidden: true, parentId: 'group1', condition_entity: 'binary_sensor.awake',
      props: {text: 'Original', custom_extension: {format: 'precise'}}};
    const result = AIValidator.validateWidget(original);
    expect(result.valid).toBe(true);
    expect(result.sanitized).toEqual(original);
  });
  it("rejects an invalid unknown widget response", async () => {
    const service = new AIService();
    vi.spyOn(service, "callOpenAI").mockResolvedValue(
      '{"widgets":[{"type":"imaginary"}]}',
    );
    await expect(
      service.processPrompt("change title", { widgets: [widget()] }),
    ).rejects.toThrow("invalid widget data");
  });
  it("applies generated replacement as one undoable operation", async () => {
    vi.spyOn(aiService, "processPrompt").mockResolvedValue([widget("new")]);
    const prompt = new LLMPrompt();
    await prompt.handleSubmit();
    prompt.handleApply();
    expect(AppState.getCurrentPage().widgets[0].id).toBe("new");
    expect(AppState.canUndo()).toBe(true);
    AppState.undo();
    expect(AppState.getCurrentPage().widgets[0].id).toBe("w1");
    AppState.redo();
    expect(AppState.getCurrentPage().widgets[0].id).toBe("new");
  });
  it("discards late results after closing and switching pages", async () => {
    let resolve;
    vi.spyOn(aiService, "processPrompt").mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const prompt = new LLMPrompt();
    const request = prompt.handleSubmit();
    prompt.close();
    AppState.setCurrentPageIndex(1);
    prompt.open();
    resolve([widget("generated-for-A")]);
    await request;
    prompt.handleApply();
    expect(AppState.pages[1].widgets[0].id).toBe("b");
    expect(AppState.pages[0].widgets[0].id).toBe("w1");
  });
  it("persists the first visible model when none is selected", () => {
    AppState.updateSettings({ ai_model_openai: "" });
    aiService.cache.models.openai = [{ id: "example", name: "Example" }];
    const settings = new EditorSettings();
    settings.filterModels();
    expect(settings.aiModelSelect.value).toBe("example");
    expect(AppState.settings.ai_model_openai).toBe("example");
  });
  it("round trips the OpenDisplay multiline delimiter", async () => {
    const output = await new OpenDisplayAdapter().generate({
      pages: [
        {
          widgets: [
            {
              ...widget(),
              type: "odp_multiline",
              props: { text: "A|B", delimiter: "|" },
            },
          ],
        },
      ],
    });
    expect(yaml.load(output).data.payload[0].delimiter).toBe("|");
  });
  it("inherits global darkMode for new widget colors", () => {
    AppState.getCurrentPage().dark_mode = "inherit";
    AppState.updateSettings({ darkMode: true });
    expect(WidgetFactory.getEffectiveDarkMode()).toBe(true);
  });
  it("restores autosave preference from a flattened layout", () => {
    AppState.updateSettings({ autoSaveEnabled: true });
    localStorage.removeItem("esphome-designer-autosave");
    loadLayoutIntoState({
      autoSaveEnabled: false,
      pages: [{ id: "A", widgets: [widget()] }],
    });
    expect(AppState.settings.autoSaveEnabled).toBe(false);
  });
  it("keeps autosave off across reloads and loading an older layout", () => {
    AppState.updateSettings({ autoSaveEnabled: false });
    expect(new PreferencesStore().state.autoSaveEnabled).toBe(false);
    loadLayoutIntoState({
      autoSaveEnabled: true,
      pages: [{ id: "A", widgets: [widget()] }],
    });
    expect(AppState.settings.autoSaveEnabled).toBe(false);
  });
  it.each(["edit", "page", "layout"])(
    "refuses a generated result after a subsequent %s change",
    async (change) => {
      vi.spyOn(aiService, "processPrompt").mockResolvedValue([widget("new")]);
      const prompt = new LLMPrompt();
      await prompt.handleSubmit();
      if (change === "edit")
        AppState.getCurrentPage().widgets[0].props.text = "Manual edit";
      if (change === "page") AppState.setCurrentPageIndex(1);
      if (change === "layout")
        AppState.setPages([{ id: "A", widgets: [widget("loaded")] }]);
      const before = JSON.stringify(AppState.pages);
      prompt.handleApply();
      expect(JSON.stringify(AppState.pages)).toBe(before);
    },
  );
  it.each([
    { widgets: [{ ...widget(), width: -1 }] },
    { widgets: [{ ...widget(), x: "10" }] },
    { widgets: [widget(), widget()] },
    { widgets: [{ ...widget(), props: [] }] },
  ])(
    "rejects structurally invalid AI output without partial application",
    async (payload) => {
      const service = new AIService();
      vi.spyOn(service, "callOpenAI").mockResolvedValue(
        JSON.stringify(payload),
      );
      await expect(
        service.processPrompt("change", { widgets: [widget()] }),
      ).rejects.toThrow("invalid widget data");
    },
  );
  it("rejects invalid widgets after JSON repair as well", async () => {
    const service = new AIService();
    vi.spyOn(service, "callOpenAI").mockResolvedValue(
      '{"widgets":[{"type":"imaginary"}',
    );
    await expect(
      service.processPrompt("change", { widgets: [widget()] }),
    ).rejects.toThrow("invalid widget data");
  });
  it.each([
    "|",
    ">",
    "*alias",
    "&anchor",
    "@name",
    "~",
    "1e3",
    "0x10",
    "2026-11-12",
  ])("round trips YAML-sensitive text %s", async (text) => {
    const output = await new OpenDisplayAdapter().generate({
      pages: [{ widgets: [{ ...widget(), props: { text } }] }],
    });
    expect(yaml.load(output).data.payload[0].value).toBe(text);
  });
});
