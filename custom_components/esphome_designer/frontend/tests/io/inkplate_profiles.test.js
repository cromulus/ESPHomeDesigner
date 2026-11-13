import { describe, it, expect, vi } from 'vitest';
import yaml from 'js-yaml';
import { DEVICE_PROFILES } from '../../js/io/devices.js';
import { parseHardwareRecipeClientSide } from '../../js/io/hardware_profile_sources.js';
import { ESPHomeAdapter } from '../../js/io/adapters/esphome_adapter';
import inkplate6 from '../../hardware/inkplate-6-mcp23017.yaml?raw';
import inkplate6v2 from '../../hardware/inkplate-6-v2-pcal6416a.yaml?raw';
import inkplate10 from '../../hardware/inkplate-10-mcp23017.yaml?raw';
import inkplate10new from '../../hardware/inkplate-10-pcal6416a.yaml?raw';

vi.mock('../../js/utils/logger.js', () => ({ Logger: { log: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const cases = [
    ['inkplate_6_mcp23017', inkplate6, 'mcp23017', 'mcp23xxx', 1, 'inkplate_6', 800, 600],
    ['inkplate_6_v2_pcal6416a', inkplate6v2, 'pca6416a', 'pca6416a', 1, 'inkplate_6_v2', 800, 600],
    ['inkplate_10_mcp23017', inkplate10, 'mcp23017', 'mcp23xxx', 2, 'inkplate_10', 1200, 825],
    ['inkplate_10_pcal6416a', inkplate10new, 'pca6416a', 'pca6416a', 2, 'inkplate_10', 1200, 825]
];
const schema = yaml.DEFAULT_SCHEMA.extend(['!lambda', '!secret'].map(tag => new yaml.Type(tag, { kind: 'scalar', construct: value => value })));

describe('Inkplate hardware revisions', () => {
    it.each(cases)('%s uses the matching expander and exports a direct e-paper display', async (id, recipe, expander, pinType, count, model, width, height) => {
        const profile = DEVICE_PROFILES[id];
        const parsed = parseHardwareRecipeClientSide(recipe, `${id}.yaml`);
        expect(profile.isUntestedProfile).toBe(true);
        expect(parsed.resolution).toEqual({ width, height });
        expect(parsed.features).toMatchObject({ psram: true, epaper: true, lcd: false, lvgl: false, touch: false });

        const adapter = new ESPHomeAdapter();
        vi.spyOn(adapter, 'fetchHardwarePackage').mockResolvedValue(recipe);
        const output = await adapter.generate({ deviceModel: id, deviceName: 'inkplate-test', renderingMode: 'direct', pages: [{ id: 'page_0', name: 'Main', widgets: [] }] });
        const config = yaml.load(output, { schema });
        expect(config[expander]).toHaveLength(count);
        expect(config[expander].map(hub => hub.address)).toEqual(count === 2 ? [0x20, 0x21] : [0x20]);
        expect(config.display[0]).toMatchObject({ platform: 'inkplate', model, greyscale: false, ckv_pin: 'GPIO32', sph_pin: 'GPIO33' });
        for (const [pin, number] of Object.entries({ gmod: 1, gpio0_enable: 8, oe: 0, spv: 2, powerup: 4, wakeup: 3, vcom: 5 })) {
            expect(config.display[0][`${pin}_pin`]).toMatchObject({ [pinType]: 'inkplate_io', number });
        }
        expect(config.display[0].lambda).toContain('page:name');
        expect(output).toContain('cpu_frequency: 240MHz');
        expect(output).toContain('board: esp-wrover-kit');
        expect(output).not.toContain('__LAMBDA_PLACEHOLDER__');
        expect(config.lvgl).toBeUndefined();
    });
});
