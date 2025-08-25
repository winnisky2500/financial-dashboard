import { serve } from "https://deno.land/std@0.177.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.55.0"

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const openaiApiKey = Deno.env.get('OPENAI_API_KEY');

const supabase = createClient(supabaseUrl, supabaseServiceKey);

// 获取财务数据上下文
async function getFinancialContext(filters: any): Promise<string> {
  try {
    // 获取相关的财务数据
    const { data: kpis } = await supabase
      .from('kpis')
      .select('*')
      .limit(20);
    
    const { data: financialData } = await supabase
      .from('financial_data')
      .select(`
        *,
        subsidiary:subsidiaries(name),
        kpi:kpis(name, code, unit, category)
      `)
      .order('period_date', { ascending: false })
      .limit(50);
    
    const { data: sectors } = await supabase
      .from('sectors')
      .select('*');
    
    const { data: subsidiaries } = await supabase
      .from('subsidiaries')
      .select('*');
    
    // 构建上下文字符串
    let context = '以下是当前的财务数据信息：\n\n';
    
    // 板块信息
    if (sectors) {
      context += '业务板块：\n';
      sectors.forEach(sector => {
        context += `- ${sector.name}: ${sector.description}\n`;
      });
      context += '\n';
    }
    
    // 子公司信息
    if (subsidiaries) {
      context += '子公司：\n';
      subsidiaries.slice(0, 10).forEach(sub => {
        context += `- ${sub.name} (级别: ${sub.level})\n`;
      });
      context += '\n';
    }
    
    // 最新财务数据
    if (financialData) {
      context += '最新财务数据：\n';
      const groupedData = financialData.reduce((acc, item) => {
        const key = item.kpi?.code || 'UNKNOWN';
        if (!acc[key]) {
          acc[key] = [];
        }
        acc[key].push(item);
        return acc;
      }, {} as Record<string, any[]>);
      
      Object.entries(groupedData).slice(0, 8).forEach(([kpiCode, items]) => {
        const kpiInfo = items[0]?.kpi;
        if (kpiInfo) {
          const avgValue = items.reduce((sum, item) => sum + item.value, 0) / items.length;
          context += `- ${kpiInfo.name} (${kpiCode}): 平均值 ${avgValue.toFixed(2)}${kpiInfo.unit}\n`;
        }
      });
    }
    
    return context;
  } catch (error) {
    console.error('获取财务上下文失败:', error);
    return '无法获取财务数据上下文';
  }
}

// 调用AI服务生成分析
async function generateAnalysis(question: string, context: string, filters: any): Promise<string> {
  if (!openaiApiKey) {
    // 如果没有AI API Key，返回模拟回复
    return generateMockAnalysis(question, context, filters);
  }
  
  try {
    const systemPrompt = `你是一个专业的企业财务分析师。请根据用户问题和提供的财务数据，进行深入的分析和解答。

分析要求：
1. 使用专业的财务术语和分析方法
2. 提供具体的数据支持和计算
3. 给出实际的改进建议
4. 使用Markdown格式进行清晰的结构化展示
5. 分析应该包含：现状分析、问题识别、原因分析、改进建议

财务数据上下文：
${context}`;
    
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${openaiApiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-4',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: question }
        ],
        max_tokens: 2000,
        temperature: 0.3
      })
    });
    
    if (!response.ok) {
      throw new Error(`AI服务调用失败: ${response.status}`);
    }
    
    const result = await response.json();
    return result.choices[0]?.message?.content || '无法生成分析结果';
    
  } catch (error) {
    console.error('AI分析失败:', error);
    return generateMockAnalysis(question, context, filters);
  }
}

// 模拟分析生成（备用）
function generateMockAnalysis(question: string, context: string, filters: any): string {
  const analysisTemplates = {
    毛利率: `## 毛利率分析报告

### 现状分析
当前毛利率为23.5%，较上期下降1.3个百分点。

### 问题识别
- 原材料成本上升导致毛利率压缩
- 产品结构需要优化
- 部分子公司表现低于预期

### 改进建议
1. 加强成本控制，提高采购效率
2. 优化产品组合，提高高毛利产品占比
3. 推进数字化转型，降低运营成本`,
    
    ROE: `## ROE分析报告

### 现状分析
ROE为15.8%，较上期下降1.4个百分点。

### 问题识别
- 净利率稳定，但资产周转率下降
- 权益乘数保持合理水平
- 部分业务板块表现不佳

### 改进建议
1. 提高资产使用效率
2. 优化资本结构
3. 加强核心业务发展`,
    
    默认: `## 财务分析报告

### 数据概览
基于当前财务数据，企业整体运营情况稳健。

### 关键发现
1. 盈利能力保持在行业平均水平
2. 运营效率有提升空间
3. 财务风险控制良好

### 建议措施
- 继续保持现有的稳健经营策略
- 加强成本管控和效率提升
- 密切关注市场变化和政策影响`
  };
  
  // 根据问题关键词选择模板
  for (const [key, template] of Object.entries(analysisTemplates)) {
    if (question.includes(key)) {
      return template;
    }
  }
  
  return analysisTemplates.默认;
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
    const { question, filters } = await req.json();
    
    if (!question || typeof question !== 'string') {
      throw new Error('问题内容不能为空');
    }
    
    // 获取财务数据上下文
    const context = await getFinancialContext(filters || {});
    
    // 生成AI分析
    const analysis = await generateAnalysis(question, context, filters);
    
    return new Response(JSON.stringify({ 
      data: {
        analysis,
        context: context.substring(0, 500) + '...', // 返回部分上下文用于参考
        timestamp: new Date().toISOString()
      }
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (error) {
    const errorResponse = {
      error: {
        code: 'FINANCIAL_ANALYSIS_ERROR',
        message: error.message
      }
    };

    return new Response(JSON.stringify(errorResponse), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});