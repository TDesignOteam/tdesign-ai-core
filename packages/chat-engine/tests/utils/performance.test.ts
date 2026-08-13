import { describe, expect, it, vi } from 'vitest';

import { checkPerformance, PERFORMANCE_THRESHOLDS, PerformanceMonitor } from '../../utils/performance';

describe('PerformanceMonitor', () => {
  it('records render and update measurements and returns function results', () => {
    vi.spyOn(performance, 'now')
      .mockReturnValueOnce(10)
      .mockReturnValueOnce(25)
      .mockReturnValueOnce(30)
      .mockReturnValueOnce(38);
    vi.spyOn(Date, 'now').mockReturnValue(1234);
    const monitor = new PerformanceMonitor();

    const finishRender = monitor.start();
    const renderMetric = finishRender(4);
    const update = monitor.measureUpdate(() => 'result');

    expect(renderMetric).toMatchObject({ renderTime: 15, updateTime: 0, componentCount: 4, timestamp: 1234 });
    expect(update).toMatchObject({
      result: 'result',
      metric: { renderTime: 0, updateTime: 8, componentCount: 0, timestamp: 1234 },
    });
    expect(monitor.getMetrics()).toHaveLength(2);
    expect(monitor.getAverageRenderTime()).toBe(15);
    expect(monitor.getAverageUpdateTime()).toBe(8);
  });

  it('keeps only the latest 100 metrics and returns defensive arrays', () => {
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now++);
    const monitor = new PerformanceMonitor();

    for (let index = 0; index < 101; index += 1) monitor.start()(index);

    const metrics = monitor.getMetrics();
    expect(metrics).toHaveLength(100);
    expect(metrics[0].componentCount).toBe(1);
    metrics.pop();
    expect(monitor.getMetrics()).toHaveLength(100);
  });

  it('summarizes recent metrics and resets state', () => {
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => {
      const value = now;
      now += 5;
      return value;
    });
    const monitor = new PerformanceMonitor();
    monitor.start()(2);
    monitor.measureUpdate(() => undefined);

    expect(monitor.getSummary()).toMatchObject({
      totalOperations: 2,
      renderOperations: 1,
      updateOperations: 1,
      avgRenderTime: 5,
      avgUpdateTime: 5,
      recentAvgRenderTime: 5,
      recentAvgUpdateTime: 5,
    });

    monitor.reset();
    expect(monitor.getMetrics()).toEqual([]);
    expect(monitor.getSummary()).toMatchObject({ totalOperations: 0, avgRenderTime: 0, avgUpdateTime: 0 });
  });

  it('prints a formatted summary', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const monitor = new PerformanceMonitor();

    monitor.printSummary();

    expect(log).toHaveBeenCalledWith(
      '[json-render Performance Summary]',
      expect.objectContaining({
        总操作次数: 0,
        '平均渲染时间(ms)': '0.00',
        '平均内存使用(MB)': '0.00',
      }),
    );
  });
});

describe('checkPerformance', () => {
  it('exports the documented default thresholds', () => {
    expect(PERFORMANCE_THRESHOLDS).toEqual({ renderTime: 50, updateTime: 16, memoryUsage: 100 });
  });

  it('warns independently for metrics over each threshold', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    checkPerformance(
      { renderTime: 11, updateTime: 12, memoryUsage: 13, componentCount: 3, timestamp: 0 },
      { renderTime: 10, updateTime: 10, memoryUsage: 10 },
    );

    expect(warn).toHaveBeenCalledTimes(3);
    expect(warn.mock.calls.map(([message]) => message)).toEqual([
      expect.stringContaining('11.00ms'),
      expect.stringContaining('12.00ms'),
      expect.stringContaining('13.00MB'),
    ]);
  });

  it('does not warn at or below thresholds', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    checkPerformance(
      { renderTime: 10, updateTime: 10, memoryUsage: 10, componentCount: 0, timestamp: 0 },
      { renderTime: 10, updateTime: 10, memoryUsage: 10 },
    );

    expect(warn).not.toHaveBeenCalled();
  });
});
