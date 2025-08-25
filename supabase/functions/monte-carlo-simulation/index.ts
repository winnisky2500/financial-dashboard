import { serve } from "https://deno.land/std@0.177.0/http/server.ts"

// 蒙特卡洛模拟函数
function monteCarloSimulation(initialValue: number, volatility: number, periods: number, iterations: number): {
  scenarios: Array<{ name: string; values: number[]; probability: number }>,
  statistics: any
} {
  const allSimulations: number[][] = [];
  
  // 运行多次模拟
  for (let sim = 0; sim < iterations; sim++) {
    const path: number[] = [initialValue];
    
    for (let i = 1; i < periods; i++) {
      // 生成随机数（正态分布近似）
      const random1 = Math.random();
      const random2 = Math.random();
      const normalRandom = Math.sqrt(-2 * Math.log(random1)) * Math.cos(2 * Math.PI * random2);
      
      // 几何布朗运动
      const drift = 0.02; // 2% 年化增长率
      const shock = volatility * normalRandom;
      const nextValue = path[i - 1] * Math.exp(drift / 12 + shock / Math.sqrt(12));
      
      path.push(Math.max(0, nextValue));
    }
    
    allSimulations.push(path);
  }
  
  // 计算百分位数路径
  const percentilePaths: { [key: string]: number[] } = {};
  
  for (let period = 0; period < periods; period++) {
    const periodValues = allSimulations.map(sim => sim[period]).sort((a, b) => a - b);
    
    if (period === 0) {
      percentilePaths.p5 = [];
      percentilePaths.p50 = [];
      percentilePaths.p95 = [];
    }
    
    percentilePaths.p5.push(periodValues[Math.floor(periodValues.length * 0.05)]);
    percentilePaths.p50.push(periodValues[Math.floor(periodValues.length * 0.5)]);
    percentilePaths.p95.push(periodValues[Math.floor(periodValues.length * 0.95)]);
  }
  
  // 计算最终值统计
  const finalValues = allSimulations.map(sim => sim[sim.length - 1]).sort((a, b) => a - b);
  const mean = finalValues.reduce((sum, val) => sum + val, 0) / finalValues.length;
  const variance = finalValues.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / finalValues.length;
  
  return {
    scenarios: [
      {
        name: '悲观情景 (5%)',
        values: percentilePaths.p5,
        probability: 0.05
      },
      {
        name: '基准情景 (50%)',
        values: percentilePaths.p50,
        probability: 0.5
      },
      {
        name: '乐观情景 (95%)',
        values: percentilePaths.p95,
        probability: 0.95
      }
    ],
    statistics: {
      mean,
      median: finalValues[Math.floor(finalValues.length * 0.5)],
      standardDeviation: Math.sqrt(variance),
      percentiles: {
        p5: finalValues[Math.floor(finalValues.length * 0.05)],
        p25: finalValues[Math.floor(finalValues.length * 0.25)],
        p75: finalValues[Math.floor(finalValues.length * 0.75)],
        p95: finalValues[Math.floor(finalValues.length * 0.95)]
      }
    }
  };
}

serve(async (req) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS, PUT, DELETE, PATCH',
    'Access-Control-Max-Age': '86400',
    'Access-Control-Allow-Credentials': 'false'
  };

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const { initialValue, parameters } = await req.json();
    
    if (typeof initialValue !== 'number' || initialValue <= 0) {
      throw new Error('初始值必须为正数');
    }
    
    const volatility = parameters?.volatility || 0.15;
    const periods = parameters?.periods || 12;
    const iterations = parameters?.iterations || 1000;
    
    // 执行蒙特卡洛模拟
    const result = monteCarloSimulation(initialValue, volatility, periods, iterations);
    
    return new Response(JSON.stringify({ data: { model: 'monte-carlo', ...result } }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (error) {
    const errorResponse = {
      error: {
        code: 'MONTE_CARLO_ERROR',
        message: error.message
      }
    };

    return new Response(JSON.stringify(errorResponse), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});