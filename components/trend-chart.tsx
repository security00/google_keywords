"use client";

import { useEffect, useMemo, useRef } from "react";
import * as echarts from "echarts/core";
import { LineChart } from "echarts/charts";
import { GridComponent, LegendComponent, TooltipComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";

echarts.use([LineChart, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer]);

type TrendChartProps = {
  timestamps: string[];
  values: number[];
  benchmarkValues: number[];
  keyword: string;
  benchmark: string;
};

export function TrendChart({
  timestamps,
  values,
  benchmarkValues,
  keyword,
  benchmark,
}: TrendChartProps) {
  const chartRef = useRef<HTMLDivElement | null>(null);
  const instanceRef = useRef<echarts.ECharts | null>(null);

  const normalized = useMemo(() => {
    const length = Math.min(timestamps.length, values.length, benchmarkValues.length);
    return {
      timestamps: timestamps.slice(-length),
      values: values.slice(-length),
      benchmarkValues: benchmarkValues.slice(-length),
    };
  }, [timestamps, values, benchmarkValues]);

  const option = useMemo(
    () => ({
      tooltip: { trigger: "axis" },
      legend: {
        data: [keyword, benchmark],
        textStyle: { fontSize: 11 },
      },
      grid: { left: 12, right: 12, top: 24, bottom: 24, containLabel: true },
      xAxis: {
        type: "category",
        data: normalized.timestamps,
        boundaryGap: false,
        axisLabel: { fontSize: 10 },
      },
      yAxis: { type: "value", axisLabel: { fontSize: 10 } },
      series: [
        {
          name: keyword,
          type: "line",
          data: normalized.values,
          smooth: true,
          showSymbol: false,
          lineStyle: { width: 2 },
        },
        {
          name: benchmark,
          type: "line",
          data: normalized.benchmarkValues,
          smooth: true,
          showSymbol: false,
          lineStyle: { width: 2, type: "dashed" },
        },
      ],
    }),
    [benchmark, keyword, normalized]
  );

  useEffect(() => {
    if (!chartRef.current) return;
    if (!instanceRef.current) {
      instanceRef.current = echarts.init(chartRef.current, undefined, {
        renderer: "canvas",
      });
    }
    instanceRef.current.setOption(option, true);
  }, [option]);

  useEffect(() => {
    const handleResize = () => instanceRef.current?.resize();
    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
      instanceRef.current?.dispose();
      instanceRef.current = null;
    };
  }, []);

  if (!normalized.timestamps.length) {
    return <div className="text-xs text-muted-foreground">暂无趋势数据</div>;
  }

  return <div ref={chartRef} className="h-56 w-full" />;
}
