import { describe, expect, it } from 'vitest';
import { floorToStep, roundToTick } from '../src/server/binance/filters.js';

describe('Binance filters', () => {
  it('floors quantities to step size without floating point drift', () => {
    expect(floorToStep('11.012987', '0.001')).toBe('11.012');
    expect(floorToStep('0.109105', '0.0001')).toBe('0.1091');
  });

  it('rounds trigger prices to tick size', () => {
    expect(roundToTick('0.1095065', '0.0001')).toBe('0.1095');
    expect(roundToTick('93.499', '0.001')).toBe('93.499');
  });
});
