import { serve } from "https://deno.land/std@0.177.0/http/server.ts"

// 安全的Python函数执行器（模拟）
function executeCustomFunction(code: string, inputData: number[]): number[] {
  try {
    // 这里模拟Python函数执行
    // 在实际环境中，这里应该调用安全的代码执行环境
    
    // 解析简单的数学表达式
    if (code.includes('mean') || code.includes('average')) {
      const mean = inputData.reduce((sum, val) => sum + val, 0) / inputData.length;
      return Array.from({ length: 12 }, (_, i) => mean + (Math.random() - 0.5) * mean * 0.2);
    }
    
    if (code.includes('trend') || code.includes('linear')) {
      const startValue = inputData[inputData.length - 1] || 100;
      const trend = inputData.length > 1 ? 
        (inputData[inputData.length - 1] - inputData[0]) / inputData.length : 0;
      
      return Array.from({ length: 12 }, (_, i) => 
        startValue + trend * (i + 1) + (Math.random() - 0.5) * startValue * 0.1
      );
    }
    
    // 默认：基于最后一个值的简单预测
    const lastValue = inputData[inputData.length - 1] || 100;
    return Array.from({ length: 12 }, () => 
      lastValue * (0.95 + Math.random() * 0.1)
    );
    
  } catch (error) {
    throw new Error(`函数执行失败: ${error.message}`);
  }
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
    const { code, inputData, parameters } = await req.json();
    
    if (!code || typeof code !== 'string') {
      throw new Error('代码内容不能为空');
    }
    
    if (!Array.isArray(inputData) || inputData.length === 0) {
      throw new Error('输入数据格式无效');
    }
    
    // 安全检查
    const dangerousKeywords = ['import', 'eval', 'exec', 'open', 'file', 'subprocess', 'os.', 'sys.'];
    const hasUnsafeCode = dangerousKeywords.some(keyword => code.includes(keyword));
    
    if (hasUnsafeCode) {
      throw new Error('代码包含不安全的操作');
    }
    
    // 执行自定义函数
    const predictions = executeCustomFunction(code, inputData);
    
    // 计算统计信息
    const mean = predictions.reduce((sum, val) => sum + val, 0) / predictions.length;
    const variance = predictions.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / predictions.length;
    const standardDeviation = Math.sqrt(variance);
    
    const sorted = [...predictions].sort((a, b) => a - b);
    const percentiles = {
      p5: sorted[Math.floor(sorted.length * 0.05)],
      p25: sorted[Math.floor(sorted.length * 0.25)],
      p75: sorted[Math.floor(sorted.length * 0.75)],
      p95: sorted[Math.floor(sorted.length * 0.95)]
    };
    
    const result = {
      model: 'custom',
      predictions,
      statistics: {
        mean,
        median: sorted[Math.floor(sorted.length * 0.5)],
        standardDeviation,
        percentiles
      },
      executionInfo: {
        codeLength: code.length,
        dataPoints: inputData.length,
        executedAt: new Date().toISOString()
      }
    };
    
    return new Response(JSON.stringify({ data: result }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (error) {
    const errorResponse = {
      error: {
        code: 'CUSTOM_FUNCTION_ERROR',
        message: error.message
      }
    };

    return new Response(JSON.stringify(errorResponse), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});